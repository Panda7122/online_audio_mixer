/* Per-bar note editor (piano roll / drum grid) for instrument tracks.
 *
 * createNoteEditor(deps) returns { open(track, bar), refresh(), isOpen() }.
 * deps: { S, h, t, L, toast, onNotesChanged(tr), pushUndo(label, tracks), undo(), redo(),
 *         preview(tr, pitch, vel), playBar(tr, bar) -> { start, duration, stop() } }
 * Notes are { t: start beat (absolute), d: length in beats, p: MIDI pitch, v: velocity }.
 */
(function (global) {
  'use strict';

  const PITCH_MIN = 21;   // A0
  const PITCH_MAX = 108;  // C8
  const ROW_H = 14;
  const DRUM_ROW_H = 30;
  const KB_W = 70;
  const BEATS = 4;        // 4/4 time
  const EPS = 1e-6;
  const SNAPS = { '1/4': 1, '1/8': 0.5, '1/16': 0.25, '1/32': 0.125, '1/8t': 1 / 3, '1/16t': 1 / 6 };
  const LENGTHS = { snap: 0, '1/1': 4, '1/2': 2, '1/4': 1, '1/8': 0.5, '1/16': 0.25 };
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const noteName = p => NAMES[p % 12] + (Math.floor(p / 12) - 1);
  const isBlack = p => [1, 3, 6, 8, 10].includes(p % 12);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  global.createNoteEditor = function (D) {
    const { h, t } = D;
    const E = { tr: null, bar: 0, snap: '1/16', len: 'snap', vel: 100, sel: new Set(), drag: null, play: null };
    const dlg = document.getElementById('noteDlg');
    let cv, scroller, titleEl, velIn, velNum;

    /* ---------- Model helpers ---------- */
    const drumMode = () => Synth.isDrum(E.tr.instrument);
    const rowH = () => (drumMode() ? DRUM_ROW_H : ROW_H);
    const rowCount = () => (drumMode() ? Synth.DRUM_KIT.length : PITCH_MAX - PITCH_MIN + 1);
    const rowOfPitch = p => (drumMode() ? Synth.DRUM_KIT.findIndex(k => k.p === p) : PITCH_MAX - p);
    const pitchOfRow = r => {
      if (r < 0 || r >= rowCount()) return null;
      return drumMode() ? Synth.DRUM_KIT[r].p : PITCH_MAX - r;
    };
    const step = () => SNAPS[E.snap];
    const newLength = () => LENGTHS[E.len] || step();
    const b0 = () => E.bar * BEATS;
    const barNotes = () => E.tr.notes.filter(n => n.t >= b0() - EPS && n.t < b0() + BEATS - EPS);
    const gridW = () => cv.clientWidth - KB_W;
    const xOfBeat = b => KB_W + (b / BEATS) * gridW();      // b relative to bar start
    const beatOfX = x => ((x - KB_W) / gridW()) * BEATS;

    function local(e) {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function hitNote(x, y) {
      const rh = rowH();
      const notes = barNotes();
      for (let i = notes.length - 1; i >= 0; i--) {
        const n = notes[i];
        const r = rowOfPitch(n.p);
        if (r < 0) continue;
        const x0 = xOfBeat(n.t - b0());
        const x1 = Math.min(xOfBeat(BEATS), Math.max(x0 + 6, xOfBeat(n.t - b0() + n.d)));
        if (x >= x0 && x <= x1 && y >= r * rh && y < (r + 1) * rh) {
          // Right-edge resize zone: 8 px, but never more than half of a short note.
          return { n, edge: !drumMode() && x >= x1 - Math.min(8, (x1 - x0) / 2) };
        }
      }
      return null;
    }

    // Record an undo step once per gesture, before the first modification.
    function beginChange(label) {
      if (E.drag && E.drag.undone) return;
      D.pushUndo(label || t('undoEditNotes'), [E.tr]);
      if (E.drag) E.drag.undone = true;
    }

    function commit() {
      D.onNotesChanged(E.tr);
      draw();
    }

    /* ---------- Drawing ---------- */
    function draw() {
      if (!cv || !dlg.open) return;
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth;
      const rh = rowH();
      const H = rowCount() * rh;
      cv.style.height = H + 'px';
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(H * dpr);
      const g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const css = getComputedStyle(document.documentElement);
      const col = n => css.getPropertyValue(n).trim();
      const drums = drumMode();

      // Rows and keyboard
      for (let r = 0; r < rowCount(); r++) {
        const p = pitchOfRow(r);
        const y = r * rh;
        g.fillStyle = drums ? (r % 2 ? '#151921' : '#1a1f29') : isBlack(p) ? '#141820' : '#1c212b';
        g.fillRect(KB_W, y, w - KB_W, rh);
        if (!drums && p % 12 === 0) {
          g.fillStyle = 'rgba(255,255,255,.12)';
          g.fillRect(KB_W, y + rh - 1, w - KB_W, 1);
        }
        // keyboard column
        if (drums) {
          g.fillStyle = '#232834';
          g.fillRect(0, y, KB_W, rh);
          g.fillStyle = col('--text');
          g.font = '11px ' + col('--font');
          // Custom kits show the uploaded sample's name on its pad.
          const zone = Synth.isCustom(E.tr.instrument) && E.tr.sampler.zones.find(z => z.root === p && z.buffer);
          const label = zone ? zone.name.replace(/\.[^.]+$/, '') : t('drum_' + Synth.DRUM_KIT[r].key);
          g.fillText(label.length > 9 ? label.slice(0, 8) + '…' : label, 6, y + rh / 2 + 4);
        } else {
          g.fillStyle = isBlack(p) ? '#0b0d11' : '#d9dde6';
          g.fillRect(0, y, KB_W - 2, rh - 1);
          if (Synth.isCustom(E.tr.instrument) && E.tr.sampler.zones.some(z => z.root === p && z.buffer)) {
            g.fillStyle = col('--accent'); // this key has its own uploaded sample
            g.beginPath();
            g.arc(8, y + rh / 2, 3, 0, Math.PI * 2);
            g.fill();
          }
          if (p % 12 === 0) {
            g.fillStyle = '#333';
            g.font = '10px ' + col('--mono');
            g.fillText(noteName(p), KB_W - 30, y + rh - 3);
          }
        }
        g.fillStyle = 'rgba(0,0,0,.35)';
        g.fillRect(0, y + rh - 1, KB_W, 1);
      }

      // Beat and snap lines
      const s = step();
      for (let b = 0; b <= BEATS + EPS; b += s) {
        const x = Math.round(xOfBeat(b)) + 0.5;
        const onBeat = Math.abs(b - Math.round(b)) < EPS;
        g.strokeStyle = onBeat ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.06)';
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
      }

      // Notes from the previous bars that ring into this bar (read-only, ghosted)
      const bs = b0();
      g.globalAlpha = 0.3;
      for (const n of E.tr.notes) {
        if (n.t < bs - EPS && n.t + n.d > bs + EPS) {
          const r = rowOfPitch(n.p);
          if (r < 0) continue;
          g.fillStyle = '#8a93a7';
          g.fillRect(KB_W, r * rh + 2, Math.min(xOfBeat(n.t + n.d - bs), xOfBeat(BEATS)) - KB_W, rh - 4);
        }
      }
      g.globalAlpha = 1;

      // Notes in this bar
      for (const n of barNotes()) {
        const r = rowOfPitch(n.p);
        if (r < 0) continue;
        const x0 = xOfBeat(n.t - bs);
        const x1 = drums ? x0 + Math.max(10, xOfBeat(s) - KB_W - 2) : Math.min(xOfBeat(BEATS), xOfBeat(n.t - bs + n.d));
        const width = Math.max(6, x1 - x0 - 1);
        const light = 38 + (n.v / 127) * 30;
        g.fillStyle = `hsl(${drums ? 30 : 200}, 85%, ${light}%)`;
        g.fillRect(x0 + 0.5, r * rh + 1.5, width, rh - 3);
        if (E.sel.has(n)) {
          g.strokeStyle = '#fff';
          g.lineWidth = 2;
          g.strokeRect(x0 + 1, r * rh + 2, width - 1, rh - 4);
        }
        if (!drums && width >= 10) {
          // Resize grip on the right edge.
          g.fillStyle = 'rgba(255,255,255,.55)';
          g.fillRect(x0 + width - 4, r * rh + 4, 1.5, rh - 8);
          g.fillRect(x0 + width - 1.5, r * rh + 4, 1.5, rh - 8);
        }
        if (!drums && n.t - bs + n.d > BEATS + EPS) { // continues into the next bar
          g.fillStyle = '#fff';
          g.fillText('›', xOfBeat(BEATS) - 8, r * rh + rh - 3);
        }
      }

      // Rubber-band selection
      if (E.drag && E.drag.mode === 'box') {
        const { x0, y0, x1, y1 } = E.drag;
        g.strokeStyle = col('--accent');
        g.fillStyle = 'rgba(76,195,255,.12)';
        g.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
        g.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
      }

      // Bar preview playhead
      if (E.play) {
        const ctxNow = D.S.ctx.currentTime;
        const frac = (ctxNow - E.play.start) / E.play.duration;
        if (frac >= 0 && frac <= 1) {
          const x = xOfBeat(frac * BEATS);
          g.fillStyle = col('--accent');
          g.fillRect(x, 0, 2, H);
        }
      }
    }

    /* ---------- Editing operations ---------- */
    function selectedOrBar() {
      return E.sel.size ? [...E.sel] : barNotes();
    }

    function deleteSelected() {
      if (!E.sel.size) return;
      beginChange();
      E.tr.notes = E.tr.notes.filter(n => !E.sel.has(n));
      E.sel.clear();
      commit();
    }

    function copy(cut) {
      const notes = selectedOrBar();
      if (!notes.length) { D.toast(t('nothingToCopy')); return; }
      D.S.clipboard = { kind: 'notes', len: BEATS, notes: notes.map(n => ({ t: n.t - b0(), d: n.d, p: n.p, v: n.v })) };
      D.updateEditButtons();
      if (cut) {
        beginChange(t('undoCut'));
        const set = new Set(notes);
        E.tr.notes = E.tr.notes.filter(n => !set.has(n));
        E.sel.clear();
        commit();
      }
      D.toast(t(cut ? 'cutNotes' : 'copiedNotes', { n: notes.length }));
    }

    // Paste merges the clipboard notes into this bar (keeping their positions within the bar).
    function paste() {
      const c = D.S.clipboard;
      if (!c || c.kind !== 'notes') { D.toast(t(c ? 'pasteKindMismatch' : 'clipboardEmpty')); return; }
      beginChange(t('undoPaste'));
      const added = c.notes.map(n => ({ t: b0() + n.t, d: n.d, p: n.p, v: n.v }));
      E.tr.notes.push(...added);
      E.sel = new Set(added);
      commit();
    }

    function transpose(semi) {
      const notes = [...E.sel];
      if (!notes.length) return;
      beginChange();
      for (const n of notes) {
        if (drumMode()) {
          const r = clamp(rowOfPitch(n.p) - Math.sign(semi), 0, rowCount() - 1);
          n.p = pitchOfRow(r);
        } else {
          n.p = clamp(n.p + semi, PITCH_MIN, PITCH_MAX);
        }
      }
      commit();
    }

    function shift(dir) {
      const notes = [...E.sel];
      if (!notes.length) return;
      beginChange();
      for (const n of notes) n.t = clamp(n.t + dir * step(), b0(), b0() + BEATS - step());
      commit();
    }

    function quantize() {
      const notes = selectedOrBar();
      if (!notes.length) return;
      beginChange(t('undoQuantize'));
      const s = step();
      for (const n of notes) {
        n.t = clamp(b0() + Math.round((n.t - b0()) / s) * s, b0(), b0() + BEATS - s);
        if (!drumMode()) n.d = Math.max(s, Math.round(n.d / s) * s);
      }
      commit();
    }

    function clearBar() {
      const notes = barNotes();
      if (!notes.length) return;
      beginChange(t('undoClearBar'));
      const set = new Set(notes);
      E.tr.notes = E.tr.notes.filter(n => !set.has(n));
      E.sel.clear();
      commit();
    }

    function setVelocity(v) {
      E.vel = v;
      velIn.value = v;
      velNum.value = v;
      if (E.sel.size) {
        for (const n of E.sel) n.v = v;
        commit();
      }
    }

    function togglePlay() {
      if (E.play) { stopPlay(); return; }
      E.play = D.playBar(E.tr, E.bar);
      const tick = () => {
        if (!E.play) return;
        if (D.S.ctx.currentTime > E.play.start + E.play.duration + 0.05) { E.play = null; updatePlayBtn(); draw(); return; }
        draw();
        requestAnimationFrame(tick);
      };
      updatePlayBtn();
      requestAnimationFrame(tick);
    }
    function stopPlay() {
      if (E.play) E.play.stop();
      E.play = null;
      updatePlayBtn();
      draw();
    }
    let playBtn;
    function updatePlayBtn() { if (playBtn) playBtn.textContent = E.play ? '■ ' + t('stop') : '▶ ' + t('playBar'); }

    function goBar(delta) {
      stopPlay();
      E.bar = Math.max(0, E.bar + delta);
      E.sel.clear();
      updateTitle();
      draw();
      D.onBarChanged && D.onBarChanged(E.tr, E.bar);
    }

    function updateTitle() {
      const inst = Synth.INSTRUMENTS[E.tr.instrument];
      titleEl.textContent = `${E.tr.name} · ${D.L(inst.name)} · ${t('barN', { n: E.bar + 1 })}`;
    }

    /* ---------- Pointer interaction ---------- */
    function onPointerDown(e) {
      if (e.button === 2) return;
      const { x, y } = local(e);
      const row = Math.floor(y / rowH());
      if (x < KB_W) {
        const p = pitchOfRow(row);
        if (p != null) D.preview(E.tr, p, E.vel);
        return;
      }
      cv.setPointerCapture(e.pointerId);
      const hit = hitNote(x, y);
      if (hit) {
        if (e.shiftKey) {
          if (E.sel.has(hit.n)) E.sel.delete(hit.n); else E.sel.add(hit.n);
        } else if (!E.sel.has(hit.n)) {
          E.sel = new Set([hit.n]);
        }
        D.preview(E.tr, hit.n.p, hit.n.v);
        E.drag = {
          mode: hit.edge ? 'resize' : 'move',
          x0: x, y0: y,
          anchor: hit.n,
          orig: [...E.sel].map(n => ({ n, t: n.t, d: n.d, p: n.p, r: rowOfPitch(n.p) })),
          lastPitch: hit.n.p,
        };
      } else {
        E.drag = { mode: 'box', x0: x, y0: y, x1: x, y1: y, add: e.shiftKey, base: new Set(e.shiftKey ? E.sel : []) };
      }
      draw();
    }

    // Mouse cursor that shows what a press would do at this spot.
    function cursorAt(x, y) {
      if (x < KB_W) return 'pointer';
      const hit = hitNote(x, y);
      if (!hit) return 'crosshair';
      return hit.edge ? 'ew-resize' : 'move';
    }

    function onPointerMove(e) {
      const d = E.drag;
      if (!d) {
        const { x, y } = local(e);
        cv.style.cursor = cursorAt(x, y);
        return;
      }
      // Keep the cursor fixed for the whole gesture, even when the pointer leaves the note.
      cv.style.cursor = d.mode === 'resize' ? 'ew-resize' : d.mode === 'move' ? 'move' : 'crosshair';
      const { x, y } = local(e);
      const s = step();
      if (d.mode === 'box') {
        d.x1 = x; d.y1 = y;
        const bx0 = beatOfX(Math.min(d.x0, x)), bx1 = beatOfX(Math.max(d.x0, x));
        const r0 = Math.floor(Math.min(d.y0, y) / rowH()), r1 = Math.floor(Math.max(d.y0, y) / rowH());
        E.sel = new Set(d.base);
        for (const n of barNotes()) {
          const r = rowOfPitch(n.p);
          const nb0 = n.t - b0(), nb1 = nb0 + (drumMode() ? s : n.d);
          if (r >= r0 && r <= r1 && nb1 > bx0 && nb0 < bx1) E.sel.add(n);
        }
        draw();
        return;
      }
      const db = Math.round((beatOfX(x) - beatOfX(d.x0)) / s) * s;
      const dr = Math.round((y - d.y0) / rowH());
      if (d.mode === 'move') {
        if (!db && !dr && !d.moved) return;
        if (!d.moved) { beginChange(); d.moved = true; }
        for (const o of d.orig) {
          o.n.t = clamp(o.t + db, b0(), b0() + BEATS - Math.min(s, BEATS) + EPS);
          const nr = clamp(o.r + dr, 0, rowCount() - 1);
          if (o.r >= 0) o.n.p = pitchOfRow(nr);
        }
        if (d.anchor.p !== d.lastPitch) { d.lastPitch = d.anchor.p; D.preview(E.tr, d.anchor.p, d.anchor.v); }
      } else {
        if (!db && !d.moved) return;
        if (!d.moved) { beginChange(); d.moved = true; }
        for (const o of d.orig) o.n.d = Math.max(s, o.d + db);
      }
      draw();
    }

    function onPointerUp(e) {
      const d = E.drag;
      E.drag = null;
      if (!d) return;
      if (d.mode === 'box') {
        const { x, y } = local(e);
        const clicked = Math.abs(x - d.x0) < 4 && Math.abs(y - d.y0) < 4;
        if (clicked && !d.add) {
          if (d.base.size || E.sel.size) {
            // First click on empty space just clears the selection.
            E.sel.clear();
          } else {
            const p = pitchOfRow(Math.floor(y / rowH()));
            const rel = Math.floor(beatOfX(x) / step() + EPS) * step();
            if (p != null && rel >= 0 && rel < BEATS) {
              beginChange(t('undoAddNote'));
              E.tr.notes = E.tr.notes.filter(n => !(n.p === p && Math.abs(n.t - (b0() + rel)) < EPS));
              E.tr.notes.push({ t: b0() + rel, d: drumMode() ? step() : newLength(), p, v: E.vel });
              D.preview(E.tr, p, E.vel);
              commit();
              return;
            }
          }
        }
        draw();
        return;
      }
      if (d.moved) commit();
      else draw();
    }

    function onDblClick(e) {
      const { x, y } = local(e);
      const hit = hitNote(x, y);
      if (!hit) return;
      beginChange(t('undoDeleteNote'));
      E.tr.notes = E.tr.notes.filter(n => n !== hit.n);
      E.sel.delete(hit.n);
      commit();
    }

    function onContextMenu(e) {
      e.preventDefault();
      onDblClick(e);
    }

    function onKey(e) {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
      let handled = true;
      if (mod && k === 'a') E.sel = new Set(barNotes());
      else if (mod && k === 'c') copy(false);
      else if (mod && k === 'x') copy(true);
      else if (mod && k === 'v') paste();
      else if (mod && k === 'z' && !e.shiftKey) { D.undo(); E.sel.clear(); }
      else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { D.redo(); E.sel.clear(); }
      else if (k === 'delete' || k === 'backspace') deleteSelected();
      else if (k === 'arrowup') transpose(e.shiftKey ? 12 : 1);
      else if (k === 'arrowdown') transpose(e.shiftKey ? -12 : -1);
      else if (k === 'arrowleft') { if (e.altKey) goBar(-1); else shift(-1); }
      else if (k === 'arrowright') { if (e.altKey) goBar(1); else shift(1); }
      else if (k === ' ') togglePlay();
      else if (k === 'q') quantize();
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
        draw();
      }
    }

    /* ---------- Building the dialog ---------- */
    function build() {
      const body = document.getElementById('noteBody');
      body.innerHTML = '';
      titleEl = document.getElementById('noteTitle');

      const snapSel = h('select', { 'aria-label': t('grid') }, Object.keys(SNAPS).map(k => h('option', { value: k, text: k.replace('t', ' ' + t('triplet')) })));
      snapSel.value = E.snap;
      snapSel.addEventListener('change', () => { E.snap = snapSel.value; draw(); });
      const lenSel = h('select', { 'aria-label': t('noteLength') }, Object.keys(LENGTHS).map(k => h('option', { value: k, text: k === 'snap' ? t('sameAsGrid') : k })));
      lenSel.value = E.len;
      lenSel.addEventListener('change', () => { E.len = lenSel.value; });

      velIn = h('input', { type: 'range', min: 1, max: 127, step: 1, value: E.vel, 'aria-label': t('velocity') });
      velNum = h('input', { type: 'text', class: 'num', value: E.vel, 'aria-label': t('velocity') });
      velIn.addEventListener('pointerdown', () => { if (E.sel.size) D.pushUndo(t('undoVelocity'), [E.tr]); });
      velIn.addEventListener('input', () => setVelocity(+velIn.value));
      velNum.addEventListener('change', () => {
        const v = clamp(Math.round(+velNum.value) || E.vel, 1, 127);
        if (E.sel.size) D.pushUndo(t('undoVelocity'), [E.tr]);
        setVelocity(v);
      });

      const btn = (label, fn, title, cls) => h('button', { class: 'btn small ' + (cls || ''), title: title || '', onclick: () => { fn(); draw(); } }, label);
      playBtn = btn('▶ ' + t('playBar'), togglePlay, t('playBarTip'), 'accent');
      const isDrums = Synth.isDrum(E.tr.instrument);

      body.append(
        h('div', { class: 'roll-toolbar' },
          h('div', { class: 'seg' },
            btn('◀', () => goBar(-1), t('prevBar')),
            btn('▶', () => goBar(1), t('nextBar'))),
          playBtn,
          h('label', { class: 'mini' }, h('span', { text: t('grid') }), snapSel),
          isDrums ? null : h('label', { class: 'mini' }, h('span', { text: t('noteLength') }), lenSel),
          h('label', { class: 'mini vel' }, h('span', { text: t('velocity') }), velIn, velNum),
          h('div', { class: 'seg' },
            btn(t('selectAll'), () => { E.sel = new Set(barNotes()); }, 'Ctrl+A'),
            btn('✂', () => copy(true), t('cut') + ' (Ctrl+X)'),
            btn('⧉', () => copy(false), t('copy') + ' (Ctrl+C)'),
            btn('⎘', paste, t('paste') + ' (Ctrl+V)'),
            btn('⌫', deleteSelected, t('delete') + ' (Delete)')),
          h('div', { class: 'seg' },
            btn(isDrums ? '▲' : '♯', () => transpose(1), isDrums ? t('rowUp') : t('transposeUp')),
            btn(isDrums ? '▼' : '♭', () => transpose(-1), isDrums ? t('rowDown') : t('transposeDown')),
            btn(t('quantize'), quantize, t('quantizeTip')),
            btn(t('clearBar'), clearBar, '', 'danger'))),
        scroller = h('div', { class: 'roll-scroll' }, cv = h('canvas', { class: 'roll-canvas' })),
        h('p', { class: 'hint', text: t(isDrums ? 'drumEditorHint' : 'noteEditorHint') }));

      cv.addEventListener('pointerdown', onPointerDown);
      cv.addEventListener('pointermove', onPointerMove);
      cv.addEventListener('pointerup', onPointerUp);
      cv.addEventListener('pointercancel', () => { E.drag = null; draw(); });
      cv.addEventListener('dblclick', onDblClick);
      cv.addEventListener('contextmenu', onContextMenu);
      E.builtDrum = drumMode();
      updateTitle();
    }

    function scrollToNotes() {
      if (drumMode()) { scroller.scrollTop = 0; return; }
      const notes = barNotes().length ? barNotes() : E.tr.notes;
      const center = notes.length ? notes.reduce((a, n) => a + n.p, 0) / notes.length : 60;
      scroller.scrollTop = Math.max(0, rowOfPitch(Math.round(center)) * ROW_H - scroller.clientHeight / 2);
    }

    dlg.addEventListener('keydown', e => { if (E.tr) onKey(e); });
    dlg.addEventListener('close', () => { stopPlay(); E.drag = null; });
    window.addEventListener('resize', () => { if (dlg.open) draw(); });

    return {
      open(tr, bar) {
        E.tr = tr;
        E.bar = Math.max(0, bar | 0);
        E.sel = new Set();
        build();
        if (!dlg.open) dlg.showModal();
        requestAnimationFrame(() => { draw(); scrollToNotes(); });
      },
      // Redraw after external changes (undo/redo, instrument or tempo change).
      refresh() {
        if (!dlg.open || !E.tr) return;
        if (!D.S.tracks.includes(E.tr) || E.tr.kind !== 'notes') { dlg.close(); return; }
        E.sel = new Set([...E.sel].filter(n => E.tr.notes.includes(n)));
        if (E.builtDrum !== drumMode()) build(); // instrument switched between drums and melodic
        updateTitle();
        draw();
      },
      isOpen: () => dlg.open,
      track: () => (dlg.open ? E.tr : null),
    };
  };
})(window);
