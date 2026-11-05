/* Note synthesizer for instrument tracks.
 * Every instrument is built from Web Audio nodes, so it works for live playback
 * and for offline rendering (WAV export). Notes use MIDI pitch numbers and velocity 1-127.
 */
(function (global) {
  'use strict';

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const mtof = p => 440 * Math.pow(2, (p - 69) / 12);

  const INSTRUMENTS = {
    piano: { role: 'piano', name: { en: 'Piano', zh: '鋼琴' } },
    epiano: { role: 'piano', name: { en: 'Electric piano', zh: '電鋼琴' } },
    organ: { role: 'piano', name: { en: 'Organ', zh: '風琴' } },
    guitar: { role: 'acousticGuitar', name: { en: 'Plucked guitar', zh: '撥弦吉他' } },
    bass: { role: 'bass', name: { en: 'Electric bass', zh: '電貝斯' } },
    synthBass: { role: 'bass', name: { en: 'Synth bass', zh: '合成器貝斯' } },
    synthLead: { role: 'synth', name: { en: 'Synth lead', zh: '合成器 Lead' } },
    synthPad: { role: 'synth', name: { en: 'Synth pad', zh: '合成器 Pad' } },
    strings: { role: 'synth', name: { en: 'Strings', zh: '弦樂' } },
    drums: { role: 'drums', drum: true, name: { en: 'Drum kit', zh: '鼓組' } },
    // User-uploaded samples (track.sampler.zones); fall back to piano / drum kit while empty.
    sampler: { role: 'other', custom: true, fallback: 'piano', name: { en: 'Custom sound (upload samples)', zh: '自訂音色（上傳取樣）' } },
    drumSampler: { role: 'drums', drum: true, custom: true, fallback: 'drums', name: { en: 'Custom drum kit (upload samples)', zh: '自訂鼓組（上傳取樣）' } },
  };

  // Drum rows shown in the editor (top to bottom), General MIDI note numbers.
  const DRUM_KIT = [
    { p: 49, key: 'crash' },
    { p: 51, key: 'ride' },
    { p: 46, key: 'openHat' },
    { p: 42, key: 'closedHat' },
    { p: 50, key: 'highTom' },
    { p: 47, key: 'midTom' },
    { p: 43, key: 'floorTom' },
    { p: 39, key: 'clap' },
    { p: 38, key: 'snare' },
    { p: 36, key: 'kick' },
  ];

  /*
   * Subtractive / additive instrument definitions.
   * oscs: [type, frequency ratio, gain, detune cents]
   * env: attack, decay (time to settle), sustain level, release (seconds)
   * filter: start/end cutoff as functions of (frequency, velocity 0..1), resonance, sweep time
   */
  const SPECS = {
    piano: {
      level: 0.9,
      oscs: [['triangle', 1, 1], ['sine', 2, 0.35], ['square', 1, 0.05]],
      env: { a: 0.003, d: 2.6, s: 0, r: 0.25 },
      filter: { start: (f, v) => f * (3 + v * 9), end: f => f * 2.5, q: 0.5, time: 0.4 },
    },
    epiano: {
      level: 0.95,
      oscs: [['sine', 1, 1], ['sine', 2, 0.22], ['sine', 7, 0.05]],
      env: { a: 0.002, d: 2.2, s: 0, r: 0.3 },
      tremolo: { rate: 4.5, depth: 0.15 },
    },
    organ: {
      level: 0.45,
      oscs: [['sine', 1, 1], ['sine', 2, 0.6], ['sine', 3, 0.35], ['sine', 4, 0.25], ['sine', 8, 0.1]],
      env: { a: 0.01, d: 0.1, s: 1, r: 0.06 },
    },
    bass: {
      level: 1.1,
      oscs: [['sine', 1, 1], ['triangle', 1, 0.5], ['sawtooth', 1, 0.12]],
      env: { a: 0.005, d: 0.6, s: 0.55, r: 0.07 },
      filter: { start: () => 1800, end: () => 650, q: 1, time: 0.15 },
    },
    synthBass: {
      level: 0.8,
      oscs: [['sawtooth', 1, 0.8], ['square', 0.5, 0.4]],
      env: { a: 0.003, d: 0.3, s: 0.6, r: 0.05 },
      filter: { start: (f, v) => f * (5 + v * 6), end: f => f * 1.6, q: 6, time: 0.08 },
    },
    synthLead: {
      level: 0.55,
      oscs: [['sawtooth', 1, 0.7, -6], ['square', 1, 0.4, 6]],
      env: { a: 0.01, d: 0.3, s: 0.8, r: 0.12 },
      filter: { start: f => f * 8, end: f => f * 5, q: 3, time: 0.2 },
      vibrato: { rate: 5.5, cents: 10, delay: 0.25 },
    },
    synthPad: {
      level: 0.45,
      oscs: [['sawtooth', 1, 0.5, -10], ['sawtooth', 1, 0.5, 10], ['sawtooth', 0.5, 0.3, 0]],
      env: { a: 0.5, d: 1, s: 0.8, r: 0.9 },
      filter: { start: () => 1800, end: () => 1800, q: 1, time: 0.5 },
    },
    strings: {
      level: 0.5,
      oscs: [['sawtooth', 1, 0.6, -7], ['sawtooth', 1, 0.6, 7]],
      env: { a: 0.18, d: 0.5, s: 0.9, r: 0.45 },
      filter: { start: f => Math.max(3000, f * 4), end: f => Math.max(3000, f * 4), q: 0.7, time: 0.3 },
      vibrato: { rate: 5.5, cents: 12, delay: 0.3 },
    },
  };

  /* ---------- Shared buffers (cached per sample rate; AudioBuffers work in any context) ---------- */
  const noiseCache = new Map();
  function noiseBuffer(ctx) {
    const sr = ctx.sampleRate;
    if (!noiseCache.has(sr)) {
      const b = ctx.createBuffer(1, sr * 2, sr);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      noiseCache.set(sr, b);
    }
    return noiseCache.get(sr);
  }

  // Karplus-Strong plucked string, pre-rendered once per pitch.
  const pluckCache = new Map();
  function pluckBuffer(ctx, p) {
    const sr = ctx.sampleRate;
    const key = sr + ':' + p;
    if (pluckCache.has(key)) return pluckCache.get(key);
    const N = Math.max(2, Math.round(sr / mtof(p)));
    const len = Math.floor(sr * 2.5);
    const b = ctx.createBuffer(1, len, sr);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < N; i++) {
      last += 0.5 * (Math.random() * 2 - 1 - last); // slightly low-passed excitation
      d[i] = last;
    }
    const decay = clamp(0.997 - Math.max(0, p - 52) * 0.00025, 0.985, 0.998);
    for (let i = N; i < len; i++) d[i] = decay * 0.5 * (d[i - N] + (i - N - 1 >= 0 ? d[i - N - 1] : d[i - N]));
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
    if (peak > 0) for (let i = 0; i < len; i++) d[i] /= peak;
    pluckCache.set(key, b);
    return b;
  }

  /* ---------- Voice builders: each returns { sources, end } ---------- */
  function subtractive(ctx, out, s, f, vel01, when, dur) {
    const env = ctx.createGain();
    env.gain.value = 0;
    let head = env;
    if (s.filter) {
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.Q.value = s.filter.q || 0.7;
      const f0 = Math.min(18000, s.filter.start(f, vel01));
      const f1 = Math.min(18000, s.filter.end(f, vel01));
      filt.frequency.setValueAtTime(f0, when);
      if (f1 !== f0) filt.frequency.setTargetAtTime(f1, when, s.filter.time);
      filt.connect(env);
      head = filt;
    }
    env.connect(out);

    const { a, d, s: sus, r } = s.env;
    const g = env.gain;
    g.setValueAtTime(0, when);
    g.linearRampToValueAtTime(1, when + a);
    g.setTargetAtTime(sus, when + a, d / 3);
    const rel = when + Math.max(dur, a);
    g.setTargetAtTime(0, rel, r / 3);
    const end = rel + r * 1.6 + 0.02;

    const sources = [];
    let vib = null;
    if (s.vibrato) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = s.vibrato.rate;
      vib = ctx.createGain();
      vib.gain.setValueAtTime(0, when);
      vib.gain.linearRampToValueAtTime(f * (Math.pow(2, s.vibrato.cents / 1200) - 1), when + s.vibrato.delay);
      lfo.connect(vib);
      lfo.start(when);
      lfo.stop(end);
      sources.push(lfo);
    }
    if (s.tremolo) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = s.tremolo.rate;
      const depth = ctx.createGain();
      depth.gain.value = s.tremolo.depth * out.gain.value; // relative to the voice level
      lfo.connect(depth);
      depth.connect(out.gain);
      lfo.start(when);
      lfo.stop(end);
      sources.push(lfo);
    }
    for (const [type, ratio, gain, detune] of s.oscs) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * ratio;
      if (detune) o.detune.value = detune;
      if (vib) vib.connect(o.frequency);
      const og = ctx.createGain();
      og.gain.value = gain;
      o.connect(og);
      og.connect(head);
      o.start(when);
      o.stop(end);
      sources.push(o);
    }
    return { sources, end };
  }

  function pluck(ctx, out, p, vel01, when, dur) {
    const src = ctx.createBufferSource();
    src.buffer = pluckBuffer(ctx, p);
    const lp = ctx.createBiquadFilter();
    lp.frequency.value = 1800 + vel01 * 7000;
    const env = ctx.createGain();
    env.gain.setValueAtTime(1, when);
    const rel = when + Math.max(dur, 0.05);
    env.gain.setTargetAtTime(0, rel, 0.05);
    src.connect(lp);
    lp.connect(env);
    env.connect(out);
    const end = Math.min(rel + 0.3, when + src.buffer.duration);
    src.start(when);
    src.stop(end);
    return { sources: [src], end };
  }

  function drum(ctx, out, p, when) {
    const sources = [];
    const env = (node, peak, decay) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(peak, when);
      g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
      node.connect(g);
      g.connect(out);
    };
    const noise = (type, freq, q, peak, decay) => {
      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer(ctx);
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      if (q) f.Q.value = q;
      n.connect(f);
      env(f, peak, decay);
      n.start(when);
      n.stop(when + decay + 0.05);
      sources.push(n);
      return decay;
    };
    const tone = (type, f0, f1, sweep, peak, decay) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, when);
      o.frequency.exponentialRampToValueAtTime(f1, when + sweep);
      env(o, peak, decay);
      o.start(when);
      o.stop(when + decay + 0.05);
      sources.push(o);
      return decay;
    };
    const tom = f => tone('sine', f * 1.6, f, 0.08, 1.6, 0.45);
    let len;
    switch (p) {
      case 35: case 36: len = Math.max(tone('sine', 160, 45, 0.12, 2.4, 0.5), noise('lowpass', 3000, 0, 0.3, 0.02)); break;
      case 38: case 40: len = Math.max(tone('triangle', 200, 160, 0.05, 1.0, 0.15), noise('highpass', 1200, 0, 1.0, 0.22)); break;
      case 39: len = noise('bandpass', 1200, 0.7, 1.8, 0.18); break;
      case 42: case 44: len = noise('highpass', 7000, 0, 0.7, 0.06); break;
      case 46: len = noise('highpass', 6500, 0, 0.6, 0.4); break;
      case 49: case 57: len = noise('highpass', 4500, 0, 0.6, 1.6); break;
      case 51: case 59: len = noise('bandpass', 8000, 1.5, 0.9, 0.9); break;
      case 41: case 43: len = tom(100); break;
      case 45: case 47: len = tom(140); break;
      case 48: case 50: len = tom(190); break;
      default: len = tone('sine', mtof(p), mtof(p) * 0.8, 0.05, 0.8, 0.2);
    }
    return { sources, end: when + len + 0.05 };
  }

  /* ---------- Sampler (user-uploaded sounds) ---------- */

  // Melodic: nearest root note. Drums: exact pad only.
  function pickZone(sampler, p, drum) {
    const zones = sampler && Array.isArray(sampler.zones) ? sampler.zones.filter(z => z.buffer) : [];
    if (!zones.length) return null;
    if (drum) return zones.find(z => z.root === p) || null;
    let best = zones[0];
    for (const z of zones) if (Math.abs(z.root - p) < Math.abs(best.root - p)) best = z;
    return best;
  }

  function sampled(ctx, out, s, z, p, when, dur, drum) {
    const src = ctx.createBufferSource();
    src.buffer = z.buffer;
    const rate = drum ? 1 : Math.pow(2, (p - z.root) / 12); // pitch-shift by playback rate
    src.playbackRate.value = rate;
    const env = ctx.createGain();
    const a = Math.max(0.001, (s.attack || 0) / 1000);
    const r = Math.max(0.01, (s.release || 250) / 1000);
    const offset = Math.min(z.start || 0, Math.max(0, z.buffer.duration - 0.01));
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(1, when + a);
    const sampleEnd = when + (z.buffer.duration - offset) / rate;
    let end = sampleEnd;
    if (!drum && !s.oneShot) {
      // Release when the note ends (otherwise the whole sample plays).
      const rel = when + Math.max(dur, a);
      env.gain.setTargetAtTime(0, rel, r / 3);
      end = Math.min(sampleEnd, rel + r * 1.6 + 0.02);
    }
    src.connect(env);
    env.connect(out);
    src.start(when, offset);
    src.stop(end);
    return { sources: [src], end };
  }

  /*
   * Play one note. Returns a voice handle { end, stop() }.
   * dest: node to connect to (normally the track's channel input).
   * sampler: the track's uploaded samples, used by the custom instruments.
   */
  function play(ctx, dest, instrument, pitch, velocity, when, dur, sampler) {
    let id = INSTRUMENTS[instrument] ? instrument : 'piano';
    when = Math.max(when, ctx.currentTime);
    const vel01 = clamp(velocity, 1, 127) / 127;
    const out = ctx.createGain();
    out.connect(dest);
    let r;
    if (INSTRUMENTS[id].custom) {
      const drum = !!INSTRUMENTS[id].drum;
      const zone = pickZone(sampler, pitch, drum);
      if (zone) {
        out.gain.value = 0.8 * Math.pow(vel01, 1.2) * Math.pow(10, (Number(sampler.gainDb) || 0) / 20);
        r = sampled(ctx, out, sampler, zone, pitch, when, dur, drum);
      } else {
        id = INSTRUMENTS[id].fallback; // no sample for this note yet
      }
    }
    if (r) {
      // sampled voice already built
    } else if (INSTRUMENTS[id].drum) {
      out.gain.value = 0.3 * Math.pow(vel01, 1.2);
      r = drum(ctx, out, pitch, when);
    } else if (id === 'guitar') {
      out.gain.value = 0.32 * Math.pow(vel01, 1.3);
      r = pluck(ctx, out, pitch, vel01, when, dur);
    } else {
      const s = SPECS[id];
      out.gain.value = 0.25 * s.level * Math.pow(vel01, 1.3);
      r = subtractive(ctx, out, s, mtof(pitch), vel01, when, dur);
    }
    return {
      end: r.end,
      stop() {
        const t = ctx.currentTime;
        out.gain.cancelScheduledValues(t);
        out.gain.setTargetAtTime(0, t, 0.015);
        for (const s of r.sources) {
          try { s.stop(t + 0.1); } catch (e) { /* already stopped */ }
        }
      },
    };
  }

  global.Synth = {
    INSTRUMENTS,
    DRUM_KIT,
    mtof,
    play,
    isDrum: id => !!(INSTRUMENTS[id] && INSTRUMENTS[id].drum),
    isCustom: id => !!(INSTRUMENTS[id] && INSTRUMENTS[id].custom),
  };
})(window);
