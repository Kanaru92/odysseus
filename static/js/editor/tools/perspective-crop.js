/**
 * Perspective crop — mark a 4-corner quad over a skewed subject; Apply
 * straightens (de-skews) that quad to a rectangle and resizes the document to
 * it. Uses `unwarpQuad` (quad→rect). DOM corner handles in the canvas area,
 * positioned from the canvas rect × zoom and re-placed on every composite (the
 * `ge:composited` hook) so they track pan/zoom. The quad outline is drawn by the
 * caller's composite overlay.
 *
 * @param {{ activeLayer:()=>object, composite:()=>void, applyCrop:(corners)=>void }} deps
 */
import { state } from '../state.js';
import { canvasCoords } from '../canvas-coords.js';

export function createPerspectiveCropTool({ activeLayer, composite, applyCrop }) {
  let handles = [];
  let dragIdx = -1;

  function placeHandles() {
    const canvas = state.mainCanvas;
    if (!canvas || !state.pcropCorners) return;
    const z = state.zoom || 1;
    const rot = state.viewRotation || 0;
    // Pan is a CSS translate offsetLeft/Top don't include — add it so handles
    // track the canvas when panned.
    const aEl = canvas.parentElement;
    const panX = aEl ? (parseFloat(aEl.dataset.panX || '0') || 0) : 0;
    const panY = aEl ? (parseFloat(aEl.dataset.panY || '0') || 0) : 0;
    if (!rot) {
      for (let i = 0; i < handles.length; i++) {
        const c = state.pcropCorners[i];
        handles[i].style.left = (canvas.offsetLeft + c.x * z + panX) + 'px';
        handles[i].style.top = (canvas.offsetTop + c.y * z + panY) + 'px';
      }
      return;
    }
    // View is rotated: apply the same rotation about the canvas centre that
    // canvasCoords() inverts, so handles track the rotated composite/pointer.
    // The centre is invariant under CSS rotate(), so the displayed centre is the
    // un-rotated box centre in the offsetParent (offsetLeft + canvas.width*z/2).
    const a = rot * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
    const ccx = canvas.offsetLeft + (canvas.width * z) / 2;
    const ccy = canvas.offsetTop + (canvas.height * z) / 2;
    for (let i = 0; i < handles.length; i++) {
      const c = state.pcropCorners[i];
      const dx = (c.x - canvas.width / 2) * z, dy = (c.y - canvas.height / 2) * z;
      const rx = dx * cos - dy * sin, ry = dx * sin + dy * cos;
      handles[i].style.left = (ccx + rx + panX) + 'px';
      handles[i].style.top = (ccy + ry + panY) + 'px';
    }
  }
  function onMove(e) {
    if (dragIdx < 0) return;
    e.preventDefault();
    const c = canvasCoords(e, state.mainCanvas); // image/doc coords
    state.pcropCorners[dragIdx] = { x: c.x, y: c.y };
    placeHandles();
    composite(); // redraw the quad overlay
  }
  function onUp(e) {
    if (dragIdx < 0) return;
    try { handles[dragIdx]?.releasePointerCapture(e.pointerId); } catch {}
    dragIdx = -1;
  }
  // Self-heal teardown: a doc switch (doc-tabs.js applyFrom) clears
  // state.pcropActive directly without calling clearSession(), which would
  // otherwise orphan the handle DOM nodes + the document-level capture
  // listeners. applyFrom() ends with composite() (→ ge:composited), so when
  // that fires with handles still present but the session no longer active,
  // tear everything down.
  function onComposited() {
    if (handles.length && !state.pcropActive) removeHandles();
  }
  function buildHandles() {
    removeHandles();
    const area = state.mainCanvas && state.mainCanvas.parentElement;
    if (!area) return;
    for (let i = 0; i < 4; i++) {
      const h = document.createElement('div');
      h.className = 'ge-pcrop-handle';
      h.style.cssText = 'position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:#4af;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,0.55);cursor:grab;z-index:60;touch-action:none;';
      h.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); dragIdx = i; try { h.setPointerCapture(ev.pointerId); } catch {} });
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
    state.pcropActive = false;
    state.pcropCorners = null;
    dragIdx = -1;
  }

  return {
    start() {
      // Already mid-session: don't rebuild handles or clobber the user's
      // in-progress corners with a fresh default quad.
      if (state.pcropActive) return;
      const layer = activeLayer();
      if (!layer) return;
      const w = state.imgWidth, h = state.imgHeight;
      const ix = w * 0.12, iy = h * 0.12;
      state.pcropCorners = [{ x: ix, y: iy }, { x: w - ix, y: iy }, { x: w - ix, y: h - iy }, { x: ix, y: h - iy }];
      state.pcropActive = true;
      buildHandles();
      placeHandles();
      composite();
    },
    reposition() { if (state.pcropActive) placeHandles(); },
    apply() {
      if (!state.pcropActive || !state.pcropCorners) return;
      const corners = state.pcropCorners.map((c) => ({ ...c }));
      clearSession();
      applyCrop(corners); // caller de-skews all layers + resizes the doc
    },
    cancel() { if (state.pcropActive) { clearSession(); composite(); } },
    isActive() { return !!state.pcropActive; },
  };
}
