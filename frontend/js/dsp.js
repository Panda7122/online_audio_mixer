/* DSP layer: channel strips, master bus, clip scheduling, analysis and WAV encoding. */
(function (global) {
  'use strict';

  const DSP = {};
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  DSP.clamp = clamp;
  DSP.dbToGain = db => Math.pow(10, db / 20);
  DSP.gainToDb = g => 20 * Math.log10(Math.max(g, 1e-9));

  /* ---------- Tempo-synced delay ---------- */
  const NOTE_BEATS = { '1/2': 2, '1/4': 1, '1/4t': 2 / 3, '1/8': 0.5, '1/8d': 0.75, '1/8t': 1 / 3, '1/16': 0.25 };
  DSP.NOTE_VALUES = Object.keys(NOTE_BEATS);
  DSP.delaySeconds = (delay, bpm) => {
    const beats = NOTE_BEATS[delay.sync];
    const sec = beats ? (beats * 60) / bpm : delay.time / 1000;
    return clamp(sec, 0.001, 2);
  };

  const isOffline = ctx => typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;

  // Set an AudioParam: smoothed for live playback, immediate for offline rendering.
  function setParam(ctx, param, value) {
    if (!Number.isFinite(value)) return;
    if (isOffline(ctx)) param.value = value;
    else param.setTargetAtTime(value, ctx.currentTime, 0.012);
  }

  function biquad(ctx, type) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    return f;
  }

  /* ---------- EQ (7 filters: HPF, low shelf, 3 peaks, high shelf, LPF) ---------- */
  DSP.EQ_KEYS = ['hpf', 'ls', 'p1', 'p2', 'p3', 'hs', 'lpf'];
  DSP.createEqNodes = function (ctx) {
    return {
      hpf: biquad(ctx, 'highpass'),
      ls: biquad(ctx, 'lowshelf'),
      p1: biquad(ctx, 'peaking'),
      p2: biquad(ctx, 'peaking'),
      p3: biquad(ctx, 'peaking'),
      hs: biquad(ctx, 'highshelf'),
      lpf: biquad(ctx, 'lowpass'),
    };
  };

  // Apply EQ settings to a node set. `immediate` writes .value directly (used for curve drawing).
  DSP.setEq = function (ctx, nodes, eq, immediate) {
    const sp = immediate ? (p, v) => { p.value = v; } : (p, v) => setParam(ctx, p, v);
    const on = eq.enabled;
    const nyq = ctx.sampleRate / 2 - 100;
    // Lowpass/highpass Q is a resonance value in dB; -3.01 dB gives a flat Butterworth response.
    sp(nodes.hpf.Q, -3.01);
    sp(nodes.lpf.Q, -3.01);
    sp(nodes.hpf.frequency, on && eq.hpf.on ? eq.hpf.freq : 10);
    sp(nodes.lpf.frequency, on && eq.lpf.on ? Math.min(eq.lpf.freq, nyq) : nyq);
    sp(nodes.ls.frequency, eq.ls.freq);
    sp(nodes.ls.gain, on ? eq.ls.gain : 0);
    for (const k of ['p1', 'p2', 'p3']) {
      sp(nodes[k].frequency, eq[k].freq);
      sp(nodes[k].Q, eq[k].q);
      sp(nodes[k].gain, on ? eq[k].gain : 0);
    }
    sp(nodes.hs.frequency, Math.min(eq.hs.freq, nyq));
    sp(nodes.hs.gain, on ? eq.hs.gain : 0);
  };

  /* ---------- Synthetic reverb impulse response (cached) ---------- */
  const irCache = new Map();
  DSP.impulse = function (ctx, decay) {
    decay = clamp(Math.round(decay * 10) / 10, 0.1, 10);
    const key = ctx.sampleRate + ':' + decay;
    if (irCache.has(key)) return irCache.get(key);
    const sr = ctx.sampleRate;
    const len = Math.max(1, Math.floor(sr * decay));
    const buf = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        // Exponential decay reaching -60 dB at `decay` seconds, with a tiny fade-in to avoid clicks.
        const env = Math.exp((-6.9 * t) / decay) * Math.min(1, t / 0.004);
        d[i] = (Math.random() * 2 - 1) * env;
      }
    }
    irCache.set(key, buf);
    return buf;
  };

  /* ---------- Channel strip ----------
   * input -> EQ -> compressor -> makeup -> pan -> volume -> mute -> dest
   *                                                           |-> reverb send -> pre-delay -> convolver -> tone -> dest
   *                                                           |-> delay send  -> delay <-> (tone -> feedback) -> dest
   */
  class Channel {
    constructor(ctx, dest) {
      this.ctx = ctx;
      this.input = ctx.createGain();
      this.eq = DSP.createEqNodes(ctx);
      this.comp = ctx.createDynamicsCompressor();
      this.makeup = ctx.createGain();
      this.panner = ctx.createStereoPanner();
      this.volume = ctx.createGain();
      this.mute = ctx.createGain();
      this.meter = ctx.createAnalyser();
      this.meter.fftSize = 1024;
      this.meterBuf = new Float32Array(this.meter.fftSize);

      let node = this.input;
      for (const k of DSP.EQ_KEYS) { node.connect(this.eq[k]); node = this.eq[k]; }
      node.connect(this.comp);
      this.comp.connect(this.makeup);
      this.makeup.connect(this.panner);
      this.panner.connect(this.volume);
      this.volume.connect(this.mute);
      this.mute.connect(dest);
      this.mute.connect(this.meter);

      // Reverb send (post-fader)
      this.revSend = ctx.createGain();
      this.revSend.gain.value = 0;
      this.preDelay = ctx.createDelay(1);
      this.convolver = ctx.createConvolver();
      this.revTone = biquad(ctx, 'lowpass');
      this.mute.connect(this.revSend);
      this.revSend.connect(this.preDelay);
      this.preDelay.connect(this.convolver);
      this.convolver.connect(this.revTone);
      this.revTone.connect(dest);
      this.irKey = null;

      // Delay send (post-fader) with filtered feedback loop
      this.dlySend = ctx.createGain();
      this.dlySend.gain.value = 0;
      this.delay = ctx.createDelay(2.5);
      this.dlyTone = biquad(ctx, 'lowpass');
      this.dlyFb = ctx.createGain();
      this.mute.connect(this.dlySend);
      this.dlySend.connect(this.delay);
      this.delay.connect(this.dlyTone);
      this.dlyTone.connect(this.dlyFb);
      this.dlyFb.connect(this.delay);
      this.dlyTone.connect(dest);
    }

    // Push all mix parameters of a track into the audio graph.
    apply(p, bpm) {
      const ctx = this.ctx;
      const sp = (param, v) => setParam(ctx, param, v);
      const nyq = ctx.sampleRate / 2 - 100;

      DSP.setEq(ctx, this.eq, p.eq, false);

      const c = p.comp;
      sp(this.comp.threshold, c.enabled ? c.threshold : 0);
      sp(this.comp.ratio, c.enabled ? c.ratio : 1);
      sp(this.comp.knee, c.knee);
      sp(this.comp.attack, clamp(c.attack / 1000, 0, 1));
      sp(this.comp.release, clamp(c.release / 1000, 0, 1));
      sp(this.makeup.gain, c.enabled ? DSP.dbToGain(c.makeup) : 1);

      sp(this.panner.pan, clamp(p.pan, -1, 1));
      sp(this.volume.gain, DSP.dbToGain(p.volumeDb));

      const rv = p.reverb;
      const rvOn = rv.enabled && rv.send > 0;
      if (rvOn) {
        const key = Math.round(rv.decay * 10);
        if (this.irKey !== key) {
          this.convolver.buffer = DSP.impulse(ctx, rv.decay);
          this.irKey = key;
        }
      }
      sp(this.revSend.gain, rvOn ? rv.send : 0);
      sp(this.preDelay.delayTime, clamp(rv.preDelay / 1000, 0, 0.99));
      sp(this.revTone.frequency, Math.min(rv.tone, nyq));

      const d = p.delay;
      sp(this.dlySend.gain, d.enabled ? d.send : 0);
      sp(this.delay.delayTime, DSP.delaySeconds(d, bpm));
      sp(this.dlyFb.gain, clamp(d.feedback, 0, 0.95));
      sp(this.dlyTone.frequency, Math.min(d.tone, nyq));
    }

    setAudible(on) {
      setParam(this.ctx, this.mute.gain, on ? 1 : 0);
    }

    // Current peak level (linear) of the channel output.
    peak() {
      this.meter.getFloatTimeDomainData(this.meterBuf);
      let m = 0;
      for (let i = 0; i < this.meterBuf.length; i++) {
        const a = Math.abs(this.meterBuf[i]);
        if (a > m) m = a;
      }
      return m;
    }

    disconnect() {
      for (const n of [this.input, this.mute, this.revTone, this.dlyTone]) {
        try { n.disconnect(); } catch (e) { /* already disconnected */ }
      }
    }
  }
  DSP.Channel = Channel;

  /* ---------- Master bus: input -> limiter -> volume -> destination ---------- */
  class Master {
    constructor(ctx) {
      this.ctx = ctx;
      this.input = ctx.createGain();
      this.limiter = ctx.createDynamicsCompressor();
      this.volume = ctx.createGain();
      this.input.connect(this.limiter);
      this.limiter.connect(this.volume);
      this.volume.connect(ctx.destination);
      if (!isOffline(ctx)) {
        const split = ctx.createChannelSplitter(2);
        this.volume.connect(split);
        this.meters = [ctx.createAnalyser(), ctx.createAnalyser()];
        this.meters.forEach((a, i) => { a.fftSize = 1024; split.connect(a, i); });
        this.buf = new Float32Array(1024);
      }
    }

    apply({ volumeDb, limiter }) {
      const sp = (param, v) => setParam(this.ctx, param, v);
      sp(this.volume.gain, DSP.dbToGain(volumeDb));
      sp(this.limiter.threshold, limiter ? -1.5 : 0);
      sp(this.limiter.ratio, limiter ? 20 : 1);
      sp(this.limiter.knee, 0);
      sp(this.limiter.attack, 0.002);
      sp(this.limiter.release, 0.08);
    }

    peaks() {
      return this.meters.map(a => {
        a.getFloatTimeDomainData(this.buf);
        let m = 0;
        for (let i = 0; i < this.buf.length; i++) { const v = Math.abs(this.buf[i]); if (v > m) m = v; }
        return m;
      });
    }
  }
  DSP.Master = Master;

  /* ---------- Clip scheduling (shared by live playback and offline export) ----------
   * clip: { buffer, offset, trimStart, trimEnd, fadeIn, fadeOut, clipGainDb }
   * when: context time that corresponds to timeline position `fromPos`.
   */
  DSP.scheduleClip = function (ctx, clip, dest, when, fromPos) {
    const len = clip.trimEnd - clip.trimStart;
    if (!clip.buffer || len <= 0) return null;
    const start = clip.offset;
    const end = start + len;
    if (fromPos >= end) return null;

    const tl0 = Math.max(fromPos, start);
    const at = tl => when + (tl - fromPos);
    const base = DSP.dbToGain(clip.clipGainDb || 0);
    const fi = Math.max(0, clip.fadeIn || 0);
    const fo = Math.max(0, clip.fadeOut || 0);
    const env = tl => {
      let f = 1;
      if (fi > 0 && tl - start < fi) f = Math.min(f, (tl - start) / fi);
      if (fo > 0 && end - tl < fo) f = Math.min(f, (end - tl) / fo);
      return base * Math.max(0, f);
    };

    const src = ctx.createBufferSource();
    src.buffer = clip.buffer;
    const g = ctx.createGain();
    src.connect(g);
    g.connect(dest);

    // Fade envelope (fades are pre-clamped so fadeIn + fadeOut <= clip length).
    g.gain.setValueAtTime(env(tl0), at(tl0));
    const fiEnd = start + fi;
    const foStart = end - fo;
    if (fi > 0 && tl0 < fiEnd) g.gain.linearRampToValueAtTime(base, at(fiEnd));
    if (fo > 0) {
      if (tl0 < foStart) g.gain.setValueAtTime(base, at(foStart));
      g.gain.linearRampToValueAtTime(0, at(end));
    }

    src.start(at(tl0), clip.trimStart + (tl0 - start), end - tl0);
    return { src, gain: g };
  };

  /* ---------- Buffer analysis & utilities ---------- */

  // Min/max peak pairs per block of samples, merged across channels (for waveform drawing).
  DSP.computePeaks = function (buffer, block) {
    const n = Math.ceil(buffer.length / block);
    const out = new Float32Array(n * 2);
    const chs = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) chs.push(buffer.getChannelData(c));
    for (let b = 0; b < n; b++) {
      let mn = 0, mx = 0;
      const s0 = b * block, s1 = Math.min(buffer.length, s0 + block);
      for (const d of chs) {
        for (let i = s0; i < s1; i++) {
          const v = d[i];
          if (v < mn) mn = v; else if (v > mx) mx = v;
        }
      }
      out[2 * b] = mn;
      out[2 * b + 1] = mx;
    }
    return out;
  };

  // Average RMS loudness (dBFS) of non-silent 50 ms windows in [t0, t1]; null if silent.
  DSP.loudness = function (buffer, t0, t1) {
    const sr = buffer.sampleRate;
    const i0 = Math.max(0, Math.floor(t0 * sr));
    const i1 = Math.min(buffer.length, Math.floor(t1 * sr));
    const win = Math.max(1, Math.floor(sr * 0.05));
    const chs = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) chs.push(buffer.getChannelData(c));
    let sum = 0, cnt = 0;
    for (let s = i0; s < i1; s += win) {
      const e = Math.min(i1, s + win);
      let acc = 0, k = 0;
      for (const d of chs) {
        for (let i = s; i < e; i += 2) { acc += d[i] * d[i]; k++; }
      }
      const ms = acc / Math.max(1, k);
      if (ms > 1e-6) { sum += ms; cnt++; } // ignore windows below -60 dBFS
    }
    return cnt ? 10 * Math.log10(sum / cnt) : null;
  };

  // Sample peak (dBFS) inside [t0, t1].
  DSP.peakDb = function (buffer, t0, t1) {
    const sr = buffer.sampleRate;
    const i0 = Math.max(0, Math.floor(t0 * sr));
    const i1 = Math.min(buffer.length, Math.floor(t1 * sr));
    let m = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const d = buffer.getChannelData(c);
      for (let i = i0; i < i1; i++) { const a = Math.abs(d[i]); if (a > m) m = a; }
    }
    return m > 0 ? DSP.gainToDb(m) : -Infinity;
  };

  // Return a reversed copy of a buffer (original stays untouched because buffers may be shared).
  DSP.reversed = function (ctx, buffer) {
    const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const src = buffer.getChannelData(c);
      const dst = out.getChannelData(c);
      for (let i = 0, n = src.length; i < n; i++) dst[i] = src[n - 1 - i];
    }
    return out;
  };

  /* ---------- Non-destructive buffer editing helpers (always return new buffers) ---------- */

  // Copy samples [s0, s1) into a new buffer.
  DSP.sliceBuffer = function (ctx, buffer, s0, s1) {
    s0 = clamp(Math.round(s0), 0, buffer.length);
    s1 = clamp(Math.round(s1), s0 + 1, Math.max(s0 + 1, buffer.length));
    const out = ctx.createBuffer(buffer.numberOfChannels, s1 - s0, buffer.sampleRate);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      out.getChannelData(c).set(buffer.getChannelData(c).subarray(s0, Math.min(s1, buffer.length)));
    }
    return out;
  };

  /*
   * Build a new buffer of `length` samples from parts [{ buffer, at }] (later parts overwrite earlier ones)
   * and silent ranges [[s0, s1], ...]. Mono parts are copied to every output channel.
   */
  DSP.composeBuffer = function (ctx, length, sampleRate, parts, silences) {
    const nch = Math.max(1, ...parts.map(p => p.buffer.numberOfChannels));
    const out = ctx.createBuffer(nch, Math.max(1, Math.round(length)), sampleRate);
    for (const { buffer, at } of parts) {
      const start = Math.round(at);
      for (let c = 0; c < nch; c++) {
        const src = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1));
        const dst = out.getChannelData(c);
        const from = Math.max(0, -start);
        const to = Math.min(src.length, dst.length - start);
        if (to > from) dst.set(src.subarray(from, to), start + from);
      }
    }
    for (const [s0, s1] of silences || []) {
      for (let c = 0; c < nch; c++) out.getChannelData(c).fill(0, clamp(Math.round(s0), 0, out.length), clamp(Math.round(s1), 0, out.length));
    }
    return out;
  };

  // Encode an AudioBuffer as a 16-bit PCM WAV blob.
  DSP.encodeWav = function (buffer) {
    const nch = buffer.numberOfChannels, sr = buffer.sampleRate, n = buffer.length;
    const bytes = n * nch * 2;
    const ab = new ArrayBuffer(44 + bytes);
    const v = new DataView(ab);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); ws(8, 'WAVE');
    ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nch, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * nch * 2, true); v.setUint16(32, nch * 2, true); v.setUint16(34, 16, true);
    ws(36, 'data'); v.setUint32(40, bytes, true);
    const chs = [];
    for (let c = 0; c < nch; c++) chs.push(buffer.getChannelData(c));
    let o = 44;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < nch; c++) {
        const s = clamp(chs[c][i], -1, 1);
        v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        o += 2;
      }
    }
    return new Blob([ab], { type: 'audio/wav' });
  };

  global.DSP = DSP;
})(window);
