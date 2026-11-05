/* Preset library: EQ, compressor, reverb, delay, volume, pan and genre templates. */
(function (global) {
  'use strict';

  /* ---------- Defaults ---------- */
  const EQ_DEFAULT = {
    enabled: true,
    hpf: { on: false, freq: 30 },
    ls: { freq: 100, gain: 0 },
    p1: { freq: 250, gain: 0, q: 1 },
    p2: { freq: 1000, gain: 0, q: 1 },
    p3: { freq: 4000, gain: 0, q: 1 },
    hs: { freq: 8000, gain: 0 },
    lpf: { on: false, freq: 18000 },
  };
  const COMP_DEFAULT = { enabled: false, threshold: -18, ratio: 3, attack: 10, release: 150, knee: 6, makeup: 0 };
  const REVERB_DEFAULT = { enabled: false, send: 0.2, decay: 1.8, preDelay: 20, tone: 8000 };
  const DELAY_DEFAULT = { enabled: false, send: 0.2, time: 375, sync: 'off', feedback: 0.3, tone: 5000 };

  /*
   * Compact EQ builder.
   * hpf/lpf: cutoff frequency (enables the filter)
   * ls/hs: [freq, gain]   p1..p3: [freq, gain, q]
   */
  function eq(o) {
    const e = JSON.parse(JSON.stringify(EQ_DEFAULT));
    if (o.hpf) e.hpf = { on: true, freq: o.hpf };
    if (o.lpf) e.lpf = { on: true, freq: o.lpf };
    if (o.ls) e.ls = { freq: o.ls[0], gain: o.ls[1] };
    if (o.hs) e.hs = { freq: o.hs[0], gain: o.hs[1] };
    ['p1', 'p2', 'p3'].forEach(k => { if (o[k]) e[k] = { freq: o[k][0], gain: o[k][1], q: o[k][2] || 1 }; });
    return e;
  }
  // Compact compressor builder: threshold dB, ratio, attack ms, release ms, knee dB, makeup dB.
  const comp = (threshold, ratio, attack, release, knee, makeup) => ({ enabled: true, threshold, ratio, attack, release, knee, makeup });
  const rev = (send, decay, preDelay, tone) => ({ enabled: true, send, decay, preDelay, tone });
  const dly = (send, time, sync, feedback, tone) => ({ enabled: true, send, time, sync, feedback, tone });
  const n = (en, zh) => ({ en, zh });

  /* ---------- EQ presets ---------- */
  const EQ = {
    flat: { group: 'general', name: n('Flat (no change)', '平直（不調整）'), data: eq({}) },
    lowCut: { group: 'general', name: n('Low cut – remove rumble', '低切－去除低頻噪音'), data: eq({ hpf: 80 }) },
    clarity: { group: 'general', name: n('Clarity – reduce mud', '清晰度－減少混濁'), data: eq({ hpf: 60, p1: [300, -3, 1.2], hs: [10000, 2] }) },
    telephone: { group: 'general', name: n('Telephone / Lo-fi', '電話／Lo-fi 效果'), data: eq({ hpf: 450, lpf: 3200, p2: [1500, 5, 0.8] }) },

    vocalPop: { group: 'vocal', name: n('Vocal – Pop', '人聲－流行'), data: eq({ hpf: 100, p1: [300, -2.5, 1.2], p2: [4000, 2.5, 1], p3: [7500, -1.5, 4], hs: [12000, 2.5] }) },
    vocalMale: { group: 'vocal', name: n('Vocal – Male', '人聲－男聲'), data: eq({ hpf: 80, ls: [150, -1], p1: [300, -3, 1.2], p2: [3500, 3, 1], p3: [7000, -1.5, 3], hs: [12000, 2] }) },
    vocalFemale: { group: 'vocal', name: n('Vocal – Female', '人聲－女聲'), data: eq({ hpf: 120, ls: [200, -1], p1: [400, -2, 1.4], p2: [3000, 2, 1], p3: [8000, -2, 3], hs: [12000, 3] }) },
    vocalRap: { group: 'vocal', name: n('Vocal – Rap', '人聲－饒舌'), data: eq({ hpf: 100, ls: [180, 1], p1: [250, -3, 1.2], p2: [2500, 3, 1], p3: [6500, -1.5, 4], hs: [10000, 2] }) },
    vocalBacking: { group: 'vocal', name: n('Backing vocals', '和聲／合音'), data: eq({ hpf: 180, p1: [400, -3, 1], p2: [2500, -1, 1], hs: [10000, 3] }) },
    vocalPodcast: { group: 'vocal', name: n('Speech / Podcast', '口白／Podcast'), data: eq({ hpf: 80, p1: [250, -2, 1], p2: [3000, 2, 1], p3: [6500, -2, 4], hs: [10000, 1] }) },
    micDynamic: { group: 'vocal', name: n('Dynamic mic (SM58-type)', '動圈麥克風人聲'), data: eq({ hpf: 80, p1: [200, -1.5, 1], p2: [5000, 3, 0.8], hs: [10000, 3.5] }) },
    micCondenser: { group: 'vocal', name: n('Condenser mic (tame harshness)', '電容麥克風人聲（柔化刺耳）'), data: eq({ hpf: 90, p1: [250, -2, 1], p2: [3000, 1, 1], p3: [6500, -2.5, 3], hs: [12000, 1] }) },

    kick: { group: 'drums', name: n('Kick drum', '大鼓 Kick'), data: eq({ hpf: 30, ls: [60, 4], p1: [350, -5, 1.5], p2: [3500, 4, 1.2], hs: [10000, -2] }) },
    snare: { group: 'drums', name: n('Snare', '小鼓 Snare'), data: eq({ hpf: 80, p1: [200, 3, 1.4], p2: [900, -3, 2], p3: [5000, 3, 1], hs: [10000, 2] }) },
    hihat: { group: 'drums', name: n('Hi-hat / Cymbals', '腳踏鈸／銅鈸'), data: eq({ hpf: 300, p1: [600, -2, 1], p3: [8000, 1.5, 1], hs: [12000, 2] }) },
    drumKit: { group: 'drums', name: n('Full kit / Overheads', '整組鼓／Overhead'), data: eq({ hpf: 40, ls: [80, 2], p1: [400, -3, 1], p2: [4000, 1.5, 1], hs: [10000, 3] }) },

    bassElectric: { group: 'bass', name: n('Electric bass', '電貝斯'), data: eq({ hpf: 35, ls: [80, 3], p1: [250, -3, 1.2], p2: [800, 2, 1.5], p3: [2500, 2, 1.5], hs: [6000, -3] }) },
    synthBass: { group: 'bass', name: n('Synth / 808 bass', '合成器貝斯／808'), data: eq({ hpf: 25, ls: [55, 3], p1: [300, -4, 1], p2: [1000, 1, 1], hs: [5000, -4] }) },
    bassUpright: { group: 'bass', name: n('Upright / acoustic bass', '低音大提琴'), data: eq({ hpf: 40, ls: [90, 2], p1: [300, -2, 1], p2: [1200, 1.5, 1.2], hs: [7000, -2] }) },

    guitarAcoustic: { group: 'guitar', name: n('Acoustic guitar', '木吉他'), data: eq({ hpf: 90, ls: [120, -2], p1: [250, -3, 1], p2: [3000, 2, 1], hs: [12000, 3] }) },
    guitarClean: { group: 'guitar', name: n('Electric guitar – clean', '電吉他－乾淨音色'), data: eq({ hpf: 90, p1: [400, -2, 1], p2: [2500, 2, 1], hs: [8000, 1] }) },
    guitarDist: { group: 'guitar', name: n('Electric guitar – distorted', '電吉他－破音'), data: eq({ hpf: 100, lpf: 11000, p1: [250, -2, 1], p2: [1500, 2, 1], p3: [4000, -2, 2], hs: [8000, -2] }) },

    piano: { group: 'keys', name: n('Piano', '鋼琴'), data: eq({ hpf: 60, p1: [300, -2, 1], p2: [2500, 1.5, 1], hs: [10000, 2] }) },
    electricPiano: { group: 'keys', name: n('Electric piano / Organ', '電鋼琴／風琴'), data: eq({ hpf: 80, p1: [500, -2, 1], p2: [1500, 1, 1], hs: [8000, 1] }) },
    synthPad: { group: 'keys', name: n('Synth pad', '合成器 Pad'), data: eq({ hpf: 150, p1: [400, -2, 1], p2: [2000, -1, 1], hs: [10000, 2] }) },
    synthLead: { group: 'keys', name: n('Synth lead', '合成器 Lead'), data: eq({ hpf: 120, p1: [300, -2, 1], p2: [2500, 2, 1], hs: [10000, 1] }) },
  };

  /* ---------- Compressor presets ---------- */
  const COMP = {
    off: { group: 'general', name: n('Off (bypass)', '關閉（旁通）'), data: { enabled: false } },
    gentle: { group: 'general', name: n('Gentle leveling', '輕柔平衡'), data: comp(-18, 2, 20, 200, 10, 2) },

    vocalPop: { group: 'vocal', name: n('Vocal – Pop', '人聲－流行'), data: comp(-20, 4, 5, 120, 6, 4) },
    vocalBallad: { group: 'vocal', name: n('Vocal – Ballad (gentle)', '人聲－抒情（輕柔）'), data: comp(-18, 2.5, 15, 200, 10, 3) },
    vocalRap: { group: 'vocal', name: n('Vocal – Rap (aggressive)', '人聲－饒舌（強壓縮）'), data: comp(-24, 6, 2, 80, 4, 6) },
    speech: { group: 'vocal', name: n('Speech / Podcast', '口白／Podcast'), data: comp(-22, 3.5, 8, 150, 8, 4) },

    kick: { group: 'drums', name: n('Kick – punch', '大鼓－衝擊感'), data: comp(-14, 4, 15, 80, 2, 2) },
    snare: { group: 'drums', name: n('Snare – snap', '小鼓－脆度'), data: comp(-16, 4, 8, 120, 3, 3) },
    drumBus: { group: 'drums', name: n('Drum bus – punch', '鼓組匯流排－厚實'), data: comp(-16, 3, 25, 150, 6, 2) },

    bass: { group: 'bass', name: n('Bass – even', '貝斯－平穩'), data: comp(-20, 4, 15, 180, 6, 3) },
    bass808: { group: 'bass', name: n('808 – controlled', '808－控制動態'), data: comp(-16, 3, 25, 250, 6, 2) },

    guitarAcoustic: { group: 'instruments', name: n('Acoustic guitar', '木吉他'), data: comp(-20, 3, 12, 150, 8, 3) },
    guitarElectric: { group: 'instruments', name: n('Electric guitar', '電吉他'), data: comp(-16, 2.5, 20, 160, 8, 1.5) },
    keys: { group: 'instruments', name: n('Keys / Piano / Synth', '鍵盤／鋼琴／合成器'), data: comp(-20, 2.5, 20, 220, 10, 2) },

    busGlue: { group: 'bus', name: n('Mix bus glue', '整體黏合（Glue）'), data: comp(-12, 2, 30, 300, 6, 1) },
    limiter: { group: 'bus', name: n('Limiter', '限幅器'), data: comp(-4, 20, 1, 60, 0, 3) },
  };

  /* ---------- Reverb presets ---------- */
  const REVERB = {
    none: { group: 'general', name: n('None (dry)', '無（乾聲）'), data: { enabled: false } },
    smallRoom: { group: 'space', name: n('Small room', '小房間'), data: rev(0.15, 0.6, 5, 7000) },
    drumRoom: { group: 'space', name: n('Drum room', '鼓室'), data: rev(0.18, 0.9, 0, 8000) },
    largeHall: { group: 'space', name: n('Large hall', '大廳'), data: rev(0.22, 2.8, 30, 6500) },
    cathedral: { group: 'space', name: n('Cathedral', '教堂'), data: rev(0.28, 4.5, 40, 5000) },
    plate: { group: 'vocal', name: n('Plate (vocal shine)', '板式殘響（人聲亮度）'), data: rev(0.2, 1.6, 15, 9000) },
    vocalHall: { group: 'vocal', name: n('Ballad vocal hall', '抒情人聲大廳'), data: rev(0.25, 2.2, 60, 7500) },
    rapVocal: { group: 'vocal', name: n('Rap – short & tight', '饒舌－短而緊'), data: rev(0.08, 0.7, 10, 6000) },
    ambient: { group: 'creative', name: n('Ambient wash', '氛圍長殘響'), data: rev(0.4, 6.5, 80, 4500) },
  };

  /* ---------- Delay presets ---------- */
  const DELAY = {
    none: { group: 'general', name: n('None', '無'), data: { enabled: false } },
    slapback: { group: 'vocal', name: n('Slapback (rock / rockabilly)', 'Slapback（搖滾）'), data: dly(0.18, 110, 'off', 0.1, 5000) },
    rapThrow: { group: 'vocal', name: n('Rap – 1/4 throw', '饒舌－1/4 拍回音'), data: dly(0.14, 500, '1/4', 0.2, 3500) },
    vocalBallad: { group: 'vocal', name: n('Ballad vocal – soft 1/4', '抒情人聲－柔和 1/4'), data: dly(0.12, 500, '1/4', 0.28, 4000) },
    quarter: { group: 'sync', name: n('1/4 note', '1/4 拍'), data: dly(0.2, 500, '1/4', 0.3, 6000) },
    eighth: { group: 'sync', name: n('1/8 note', '1/8 拍'), data: dly(0.2, 250, '1/8', 0.3, 6000) },
    eighthDotted: { group: 'sync', name: n('Dotted 1/8 (pop / EDM)', '附點 1/8（流行／電子）'), data: dly(0.18, 375, '1/8d', 0.35, 5000) },
    quarterTriplet: { group: 'sync', name: n('1/4 triplet', '1/4 三連音'), data: dly(0.18, 333, '1/4t', 0.3, 5000) },
    doubler: { group: 'creative', name: n('Doubler (thicken)', '加厚（Doubler）'), data: dly(0.25, 25, 'off', 0, 12000) },
    dubLong: { group: 'creative', name: n('Dub – long 1/2', 'Dub－長 1/2 拍'), data: dly(0.25, 1000, '1/2', 0.55, 2500) },
  };

  /* ---------- Volume / Pan presets ---------- */
  const VOLUME = {
    auto: { group: 'smart', name: n('Auto level (role + genre)', '自動音量（依角色與曲風）'), auto: true },
    unity: { group: 'fixed', name: n('0 dB (unity)', '0 dB（原音量）'), db: 0 },
    plus3: { group: 'fixed', name: n('+3 dB (feature)', '+3 dB（突出）'), db: 3 },
    minus3: { group: 'fixed', name: n('−3 dB', '−3 dB'), db: -3 },
    minus6: { group: 'fixed', name: n('−6 dB', '−6 dB'), db: -6 },
    bed: { group: 'fixed', name: n('−12 dB (background bed)', '−12 dB（背景襯底）'), db: -12 },
  };
  const PAN = {
    auto: { group: 'smart', name: n('Auto (role + genre)', '自動（依角色與曲風）'), auto: true },
    center: { group: 'fixed', name: n('Center', '置中'), pan: 0 },
    l30: { group: 'fixed', name: n('Left 30%', '左 30%'), pan: -0.3 },
    r30: { group: 'fixed', name: n('Right 30%', '右 30%'), pan: 0.3 },
    l60: { group: 'fixed', name: n('Left 60%', '左 60%'), pan: -0.6 },
    r60: { group: 'fixed', name: n('Right 60%', '右 60%'), pan: 0.6 },
    hardL: { group: 'fixed', name: n('Hard left', '最左'), pan: -1 },
    hardR: { group: 'fixed', name: n('Hard right', '最右'), pan: 1 },
  };

  /* ---------- Genre templates ----------
   * For each track role:
   *   level  : target loudness (RMS dBFS) used by auto-level
   *   pan    : fixed pan position, or
   *   spread : tracks sharing this role are spread between -spread..+spread
   *   eq / comp / reverb / delay : preset ids
   */
  const r = (level, panOrSpread, eqId, compId, reverbId, delayId, isSpread) => (
    isSpread
      ? { level, spread: panOrSpread, eq: eqId, comp: compId, reverb: reverbId, delay: delayId }
      : { level, pan: panOrSpread, eq: eqId, comp: compId, reverb: reverbId, delay: delayId }
  );
  const S = true; // marks a "spread" pan role

  const GENRES = {
    pop: {
      name: n('Pop', '流行'),
      desc: n('Upfront vocal, plate reverb, dotted-1/8 delay, balanced band.', '人聲在前、板式殘響、附點 1/8 回音，樂團平衡。'),
      roles: {
        vocal: r(-16, 0, 'vocalPop', 'vocalPop', 'plate', 'eighthDotted'),
        backing: r(-22, 0.5, 'vocalBacking', 'vocalPop', 'largeHall', 'none', S),
        kick: r(-18, 0, 'kick', 'kick', 'none', 'none'),
        snare: r(-20, 0, 'snare', 'snare', 'drumRoom', 'none'),
        drums: r(-20, 0, 'drumKit', 'drumBus', 'drumRoom', 'none'),
        bass: r(-19, 0, 'bassElectric', 'bass', 'none', 'none'),
        acousticGuitar: r(-22, 0.5, 'guitarAcoustic', 'guitarAcoustic', 'smallRoom', 'none', S),
        electricGuitar: r(-22, 0.6, 'guitarClean', 'guitarElectric', 'smallRoom', 'none', S),
        piano: r(-22, 0.3, 'piano', 'keys', 'smallRoom', 'none', S),
        synth: r(-23, 0.5, 'synthPad', 'keys', 'largeHall', 'none', S),
        other: r(-22, 0, 'lowCut', 'gentle', 'smallRoom', 'none'),
      },
    },
    hiphop: {
      name: n('Hip-hop / Rap', '嘻哈／饒舌'),
      desc: n('Loud, dry rap vocal, heavy kick and 808, tight space.', '響亮乾淨的饒舌人聲、厚重大鼓與 808、空間緊湊。'),
      roles: {
        vocal: r(-15, 0, 'vocalRap', 'vocalRap', 'rapVocal', 'rapThrow'),
        backing: r(-21, 0.6, 'vocalBacking', 'vocalRap', 'rapVocal', 'none', S),
        kick: r(-16, 0, 'kick', 'kick', 'none', 'none'),
        snare: r(-18, 0, 'snare', 'snare', 'smallRoom', 'none'),
        drums: r(-18, 0, 'drumKit', 'drumBus', 'none', 'none'),
        bass: r(-17, 0, 'synthBass', 'bass808', 'none', 'none'),
        acousticGuitar: r(-23, 0.5, 'guitarAcoustic', 'guitarAcoustic', 'smallRoom', 'none', S),
        electricGuitar: r(-23, 0.6, 'guitarClean', 'guitarElectric', 'smallRoom', 'none', S),
        piano: r(-22, 0.3, 'piano', 'keys', 'smallRoom', 'none', S),
        synth: r(-22, 0.5, 'synthLead', 'keys', 'plate', 'none', S),
        other: r(-23, 0, 'lowCut', 'gentle', 'none', 'none'),
      },
    },
    rock: {
      name: n('Rock', '搖滾'),
      desc: n('Wide double-tracked guitars, punchy drums, slapback vocal.', '左右寬廣的吉他、有衝擊力的鼓、Slapback 人聲。'),
      roles: {
        vocal: r(-17, 0, 'micDynamic', 'vocalPop', 'plate', 'slapback'),
        backing: r(-22, 0.5, 'vocalBacking', 'vocalPop', 'plate', 'none', S),
        kick: r(-17, 0, 'kick', 'kick', 'none', 'none'),
        snare: r(-18, 0, 'snare', 'snare', 'drumRoom', 'none'),
        drums: r(-18, 0, 'drumKit', 'drumBus', 'drumRoom', 'none'),
        bass: r(-19, 0, 'bassElectric', 'bass', 'none', 'none'),
        acousticGuitar: r(-22, 0.5, 'guitarAcoustic', 'guitarAcoustic', 'smallRoom', 'none', S),
        electricGuitar: r(-19, 0.85, 'guitarDist', 'guitarElectric', 'smallRoom', 'none', S),
        piano: r(-23, 0.3, 'piano', 'keys', 'smallRoom', 'none', S),
        synth: r(-24, 0.5, 'synthPad', 'keys', 'largeHall', 'none', S),
        other: r(-22, 0, 'lowCut', 'gentle', 'smallRoom', 'none'),
      },
    },
    edm: {
      name: n('EDM / Electronic', '電子舞曲 EDM'),
      desc: n('Dominant kick and sub bass, big hall reverbs, synced delays.', '突出的大鼓與低頻、大廳殘響、節拍同步回音。'),
      roles: {
        vocal: r(-17, 0, 'vocalPop', 'vocalPop', 'largeHall', 'eighthDotted'),
        backing: r(-22, 0.6, 'vocalBacking', 'vocalPop', 'largeHall', 'quarter', S),
        kick: r(-15, 0, 'kick', 'kick', 'none', 'none'),
        snare: r(-19, 0, 'snare', 'snare', 'plate', 'none'),
        drums: r(-19, 0, 'drumKit', 'drumBus', 'none', 'none'),
        bass: r(-18, 0, 'synthBass', 'bass808', 'none', 'none'),
        acousticGuitar: r(-23, 0.5, 'guitarAcoustic', 'guitarAcoustic', 'plate', 'eighth', S),
        electricGuitar: r(-22, 0.6, 'guitarClean', 'guitarElectric', 'plate', 'none', S),
        piano: r(-22, 0.3, 'piano', 'keys', 'largeHall', 'none', S),
        synth: r(-20, 0.6, 'synthLead', 'keys', 'largeHall', 'eighthDotted', S),
        other: r(-22, 0, 'lowCut', 'gentle', 'plate', 'none'),
      },
    },
    ballad: {
      name: n('Ballad / Acoustic', '抒情／木吉他'),
      desc: n('Natural dynamics, warm vocal hall, guitar and piano forward.', '自然動態、溫暖人聲殘響，吉他與鋼琴較明顯。'),
      roles: {
        vocal: r(-16, 0, 'vocalPop', 'vocalBallad', 'vocalHall', 'vocalBallad'),
        backing: r(-21, 0.5, 'vocalBacking', 'vocalBallad', 'vocalHall', 'none', S),
        kick: r(-21, 0, 'kick', 'kick', 'smallRoom', 'none'),
        snare: r(-22, 0, 'snare', 'snare', 'smallRoom', 'none'),
        drums: r(-22, 0, 'drumKit', 'drumBus', 'smallRoom', 'none'),
        bass: r(-21, 0, 'bassElectric', 'bass', 'none', 'none'),
        acousticGuitar: r(-19, 0.45, 'guitarAcoustic', 'guitarAcoustic', 'smallRoom', 'none', S),
        electricGuitar: r(-21, 0.5, 'guitarClean', 'guitarElectric', 'plate', 'none', S),
        piano: r(-19, 0.25, 'piano', 'keys', 'largeHall', 'none', S),
        synth: r(-24, 0.5, 'synthPad', 'keys', 'largeHall', 'none', S),
        other: r(-22, 0, 'lowCut', 'gentle', 'smallRoom', 'none'),
      },
    },
    podcast: {
      name: n('Podcast / Speech', 'Podcast／口白'),
      desc: n('Clear, compressed voices; music tucked far underneath.', '清楚且穩定的人聲，音樂作為低音量背景。'),
      roles: {
        vocal: r(-16, 0, 'vocalPodcast', 'speech', 'none', 'none'),
        backing: r(-17, 0.2, 'vocalPodcast', 'speech', 'none', 'none', S),
        kick: r(-32, 0, 'lowCut', 'gentle', 'none', 'none'),
        snare: r(-32, 0, 'lowCut', 'gentle', 'none', 'none'),
        drums: r(-32, 0, 'lowCut', 'gentle', 'none', 'none'),
        bass: r(-32, 0, 'lowCut', 'gentle', 'none', 'none'),
        acousticGuitar: r(-31, 0.4, 'lowCut', 'gentle', 'none', 'none', S),
        electricGuitar: r(-31, 0.4, 'lowCut', 'gentle', 'none', 'none', S),
        piano: r(-31, 0.3, 'lowCut', 'gentle', 'none', 'none', S),
        synth: r(-31, 0.4, 'lowCut', 'gentle', 'none', 'none', S),
        other: r(-30, 0, 'lowCut', 'gentle', 'none', 'none'),
      },
    },
  };

  const PAN_MODES = {
    genre: n('Genre default', '依曲風預設'),
    wide: n('Wide', '寬廣'),
    lcr: n('LCR (hard L / C / R)', 'LCR（左／中／右）'),
    mono: n('Mono (all center)', '單聲道（全部置中）'),
  };

  global.PRESETS = {
    eqDefault: EQ_DEFAULT,
    compDefault: COMP_DEFAULT,
    reverbDefault: REVERB_DEFAULT,
    delayDefault: DELAY_DEFAULT,
    eq: EQ,
    comp: COMP,
    reverb: REVERB,
    delay: DELAY,
    volume: VOLUME,
    pan: PAN,
    genres: GENRES,
    panModes: PAN_MODES,
  };
})(window);
