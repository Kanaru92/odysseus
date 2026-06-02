/**
 * Navigator mini-map panel — an industry-standard thumbnail overview of the
 * whole document with a draggable viewport rectangle marking the region the
 * canvas is currently scrolled/zoomed to. Dragging (or clicking) the rectangle
 * re-centres the view by handing a pan delta back to the host via `onPan`.
 *
 * Self-contained: pure DOM + the editor design tokens (`--fg`/`--bg`/`--panel`/
 * `--border`/`--color-accent`/`--ge-*`). No external deps, no CSS-file changes —
 * all styling is inline `var(--…)` so the module drops in without a stylesheet.
 *
 * The viewport rectangle is derived from the same view math the canvas uses:
 *   • `state.zoom`               — display scale (1 = 100%).
 *   • `state.imgWidth/imgHeight` — document pixel size.
 *   • `canvasArea.dataset.panX/panY` — the canvas translate offset, applied with
 *     `transform-origin: center center` (see canvas-events.js `applyOffset`), so
 *     pan 0,0 means the document centre sits at the viewport centre.
 * The visible region in document space is the viewport rect mapped back through
 * that transform; the overlay is that region scaled into the thumbnail.
 *
 * @param {{
 *   rootEl:       HTMLElement,
 *   state:        object,
 *   getComposite?: () => (HTMLCanvasElement | null),
 *   onPan:        (dx: number, dy: number) => void,
 * }} opts
 *   - rootEl:       mount point the panel renders into (cleared on first build).
 *   - state:        the shared editor state (reads zoom / imgWidth / imgHeight /
 *                   mainCanvas / container).
 *   - getComposite: returns the composited document canvas to thumbnail; falls
 *                   back to `state.mainCanvas` when omitted or returning null.
 *   - onPan:        receives the pan-offset DELTA (in canvas-area px, same units
 *                   as `dataset.panX/panY`) to add to the current offset so the
 *                   dragged/clicked point becomes the new view centre. Negative
 *                   of the document-space move, because panning the canvas right
 *                   reveals content to its left.
 *
 * @returns {{ refresh: () => void, dispose: () => void }}
 *   - refresh(): re-render the thumbnail + viewport rect (call after a composite
 *                or any zoom/pan/resize change).
 *   - dispose(): remove every listener and empty the mount point.
 */

const THUMB_W = 200; // target thumbnail width in CSS px; height follows aspect.
const THUMB_MAX_H = 240; // cap for very tall documents so the panel stays compact.

export function createNavigator({ rootEl, state, getComposite, onPan } = {}) {
  if (!rootEl) throw new Error('createNavigator: rootEl is required');

  // ── DOM scaffold ───────────────────────────────────────────────────────
  // A stage that holds the thumbnail canvas (document pixels) and an absolutely
  // positioned viewport-rect overlay on top. The stage is centred in the panel.
  const wrap = document.createElement('div');
  wrap.className = 'ge-navigator';
  wrap.style.cssText =
    'padding:8px;display:flex;justify-content:center;align-items:center;' +
    'box-sizing:border-box;user-select:none;';

  const stage = document.createElement('div');
  stage.className = 'ge-nav-stage';
  stage.style.cssText =
    'position:relative;line-height:0;' +
    'border:1px solid var(--border);border-radius:var(--ge-r-sm,3px);' +
    'background:color-mix(in srgb, var(--bg) 60%, #000 40%);' +
    'box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--fg) 6%, transparent);' +
    'overflow:hidden;cursor:grab;';

  const thumb = document.createElement('canvas');
  thumb.className = 'ge-nav-thumb';
  thumb.style.cssText = 'display:block;image-rendering:auto;';
  const tctx = thumb.getContext('2d');

  const rect = document.createElement('div');
  rect.className = 'ge-nav-viewport';
  // Accent outline + faint fill so the visible region reads at a glance without
  // obscuring the thumbnail. A subtle dark ring on the outside lifts it off
  // light document areas.
  rect.style.cssText =
    'position:absolute;left:0;top:0;box-sizing:border-box;' +
    'border:1px solid var(--color-accent,#00aaff);' +
    'box-shadow:0 0 0 1px rgba(0,0,0,0.45);' +
    'background:color-mix(in srgb, var(--color-accent,#00aaff) 14%, transparent);' +
    'pointer-events:none;'; // dragging is handled on the stage, not the rect.

  stage.appendChild(thumb);
  stage.appendChild(rect);
  wrap.appendChild(stage);
  rootEl.innerHTML = '';
  rootEl.appendChild(wrap);

  // ── Geometry cache (recomputed each refresh) ───────────────────────────
  // `scale` maps document px → thumbnail px. `thumbW/thumbH` are the rendered
  // thumbnail size. Cached so the pointer math in drag/click doesn't re-derive.
  let scale = 1;
  let thumbW = THUMB_W;
  let thumbH = THUMB_W;

  function srcCanvas() {
    let c = null;
    try { c = typeof getComposite === 'function' ? getComposite() : null; } catch { c = null; }
    return c || (state && state.mainCanvas) || null;
  }

  // Document pixel dimensions, preferring explicit state, then the source canvas.
  function docSize() {
    const src = srcCanvas();
    const w = (state && state.imgWidth) || (src && src.width) || 0;
    const h = (state && state.imgHeight) || (src && src.height) || 0;
    return { w, h };
  }

  // The viewport (the on-screen canvas-area) size in CSS px. Used to compute how
  // much of the document is visible. Prefer the live canvas-area, fall back to
  // the editor container, then the window.
  function viewportSize() {
    const area = (state && state.container && state.container.querySelector('.ge-canvas-area'))
      || (state && state.canvasArea) || null;
    if (area) {
      const r = area.getBoundingClientRect();
      if (r.width && r.height) return { w: r.width, h: r.height };
    }
    return { w: window.innerWidth, h: window.innerHeight };
  }

  function panOffset() {
    const area = (state && state.canvasArea)
      || (state && state.container && state.container.querySelector('.ge-canvas-area')) || null;
    const px = area ? parseFloat(area.dataset.panX || '0') : 0;
    const py = area ? parseFloat(area.dataset.panY || '0') : 0;
    return { x: Number.isFinite(px) ? px : 0, y: Number.isFinite(py) ? py : 0 };
  }

  // ── Thumbnail render ───────────────────────────────────────────────────
  function drawThumb() {
    const { w: dw, h: dh } = docSize();
    if (!dw || !dh) { thumbW = thumbH = 0; return; }

    // Fit the document into THUMB_W width, capping height for tall docs.
    let tw = THUMB_W;
    let th = Math.round((THUMB_W * dh) / dw);
    if (th > THUMB_MAX_H) { th = THUMB_MAX_H; tw = Math.round((THUMB_MAX_H * dw) / dh); }
    tw = Math.max(1, tw); th = Math.max(1, th);
    thumbW = tw; thumbH = th;
    scale = tw / dw;

    // Match the backing store to CSS px (no DPR scaling — a mini-map needs no
    // pixel-perfect crispness, and this keeps the math 1:1).
    if (thumb.width !== tw) thumb.width = tw;
    if (thumb.height !== th) thumb.height = th;
    thumb.style.width = tw + 'px';
    thumb.style.height = th + 'px';

    tctx.clearRect(0, 0, tw, th);
    // Checkerboard so document transparency reads (mirrors the layer thumbs).
    const s = 6;
    for (let y = 0; y < th; y += s) {
      for (let x = 0; x < tw; x += s) {
        tctx.fillStyle = (((x / s) + (y / s)) & 1) ? '#9a9a9a' : '#cfcfcf';
        tctx.fillRect(x, y, s, s);
      }
    }
    const src = srcCanvas();
    if (src && src.width && src.height) {
      try {
        tctx.imageSmoothingEnabled = true;
        tctx.imageSmoothingQuality = 'high';
        tctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, tw, th);
      } catch { /* tainted/empty source — leave the checkerboard */ }
    }
  }

  // ── Viewport rectangle ─────────────────────────────────────────────────
  // Map the on-screen viewport back into document space, then into thumbnail px.
  //
  // The canvas is displayed at `zoom` and translated by (panX, panY) about its
  // CENTRE. So the document point at the viewport centre is:
  //     docCx = dw/2 - panX / zoom
  //     docCy = dh/2 - panY / zoom
  // and the visible half-extents in document px are (viewportW/2)/zoom etc.
  function layoutRect() {
    const { w: dw, h: dh } = docSize();
    if (!dw || !dh || !thumbW || !thumbH) { rect.style.display = 'none'; return; }
    rect.style.display = '';

    const zoom = (state && state.zoom) || 1;
    const { x: panX, y: panY } = panOffset();
    const vp = viewportSize();

    const docCx = dw / 2 - panX / zoom;
    const docCy = dh / 2 - panY / zoom;
    const halfW = (vp.w / zoom) / 2;
    const halfH = (vp.h / zoom) / 2;

    // Visible document rect, clamped to the document bounds for display.
    let dx0 = docCx - halfW;
    let dy0 = docCy - halfH;
    let dx1 = docCx + halfW;
    let dy1 = docCy + halfH;
    dx0 = Math.max(0, Math.min(dw, dx0));
    dy0 = Math.max(0, Math.min(dh, dy0));
    dx1 = Math.max(0, Math.min(dw, dx1));
    dy1 = Math.max(0, Math.min(dh, dy1));

    const rx = dx0 * scale;
    const ry = dy0 * scale;
    const rw = Math.max(2, (dx1 - dx0) * scale);
    const rh = Math.max(2, (dy1 - dy0) * scale);
    rect.style.left = rx + 'px';
    rect.style.top = ry + 'px';
    rect.style.width = rw + 'px';
    rect.style.height = rh + 'px';
  }

  function refresh() {
    drawThumb();
    layoutRect();
  }

  // ── Pan-by-drag / click-to-centre ──────────────────────────────────────
  // A point at thumbnail (tx, ty) maps to document (tx/scale, ty/scale). To make
  // that the new view centre we need:
  //     docCx_new = tx/scale  →  panX_new = (dw/2 - docCx_new) * zoom
  // The delta we hand the host is panX_new - panX (and likewise y), so the host
  // simply adds it to the current offset.
  function panToThumbPoint(tx, ty) {
    const { w: dw, h: dh } = docSize();
    if (!dw || !dh || !scale) return;
    const zoom = (state && state.zoom) || 1;
    const { x: panX, y: panY } = panOffset();

    const docCx = Math.max(0, Math.min(dw, tx / scale));
    const docCy = Math.max(0, Math.min(dh, ty / scale));
    const panXNew = (dw / 2 - docCx) * zoom;
    const panYNew = (dh / 2 - docCy) * zoom;

    const dpx = panXNew - panX;
    const dpy = panYNew - panY;
    if (dpx === 0 && dpy === 0) return;
    try { if (typeof onPan === 'function') onPan(dpx, dpy); } catch { /* host owns failures */ }
    layoutRect();
  }

  let dragging = false;
  let pid = null;

  function localPoint(e) {
    const r = thumb.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(thumbW, e.clientX - r.left)),
      y: Math.max(0, Math.min(thumbH, e.clientY - r.top)),
    };
  }

  function onDown(e) {
    if (e.button != null && e.button !== 0) return; // left button / touch only
    dragging = true;
    pid = e.pointerId;
    try { stage.setPointerCapture(pid); } catch { /* non-capturable pointer */ }
    stage.style.cursor = 'grabbing';
    const p = localPoint(e);
    panToThumbPoint(p.x, p.y); // click anywhere re-centres immediately
    e.preventDefault();
  }
  function onMove(e) {
    if (!dragging || (pid != null && e.pointerId !== pid)) return;
    const p = localPoint(e);
    panToThumbPoint(p.x, p.y);
    e.preventDefault();
  }
  function onUp(e) {
    if (!dragging) return;
    dragging = false;
    try { if (pid != null) stage.releasePointerCapture(pid); } catch { /* already released */ }
    pid = null;
    stage.style.cursor = 'grab';
  }

  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  // Re-layout the rect when the panel itself resizes (docked/undocked/collapsed).
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => layoutRect());
    try { ro.observe(rootEl); } catch { ro = null; }
  }

  function dispose() {
    stage.removeEventListener('pointerdown', onDown);
    stage.removeEventListener('pointermove', onMove);
    stage.removeEventListener('pointerup', onUp);
    stage.removeEventListener('pointercancel', onUp);
    if (ro) { try { ro.disconnect(); } catch { /* already gone */ } ro = null; }
    try { rootEl.innerHTML = ''; } catch { /* detached */ }
  }

  refresh();
  return { refresh, dispose };
}
