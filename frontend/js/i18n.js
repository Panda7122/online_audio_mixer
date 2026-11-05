/* Internationalization: UI strings (Traditional Chinese / English) and help content. */

const I18N = {
  en: {
    appTitle: 'Online Audio Mixer',
    help: 'Help',
    helpTitle: 'User guide',
    toStart: 'Go to start (Home)',
    playPause: 'Play / Pause (Space)',
    stop: 'Stop',
    record: 'Record (R)',
    bpm: 'BPM',
    zoom: 'Zoom',
    snap: 'Snap to beat',
    addAudio: 'Add audio',
    addEmpty: '+ Empty track',
    saveSettings: 'Save settings',
    loadSettings: 'Load settings',
    exportWav: 'Export WAV',
    master: 'Master',
    limiter: 'Limiter',
    autoMix: 'Auto mix',
    genre: 'Genre',
    stereoWidth: 'Stereo',
    autoMixAll: 'Auto mix all tracks',
    resetAll: 'Reset all',
    emptyHint: '<strong>No tracks yet.</strong><br>Drop audio files here, click <b>+ Add audio</b>, or press <b>●</b> to record from your microphone.',
    dropHere: 'Drop audio files (or a settings .json) to import',

    mod_volume: 'Volume', mod_pan: 'Pan', mod_eq: 'EQ', mod_comp: 'Compression', mod_fx: 'Reverb / Delay', mod_reverb: 'Reverb', mod_delay: 'Delay',

    role: 'Role',
    role_vocal: 'Lead vocal', role_backing: 'Backing vocal', role_kick: 'Kick', role_snare: 'Snare', role_drums: 'Drums / Kit',
    role_bass: 'Bass', role_acousticGuitar: 'Acoustic guitar', role_electricGuitar: 'Electric guitar', role_piano: 'Piano / Keys',
    role_synth: 'Synth', role_other: 'Other',

    trackN: 'Track {n}',
    track: 'Track',
    tracksCount: '{n} tracks',
    mute: 'Mute', solo: 'Solo',
    volShort: 'Vol', panShort: 'Pan',
    loadAudio: 'Load audio',
    replaceAudio: 'Replace audio',
    orRecord: 'or select this track and press ● to record',
    recLane: 'Recording…',
    trimHandle: 'Drag to trim',
    clipTip: 'Drag to move · drag the edges to trim',
    barBeat: 'Bar',
    selectTrackHint: 'Select a track to open its channel strip (editing, volume, pan, EQ, compression, reverb and delay).',

    saveStrip: 'Save track settings', saveStripTip: 'Download this track\'s volume, pan, EQ, compressor, reverb and delay as a .json file',
    loadStrip: 'Load track settings', loadStripTip: 'Apply a track-settings .json file to this track',

    trackCard: 'Track & editing',
    name: 'Name',
    mono: 'mono', stereo: 'stereo',
    noAudio: 'No audio loaded yet.',
    recordHere: 'Record here', recordHereTip: 'Record from the microphone into this empty track',
    normalize: 'Normalize', normalizeTip: 'Set clip gain so the peak reaches −1 dBFS',
    reverse: 'Reverse',
    split: 'Split at playhead', splitTip: 'Cut the clip at the playhead into two tracks (shortcut: B)',
    duplicate: 'Duplicate',
    moveUp: 'Move up', moveDown: 'Move down',
    delete: 'Delete',
    offset: 'Start position',
    trimStart: 'Trim start',
    trimEnd: 'Trim end',
    fadeIn: 'Fade in',
    fadeOut: 'Fade out',
    clipGain: 'Clip gain',
    needAudioForEdit: 'Load or record audio to enable editing.',

    mixCard: 'Volume balance & panning',
    volume: 'Volume',
    pan: 'Pan',
    mixHint: 'Tip: double-click any slider to reset it. Type values directly into the number boxes (pan accepts L30 / C / R30).',

    eqCard: 'EQ (equalizer)',
    enabled: 'On',
    eqHint: 'Drag the points to shape the curve · mouse wheel on a peak point changes Q · double-click a point to reset it.',
    band_hpf: 'High-pass', band_ls: 'Low shelf', band_p1: 'Low-mid', band_p2: 'Mid', band_p3: 'High-mid', band_hs: 'High shelf', band_lpf: 'Low-pass',
    freq: 'Freq', gain: 'Gain',

    compCard: 'Compression',
    threshold: 'Threshold', ratio: 'Ratio', attack: 'Attack', release: 'Release', knee: 'Knee', makeup: 'Make-up gain',
    gr: 'Gain reduction',

    reverbCard: 'Reverb',
    send: 'Send', decay: 'Decay', preDelay: 'Pre-delay', tone: 'Tone',
    delayCard: 'Delay',
    sync: 'Tempo sync', syncOff: 'Off (use ms)', time: 'Time', feedback: 'Feedback',
    note_1_2: '1/2 note', note_1_4: '1/4 note', note_1_4t: '1/4 triplet', note_1_8: '1/8 note', note_1_8d: 'Dotted 1/8', note_1_8t: '1/8 triplet', note_1_16: '1/16 note',

    preset: 'Preset',
    presetCustom: '— Custom —',
    grp_general: 'General', grp_vocal: 'Vocals', grp_drums: 'Drums', grp_bass: 'Bass', grp_guitar: 'Guitar', grp_keys: 'Keys & synth',
    grp_instruments: 'Instruments', grp_bus: 'Bus & master', grp_space: 'Rooms & halls', grp_creative: 'Creative', grp_sync: 'Tempo-synced',
    grp_smart: 'Smart (automatic)', grp_fixed: 'Fixed values',
    auto: 'Auto',
    autoTip: 'Set automatically for "{role}" in {genre} style',
    autoModDone: '{mod}: applied {genre} settings for {role}',
    autoMixDone: 'Applied the {genre} template to {n} tracks',
    dblReset: 'Double-click to reset',

    loading: 'Decoding audio…',
    filesAdded: 'Added {n} track(s). Set each track\'s role, then use Auto mix.',
    decodeFail: 'Could not decode "{name}". Try WAV, MP3, OGG, FLAC or M4A.',
    confirmDelete: 'Delete track "{name}"?',
    confirmReset: 'Reset volume, pan, EQ, compression, reverb and delay on all tracks? (Audio and edits are kept.)',
    normalized: 'Clip gain set to {db} dB',
    splitOutside: 'Move the playhead inside the clip first.',
    partSuffix: ' (part 2)',
    copySuffix: ' (copy)',
    noTracks: 'Add some tracks first.',
    noModules: 'Tick at least one module to auto-mix.',
    recUnsupported: 'Recording is not supported here. Open the page via http://localhost or https:// in a modern browser.',
    micDenied: 'Microphone access was denied or no microphone was found.',
    recordingName: 'Recording {n}',
    recordingFile: 'Microphone recording',
    recStarted: 'Recording… press ● or Space to stop.',
    recEmpty: 'Nothing was recorded.',
    recDone: 'Recording added.',
    recFail: 'Could not decode the recording.',
    settingsSaved: 'Settings saved as mix-settings.json',
    stripSaved: 'Track settings saved',
    settingsLoaded: 'Settings loaded.',
    settingsLoadedMissing: 'Settings loaded. {n} track(s) have no audio yet; use "Load audio" on them and the edits will be kept.',
    stripLoaded: 'Track settings applied to "{name}"',
    badFile: 'This is not a valid mixer settings file.',
    selectTrackFirst: 'Select a track first.',
    noTracksToExport: 'There is no audio to export.',
    rendering: 'Rendering mixdown…',
    exportDone: 'mixdown.wav exported.',
    exportFail: 'Export failed.',

    serverOnline: 'Server connected',
    serverOnlineTip: 'Projects (with audio) and personal presets can be saved on the server.',
    serverOffline: 'Offline mode',
    serverOfflineTip: 'Backend not reachable: all mixing works, but server save/open and personal presets are disabled. Start the backend (see README) and click here to retry.',
    saveToServer: 'Save to server',
    openFromServer: 'Open from server',
    projectsTitle: 'Projects on the server',
    projectNamePrompt: 'Project name (keep the same name to update, enter a new name to save a copy):',
    defaultProjectName: 'My mix',
    noProjects: 'No projects saved on the server yet.',
    open: 'Open',
    uploadingAudio: 'Uploading audio {i}/{n}…',
    downloadingAudio: 'Downloading audio {i}/{n}…',
    savedToServer: 'Saved "{name}" to the server (settings + audio).',
    serverError: 'Server error: {msg}',
    confirmOpenReplace: 'Opening a project replaces the current tracks. Continue?',
    confirmDeleteProject: 'Delete project "{name}" from the server? Its audio files are deleted too unless another project uses them.',
    myPresets: '★ My presets…',
    myPresetsNone: '★ No personal presets yet',
    saveMyPreset: 'Save as my preset',
    myPresetNamePrompt: 'Name for this personal preset:',
    myPresetSaved: 'Personal preset "{name}" saved on the server.',
    deleteMyPreset: 'Delete the selected personal preset',
    deleteMyPresetHint: 'Choose a personal preset in the list first.',
    confirmDeleteMyPreset: 'Delete personal preset "{name}"?',
    fileTooLarge: '"{name}" is larger than the server limit ({mb} MB).',

    separateBtn: 'AI source separation',
    sepTitle: 'AI source separation (HTDemucs)',
    sepTip: 'Split this track into vocals, drums, bass and more with HTDemucs',
    sepSource: 'Source track:',
    sepModel: 'Model',
    sepQuality: 'Quality',
    model_htdemucs: 'HTDemucs – 4 stems (fast)',
    model_htdemucs_ft: 'HTDemucs fine-tuned – 4 stems (best quality, ~4× slower)',
    model_htdemucs_6s: 'HTDemucs 6 stems – adds guitar & piano',
    modelDesc_htdemucs: 'Hybrid Transformer Demucs. Separates vocals, drums, bass and other. Good default.',
    modelDesc_htdemucs_ft: 'Four fine-tuned models, one per stem. Cleaner results but takes about four times longer.',
    modelDesc_htdemucs_6s: 'Also separates guitar and piano. The piano stem is less reliable.',
    shifts_1: 'Standard (1 pass)',
    shifts_2: 'High (2 passes)',
    shifts_5: 'Maximum (5 passes, slow)',
    sepStems: 'Stems to import',
    stem_vocals: 'Vocals', stem_drums: 'Drums', stem_bass: 'Bass', stem_other: 'Other', stem_guitar: 'Guitar', stem_piano: 'Piano',
    sepAfter: 'After separation',
    sepMuteOriginal: 'Mute the original track',
    sepAutoMix: 'Auto-mix the new tracks ({genre} template)',
    sepDevice: 'Processing device: {device}.',
    sepCpuWarn: 'No GPU found, so separation runs on the CPU and can take several minutes per song.',
    sepFirstUse: 'The first use of each model downloads its weights (about 80 MB, or 320 MB for the fine-tuned model).',
    sepStart: 'Start separation',
    sepRunningFor: 'Separating',
    sepBackground: 'Run in background',
    sepChecking: 'Checking the separation engine on the server…',
    sepUnavailable: 'Source separation is not available on the server.',
    sepNeedTrack: 'Select a track that has audio first.',
    retry: 'Retry',
    cancel: 'Cancel',
    sepUploading: 'Uploading audio to the server…',
    sepQueued: 'Waiting in queue (position {n})…',
    stage_starting: 'Starting…',
    stage_loading_model: 'Loading model (downloaded on first use)…',
    stage_decoding: 'Decoding audio…',
    stage_separating: 'Separating sources…',
    stage_encoding: 'Saving stems…',
    stage_done: 'Done',
    sepNoStems: 'Select at least one stem.',
    sepLost: 'The job was lost (the server may have restarted).',
    sepCancelled: 'Separation cancelled.',
    sepFailed: 'Separation failed: {msg}',
    sepDone: 'Separation finished: added {n} stem track(s).',

    helpHtml: `
<section>
  <h3>1. Quick start</h3>
  <ol>
    <li>Click <b>+ Add audio</b> (or drag files onto the page) to import WAV / MP3 / OGG / FLAC / M4A files. Each file becomes a track. The track role is guessed from the file name ("vocal", "kick", "bass", "gtr", etc.).</li>
    <li>Check each track's <b>Role</b> (on the track header or in the Track card).</li>
    <li>Choose a <b>Genre</b> in the ⚡ Auto mix bar and click <b>Auto mix all tracks</b>. Volume, pan, EQ, compression, reverb and delay are set for every track based on its role.</li>
    <li>Fine-tune any track in the channel strip below the timeline, then <b>Export WAV</b>.</li>
  </ol>
</section>
<section>
  <h3>2. Tracks & editing</h3>
  <ul>
    <li><b>Move</b> a clip by dragging it. <b>Trim</b> by dragging its left or right edge. Turn on <b>Snap to beat</b> to snap to the BPM grid (hold Alt to bypass).</li>
    <li>The Track card has precise fields for start position, trim, fade in/out and clip gain, plus <b>Normalize</b> (peak to −1 dBFS), <b>Reverse</b>, <b>Split at playhead</b>, <b>Duplicate</b>, reorder (▲▼) and <b>Delete</b>.</li>
    <li><b>M</b> mutes and <b>S</b> solos a track. ⇪ loads or replaces the audio of a track.</li>
    <li>Click or drag the ruler to move the playhead. Ctrl/⌘ + mouse wheel zooms the timeline.</li>
  </ul>
</section>
<section>
  <h3>3. Recording</h3>
  <ul>
    <li>Press <b>●</b> (or R). If the selected track is empty, the take goes into it. Otherwise a new track is created. Other tracks play while you record (overdub).</li>
    <li>Press <b>●</b>, <b>■</b> or Space to stop. The take is placed on the timeline where recording started, with output latency compensated.</li>
    <li>Use headphones to avoid recording the playback. The browser asks for microphone permission. This requires <code>http://localhost</code> or <code>https://</code>.</li>
  </ul>
</section>
<section>
  <h3>4. Volume balance & panning</h3>
  <ul>
    <li><b>Volume</b> is the fader (dB). <b>Auto level</b> measures the track's loudness and sets the fader so the track sits at the target level for its role in the chosen genre.</li>
    <li><b>Pan</b> places the sound from left to right. Auto pan keeps lead vocal, kick, snare and bass centered and spreads guitars, keys and backing vocals to the sides. The <b>Stereo</b> option (Genre / Wide / LCR / Mono) controls how wide the spread is.</li>
  </ul>
</section>
<section>
  <h3>5. EQ (equalization)</h3>
  <ul>
    <li>Seven bands: high-pass, low shelf, three peaking bands (low-mid / mid / high-mid), high shelf and low-pass.</li>
    <li>Drag the points on the curve. Mouse wheel changes Q (width) of peak bands. Double-click a point to reset it.</li>
    <li>Presets cover vocals (pop, male, female, rap, podcast, dynamic and condenser mics), drums (kick, snare, hi-hat, kit), bass (electric, synth/808, upright), guitars (acoustic, clean, distorted) and keys (piano, EP/organ, pad, lead).</li>
    <li>Rule of thumb: cut mud around 200–400 Hz, add presence around 2–5 kHz, and high-pass everything that doesn't need deep lows.</li>
  </ul>
</section>
<section>
  <h3>6. Compression</h3>
  <ul>
    <li><b>Threshold</b>: level where compression starts. <b>Ratio</b>: how strongly. <b>Attack / Release</b>: how fast it reacts and recovers. <b>Knee</b>: how soft the onset is. <b>Make-up</b> restores lost level.</li>
    <li>The <b>Gain reduction</b> meter shows how much the compressor is working. Around 3–6 dB is typical for vocals.</li>
    <li>Slow attack (15–30 ms) keeps drum punch. Fast attack (1–5 ms) controls peaks, as in rap vocals.</li>
  </ul>
</section>
<section>
  <h3>7. Reverb & delay</h3>
  <ul>
    <li>Both are post-fader <b>sends</b>: <b>Send</b> sets how much of the track goes into the effect.</li>
    <li>Reverb: <b>Decay</b> = room size / tail length, <b>Pre-delay</b> separates the dry sound from the tail, <b>Tone</b> darkens the tail.</li>
    <li>Delay: set <b>Tempo sync</b> to a note value (follows the BPM) or use a fixed time in ms. <b>Feedback</b> = number of repeats, <b>Tone</b> darkens repeats.</li>
  </ul>
</section>
<section>
  <h3>8. Presets & automatic settings</h3>
  <ul>
    <li>Every module has a <b>Preset</b> menu and a <b>⚡ Auto</b> button. Auto picks the right preset for the track's role and the current genre (Pop, Hip-hop/Rap, Rock, EDM, Ballad/Acoustic, Podcast).</li>
    <li>Changing any value switches the preset menu to "Custom".</li>
  </ul>
</section>
<section>
  <h3>9. Saving & loading settings</h3>
  <ul>
    <li><b>Save settings</b> downloads <code>mix-settings.json</code> with all parameters: BPM, genre, master, and for every track its name, role, edits, volume, pan, EQ, compression, reverb and delay. Audio is not included; use <b>Save to server</b> to keep the audio too.</li>
    <li><b>Load settings</b> (or drop the .json onto the page) applies the file. Tracks are matched by name, then by order. Missing tracks are created empty, so you can load their audio later and keep the edits.</li>
    <li>In the channel strip, <b>Save / Load track settings</b> stores a single track's settings so you can reuse your own presets.</li>
  </ul>
</section>
<section>
  <h3>10. Export</h3>
  <p><b>Export WAV</b> renders the full mix offline (all effects, mute/solo and master) to a 16-bit stereo <code>mixdown.wav</code>. The <b>Limiter</b> on the master prevents clipping.</p>
</section>
<section>
  <h3>12. Server: projects & personal presets</h3>
  <ul>
    <li>When the backend is running, the badge at the top shows <b>Server connected</b>. Otherwise the app runs in <b>Offline mode</b>, where everything except the server features still works. Click the badge to retry the connection.</li>
    <li><b>Save to server</b> uploads every track's audio and saves the settings as a project. Keep the same name to update the project, or type a new name to save a copy.</li>
    <li><b>Open from server</b> lists the saved projects. Opening one restores all tracks, audio and settings. You can also delete projects there.</li>
    <li>In the channel strip, <b>★ Save as my preset</b> stores the track's settings on the server, and the <b>★ My presets</b> menu applies them to any track.</li>
    <li>A settings .json that was saved after a server save also contains audio IDs. Loading it while the server is connected downloads the audio automatically.</li>
  </ul>
</section>
<section>
  <h3>13. AI source separation (HTDemucs)</h3>
  <ul>
    <li>Splits a mixed song into separate stems: vocals, drums, bass and other (the 6-stem model adds guitar and piano). Runs on the server, using the GPU when available.</li>
    <li>Select a track and click <b>✦ AI source separation</b> (toolbar or Track card). With no track selected, the toolbar button asks for a file first.</li>
    <li>Choose a <b>model</b> and <b>quality</b> (more passes = slightly cleaner, slower) and the stems to import. Each stem becomes a new track with the right role, aligned with the source and with the same trims and fades.</li>
    <li>Options: mute the original track, and auto-mix the new tracks with the current genre template. You can close the dialog while it runs: the toolbar button shows the progress.</li>
    <li>Typical uses: karaoke / instrumental versions, remixing, re-balancing a finished mix, or applying separate EQ and compression to the vocal.</li>
  </ul>
</section>
<section>
  <h3>14. Keyboard shortcuts</h3>
  <table>
    <tr><td><kbd>Space</kbd></td><td>Play / pause</td></tr>
    <tr><td><kbd>Home</kbd></td><td>Go to start</td></tr>
    <tr><td><kbd>R</kbd></td><td>Record / stop recording</td></tr>
    <tr><td><kbd>M</kbd> / <kbd>S</kbd></td><td>Mute / solo the selected track</td></tr>
    <tr><td><kbd>B</kbd></td><td>Split the selected track at the playhead</td></tr>
    <tr><td><kbd>↑</kbd> / <kbd>↓</kbd></td><td>Select previous / next track</td></tr>
    <tr><td><kbd>Ctrl</kbd>+<kbd>S</kbd></td><td>Save settings</td></tr>
    <tr><td><kbd>?</kbd></td><td>Open this guide</td></tr>
  </table>
</section>`,
  },

  zh: {
    appTitle: '線上混音器',
    help: '使用說明',
    helpTitle: '使用說明',
    toStart: '回到開頭（Home）',
    playPause: '播放／暫停（空白鍵）',
    stop: '停止',
    record: '錄音（R）',
    bpm: 'BPM',
    zoom: '縮放',
    snap: '對齊拍子',
    addAudio: '上傳音檔',
    addEmpty: '+ 空白音軌',
    saveSettings: '儲存設定',
    loadSettings: '載入設定',
    exportWav: '匯出 WAV',
    master: '總音量',
    limiter: '限幅器',
    autoMix: '自動混音',
    genre: '曲風',
    stereoWidth: '立體聲',
    autoMixAll: '自動混音所有音軌',
    resetAll: '全部重設',
    emptyHint: '<strong>目前沒有音軌。</strong><br>把音檔拖曳到這裡、按 <b>+ 上傳音檔</b>，或按 <b>●</b> 用麥克風錄音。',
    dropHere: '放開以匯入音檔（或設定檔 .json）',

    mod_volume: '音量', mod_pan: '聲像', mod_eq: 'EQ', mod_comp: '壓縮', mod_fx: '殘響／延遲', mod_reverb: '殘響', mod_delay: '延遲',

    role: '角色',
    role_vocal: '主唱', role_backing: '和聲', role_kick: '大鼓', role_snare: '小鼓', role_drums: '鼓組',
    role_bass: '貝斯', role_acousticGuitar: '木吉他', role_electricGuitar: '電吉他', role_piano: '鋼琴／鍵盤',
    role_synth: '合成器', role_other: '其他',

    trackN: '音軌 {n}',
    track: '音軌',
    tracksCount: '{n} 條音軌',
    mute: '靜音', solo: '獨奏',
    volShort: '音量', panShort: '聲像',
    loadAudio: '載入音檔',
    replaceAudio: '更換音檔',
    orRecord: '或選取此音軌後按 ● 錄音',
    recLane: '錄音中…',
    trimHandle: '拖曳以修剪',
    clipTip: '拖曳移動・拖曳左右邊緣修剪',
    barBeat: '小節',
    selectTrackHint: '選取一條音軌，即可開啟它的通道設定（編輯、音量、聲像、EQ、壓縮、殘響與延遲）。',

    saveStrip: '儲存音軌設定', saveStripTip: '將此音軌的音量、聲像、EQ、壓縮、殘響與延遲下載為 .json 檔',
    loadStrip: '載入音軌設定', loadStripTip: '將音軌設定檔 .json 套用到此音軌',

    trackCard: '音軌與編輯',
    name: '名稱',
    mono: '單聲道', stereo: '立體聲',
    noAudio: '尚未載入音訊。',
    recordHere: '錄到此軌', recordHereTip: '用麥克風錄音到這條空白音軌',
    normalize: '標準化', normalizeTip: '調整片段增益，讓峰值達到 −1 dBFS',
    reverse: '反轉',
    split: '在播放頭分割', splitTip: '在播放頭位置把片段切成兩條音軌（快捷鍵：B）',
    duplicate: '複製',
    moveUp: '上移', moveDown: '下移',
    delete: '刪除',
    offset: '起始位置',
    trimStart: '修剪開頭',
    trimEnd: '修剪結尾',
    fadeIn: '淡入',
    fadeOut: '淡出',
    clipGain: '片段增益',
    needAudioForEdit: '載入或錄製音訊後即可編輯。',

    mixCard: '音量平衡與聲像',
    volume: '音量',
    pan: '聲像（左右）',
    mixHint: '提示：雙擊任何滑桿可重設。數值框可直接輸入（聲像可輸入 L30／C／R30）。',

    eqCard: 'EQ 等化器',
    enabled: '開啟',
    eqHint: '拖曳曲線上的點來調整・在峰值點上滾動滑鼠滾輪可改變 Q 值・雙擊點可重設。',
    band_hpf: '高通', band_ls: '低頻架', band_p1: '中低頻', band_p2: '中頻', band_p3: '中高頻', band_hs: '高頻架', band_lpf: '低通',
    freq: '頻率', gain: '增益',

    compCard: '壓縮器',
    threshold: '門檻', ratio: '比例', attack: '起始時間', release: '釋放時間', knee: '膝點', makeup: '補償增益',
    gr: '增益衰減',

    reverbCard: '殘響 Reverb',
    send: '傳送量', decay: '衰減時間', preDelay: '預延遲', tone: '音色',
    delayCard: '延遲 Delay',
    sync: '節拍同步', syncOff: '關閉（使用毫秒）', time: '時間', feedback: '回授',
    note_1_2: '1/2 拍', note_1_4: '1/4 拍', note_1_4t: '1/4 三連音', note_1_8: '1/8 拍', note_1_8d: '附點 1/8', note_1_8t: '1/8 三連音', note_1_16: '1/16 拍',

    preset: '預設',
    presetCustom: '— 自訂 —',
    grp_general: '通用', grp_vocal: '人聲', grp_drums: '鼓', grp_bass: '貝斯', grp_guitar: '吉他', grp_keys: '鍵盤與合成器',
    grp_instruments: '樂器', grp_bus: '匯流排與總輸出', grp_space: '房間與大廳', grp_creative: '創意效果', grp_sync: '節拍同步',
    grp_smart: '智慧（自動）', grp_fixed: '固定數值',
    auto: '自動',
    autoTip: '依「{role}」與 {genre} 曲風自動設定',
    autoModDone: '{mod}：已套用 {genre} 曲風的「{role}」設定',
    autoMixDone: '已將 {genre} 範本套用到 {n} 條音軌',
    dblReset: '雙擊可重設',

    loading: '正在解碼音訊…',
    filesAdded: '已新增 {n} 條音軌。設定好每條音軌的角色後，就可以使用自動混音。',
    decodeFail: '無法解碼「{name}」。請使用 WAV、MP3、OGG、FLAC 或 M4A。',
    confirmDelete: '確定要刪除音軌「{name}」嗎？',
    confirmReset: '要重設所有音軌的音量、聲像、EQ、壓縮、殘響與延遲嗎？（音訊與編輯會保留）',
    normalized: '片段增益已設為 {db} dB',
    splitOutside: '請先把播放頭移到片段範圍內。',
    partSuffix: '（第 2 段）',
    copySuffix: '（複製）',
    noTracks: '請先新增音軌。',
    noModules: '請至少勾選一個要自動調整的模組。',
    recUnsupported: '目前環境無法錄音。請用現代瀏覽器，並透過 http://localhost 或 https:// 開啟此頁面。',
    micDenied: '麥克風權限被拒絕，或找不到麥克風。',
    recordingName: '錄音 {n}',
    recordingFile: '麥克風錄音',
    recStarted: '錄音中…按 ● 或空白鍵停止。',
    recEmpty: '沒有錄到任何聲音。',
    recDone: '錄音已加入。',
    recFail: '無法解碼錄音。',
    settingsSaved: '設定已儲存為 mix-settings.json',
    stripSaved: '音軌設定已儲存',
    settingsLoaded: '設定已載入。',
    settingsLoadedMissing: '設定已載入。有 {n} 條音軌還沒有音訊，請在這些音軌上按「載入音檔」，編輯設定會保留。',
    stripLoaded: '已將音軌設定套用到「{name}」',
    badFile: '這不是有效的混音設定檔。',
    selectTrackFirst: '請先選取一條音軌。',
    noTracksToExport: '沒有可以匯出的音訊。',
    rendering: '正在算繪混音…',
    exportDone: '已匯出 mixdown.wav。',
    exportFail: '匯出失敗。',

    serverOnline: '已連線伺服器',
    serverOnlineTip: '可以把專案（含音訊）與個人預設儲存在伺服器上。',
    serverOffline: '離線模式',
    serverOfflineTip: '無法連線後端：混音功能都能使用，但伺服器儲存／開啟與個人預設會停用。請啟動後端（見 README）後點此重試。',
    saveToServer: '儲存到伺服器',
    openFromServer: '從伺服器開啟',
    projectsTitle: '伺服器上的專案',
    projectNamePrompt: '專案名稱（名稱不變會更新原專案，輸入新名稱則另存新專案）：',
    defaultProjectName: '我的混音',
    noProjects: '伺服器上還沒有任何專案。',
    open: '開啟',
    uploadingAudio: '正在上傳音訊 {i}/{n}…',
    downloadingAudio: '正在下載音訊 {i}/{n}…',
    savedToServer: '已將「{name}」儲存到伺服器（設定 + 音訊）。',
    serverError: '伺服器錯誤：{msg}',
    confirmOpenReplace: '開啟專案會取代目前的音軌，確定要繼續嗎？',
    confirmDeleteProject: '確定要從伺服器刪除專案「{name}」嗎？沒有被其他專案使用的音訊檔也會一併刪除。',
    myPresets: '★ 我的預設…',
    myPresetsNone: '★ 尚無個人預設',
    saveMyPreset: '存成我的預設',
    myPresetNamePrompt: '個人預設名稱：',
    myPresetSaved: '個人預設「{name}」已儲存到伺服器。',
    deleteMyPreset: '刪除選取的個人預設',
    deleteMyPresetHint: '請先在清單中選擇一個個人預設。',
    confirmDeleteMyPreset: '確定要刪除個人預設「{name}」嗎？',
    fileTooLarge: '「{name}」超過伺服器的大小上限（{mb} MB）。',

    separateBtn: 'AI 音源分離',
    sepTitle: 'AI 音源分離（HTDemucs）',
    sepTip: '用 HTDemucs 把此音軌分離成人聲、鼓、貝斯等',
    sepSource: '來源音軌：',
    sepModel: '模型',
    sepQuality: '品質',
    model_htdemucs: 'HTDemucs－4 軌（快速）',
    model_htdemucs_ft: 'HTDemucs 微調版－4 軌（最佳品質，約慢 4 倍）',
    model_htdemucs_6s: 'HTDemucs 6 軌－增加吉他與鋼琴',
    modelDesc_htdemucs: 'Hybrid Transformer Demucs，分離人聲、鼓、貝斯與其他。建議的預設選項。',
    modelDesc_htdemucs_ft: '每個音軌各用一個微調模型，結果較乾淨，但時間約為 4 倍。',
    modelDesc_htdemucs_6s: '另外分離吉他與鋼琴。鋼琴音軌的效果較不穩定。',
    shifts_1: '標準（1 次）',
    shifts_2: '高（2 次）',
    shifts_5: '最高（5 次，較慢）',
    sepStems: '要匯入的分軌',
    stem_vocals: '人聲', stem_drums: '鼓', stem_bass: '貝斯', stem_other: '其他', stem_guitar: '吉他', stem_piano: '鋼琴',
    sepAfter: '分離完成後',
    sepMuteOriginal: '將原始音軌靜音',
    sepAutoMix: '自動混音新的音軌（{genre} 範本）',
    sepDevice: '運算裝置：{device}。',
    sepCpuWarn: '沒有偵測到 GPU，分離會使用 CPU 執行，每首歌可能需要數分鐘。',
    sepFirstUse: '每個模型第一次使用時會下載權重（約 80 MB，微調版約 320 MB）。',
    sepStart: '開始分離',
    sepRunningFor: '正在分離',
    sepBackground: '在背景執行',
    sepChecking: '正在檢查伺服器的分離引擎…',
    sepUnavailable: '伺服器目前無法使用音源分離。',
    sepNeedTrack: '請先選取一條有音訊的音軌。',
    retry: '重試',
    cancel: '取消',
    sepUploading: '正在上傳音訊到伺服器…',
    sepQueued: '排隊中（第 {n} 位）…',
    stage_starting: '啟動中…',
    stage_loading_model: '載入模型中（第一次使用會下載）…',
    stage_decoding: '解碼音訊中…',
    stage_separating: '分離音源中…',
    stage_encoding: '儲存分軌中…',
    stage_done: '完成',
    sepNoStems: '請至少選擇一個分軌。',
    sepLost: '找不到這個工作（伺服器可能已重新啟動）。',
    sepCancelled: '已取消音源分離。',
    sepFailed: '音源分離失敗：{msg}',
    sepDone: '音源分離完成：已新增 {n} 條分軌。',

    helpHtml: `
<section>
  <h3>1. 快速開始</h3>
  <ol>
    <li>按 <b>+ 上傳音檔</b>（或把檔案拖曳到頁面上）匯入 WAV／MP3／OGG／FLAC／M4A。每個檔案會變成一條音軌，並依檔名（如 vocal、kick、bass、gtr、人聲、鼓）自動猜測角色。</li>
    <li>確認每條音軌的<b>角色</b>（在音軌標頭或「音軌與編輯」卡片中）。</li>
    <li>在 ⚡ 自動混音列選擇<b>曲風</b>，按<b>自動混音所有音軌</b>。系統會依角色自動設定每條音軌的音量、聲像、EQ、壓縮、殘響與延遲。</li>
    <li>在時間軸下方的通道設定中微調，最後按<b>匯出 WAV</b>。</li>
  </ol>
</section>
<section>
  <h3>2. 音軌與編輯</h3>
  <ul>
    <li>拖曳片段可<b>移動</b>位置，拖曳左右邊緣可<b>修剪</b>。開啟<b>對齊拍子</b>會依 BPM 格線對齊（按住 Alt 可暫時取消）。</li>
    <li>「音軌與編輯」卡片可精確輸入起始位置、修剪、淡入／淡出、片段增益，並提供<b>標準化</b>（峰值調到 −1 dBFS）、<b>反轉</b>、<b>在播放頭分割</b>、<b>複製</b>、上下移動（▲▼）與<b>刪除</b>。</li>
    <li><b>M</b> 是靜音，<b>S</b> 是獨奏，⇪ 可載入或更換音軌的音檔。</li>
    <li>點擊或拖曳上方時間尺可移動播放頭。Ctrl／⌘ + 滑鼠滾輪可縮放時間軸。</li>
  </ul>
</section>
<section>
  <h3>3. 錄音</h3>
  <ul>
    <li>按 <b>●</b>（或 R）開始錄音。如果選取的音軌是空的，會錄到該音軌，否則會新增一條音軌。錄音時其他音軌會同步播放（疊錄）。</li>
    <li>再按 <b>●</b>、<b>■</b> 或空白鍵停止。錄音會放在開始錄音的時間位置，並自動補償輸出延遲。</li>
    <li>建議戴耳機，避免把伴奏錄進去。瀏覽器會詢問麥克風權限，且頁面需透過 <code>http://localhost</code> 或 <code>https://</code> 開啟。</li>
  </ul>
</section>
<section>
  <h3>4. 音量平衡與聲像</h3>
  <ul>
    <li><b>音量</b>是推桿（dB）。<b>自動音量</b>會量測音軌的響度，讓它落在所選曲風中該角色的目標音量。</li>
    <li><b>聲像</b>決定聲音在左右的位置。自動聲像會讓主唱、大鼓、小鼓、貝斯置中，吉他、鍵盤、和聲分散到左右。<b>立體聲</b>選項（依曲風／寬廣／LCR／單聲道）控制分散的寬度。</li>
  </ul>
</section>
<section>
  <h3>5. EQ 等化</h3>
  <ul>
    <li>共七段：高通、低頻架、三段峰值（中低／中／中高）、高頻架、低通。</li>
    <li>可直接拖曳曲線上的點。在峰值點上滾動滾輪可調整 Q（頻寬），雙擊點可重設。</li>
    <li>預設涵蓋：人聲（流行、男聲、女聲、饒舌、Podcast、動圈／電容麥克風）、鼓（大鼓、小鼓、腳踏鈸、整組）、貝斯（電貝斯、合成器／808、低音提琴）、吉他（木吉他、乾淨電吉他、破音電吉他）、鍵盤（鋼琴、電鋼琴／風琴、Pad、Lead）。</li>
    <li>基本原則：在 200–400 Hz 減少混濁，在 2–5 kHz 增加清晰度，不需要低頻的樂器都可以用高通濾掉。</li>
  </ul>
</section>
<section>
  <h3>6. 壓縮</h3>
  <ul>
    <li><b>門檻</b>：超過此音量才開始壓縮。<b>比例</b>：壓縮強度。<b>起始／釋放時間</b>：反應與恢復的速度。<b>膝點</b>：起始的柔和程度。<b>補償增益</b>：補回被壓掉的音量。</li>
    <li><b>增益衰減</b>表顯示壓縮器正在壓多少，人聲通常約 3–6 dB。</li>
    <li>較慢的起始時間（15–30 ms）可保留鼓的衝擊感，較快的起始時間（1–5 ms）可控制峰值，例如饒舌人聲。</li>
  </ul>
</section>
<section>
  <h3>7. 殘響與延遲</h3>
  <ul>
    <li>兩者都是推桿後的<b>傳送</b>效果：<b>傳送量</b>決定送進效果器的比例。</li>
    <li>殘響：<b>衰減時間</b>代表空間大小與尾音長度，<b>預延遲</b>讓原音與殘響分開，<b>音色</b>讓尾音變暗。</li>
    <li>延遲：<b>節拍同步</b>可選音符長度（跟隨 BPM），或關閉後使用毫秒。<b>回授</b>決定重複次數，<b>音色</b>讓回音變暗。</li>
  </ul>
</section>
<section>
  <h3>8. 預設與自動設定</h3>
  <ul>
    <li>每個模組都有<b>預設</b>選單與 <b>⚡ 自動</b>按鈕。「自動」會依音軌角色與目前曲風（流行、嘻哈／饒舌、搖滾、EDM、抒情／木吉他、Podcast）選擇合適的預設。</li>
    <li>手動修改任何數值後，預設選單會顯示「自訂」。</li>
  </ul>
</section>
<section>
  <h3>9. 儲存與載入設定</h3>
  <ul>
    <li><b>儲存設定</b>會下載 <code>mix-settings.json</code>，內含所有參數：BPM、曲風、總輸出，以及每條音軌的名稱、角色、編輯、音量、聲像、EQ、壓縮、殘響與延遲。檔案不包含音訊；若要連同音訊一起保存，請使用<b>儲存到伺服器</b>。</li>
    <li><b>載入設定</b>（或把 .json 拖到頁面上）會套用設定。音軌先依名稱、再依順序對應。缺少的音軌會建立為空白音軌，之後載入音檔時編輯設定會保留。</li>
    <li>通道設定上方的<b>儲存／載入音軌設定</b>可保存單一音軌的設定，當作自己的預設重複使用。</li>
  </ul>
</section>
<section>
  <h3>10. 匯出</h3>
  <p><b>匯出 WAV</b> 會離線算繪完整混音（包含所有效果、靜音／獨奏與總輸出），輸出 16-bit 立體聲的 <code>mixdown.wav</code>。總輸出的<b>限幅器</b>可防止破音。</p>
</section>
<section>
  <h3>12. 伺服器：專案與個人預設</h3>
  <ul>
    <li>後端執行中時，頁面上方會顯示<b>已連線伺服器</b>。否則會以<b>離線模式</b>執行，除了伺服器功能外都能正常使用。點擊該標示可重新連線。</li>
    <li><b>儲存到伺服器</b>會上傳每條音軌的音訊並把設定存成專案。名稱不變會更新原專案，輸入新名稱則另存一份。</li>
    <li><b>從伺服器開啟</b>會列出已儲存的專案，開啟後會還原所有音軌、音訊與設定，也可以在這裡刪除專案。</li>
    <li>在通道設定上方，<b>★ 存成我的預設</b>會把此音軌的設定存到伺服器，<b>★ 我的預設</b>選單可把它套用到任何音軌。</li>
    <li>在儲存到伺服器之後下載的設定檔 .json 也會包含音訊 ID。在連線伺服器時載入它，會自動下載音訊。</li>
  </ul>
</section>
<section>
  <h3>13. AI 音源分離（HTDemucs）</h3>
  <ul>
    <li>把混好的歌曲分離成獨立分軌：人聲、鼓、貝斯、其他（6 軌模型會再分出吉他與鋼琴）。分離在伺服器上執行，有 GPU 時會使用 GPU。</li>
    <li>選取一條音軌後按 <b>✦ AI 音源分離</b>（工具列或「音軌與編輯」卡片）。沒有選取音軌時，工具列按鈕會先請你選擇檔案。</li>
    <li>選擇<b>模型</b>與<b>品質</b>（次數越多會略為乾淨，但較慢），以及要匯入的分軌。每個分軌會成為一條新音軌，自動設定角色，並與來源對齊、沿用相同的修剪與淡入淡出。</li>
    <li>選項：將原始音軌靜音、用目前的曲風範本自動混音新音軌。執行期間可以關閉視窗，工具列按鈕會顯示進度。</li>
    <li>常見用途：製作卡拉 OK／伴奏、重新混音、調整成品混音的比例，或單獨對人聲做 EQ 與壓縮。</li>
  </ul>
</section>
<section>
  <h3>14. 快捷鍵</h3>
  <table>
    <tr><td><kbd>空白鍵</kbd></td><td>播放／暫停</td></tr>
    <tr><td><kbd>Home</kbd></td><td>回到開頭</td></tr>
    <tr><td><kbd>R</kbd></td><td>開始／停止錄音</td></tr>
    <tr><td><kbd>M</kbd>／<kbd>S</kbd></td><td>選取音軌的靜音／獨奏</td></tr>
    <tr><td><kbd>B</kbd></td><td>在播放頭分割選取的音軌</td></tr>
    <tr><td><kbd>↑</kbd>／<kbd>↓</kbd></td><td>選取上一條／下一條音軌</td></tr>
    <tr><td><kbd>Ctrl</kbd>+<kbd>S</kbd></td><td>儲存設定</td></tr>
    <tr><td><kbd>?</kbd></td><td>開啟使用說明</td></tr>
  </table>
</section>`,
  },
};

// Current language: saved choice, else browser language.
let LANG = (function () {
  try {
    const saved = localStorage.getItem('oam-lang');
    if (saved === 'en' || saved === 'zh') return saved;
  } catch (e) { /* storage unavailable */ }
  return /^zh/i.test(navigator.language || '') ? 'zh' : 'en';
})();

// Translate a key, replacing {placeholders} with values from `vars`.
function t(key, vars) {
  let s = (I18N[LANG] && I18N[LANG][key]) ?? I18N.en[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return s;
}

// Pick the current-language string from a { en, zh } object.
function L(obj) {
  return (obj && (obj[LANG] || obj.en)) || '';
}

// Switch language and update all static elements marked with data-i18n attributes.
function setLang(lang) {
  LANG = lang === 'en' ? 'en' : 'zh';
  try { localStorage.setItem('oam-lang', LANG); } catch (e) { /* storage unavailable */ }
  document.documentElement.lang = LANG === 'zh' ? 'zh-Hant' : 'en';
  document.title = t('appTitle');
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); el.setAttribute('aria-label', el.title); });
}
