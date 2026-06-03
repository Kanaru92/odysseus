/**
 * Paint-symmetry placement gizmo.
 *
 * When the user picks a symmetry mode, an on-canvas gizmo appears so they can
 * PLACE the symmetry centre (drag the centre dot) and REORIENT the axis (drag the
 * rotation knob) before committing — symmetry is NOT applied to strokes until
 * "Accept" (state.symActive). This matches the user's ask: position the gizmo,
 * accept, then paint mirrored.
 *
 * Writes state.symCx / state.symCy (document px) + state.symAngle (radians), and
 * state.symActive (accepted) / state.symGizmoArmed (placing). Handles are DOM
 * elements in the canvas-area, repositioned on every composite so they track
 * pan / zoom / scroll (same approach as the distort handles).
 */
import { state } from './state.js';

let host = null;            // canvas-area
let line = null, centerH = null, rotH = null, accept = null;
let onComposited = null;
const ROT_R = 64;           // screen px from centre to the rotation knob

function area() { return state.mainCanvas && state.mainCanvas.parentElement; }

function screenOf(docX, docY) {
  const c = state.mainCanvas, z = state.zoom || 1;
  return { x: c.offsetLeft + docX * z, y: c.offsetTop + docY * z };
}

function place() {
  if (!centerH || !state.mainCanvas) return;
  const p = screenOf(state.symCx, state.symCy);
  centerH.style.left = p.x + 'px'; centerH.style.top = p.y + 'px';
  const ang = state.symAngle || 0;
  const rx = p.x + Math.cos(ang) * ROT_R, ry = p.y + Math.sin(ang) * ROT_R;
  rotH.style.left = rx + 'px'; rotH.style.top = ry + 'px';
  // Axis line — a long thin rotated bar centred on the gizmo (the mirror axis for
  // x/y/xy; just an orientation indicator for radial/mandala).
  const L = 2000;
  line.style.left = p.x + 'px'; line.style.top = p.y + 'px';
  line.style.width = L + 'px';
  line.style.transform = `translate(${-L / 2}px,-1px) rotate(${ang}rad)`;
  line.style.transformOrigin = `${L / 2}px 1px`;
  if (accept) { accept.style.left = (p.x + 14) + 'px'; accept.style.top = (p.y + 14) + 'px'; }
}

function dragHandle(el, onMove) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    try { el.setPointerCapture(e.pointerId); } catch {}
    const move = (ev) => onMove(ev);
    const up = (ev) => {
      try { el.releasePointerCapture(ev.pointerId); } catch {}
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
    };
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
  });
}

export function dismissSymmetryGizmo() {
  state.symGizmoArmed = false;
  if (onComposited) { window.removeEventListener('ge:composited', onComposited); onComposited = null; }
  [line, centerH, rotH, accept].forEach((el) => { try { el && el.remove(); } catch {} });
  line = centerH = rotH = accept = host = null;
}

/** Arm the gizmo for placement (called when a symmetry mode is selected). */
export function armSymmetryGizmo() {
  dismissSymmetryGizmo();
  host = area();
  if (!host) return;
  // Default the centre to the canvas centre the first time.
  if (state.symCx == null || state.symCy == null) { state.symCx = (state.imgWidth || 0) / 2; state.symCy = (state.imgHeight || 0) / 2; }
  if (state.symAngle == null) state.symAngle = 0;
  state.symGizmoArmed = true;
  state.symActive = false; // not applied until accepted

  line = document.createElement('div');
  line.className = 'ge-sym-axis';
  line.style.cssText = 'position:absolute;height:2px;background:linear-gradient(90deg,rgba(224,108,117,0),rgba(224,108,117,0.9),rgba(224,108,117,0));pointer-events:none;z-index:58;';
  host.appendChild(line);

  const mkHandle = (title, color) => {
    const h = document.createElement('div');
    h.title = title;
    h.style.cssText = 'position:absolute;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;background:' + color + ';border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,0.55);cursor:grab;z-index:60;touch-action:none;';
    host.appendChild(h);
    return h;
  };
  centerH = mkHandle('Drag to move the symmetry centre', '#e06c75');
  rotH = mkHandle('Drag to rotate the symmetry axis', '#5b8aff');

  accept = document.createElement('button');
  accept.type = 'button'; accept.className = 'ge-btn ge-btn-sm ge-btn-primary';
  accept.textContent = 'Accept';
  accept.title = 'Apply symmetry (Enter)';
  accept.style.cssText = 'position:absolute;z-index:61;padding:2px 10px;';
  host.appendChild(accept);
  accept.addEventListener('click', () => { state.symActive = true; dismissSymmetryGizmo(); });

  // Drag centre → set symCx/symCy in document space.
  dragHandle(centerH, (ev) => {
    const r = state.mainCanvas.getBoundingClientRect(), z = state.zoom || 1;
    state.symCx = Math.max(0, Math.min(state.imgWidth, (ev.clientX - r.left) / z));
    state.symCy = Math.max(0, Math.min(state.imgHeight, (ev.clientY - r.top) / z));
    place();
  });
  // Drag knob → set symAngle from the centre.
  dragHandle(rotH, (ev) => {
    const p = screenOf(state.symCx, state.symCy);
    const area0 = host.getBoundingClientRect();
    state.symAngle = Math.atan2((ev.clientY - area0.top) - p.y, (ev.clientX - area0.left) - p.x);
    place();
  });

  onComposited = () => place();
  window.addEventListener('ge:composited', onComposited);
  place();
}
