/* Sampler utilities for user-uploaded instrument sounds:
 * root-note detection (from the file name or by pitch analysis), drum-pad guessing,
 * leading-silence trimming and note-name formatting.
 */
(function (global) {
  'use strict';

  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  const noteName = p => NAMES[((p % 12) + 12) % 12] + (Math.floor(p / 12) - 1);

  // Parse "C4", "c#3", "Db5", "F#-1" -> MIDI number (C4 = 60), or null.
  function parseNoteName(s) {
    const m = /^\s*([A-Ga-g])\s*(#|♯|b|♭|s)?\s*(-?\d)\s*$/.exec(String(s));
    if (!m) return null;
    let p = SEMI[m[1].toUpperCase()] + (Number(m[3]) + 1) * 12;
    if (m[2] === '#' || m[2] === '♯' || m[2] === 's') p += 1;
    if (m[2] === 'b' || m[2] === '♭') p -= 1;
    return p >= 0 && p <= 127 ? p : null;
  }

  // Find a root note in a file name: note names like "C4", "A#3", "Db5", or a MIDI number 21-108.
  function rootFromFileName(fileName) {
    const base = String(fileName).replace(/\.[^.]+$/, '');
    // Note name delimited by start/end or non-letters, e.g. "Piano_C4", "piano-A#3-soft".
    const re = /(?:^|[^A-Za-z])([A-Ga-g])(#|s|b)?(-?\d)(?![0-9])/g;
    let m, found = null;
    while ((m = re.exec(base))) found = parseNoteName(m[1] + (m[2] || '') + m[3]);
    if (found != null) return found;
    const num = /(?:^|\D)(\d{2,3})(?:\D|$)/.exec(base);
    if (num) {
      const n = Number(num[1]);
      if (n >= 21 && n <= 108) return n;
    }
    return null;
  }

  // Seconds of near-silence at the start of a buffer (so notes start on time).
  function leadingSilence(buffer) {
    const d = buffer.getChannelData(0);
    const lim = Math.min(d.length, Math.floor(buffer.sampleRate * 2));
    for (let i = 0; i < lim; i++) {
      if (Math.abs(d[i]) > 0.003) return Math.max(0, i - Math.floor(buffer.sampleRate * 0.002)) / buffer.sampleRate;
    }
    return 0;
  }

  /*
   * Estimate the pitch of a single-note sample with normalized autocorrelation.
   * Returns a MIDI note number, or null if no clear pitch was found.
   */
  function detectPitch(buffer, startSec = 0) {
    const sr = buffer.sampleRate;
    const chs = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) chs.push(buffer.getChannelData(c));
    const from = Math.floor((startSec + 0.08) * sr); // skip the attack transient
    const N = Math.min(8192, buffer.length - from);
    if (N < 2048) return null;
    const x = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let v = 0;
      for (const d of chs) v += d[from + i];
      x[i] = v / chs.length;
    }
    const minLag = Math.max(2, Math.floor(sr / 2000));
    const maxLag = Math.min(Math.floor(sr / 30), Math.floor(N / 2));
    const r = new Float32Array(maxLag + 2);
    let maxR = 0;
    for (let lag = minLag; lag <= maxLag + 1; lag++) {
      let num = 0, e1 = 0, e2 = 0;
      for (let i = 0; i + lag < N; i++) {
        num += x[i] * x[i + lag];
        e1 += x[i] * x[i];
        e2 += x[i + lag] * x[i + lag];
      }
      r[lag] = e1 && e2 ? num / Math.sqrt(e1 * e2) : 0;
      if (lag <= maxLag && r[lag] > maxR) maxR = r[lag];
    }
    if (maxR < 0.6) return null;
    // The first peak close to the maximum avoids picking a lower octave.
    let lag = 0;
    for (let l = minLag + 1; l < maxLag; l++) {
      if (r[l] >= 0.9 * maxR && r[l] >= r[l - 1] && r[l] >= r[l + 1]) { lag = l; break; }
    }
    if (!lag) return null;
    const a = r[lag - 1], b = r[lag], c = r[lag + 1];
    const shift = (a - c) / (2 * (a - 2 * b + c) || 1); // parabolic interpolation
    const f = sr / (lag + (Number.isFinite(shift) ? shift : 0));
    const midi = Math.round(69 + 12 * Math.log2(f / 440));
    return midi >= 12 && midi <= 120 ? midi : null;
  }

  // Guess the drum pad (General MIDI note) from a file name.
  const DRUM_PATTERNS = [
    [46, /open\s*-?\s*h(i-?)?h?at|\boh\b|openhat|開放/i],
    [42, /h(i-?)?h(at)?|\bhh\b|\bch\b|closed|腳踏/i],
    [49, /crash|碎音/i],
    [51, /ride|疊音/i],
    [39, /clap|拍手/i],
    [36, /kick|\bbd\b|bass\s*drum|\bkik\b|大鼓/i],
    [38, /snare|\bsd\b|\bsn\b|rim|小鼓/i],
    [43, /floor|low\s*tom|tom\s*(3|low)|落地/i],
    [50, /(hi|high)\s*tom|tom\s*(1|hi|high)/i],
    [47, /tom|筒鼓/i],
  ];
  function guessDrumPad(fileName) {
    for (const [p, re] of DRUM_PATTERNS) if (re.test(fileName)) return p;
    return null;
  }

  global.SamplerUtil = { noteName, parseNoteName, rootFromFileName, leadingSilence, detectPitch, guessDrumPad };
})(window);
