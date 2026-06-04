/**
 * Distort transform — free 4-corner warp of the active layer (the standard
 * Edit → Transform → Distort, as a guideline). On tool select it snapshots the layer
 * and shows draggable corner handles at the layer's bounding box; dragging a
 * corner re-warps the snapshot onto the layer live (via warp-quad.js). Commits
 * on tool-switch / Enter (the warped pixels are already on the layer), cancels
 * on Esc (restores the snapshot). Undo point is taken at start.
 *
 * Handles are DOM elements in the canvas-area, positioned from the canvas's
 * on-screen rect × zoom and re-placed on every composite (the `ge:composited`
 * hook), so they track pan/zoom/scroll.
 */
import { state } from '../state.js';
import { canvasCoords } from '../canvas-coords.js';
import { warpQuad } from './warp-quad.js';

export function createDistortTool({ activeLayer, saveState, composite }) {
  let handles = [];
  let dragIdx = -1;
  let dragStart = null; // snapshot of all corners at drag start (for skew/perspective)
  let rafPending = false;
  // Horizontal partner per corner (shares the top/bottom edge): TL↔TR, BR↔BL.
  const HORIZ = [1, 0, 3, 2];

  function previewNow() {
    const layer = state.distortLayer;
    if (!layer || !state.distortSnapshot || !state.distortCorners) return;
    const w = layer.canvas.width, h = layer.canvas.height;
    const warped = warpQuad(state.distortSnapshot, state.distortCorners, w, h, 16);
    layer.ctx.clearRect(0, 0, w, h);
    layer.ctx.drawImage(warped, 0, 0);
    composite(); // also fires ge:composited → placeHandles()
  }
  function schedulePreview() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; previewNow(); });
  }

  function placeHandles() {
    const layer = state.distortLayer, canvas = state.mainCanvas;
    if (!layer || !canvas || !state.distortCorners) return;
    const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
    const z = state.zoom || 1;
    // The canvas is displayed with a CSS `rotate(viewRotation)` about its centre
    // (R / Shift+R), while pointers come through canvasCoords() which inverts it.
    // Mirror that same rotation here so handles stay on the layer's corners; the
    // centre of rotation is the canvas's layout centre (handles share the canvas's
    // untranslated offset basis, so pan is intentionally excluded — same as below).
    const rot = state.viewRotation || 0;
    const a = rot * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
    const cenX = canvas.offsetLeft + canvas.width * z / 2;
    const cenY = canvas.offsetTop + canvas.height * z / 2;
    // Pan is a CSS translate applied AFTER the rotate — add it to the final point
    // so handles track the canvas when panned (previously detached).
    const aEl = canvas.parentElement;
    const panX = aEl ? (parseFloat(aEl.dataset.panX || '0') || 0) : 0;
    const panY = aEl ? (parseFloat(aEl.dataset.panY || '0') || 0) : 0;
    for (let i = 0; i < handles.length; i++) {
      const c = state.distortCorners[i];
      let px = canvas.offsetLeft + (c.x + off.x) * z;
      let py = canvas.offsetTop + (c.y + off.y) * z;
      if (rot) {
        const dx = px - cenX, dy = py - cenY;
        px = cenX + dx * cs - dy * sn;
        py = cenY + dx * sn + dy * cs;
      }
      handles[i].style.left = (px + panX) + 'px';
      handles[i].style.top = (py + panY) + 'px';
    }
  }

  function onMove(e) {
    if (dragIdx < 0) return;
    e.preventDefault();
    const layer = state.distortLayer;
    if (!layer) return;
    const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
    const c = canvasCoords(e, state.mainCanvas); // image coords
    const np = { x: c.x - off.x, y: c.y - off.y }; // layer-local
    const mode = state.distortMode || 'free';
    if (mode !== 'free' && dragStart) {
      // Skew = the edge's other corner shifts the SAME way (parallelogram shear);
      // Perspective = it mirrors in X (symmetric trapezoid). Y always matches.
      const dx = np.x - dragStart[dragIdx].x, dy = np.y - dragStart[dragIdx].y;
      state.distortCorners[dragIdx] = np;
      const hN = HORIZ[dragIdx];
      const mx = mode === 'perspective' ? -dx : dx;
      state.distortCorners[hN] = { x: dragStart[hN].x + mx, y: dragStart[hN].y + dy };
    } else {
      state.distortCorners[dragIdx] = np;
    }
    placeHandles();
    schedulePreview();
  }
  function onUp(e) {
    if (dragIdx < 0) return;
    try { handles[dragIdx]?.releasePointerCapture(e.pointerId); } catch {}
    dragIdx = -1;
    previewNow(); // final full-quality pass
  }
  // Self-heal teardown: a document switch (doc-tabs.js) sets
  // state.distortActive=false DIRECTLY, bypassing commit()/cancel(), so the
  // handle DOM + the two document capture-phase pointer listeners would
  // otherwise leak per switch. We own a ge:composited listener (added/removed
  // with the handles) and tear down when the session was ended externally.
  // (galleryEditor's own ge:composited→reposition hook is gated on
  // state.distortActive, so it never fires for this path.)
  function onComposited() {
    if (!state.distortActive && handles.length) { removeHandles(); dragIdx = -1; }
  }

  function buildHandles() {
    removeHandles();
    const area = state.mainCanvas && state.mainCanvas.parentElement;
    if (!area) return;
    for (let i = 0; i < 4; i++) {
      const h = document.createElement('div');
      h.className = 'ge-distort-handle';
      h.style.cssText = 'position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:#e06c75;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,0.55);cursor:grab;z-index:60;touch-action:none;';
      h.dataset.idx = String(i);
      h.addEventListener('pointerdown', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        dragIdx = i;
        dragStart = state.distortCorners ? state.distortCorners.map((p) => ({ ...p })) : null;
        try { h.setPointerCapture(ev.pointerId); } catch {}
      });
      area.appendChild(h);
      handles.push(h);
    }
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    window.addEventListener('ge:composited', onComposited);
  }
  function removeHandles() {
    handles.forEach((h) => { try { h.remove(); } catch {} });
    handles = [];
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('ge:composited', onComposited);
  }

  function clearSession() {
    removeHandles();
    state.distortActive = false;
    state.distortLayer = null;
    state.distortSnapshot = null;
    state.distortCorners = null;
    dragIdx = -1;
  }

  return {
    /** Begin a distort session on the active layer (called on tool select). */
    start() {
      const layer = activeLayer();
      if (!layer || layer.locked) return;
      if (state.distortActive) this.commit();
      const w = layer.canvas.width, h = layer.canvas.height;
      state.distortLayer = layer;
      state.distortSnapshot = document.createElement('canvas');
      state.distortSnapshot.width = w; state.distortSnapshot.height = h;
      state.distortSnapshot.getContext('2d').drawImage(layer.canvas, 0, 0);
      state.distortCorners = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
      state.distortActive = true;
      saveState('Distort');
      buildHandles();
      placeHandles();
    },
    /** Re-place handles after a redraw (zoom / pan / scroll). */
    reposition() { if (state.distortActive) placeHandles(); },
    /** Keep the warped result (already on the layer) and end the session. */
    commit() { if (state.distortActive) clearSession(); },
    /** Restore the original pixels and end the session. */
    cancel() {
      if (!state.distortActive) return;
      const layer = state.distortLayer;
      if (layer && state.distortSnapshot) {
        layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
        layer.ctx.drawImage(state.distortSnapshot, 0, 0);
      }
      clearSession();
      composite();
    },
    isActive() { return !!state.distortActive; },
  };
}
