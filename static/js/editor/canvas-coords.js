/**
 * Convert a pointer event's client coordinates into the canvas's
 * internal pixel coordinates, accounting for current display scale and
 * (when the View is rotated, R / Shift+R) the canvas view rotation.
 *
 * Handles both mouse and the first finger of a touch event.
 *
 * @param {MouseEvent|TouchEvent} e
 * @param {HTMLCanvasElement} canvas
 * @returns {{x: number, y: number}}
 */
import { state } from './state.js';

export function canvasCoords(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  const rot = state.viewRotation || 0;
  if (!rot) {
    // Fast path (no view rotation) — unchanged behaviour.
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }
  // View is rotated: invert the rotation about the canvas centre (the centre is
  // preserved under rotation, so rect's AABB centre == the true centre). The
  // displayed scale is state.zoom (canvas.style.width = imgWidth*zoom), which we
  // use directly because rect.width is the rotated AABB, not the canvas width.
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  const dx = clientX - cx, dy = clientY - cy;
  const a = -rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const rx = dx * c - dy * s, ry = dx * s + dy * c;
  const z = state.zoom || 1;
  return { x: canvas.width / 2 + rx / z, y: canvas.height / 2 + ry / z };
}
