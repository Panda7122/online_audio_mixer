/* Online Audio Mixer - application state, UI, transport, recording, editing, save/load and export. */
(function () {
  'use strict';

  const { clamp, dbToGain } = DSP;

  /* ---------- Constants ---------- */
  const ROLES = ['vocal', 'backing', 'kick', 'snare', 'drums', 'bass', 'acousticGuitar', 'electricGuitar', 'piano', 'synth', 'other'];
  const COLORS = ['#ff7a59', '#ffc145', '#5ad19a', '#4cc3ff', '#9b8cff', '#ff6fb5', '#7bdff2', '#f4a261', '#a3e635', '#f87171'];
  const PEAK_BLOCK = 256;
  const MIN_CLIP = 0.05;
  const EQ_RANGE = 18;
  const AUTO_MODULES = ['volume', 'pan', 'eq', 'comp', 'fx'];
  const EQ_BANDS = [
    { key: 'hpf', kind: 'pass', color: '#4cc3ff' },
    { key: 'ls', kind: 'shelf', color: '#5ad19a' },
    { key: 'p1', kind: 'peak', color: '#ffc145' },
    { key: 'p2', kind: 'peak', color: '#ff7a59' },
    { key: 'p3', kind: 'peak', color: '#ff6fb5' },
    { key: 'hs', kind: 'shelf', color: '#9b8cff' },
    { key: 'lpf', kind: 'pass', color: '#7bdff2' },
  ];
  const CLIP_KEYS = ['offset', 'trimStart', 'trimEnd', 'fadeIn', 'fadeOut', 'clipGainDb', 'reversed'];
  const MIX_KEYS = ['volumeDb', 'pan', 'mute', 'solo', 'eq', 'comp', 'reverb', 'delay', 'presetSel'];
  const TRACK_KEYS = ['name', 'role', 'color', 'kind', 'instrument', 'notes', 'sampler', 'fileName', 'audioId', ...CLIP_KEYS, ...MIX_KEYS];
  const MAX_NOTES = 50000;
  const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const STRIP_KEYS = ['volumeDb', 'pan', 'eq', 'comp', 'reverb', 'delay', 'presetSel'];
  const ROLE_PATTERNS = [
    ['backing', /back(ing)?\s*vo|bgv|harmon|choir|ad-?lib|和聲|合音/i],
    ['kick', /kick|bass\s*drum|\bbd\b|大鼓/i],
    ['snare', /snare|\bsn\b|小鼓/i],
    ['bass', /bass|808|\bsub\b|貝斯/i],
    ['acousticGuitar', /acoustic|ac\.?\s*gtr|木吉他|民謠吉他/i],
    ['electricGuitar', /gtr|guitar|電吉他|吉他/i],
    ['piano', /piano|keys|rhodes|organ|\bep\b|鋼琴|鍵盤|風琴/i],
    ['synth', /synth|pad|arp|pluck|合成/i],
    ['drums', /drum|kit|overhead|\boh\b|hat|cymbal|perc|loop|鼓/i],
    ['vocal', /vox|vocal|voice|\bvo\b|lead|sing|rap|人聲|主唱|唱|口白|旁白/i],
  ];

  /* ---------- Application state ---------- */
  const S = {
    ctx: null,
    master: null,
    eqScratch: null,
    tracks: [],
    selectedId: null,
    nextId: 1,
    bpm: 120,
    pps: 60, // timeline pixels per second
    snap: false,
    playing: false,
    startCtxTime: 0,
    startPos: 0,
    pos: 0,
    voices: [],
    recording: null,
    recCount: 0,
    genre: 'pop',
    panMode: 'genre',
    autoMods: { volume: true, pan: true, eq: true, comp: true, fx: true },
    masterVolumeDb: 0,
    limiter: true,
    server: null, // backend info when reachable, null in offline mode
    projectId: null,
    projectName: '',
    myPresets: [],
    separation: null, // backend separation capabilities
    sepJob: null, // running separation job
    sepTarget: null, // track chosen in the separation dialog
    sepOpts: { model: 'htdemucs', shifts: 1, stems: null, muteOriginal: true, autoMix: true },
    clean: null, // open clean-up dialog: { trackId, baked, feats, regions, progress }
    cleanOpts: { sens: 50, breathDb: -20, noiseDb: -60 }, // last used clean-up settings
    tool: 'move', // timeline tool: 'move' (move/trim clips) or 'range' (select audio ranges)
    sel: null, // { trackId, kind: 'notes', b0, b1 (beats) } or { trackId, kind: 'audio', t0, t1 (seconds) }
    selAnchor: 0,
    clipboard: null, // { kind: 'notes', len, notes } or { kind: 'audio', buffer }
    undo: [],
    redo: [],
    noteTimer: null,
    noteCursor: 0,
    noteEditor: null,
    trackCtrls: [],
    inspCtrls: [],
    eqCanvas: null,
    grBar: null,
    grVal: null,
    masterLevels: [0, 0],
  };

  /* ---------- Generic helpers ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const clone = o => JSON.parse(JSON.stringify(o));
  const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'value' || k === 'checked' || k === 'disabled') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : String(kid));
    }
    return el;
  }

  function parseNum(s) {
    s = String(s).trim().toLowerCase().replace(/hz|db|ms|s|%/g, '');
    const mult = s.endsWith('k') ? 1000 : 1;
    return parseFloat(s) * mult;
  }
  function parsePan(s) {
    s = String(s).trim().toUpperCase();
    if (s === 'C') return 0;
    if (s.startsWith('L')) return -parseFloat(s.slice(1));
    if (s.startsWith('R')) return parseFloat(s.slice(1));
    return parseFloat(s);
  }
  const fmtHz = v => (v >= 1000 ? round(v / 1000, 2) + 'k' : String(Math.round(v)));
  const fmtPan = v => (Math.abs(v) < 0.5 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v)));
  const fmtDb = v => (v > 0 ? '+' : '') + v.toFixed(1);
  const pad2 = n => String(n).padStart(2, '0');
  function fmtTime(t) {
    t = Math.max(0, t);
    const m = Math.floor(t / 60);
    return pad2(m) + ':' + (t - m * 60).toFixed(3).padStart(6, '0');
  }
  function fmtBars(t) {
    const beat = (Math.max(0, t) * S.bpm) / 60;
    return `${Math.floor(beat / 4) + 1}.${Math.floor(beat % 4) + 1}`;
  }

  let toastTimer;
  function toast(msg, ms = 2800) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  function download(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  const safeName = s => String(s || 'untitled').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);

  function pickFiles(input) {
    return new Promise(resolve => {
      input.value = '';
      input.onchange = () => resolve([...input.files]);
      input.click();
    });
  }

  function debounce(fn, ms) {
    let id;
    return (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); };
  }

  // Merge `src` onto a structure shaped like `def`, keeping only keys/types that `def` knows.
  function mergeShape(def, src) {
    if (!src || typeof src !== 'object') return clone(def);
    const out = {};
    for (const k of Object.keys(def)) {
      const d = def[k], v = src[k];
      if (d && typeof d === 'object') out[k] = mergeShape(d, v);
      else if (typeof v === typeof d && (typeof v !== 'number' || Number.isFinite(v))) out[k] = v;
      else out[k] = d;
    }
    return out;
  }

  /* ---------- Track model ---------- */
  function defaultMix() {
    return {
      volumeDb: 0,
      pan: 0,
      mute: false,
      solo: false,
      eq: clone(PRESETS.eqDefault),
      comp: clone(PRESETS.compDefault),
      reverb: clone(PRESETS.reverbDefault),
      delay: clone(PRESETS.delayDefault),
      presetSel: { eq: 'flat', comp: 'off', reverb: 'none', delay: 'none', volume: '', pan: '' },
    };
  }

  function createTrack(name, role, index, kind) {
    const id = S.nextId++;
    const tr = Object.assign({
      id,
      name: name || t('trackN', { n: id }),
      role: role || 'other',
      color: COLORS[(id - 1) % COLORS.length],
      buffer: null,
      peaks: null,
      fileName: '',
      offset: 0,
      trimStart: 0,
      trimEnd: 0,
      fadeIn: 0,
      fadeOut: 0,
      clipGainDb: 0,
      reversed: false,
      keepClip: false,
      source: null, // original File/Blob, uploaded when saving to the server
      audioId: null, // id of the audio on the server
      kind: kind === 'notes' ? 'notes' : 'audio', // 'audio' clip track or 'notes' instrument track
      instrument: 'piano',
      notes: [], // instrument tracks: { t: start beat, d: length in beats, p: MIDI pitch, v: velocity }
      sampler: defaultSampler(), // uploaded sounds for the custom instruments
      ui: {},
    }, defaultMix());
    tr.channel = new DSP.Channel(S.ctx, S.master.input);
    if (index == null) S.tracks.push(tr);
    else S.tracks.splice(index, 0, tr);
    applyChannel(tr);
    updateAudibility();
    return tr;
  }

  const selected = () => S.tracks.find(x => x.id === S.selectedId) || null;
  const clipLen = tr => Math.max(0, tr.trimEnd - tr.trimStart);
  const clipEnd = tr => tr.offset + clipLen(tr);

  function applyChannel(tr) { tr.channel.apply(tr, S.bpm); }

  function updateAudibility() {
    const anySolo = S.tracks.some(x => x.solo);
    for (const x of S.tracks) x.channel.setAudible(!x.mute && (!anySolo || x.solo));
  }

  function clampClip(tr) {
    if (tr.buffer) {
      const d = tr.buffer.duration;
      tr.trimStart = clamp(tr.trimStart, 0, Math.max(0, d - MIN_CLIP));
      tr.trimEnd = clamp(tr.trimEnd, tr.trimStart + MIN_CLIP, d);
    }
    tr.offset = Math.max(0, tr.offset);
    const len = clipLen(tr);
    tr.fadeIn = clamp(tr.fadeIn, 0, len);
    tr.fadeOut = clamp(tr.fadeOut, 0, len - tr.fadeIn);
  }

  function setTrackBuffer(tr, buffer, fileName) {
    const keep = tr.keepClip; // clip settings came from a loaded settings file
    tr.keepClip = false;
    if (keep && tr.reversed) buffer = DSP.reversed(S.ctx, buffer);
    if (!keep) {
      tr.reversed = false;
      tr.trimStart = 0;
      tr.trimEnd = buffer.duration;
      tr.fadeIn = tr.fadeOut = 0;
      tr.clipGainDb = 0;
    } else if (tr.trimEnd <= tr.trimStart || tr.trimEnd > buffer.duration + 1e-3) {
      tr.trimStart = 0;
      tr.trimEnd = buffer.duration;
    }
    tr.buffer = buffer;
    tr.peaks = DSP.computePeaks(buffer, PEAK_BLOCK);
    tr.loudCache = null;
    if (fileName) tr.fileName = fileName;
    clampClip(tr);
  }

  function detectRole(name) {
    for (const [role, re] of ROLE_PATTERNS) if (re.test(name)) return role;
    return 'other';
  }

  async function decodeFile(file) {
    const data = await file.arrayBuffer();
    return await S.ctx.decodeAudioData(data);
  }

  const isAudioFile = f => /^audio\//.test(f.type) || /\.(wav|mp3|ogg|oga|flac|m4a|aac|webm|opus)$/i.test(f.name);

  async function addAudioFiles(files) {
    files = files.filter(isAudioFile);
    if (!files.length) return;
    toast(t('loading'));
    let added = 0;
    for (const f of files) {
      try {
        const buf = await decodeFile(f);
        const name = f.name.replace(/\.[^.]+$/, '');
        const tr = createTrack(name, detectRole(name));
        setTrackBuffer(tr, buf, f.name);
        tr.source = f;
        S.selectedId = tr.id;
        added++;
      } catch (e) {
        console.error(e);
        toast(t('decodeFail', { name: f.name }));
      }
    }
    renderAll();
    if (added) toast(t('filesAdded', { n: added }));
  }

  async function loadAudioIntoTrack(tr) {
    const [f] = await pickFiles($('#fileOne'));
    if (!f) return;
    try {
      const buf = await decodeFile(f);
      if (S.playing) stopVoices(tr);
      setTrackBuffer(tr, buf, f.name);
      tr.source = f;
      tr.audioId = null;
      if (/^(Track|音軌) \d+$/.test(tr.name)) {
        tr.name = f.name.replace(/\.[^.]+$/, '');
        if (tr.role === 'other') tr.role = detectRole(tr.name);
      }
      renderAll();
      restartSoon();
    } catch (e) {
      console.error(e);
      toast(t('decodeFail', { name: f.name }));
    }
  }

  /* ---------- Track editing operations ---------- */
  function deleteTrack(tr) {
    if (!confirm(t('confirmDelete', { name: tr.name }))) return;
    if (S.recording && S.recording.target === tr) finishRecording();
    stopVoices(tr);
    tr.channel.disconnect();
    S.tracks.splice(S.tracks.indexOf(tr), 1);
    if (S.sel && S.sel.trackId === tr.id) setSelection(null);
    if (S.selectedId === tr.id) S.selectedId = S.tracks.length ? S.tracks[0].id : null;
    updateAudibility();
    renderAll();
  }

  function duplicateTrack(tr, nameSuffix) {
    const copy = createTrack(tr.name + nameSuffix, tr.role, S.tracks.indexOf(tr) + 1);
    for (const k of [...CLIP_KEYS, ...MIX_KEYS, 'fileName', 'kind', 'instrument', 'notes']) copy[k] = clone(tr[k]);
    copy.sampler = copySampler(tr.sampler);
    copy.buffer = tr.buffer; // buffers are never mutated, so sharing is safe
    copy.peaks = tr.peaks;
    copy.source = tr.source;
    copy.audioId = tr.audioId;
    applyChannel(copy);
    updateAudibility();
    return copy;
  }

  function normalizeTrack(tr) {
    if (!tr.buffer) return;
    const pk = DSP.peakDb(tr.buffer, tr.trimStart, tr.trimEnd);
    if (!Number.isFinite(pk)) return;
    pushUndo(t('normalize'), [tr]);
    tr.clipGainDb = round(clamp(-1 - pk, -24, 24), 2);
    afterClip(tr);
    toast(t('normalized', { db: fmtDb(tr.clipGainDb) }));
  }

  function reverseTrack(tr) {
    if (!tr.buffer) return;
    pushUndo(t('reverse'), [tr]);
    const d = tr.buffer.duration;
    tr.buffer = DSP.reversed(S.ctx, tr.buffer);
    tr.peaks = DSP.computePeaks(tr.buffer, PEAK_BLOCK);
    [tr.trimStart, tr.trimEnd] = [d - tr.trimEnd, d - tr.trimStart];
    [tr.fadeIn, tr.fadeOut] = [tr.fadeOut, tr.fadeIn];
    tr.reversed = !tr.reversed;
    if (S.playing) stopVoices(tr);
    afterClip(tr);
  }

  function splitTrack(tr) {
    const pos = position();
    if (!tr.buffer || pos <= tr.offset + MIN_CLIP || pos >= clipEnd(tr) - MIN_CLIP) {
      toast(t('splitOutside'));
      return;
    }
    const cut = tr.trimStart + (pos - tr.offset);
    const right = duplicateTrack(tr, t('partSuffix'));
    right.trimStart = cut;
    right.offset = pos;
    right.fadeIn = 0;
    tr.trimEnd = cut;
    tr.fadeOut = 0;
    clampClip(tr);
    clampClip(right);
    renderAll();
    restartSoon();
  }

  function moveTrack(tr, dir) {
    const i = S.tracks.indexOf(tr), j = i + dir;
    if (j < 0 || j >= S.tracks.length) return;
    [S.tracks[i], S.tracks[j]] = [S.tracks[j], S.tracks[i]];
    renderTimeline();
  }

  /* ---------- Auto mix / presets ---------- */
  const genreDef = () => PRESETS.genres[S.genre] || PRESETS.genres.pop;
  const roleTpl = role => genreDef().roles[role] || genreDef().roles.other;

  function trackLoudness(tr) {
    const key = `${tr.trimStart}|${tr.trimEnd}|${tr.buffer.length}|${tr.reversed}`;
    if (!tr.loudCache || tr.loudCache.key !== key) {
      tr.loudCache = { key, val: DSP.loudness(tr.buffer, tr.trimStart, tr.trimEnd) };
    }
    return tr.loudCache.val;
  }

  // Fader value that brings the track to the role's target loudness for the current genre.
  function autoLevel(tr) {
    const tpl = roleTpl(tr.role);
    if (!tr.buffer) return round(clamp(tpl.level + 18, -30, 12)); // assume a nominal -18 dBFS source
    const rms = trackLoudness(tr);
    if (rms == null) return 0;
    return round(clamp(tpl.level - (rms + tr.clipGainDb), -40, 12));
  }

  function autoPan(tr) {
    const tpl = roleTpl(tr.role);
    const mode = S.panMode;
    if (mode === 'mono') return 0;
    let s = tpl.spread || 0;
    if (!s) return tpl.pan || 0;
    if (mode === 'wide') s = Math.min(1, s + 0.3);
    if (mode === 'lcr') s = 1;
    const peers = S.tracks.filter(x => x.role === tr.role);
    const n = peers.length, i = peers.indexOf(tr);
    if (n <= 1) return 0;
    return round(-s + (2 * s * i) / (n - 1), 2);
  }

  // Apply a named preset of a module ('eq' | 'comp' | 'reverb' | 'delay' | 'volume' | 'pan').
  function applyPreset(tr, mod, id) {
    const p = PRESETS[mod][id];
    if (!p) return;
    if (mod === 'volume') tr.volumeDb = p.auto ? autoLevel(tr) : p.db;
    else if (mod === 'pan') tr.pan = p.auto ? autoPan(tr) : p.pan;
    else {
      const defaults = { eq: PRESETS.eqDefault, comp: PRESETS.compDefault, reverb: PRESETS.reverbDefault, delay: PRESETS.delayDefault }[mod];
      // "Off" presets only disable the module and keep the user's parameters.
      const base = p.data.enabled === false ? tr[mod] : defaults;
      tr[mod] = mergeShape(defaults, Object.assign(clone(base), clone(p.data)));
    }
    tr.presetSel[mod] = id;
  }

  // Automatically configure one module of a track from the current genre template.
  function autoModule(tr, mod) {
    const tpl = roleTpl(tr.role);
    switch (mod) {
      case 'volume': applyPreset(tr, 'volume', 'auto'); break;
      case 'pan': applyPreset(tr, 'pan', 'auto'); break;
      case 'eq': applyPreset(tr, 'eq', tpl.eq); break;
      case 'comp': applyPreset(tr, 'comp', tpl.comp); break;
      case 'reverb': applyPreset(tr, 'reverb', tpl.reverb); break;
      case 'delay': applyPreset(tr, 'delay', tpl.delay); break;
      case 'fx': applyPreset(tr, 'reverb', tpl.reverb); applyPreset(tr, 'delay', tpl.delay); break;
    }
  }

  function autoMixAll() {
    if (!S.tracks.length) { toast(t('noTracks')); return; }
    const mods = AUTO_MODULES.filter(m => S.autoMods[m]);
    if (!mods.length) { toast(t('noModules')); return; }
    // EQ/compression first so auto-level sees the final module set.
    for (const tr of S.tracks) {
      for (const m of ['eq', 'comp', 'fx', 'pan', 'volume']) if (mods.includes(m)) autoModule(tr, m);
      applyChannel(tr);
    }
    refreshCtrls();
    drawEqCurve();
    toast(t('autoMixDone', { genre: L(genreDef().name), n: S.tracks.length }));
  }

  function resetAll() {
    if (!S.tracks.length || !confirm(t('confirmReset'))) return;
    for (const tr of S.tracks) {
      Object.assign(tr, defaultMix());
      applyChannel(tr);
    }
    updateAudibility();
    refreshCtrls();
    drawEqCurve();
  }

  /* ---------- Transport ---------- */
  function position() {
    if (!S.playing) return S.pos;
    return Math.max(S.startPos, S.startPos + S.ctx.currentTime - S.startCtxTime);
  }

  const beatSec = () => 60 / S.bpm;
  const barSec = () => 4 * beatSec();
  const notesEnd = tr => tr.notes.reduce((m, n) => Math.max(m, (n.t + n.d) * beatSec()), 0);

  function projectEnd() {
    let end = 0;
    for (const tr of S.tracks) {
      if (tr.buffer) end = Math.max(end, clipEnd(tr));
      else if (tr.kind === 'notes' && tr.notes.length) end = Math.max(end, notesEnd(tr));
    }
    return end;
  }

  function startVoices(fromPos) {
    const when = S.ctx.currentTime + 0.06;
    S.startCtxTime = when;
    S.startPos = fromPos;
    S.voices = [];
    for (const tr of S.tracks) {
      if (!tr.buffer) continue;
      const v = DSP.scheduleClip(S.ctx, tr, tr.channel.input, when, fromPos);
      if (v) {
        S.voices.push({
          tr,
          end: Infinity,
          stop() {
            try { v.src.stop(); } catch (e) { /* not started yet */ }
            v.src.disconnect();
            v.gain.disconnect();
          },
        });
      }
    }
    // Instrument tracks are scheduled with a short look-ahead instead of all at once.
    S.noteCursor = fromPos;
    scheduleNotes(true);
    clearInterval(S.noteTimer);
    S.noteTimer = setInterval(() => scheduleNotes(false), 40);
  }

  function scheduleNotes(initial) {
    const now = S.ctx.currentTime;
    const from = S.noteCursor;
    const to = Math.max(from, S.startPos + Math.max(0, now - S.startCtxTime) + 0.3);
    if (to <= from && !initial) return;
    const spb = beatSec();
    for (const tr of S.tracks) {
      if (tr.kind !== 'notes' || !tr.notes.length) continue;
      for (const n of tr.notes) {
        const ts = n.t * spb, te = (n.t + n.d) * spb;
        // First pass also starts notes that are already sounding at the start position.
        const hit = initial ? ts < to && te > from : ts >= from && ts < to;
        if (!hit) continue;
        const start = Math.max(ts, from);
        const v = Synth.play(S.ctx, tr.channel.input, tr.instrument, n.p, n.v, S.startCtxTime + (start - S.startPos), Math.max(0.02, te - start), tr.sampler);
        v.tr = tr;
        S.voices.push(v);
      }
    }
    S.noteCursor = to;
    if (S.voices.length > 256) S.voices = S.voices.filter(v => v.end > now - 0.5);
  }

  // Stop all voices, or only the ones belonging to `onlyTrack`.
  function stopVoices(onlyTrack) {
    if (!onlyTrack) clearInterval(S.noteTimer);
    S.voices = S.voices.filter(v => {
      if (onlyTrack && v.tr !== onlyTrack) return true;
      v.stop();
      return false;
    });
  }

  async function play() {
    if (S.playing) return;
    await S.ctx.resume();
    startVoices(S.pos);
    S.playing = true;
    updateTransportUI();
  }

  function pause() {
    if (!S.playing) return;
    S.pos = position();
    stopVoices();
    S.playing = false;
    updateTransportUI();
  }

  function stop() {
    if (S.recording) { finishRecording(); return; }
    if (S.playing) {
      const back = S.startPos;
      pause();
      S.pos = back;
    } else {
      S.pos = 0;
    }
    positionPlayhead();
  }

  function togglePlay() {
    if (S.recording) finishRecording();
    else if (S.playing) pause();
    else play();
  }

  function seek(tl) {
    tl = Math.max(0, tl);
    if (S.playing) {
      stopVoices();
      S.pos = tl;
      startVoices(tl);
    } else {
      S.pos = tl;
    }
    positionPlayhead();
  }

  // Re-schedule playback after clip edits (not during recording, to keep the take aligned).
  const restartSoon = debounce(() => {
    if (S.playing && !S.recording) seek(position());
  }, 120);

  function updateTransportUI() {
    const pb = $('#btnPlay');
    pb.textContent = S.playing ? '❚❚' : '▶';
    pb.classList.toggle('on', S.playing);
    $('#btnRecord').classList.toggle('on', !!S.recording);
    document.body.classList.toggle('is-recording', !!S.recording);
  }

  /* ---------- Recording ---------- */
  async function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast(t('recUnsupported'), 5000);
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (e) {
      toast(t('micDenied'), 5000);
      return;
    }
    await S.ctx.resume();
    let target = selected();
    if (!target || target.buffer || target.kind !== 'audio') {
      target = createTrack(t('recordingName', { n: ++S.recCount }), 'vocal');
    }
    S.selectedId = target.id;

    const micSrc = S.ctx.createMediaStreamSource(stream);
    const analyser = S.ctx.createAnalyser();
    analyser.fftSize = 1024;
    micSrc.connect(analyser);

    const R = { stream, target, micSrc, analyser, chunks: [], buf: new Float32Array(1024), tlStart: 0 };
    R.rec = new MediaRecorder(stream);
    R.rec.ondataavailable = e => { if (e.data && e.data.size) R.chunks.push(e.data); };
    R.rec.onstop = () => onRecordingStopped(R);
    S.recording = R;

    if (!S.playing) await play();
    R.rec.start();
    // Timeline position the performer hears right now (compensating output latency).
    const lat = (S.ctx.outputLatency || 0) + (S.ctx.baseLatency || 0);
    R.tlStart = S.startPos + (S.ctx.currentTime - S.startCtxTime) - lat;
    renderAll();
    updateTransportUI();
    toast(t('recStarted'));
  }

  function finishRecording() {
    const R = S.recording;
    if (!R) return;
    S.recording = null;
    try { R.rec.stop(); } catch (e) { /* already stopped */ }
    pause();
    updateTransportUI();
  }

  async function onRecordingStopped(R) {
    R.stream.getTracks().forEach(tk => tk.stop());
    R.micSrc.disconnect();
    const tr = R.target;
    if (!S.tracks.includes(tr)) return;
    if (!R.chunks.length) { toast(t('recEmpty')); renderAll(); return; }
    try {
      const blob = new Blob(R.chunks, { type: R.rec.mimeType || 'audio/webm' });
      const buf = await S.ctx.decodeAudioData(await blob.arrayBuffer());
      tr.keepClip = false;
      const mime = R.rec.mimeType || '';
      const ext = /ogg/.test(mime) ? 'ogg' : /mp4|aac/.test(mime) ? 'm4a' : 'webm';
      setTrackBuffer(tr, buf, `${safeName(tr.name)}.${ext}`);
      tr.source = blob;
      tr.audioId = null;
      if (R.tlStart < 0) {
        tr.offset = 0;
        tr.trimStart = Math.min(-R.tlStart, buf.duration - MIN_CLIP);
      } else {
        tr.offset = R.tlStart;
      }
      clampClip(tr);
      toast(t('recDone'));
    } catch (e) {
      console.error(e);
      toast(t('recFail'));
    }
    renderAll();
  }

  function toggleRecord() {
    if (S.recording) finishRecording();
    else startRecording();
  }

  /* ---------- Save / load ---------- */
  function serializeTrack(tr, keys) {
    const o = {};
    for (const k of keys) o[k] = k === 'sampler' ? serializeSampler(tr.sampler) : clone(tr[k]);
    return o;
  }

  function buildSettings() {
    return {
      app: 'online-audio-mixer',
      type: 'mix-settings',
      version: 1,
      savedAt: new Date().toISOString(),
      bpm: S.bpm,
      genre: S.genre,
      panMode: S.panMode,
      master: { volumeDb: S.masterVolumeDb, limiter: S.limiter },
      tracks: S.tracks.map(tr => serializeTrack(tr, TRACK_KEYS)),
    };
  }

  function saveProject() {
    const data = buildSettings();
    download('mix-settings.json', new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    toast(t('settingsSaved'));
  }

  function saveStrip(tr) {
    const data = Object.assign({ app: 'online-audio-mixer', type: 'channel-strip', version: 1, role: tr.role }, serializeTrack(tr, STRIP_KEYS));
    download(safeName(tr.name) + '-strip.json', new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    toast(t('stripSaved'));
  }

  // Copy mix (and optionally clip) settings from a parsed object into a track.
  function applyTrackSettings(tr, o, withClip) {
    const def = defaultMix();
    tr.volumeDb = Number.isFinite(o.volumeDb) ? clamp(o.volumeDb, -60, 12) : def.volumeDb;
    tr.pan = Number.isFinite(o.pan) ? clamp(o.pan, -1, 1) : def.pan;
    tr.eq = mergeShape(def.eq, o.eq);
    tr.comp = mergeShape(def.comp, o.comp);
    tr.reverb = mergeShape(def.reverb, o.reverb);
    tr.delay = mergeShape(def.delay, o.delay);
    tr.presetSel = mergeShape(def.presetSel, o.presetSel);
    if (!withClip) return;
    if (typeof o.name === 'string' && o.name) tr.name = o.name.slice(0, 80);
    if (ROLES.includes(o.role)) tr.role = o.role;
    if (typeof o.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(o.color)) tr.color = o.color;
    if (typeof o.fileName === 'string') tr.fileName = o.fileName;
    // Audio stored on the backend; fetched later for tracks that have no audio yet.
    if (!tr.buffer && typeof o.audioId === 'string' && ID_RE.test(o.audioId)) tr.audioId = o.audioId;
    tr.mute = !!o.mute;
    tr.solo = !!o.solo;
    tr.kind = o.kind === 'notes' && !tr.buffer ? 'notes' : 'audio';
    if (Synth.INSTRUMENTS[o.instrument]) tr.instrument = o.instrument;
    tr.notes = sanitizeNotes(o.notes);
    tr.sampler = parseSampler(o.sampler, tr.sampler);
    const wantReversed = !!o.reversed;
    if (tr.buffer && wantReversed !== tr.reversed) {
      tr.buffer = DSP.reversed(S.ctx, tr.buffer);
      tr.peaks = DSP.computePeaks(tr.buffer, PEAK_BLOCK);
    }
    tr.reversed = wantReversed;
    for (const k of ['offset', 'trimStart', 'trimEnd', 'fadeIn', 'fadeOut', 'clipGainDb']) {
      if (Number.isFinite(o[k])) tr[k] = o[k];
    }
    if (tr.buffer) {
      if (tr.trimEnd <= tr.trimStart || tr.trimEnd > tr.buffer.duration + 1e-3) { tr.trimStart = 0; tr.trimEnd = tr.buffer.duration; }
      clampClip(tr);
    } else {
      tr.keepClip = true; // keep these clip settings until audio is loaded
    }
  }

  async function loadProject(o) {
    if (S.recording) finishRecording();
    pause();
    if (Number.isFinite(o.bpm)) S.bpm = clamp(Math.round(o.bpm), 40, 240);
    if (PRESETS.genres[o.genre]) S.genre = o.genre;
    if (PRESETS.panModes[o.panMode]) S.panMode = o.panMode;
    if (o.master) {
      if (Number.isFinite(o.master.volumeDb)) S.masterVolumeDb = clamp(o.master.volumeDb, -30, 6);
      S.limiter = o.master.limiter !== false;
    }
    const list = Array.isArray(o.tracks) ? o.tracks : [];
    // Pass 1: match by track name. Pass 2: match remaining by order. Extra entries create empty tracks.
    const assigned = new Array(list.length).fill(null);
    const used = new Set();
    list.forEach((ts, i) => {
      const m = S.tracks.find(x => !used.has(x) && x.name === ts.name);
      if (m) { assigned[i] = m; used.add(m); }
    });
    const free = S.tracks.filter(x => !used.has(x));
    list.forEach((ts, i) => {
      if (assigned[i]) return;
      assigned[i] = free.shift() || createTrack(ts.name, ROLES.includes(ts.role) ? ts.role : 'other');
    });
    list.forEach((ts, i) => {
      applyTrackSettings(assigned[i], ts, true);
      applyChannel(assigned[i]);
    });
    S.master.apply({ volumeDb: S.masterVolumeDb, limiter: S.limiter });
    updateAudibility();
    syncGlobalControls();
    if (!selected() && S.tracks.length) S.selectedId = S.tracks[0].id;
    renderAll();
    if (assigned.some(x => (!x.buffer && x.audioId) || x.sampler.zones.some(z => !z.buffer && z.audioId))) await fetchMissingAudio();
    const missing = assigned.filter(x => x.kind === 'audio' && !x.buffer).length;
    const missingSamples = assigned.reduce((a, x) => a + x.sampler.zones.filter(z => !z.buffer).length, 0);
    toast((missing ? t('settingsLoadedMissing', { n: missing }) : t('settingsLoaded')) + (missingSamples ? ' ' + t('samplesMissing', { n: missingSamples }) : ''), 6000);
  }

  function loadStrip(tr, o) {
    applyTrackSettings(tr, o, false);
    applyChannel(tr);
    refreshCtrls();
    drawEqCurve();
    toast(t('stripLoaded', { name: tr.name }));
  }

  async function openSettingsFile(forTrack) {
    const [f] = await pickFiles($('#fileJson'));
    if (!f) return;
    let o;
    try { o = JSON.parse(await f.text()); } catch (e) { toast(t('badFile')); return; }
    if (!o || typeof o !== 'object') { toast(t('badFile')); return; }
    if (o.type === 'channel-strip') {
      const tr = forTrack || selected();
      if (!tr) { toast(t('selectTrackFirst')); return; }
      loadStrip(tr, o);
    } else if (Array.isArray(o.tracks)) {
      if (forTrack && o.tracks.length) {
        // A full settings file loaded onto one track: use the entry with the same name, or the first one.
        loadStrip(forTrack, o.tracks.find(x => x.name === forTrack.name) || o.tracks[0]);
      } else {
        loadProject(o);
      }
    } else {
      toast(t('badFile'));
    }
  }

  /* ---------- Backend (server) features ---------- */
  async function checkServer() {
    const info = await API.health();
    S.serverLocked = false;
    if (info && info.auth) {
      // The server needs an access key: only enable server features when ours is accepted.
      let ok = false;
      try { ok = await API.checkAccess(); } catch (e) { ok = false; }
      if (!ok) {
        S.server = null;
        S.serverLocked = true;
        renderServerBadge();
        renderInspector();
        return;
      }
    }
    S.server = info;
    renderServerBadge();
    if (S.server) await loadMyPresets();
    renderInspector();
    await loadSeparationInfo(false);
    renderInspector();
  }

  function renderServerBadge() {
    const el = $('#serverStatus');
    el.className = 'server-status ' + (S.server ? 'online' : S.serverLocked ? 'locked' : 'offline');
    el.textContent = S.server ? '● ' + t('serverOnline') : S.serverLocked ? '🔒 ' + t('serverLocked') : '○ ' + t('serverOffline');
    el.title = S.server ? t('serverOnlineTip') : S.serverLocked ? t('serverLockedTip') : t('serverOfflineTip');
    document.body.classList.toggle('server-offline', !S.server);
  }

  async function loadMyPresets() {
    try { S.myPresets = await API.listStripPresets(); } catch (e) { S.myPresets = []; }
  }

  function updateProjectTitle() {
    $('#projectName').textContent = S.projectName ? '· ' + S.projectName : '';
  }

  // Download audio from the server for tracks that reference it but have none loaded.
  async function fetchMissingAudio() {
    if (!S.server) return;
    const todo = S.tracks.filter(x => !x.buffer && x.audioId);
    for (let i = 0; i < todo.length; i++) {
      const tr = todo[i];
      toast(t('downloadingAudio', { i: i + 1, n: todo.length }), 60000);
      try {
        const buf = await S.ctx.decodeAudioData(await API.fetchAudio(tr.audioId));
        setTrackBuffer(tr, buf);
      } catch (e) {
        console.error(e);
        tr.audioId = null;
      }
    }
    const zones = S.tracks.flatMap(x => x.sampler.zones.filter(z => !z.buffer && z.audioId));
    for (let i = 0; i < zones.length; i++) {
      toast(t('downloadingSamples', { i: i + 1, n: zones.length }), 60000);
      try {
        setZoneBuffer(zones[i], await S.ctx.decodeAudioData(await API.fetchAudio(zones[i].audioId)));
      } catch (e) {
        console.error(e);
        zones[i].audioId = null;
      }
    }
    if (todo.length || zones.length) renderAll();
  }

  // Upload a track's original audio to the server (once) and return its audio id.
  async function ensureUploaded(tr) {
    if (tr.audioId) return tr.audioId; // may already be set through a track sharing the same source
    let blob = tr.source;
    let fileName = tr.fileName || safeName(tr.name) + '.wav';
    if (!blob) {
      // No original file available: upload the decoded audio as WAV (un-reversed, like an original).
      blob = DSP.encodeWav(tr.reversed ? DSP.reversed(S.ctx, tr.buffer) : tr.buffer);
      fileName = safeName(tr.name) + '.wav';
    }
    if (blob.size > S.server.maxUploadMb * 1024 * 1024) throw new Error(t('fileTooLarge', { name: fileName, mb: S.server.maxUploadMb }));
    const res = await API.uploadAudio(blob, fileName);
    for (const x of S.tracks) if (x === tr || (!x.audioId && x.source && x.source === tr.source)) x.audioId = res.id;
    return res.id;
  }

  async function saveToServer() {
    if (!S.server) { toast(t('serverOffline')); return; }
    if (!S.tracks.length) { toast(t('noTracks')); return; }
    const name = prompt(t('projectNamePrompt'), S.projectName || t('defaultProjectName'));
    if (name == null || !name.trim()) return;
    const btn = $('#btnServerSave');
    btn.disabled = true;
    try {
      const pending = S.tracks.filter(x => x.buffer && !x.audioId);
      for (let i = 0; i < pending.length; i++) {
        toast(t('uploadingAudio', { i: i + 1, n: pending.length }), 60000);
        await ensureUploaded(pending[i]);
      }
      await uploadSamples();
      const settings = buildSettings();
      // Same name = update the open project; a new name = save as a new project.
      let saved = null;
      if (S.projectId && name.trim() === S.projectName) {
        saved = await API.updateProject(S.projectId, name, settings).catch(e => { if (e.status === 404) return null; throw e; });
      }
      if (!saved) saved = await API.createProject(name, settings);
      S.projectId = saved.id;
      S.projectName = saved.name;
      updateProjectTitle();
      toast(t('savedToServer', { name: saved.name }));
    } catch (e) {
      console.error(e);
      toast(t('serverError', { msg: e.message }), 6000);
    } finally {
      btn.disabled = false;
    }
  }

  function clearProject() {
    if (S.recording) finishRecording();
    pause();
    for (const tr of S.tracks) tr.channel.disconnect();
    S.tracks = [];
    S.selectedId = null;
    S.pos = 0;
    S.sel = null;
    S.undo = [];
    S.redo = [];
    updateEditButtons();
  }

  async function openServerProject(id) {
    if (S.tracks.length && !confirm(t('confirmOpenReplace'))) return;
    $('#projectsDlg').close();
    try {
      const p = await API.getProject(id);
      clearProject();
      S.projectId = p.id;
      S.projectName = p.name;
      updateProjectTitle();
      await loadProject(p.settings);
    } catch (e) {
      toast(t('serverError', { msg: e.message }), 6000);
    }
  }

  async function openProjectsDialog() {
    await checkServer();
    if (!S.server) { toast(t('serverOfflineTip'), 6000); return; }
    const body = $('#projectsBody');
    body.innerHTML = '';
    body.append(h('p', { class: 'hint', text: t('loading') }));
    $('#projectsDlg').showModal();
    let list;
    try { list = await API.listProjects(); } catch (e) {
      body.innerHTML = '';
      body.append(h('p', { text: t('serverError', { msg: e.message }) }));
      return;
    }
    body.innerHTML = '';
    if (!list.length) { body.append(h('p', { class: 'hint', text: t('noProjects') })); return; }
    const locale = LANG === 'zh' ? 'zh-TW' : 'en';
    body.append(h('div', { class: 'project-list' }, list.map(p => h('div', { class: 'project-row' + (p.id === S.projectId ? ' current' : '') },
      h('div', { class: 'project-info' },
        h('strong', { text: p.name }),
        h('span', { class: 'hint', text: `${t('tracksCount', { n: p.trackCount })} · ${new Date(p.updatedAt).toLocaleString(locale)}` })),
      h('button', { class: 'btn small accent', onclick: () => openServerProject(p.id) }, t('open')),
      h('button', { class: 'btn small danger', onclick: async () => {
        if (!confirm(t('confirmDeleteProject', { name: p.name }))) return;
        try {
          await API.deleteProject(p.id);
          if (p.id === S.projectId) {
            S.projectId = null;
            S.projectName = '';
            updateProjectTitle();
            for (const tr of S.tracks) tr.audioId = null; // the server may have removed the audio too
          }
          openProjectsDialog();
        } catch (e) { toast(t('serverError', { msg: e.message }), 6000); }
      } }, t('delete'))))));
  }

  // Personal channel-strip presets stored on the server (shown in the inspector header).
  function myPresetControls(tr) {
    const sel = h('select', { class: 'my-presets', 'aria-label': t('myPresets') },
      h('option', { value: '', text: S.myPresets.length ? t('myPresets') : t('myPresetsNone') }),
      S.myPresets.map(p => h('option', { value: p.id, text: `${p.name} (${t('role_' + p.role) || p.role})` })));
    sel.addEventListener('change', () => {
      const p = S.myPresets.find(x => x.id === sel.value);
      if (p) loadStrip(tr, p.strip);
    });
    const save = h('button', { class: 'btn small', onclick: async () => {
      const name = prompt(t('myPresetNamePrompt'), `${tr.name} – ${t('role_' + tr.role)}`);
      if (name == null || !name.trim()) return;
      try {
        await API.createStripPreset(name, tr.role, serializeTrack(tr, STRIP_KEYS));
        await loadMyPresets();
        renderInspector();
        toast(t('myPresetSaved', { name }));
      } catch (e) { toast(t('serverError', { msg: e.message }), 6000); }
    } }, '★ ' + t('saveMyPreset'));
    const del = h('button', { class: 'btn small danger', title: t('deleteMyPreset'), onclick: async () => {
      const p = S.myPresets.find(x => x.id === sel.value);
      if (!p) { toast(t('deleteMyPresetHint')); return; }
      if (!confirm(t('confirmDeleteMyPreset', { name: p.name }))) return;
      try {
        await API.deleteStripPreset(p.id);
        await loadMyPresets();
        renderInspector();
      } catch (e) { toast(t('serverError', { msg: e.message }), 6000); }
    } }, '✕');
    return h('div', { class: 'my-preset-group' }, sel, save, del);
  }

  /* ---------- AI source separation (HTDemucs on the backend) ---------- */
  const STEM_ROLES = { vocals: 'vocal', drums: 'drums', bass: 'bass', guitar: 'electricGuitar', piano: 'piano', other: 'other' };
  const SEP_MODELS = ['htdemucs', 'htdemucs_ft', 'htdemucs_6s'];
  const SEP_SHIFTS = [1, 2, 5];

  async function loadSeparationInfo(refresh) {
    try { S.separation = S.server ? await API.separationInfo(refresh) : null; } catch (e) { S.separation = null; }
  }

  // Toolbar button: separate the selected track, or pick a new file first.
  async function separateButton() {
    if (!S.server) { toast(t('serverOfflineTip'), 6000); return; }
    if (S.sepJob) { openSeparationDialog(null); return; }
    const tr = selected();
    if (tr && tr.buffer) { openSeparationDialog(tr); return; }
    const [f] = await pickFiles($('#fileOne'));
    if (!f) return;
    await addAudioFiles([f]);
    const added = selected();
    if (added && added.buffer) openSeparationDialog(added);
  }

  /* ---------- Recording clean-up: breaths, throat clearing, coughs ---------- */
  const CLEAN_COLORS = { breath: '#4fc3f7', noise: '#ff8a65' };
  let cleanSrc = null;

  const cleanTrack = () => (S.clean ? S.tracks.find(x => x.id === S.clean.trackId) || null : null);
  const cleanGain = r => (r.kind === 'breath' ? S.cleanOpts.breathDb : S.cleanOpts.noiseDb);
  const fmtCleanDb = v => (v <= -60 ? t('cleanMute') : v.toFixed(0) + ' dB');

  function openCleanupDialog(tr) {
    if (!tr || !tr.buffer) return;
    stopCleanPreview();
    const job = { trackId: tr.id, baked: bakeClip(tr), feats: null, regions: [], progress: 0 };
    S.clean = job;
    renderCleanupDialog();
    const dlg = $('#cleanDlg');
    if (!dlg.open) dlg.showModal();
    Cleanup.analyze(job.baked, p => {
      if (S.clean !== job) return;
      job.progress = p;
      const bar = $('#cleanBar');
      if (bar) bar.style.transform = `scaleX(${p})`;
    }).then(feats => {
      if (S.clean !== job) return; // dialog closed meanwhile
      job.feats = feats;
      redetectCleanup();
      renderCleanupDialog();
    });
  }

  // Re-run detection with the current sensitivity, keeping manual regions and the user's choices.
  function redetectCleanup() {
    const c = S.clean;
    const prev = new Map(c.regions.filter(r => !r.manual).map(r => [r.t0.toFixed(2), r]));
    const auto = Cleanup.detect(c.feats, S.cleanOpts.sens / 100).map(r => {
      const p = prev.get(r.t0.toFixed(2));
      return { ...r, on: p ? p.on : true, kind: p ? p.kind : r.kind, manual: false };
    });
    c.regions = auto.concat(c.regions.filter(r => r.manual)).sort((a, b) => a.t0 - b.t0);
  }

  function stopCleanPreview() {
    if (!cleanSrc) return;
    try { cleanSrc.stop(); } catch (e) { /* already stopped */ }
    cleanSrc = null;
  }

  // Play a region with some context around it, as recorded or as it will sound after clean-up.
  function previewCleanRegion(r, processed) {
    const c = S.clean;
    if (!c) return;
    stopCleanPreview();
    const sr = c.baked.sampleRate, pad = 0.6;
    const a = Math.max(0, r.t0 - pad), b = Math.min(c.baked.duration, r.t1 + pad);
    let buf = DSP.sliceBuffer(S.ctx, c.baked, a * sr, b * sr);
    if (processed) buf = Cleanup.apply(S.ctx, buf, [{ t0: r.t0 - a, t1: r.t1 - a, gainDb: cleanGain(r) }]);
    S.ctx.resume();
    const src = S.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(S.ctx.destination);
    src.onended = () => { if (cleanSrc === src) cleanSrc = null; };
    src.start();
    cleanSrc = src;
  }

  function addSelectionToCleanup() {
    const tr = cleanTrack();
    if (!tr || !S.sel || S.sel.kind !== 'audio' || S.sel.trackId !== tr.id) return;
    const len = S.clean.baked.duration;
    const t0 = clamp(S.sel.t0 - tr.offset, 0, len), t1 = clamp(S.sel.t1 - tr.offset, 0, len);
    if (t1 - t0 < 0.01) return;
    S.clean.regions.push({ t0, t1, kind: 'noise', levelDb: null, on: true, manual: true });
    S.clean.regions.sort((a, b) => a.t0 - b.t0);
    renderCleanupDialog();
  }

  function applyCleanup() {
    const c = S.clean, tr = cleanTrack();
    const on = c ? c.regions.filter(r => r.on) : [];
    if (!tr || !tr.buffer || !on.length) return;
    pushUndo(t('cleanUndo'), [tr]);
    const out = Cleanup.apply(S.ctx, c.baked, on.map(r => ({ t0: r.t0, t1: r.t1, gainDb: cleanGain(r) })));
    setEditedBuffer(tr, out, tr.offset);
    $('#cleanDlg').close();
    afterAudioEdit();
    toast(t('cleanApplied', { n: on.length }));
  }

  function drawCleanWave(canvas) {
    const c = S.clean;
    if (!c || !canvas.isConnected) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, hgt = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hgt * dpr);
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hgt);
    const dur = c.baked.duration, x = tt => (tt / dur) * w;
    for (const r of c.regions) {
      g.fillStyle = r.on ? CLEAN_COLORS[r.kind] + '55' : 'rgba(255,255,255,.08)';
      g.fillRect(x(r.t0), 0, Math.max(2, x(r.t1) - x(r.t0)), hgt);
    }
    // Waveform: max |sample| over all channels per pixel column.
    const chans = Array.from({ length: c.baked.numberOfChannels }, (_, i) => c.baked.getChannelData(i));
    const per = c.baked.length / w, mid = hgt / 2;
    g.fillStyle = '#9aa7b8';
    for (let px = 0; px < w; px++) {
      const s0 = Math.floor(px * per), s1 = Math.min(c.baked.length, Math.floor((px + 1) * per));
      let m = 0;
      for (const d of chans) for (let i = s0; i < s1; i++) { const v = Math.abs(d[i]); if (v > m) m = v; }
      const hh = Math.max(1, m * mid);
      g.fillRect(px, mid - hh, 1, hh * 2);
    }
    for (const r of c.regions) {
      if (!r.on) continue;
      g.fillStyle = CLEAN_COLORS[r.kind];
      g.fillRect(x(r.t0), hgt - 3, Math.max(2, x(r.t1) - x(r.t0)), 3);
    }
  }

  function renderCleanupDialog() {
    const body = $('#cleanBody'), c = S.clean, tr = cleanTrack();
    if (!body || !c || !tr) return;
    body.innerHTML = '';
    body.append(h('p', { class: 'hint', text: t('cleanIntro') }));
    if (!c.feats) {
      body.append(
        h('p', { text: t('cleanAnalyzing') }),
        h('div', { class: 'sep-progress' }, h('div', { class: 'sep-bar', id: 'cleanBar', style: `transform: scaleX(${c.progress})` })));
      return;
    }

    const regionAt = clientX => {
      const rect = canvas.getBoundingClientRect();
      const tt = ((clientX - rect.left) / rect.width) * c.baked.duration;
      const slack = (4 / rect.width) * c.baked.duration;
      return c.regions.find(r => tt >= r.t0 - slack && tt <= r.t1 + slack) || null;
    };
    const canvas = h('canvas', { class: 'clean-wave', title: t('cleanWaveTip') });
    canvas.addEventListener('click', e => { const r = regionAt(e.clientX); if (r) previewCleanRegion(r, false); });
    canvas.addEventListener('pointermove', e => { canvas.style.cursor = regionAt(e.clientX) ? 'pointer' : 'default'; });

    const list = h('div', { class: 'clean-list' });
    const count = h('span', { class: 'hint' });
    const applyBtn = h('button', { class: 'btn accent', onclick: applyCleanup }, t('cleanApply'));
    const refresh = () => {
      const on = c.regions.filter(r => r.on).length;
      count.textContent = t('cleanCount', { on, n: c.regions.length });
      applyBtn.disabled = !on;
      drawCleanWave(canvas);
    };
    const renderList = () => {
      list.innerHTML = '';
      if (!c.regions.length) { list.append(h('p', { class: 'hint', text: t('cleanNoneFound') })); refresh(); return; }
      for (const r of c.regions) {
        const kindSel = h('select', { 'aria-label': t('cleanKind') },
          ['breath', 'noise'].map(k => h('option', { value: k, text: t('cleanKind_' + k) })));
        kindSel.value = r.kind;
        kindSel.addEventListener('change', () => { r.kind = kindSel.value; dot.style.background = CLEAN_COLORS[r.kind]; refresh(); });
        const dot = h('span', { class: 'clean-dot', style: `background:${CLEAN_COLORS[r.kind]}` });
        const box = h('input', { type: 'checkbox', checked: r.on, 'aria-label': t('cleanUse') });
        box.addEventListener('change', () => { r.on = box.checked; row.classList.toggle('off', !r.on); refresh(); });
        const row = h('div', { class: 'clean-row' + (r.on ? '' : ' off') },
          box, dot, kindSel,
          h('span', { class: 'mono', text: `${fmtTime(tr.offset + r.t0)} · ${(r.t1 - r.t0).toFixed(2)} s` }),
          h('span', { class: 'mono hint', text: r.manual ? t('cleanManual') : `${r.levelDb.toFixed(0)} dB` }),
          h('button', { class: 'btn small', title: t('cleanPlayOrig'), onclick: () => previewCleanRegion(r, false) }, '▶ ' + t('cleanOrig')),
          h('button', { class: 'btn small', title: t('cleanPlayResult'), onclick: () => previewCleanRegion(r, true) }, '▶ ' + t('cleanResult')),
          r.manual ? h('button', { class: 'btn small danger', 'aria-label': t('delete'), onclick: () => { c.regions.splice(c.regions.indexOf(r), 1); renderList(); } }, '✕') : null);
        list.append(row);
      }
      refresh();
    };

    const slider = (label, min, max, get, set, fmt, onLive) => {
      const val = h('span', { class: 'mono', text: fmt(get()) });
      const input = h('input', { type: 'range', min, max, step: 1, value: get() });
      input.addEventListener('input', () => { set(Number(input.value)); val.textContent = fmt(get()); if (onLive) onLive(); });
      return h('label', { class: 'clean-ctl' }, h('span', { class: 'lbl', text: label }), input, val);
    };
    const o = S.cleanOpts;
    const controls = h('div', { class: 'clean-ctls' },
      slider(t('cleanSensitivity'), 0, 100, () => o.sens, v => { o.sens = v; }, v => v + '%', () => { redetectCleanup(); renderList(); }),
      slider(t('cleanBreathDb'), -60, 0, () => o.breathDb, v => { o.breathDb = v; }, fmtCleanDb),
      slider(t('cleanNoiseDb'), -60, 0, () => o.noiseDb, v => { o.noiseDb = v; }, fmtCleanDb));

    const hasSel = !!(S.sel && S.sel.kind === 'audio' && S.sel.trackId === tr.id);
    const setAll = on => { for (const r of c.regions) r.on = on; renderList(); };
    body.append(
      controls,
      canvas,
      h('div', { class: 'clean-legend hint' },
        h('span', {}, h('span', { class: 'clean-dot', style: `background:${CLEAN_COLORS.breath}` }), t('cleanKind_breath')),
        h('span', {}, h('span', { class: 'clean-dot', style: `background:${CLEAN_COLORS.noise}` }), t('cleanKind_noise')),
        h('span', { text: t('cleanWaveTip') })),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn small', onclick: () => setAll(true) }, t('cleanAll')),
        h('button', { class: 'btn small', onclick: () => setAll(false) }, t('cleanNone')),
        h('button', { class: 'btn small', onclick: addSelectionToCleanup, disabled: !hasSel, title: t('cleanAddSelTip') }, '+ ' + t('cleanAddSel'))),
      list,
      h('div', { class: 'clean-foot' }, count,
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', onclick: () => $('#cleanDlg').close() }, t('cancel')),
          applyBtn)));
    renderList();
    requestAnimationFrame(() => drawCleanWave(canvas));
  }

  function openSeparationDialog(tr) {
    if (tr) S.sepTarget = tr;
    renderSeparationDialog();
    const dlg = $('#sepDlg');
    if (!dlg.open) dlg.showModal();
    if (!S.separation || !S.separation.available) {
      loadSeparationInfo(true).then(renderSeparationDialog);
    }
  }

  function renderSeparationDialog() {
    const body = $('#sepBody');
    if (!body) return;
    body.innerHTML = '';
    const info = S.separation;

    // A job is in progress: show its progress.
    if (S.sepJob) {
      const sj = S.sepJob;
      body.append(
        h('p', {}, t('sepRunningFor'), ' ', h('strong', { text: sj.trackName })),
        h('p', { class: 'hint', text: `${t('model_' + sj.opts.model)} · ${t('sepStems')}: ${sj.stems.map(s => t('stem_' + s)).join(', ')}` }),
        h('div', { class: 'sep-progress' }, h('div', { class: 'sep-bar', id: 'sepBar' })),
        h('div', { class: 'sep-status' }, h('span', { id: 'sepStage' }), h('span', { id: 'sepPct', class: 'mono' })),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn danger', onclick: cancelSeparation }, t('cancel')),
          h('button', { class: 'btn', onclick: () => $('#sepDlg').close() }, t('sepBackground'))));
      updateSepProgress();
      return;
    }

    if (!info) {
      body.append(h('p', { class: 'hint', text: t('sepChecking') }));
      return;
    }
    if (!info.available) {
      body.append(
        h('p', { text: t('sepUnavailable') }),
        h('p', { class: 'hint', text: info.reason || '' }),
        h('pre', { class: 'code' }, 'cd backend/separator\n./setup.sh        # NVIDIA GPU (CUDA)\n./setup.sh cpu    # CPU only'),
        h('button', { class: 'btn', onclick: async () => { S.separation = null; renderSeparationDialog(); await loadSeparationInfo(true); renderSeparationDialog(); } }, t('retry')));
      return;
    }

    const tr = S.sepTarget && S.tracks.includes(S.sepTarget) ? S.sepTarget : null;
    if (!tr || !tr.buffer) {
      body.append(h('p', { text: t('sepNeedTrack') }));
      return;
    }
    const o = S.sepOpts;
    if (!info.models[o.model]) o.model = 'htdemucs';

    const modelSel = h('select', {}, SEP_MODELS.filter(m => info.models[m]).map(m => h('option', { value: m, text: t('model_' + m) })));
    modelSel.value = o.model;
    const shiftsSel = h('select', {}, SEP_SHIFTS.map(n => h('option', { value: n, text: t('shifts_' + n) })));
    shiftsSel.value = String(o.shifts);
    const stemsBox = h('div', { class: 'sep-stems' });
    const renderStems = () => {
      stemsBox.innerHTML = '';
      for (const s of info.models[o.model].stems) {
        const cb = h('input', { type: 'checkbox', checked: !o.stems || o.stems.includes(s) });
        cb.addEventListener('change', () => {
          o.stems = [...stemsBox.querySelectorAll('input')].filter(x => x.checked).map(x => x.dataset.stem);
        });
        cb.dataset.stem = s;
        stemsBox.append(h('label', { class: 'chk' }, cb, h('span', { text: `${t('stem_' + s)} → ${t('role_' + STEM_ROLES[s])}` })));
      }
    };
    modelSel.addEventListener('change', () => { o.model = modelSel.value; o.stems = null; renderStems(); });
    shiftsSel.addEventListener('change', () => { o.shifts = +shiftsSel.value; });
    renderStems();

    const optBox = (key, label) => {
      const cb = h('input', { type: 'checkbox', checked: o[key] });
      cb.addEventListener('change', () => { o[key] = cb.checked; });
      return h('label', { class: 'chk' }, cb, h('span', { text: label }));
    };
    const device = info.device === 'cuda' && info.gpu ? `GPU (${info.gpu})` : info.device;

    body.append(
      h('p', {}, t('sepSource'), ' ', h('strong', { text: tr.name }), h('span', { class: 'hint', text: ` · ${tr.buffer.duration.toFixed(1)} s` })),
      h('div', { class: 'sep-form' },
        h('label', {}, h('span', { class: 'lbl', text: t('sepModel') }), modelSel),
        h('label', {}, h('span', { class: 'lbl', text: t('sepQuality') }), shiftsSel)),
      h('p', { class: 'hint', text: t('modelDesc_' + o.model) }),
      h('h4', { text: t('sepStems') }),
      stemsBox,
      h('h4', { text: t('sepAfter') }),
      h('div', { class: 'sep-stems' },
        optBox('muteOriginal', t('sepMuteOriginal')),
        optBox('autoMix', t('sepAutoMix', { genre: L(genreDef().name) }))),
      h('p', { class: 'hint', text: t('sepDevice', { device }) + (info.device === 'cpu' ? ' ' + t('sepCpuWarn') : '') }),
      h('p', { class: 'hint', text: t('sepFirstUse') }),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn accent', onclick: () => startSeparation(tr) }, '✦ ' + t('sepStart'))));
    modelSel.addEventListener('change', () => renderSeparationDialog());
  }

  function updateSepProgress() {
    const sj = S.sepJob;
    const badge = $('#sepBadge');
    if (!sj) { badge.textContent = ''; return; }
    const job = sj.job;
    const pct = Math.round((job.progress || 0) * 100);
    badge.textContent = ` ${pct}%`;
    const bar = $('#sepBar'), stage = $('#sepStage'), pctEl = $('#sepPct');
    if (!bar) return;
    bar.style.transform = `scaleX(${job.progress || 0})`;
    pctEl.textContent = pct + '%';
    stage.textContent = job.status === 'uploading' ? t('sepUploading')
      : job.status === 'queued' ? t('sepQueued', { n: job.queuePosition || 1 })
        : t('stage_' + (job.stage || 'starting'));
  }

  async function startSeparation(tr) {
    const o = S.sepOpts;
    const all = S.separation.models[o.model].stems;
    const stems = (o.stems || all).filter(s => all.includes(s));
    if (!stems.length) { toast(t('sepNoStems')); return; }
    S.sepJob = { trackId: tr.id, trackName: tr.name, opts: clone(o), stems, job: { status: 'uploading', progress: 0 } };
    renderSeparationDialog();
    try {
      const audioId = await ensureUploaded(tr);
      S.sepJob.job = await API.startSeparation(audioId, o.model, o.shifts, stems);
      pollSeparation();
    } catch (e) {
      S.sepJob = null;
      updateSepProgress();
      renderSeparationDialog();
      toast(t('serverError', { msg: e.message }), 6000);
    }
  }

  async function cancelSeparation() {
    const sj = S.sepJob;
    if (!sj || !sj.job.id) return;
    try { await API.cancelSeparationJob(sj.job.id); } catch (e) { /* the next poll reports the final state */ }
  }

  async function pollSeparation() {
    const sj = S.sepJob;
    if (!sj) return;
    try {
      sj.job = await API.getSeparationJob(sj.job.id);
    } catch (e) {
      if (e.status !== 404) { setTimeout(pollSeparation, 2000); return; } // transient network error
      sj.job = { status: 'error', error: t('sepLost') };
    }
    updateSepProgress();
    if (sj.job.status === 'queued' || sj.job.status === 'running') {
      setTimeout(pollSeparation, 1000);
      return;
    }
    if (sj.job.status === 'done') {
      try {
        await importStems(sj);
        $('#sepDlg').close();
      } catch (e) {
        console.error(e);
        toast(t('serverError', { msg: e.message }), 6000);
      }
    } else if (sj.job.status === 'cancelled') {
      toast(t('sepCancelled'));
    } else {
      toast(t('sepFailed', { msg: sj.job.error || '?' }), 8000);
    }
    S.sepJob = null;
    updateSepProgress();
    renderSeparationDialog();
  }

  // Add the separated stems as new tracks aligned with the source track.
  async function importStems(sj) {
    const src = S.tracks.find(x => x.id === sj.trackId) || null;
    const stems = sj.job.stems;
    const created = [];
    for (let i = 0; i < stems.length; i++) {
      const stem = stems[i];
      toast(t('downloadingAudio', { i: i + 1, n: stems.length }), 60000);
      const buf = await S.ctx.decodeAudioData(await API.fetchAudio(stem.audioId));
      const at = src ? S.tracks.indexOf(src) + 1 + i : S.tracks.length;
      const nt = createTrack(`${sj.trackName} – ${t('stem_' + stem.name)}`, STEM_ROLES[stem.name] || 'other', at);
      if (src) {
        // Same edits as the source clip; stems have the same length as the source audio.
        for (const k of CLIP_KEYS) nt[k] = clone(src[k]);
        nt.keepClip = true;
      }
      setTrackBuffer(nt, buf, `${safeName(sj.trackName)} - ${stem.name}.flac`);
      nt.audioId = stem.audioId;
      created.push(nt);
    }
    if (sj.opts.autoMix) {
      for (const nt of created) {
        for (const m of ['eq', 'comp', 'fx', 'pan', 'volume']) autoModule(nt, m);
        applyChannel(nt);
      }
    }
    if (src && sj.opts.muteOriginal) src.mute = true;
    updateAudibility();
    if (created.length) S.selectedId = created[0].id;
    renderAll();
    restartSoon();
    toast(t('sepDone', { n: created.length }), 5000);
  }

  /* ---------- Export ---------- */
  async function exportMix() {
    const tracks = S.tracks.filter(x => x.buffer || (x.kind === 'notes' && x.notes.length));
    if (!tracks.length) { toast(t('noTracksToExport')); return; }
    const sr = S.ctx.sampleRate;
    let end = 0, tail = 1;
    for (const tr of tracks) {
      end = Math.max(end, tr.buffer ? clipEnd(tr) : notesEnd(tr));
      if (tr.reverb.enabled) tail = Math.max(tail, tr.reverb.decay + tr.reverb.preDelay / 1000);
      if (tr.delay.enabled && tr.delay.feedback > 0) {
        const ds = DSP.delaySeconds(tr.delay, S.bpm);
        tail = Math.max(tail, Math.min(12, ds * (Math.log(0.001) / Math.log(Math.min(tr.delay.feedback, 0.95)) + 1)));
      }
    }
    const length = Math.ceil((end + tail) * sr);
    const off = new OfflineAudioContext(2, length, sr);
    const master = new DSP.Master(off);
    master.apply({ volumeDb: S.masterVolumeDb, limiter: S.limiter });
    const anySolo = S.tracks.some(x => x.solo);
    for (const tr of tracks) {
      const ch = new DSP.Channel(off, master.input);
      ch.apply(tr, S.bpm);
      ch.setAudible(!tr.mute && (!anySolo || tr.solo));
      if (tr.buffer) DSP.scheduleClip(off, tr, ch.input, 0, 0);
      else for (const n of tr.notes) Synth.play(off, ch.input, tr.instrument, n.p, n.v, n.t * beatSec(), n.d * beatSec(), tr.sampler);
    }
    const btn = $('#btnExport');
    btn.disabled = true;
    toast(t('rendering'), 60000);
    try {
      const rendered = await off.startRendering();
      download('mixdown.wav', DSP.encodeWav(rendered));
      toast(t('exportDone'));
    } catch (e) {
      console.error(e);
      toast(t('exportFail'));
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- Controls (bound to the model) ---------- */
  function refreshCtrls() {
    for (const c of S.trackCtrls) c.refresh();
    for (const c of S.inspCtrls) c.refresh();
  }

  /*
   * Slider + numeric field bound to a getter/setter.
   * o: { label, min, max, step, log, def, get, set, fmt, parse, onChange, compact, disabled }
   */
  function ctl(list, o) {
    const range = h('input', { type: 'range', min: o.log ? 0 : o.min, max: o.log ? 1000 : o.max, step: o.log ? 1 : (o.step || 0.01), 'aria-label': o.label });
    const num = h('input', { type: 'text', class: 'num', inputmode: 'decimal', 'aria-label': o.label });
    const toS = v => (o.log ? Math.round((Math.log(v / o.min) / Math.log(o.max / o.min)) * 1000) : v);
    const fromS = s => (o.log ? o.min * Math.pow(o.max / o.min, s / 1000) : +s);
    const fmt = o.fmt || (v => v.toFixed(1));
    const parse = o.parse || parseNum;
    const commit = v => {
      if (!Number.isFinite(v)) { refresh(); return; }
      o.set(clamp(v, o.min, o.max));
      refresh();
      if (o.onChange) o.onChange();
    };
    function refresh() {
      const v = o.get();
      range.value = toS(v);
      if (document.activeElement !== num) num.value = fmt(v);
      if (o.disabled) {
        const d = !!o.disabled();
        range.disabled = d;
        num.disabled = d;
      }
    }
    range.addEventListener('input', () => commit(fromS(range.value)));
    num.addEventListener('change', () => commit(parse(num.value)));
    num.addEventListener('keydown', e => { if (e.key === 'Enter') num.blur(); });
    if (o.def != null) {
      range.addEventListener('dblclick', () => commit(o.def));
      range.title = t('dblReset');
    }
    list.push({ refresh });
    refresh();
    return h('div', { class: 'ctl' + (o.compact ? ' compact' : '') }, h('span', { class: 'lbl', text: o.label }), range, num);
  }

  function tog(list, label, get, set, onChange, cls) {
    const cb = h('input', { type: 'checkbox' });
    cb.addEventListener('change', () => { set(cb.checked); if (onChange) onChange(); });
    list.push({ refresh() { cb.checked = !!get(); } });
    cb.checked = !!get();
    return h('label', { class: 'tog ' + (cls || '') }, cb, h('span', { class: 'tog-ui' }), label ? h('span', { text: label }) : null);
  }

  function presetSelect(tr, mod) {
    const sel = h('select', { class: 'preset-sel', 'aria-label': t('preset') });
    sel.append(h('option', { value: '', text: t('presetCustom') }));
    const groups = {};
    for (const [id, p] of Object.entries(PRESETS[mod])) (groups[p.group] = groups[p.group] || []).push([id, p]);
    for (const [g, items] of Object.entries(groups)) {
      const og = h('optgroup', { label: t('grp_' + g) });
      for (const [id, p] of items) og.append(h('option', { value: id, text: L(p.name) }));
      sel.append(og);
    }
    sel.addEventListener('change', () => {
      if (!sel.value) return;
      applyPreset(tr, mod, sel.value);
      afterMix(tr);
    });
    S.inspCtrls.push({ refresh() { sel.value = tr.presetSel[mod] || ''; } });
    sel.value = tr.presetSel[mod] || '';
    return h('label', { class: 'preset' }, h('span', { class: 'lbl', text: t('preset') }), sel);
  }

  function autoButton(tr, mod) {
    return h('button', {
      class: 'btn small auto',
      title: t('autoTip', { genre: L(genreDef().name), role: t('role_' + tr.role) }),
      onclick: () => {
        autoModule(tr, mod);
        afterMix(tr);
        toast(t('autoModDone', { mod: t('mod_' + mod), genre: L(genreDef().name), role: t('role_' + tr.role) }));
      },
    }, '⚡ ' + t('auto'));
  }

  // After changing mix parameters (EQ, comp, fx, volume, pan, mute, solo).
  function afterMix(tr) {
    applyChannel(tr);
    updateAudibility();
    refreshCtrls();
    if (tr.id === S.selectedId) drawEqCurve();
  }

  // After changing clip parameters (position, trims, fades, clip gain).
  const checkTimelineSize = debounce(() => {
    const need = timelineLength() * S.pps;
    const have = $('#tlInner').dataset.laneW | 0;
    if (Math.abs(need - have) > 2) renderTimeline();
  }, 300);

  function afterClip(tr) {
    clampClip(tr);
    if (tr.ui && tr.ui.clip) layoutClip(tr);
    refreshCtrls();
    restartSoon();
    checkTimelineSize();
  }

  /* ---------- Timeline rendering ---------- */
  function timelineLength() {
    return Math.max(60, projectEnd() + 20, S.pos + 10);
  }

  function selectTrack(id) {
    if (S.selectedId === id) return;
    S.selectedId = id;
    document.querySelectorAll('.row.track').forEach(r => r.classList.toggle('selected', +r.dataset.id === id));
    renderInspector();
  }

  function renderAll() {
    renderTimeline();
    renderInspector();
  }

  function renderTimeline() {
    const inner = $('#tlInner');
    inner.innerHTML = '';
    S.trackCtrls = [];
    const len = timelineLength();
    const laneW = Math.ceil(len * S.pps);
    inner.dataset.laneW = laneW;
    inner.style.width = `calc(var(--hdr) + ${laneW}px)`;

    const corner = h('div', { class: 'hdr corner' },
      h('span', { text: t('tracksCount', { n: S.tracks.length }) }),
      h('button', { class: 'btn small', onclick: () => addEmptyTrack() }, '+ ' + t('track')));
    inner.append(h('div', { class: 'row ruler-row' }, corner, buildRuler(laneW, len)));
    for (const tr of S.tracks) inner.append(buildTrackRow(tr, laneW));
    inner.append(h('div', { class: 'playhead', id: 'playhead' }));
    for (const c of S.trackCtrls) c.refresh();
    updateSelectionOverlay();
    $('#emptyHint').hidden = S.tracks.length > 0;
    positionPlayhead();
  }

  function buildRuler(laneW, len) {
    const lane = h('div', { class: 'lane ruler', style: `width:${laneW}px` });
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
    const step = steps.find(s => s * S.pps >= 70) || 60;
    for (let i = 0; i * step <= len; i++) {
      const tt = i * step;
      const label = tt >= 60 ? `${Math.floor(tt / 60)}:${pad2(Math.floor(tt % 60))}` : step < 1 ? tt.toFixed(step < 0.5 ? 2 : 1) : tt + 's';
      lane.append(h('div', { class: 'tick', style: `left:${tt * S.pps}px` }, h('span', { text: label })));
    }
    // Click or drag on the ruler to move the playhead.
    lane.addEventListener('pointerdown', e => {
      const wasPlaying = S.playing && !S.recording;
      if (S.recording) return;
      if (wasPlaying) pause();
      lane.setPointerCapture(e.pointerId);
      const toTime = ev => (ev.clientX - lane.getBoundingClientRect().left) / S.pps;
      seek(toTime(e));
      const move = ev => seek(toTime(ev));
      const up = () => {
        lane.removeEventListener('pointermove', move);
        lane.removeEventListener('pointerup', up);
        lane.removeEventListener('pointercancel', up);
        if (wasPlaying) play();
      };
      lane.addEventListener('pointermove', move);
      lane.addEventListener('pointerup', up);
      lane.addEventListener('pointercancel', up);
    });
    return lane;
  }

  function laneGridStyle(laneW) {
    const beatPx = (60 / S.bpm) * S.pps;
    const barPx = beatPx * 4;
    const layers = [`repeating-linear-gradient(90deg, var(--grid-strong) 0 1px, transparent 1px ${barPx}px)`];
    if (beatPx >= 8) layers.push(`repeating-linear-gradient(90deg, var(--grid) 0 1px, transparent 1px ${beatPx}px)`);
    return `width:${laneW}px;background-image:${layers.join(',')}`;
  }

  function buildTrackRow(tr, laneW) {
    tr.ui = {};
    const rec = S.recording && S.recording.target === tr;
    const row = h('div', { class: 'row track' + (tr.id === S.selectedId ? ' selected' : '') + (rec ? ' recording' : ''), 'data-id': tr.id });
    const lane = h('div', { class: 'lane' + (tr.kind === 'notes' ? ' notes-lane' : ''), style: laneGridStyle(laneW) });
    tr.ui.lane = lane;
    lane.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('button')) return;
      if (tr.kind === 'notes') { notesLanePointer(tr, lane, e); return; }
      if (S.tool === 'range') { rangePointer(tr, lane, e); return; }
      if (e.target !== lane) return;
      selectTrack(tr.id);
      setSelection(null);
      if (!S.recording) seek((e.clientX - lane.getBoundingClientRect().left) / S.pps);
    });
    if (tr.kind === 'notes') {
      lane.addEventListener('dblclick', e => {
        const bar = Math.floor((e.clientX - lane.getBoundingClientRect().left) / S.pps / barSec());
        openBarEditor(tr, bar);
      });
      buildNotesCells(tr, lane, laneW);
    } else if (rec) {
      lane.append(h('div', { class: 'lane-msg rec-msg', style: `left:${Math.max(0, S.recording.tlStart) * S.pps}px` }, '● ' + t('recLane')));
    } else if (tr.buffer) {
      lane.append(buildClip(tr));
    } else {
      lane.append(h('div', { class: 'lane-msg' },
        h('button', { class: 'btn small', onclick: () => loadAudioIntoTrack(tr) }, t('loadAudio')),
        h('span', { text: t('orRecord') })));
    }
    row.append(buildTrackHeader(tr), lane);
    return row;
  }

  function buildTrackHeader(tr) {
    const C = S.trackCtrls;
    const nameEl = h('span', { class: 'tname' });
    C.push({ refresh() { nameEl.textContent = tr.name; nameEl.title = tr.name; } });

    const roleSel = h('select', { class: 'role-sel', title: t('role'), 'aria-label': t('role') },
      ROLES.map(r => h('option', { value: r, text: t('role_' + r) })));
    roleSel.addEventListener('change', () => { tr.role = roleSel.value; refreshCtrls(); });
    C.push({ refresh() { roleSel.value = tr.role; } });

    const mBtn = h('button', { class: 'ms m', title: t('mute'), onclick: () => { tr.mute = !tr.mute; afterMix(tr); } }, 'M');
    const sBtn = h('button', { class: 'ms s', title: t('solo'), onclick: () => { tr.solo = !tr.solo; afterMix(tr); } }, 'S');
    C.push({ refresh() { mBtn.classList.toggle('on', tr.mute); sBtn.classList.toggle('on', tr.solo); } });

    const fileBtn = tr.kind === 'notes'
      ? h('button', { class: 'ms', title: t('editBarTip'), onclick: () => openBarEditor(tr, defaultBarFor(tr)) }, '✎')
      : h('button', { class: 'ms', title: t('loadAudio'), onclick: () => loadAudioIntoTrack(tr) }, '⇪');
    const meter = h('div', { class: 'meter mono' }, h('div', { class: 'bar' }));
    tr.ui.meter = meter.firstChild;

    const vol = ctl(C, {
      label: t('volShort'), min: -60, max: 12, step: 0.1, def: 0, compact: true, fmt: fmtDb,
      get: () => tr.volumeDb, set: v => { tr.volumeDb = round(v); tr.presetSel.volume = ''; }, onChange: () => afterMix(tr),
    });
    const pan = ctl(C, {
      label: t('panShort'), min: -100, max: 100, step: 1, def: 0, compact: true, fmt: fmtPan, parse: parsePan,
      get: () => tr.pan * 100, set: v => { tr.pan = Math.round(v) / 100; tr.presetSel.pan = ''; }, onChange: () => afterMix(tr),
    });

    return h('div', { class: 'hdr', style: `--c:${tr.color}`, onpointerdown: () => selectTrack(tr.id) },
      h('div', { class: 'hdr-top' }, h('span', { class: 'swatch' }), nameEl, roleSel),
      h('div', { class: 'hdr-mid' }, mBtn, sBtn, fileBtn, meter),
      vol, pan);
  }

  function buildClip(tr) {
    const cv = h('canvas', { class: 'wave' });
    const hl = h('div', { class: 'handle l', title: t('trimHandle') });
    const hr = h('div', { class: 'handle r', title: t('trimHandle') });
    const label = h('div', { class: 'clip-label' });
    const clip = h('div', { class: 'clip', style: `--c:${tr.color}`, title: t('clipTip') }, cv, label, hl, hr);
    tr.ui.clip = clip;
    tr.ui.cv = cv;
    tr.ui.label = label;
    layoutClip(tr);
    attachClipDrag(tr, clip, hl, hr);
    return clip;
  }

  function layoutClip(tr) {
    const { clip, cv, label } = tr.ui;
    const w = Math.max(2, clipLen(tr) * S.pps);
    clip.style.left = tr.offset * S.pps + 'px';
    clip.style.width = w + 'px';
    label.textContent = tr.name + (tr.clipGainDb ? `  (${fmtDb(tr.clipGainDb)} dB)` : '');
    drawWave(tr, cv, w, cv.parentElement ? cv.parentElement.clientHeight || 64 : 64);
  }

  function drawWave(tr, cv, w, hgt) {
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.min(16000, Math.ceil(w * dpr)));
    const H = Math.max(1, Math.ceil(hgt * dpr));
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, W, H);
    if (!tr.peaks) return;
    const p = tr.peaks, sr = tr.buffer.sampleRate, nb = p.length / 2;
    const len = clipLen(tr), spp = len / W;
    const amp = Math.min(4, dbToGain(tr.clipGainDb));
    const mid = H / 2;
    const env = x => {
      const r = x * spp;
      let f = 1;
      if (tr.fadeIn > 0 && r < tr.fadeIn) f = r / tr.fadeIn;
      if (tr.fadeOut > 0 && len - r < tr.fadeOut) f = Math.min(f, (len - r) / tr.fadeOut);
      return f;
    };
    g.fillStyle = tr.color;
    g.globalAlpha = 0.9;
    for (let x = 0; x < W; x++) {
      const t0 = tr.trimStart + x * spp;
      const i0 = Math.floor((t0 * sr) / PEAK_BLOCK);
      const i1 = Math.max(i0 + 1, Math.floor(((t0 + spp) * sr) / PEAK_BLOCK));
      let mn = 0, mx = 0;
      for (let i = i0; i < i1 && i < nb; i++) {
        if (p[2 * i] < mn) mn = p[2 * i];
        if (p[2 * i + 1] > mx) mx = p[2 * i + 1];
      }
      const k = env(x) * mid * 0.95;
      const y1 = mid - Math.min(1, mx * amp) * k;
      const y2 = mid - Math.max(-1, mn * amp) * k;
      g.fillRect(x, y1, 1, Math.max(1, y2 - y1));
    }
    // Fade curves
    g.globalAlpha = 1;
    g.strokeStyle = 'rgba(255,255,255,.75)';
    g.lineWidth = 1.5 * dpr;
    g.beginPath();
    if (tr.fadeIn > 0) { g.moveTo(0, H); g.lineTo(tr.fadeIn / spp, 0); }
    if (tr.fadeOut > 0) { g.moveTo(W - tr.fadeOut / spp, 0); g.lineTo(W, H); }
    g.stroke();
  }

  function attachClipDrag(tr, clip, hl, hr) {
    clip.addEventListener('pointerdown', e => {
      if (e.button !== 0 || S.tool === 'range') return; // the lane handles range selection
      e.stopPropagation();
      e.preventDefault();
      selectTrack(tr.id);
      const mode = e.target === hl ? 'l' : e.target === hr ? 'r' : 'move';
      const x0 = e.clientX;
      const o = { offset: tr.offset, ts: tr.trimStart, te: tr.trimEnd };
      const beat = 60 / S.bpm;
      const snap = (v, ev) => (S.snap && !ev.altKey ? Math.round(v / beat) * beat : v);
      clip.setPointerCapture(e.pointerId);
      clip.classList.add('dragging');
      let moved = false;
      const move = ev => {
        const dt = (ev.clientX - x0) / S.pps;
        if (!moved) {
          if (Math.abs(ev.clientX - x0) <= 2) return;
          moved = true;
          pushUndo(t(mode === 'move' ? 'undoMoveClip' : 'undoTrimClip'), [tr]);
        }
        if (mode === 'move') {
          tr.offset = Math.max(0, snap(o.offset + dt, ev));
        } else if (mode === 'l') {
          const newOffset = clamp(snap(o.offset + dt, ev), o.offset - o.ts, o.offset + (o.te - o.ts) - MIN_CLIP);
          tr.trimStart = o.ts + (newOffset - o.offset);
          tr.offset = newOffset;
        } else {
          const endTl = snap(o.offset + (o.te - o.ts) + dt, ev);
          tr.trimEnd = clamp(o.ts + (endTl - o.offset), o.ts + MIN_CLIP, tr.buffer.duration);
        }
        clampClip(tr);
        layoutClip(tr);
        refreshCtrls();
      };
      const up = () => {
        clip.removeEventListener('pointermove', move);
        clip.removeEventListener('pointerup', up);
        clip.removeEventListener('pointercancel', up);
        clip.classList.remove('dragging');
        if (moved) { restartSoon(); checkTimelineSize(); }
      };
      clip.addEventListener('pointermove', move);
      clip.addEventListener('pointerup', up);
      clip.addEventListener('pointercancel', up);
    });
  }

  function positionPlayhead(pos) {
    const ph = $('#playhead');
    if (pos == null) pos = position();
    if (ph) ph.style.transform = `translateX(${pos * S.pps}px)`;
    $('#timeMain').textContent = fmtTime(pos);
    $('#timeBars').textContent = t('barBeat') + ' ' + fmtBars(pos);
  }

  /* ---------- Inspector (channel strip of the selected track) ---------- */
  function renderInspector() {
    const ins = $('#inspector');
    ins.innerHTML = '';
    S.inspCtrls = [];
    S.eqCanvas = null;
    S.grBar = null;
    const tr = selected();
    if (!tr) {
      ins.append(h('div', { class: 'insp-empty', text: t('selectTrackHint') }));
      return;
    }
    const title = h('h2');
    S.inspCtrls.push({ refresh() { title.textContent = tr.name; } });
    ins.append(
      h('div', { class: 'insp-head', style: `--c:${tr.color}` },
        h('span', { class: 'swatch' }), title,
        h('span', { class: 'role-badge', text: t('role_' + tr.role) }),
        h('div', { class: 'spacer' }),
        S.server ? myPresetControls(tr) : null,
        h('button', { class: 'btn small', onclick: () => saveStrip(tr), title: t('saveStripTip') }, t('saveStrip')),
        h('button', { class: 'btn small', onclick: () => openSettingsFile(tr), title: t('loadStripTip') }, t('loadStrip'))),
      h('div', { class: 'cards' },
        cardTrack(tr), cardMix(tr), cardComp(tr),
        tr.kind === 'notes' && Synth.isCustom(tr.instrument) ? cardSampler(tr) : null,
        cardEq(tr), cardReverb(tr), cardDelay(tr)));
    refreshCtrls();
    requestAnimationFrame(drawEqCurve);
  }

  function card(title, opts, ...body) {
    const head = h('div', { class: 'card-head' }, h('h3', { text: title }));
    if (opts.toggle) head.append(opts.toggle);
    if (opts.auto) head.append(opts.auto);
    return h('section', { class: 'card ' + (opts.cls || '') }, head, h('div', { class: 'card-body' }, ...body));
  }

  function cardTrack(tr) {
    const C = S.inspCtrls;
    const nameIn = h('input', { type: 'text', class: 'text-in', maxlength: 80, 'aria-label': t('name') });
    nameIn.addEventListener('input', () => {
      tr.name = nameIn.value || t('trackN', { n: tr.id });
      if (tr.ui.label) layoutClip(tr);
      for (const c of S.trackCtrls) c.refresh();
      C.forEach(c => c !== nameCtrl && c.refresh());
    });
    const nameCtrl = { refresh() { if (document.activeElement !== nameIn) nameIn.value = tr.name; } };
    C.push(nameCtrl);

    const roleSel = h('select', { 'aria-label': t('role') }, ROLES.map(r => h('option', { value: r, text: t('role_' + r) })));
    roleSel.addEventListener('change', () => { tr.role = roleSel.value; renderInspector(); for (const c of S.trackCtrls) c.refresh(); });
    C.push({ refresh() { roleSel.value = tr.role; } });

    const top = h('div', { class: 'form-grid' },
      h('label', {}, h('span', { class: 'lbl', text: t('name') }), nameIn),
      h('label', {}, h('span', { class: 'lbl', text: t('role') }), roleSel));
    if (tr.kind === 'notes') return cardNotesTrack(tr, top);

    const info = tr.buffer
      ? `${tr.fileName || ''} · ${tr.buffer.duration.toFixed(2)} s · ${tr.buffer.numberOfChannels === 1 ? t('mono') : t('stereo')} · ${tr.buffer.sampleRate} Hz`
      : t('noAudio');

    const actions = h('div', { class: 'btn-row' },
      h('button', { class: 'btn small', onclick: () => loadAudioIntoTrack(tr) }, tr.buffer ? t('replaceAudio') : t('loadAudio')),
      h('button', { class: 'btn small', onclick: () => { S.selectedId = tr.id; toggleRecord(); }, disabled: !!tr.buffer || !!S.recording, title: t('recordHereTip') }, '● ' + t('recordHere')),
      tr.buffer ? null : h('button', { class: 'btn small', onclick: () => convertToInstrument(tr), title: t('toInstrumentTip') }, '♪ ' + t('toInstrument')),
      h('button', { class: 'btn small', onclick: () => normalizeTrack(tr), disabled: !tr.buffer, title: t('normalizeTip') }, t('normalize')),
      h('button', { class: 'btn small', onclick: () => reverseTrack(tr), disabled: !tr.buffer }, t('reverse')),
      h('button', { class: 'btn small', onclick: () => splitTrack(tr), disabled: !tr.buffer, title: t('splitTip') }, t('split')),
      h('button', { class: 'btn small', onclick: () => openCleanupDialog(tr), disabled: !tr.buffer, title: t('cleanTip') }, '〰 ' + t('cleanBtn')),
      S.server ? h('button', {
        class: 'btn small ai',
        onclick: () => openSeparationDialog(tr),
        disabled: !tr.buffer || !!S.sepJob,
        title: S.separation && !S.separation.available ? S.separation.reason : t('sepTip'),
      }, '✦ ' + t('separateBtn')) : null,
      h('button', { class: 'btn small', onclick: () => { const c = duplicateTrack(tr, t('copySuffix')); S.selectedId = c.id; renderAll(); } }, t('duplicate')),
      h('button', { class: 'btn small', onclick: () => moveTrack(tr, -1), title: t('moveUp') }, '▲'),
      h('button', { class: 'btn small', onclick: () => moveTrack(tr, 1), title: t('moveDown') }, '▼'),
      h('button', { class: 'btn small danger', onclick: () => deleteTrack(tr) }, t('delete')));

    const editing = tr.buffer ? [
      ctl(C, { label: t('offset') + ' (s)', min: 0, max: 3600, step: 0.01, def: 0, fmt: v => v.toFixed(3), get: () => tr.offset, set: v => { tr.offset = v; }, onChange: () => afterClip(tr) }),
      ctl(C, { label: t('trimStart') + ' (s)', min: 0, max: tr.buffer.duration, step: 0.01, def: 0, fmt: v => v.toFixed(3), get: () => tr.trimStart, set: v => { tr.trimStart = Math.min(v, tr.trimEnd - MIN_CLIP); }, onChange: () => afterClip(tr) }),
      ctl(C, { label: t('trimEnd') + ' (s)', min: 0, max: tr.buffer.duration, step: 0.01, def: tr.buffer.duration, fmt: v => v.toFixed(3), get: () => tr.trimEnd, set: v => { tr.trimEnd = Math.max(v, tr.trimStart + MIN_CLIP); }, onChange: () => afterClip(tr) }),
      ctl(C, { label: t('fadeIn') + ' (s)', min: 0, max: 30, step: 0.01, def: 0, fmt: v => v.toFixed(2), get: () => tr.fadeIn, set: v => { tr.fadeIn = v; }, onChange: () => afterClip(tr) }),
      ctl(C, { label: t('fadeOut') + ' (s)', min: 0, max: 30, step: 0.01, def: 0, fmt: v => v.toFixed(2), get: () => tr.fadeOut, set: v => { tr.fadeOut = v; }, onChange: () => afterClip(tr) }),
      ctl(C, { label: t('clipGain') + ' (dB)', min: -24, max: 24, step: 0.1, def: 0, fmt: fmtDb, get: () => tr.clipGainDb, set: v => { tr.clipGainDb = round(v, 2); tr.loudCache = null; }, onChange: () => afterClip(tr) }),
    ] : [h('p', { class: 'hint', text: t('needAudioForEdit') })];

    return card(t('trackCard'), { cls: 'card-track' }, top, h('p', { class: 'file-info', text: info }), actions, ...editing);
  }

  function cardMix(tr) {
    const C = S.inspCtrls;
    const mix = () => afterMix(tr);
    return card(t('mixCard'), { cls: 'card-mix' },
      h('div', { class: 'sub-head' }, h('h4', { text: t('volume') }), autoButton(tr, 'volume')),
      presetSelect(tr, 'volume'),
      ctl(C, { label: t('volume') + ' (dB)', min: -60, max: 12, step: 0.1, def: 0, fmt: fmtDb, get: () => tr.volumeDb, set: v => { tr.volumeDb = round(v); tr.presetSel.volume = ''; }, onChange: mix }),
      h('div', { class: 'sub-head' }, h('h4', { text: t('pan') }), autoButton(tr, 'pan')),
      presetSelect(tr, 'pan'),
      ctl(C, { label: t('pan') + ' (L/C/R)', min: -100, max: 100, step: 1, def: 0, fmt: fmtPan, parse: parsePan, get: () => tr.pan * 100, set: v => { tr.pan = Math.round(v) / 100; tr.presetSel.pan = ''; }, onChange: mix }),
      h('div', { class: 'btn-row' },
        tog(C, t('mute'), () => tr.mute, v => { tr.mute = v; }, mix),
        tog(C, t('solo'), () => tr.solo, v => { tr.solo = v; }, mix)),
      h('p', { class: 'hint', text: t('mixHint') }));
  }

  function cardEq(tr) {
    const C = S.inspCtrls;
    const custom = () => { tr.presetSel.eq = ''; afterMix(tr); };
    const cv = h('canvas', { class: 'eq-canvas' });
    S.eqCanvas = cv;
    attachEqCanvas(tr, cv);
    const bands = h('div', { class: 'bands' }, EQ_BANDS.map(b => {
      const band = () => tr.eq[b.key];
      const def = PRESETS.eqDefault[b.key];
      const head = h('div', { class: 'band-head' }, h('span', { class: 'band-name', style: `--bc:${b.color}`, text: t('band_' + b.key) }));
      if (b.kind === 'pass') head.append(tog(C, '', () => band().on, v => { band().on = v; }, custom, 'tiny'));
      const parts = [ctl(C, { label: t('freq'), min: 20, max: 20000, log: true, def: def.freq, compact: true, fmt: fmtHz, get: () => band().freq, set: v => { band().freq = Math.round(v); }, onChange: custom })];
      if (b.kind !== 'pass') parts.push(ctl(C, { label: t('gain'), min: -EQ_RANGE, max: EQ_RANGE, step: 0.1, def: 0, compact: true, fmt: fmtDb, get: () => band().gain, set: v => { band().gain = round(v); }, onChange: custom }));
      if (b.kind === 'peak') parts.push(ctl(C, { label: 'Q', min: 0.1, max: 12, log: true, def: 1, compact: true, fmt: v => v.toFixed(2), get: () => band().q, set: v => { band().q = round(v, 2); }, onChange: custom }));
      return h('div', { class: 'band' }, head, ...parts);
    }));
    return card(t('eqCard'), {
      cls: 'card-eq',
      toggle: tog(C, t('enabled'), () => tr.eq.enabled, v => { tr.eq.enabled = v; }, () => afterMix(tr)),
      auto: autoButton(tr, 'eq'),
    }, presetSelect(tr, 'eq'), cv, h('p', { class: 'hint', text: t('eqHint') }), bands);
  }

  function cardComp(tr) {
    const C = S.inspCtrls;
    const custom = () => { tr.presetSel.comp = ''; afterMix(tr); };
    const c = () => tr.comp;
    const gr = h('div', { class: 'gr-meter' }, h('div', { class: 'gr-bar' }));
    const grVal = h('span', { class: 'gr-val', text: '0.0 dB' });
    S.grBar = gr.firstChild;
    S.grVal = grVal;
    return card(t('compCard'), {
      cls: 'card-comp',
      toggle: tog(C, t('enabled'), () => c().enabled, v => { c().enabled = v; }, () => afterMix(tr)),
      auto: autoButton(tr, 'comp'),
    },
    presetSelect(tr, 'comp'),
    ctl(C, { label: t('threshold') + ' (dB)', min: -60, max: 0, step: 0.5, def: -18, get: () => c().threshold, set: v => { c().threshold = round(v); }, onChange: custom }),
    ctl(C, { label: t('ratio') + ' (:1)', min: 1, max: 20, step: 0.1, def: 3, get: () => c().ratio, set: v => { c().ratio = round(v); }, onChange: custom }),
    ctl(C, { label: t('attack') + ' (ms)', min: 0.1, max: 200, log: true, def: 10, fmt: v => v.toFixed(1), get: () => c().attack, set: v => { c().attack = round(v); }, onChange: custom }),
    ctl(C, { label: t('release') + ' (ms)', min: 10, max: 1000, log: true, def: 150, fmt: v => Math.round(v) + '', get: () => c().release, set: v => { c().release = Math.round(v); }, onChange: custom }),
    ctl(C, { label: t('knee') + ' (dB)', min: 0, max: 40, step: 0.5, def: 6, get: () => c().knee, set: v => { c().knee = round(v); }, onChange: custom }),
    ctl(C, { label: t('makeup') + ' (dB)', min: 0, max: 24, step: 0.1, def: 0, get: () => c().makeup, set: v => { c().makeup = round(v); }, onChange: custom }),
    h('div', { class: 'gr-row' }, h('span', { class: 'lbl', text: t('gr') }), gr, grVal));
  }

  function cardReverb(tr) {
    const C = S.inspCtrls;
    const custom = () => { tr.presetSel.reverb = ''; afterMix(tr); };
    const r = () => tr.reverb;
    return card(t('reverbCard'), {
      cls: 'card-reverb',
      toggle: tog(C, t('enabled'), () => r().enabled, v => { r().enabled = v; }, () => afterMix(tr)),
      auto: autoButton(tr, 'reverb'),
    },
    presetSelect(tr, 'reverb'),
    ctl(C, { label: t('send') + ' (%)', min: 0, max: 100, step: 1, def: 20, fmt: v => Math.round(v) + '', get: () => r().send * 100, set: v => { r().send = Math.round(v) / 100; }, onChange: custom }),
    ctl(C, { label: t('decay') + ' (s)', min: 0.1, max: 10, step: 0.1, def: 1.8, get: () => r().decay, set: v => { r().decay = round(v); }, onChange: custom }),
    ctl(C, { label: t('preDelay') + ' (ms)', min: 0, max: 200, step: 1, def: 20, fmt: v => Math.round(v) + '', get: () => r().preDelay, set: v => { r().preDelay = Math.round(v); }, onChange: custom }),
    ctl(C, { label: t('tone') + ' (Hz)', min: 1000, max: 20000, log: true, def: 8000, fmt: fmtHz, get: () => r().tone, set: v => { r().tone = Math.round(v); }, onChange: custom }));
  }

  function cardDelay(tr) {
    const C = S.inspCtrls;
    const custom = () => { tr.presetSel.delay = ''; afterMix(tr); };
    const d = () => tr.delay;
    const syncSel = h('select', { 'aria-label': t('sync') },
      h('option', { value: 'off', text: t('syncOff') }),
      DSP.NOTE_VALUES.map(v => h('option', { value: v, text: t('note_' + v.replace('/', '_')) })));
    syncSel.addEventListener('change', () => { d().sync = syncSel.value; custom(); });
    C.push({ refresh() { syncSel.value = d().sync; } });
    const eff = h('span', { class: 'hint inline' });
    C.push({ refresh() { eff.textContent = `= ${Math.round(DSP.delaySeconds(d(), S.bpm) * 1000)} ms @ ${S.bpm} BPM`; } });
    return card(t('delayCard'), {
      cls: 'card-delay',
      toggle: tog(C, t('enabled'), () => d().enabled, v => { d().enabled = v; }, () => afterMix(tr)),
      auto: autoButton(tr, 'delay'),
    },
    presetSelect(tr, 'delay'),
    ctl(C, { label: t('send') + ' (%)', min: 0, max: 100, step: 1, def: 20, fmt: v => Math.round(v) + '', get: () => d().send * 100, set: v => { d().send = Math.round(v) / 100; }, onChange: custom }),
    h('label', { class: 'sync-row' }, h('span', { class: 'lbl', text: t('sync') }), syncSel, eff),
    ctl(C, { label: t('time') + ' (ms)', min: 1, max: 2000, log: true, def: 375, fmt: v => Math.round(v) + '', get: () => d().time, set: v => { d().time = Math.round(v); }, onChange: custom, disabled: () => d().sync !== 'off' }),
    ctl(C, { label: t('feedback') + ' (%)', min: 0, max: 95, step: 1, def: 30, fmt: v => Math.round(v) + '', get: () => d().feedback * 100, set: v => { d().feedback = Math.round(v) / 100; }, onChange: custom }),
    ctl(C, { label: t('tone') + ' (Hz)', min: 500, max: 20000, log: true, def: 5000, fmt: fmtHz, get: () => d().tone, set: v => { d().tone = Math.round(v); }, onChange: custom }));
  }

  /* ---------- EQ curve display with draggable band points ---------- */
  const eqX = (f, w) => (Math.log(f / 20) / Math.log(1000)) * w;
  const eqF = (x, w) => 20 * Math.pow(1000, x / w);
  const eqY = (db, hh) => hh / 2 - (db / EQ_RANGE) * (hh / 2 - 10);
  const eqDb = (y, hh) => ((hh / 2 - y) / (hh / 2 - 10)) * EQ_RANGE;

  function bandPoint(eq, b, w, hh) {
    const band = eq[b.key];
    const gain = b.kind === 'pass' ? 0 : band.gain;
    const active = eq.enabled && (b.kind !== 'pass' || band.on);
    return { x: eqX(band.freq, w), y: eqY(gain, hh), active };
  }

  /* Live spectrum behind the EQ curve (drawn while playing). */
  const SPEC_MIN_DB = -100, SPEC_MAX_DB = -12; // analyser dBFS mapped to the canvas height
  let specBuf = null;

  // Spectrum of an analyser as one y value per pixel column (log frequency axis like the EQ curve).
  function spectrumYs(an, w, hh) {
    if (!specBuf || specBuf.length !== an.frequencyBinCount) specBuf = new Float32Array(an.frequencyBinCount);
    an.getFloatFrequencyData(specBuf);
    const binHz = S.ctx.sampleRate / an.fftSize, last = specBuf.length - 1;
    const val = i => (Number.isFinite(specBuf[i]) ? specBuf[i] : SPEC_MIN_DB);
    const ys = new Float32Array(w + 1);
    for (let px = 0; px <= w; px++) {
      const b0 = eqF(px - 0.5, w) / binHz, b1 = eqF(px + 0.5, w) / binHz;
      let db;
      if (b1 - b0 < 1) {
        // Low frequencies: less than one bin per pixel, interpolate between bins.
        const b = Math.min(last - 1, eqF(px, w) / binHz), i = Math.floor(b), k = b - i;
        db = val(i) * (1 - k) + val(i + 1) * k;
      } else {
        // High frequencies: many bins per pixel, keep the loudest.
        db = -Infinity;
        for (let i = Math.ceil(b0), e = Math.min(last, Math.floor(b1)); i <= e; i++) db = Math.max(db, val(i));
        if (db === -Infinity) db = val(Math.min(last, Math.round(b0)));
      }
      ys[px] = hh - clamp((db - SPEC_MIN_DB) / (SPEC_MAX_DB - SPEC_MIN_DB), 0, 1) * hh;
    }
    return ys;
  }

  function fillSpectrum(g, ys, w, hh, fill, stroke) {
    g.beginPath();
    g.moveTo(0, hh);
    for (let px = 0; px <= w; px++) g.lineTo(px, ys[px]);
    g.lineTo(w, hh);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    if (stroke) {
      g.beginPath();
      for (let px = 0; px <= w; px++) (px ? g.lineTo(px, ys[px]) : g.moveTo(px, ys[px]));
      g.strokeStyle = stroke;
      g.lineWidth = 1;
      g.stroke();
    }
  }

  function drawEqCurve() {
    const cv = S.eqCanvas, tr = selected();
    if (!cv || !tr || !cv.isConnected) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, hh = cv.clientHeight;
    if (!w || !hh) return;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(hh * dpr);
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const col = name => css.getPropertyValue(name).trim();

    g.fillStyle = col('--panel-3');
    g.fillRect(0, 0, w, hh);
    g.font = '10px ' + col('--mono');
    g.lineWidth = 1;
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
      const x = Math.round(eqX(f, w)) + 0.5;
      g.strokeStyle = col('--grid');
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, hh); g.stroke();
      g.fillStyle = col('--muted');
      g.fillText(fmtHz(f), x + 3, hh - 4);
    }
    for (const db of [-12, -6, 0, 6, 12]) {
      const y = Math.round(eqY(db, hh)) + 0.5;
      g.strokeStyle = db === 0 ? col('--grid-strong') : col('--grid');
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      g.fillStyle = col('--muted');
      g.fillText((db > 0 ? '+' : '') + db, 3, y - 3);
    }

    // Live spectrum while playing: grey = before the EQ, accent = after the EQ.
    if (S.playing && tr.channel && tr.channel.specIn) {
      const wi = Math.floor(w);
      fillSpectrum(g, spectrumYs(tr.channel.specIn, wi, hh), wi, hh, 'rgba(200, 210, 225, 0.10)', 'rgba(200, 210, 225, 0.35)');
      if (tr.eq.enabled) fillSpectrum(g, spectrumYs(tr.channel.specOut, wi, hh), wi, hh, 'rgba(76, 195, 255, 0.22)', 'rgba(76, 195, 255, 0.6)');
    }

    // Combined magnitude response of all bands
    DSP.setEq(S.ctx, S.eqScratch, tr.eq, true);
    const N = Math.max(64, Math.floor(w));
    const freqs = new Float32Array(N);
    for (let i = 0; i < N; i++) freqs[i] = eqF((i / (N - 1)) * w, w);
    const total = new Float32Array(N).fill(1);
    const mag = new Float32Array(N), ph = new Float32Array(N);
    for (const k of DSP.EQ_KEYS) {
      S.eqScratch[k].getFrequencyResponse(freqs, mag, ph);
      for (let i = 0; i < N; i++) total[i] *= mag[i];
    }
    const accent = col('--accent');
    g.beginPath();
    for (let i = 0; i < N; i++) {
      const db = clamp(20 * Math.log10(Math.max(total[i], 1e-6)), -EQ_RANGE - 6, EQ_RANGE + 6);
      const x = (i / (N - 1)) * w, y = eqY(db, hh);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.strokeStyle = tr.eq.enabled ? accent : col('--muted');
    g.lineWidth = 2;
    g.stroke();
    g.lineTo(w, eqY(0, hh));
    g.lineTo(0, eqY(0, hh));
    g.closePath();
    g.globalAlpha = 0.12;
    g.fillStyle = accent;
    g.fill();
    g.globalAlpha = 1;

    for (const b of EQ_BANDS) {
      const p = bandPoint(tr.eq, b, w, hh);
      g.beginPath();
      g.arc(p.x, p.y, 6, 0, Math.PI * 2);
      g.fillStyle = p.active ? b.color : 'transparent';
      g.strokeStyle = b.color;
      g.lineWidth = 2;
      g.globalAlpha = p.active ? 1 : 0.55;
      g.fill();
      g.stroke();
      g.globalAlpha = 1;
    }
  }

  function attachEqCanvas(tr, cv) {
    const local = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, hh: r.height }; };
    const hit = e => {
      const p = local(e);
      let best = null, bestD = 14;
      for (const b of EQ_BANDS) {
        const q = bandPoint(tr.eq, b, p.w, p.hh);
        const dd = Math.hypot(q.x - p.x, q.y - p.y);
        if (dd < bestD) { bestD = dd; best = b; }
      }
      return best;
    };
    const changed = () => { tr.presetSel.eq = ''; afterMix(tr); };
    cv.addEventListener('pointerdown', e => {
      const b = hit(e);
      if (!b) return;
      e.preventDefault();
      cv.setPointerCapture(e.pointerId);
      const band = tr.eq[b.key];
      if (b.kind === 'pass') band.on = true;
      if (!tr.eq.enabled) tr.eq.enabled = true;
      const move = ev => {
        const p = local(ev);
        band.freq = Math.round(clamp(eqF(clamp(p.x, 0, p.w), p.w), 20, 20000));
        if (b.kind !== 'pass') band.gain = round(clamp(eqDb(p.y, p.hh), -EQ_RANGE, EQ_RANGE));
        changed();
      };
      const up = () => {
        cv.removeEventListener('pointermove', move);
        cv.removeEventListener('pointerup', up);
        cv.removeEventListener('pointercancel', up);
      };
      cv.addEventListener('pointermove', move);
      cv.addEventListener('pointerup', up);
      cv.addEventListener('pointercancel', up);
      changed();
    });
    cv.addEventListener('wheel', e => {
      const b = hit(e);
      if (!b || b.kind !== 'peak') return;
      e.preventDefault();
      const band = tr.eq[b.key];
      band.q = round(clamp(band.q * (e.deltaY < 0 ? 1.1 : 0.9), 0.1, 12), 2);
      changed();
    }, { passive: false });
    cv.addEventListener('dblclick', e => {
      const b = hit(e);
      if (!b) return;
      const band = tr.eq[b.key];
      if (b.kind === 'pass') band.on = false;
      else band.gain = 0;
      changed();
    });
    cv.addEventListener('pointermove', e => { if (!e.buttons) cv.style.cursor = hit(e) ? 'grab' : 'default'; });
  }

  /* ---------- Animation loop: playhead, meters, gain reduction ---------- */
  function meterWidth(peak) {
    const db = DSP.gainToDb(peak);
    return clamp((db + 60) / 60, 0, 1);
  }

  function setMeter(bar, peak) {
    const prev = +bar.dataset.v || 0;
    const v = Math.max(peak, prev * 0.88);
    bar.dataset.v = v;
    bar.style.transform = `scaleX(${meterWidth(v)})`;
    bar.classList.toggle('hot', v > 0.89);
    bar.classList.toggle('clip', v >= 0.999);
  }

  function frame() {
    const pos = position();
    if (S.playing && !S.recording && projectEnd() > 0 && pos > projectEnd() + 0.5) {
      pause();
      S.pos = projectEnd();
    }
    positionPlayhead(pos);

    // Keep the playhead visible while playing.
    if (S.playing) {
      const tl = $('#timeline');
      const hdrW = $('.hdr') ? $('.hdr').offsetWidth : 0;
      const x = pos * S.pps;
      const viewW = tl.clientWidth - hdrW;
      if (x < tl.scrollLeft || x > tl.scrollLeft + viewW - 30) tl.scrollLeft = Math.max(0, x - 40);
    }

    for (const tr of S.tracks) {
      if (!tr.ui || !tr.ui.meter) continue;
      let pk;
      if (S.recording && S.recording.target === tr) {
        const R = S.recording;
        R.analyser.getFloatTimeDomainData(R.buf);
        pk = 0;
        for (let i = 0; i < R.buf.length; i++) pk = Math.max(pk, Math.abs(R.buf[i]));
      } else {
        pk = tr.channel.peak();
      }
      setMeter(tr.ui.meter, pk);
    }
    const bars = document.querySelectorAll('#masterMeter .bar');
    S.master.peaks().forEach((pk, i) => setMeter(bars[i], pk));

    // EQ display: animate the spectrum while playing (~30 fps), redraw once more after stopping to clear it.
    if (S.eqCanvas && S.eqCanvas.isConnected && (S.playing || S.specShown)) {
      S.specFrame = (S.specFrame || 0) + 1;
      if (!S.playing || S.specFrame % 2 === 0) drawEqCurve();
      S.specShown = S.playing;
    }

    if (S.grBar && S.grBar.isConnected) {
      const tr = selected();
      const red = tr && tr.comp.enabled ? tr.channel.comp.reduction : 0;
      const v = clamp(-red / 24, 0, 1);
      S.grBar.style.transform = `scaleX(${v})`;
      S.grVal.textContent = (red ? red.toFixed(1) : '0.0') + ' dB';
    }
    requestAnimationFrame(frame);
  }

  /* ---------- Instrument (note) tracks ---------- */
  const NOTE_EPS = 1e-6;

  function sanitizeNotes(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const n of list.slice(0, MAX_NOTES)) {
      if (!n || typeof n !== 'object') continue;
      const tt = +n.t, d = +n.d, p = Math.round(+n.p), v = Math.round(+n.v);
      if (!(tt >= 0) || !(d > 0) || !(p >= 0 && p <= 127)) continue;
      out.push({ t: tt, d: Math.min(d, 64), p, v: clamp(Number.isFinite(v) ? v : 100, 1, 127) });
    }
    return out;
  }

  function addInstrumentTrack(instrument) {
    const inst = Synth.INSTRUMENTS[instrument] ? instrument : 'piano';
    const tr = createTrack(L(Synth.INSTRUMENTS[inst].name), Synth.INSTRUMENTS[inst].role, undefined, 'notes');
    tr.instrument = inst;
    S.selectedId = tr.id;
    renderAll();
    toast(t('instTrackAdded'), 4500);
  }

  function convertToInstrument(tr) {
    if (tr.buffer || tr.kind !== 'audio') return;
    tr.kind = 'notes';
    tr.instrument = 'piano';
    tr.notes = [];
    if (tr.role === 'other') tr.role = Synth.INSTRUMENTS.piano.role;
    renderAll();
  }

  function populateInstrumentMenu() {
    const sel = $('#addInstrument');
    sel.innerHTML = '';
    sel.append(h('option', { value: '', text: '+ ' + t('addInstrument') }));
    for (const [id, def] of Object.entries(Synth.INSTRUMENTS)) sel.append(h('option', { value: id, text: L(def.name) }));
    sel.value = '';
  }

  const notesInRange = (tr, b0, b1) => tr.notes.filter(n => n.t >= b0 - NOTE_EPS && n.t < b1 - NOTE_EPS);

  // Bar to open in the editor: the selected bar on this track, else the bar under the playhead.
  function defaultBarFor(tr) {
    if (S.sel && S.sel.trackId === tr.id && S.sel.kind === 'notes') return Math.floor(S.sel.b0 / 4);
    return Math.floor(position() / barSec() + NOTE_EPS);
  }

  function openBarEditor(tr, bar) {
    if (tr.kind !== 'notes') return;
    bar = Math.max(0, bar | 0);
    selectTrack(tr.id);
    setSelection({ trackId: tr.id, kind: 'notes', b0: bar * 4, b1: bar * 4 + 4 });
    S.noteEditor.open(tr, bar);
  }

  function previewNote(tr, pitch, vel) {
    S.ctx.resume();
    Synth.play(S.ctx, tr.channel.input, tr.instrument, pitch, vel, S.ctx.currentTime, Synth.isDrum(tr.instrument) ? 0.1 : 0.4, tr.sampler);
  }

  // Play one bar of a track (editor preview). Returns { start, duration, stop() }.
  function playBar(tr, bar) {
    S.ctx.resume();
    const start = S.ctx.currentTime + 0.05;
    const b0 = bar * 4, spb = beatSec();
    const voices = notesInRange(tr, b0, b0 + 4).map(n =>
      Synth.play(S.ctx, tr.channel.input, tr.instrument, n.p, n.v, start + (n.t - b0) * spb, n.d * spb, tr.sampler));
    return { start, duration: barSec(), stop() { voices.forEach(v => v.stop()); } };
  }

  function onNotesChanged(tr) {
    tr.notes.sort((a, b) => a.t - b.t || a.p - b.p);
    redrawNotesLane(tr);
    refreshCtrls();
    checkTimelineSize();
  }

  // Bar cells with a mini piano-roll of each bar.
  function buildNotesCells(tr, lane, laneW) {
    lane.querySelectorAll('.bar-cell, .lane-msg').forEach(el => el.remove());
    const barPx = barSec() * S.pps;
    const nBars = Math.ceil(laneW / barPx);
    const drums = Synth.isDrum(tr.instrument);
    let lo = 48, hi = 72;
    if (!drums && tr.notes.length) {
      lo = Math.min(...tr.notes.map(n => n.p)) - 2;
      hi = Math.max(...tr.notes.map(n => n.p)) + 2;
      if (hi - lo < 12) { const c = (hi + lo) / 2; lo = Math.floor(c - 6); hi = Math.ceil(c + 6); }
    }
    const byBar = new Map();
    for (const n of tr.notes) {
      const b = Math.floor(n.t / 4 + NOTE_EPS);
      if (!byBar.has(b)) byBar.set(b, []);
      byBar.get(b).push(n);
    }
    const frag = document.createDocumentFragment();
    const dpr = window.devicePixelRatio || 1;
    for (let b = 0; b < nBars; b++) {
      const notes = byBar.get(b);
      const cell = h('div', { class: 'bar-cell' + (notes ? ' has' : ''), style: `left:${b * barPx}px;width:${barPx}px` });
      if (barPx >= 22) cell.append(h('span', { class: 'bar-num', text: String(b + 1) }));
      if (notes) {
        const cv = h('canvas', { class: 'bar-notes' });
        const w = Math.max(1, Math.round(barPx - 2)), hh = 84;
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(hh * dpr);
        const g = cv.getContext('2d');
        g.scale(dpr, dpr);
        g.fillStyle = tr.color;
        const rows = drums ? Synth.DRUM_KIT.length : hi - lo + 1;
        const rh = hh / rows;
        for (const n of notes) {
          const r = drums ? Synth.DRUM_KIT.findIndex(k => k.p === n.p) : hi - n.p;
          if (r < 0) continue;
          const x = ((n.t - b * 4) / 4) * w;
          const nw = drums ? Math.max(2, w / 32) : Math.max(2, (n.d / 4) * w);
          g.globalAlpha = 0.45 + (n.v / 127) * 0.55;
          g.fillRect(x, r * rh, Math.min(nw, w - x), Math.max(2, rh - 1));
        }
        cell.append(cv);
      }
      frag.append(cell);
    }
    lane.append(frag);
    if (!tr.notes.length) lane.append(h('div', { class: 'lane-msg hint-msg', text: t('notesLaneHint') }));
  }

  function redrawNotesLane(tr) {
    if (!tr.ui || !tr.ui.lane || !tr.ui.lane.isConnected) return;
    buildNotesCells(tr, tr.ui.lane, $('#tlInner').dataset.laneW | 0);
    updateSelectionOverlay();
  }

  function cardNotesTrack(tr, top) {
    const C = S.inspCtrls;
    const instSel = h('select', { 'aria-label': t('instrument') },
      Object.entries(Synth.INSTRUMENTS).map(([id, d]) => h('option', { value: id, text: L(d.name) })));
    instSel.value = tr.instrument;
    instSel.addEventListener('change', () => {
      const oldRole = Synth.INSTRUMENTS[tr.instrument].role;
      tr.instrument = instSel.value;
      if (tr.role === oldRole) tr.role = Synth.INSTRUMENTS[tr.instrument].role;
      redrawNotesLane(tr);
      for (const c of S.trackCtrls) c.refresh();
      renderInspector();
      S.noteEditor.refresh();
    });
    const info = h('p', { class: 'file-info' });
    C.push({
      refresh() {
        const bars = new Set(tr.notes.map(n => Math.floor(n.t / 4 + NOTE_EPS))).size;
        info.textContent = t('notesInfo', { n: tr.notes.length, bars });
      },
    });
    const actions = h('div', { class: 'btn-row' },
      h('button', { class: 'btn small accent', onclick: () => openBarEditor(tr, defaultBarFor(tr)), title: t('editBarTip') }, '✎ ' + t('editBar')),
      h('button', { class: 'btn small', onclick: () => {
        if (!tr.notes.length || !confirm(t('confirmClearNotes'))) return;
        pushUndo(t('clearNotes'), [tr]);
        tr.notes = [];
        onNotesChanged(tr);
      } }, t('clearNotes')),
      h('button', { class: 'btn small', onclick: () => { const c = duplicateTrack(tr, t('copySuffix')); S.selectedId = c.id; renderAll(); } }, t('duplicate')),
      h('button', { class: 'btn small', onclick: () => moveTrack(tr, -1), title: t('moveUp') }, '▲'),
      h('button', { class: 'btn small', onclick: () => moveTrack(tr, 1), title: t('moveDown') }, '▼'),
      h('button', { class: 'btn small danger', onclick: () => deleteTrack(tr) }, t('delete')));
    return card(t('trackCard'), { cls: 'card-track' },
      top,
      h('label', { class: 'form-grid single' }, h('span', { class: 'lbl', text: t('instrument') }), instSel),
      info,
      actions,
      h('p', { class: 'hint', text: t('notesTrackHint') }));
  }

  /* ---------- Sampler: user-uploaded instrument sounds ---------- */
  // Zones: { name, root (MIDI note or drum pad), buffer, start (leading silence s), source (File), audioId }
  function defaultSampler() {
    return { attack: 2, release: 300, gainDb: 0, oneShot: false, zones: [] };
  }

  const copySampler = sm => ({ ...sm, zones: sm.zones.map(z => ({ ...z })) });
  const sortZones = sm => sm.zones.sort((a, b) => a.root - b.root);

  function serializeSampler(sm) {
    return {
      attack: sm.attack,
      release: sm.release,
      gainDb: sm.gainDb,
      oneShot: sm.oneShot,
      zones: sm.zones.map(z => ({ name: z.name, root: z.root, audioId: z.audioId || null })),
    };
  }

  // Read sampler settings from a file; keep already-loaded audio for zones that are still the same.
  function parseSampler(o, existing) {
    if (!o || typeof o !== 'object') return existing || defaultSampler();
    const num = (v, a, b, d) => (Number.isFinite(+v) ? clamp(+v, a, b) : d);
    const old = existing ? existing.zones : [];
    const zones = (Array.isArray(o.zones) ? o.zones : []).slice(0, 128).flatMap(z => {
      if (!z || typeof z !== 'object') return [];
      const root = Math.round(+z.root);
      if (!(root >= 0 && root <= 127)) return [];
      const audioId = typeof z.audioId === 'string' && ID_RE.test(z.audioId) ? z.audioId : null;
      const name = typeof z.name === 'string' ? z.name.slice(0, 200) : 'sample';
      const prev = old.find(x => x.buffer && ((audioId && x.audioId === audioId) || (x.name === name && x.root === root)));
      return [{ name, root, audioId: audioId || (prev && prev.audioId) || null, buffer: prev ? prev.buffer : null, start: prev ? prev.start : 0, source: prev ? prev.source : null }];
    });
    const sm = {
      attack: num(o.attack, 0, 2000, 2),
      release: num(o.release, 10, 10000, 300),
      gainDb: num(o.gainDb, -40, 24, 0),
      oneShot: !!o.oneShot,
      zones,
    };
    sortZones(sm);
    return sm;
  }

  function setZoneBuffer(z, buf) {
    z.buffer = buf;
    z.start = SamplerUtil.leadingSilence(buf);
  }

  // Upload sample audio that is not on the server yet (each distinct buffer once).
  async function uploadSamples() {
    const groups = new Map();
    for (const x of S.tracks) {
      for (const z of x.sampler.zones) {
        if (!z.buffer || z.audioId) continue;
        if (!groups.has(z.buffer)) groups.set(z.buffer, []);
        groups.get(z.buffer).push(z);
      }
    }
    let i = 0;
    for (const [buf, group] of groups) {
      toast(t('uploadingSamples', { i: ++i, n: groups.size }), 60000);
      const z = group[0];
      const blob = z.source || DSP.encodeWav(buf);
      const name = z.source ? z.name : safeName(z.name.replace(/\.[^.]+$/, '')) + '.wav';
      if (blob.size > S.server.maxUploadMb * 1024 * 1024) throw new Error(t('fileTooLarge', { name, mb: S.server.maxUploadMb }));
      const res = await API.uploadAudio(blob, name);
      for (const g of group) g.audioId = res.id;
    }
  }

  async function addSampleFiles(tr) {
    const files = (await pickFiles($('#fileAudio'))).filter(isAudioFile);
    if (!files.length) return;
    const drum = Synth.isDrum(tr.instrument);
    const report = [];
    for (const f of files) {
      let buf;
      try { buf = await decodeFile(f); } catch (e) { toast(t('decodeFail', { name: f.name })); continue; }
      const z = { name: f.name, root: 60, buffer: null, start: 0, source: f, audioId: null };
      setZoneBuffer(z, buf);
      if (drum) {
        let pad = SamplerUtil.guessDrumPad(f.name);
        if (pad == null) {
          const free = Synth.DRUM_KIT.find(k => !tr.sampler.zones.some(x => x.root === k.p));
          pad = (free || Synth.DRUM_KIT[Synth.DRUM_KIT.length - 1]).p;
        }
        z.root = pad;
        report.push(`${f.name} → ${t('drum_' + Synth.DRUM_KIT.find(k => k.p === pad).key)}`);
      } else {
        let root = SamplerUtil.rootFromFileName(f.name), how = 'rootFromName';
        if (root == null) { root = SamplerUtil.detectPitch(buf, z.start); how = 'rootDetected'; }
        if (root == null) { root = 60; how = 'rootDefault'; }
        z.root = root;
        report.push(`${f.name} → ${SamplerUtil.noteName(root)} (${t(how)})`);
      }
      // A new sample replaces the one on the same note / pad.
      tr.sampler.zones = tr.sampler.zones.filter(x => x.root !== z.root);
      tr.sampler.zones.push(z);
    }
    sortZones(tr.sampler);
    renderInspector();
    if (S.noteEditor) S.noteEditor.refresh();
    if (report.length) toast(t('samplesAdded', { list: report.slice(0, 6).join('、') + (report.length > 6 ? '…' : '') }), 7000);
  }

  async function replaceZoneAudio(tr, z) {
    const [f] = await pickFiles($('#fileOne'));
    if (!f) return;
    try {
      setZoneBuffer(z, await decodeFile(f));
      z.name = f.name;
      z.source = f;
      z.audioId = null;
      renderInspector();
    } catch (e) {
      toast(t('decodeFail', { name: f.name }));
    }
  }

  function cardSampler(tr) {
    const C = S.inspCtrls;
    const sm = tr.sampler;
    const drum = Synth.isDrum(tr.instrument);
    const list = h('div', { class: 'zone-list' });
    if (!sm.zones.length) list.append(h('p', { class: 'hint', text: t(drum ? 'samplerEmptyDrums' : 'samplerEmpty') }));

    const zones = drum
      ? sm.zones.slice().sort((a, b) => Synth.DRUM_KIT.findIndex(k => k.p === a.root) - Synth.DRUM_KIT.findIndex(k => k.p === b.root))
      : sm.zones; // sorted by root
    zones.forEach((z, i) => {
      let keyCtl, range = '';
      if (drum) {
        keyCtl = h('select', { 'aria-label': t('samplePad') },
          Synth.DRUM_KIT.map(k => h('option', { value: k.p, text: t('drum_' + k.key) })),
          Synth.DRUM_KIT.some(k => k.p === z.root) ? null : h('option', { value: z.root, text: SamplerUtil.noteName(z.root) }));
        keyCtl.value = String(z.root);
        keyCtl.addEventListener('change', () => {
          const pad = +keyCtl.value;
          sm.zones = sm.zones.filter(x => x === z || x.root !== pad);
          z.root = pad;
          renderInspector();
        });
      } else {
        keyCtl = h('input', { type: 'text', class: 'num note-in', value: SamplerUtil.noteName(z.root), 'aria-label': t('sampleRoot'), title: t('sampleRootTip') });
        keyCtl.addEventListener('change', () => {
          const v = keyCtl.value.trim();
          const p = /^\d+$/.test(v) ? +v : SamplerUtil.parseNoteName(v);
          if (p == null || p < 0 || p > 127) { toast(t('badNoteName')); keyCtl.value = SamplerUtil.noteName(z.root); return; }
          sm.zones = sm.zones.filter(x => x === z || x.root !== p);
          z.root = p;
          sortZones(sm);
          renderInspector();
        });
        keyCtl.addEventListener('keydown', e => { if (e.key === 'Enter') keyCtl.blur(); });
        // Keys played by this sample: up to halfway to the neighbouring samples.
        const lo = i === 0 ? 0 : Math.floor((zones[i - 1].root + z.root) / 2) + 1;
        const hi = i === zones.length - 1 ? 127 : Math.floor((z.root + zones[i + 1].root) / 2);
        range = `${SamplerUtil.noteName(lo)} – ${SamplerUtil.noteName(hi)}`;
      }
      list.append(h('div', { class: 'zone-row' + (z.buffer ? '' : ' missing') },
        h('button', { class: 'btn small', title: t('previewSample'), disabled: !z.buffer, onclick: () => previewNote(tr, z.root, 110) }, '▶'),
        h('span', { class: 'zone-name', title: z.name, text: z.name }),
        keyCtl,
        h('span', { class: 'zone-range', text: z.buffer ? range : '⚠ ' + t('sampleMissing') }),
        h('button', { class: 'btn small', title: t('replaceSample'), onclick: () => replaceZoneAudio(tr, z) }, '⇪'),
        h('button', { class: 'btn small danger', title: t('removeSample'), onclick: () => { sm.zones = sm.zones.filter(x => x !== z); renderInspector(); } }, '✕')));
    });

    const settings = h('div', { class: 'sampler-settings' },
      ctl(C, { label: t('attack') + ' (ms)', min: 0, max: 1000, step: 1, def: 2, fmt: v => Math.round(v) + '', get: () => sm.attack, set: v => { sm.attack = Math.round(v); } }),
      ctl(C, { label: t('release') + ' (ms)', min: 10, max: 5000, log: true, def: 300, fmt: v => Math.round(v) + '', get: () => sm.release, set: v => { sm.release = Math.round(v); }, disabled: () => drum || sm.oneShot }),
      ctl(C, { label: t('sampleGain') + ' (dB)', min: -24, max: 12, step: 0.5, def: 0, fmt: fmtDb, get: () => sm.gainDb, set: v => { sm.gainDb = round(v); } }),
      drum ? null : tog(C, t('oneShot'), () => sm.oneShot, v => { sm.oneShot = v; }, () => refreshCtrls()));

    return card(t('samplerCard'), {
      cls: 'card-sampler',
      auto: h('button', { class: 'btn small accent', onclick: () => addSampleFiles(tr) }, '⇪ ' + t('uploadSamples')),
    }, list, settings, h('p', { class: 'hint', text: t(drum ? 'samplerHintDrums' : 'samplerHint') }));
  }

  /* ---------- Selection ---------- */
  function setSelection(sel) {
    S.sel = sel;
    updateSelectionOverlay();
    updateEditButtons();
  }

  function updateSelectionOverlay() {
    document.querySelectorAll('.sel-overlay').forEach(el => el.remove());
    const sel = S.sel;
    if (!sel) return;
    const tr = S.tracks.find(x => x.id === sel.trackId);
    if (!tr || !tr.ui || !tr.ui.lane) return;
    const t0 = sel.kind === 'notes' ? sel.b0 * beatSec() : sel.t0;
    const t1 = sel.kind === 'notes' ? sel.b1 * beatSec() : sel.t1;
    tr.ui.lane.append(h('div', { class: 'sel-overlay', style: `left:${t0 * S.pps}px;width:${Math.max(2, (t1 - t0) * S.pps)}px` }));
  }

  function setTool(tool) {
    S.tool = tool;
    document.body.classList.toggle('tool-range', tool === 'range');
    $('#toolMove').classList.toggle('on', tool === 'move');
    $('#toolRange').classList.toggle('on', tool === 'range');
  }

  // Drag on an audio lane (range tool) to select a time range.
  function rangePointer(tr, lane, e) {
    e.preventDefault();
    selectTrack(tr.id);
    const timeAt = ev => Math.max(0, (ev.clientX - lane.getBoundingClientRect().left) / S.pps);
    const snapT = (v, ev) => (S.snap && !ev.altKey ? Math.round(v / beatSec()) * beatSec() : v);
    const t0 = snapT(timeAt(e), e);
    let moved = false;
    lane.setPointerCapture(e.pointerId);
    const move = ev => {
      if (!moved && Math.abs(ev.clientX - e.clientX) <= 3) return;
      moved = true;
      const t1 = snapT(timeAt(ev), ev);
      setSelection({ trackId: tr.id, kind: 'audio', t0: Math.min(t0, t1), t1: Math.max(t0, t1) });
    };
    const up = () => {
      lane.removeEventListener('pointermove', move);
      lane.removeEventListener('pointerup', up);
      lane.removeEventListener('pointercancel', up);
      if (!moved) {
        setSelection(null);
        if (!S.recording) seek(t0);
      }
    };
    lane.addEventListener('pointermove', move);
    lane.addEventListener('pointerup', up);
    lane.addEventListener('pointercancel', up);
  }

  // Click / drag / Shift+click on an instrument lane selects whole bars.
  function notesLanePointer(tr, lane, e) {
    e.preventDefault();
    selectTrack(tr.id);
    const barAt = ev => Math.max(0, Math.floor((ev.clientX - lane.getBoundingClientRect().left) / S.pps / barSec()));
    const bar = barAt(e);
    const extend = e.shiftKey && S.sel && S.sel.trackId === tr.id && S.sel.kind === 'notes';
    const anchor = extend ? S.selAnchor : bar;
    S.selAnchor = anchor;
    const apply = b => setSelection({ trackId: tr.id, kind: 'notes', b0: Math.min(anchor, b) * 4, b1: (Math.max(anchor, b) + 1) * 4 });
    apply(bar);
    if (!S.playing && !S.recording) seek(Math.min(anchor, bar) * barSec());
    lane.setPointerCapture(e.pointerId);
    const move = ev => apply(barAt(ev));
    const up = () => {
      lane.removeEventListener('pointermove', move);
      lane.removeEventListener('pointerup', up);
      lane.removeEventListener('pointercancel', up);
    };
    lane.addEventListener('pointermove', move);
    lane.addEventListener('pointerup', up);
    lane.addEventListener('pointercancel', up);
  }

  function updateEditButtons() {
    const has = !!S.sel;
    $('#btnCut').disabled = !has;
    $('#btnCopy').disabled = !has;
    $('#btnDeleteSel').disabled = !has;
    $('#btnCrop').disabled = !(has && S.sel.kind === 'audio');
    $('#btnPaste').disabled = !S.clipboard;
    $('#btnPaste').title = t('paste') + (S.clipboard ? ` – ${t(S.clipboard.kind === 'notes' ? 'clipNotes' : 'clipAudio')}` : '') + ' (Ctrl+V)';
    const u = S.undo[S.undo.length - 1], r = S.redo[S.redo.length - 1];
    $('#btnUndo').disabled = !u;
    $('#btnRedo').disabled = !r;
    $('#btnUndo').title = t('undo') + (u ? `: ${u.label}` : '') + ' (Ctrl+Z)';
    $('#btnRedo').title = t('redo') + (r ? `: ${r.label}` : '') + ' (Ctrl+Shift+Z)';
  }

  /* ---------- Undo / redo (snapshots of the edited tracks; audio buffers are immutable) ---------- */
  function snapshotTrack(tr) {
    return {
      id: tr.id,
      buffer: tr.buffer,
      peaks: tr.peaks,
      source: tr.source,
      audioId: tr.audioId,
      offset: tr.offset,
      trimStart: tr.trimStart,
      trimEnd: tr.trimEnd,
      fadeIn: tr.fadeIn,
      fadeOut: tr.fadeOut,
      clipGainDb: tr.clipGainDb,
      reversed: tr.reversed,
      notes: clone(tr.notes || []),
    };
  }

  function pushUndo(label, tracks) {
    S.undo.push({ label, snaps: tracks.map(snapshotTrack) });
    if (S.undo.length > 100) S.undo.shift();
    S.redo = [];
    updateEditButtons();
  }

  function restoreSnapshots(entry) {
    const back = [];
    for (const snap of entry.snaps) {
      const tr = S.tracks.find(x => x.id === snap.id);
      if (!tr) continue; // the track was deleted
      back.push(snapshotTrack(tr));
      const { id, notes, ...rest } = snap;
      Object.assign(tr, rest);
      tr.notes = clone(notes);
      tr.loudCache = null;
    }
    return { label: entry.label, snaps: back };
  }

  function undo() {
    const e = S.undo.pop();
    if (!e) { toast(t('nothingToUndo')); return; }
    S.redo.push(restoreSnapshots(e));
    afterHistory(t('undone', { label: e.label }));
  }

  function redo() {
    const e = S.redo.pop();
    if (!e) { toast(t('nothingToRedo')); return; }
    S.undo.push(restoreSnapshots(e));
    afterHistory(t('redone', { label: e.label }));
  }

  function afterHistory(msg) {
    renderTimeline();
    renderInspector();
    S.noteEditor.refresh();
    restartSoon();
    updateEditButtons();
    toast(msg);
  }

  /* ---------- Cut / copy / paste / delete / crop ---------- */
  const selTrack = () => (S.sel ? S.tracks.find(x => x.id === S.sel.trackId) || null : null);

  // The audio as heard on the timeline (trim applied) as a standalone buffer.
  function bakeClip(tr) {
    const sr = tr.buffer.sampleRate;
    return DSP.sliceBuffer(S.ctx, tr.buffer, tr.trimStart * sr, tr.trimEnd * sr);
  }

  // Replace a track's audio with an edited buffer that starts at `offset`.
  function setEditedBuffer(tr, buf, offset) {
    if (S.playing) stopVoices(tr);
    tr.buffer = buf;
    tr.peaks = DSP.computePeaks(buf, PEAK_BLOCK);
    tr.trimStart = 0;
    tr.trimEnd = buf.duration;
    tr.offset = Math.max(0, offset);
    tr.reversed = false; // the edited audio is baked as heard
    tr.source = null; // no longer matches the original file; re-uploaded as WAV when saved
    tr.audioId = null;
    tr.loudCache = null;
    clampClip(tr);
  }

  // Sample range [s0, s1) of the selection inside the track's clip, or null if they don't overlap.
  function audioRange(tr, t0, t1) {
    if (!tr.buffer) return null;
    const sr = tr.buffer.sampleRate, len = clipLen(tr);
    const a = clamp(t0 - tr.offset, 0, len), b = clamp(t1 - tr.offset, 0, len);
    return b - a > 0.005 ? { s0: Math.round(a * sr), s1: Math.round(b * sr) } : null;
  }

  function afterAudioEdit() {
    renderTimeline();
    renderInspector();
    restartSoon();
  }

  function editCopy(cut) {
    const tr = selTrack();
    if (!tr) { toast(t('selectRangeFirst'), 4000); return; }
    if (S.sel.kind === 'notes') {
      const { b0, b1 } = S.sel;
      const notes = notesInRange(tr, b0, b1);
      S.clipboard = { kind: 'notes', len: b1 - b0, notes: notes.map(n => ({ t: n.t - b0, d: n.d, p: n.p, v: n.v })) };
      if (cut) {
        pushUndo(t('undoCut'), [tr]);
        const set = new Set(notes);
        tr.notes = tr.notes.filter(n => !set.has(n));
        onNotesChanged(tr);
      }
      toast(t(cut ? 'cutBars' : 'copiedBars', { n: (b1 - b0) / 4, notes: notes.length }));
    } else {
      const r = audioRange(tr, S.sel.t0, S.sel.t1);
      if (!r) { toast(t('nothingToCopy')); return; }
      const baked = bakeClip(tr);
      S.clipboard = { kind: 'audio', buffer: DSP.sliceBuffer(S.ctx, baked, r.s0, r.s1) };
      if (cut) {
        pushUndo(t('undoCut'), [tr]);
        setEditedBuffer(tr, DSP.composeBuffer(S.ctx, baked.length, baked.sampleRate, [{ buffer: baked, at: 0 }], [[r.s0, r.s1]]), tr.offset);
        afterAudioEdit();
      }
      toast(t(cut ? 'cutAudio' : 'copiedAudio', { s: S.clipboard.buffer.duration.toFixed(2) }));
    }
    updateEditButtons();
  }

  function editDelete() {
    const tr = selTrack();
    if (!tr) return;
    if (S.sel.kind === 'notes') {
      const notes = notesInRange(tr, S.sel.b0, S.sel.b1);
      if (!notes.length) return;
      pushUndo(t('undoDelete'), [tr]);
      const set = new Set(notes);
      tr.notes = tr.notes.filter(n => !set.has(n));
      onNotesChanged(tr);
    } else {
      const r = audioRange(tr, S.sel.t0, S.sel.t1);
      if (!r) return;
      pushUndo(t('undoDelete'), [tr]);
      const baked = bakeClip(tr);
      setEditedBuffer(tr, DSP.composeBuffer(S.ctx, baked.length, baked.sampleRate, [{ buffer: baked, at: 0 }], [[r.s0, r.s1]]), tr.offset);
      afterAudioEdit();
    }
  }

  // Keep only the selected part of an audio clip.
  function editCrop() {
    const tr = selTrack();
    if (!tr || S.sel.kind !== 'audio') return;
    const r = audioRange(tr, S.sel.t0, S.sel.t1);
    if (!r) { toast(t('nothingToCopy')); return; }
    pushUndo(t('crop'), [tr]);
    const baked = bakeClip(tr);
    setEditedBuffer(tr, DSP.sliceBuffer(S.ctx, baked, r.s0, r.s1), tr.offset + r.s0 / baked.sampleRate);
    afterAudioEdit();
  }

  // Paste into the selected track: at its selection if it has one, otherwise at the playhead.
  // Notes replace the bars they cover; audio overwrites (other tracks stay in sync).
  function editPaste() {
    const c = S.clipboard;
    if (!c) { toast(t('clipboardEmpty')); return; }
    const tr = selected();
    if (!tr) { toast(t('selectTrackFirst')); return; }
    const kind = tr.kind === 'notes' ? 'notes' : 'audio';
    if (c.kind !== kind) { toast(t('pasteKindMismatch'), 4500); return; }
    if (S.recording && S.recording.target === tr) return;
    const selHere = S.sel && S.sel.trackId === tr.id && S.sel.kind === kind;
    if (kind === 'notes') {
      const at = selHere ? S.sel.b0 : Math.floor(position() / barSec() + NOTE_EPS) * 4;
      pushUndo(t('undoPaste'), [tr]);
      const old = new Set(notesInRange(tr, at, at + c.len));
      tr.notes = tr.notes.filter(n => !old.has(n));
      tr.notes.push(...c.notes.map(n => ({ t: at + n.t, d: n.d, p: n.p, v: n.v })));
      onNotesChanged(tr);
      setSelection({ trackId: tr.id, kind: 'notes', b0: at, b1: at + c.len });
      toast(t('pastedBars', { n: c.len / 4, bar: at / 4 + 1 }));
    } else {
      const at = selHere ? S.sel.t0 : position();
      const clipBuf = c.buffer, sr = clipBuf.sampleRate;
      pushUndo(t('undoPaste'), [tr]);
      if (!tr.buffer) {
        setEditedBuffer(tr, clipBuf, at);
        if (!tr.fileName) tr.fileName = t('pastedAudio');
      } else {
        const baked = bakeClip(tr);
        const start = Math.min(tr.offset, at);
        const end = Math.max(tr.offset + baked.duration, at + clipBuf.duration);
        setEditedBuffer(tr, DSP.composeBuffer(S.ctx, (end - start) * sr, sr, [
          { buffer: baked, at: (tr.offset - start) * sr },
          { buffer: clipBuf, at: (at - start) * sr },
        ]), start);
      }
      afterAudioEdit();
      setSelection({ trackId: tr.id, kind: 'audio', t0: at, t1: at + clipBuf.duration });
      toast(t('pastedAudioAt', { s: clipBuf.duration.toFixed(2), at: fmtTime(at) }));
    }
  }

  /* ---------- Global controls ---------- */
  function addEmptyTrack() {
    const tr = createTrack(null, 'other');
    S.selectedId = tr.id;
    renderAll();
  }

  function populateGlobalSelects() {
    const g = $('#genre');
    g.innerHTML = '';
    for (const [id, def] of Object.entries(PRESETS.genres)) g.append(h('option', { value: id, text: L(def.name) }));
    g.value = S.genre;
    const pm = $('#panMode');
    pm.innerHTML = '';
    for (const [id, name] of Object.entries(PRESETS.panModes)) pm.append(h('option', { value: id, text: L(name) }));
    pm.value = S.panMode;
    const mods = $('#amMods');
    mods.innerHTML = '';
    for (const m of AUTO_MODULES) {
      const cb = h('input', { type: 'checkbox', checked: S.autoMods[m] });
      cb.addEventListener('change', () => { S.autoMods[m] = cb.checked; });
      mods.append(h('label', { class: 'chk' }, cb, h('span', { text: t('mod_' + m) })));
    }
    $('#genreDesc').textContent = L(genreDef().desc);
  }

  function syncGlobalControls() {
    $('#bpm').value = S.bpm;
    $('#zoom').value = S.pps;
    $('#snap').checked = S.snap;
    $('#masterVol').value = S.masterVolumeDb;
    $('#masterVolVal').textContent = fmtDb(S.masterVolumeDb) + ' dB';
    $('#masterLimiter').checked = S.limiter;
    populateGlobalSelects();
  }

  function setZoom(pps, anchorClientX) {
    const tl = $('#timeline');
    const hdrW = $('.hdr') ? $('.hdr').offsetWidth : 0;
    const ax = anchorClientX != null ? anchorClientX - tl.getBoundingClientRect().left - hdrW : (tl.clientWidth - hdrW) / 2;
    const tAnchor = (tl.scrollLeft + ax) / S.pps;
    S.pps = clamp(Math.round(pps), 10, 300);
    $('#zoom').value = S.pps;
    renderTimeline();
    tl.scrollLeft = Math.max(0, tAnchor * S.pps - ax);
  }

  function changeLanguage(lang) {
    setLang(lang);
    document.querySelectorAll('.lang-switch button').forEach(b => b.classList.toggle('on', b.dataset.lang === LANG));
    $('#helpBody').innerHTML = t('helpHtml');
    renderServerBadge();
    populateGlobalSelects();
    populateInstrumentMenu();
    updateEditButtons();
    renderAll();
    positionPlayhead();
  }

  function bindGlobalEvents() {
    $('#btnPlay').addEventListener('click', togglePlay);
    $('#btnStop').addEventListener('click', stop);
    $('#btnHome').addEventListener('click', () => { seek(0); $('#timeline').scrollLeft = 0; });
    $('#btnRecord').addEventListener('click', toggleRecord);
    $('#btnAddAudio').addEventListener('click', async () => addAudioFiles(await pickFiles($('#fileAudio'))));
    $('#btnAddEmpty').addEventListener('click', addEmptyTrack);
    $('#addInstrument').addEventListener('change', e => {
      if (e.target.value) addInstrumentTrack(e.target.value);
      e.target.value = '';
    });
    $('#toolMove').addEventListener('click', () => setTool('move'));
    $('#toolRange').addEventListener('click', () => setTool('range'));
    $('#btnCut').addEventListener('click', () => editCopy(true));
    $('#btnCopy').addEventListener('click', () => editCopy(false));
    $('#btnPaste').addEventListener('click', editPaste);
    $('#btnDeleteSel').addEventListener('click', editDelete);
    $('#btnCrop').addEventListener('click', editCrop);
    $('#btnUndo').addEventListener('click', undo);
    $('#btnRedo').addEventListener('click', redo);
    $('#btnNoteClose').addEventListener('click', () => $('#noteDlg').close());
    $('#btnSave').addEventListener('click', saveProject);
    $('#btnLoad').addEventListener('click', () => openSettingsFile(null));
    $('#btnExport').addEventListener('click', exportMix);
    $('#btnServerSave').addEventListener('click', saveToServer);
    $('#btnServerOpen').addEventListener('click', openProjectsDialog);
    $('#btnSeparate').addEventListener('click', separateButton);
    $('#btnSepClose').addEventListener('click', () => $('#sepDlg').close());
    $('#btnCleanClose').addEventListener('click', () => $('#cleanDlg').close());
    $('#cleanDlg').addEventListener('close', () => { stopCleanPreview(); S.clean = null; });
    $('#btnProjectsClose').addEventListener('click', () => $('#projectsDlg').close());
    $('#serverStatus').addEventListener('click', async () => {
      if (S.serverLocked || (S.server && S.server.auth && !API.hasKey())) {
        const key = prompt(t('enterAccessKey'));
        if (key == null) return;
        API.setKey(key);
        await checkServer();
        toast(S.serverLocked ? t('badAccessKey') : t('serverOnline'));
        return;
      }
      checkServer();
    });
    $('#btnAutoMix').addEventListener('click', autoMixAll);
    $('#btnResetAll').addEventListener('click', resetAll);

    $('#bpm').addEventListener('change', e => {
      const v = parseInt(e.target.value, 10);
      S.bpm = Number.isFinite(v) ? clamp(v, 40, 240) : 120;
      e.target.value = S.bpm;
      S.tracks.forEach(applyChannel);
      renderTimeline();
      refreshCtrls();
      if (S.noteEditor) S.noteEditor.refresh();
      restartSoon(); // note positions are in beats, so their timing changed
    });
    $('#zoom').addEventListener('input', e => setZoom(+e.target.value));
    $('#snap').addEventListener('change', e => { S.snap = e.target.checked; });
    $('#masterVol').addEventListener('input', e => {
      S.masterVolumeDb = +e.target.value;
      $('#masterVolVal').textContent = fmtDb(S.masterVolumeDb) + ' dB';
      S.master.apply({ volumeDb: S.masterVolumeDb, limiter: S.limiter });
    });
    $('#masterVol').addEventListener('dblclick', e => { e.target.value = 0; e.target.dispatchEvent(new Event('input')); });
    $('#masterLimiter').addEventListener('change', e => {
      S.limiter = e.target.checked;
      S.master.apply({ volumeDb: S.masterVolumeDb, limiter: S.limiter });
    });
    $('#genre').addEventListener('change', e => {
      S.genre = e.target.value;
      $('#genreDesc').textContent = L(genreDef().desc);
      renderInspector(); // refresh auto-button tooltips
    });
    $('#panMode').addEventListener('change', e => { S.panMode = e.target.value; });

    document.querySelectorAll('.lang-switch button').forEach(b => b.addEventListener('click', () => changeLanguage(b.dataset.lang)));
    $('#btnHelp').addEventListener('click', () => $('#helpDlg').showModal());
    $('#btnHelpClose').addEventListener('click', () => $('#helpDlg').close());
    $('#helpDlg').addEventListener('click', e => { if (e.target.id === 'helpDlg') $('#helpDlg').close(); });

    // Ctrl/Cmd + wheel zooms the timeline around the pointer.
    $('#timeline').addEventListener('wheel', e => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setZoom(S.pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX);
    }, { passive: false });

    // Drag & drop audio files anywhere on the page.
    let dragDepth = 0;
    const overlay = $('#dropOverlay');
    const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; overlay.classList.add('show'); });
    window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) overlay.classList.remove('show'); });
    window.addEventListener('drop', e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      overlay.classList.remove('show');
      const files = [...e.dataTransfer.files];
      const json = files.find(f => /\.json$/i.test(f.name));
      if (json) {
        json.text().then(txt => {
          try {
            const o = JSON.parse(txt);
            if (o.type === 'channel-strip') { const tr = selected(); if (tr) loadStrip(tr, o); else toast(t('selectTrackFirst')); }
            else if (Array.isArray(o.tracks)) loadProject(o);
            else toast(t('badFile'));
          } catch (err) { toast(t('badFile')); }
        });
      }
      addAudioFiles(files);
    });

    // Keyboard shortcuts (ignored while typing in form fields).
    window.addEventListener('keydown', e => {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' && !['range', 'checkbox'].includes(e.target.type) || tag === 'select' || tag === 'textarea';
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(); return; }
      if (document.querySelector('dialog[open]')) return; // dialogs handle their own keys
      if (!typing && (e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'c') editCopy(false);
        else if (k === 'x') editCopy(true);
        else if (k === 'v') editPaste();
        else if (k === 'z') { if (e.shiftKey) redo(); else undo(); }
        else if (k === 'y') redo();
        else return;
        e.preventDefault();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      // A focused button would also "click" on Space; blur it so the shortcut fires only once.
      if (e.key === ' ' && tag === 'button') e.target.blur();
      const tr = selected();
      switch (e.key) {
        case ' ': e.preventDefault(); togglePlay(); break;
        case 'Home': e.preventDefault(); seek(0); break;
        case 'r': case 'R': toggleRecord(); break;
        case 'm': case 'M': if (tr) { tr.mute = !tr.mute; afterMix(tr); } break;
        case 's': case 'S': if (tr) { tr.solo = !tr.solo; afterMix(tr); } break;
        case 'b': case 'B': if (tr) splitTrack(tr); break;
        case 'v': case 'V': setTool('move'); break;
        case 'e': case 'E': setTool('range'); break;
        case 'Delete': case 'Backspace': if (S.sel) { e.preventDefault(); editDelete(); } break;
        case 'Escape': setSelection(null); break;
        case 'Enter': if (tr && tr.kind === 'notes') { e.preventDefault(); openBarEditor(tr, defaultBarFor(tr)); } break;
        case 'ArrowUp': case 'ArrowDown': {
          if (!S.tracks.length) break;
          e.preventDefault();
          const i = tr ? S.tracks.indexOf(tr) : -1;
          const j = clamp(i + (e.key === 'ArrowUp' ? -1 : 1), 0, S.tracks.length - 1);
          selectTrack(S.tracks[j].id);
          break;
        }
        case '?': $('#helpDlg').showModal(); break;
      }
    });

    window.addEventListener('resize', debounce(() => { drawEqCurve(); }, 100));
    // Browsers require a user gesture before audio can start.
    window.addEventListener('pointerdown', () => { if (S.ctx.state === 'suspended') S.ctx.resume(); }, { once: true });
  }

  /* ---------- Init ---------- */
  function init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      document.body.innerHTML = '<p style="padding:2rem">This browser does not support the Web Audio API.</p>';
      return;
    }
    S.ctx = new AC({ latencyHint: 'interactive' });
    S.master = new DSP.Master(S.ctx);
    S.master.apply({ volumeDb: S.masterVolumeDb, limiter: S.limiter });
    S.eqScratch = DSP.createEqNodes(S.ctx);
    S.noteEditor = createNoteEditor({
      S, h, t, L, toast,
      onNotesChanged,
      pushUndo,
      undo,
      redo,
      updateEditButtons,
      preview: previewNote,
      playBar,
      onBarChanged: (tr, bar) => setSelection({ trackId: tr.id, kind: 'notes', b0: bar * 4, b1: bar * 4 + 4 }),
    });
    bindGlobalEvents();
    syncGlobalControls();
    changeLanguage(LANG);
    checkServer();
    updateTransportUI();
    requestAnimationFrame(frame);
  }

  init();
})();
