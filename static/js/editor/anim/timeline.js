/**
 * Timeline docker — a slim strip at the bottom of the editor for the animation
 * controller. Transport (play/pause, prev/next), FPS, loop, ping-pong, onion
 * toggle, and add / duplicate / delete frame, plus a clickable frame ruler whose
 * cells mark keyframes (where a cel is assigned) and highlight the current
 * frame. Pure DOM; it reads `state.anim` and drives everything through the
 * controller. Re-renders on the controller's onChange (passed as the panel's
 * render) and is shown only while animation is enabled.
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

  function render() {
    const a = state.anim;
    bar.style.display = a && a.enabled ? '' : 'none';
    if (!a || !a.enabled) { bar.innerHTML = ''; return; }
    const trk = anim.track();
    bar.innerHTML = '';
    bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 10px;border-top:1px solid rgba(255,255,255,0.08);background:rgba(0,0,0,0.25);flex:0 0 auto;overflow-x:auto;white-space:nowrap;font-size:11px;';

    // Transport.
    bar.appendChild(btn('⏮', 'First frame', () => anim.gotoFrame(0)));
    bar.appendChild(btn('◀', 'Previous frame (,)', () => anim.prevFrame()));
    bar.appendChild(btn(a.playing ? '⏸' : '▶', a.playing ? 'Pause' : 'Play', () => anim.togglePlay(), a.playing ? 'ge-btn-primary' : ''));
    bar.appendChild(btn('▶|', 'Next frame (.)', () => anim.nextFrame()));

    // FPS.
    const fpsWrap = document.createElement('label');
    fpsWrap.style.cssText = 'display:inline-flex;align-items:center;gap:4px;opacity:0.85;';
    fpsWrap.appendChild(document.createTextNode('FPS'));
    const fps = document.createElement('input');
    fps.type = 'number'; fps.min = '1'; fps.max = '60'; fps.value = String(a.fps || 12);
    fps.style.cssText = 'width:46px;padding:2px 4px;background:#1d1d22;border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#eee;';
    fps.addEventListener('change', () => anim.setFps(parseInt(fps.value, 10) || 12));
    fpsWrap.appendChild(fps);
    bar.appendChild(fpsWrap);

    // Toggles.
    const loop = btn('Loop', 'Loop playback', () => { a.loop = !a.loop; a.pingpong = false; render(); }, a.loop ? 'active' : '');
    loop.setAttribute('aria-pressed', a.loop ? 'true' : 'false');
    if (a.loop) loop.style.background = 'rgba(120,170,255,0.3)';
    bar.appendChild(loop);
    const ping = btn('Ping', 'Ping-pong playback', () => { a.pingpong = !a.pingpong; render(); });
    if (a.pingpong) ping.style.background = 'rgba(120,170,255,0.3)';
    bar.appendChild(ping);
    const onion = btn('Onion', 'Onion skin (light table)', () => anim.toggleOnion());
    if (a.onion && a.onion.enabled) onion.style.background = 'rgba(120,170,255,0.3)';
    bar.appendChild(onion);

    const sep = document.createElement('span');
    sep.style.cssText = 'width:1px;height:16px;background:rgba(255,255,255,0.15);';
    bar.appendChild(sep);

    bar.appendChild(btn('+ Frame', 'New blank frame', () => anim.addFrame()));
    bar.appendChild(btn('⧉ Dup', 'Duplicate frame', () => anim.duplicateFrame()));
    bar.appendChild(btn('🗑', 'Delete frame', () => anim.deleteFrame(), 'danger'));

    // Frame ruler.
    const ruler = document.createElement('div');
    ruler.style.cssText = 'display:inline-flex;gap:2px;margin-left:8px;';
    const fc = Math.max(1, a.frameCount || 1);
    for (let f = 0; f < fc; f++) {
      const hasKey = trk && trk.frameMap[f] != null;
      const cur = f === a.currentFrame;
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.textContent = String(f + 1);
      cell.title = hasKey ? `Frame ${f + 1} (keyframe)` : `Frame ${f + 1} (hold)`;
      cell.dataset.frame = String(f);
      cell.style.cssText =
        'min-width:22px;height:24px;padding:0 4px;border-radius:3px;cursor:pointer;font:inherit;color:inherit;' +
        'border:1px solid ' + (cur ? '#7aa8ff' : 'rgba(255,255,255,0.15)') + ';' +
        'background:' + (cur ? 'rgba(120,170,255,0.35)' : (hasKey ? 'rgba(255,255,255,0.12)' : 'transparent')) + ';';
      // A small dot marks a keyframe cell.
      if (hasKey) cell.style.fontWeight = '600';
      cell.addEventListener('click', () => anim.gotoFrame(f));
      ruler.appendChild(cell);
    }
    bar.appendChild(ruler);

    const count = document.createElement('span');
    count.style.cssText = 'margin-left:8px;opacity:0.6;';
    count.textContent = `${a.currentFrame + 1}/${fc}`;
    bar.appendChild(count);
  }

  return { render, el: bar };
}
