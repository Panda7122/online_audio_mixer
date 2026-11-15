/* Pattern editor for instrument tracks: a continuous piano roll with a velocity lane, and for drum
 * instruments also a step sequencer (one row per drum, 16 steps per bar).
 *
 * createNoteEditor(deps) returns { open(track, patternId), refresh(), isOpen() }.
 * deps: { S, h, t, L, toast, getPattern(id), onPatternChanged(p), setPatternLen(p, beats),
 *         pushUndo(label), undo(), redo(), preview(tr, pitch, vel), playPattern(tr, p, fromBeat) }
 * A pattern is { id, name, len (beats), notes: [{ t: start beat, d: length in beats, p: MIDI pitch, v: velocity }] }.
 *
 * Drawing: a canvas the size of the visible area stays put (position: sticky) inside a scroll box whose
 * content has the size of the whole roll, so native scrolling moves the view and we draw only what is visible.
 */
(function (global) {
  'use strict';

  const PITCH_MIN = 21;   // A0
  const PITCH_MAX = 108;  // C8
  const ROW_H = 14;
  const DRUM_ROW_H = 24;
  const STEP_ROW_H = 30;
  const STEP_W = 26;      // px per 1/16 step in the step sequencer
  const KB_W = 64;
  const LABEL_W = 116;
  const RULER_H = 22;
  const VEL_H = 64;
  const EXTRA = 8;        // beats shown after the pattern end (notes there extend the pattern)
  const EPS = 1e-6;
  const SNAPS = { '1/4': 1, '1/8': 0.5, '1/16': 0.25, '1/32': 0.125, '1/8t': 1 / 3, '1/16t': 1 / 6 };
  const LENGTHS = { snap: 0, '1/1': 4, '1/2': 2, '1/4': 1, '1/8': 0.5, '1/16': 0.25 };
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const noteName = p => NAMES[p % 12] + (Math.floor(p / 12) - 1);
  const isBlack = p => [1, 3, 6, 8, 10].includes(p % 12);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  global.createNoteEditor = function (D) {
    const { h, t } = D;
    const E = {
      tr: null, pid: null, view: 'step', // drum patterns open in the step sequencer; others always use the piano roll
      snap: '1/16', len: 'snap', vel: 100, bpx: 64,
      sel: new Set(), drag: null, play: null, cursor: 0,
    };
    const dlg = document.getElementById('noteDlg');
    let cv, scroller, content, titleEl, velIn, velNum, lenIn, nameIn, playBtn;

    /* ---------- Model helpers ---------- */
    const pat = () => D.getPattern(E.pid);
    const notes = () => (pat() ? pat().notes : []);
    const drumMode = () => Synth.isDrum(E.tr.instrument);
    const stepMode = () => E.view === 'step' && drumMode();
    const rowH = () => (stepMode() ? STEP_ROW_H : drumMode() ? DRUM_ROW_H : ROW_H);
    const leftW = () => (stepMode() || drumMode() ? LABEL_W : KB_W);
    const velH = () => (stepMode() ? 0 : VEL_H);
    const bpx = () => (stepMode() ? STEP_W * 4 : E.bpx);
    const rowCount = () => (drumMode() ? Synth.DRUM_KIT.length : PITCH_MAX - PITCH_MIN + 1);
    const rowOfPitch = p => (drumMode() ? Synth.DRUM_KIT.findIndex(k => k.p === p) : PITCH_MAX - p);
    const pitchOfRow = r => {
      if (r < 0 || r >= rowCount()) return null;
      return drumMode() ? Synth.DRUM_KIT[r].p : PITCH_MAX - r;
    };
    const step = () => (stepMode() ? 0.25 : SNAPS[E.snap]);
    const newLength = () => LENGTHS[E.len] || step();
    const spanBeats = () => Math.max(4, (pat() ? pat().len : 4) + EXTRA);
    const sx = () => scroller.scrollLeft;
    const sy = () => scroller.scrollTop;
    const viewW = () => scroller.clientWidth;
    const viewH = () => scroller.clientHeight;
    const xOfBeat = b => leftW() + b * bpx() - sx();
    const beatOfX = x => (x - leftW() + sx()) / bpx();
    const yOfRow = r => RULER_H + r * rowH() - sy();
    const rowOfY = y => Math.floor((y - RULER_H + sy()) / rowH());
    const inGrid = (x, y) => x >= leftW() && y >= RULER_H && y < viewH() - velH();

    function local(e) {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    // Resize the scrollable content to the whole roll.
    function layoutContent() {
      if (!content) return;
      content.style.width = Math.ceil(leftW() + spanBeats() * bpx() + 24) + 'px';
      content.style.height = Math.ceil(RULER_H + rowCount() * rowH() + velH()) + 'px';
    }

    function hitNote(x, y) {
      if (!inGrid(x, y)) return null;
      const list = notes();
      const r = rowOfY(y);
      for (let i = list.length - 1; i >= 0; i--) {
        const n = list[i];
        if (rowOfPitch(n.p) !== r) continue;
        const x0 = xOfBeat(n.t);
        const x1 = drumMode() ? x0 + Math.max(10, step() * bpx() - 2) : Math.max(x0 + 6, xOfBeat(n.t + n.d));
        if (x >= x0 && x <= x1) {
          // Right-edge resize zone: 8 px, but never more than half of a short note.
          return { n, edge: !drumMode() && x >= x1 - Math.min(8, (x1 - x0) / 2) };
        }
      }
      return null;
    }

    // Record an undo step once per gesture, before the first modification.
    function beginChange(label) {
      if (E.drag && E.drag.undone) return;
      D.pushUndo(label || t('undoEditNotes'));
      if (E.drag) E.drag.undone = true;
    }

    function commit() {
      const p = pat();
      if (!p) return;
      D.onPatternChanged(p);
      if (lenIn && document.activeElement !== lenIn) lenIn.value = +(p.len / 4).toFixed(2);
      layoutContent();
      draw();
    }

    /* ---------- Drawing ---------- */
    function draw() {
      if (!cv || !dlg.open || !pat()) return;
      const dpr = window.devicePixelRatio || 1;
      const w = viewW(), H = viewH();
      cv.style.width = w + 'px';
      cv.style.height = H + 'px';
      cv.style.marginBottom = -H + 'px';
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(H * dpr);
      const g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const css = getComputedStyle(document.documentElement);
      const col = n => css.getPropertyValue(n).trim();
      const p = pat();
      const rh = rowH(), lw = leftW(), drums = drumMode(), steps = stepMode();
      const gridBottom = H - velH();
      const r0 = Math.max(0, rowOfY(RULER_H)), r1 = Math.min(rowCount() - 1, rowOfY(gridBottom));
      const b0 = Math.max(0, beatOfX(lw)), b1 = beatOfX(w);

      g.fillStyle = '#11141a';
      g.fillRect(0, 0, w, H);

      // Rows
      g.save();
      g.beginPath();
      g.rect(lw, RULER_H, w - lw, gridBottom - RULER_H);
      g.clip();
      for (let r = r0; r <= r1; r++) {
        const pp = pitchOfRow(r), y = yOfRow(r);
        g.fillStyle = drums ? (r % 2 ? '#151921' : '#1a1f29') : isBlack(pp) ? '#141820' : '#1c212b';
        g.fillRect(lw, y, w - lw, rh);
        if (!drums && pp % 12 === 0) {
          g.fillStyle = 'rgba(255,255,255,.12)';
          g.fillRect(lw, y + rh - 1, w - lw, 1);
        }
      }
      // Beyond the pattern end
      const endX = xOfBeat(p.len);
      if (endX < w) {
        g.fillStyle = 'rgba(0,0,0,.42)';
        g.fillRect(Math.max(lw, endX), RULER_H, w - Math.max(lw, endX), gridBottom - RULER_H);
      }
      // Grid lines: snap steps, beats, bars
      const s = step();
      for (let b = Math.floor(b0 / s) * s; b <= b1 + EPS; b += s) {
        const x = Math.round(xOfBeat(b)) + 0.5;
        const bar = Math.abs(b / 4 - Math.round(b / 4)) < EPS, beat = Math.abs(b - Math.round(b)) < EPS;
        g.strokeStyle = bar ? 'rgba(255,255,255,.32)' : beat ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.05)';
        g.beginPath(); g.moveTo(x, RULER_H); g.lineTo(x, gridBottom); g.stroke();
      }
      if (steps) drawSteps(g, r0, r1, b0, b1);
      else drawNotes(g, b0, b1);
      // Rubber-band selection
      if (E.drag && E.drag.mode === 'box') {
        const d = E.drag;
        const x0 = xOfBeat(d.b0), x1 = xOfBeat(d.b1), y0 = yOfRow(d.r0), y1 = yOfRow(d.r1);
        g.strokeStyle = col('--accent');
        g.fillStyle = 'rgba(76,195,255,.12)';
        g.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
        g.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
      }
      // Pattern end line
      if (endX >= lw && endX <= w) {
        g.fillStyle = col('--accent-2');
        g.fillRect(endX - 1, RULER_H, 2, gridBottom - RULER_H);
      }
      g.restore();

      drawKeys(g, r0, r1, gridBottom, col);
      drawRuler(g, w, b0, b1, col);
      if (!steps) drawVelocity(g, w, H, b0, b1, col);

      // Playhead (pattern preview) and paste cursor
      const lineAt = (b, color, top) => {
        const x = xOfBeat(b);
        if (x < lw || x > w) return;
        g.fillStyle = color;
        g.fillRect(x - 1, top, 2, H - top);
      };
      lineAt(E.cursor, 'rgba(255,181,71,.65)', 0);
      if (E.play) {
        const spb = 60 / D.S.bpm;
        const b = E.play.from + (D.S.ctx.currentTime - E.play.start) / spb;
        if (b >= E.play.from) lineAt(b, col('--accent'), 0);
      }
    }

    function drawNotes(g, b0, b1) {
      const drums = drumMode(), rh = rowH();
      // Notes past the pattern end are kept but not played: draw them dimmer.
      const len = pat().len;
      for (const n of notes()) {
        const end = drums ? n.t + step() : n.t + n.d;
        if (end < b0 || n.t > b1) continue;
        const r = rowOfPitch(n.p);
        if (r < 0) continue;
        const x0 = xOfBeat(n.t);
        const width = drums ? Math.max(10, step() * bpx() - 2) : Math.max(6, xOfBeat(n.t + n.d) - x0 - 1);
        const y = yOfRow(r);
        const light = 38 + (n.v / 127) * 30;
        g.globalAlpha = n.t >= len - EPS ? 0.35 : 1;
        g.fillStyle = `hsl(${drums ? 30 : 200}, 85%, ${light}%)`;
        g.fillRect(x0 + 0.5, y + 1.5, width, rh - 3);
        if (E.sel.has(n)) {
          g.strokeStyle = '#fff';
          g.lineWidth = 2;
          g.strokeRect(x0 + 1, y + 2, width - 1, rh - 4);
          g.lineWidth = 1;
        }
        if (!drums && width >= 10) {
          // Resize grip on the right edge.
          g.fillStyle = 'rgba(255,255,255,.55)';
          g.fillRect(x0 + width - 4, y + 4, 1.5, rh - 8);
          g.fillRect(x0 + width - 1.5, y + 4, 1.5, rh - 8);
        }
      }
      g.globalAlpha = 1;
    }

    // Step sequencer cells: one per 1/16 step and drum; brightness shows velocity.
    function drawSteps(g, r0, r1, b0, b1) {
      const rh = rowH(), len = pat().len;
      const on = stepIndex();
      for (let r = r0; r <= r1; r++) {
        const pp = pitchOfRow(r), y = yOfRow(r);
        for (let k = Math.max(0, Math.floor(b0 * 4)); k <= b1 * 4; k++) {
          const x = xOfBeat(k / 4);
          const n = on.get(pp + ':' + k);
          const beatGroup = Math.floor(k / 4) % 2;
          if (n) {
            const light = 40 + (n.v / 127) * 28;
            g.fillStyle = `hsl(30, 90%, ${light}%)`;
          } else {
            g.fillStyle = k / 4 >= len - EPS ? 'rgba(255,255,255,.03)' : beatGroup ? '#262c38' : '#2f3645';
          }
          g.fillRect(x + 2, y + 3, STEP_W - 4, rh - 6);
          if (n && E.sel.has(n)) {
            g.strokeStyle = '#fff';
            g.lineWidth = 2;
            g.strokeRect(x + 2, y + 3, STEP_W - 4, rh - 6);
            g.lineWidth = 1;
          }
        }
      }
    }

    // pitch:step -> note starting in that 1/16 step
    function stepIndex() {
      const m = new Map();
      for (const n of notes()) m.set(n.p + ':' + Math.floor(n.t * 4 + EPS), n);
      return m;
    }

    function drawKeys(g, r0, r1, gridBottom, col) {
      const rh = rowH(), lw = leftW(), drums = drumMode();
      g.save();
      g.beginPath();
      g.rect(0, RULER_H, lw, gridBottom - RULER_H);
      g.clip();
      g.fillStyle = '#232834';
      g.fillRect(0, RULER_H, lw, gridBottom - RULER_H);
      for (let r = r0; r <= r1; r++) {
        const pp = pitchOfRow(r), y = yOfRow(r);
        if (drums) {
          g.fillStyle = r % 2 ? '#232834' : '#272d3a';
          g.fillRect(0, y, lw, rh);
          g.fillStyle = col('--text');
          g.font = '11px ' + col('--font');
          // Custom kits show the uploaded sample's name on its pad.
          const zone = Synth.isCustom(E.tr.instrument) && E.tr.sampler.zones.find(z => z.root === pp && z.buffer);
          const label = zone ? zone.name.replace(/\.[^.]+$/, '') : t('drum_' + Synth.DRUM_KIT[r].key);
          g.fillText(label.length > 14 ? label.slice(0, 13) + '…' : label, 8, y + rh / 2 + 4);
        } else {
          g.fillStyle = isBlack(pp) ? '#0b0d11' : '#d9dde6';
          g.fillRect(0, y, lw - 2, rh - 1);
          if (Synth.isCustom(E.tr.instrument) && E.tr.sampler.zones.some(z => z.root === pp && z.buffer)) {
            g.fillStyle = col('--accent'); // this key has its own uploaded sample
            g.beginPath();
            g.arc(8, y + rh / 2, 3, 0, Math.PI * 2);
            g.fill();
          }
          if (pp % 12 === 0) {
            g.fillStyle = '#333';
            g.font = '10px ' + col('--mono');
            g.fillText(noteName(pp), lw - 30, y + rh - 3);
          }
        }
        g.fillStyle = 'rgba(0,0,0,.35)';
        g.fillRect(0, y + rh - 1, lw, 1);
      }
      g.restore();
    }

    function drawRuler(g, w, b0, b1, col) {
      const lw = leftW(), len = pat().len;
      g.fillStyle = '#161920';
      g.fillRect(0, 0, w, RULER_H);
      g.fillStyle = 'rgba(255,255,255,.08)';
      g.fillRect(0, RULER_H - 1, w, 1);
      g.font = '10px ' + col('--mono');
      for (let bar = Math.max(0, Math.floor(b0 / 4)); bar * 4 <= b1; bar++) {
        const x = xOfBeat(bar * 4);
        if (x < lw - 1) continue;
        g.fillStyle = bar * 4 < len - EPS ? col('--text') : col('--muted');
        g.fillRect(x, 8, 1, RULER_H - 8);
        g.fillText(String(bar + 1), x + 4, 14);
      }
      g.fillStyle = '#161920';
      g.fillRect(0, 0, lw, RULER_H);
      g.fillStyle = col('--muted');
      g.fillText(stepMode() ? t('stepSeq') : t('bars'), 6, 14);
    }

    function drawVelocity(g, w, H, b0, b1, col) {
      const lw = leftW(), top = H - VEL_H;
      g.fillStyle = '#151820';
      g.fillRect(0, top, w, VEL_H);
      g.fillStyle = 'rgba(255,255,255,.1)';
      g.fillRect(0, top, w, 1);
      g.fillStyle = col('--muted');
      g.font = '10px ' + col('--font');
      g.fillText(t('velocity'), 6, top + 14);
      g.save();
      g.beginPath();
      g.rect(lw, top, w - lw, VEL_H);
      g.clip();
      const usable = VEL_H - 10;
      for (const n of notes()) {
        if (n.t < b0 - 1 || n.t > b1) continue;
        const x = xOfBeat(n.t);
        const hh = (n.v / 127) * usable;
        g.fillStyle = E.sel.has(n) ? '#fff' : `hsl(${drumMode() ? 30 : 200}, 80%, 60%)`;
        g.fillRect(x, H - 2 - hh, 3, hh);
        g.fillRect(x - 2, H - 2 - hh, 7, 2);
      }
      g.restore();
    }

    /* ---------- Editing operations ---------- */
    function selectedOrAll() {
      return E.sel.size ? [...E.sel] : notes().slice();
    }

    function deleteSelected() {
      if (!E.sel.size) return;
      beginChange();
      const p = pat();
      p.notes = p.notes.filter(n => !E.sel.has(n));
      E.sel.clear();
      commit();
    }

    function copy(cut) {
      const list = E.sel.size ? [...E.sel] : [];
      if (!list.length) { D.toast(t('selectNotesFirst')); return; }
      const t0 = Math.floor(Math.min(...list.map(n => n.t)) / step() + EPS) * step();
      const span = Math.max(...list.map(n => n.t + n.d)) - t0;
      D.S.noteClipboard = { notes: list.map(n => ({ t: n.t - t0, d: n.d, p: n.p, v: n.v })), span };
      if (cut) {
        beginChange(t('undoCut'));
        const p = pat();
        p.notes = p.notes.filter(n => !E.sel.has(n));
        E.sel.clear();
        commit();
      }
      // The next paste goes right after the copied notes.
      E.cursor = t0 + Math.ceil(span / step() - EPS) * step();
      D.toast(t(cut ? 'cutNotes' : 'copiedNotes', { n: list.length }));
      draw();
    }

    // Paste at the paste cursor (orange line; click the ruler to move it), then move the cursor after it.
    function paste() {
      const c = D.S.noteClipboard;
      if (!c || !c.notes.length) { D.toast(t('clipboardEmpty')); return; }
      beginChange(t('undoPaste'));
      const at = E.cursor;
      const added = c.notes.map(n => ({ t: at + n.t, d: n.d, p: n.p, v: n.v }));
      pat().notes.push(...added);
      E.sel = new Set(added);
      E.cursor = at + Math.max(step(), Math.ceil(c.span / step() - EPS) * step());
      commit();
    }

    function transpose(semi) {
      const list = [...E.sel];
      if (!list.length) return;
      beginChange();
      for (const n of list) {
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
      const list = [...E.sel];
      if (!list.length) return;
      beginChange();
      const d = dir * step();
      if (list.some(n => n.t + d < -EPS)) return;
      for (const n of list) n.t = Math.max(0, n.t + d);
      commit();
    }

    function quantize() {
      const list = selectedOrAll();
      if (!list.length) return;
      beginChange(t('undoQuantize'));
      const s = step();
      for (const n of list) {
        n.t = Math.max(0, Math.round(n.t / s) * s);
        if (!drumMode()) n.d = Math.max(s, Math.round(n.d / s) * s);
      }
      commit();
    }

    function clearPattern() {
      if (!notes().length || !confirm(t('confirmClearPattern'))) return;
      beginChange(t('undoClearPattern'));
      pat().notes = [];
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

    function zoom(f, anchorX) {
      if (stepMode()) return;
      const ax = anchorX == null ? viewW() / 2 : anchorX;
      const b = beatOfX(ax);
      E.bpx = clamp(Math.round(E.bpx * f), 12, 320);
      layoutContent();
      scroller.scrollLeft = Math.max(0, leftW() + b * E.bpx - ax);
      draw();
    }

    /* ---------- Pattern preview (loops until stopped) ---------- */
    function togglePlay() {
      if (E.play) { stopPlay(); return; }
      startPlay(E.cursor < pat().len - EPS ? E.cursor : 0);
    }
    function startPlay(from) {
      E.play = D.playPattern(E.tr, pat(), from);
      updatePlayBtn();
      const tick = () => {
        if (!E.play || !dlg.open) return;
        if (D.S.ctx.currentTime > E.play.start + E.play.duration) E.play = D.playPattern(E.tr, pat(), 0); // loop
        draw();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
    function stopPlay() {
      if (E.play) E.play.stop();
      E.play = null;
      updatePlayBtn();
      draw();
    }
    function updatePlayBtn() { if (playBtn) playBtn.textContent = E.play ? '■ ' + t('stop') : '▶ ' + t('playPattern'); }

    function updateTitle() {
      const inst = Synth.INSTRUMENTS[E.tr.instrument];
      titleEl.textContent = `${E.tr.name} · ${D.L(inst.name)} · ${pat() ? pat().name : ''}`;
    }

    /* ---------- Pointer interaction ---------- */
    function snapBeat(b) {
      return Math.max(0, Math.floor(b / step() + EPS) * step());
    }

    function onPointerDown(e) {
      if (e.button === 2) return;
      const { x, y } = local(e);
      const H = viewH();
      if (y < RULER_H) {
        // Ruler: move the paste / play-from cursor.
        E.cursor = x >= leftW() ? snapBeat(beatOfX(x)) : 0;
        if (E.play) { stopPlay(); startPlay(Math.min(E.cursor, pat().len - EPS)); }
        draw();
        return;
      }
      if (velH() && y >= H - velH()) { cv.setPointerCapture(e.pointerId); E.drag = { mode: 'vel' }; velocityAt(x, y); return; }
      if (x < leftW()) {
        const pp = pitchOfRow(rowOfY(y));
        if (pp != null) D.preview(E.tr, pp, E.vel);
        return;
      }
      cv.setPointerCapture(e.pointerId);
      if (stepMode()) { stepDown(e, x, y); return; }
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
          bx: beatOfX(x), y0: y,
          anchor: hit.n,
          orig: [...E.sel].map(n => ({ n, t: n.t, d: n.d, p: n.p, r: rowOfPitch(n.p) })),
          lastPitch: hit.n.p,
        };
      } else {
        const b = beatOfX(x), r = rowOfY(y);
        E.drag = { mode: 'box', b0: b, b1: b, r0: r, r1: r, x0: x, y0: y, add: e.shiftKey, base: new Set(e.shiftKey ? E.sel : []) };
      }
      draw();
    }

    // Velocity lane: set the velocity of the notes under the pointer (only selected ones if there is a selection).
    function velocityAt(x, y) {
      const v = clamp(Math.round(((viewH() - 2 - y) / (VEL_H - 10)) * 127), 1, 127);
      const pool = E.sel.size ? [...E.sel] : notes();
      let hits = pool.filter(n => Math.abs(xOfBeat(n.t) + 1.5 - x) <= 4);
      if (!hits.length) {
        let best = null, bd = 10;
        for (const n of pool) { const d = Math.abs(xOfBeat(n.t) + 1.5 - x); if (d < bd) { bd = d; best = n; } }
        hits = best ? [best] : [];
      }
      if (!hits.length) return;
      beginChange(t('undoVelocity'));
      for (const n of hits) n.v = v;
      E.vel = v;
      velIn.value = v;
      velNum.value = v;
      draw();
    }

    // Step sequencer: click toggles a hit; drag paints (or erases) more steps. Shift+click changes the accent.
    function stepDown(e, x, y) {
      const r = rowOfY(y), k = Math.floor(beatOfX(x) * 4 + EPS);
      const pp = pitchOfRow(r);
      if (pp == null || k < 0) return;
      const n = stepIndex().get(pp + ':' + k);
      if (e.shiftKey && n) {
        beginChange(t('undoVelocity'));
        n.v = n.v >= 120 ? 64 : n.v >= 90 ? 127 : 100;
        D.preview(E.tr, pp, n.v);
        commit();
        return;
      }
      E.drag = { mode: n ? 'erase' : 'paint', done: new Set() };
      applyStep(r, k);
    }

    function applyStep(r, k) {
      const d = E.drag, pp = pitchOfRow(r);
      if (pp == null || k < 0 || d.done.has(pp + ':' + k)) return;
      d.done.add(pp + ':' + k);
      const n = stepIndex().get(pp + ':' + k);
      const p = pat();
      if (d.mode === 'paint' && !n) {
        beginChange(t('undoAddNote'));
        p.notes.push({ t: k / 4, d: 0.25, p: pp, v: E.vel });
        D.preview(E.tr, pp, E.vel);
      } else if (d.mode === 'erase' && n) {
        beginChange(t('undoDeleteNote'));
        p.notes = p.notes.filter(x => x !== n);
        E.sel.delete(n);
      } else {
        return;
      }
      commit();
    }

    // Mouse cursor that shows what a press would do at this spot.
    function cursorAt(x, y) {
      if (y < RULER_H) return 'col-resize';
      if (velH() && y >= viewH() - velH()) return 'ns-resize';
      if (x < leftW()) return 'pointer';
      if (stepMode()) return 'pointer';
      const hit = hitNote(x, y);
      if (!hit) return 'crosshair';
      return hit.edge ? 'ew-resize' : 'move';
    }

    function onPointerMove(e) {
      const d = E.drag;
      const { x, y } = local(e);
      if (!d) { cv.style.cursor = cursorAt(x, y); return; }
      if (d.mode === 'vel') { velocityAt(x, y); return; }
      if (d.mode === 'paint' || d.mode === 'erase') { applyStep(rowOfY(y), Math.floor(beatOfX(x) * 4 + EPS)); return; }
      // Keep the cursor fixed for the whole gesture, even when the pointer leaves the note.
      cv.style.cursor = d.mode === 'resize' ? 'ew-resize' : d.mode === 'move' ? 'move' : 'crosshair';
      const s = step();
      if (d.mode === 'box') {
        d.b1 = beatOfX(x);
        d.r1 = rowOfY(y);
        const bx0 = Math.min(d.b0, d.b1), bx1 = Math.max(d.b0, d.b1);
        const r0 = Math.min(d.r0, d.r1), r1 = Math.max(d.r0, d.r1);
        E.sel = new Set(d.base);
        for (const n of notes()) {
          const r = rowOfPitch(n.p);
          const ne = n.t + (drumMode() ? s : n.d);
          if (r >= r0 && r <= r1 && ne > bx0 && n.t < bx1) E.sel.add(n);
        }
        draw();
        return;
      }
      const db = Math.round((beatOfX(x) - d.bx) / s) * s;
      const dr = Math.round((y - d.y0) / rowH());
      if (d.mode === 'move') {
        if (!db && !dr && !d.moved) return;
        if (!d.moved) { beginChange(); d.moved = true; }
        const minT = Math.min(...d.orig.map(o => o.t));
        const dd = Math.max(db, -minT);
        for (const o of d.orig) {
          o.n.t = o.t + dd;
          if (o.r >= 0) o.n.p = pitchOfRow(clamp(o.r + dr, 0, rowCount() - 1));
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
      if (d.mode === 'vel' || d.mode === 'paint' || d.mode === 'erase') { draw(); return; }
      if (d.mode === 'box') {
        const { x, y } = local(e);
        const clicked = Math.abs(x - d.x0) < 4 && Math.abs(y - d.y0) < 4;
        if (clicked && !d.add) {
          if (d.base.size || E.sel.size) {
            E.sel.clear(); // the first click on empty space only clears the selection
          } else {
            const pp = pitchOfRow(rowOfY(y));
            const at = snapBeat(beatOfX(x));
            if (pp != null) {
              beginChange(t('undoAddNote'));
              const p = pat();
              p.notes = p.notes.filter(n => !(n.p === pp && Math.abs(n.t - at) < EPS));
              p.notes.push({ t: at, d: drumMode() ? step() : newLength(), p: pp, v: E.vel });
              D.preview(E.tr, pp, E.vel);
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
      if (stepMode()) return;
      const { x, y } = local(e);
      const hit = hitNote(x, y);
      if (!hit) return;
      beginChange(t('undoDeleteNote'));
      const p = pat();
      p.notes = p.notes.filter(n => n !== hit.n);
      E.sel.delete(hit.n);
      commit();
    }

    function onContextMenu(e) {
      e.preventDefault();
      if (!stepMode()) onDblClick(e);
    }

    function onWheel(e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, local(e).x);
    }

    function onKey(e) {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if ((e.target.tagName === 'INPUT' && e.target.type !== 'range') || e.target.tagName === 'SELECT') return;
      let handled = true;
      if (mod && k === 'a') E.sel = new Set(notes());
      else if (mod && k === 'c') copy(false);
      else if (mod && k === 'x') copy(true);
      else if (mod && k === 'v') paste();
      else if (mod && k === 'z' && !e.shiftKey) { D.undo(); E.sel.clear(); }
      else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { D.redo(); E.sel.clear(); }
      else if (k === 'delete' || k === 'backspace') deleteSelected();
      else if (k === 'arrowup') transpose(e.shiftKey ? 12 : 1);
      else if (k === 'arrowdown') transpose(e.shiftKey ? -12 : -1);
      else if (k === 'arrowleft') shift(-1);
      else if (k === 'arrowright') shift(1);
      else if (k === ' ') togglePlay();
      else if (k === 'q') quantize();
      else if (k === 'escape' && E.sel.size) E.sel.clear();
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
      const p = pat();
      const drums = drumMode();

      const snapSel = h('select', { 'aria-label': t('grid') }, Object.keys(SNAPS).map(k => h('option', { value: k, text: k.replace('t', ' ' + t('triplet')) })));
      snapSel.value = E.snap;
      snapSel.addEventListener('change', () => { E.snap = snapSel.value; draw(); });
      const lenSel = h('select', { 'aria-label': t('noteLength') }, Object.keys(LENGTHS).map(k => h('option', { value: k, text: k === 'snap' ? t('sameAsGrid') : k })));
      lenSel.value = E.len;
      lenSel.addEventListener('change', () => { E.len = lenSel.value; });

      velIn = h('input', { type: 'range', min: 1, max: 127, step: 1, value: E.vel, 'aria-label': t('velocity') });
      velNum = h('input', { type: 'text', class: 'num', value: E.vel, 'aria-label': t('velocity') });
      velIn.addEventListener('pointerdown', () => { if (E.sel.size) D.pushUndo(t('undoVelocity')); });
      velIn.addEventListener('input', () => setVelocity(+velIn.value));
      velNum.addEventListener('change', () => {
        const v = clamp(Math.round(+velNum.value) || E.vel, 1, 127);
        if (E.sel.size) D.pushUndo(t('undoVelocity'));
        setVelocity(v);
      });

      nameIn = h('input', { type: 'text', class: 'text-in pat-name', maxlength: 80, value: p.name, 'aria-label': t('patternName') });
      nameIn.addEventListener('input', () => {
        pat().name = nameIn.value || t('patternN', { n: pat().id });
        D.onPatternChanged(pat());
        updateTitle();
      });
      lenIn = h('input', { type: 'number', class: 'num', min: 0.25, max: 256, step: 0.25, value: +(p.len / 4).toFixed(2), 'aria-label': t('patternLen') });
      lenIn.addEventListener('change', () => {
        const bars = clamp(+lenIn.value || 1, 0.25, 256);
        D.pushUndo(t('patternLen'));
        D.setPatternLen(pat(), Math.round(bars * 16) / 4);
        lenIn.value = +(pat().len / 4).toFixed(2);
        layoutContent();
        draw();
      });

      const btn = (label, fn, title, cls) => h('button', { class: 'btn small ' + (cls || ''), title: title || '', onclick: () => { fn(); draw(); } }, label);
      playBtn = btn('▶ ' + t('playPattern'), togglePlay, t('playPatternTip'), 'accent');
      const viewSeg = drums ? h('div', { class: 'seg' },
        h('button', { class: 'btn small' + (stepMode() ? ' on' : ''), onclick: () => setView('step') }, t('stepSeq')),
        h('button', { class: 'btn small' + (stepMode() ? '' : ' on'), onclick: () => setView('roll') }, t('pianoRoll'))) : null;
      const roll = !stepMode();

      body.append(
        h('div', { class: 'roll-toolbar' },
          viewSeg,
          playBtn,
          h('label', { class: 'mini' }, h('span', { text: t('patternName') }), nameIn),
          h('label', { class: 'mini' }, h('span', { text: t('patternLen') + ' (' + t('bars') + ')' }), lenIn),
          roll ? h('label', { class: 'mini' }, h('span', { text: t('grid') }), snapSel) : null,
          roll && !drums ? h('label', { class: 'mini' }, h('span', { text: t('noteLength') }), lenSel) : null,
          h('label', { class: 'mini vel' }, h('span', { text: t('velocity') }), velIn, velNum),
          h('div', { class: 'seg' },
            btn(t('selectAll'), () => { E.sel = new Set(notes()); }, 'Ctrl+A'),
            btn('✂', () => copy(true), t('cut') + ' (Ctrl+X)'),
            btn('⧉', () => copy(false), t('copy') + ' (Ctrl+C)'),
            btn('⎘', paste, t('pasteAtCursor') + ' (Ctrl+V)'),
            btn('⌫', deleteSelected, t('delete') + ' (Delete)')),
          h('div', { class: 'seg' },
            roll ? btn(drums ? '▲' : '♯', () => transpose(1), drums ? t('rowUp') : t('transposeUp')) : null,
            roll ? btn(drums ? '▼' : '♭', () => transpose(-1), drums ? t('rowDown') : t('transposeDown')) : null,
            btn(t('quantize'), quantize, t('quantizeTip')),
            btn(t('clearPattern'), clearPattern, '', 'danger')),
          roll ? h('div', { class: 'seg' },
            btn('−', () => zoom(1 / 1.25), t('zoomOut') + ' (Ctrl+wheel)'),
            btn('+', () => zoom(1.25), t('zoomIn') + ' (Ctrl+wheel)')) : null),
        scroller = h('div', { class: 'roll-scroll' + (stepMode() ? ' steps' : '') },
          content = h('div', { class: 'roll-content' }, cv = h('canvas', { class: 'roll-canvas' }))),
        h('p', { class: 'hint', text: t(stepMode() ? 'stepEditorHint' : drums ? 'drumEditorHint' : 'noteEditorHint') }));

      cv.addEventListener('pointerdown', onPointerDown);
      cv.addEventListener('pointermove', onPointerMove);
      cv.addEventListener('pointerup', onPointerUp);
      cv.addEventListener('pointercancel', () => { E.drag = null; draw(); });
      cv.addEventListener('dblclick', onDblClick);
      cv.addEventListener('contextmenu', onContextMenu);
      cv.addEventListener('wheel', onWheel, { passive: false });
      scroller.addEventListener('scroll', () => requestAnimationFrame(draw));
      E.builtDrum = drums;
      E.builtView = E.view;
      layoutContent();
      updateTitle();
    }

    function setView(v) {
      if (E.view === v) return;
      E.view = v;
      build();
      requestAnimationFrame(() => { draw(); scrollToNotes(); });
    }

    function scrollToNotes() {
      scroller.scrollLeft = 0;
      if (drumMode()) { scroller.scrollTop = 0; return; }
      const list = notes();
      const center = list.length ? list.reduce((a, n) => a + n.p, 0) / list.length : 60;
      scroller.scrollTop = Math.max(0, rowOfPitch(Math.round(center)) * ROW_H - (viewH() - RULER_H - VEL_H) / 2);
    }

    dlg.addEventListener('keydown', e => { if (E.tr) onKey(e); });
    dlg.addEventListener('close', () => { stopPlay(); E.drag = null; });
    window.addEventListener('resize', () => { if (dlg.open) draw(); });

    return {
      open(tr, pid) {
        if (E.play) stopPlay();
        E.tr = tr;
        E.pid = pid;
        E.sel = new Set();
        E.cursor = 0;
        build();
        if (!dlg.open) dlg.showModal();
        requestAnimationFrame(() => { draw(); scrollToNotes(); });
      },
      // Redraw after external changes (undo/redo, instrument, tempo or pattern length changes).
      refresh() {
        if (!dlg.open || !E.tr) return;
        if (!D.S.tracks.includes(E.tr) || E.tr.kind !== 'notes' || !pat()) { dlg.close(); return; }
        const list = new Set(notes());
        E.sel = new Set([...E.sel].filter(n => list.has(n)));
        if (E.builtDrum !== drumMode()) build();
        else {
          if (lenIn && document.activeElement !== lenIn) lenIn.value = +(pat().len / 4).toFixed(2);
          if (nameIn && document.activeElement !== nameIn) nameIn.value = pat().name;
          layoutContent();
        }
        updateTitle();
        draw();
      },
      isOpen: () => dlg.open,
    };
  };
})(window);
