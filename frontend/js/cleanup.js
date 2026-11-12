/* Recording clean-up: finds breaths and throat-clearing / coughs in a vocal take and turns them down.
 *
 * Analysis works on 30 ms frames every 10 ms:
 *   - level (RMS, dB)
 *   - periodicity (peak of the normalized autocorrelation over 75-900 Hz pitch lags):
 *     sung or spoken vowels are periodic, breaths and throat noise are not.
 * Non-periodic stretches that are loud enough, long enough and not glued to singing on both sides
 * (which would make them consonants such as "s" or "sh") become candidate regions:
 *   breath = clearly quieter than the voice, noise = about as loud as the voice (throat clearing, cough).
 *
 * Usage:
 *   const feats = await Cleanup.analyze(buffer, p => progress(p));
 *   const regions = Cleanup.detect(feats, sensitivity);       // fast, re-run when the slider moves
 *   const out = Cleanup.apply(ctx, buffer, regions.map(r => ({ ...r, gainDb: -20 })));
 */
(function (global) {
  'use strict';

  const HOP = 0.01; // s
  const WIN = 0.03; // s
  const PITCH_MIN = 75; // Hz
  const PITCH_MAX = 900; // Hz
  const VOICED = 0.6; // periodicity above which a frame counts as sung / spoken
  const NEAR_VOICE = 4; // frames (40 ms): a region this close to a voiced frame "touches" the voice

  const lerp = (a, b, k) => a + (b - a) * k;
  const db = x => 20 * Math.log10(x + 1e-9);

  function percentile(values, p) {
    if (!values.length) return -120;
    const s = Float32Array.from(values).sort();
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
  }

  function mono(buffer) {
    const n = buffer.length, ch = buffer.numberOfChannels;
    if (ch === 1) return buffer.getChannelData(0);
    const out = new Float32Array(n);
    for (let c = 0; c < ch; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < n; i++) out[i] += d[i];
    }
    for (let i = 0; i < n; i++) out[i] /= ch;
    return out;
  }

  // Box-filter downsample by `f` (good enough for pitch periodicity, ~4x faster).
  function downsample(x, f) {
    if (f <= 1) return x;
    const out = new Float32Array(Math.floor(x.length / f));
    for (let i = 0, j = 0; i < out.length; i++, j += f) {
      let s = 0;
      for (let k = 0; k < f; k++) s += x[j + k];
      out[i] = s / f;
    }
    return out;
  }

  // Peak normalized autocorrelation of x[a, a+w) over lags [l0, l1].
  function periodicity(x, a, w, l0, l1) {
    let best = 0;
    for (let lag = l0; lag <= l1; lag++) {
      const n = w - lag;
      if (n < l0) break;
      let xy = 0, xx = 0, yy = 0;
      for (let i = a, e = a + n; i < e; i++) {
        const u = x[i], v = x[i + lag];
        xy += u * v; xx += u * u; yy += v * v;
      }
      if (xx > 0 && yy > 0) {
        const r = xy / Math.sqrt(xx * yy);
        if (r > best) best = r;
      }
    }
    return best;
  }

  const yieldToUi = () => new Promise(r => setTimeout(r, 0));

  /** Frame features of an AudioBuffer. Async so the page stays responsive on long takes. */
  async function analyze(buffer, onProgress) {
    const sr = buffer.sampleRate;
    const x = mono(buffer);
    const hop = Math.round(sr * HOP), win = Math.round(sr * WIN);
    const frames = Math.max(0, Math.floor((x.length - win) / hop) + 1);

    // Level per frame from a running sum of squares.
    const cum = new Float64Array(x.length + 1);
    for (let i = 0; i < x.length; i++) cum[i + 1] = cum[i] + x[i] * x[i];
    const level = new Float32Array(frames);
    for (let f = 0; f < frames; f++) level[f] = db(Math.sqrt((cum[f * hop + win] - cum[f * hop]) / win));

    // Periodicity, skipping frames that are near silence.
    const floor = percentile(level, 0.1);
    const ds = Math.max(1, Math.round(sr / 11025));
    const y = downsample(x, ds);
    const sr2 = sr / ds, win2 = Math.floor(win / ds), hop2 = hop / ds;
    const l0 = Math.max(2, Math.floor(sr2 / PITCH_MAX)), l1 = Math.ceil(sr2 / PITCH_MIN);
    const period = new Float32Array(frames);
    const CHUNK = 1500;
    for (let f = 0; f < frames; f++) {
      if (level[f] > floor + 6 && level[f] > -70) {
        const a = Math.floor(f * hop2);
        if (a + win2 <= y.length) period[f] = periodicity(y, a, win2, l0, l1);
      }
      if (f % CHUNK === CHUNK - 1) {
        if (onProgress) onProgress(f / frames);
        await yieldToUi();
      }
    }
    if (onProgress) onProgress(1);
    return { sr, hop, win, frames, level, period, floor, duration: buffer.duration };
  }

  /**
   * Candidate regions for a sensitivity 0..1 (higher finds more, including quieter and shorter sounds).
   * Returns [{ t0, t1, kind: 'breath' | 'noise', levelDb (relative to the voice) }], times in seconds.
   */
  function detect(feats, sensitivity = 0.5) {
    const s = Math.max(0, Math.min(1, sensitivity));
    const { level, period, floor, frames, hop, win, sr } = feats;
    if (!frames) return [];

    const voiced = new Uint8Array(frames);
    const voicedLevels = [];
    for (let f = 0; f < frames; f++) {
      if (period[f] >= VOICED && level[f] > floor + 10) { voiced[f] = 1; voicedLevels.push(level[f]); }
    }
    // Voice reference level: loud voiced frames (or the loudest frames if there is hardly any singing).
    const ref = voicedLevels.length >= 30 ? percentile(voicedLevels, 0.9) : percentile(Array.from(level), 0.95);
    const active = f => level[f] > Math.max(floor + lerp(9, 5, s), ref - lerp(40, 52, s));

    const minDur = lerp(0.2, 0.09, s);
    const noiseAt = -lerp(9, 13, s); // relative level from which a sound counts as throat noise, not a breath
    const nearVoice = (f, dir) => {
      for (let k = 1; k <= NEAR_VOICE; k++) {
        const g = f + dir * k;
        if (g < 0 || g >= frames) return false;
        if (voiced[g]) return true;
      }
      return false;
    };

    const regions = [];
    let f = 0;
    while (f < frames) {
      if (voiced[f] || !active(f)) { f++; continue; }
      // Grow a run of non-voiced, active frames; allow short quiet gaps (up to 50 ms) inside it.
      let end = f, gap = 0, g = f + 1;
      for (; g < frames && !voiced[g]; g++) {
        if (active(g)) { end = g; gap = 0; } else if (++gap > 5) break;
      }
      const f0 = f, f1 = end;
      f = g;

      const dur = ((f1 - f0) * hop + win) / sr;
      if (dur < minDur || dur > 2.5) continue;
      const left = nearVoice(f0, -1), right = nearVoice(f1, 1);
      // Unvoiced sounds glued to singing are consonants ("s", "sh", "f", "t"...): leave them alone.
      if (left && right && dur < 0.4) continue;
      if ((left || right) && dur < lerp(0.28, 0.16, s)) continue;

      let peak = -Infinity;
      for (let k = f0; k <= f1; k++) if (level[k] > peak) peak = level[k];
      const rel = peak - ref;
      if (rel < -lerp(36, 50, s)) continue; // too quiet to matter

      // Region edges at frame centres, kept clear of the neighbouring voiced frames.
      const c0 = (f0 * hop + win / 2 - hop / 2) / sr;
      const c1 = (f1 * hop + win / 2 + hop / 2) / sr;
      regions.push({ t0: Math.max(0, c0), t1: Math.min(feats.duration, c1), kind: rel >= noiseAt ? 'noise' : 'breath', levelDb: rel });
    }
    return regions;
  }

  // Merge overlapping regions, keeping the strongest reduction.
  function merge(regions) {
    const list = regions.filter(r => r.t1 > r.t0).map(r => ({ t0: r.t0, t1: r.t1, gainDb: r.gainDb })).sort((a, b) => a.t0 - b.t0);
    const out = [];
    for (const r of list) {
      const last = out[out.length - 1];
      if (last && r.t0 <= last.t1) {
        last.t1 = Math.max(last.t1, r.t1);
        last.gainDb = Math.min(last.gainDb, r.gainDb);
      } else out.push(r);
    }
    return out;
  }

  /**
   * New AudioBuffer with each region turned down by `gainDb` (<= -60 means silence).
   * The gain ramps over `fadeMs` just inside each region so the surrounding voice is untouched.
   */
  function apply(ctx, buffer, regions, fadeMs = 15) {
    const sr = buffer.sampleRate, n = buffer.length, ch = buffer.numberOfChannels;
    const out = ctx.createBuffer(ch, n, sr);
    const list = merge(regions);
    for (let c = 0; c < ch; c++) {
      const src = buffer.getChannelData(c), dst = out.getChannelData(c);
      dst.set(src);
      for (const r of list) {
        const s0 = Math.max(0, Math.round(r.t0 * sr)), s1 = Math.min(n, Math.round(r.t1 * sr));
        if (s1 <= s0) continue;
        const g = r.gainDb <= -60 ? 0 : 10 ** (r.gainDb / 20);
        const fade = Math.max(1, Math.min(Math.round((fadeMs / 1000) * sr), Math.floor((s1 - s0) / 2)));
        for (let i = s0; i < s1; i++) {
          const edge = Math.min(i - s0, s1 - 1 - i);
          const k = edge >= fade ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * edge) / fade); // raised-cosine ramp
          dst[i] = src[i] * (1 - k * (1 - g));
        }
      }
    }
    return out;
  }

  global.Cleanup = { analyze, detect, apply };
})(window);
