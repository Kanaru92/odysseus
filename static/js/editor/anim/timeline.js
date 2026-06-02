/**
 * Timeline docker — a slim strip at the bottom of the editor for the animation
 * controller. Transport (play/pause, prev/next), FPS, loop, ping-pong, onion
 * toggle, and add / duplicate / delete frame, plus a clickable frame ruler whose
 * cells mark keyframes (where a cel is assigned) and highlight the current
 * frame. Pure DOM; it reads `state.anim` and drives everything through the
 * controller. Re-renders on the controller's onChange (passed as the panel's
 * render) and is shown only while animation is enabled.
 *
 * render() is the controller's onChange and fires on every playback step, so it
 * is split into build-once chrome (created lazily on first render) and a cheap
 * per-call update that only touches what actually changed — the play/pause glyph,
 * toggle states, the FPS value, and the frame ruler (full ruler rebuild only when
 * frameCount or the keyframe set changes; otherwise just the current-cell class
 * is flipped). This avoids tearing down and rebuilding the whole bar (and an
 * O(frameCount) ruler) ~fps times a second during playback.
 *
 * @param {object} anim   the controller from animation.js
 * @param {HTMLElement} container  the editor root to append the strip to
 */
import { state } from '../state.js';

export function createTimeline(anim, container) {
  const bar = document.createElement('div');
  bar.className = 'ge-timeline';
  bar.style.display = 'none';
  container.appendChild(bar);

  const btn = (label, title, fn, extra) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ge-btn ge-btn-sm' + (extra ? ' ' + extra : '');
    b.textContent = label; b.title = title;
    b.addEventListener('click', fn);
    return b;
  };

  // Cached chrome references, populated by build() on first render.
  let built = false;
  let playBtn, fpsInput, loopBtn, pingBtn, onionBtn, onionGroup, reuseSel, ruler, count;
  let rulerCells = [];      // one <button> per frame, indexed by frame
  let rulerKey = '';        // signature of the last-rendered ruler (frameCount + keyframes)
  let curCell = -1;         // currently-highlighted ruler cell index
  let celsKey = '';         // signature of the last-rendered reuse <select> options

  // The onion sub-controls (◂ count tint tint count ▸) only exist while onion is
  // on; built into onionGroup on demand and shown/hidden as a unit.
  function buildOnionGroup() {
    const a = state.anim;
    const og = document.createElement('span');
    og.style.cssText = 'display:inline-flex;align-items:center;gap:4px;opacity:0.9;';
    const num = (val, title, on) => { const n = document.createElement('input'); n.type = 'number'; n.min = '0'; n.max = '8'; n.value = String(val); n.title = title; n.style.cssText = 'width:36px;padding:2px 3px;background:#1d1d22;border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#eee;'; n.addEventListener('change', () => on(parseInt(n.value, 10) || 0)); return n; };
    const col = (val, title, on) => { const c = document.createElement('input'); c.type = 'color'; c.value = val; c.title = title; c.style.cssText = 'width:22px;height:20px;padding:0;border:1px solid rgba(255,255,255,0.2);border-radius:3px;background:none;cursor:pointer;'; c.addEventListener('input', () => on(c.value)); return c; };
    og._before = num(a.onion.before, 'Onion: frames before', (v) => anim.setOnion({ before: v }));
    og._beforeTint = col(a.onion.beforeTint || '#ff5555', 'Previous-frame tint', (v) => anim.setOnion({ beforeTint: v }));
    og._afterTint = col(a.onion.afterTint || '#55aaff', 'Next-frame tint', (v) => anim.setOnion({ afterTint: v }));
    og._after = num(a.onion.after, 'Onion: frames after', (v) => anim.setOnion({ after: v }));
    og.appendChild(document.createTextNode('◂'));
    og.appendChild(og._before);
    og.appendChild(og._beforeTint);
    og.appendChild(og._afterTint);
    og.appendChild(og._after);
    og.appendChild(document.createTextNode('▸'));
    return og;
  }

  // Create the static chrome once and stash references for per-frame updates.
  function build() {
    bar.innerHTML = '';
    bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 10px;border-top:1px solid rgba(255,255,255,0.08);background:rgba(0,0,0,0.25);flex:0 0 auto;overflow-x:auto;white-space:nowrap;font-size:11px;';

    // Transport.
    bar.appendChild(btn('⏮', 'First frame', () => anim.gotoFrame(0)));
    bar.appendChild(btn('◀', 'Previous frame (,)', () => anim.prevFrame()));
    playBtn = btn('▶', 'Play', () => anim.togglePlay());
    bar.appendChild(playBtn);
    bar.appendChild(btn('▶|', 'Next frame (.)', () => anim.nextFrame()));

    // FPS.
    const fpsWrap = document.createElement('label');
    fpsWrap.style.cssText = 'display:inline-flex;align-items:center;gap:4px;opacity:0.85;';
    fpsWrap.appendChild(document.createTextNode('FPS'));
    fpsInput = document.createElement('input');
    fpsInput.type = 'number'; fpsInput.min = '1'; fpsInput.max = '60';
    fpsInput.style.cssText = 'width:46px;padding:2px 4px;background:#1d1d22;border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#eee;';
    fpsInput.addEventListener('change', () => anim.setFps(parseInt(fpsInput.value, 10) || 12));
    fpsWrap.appendChild(fpsInput);
    bar.appendChild(fpsWrap);

    // Toggles.
    loopBtn = btn('Loop', 'Loop playback', () => { const a = state.anim; a.loop = !a.loop; a.pingpong = false; render(); });
    bar.appendChild(loopBtn);
    pingBtn = btn('Ping', 'Ping-pong playback', () => { const a = state.anim; a.pingpong = !a.pingpong; render(); });
    bar.appendChild(pingBtn);
    onionBtn = btn('Onion', 'Onion skin (light table)', () => anim.toggleOnion());
    bar.appendChild(onionBtn);
    // Light-table options (CSP-style) — only while onion is on.
    onionGroup = document.createElement('span');
    onionGroup.style.display = 'none';
    bar.appendChild(onionGroup);

    const sep = document.createElement('span');
    sep.style.cssText = 'width:1px;height:16px;background:rgba(255,255,255,0.15);';
    bar.appendChild(sep);

    bar.appendChild(btn('+ Frame', 'New blank frame', () => anim.addFrame()));
    bar.appendChild(btn('⧉ Dup', 'Duplicate frame', () => anim.duplicateFrame()));
    bar.appendChild(btn('🗑', 'Delete frame', () => anim.deleteFrame(), 'danger'));
    // Cel reuse (CSP) — drop an existing cel on this frame, or hold the prev one.
    reuseSel = document.createElement('select');
    reuseSel.title = 'Reuse an existing cel on this frame';
    reuseSel.style.cssText = 'padding:2px 4px;background:#1d1d22;border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#eee;max-width:96px;';
    reuseSel.addEventListener('change', () => { if (reuseSel.value) anim.assignCel(reuseSel.value); reuseSel.value = ''; });
    bar.appendChild(reuseSel);
    bar.appendChild(btn('Hold', 'Clear this frame → hold the previous cel', () => anim.setHold()));

    // Frame ruler.
    ruler = document.createElement('div');
    ruler.style.cssText = 'display:inline-flex;gap:2px;margin-left:8px;';
    bar.appendChild(ruler);

    count = document.createElement('span');
    count.style.cssText = 'margin-left:8px;opacity:0.6;';
    bar.appendChild(count);

    rulerCells = []; rulerKey = ''; curCell = -1; celsKey = '';
    built = true;
  }

  // Rebuild the ruler cells only when frameCount or the keyframe set changes.
  function buildRuler(a, trk, fc) {
    ruler.innerHTML = '';
    rulerCells = [];
    for (let f = 0; f < fc; f++) {
      const hasKey = trk && trk.frameMap[f] != null;
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.textContent = String(f + 1);
      cell.title = hasKey ? `Frame ${f + 1} (keyframe)` : `Frame ${f + 1} (hold)`;
      cell.dataset.frame = String(f);
      cell._hasKey = hasKey;
      paintCell(cell, false, hasKey);
      // A small dot marks a keyframe cell.
      if (hasKey) cell.style.fontWeight = '600';
      cell.addEventListener('click', () => anim.gotoFrame(f));
      ruler.appendChild(cell);
      rulerCells.push(cell);
    }
    curCell = -1;
  }

  // Apply the current/keyframe/idle styling to a single ruler cell.
  function paintCell(cell, cur, hasKey) {
    cell.style.cssText =
      'min-width:22px;height:24px;padding:0 4px;border-radius:3px;cursor:pointer;font:inherit;color:inherit;' +
      'border:1px solid ' + (cur ? '#7aa8ff' : 'rgba(255,255,255,0.15)') + ';' +
      'background:' + (cur ? 'rgba(120,170,255,0.35)' : (hasKey ? 'rgba(255,255,255,0.12)' : 'transparent')) + ';';
    if (hasKey) cell.style.fontWeight = '600';
  }

  function render() {
    const a = state.anim;
    bar.style.display = a && a.enabled ? '' : 'none';
    if (!a || !a.enabled) { return; }
    if (!built) build();
    const trk = anim.track();

    // Transport — only the play/pause button changes per frame.
    const glyph = a.playing ? '⏸' : '▶';
    if (playBtn.textContent !== glyph) {
      playBtn.textContent = glyph;
      playBtn.title = a.playing ? 'Pause' : 'Play';
      playBtn.classList.toggle('ge-btn-primary', !!a.playing);
    }

    // FPS — don't clobber the field while the user is editing it.
    if (document.activeElement !== fpsInput) fpsInput.value = String(a.fps || 12);

    // Toggles (active class + the inline tint kept from the original).
    loopBtn.classList.toggle('active', !!a.loop);
    loopBtn.setAttribute('aria-pressed', a.loop ? 'true' : 'false');
    loopBtn.style.background = a.loop ? 'rgba(120,170,255,0.3)' : '';
    pingBtn.style.background = a.pingpong ? 'rgba(120,170,255,0.3)' : '';
    const onionOn = !!(a.onion && a.onion.enabled);
    onionBtn.style.background = onionOn ? 'rgba(120,170,255,0.3)' : '';

    // Onion sub-controls — build once when first turned on, then sync values.
    if (onionOn) {
      if (!onionGroup.firstChild) {
        const og = buildOnionGroup();
        onionGroup.appendChild(og);
        onionGroup._inner = og;
      }
      onionGroup.style.display = '';
      const og = onionGroup._inner;
      if (document.activeElement !== og._before) og._before.value = String(a.onion.before);
      if (document.activeElement !== og._after) og._after.value = String(a.onion.after);
      if (document.activeElement !== og._beforeTint) og._beforeTint.value = a.onion.beforeTint || '#ff5555';
      if (document.activeElement !== og._afterTint) og._afterTint.value = a.onion.afterTint || '#55aaff';
    } else {
      onionGroup.style.display = 'none';
    }

    // Reuse <select> — rebuild options only when the cel set changes.
    const cels = anim.cels();
    const ck = cels.map((c) => c.id + ':' + (c.name || c.id)).join('|');
    if (ck !== celsKey) {
      reuseSel.innerHTML = '<option value="">Reuse cel…</option>' + cels.map((c) => `<option value="${c.id}">${(c.name || c.id)}</option>`).join('');
      celsKey = ck;
    }

    // Frame ruler — rebuild only on frameCount/keyframe change; otherwise just
    // move the current-cell highlight.
    const fc = Math.max(1, a.frameCount || 1);
    let keySig = String(fc);
    if (trk) for (let f = 0; f < fc; f++) { if (trk.frameMap[f] != null) keySig += ',' + f; }
    if (keySig !== rulerKey) {
      buildRuler(a, trk, fc);
      rulerKey = keySig;
    }
    const cur = a.currentFrame;
    if (cur !== curCell) {
      if (curCell >= 0 && rulerCells[curCell]) paintCell(rulerCells[curCell], false, rulerCells[curCell]._hasKey);
      if (cur >= 0 && rulerCells[cur]) paintCell(rulerCells[cur], true, rulerCells[cur]._hasKey);
      curCell = cur;
    }

    count.textContent = `${a.currentFrame + 1}/${fc}`;
  }

  return { render, el: bar };
}
