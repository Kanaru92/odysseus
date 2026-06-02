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
    for (let i = 0; i < handles.length; i++) {
      const c = state.pcropCorners[i];
      handles[i].style.left = (canvas.offsetLeft + c.x * z) + 'px';
      handles[i].style.top = (canvas.offsetTop + c.y * z) + 'px';
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
  }
  function removeHandles() {
    handles.forEach((h) => { try { h.remove(); } catch {} });
    handles = [];
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
  }
  function clearSession() {
    removeHandles();
    state.pcropActive = false;
    state.pcropCorners = null;
    dragIdx = -1;
  }

  return {
    start() {
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
