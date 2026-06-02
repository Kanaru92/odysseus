/**
 * Selection mask utilities — rasterize a polygon to an 8-bit mask and combine
 * masks with boolean ops, the foundation for Shift/Alt
 * selection modifiers + quick-mask. Pure canvas ops; original code.
 *
 * SCAFFOLD: not yet wired — see documentation/painting-suite/SELECTION.md for
 * the plan to unify the polygon (lasso/marquee) + wand-mask selection models.
 */

/** Rasterize a polygon (canvas-space points) into a white-on-transparent mask. */
export function polygonToMask(points, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (points && points.length >= 3) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    ctx.fill();
  }
  return c;
}

/**
 * Combine a `candidate` mask onto `base` with a selection modifier.
 * Returns a NEW canvas (inputs untouched). `base` may be null (→ candidate).
 *   replace  : candidate alone
 *   add      : base ∪ candidate            (source-over)
 *   subtract : base \ candidate            (destination-out)
 *   intersect: base ∩ candidate            (destination-in)
 */
export function combineMasks(base, candidate, mode = 'replace') {
  const w = Math.max((base && base.width) || 0, (candidate && candidate.width) || 0);
  const h = Math.max((base && base.height) || 0, (candidate && candidate.height) || 0);
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d');
  if (mode === 'replace' || !base) {
    if (candidate) ctx.drawImage(candidate, 0, 0);
    return out;
  }
  ctx.drawImage(base, 0, 0);
  if (!candidate) return out;
  ctx.globalCompositeOperation =
    mode === 'subtract' ? 'destination-out' :
    mode === 'intersect' ? 'destination-in' :
    'source-over'; // add
  ctx.drawImage(candidate, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  return out;
}

/** Map Shift/Alt modifiers (from a pointer/keyboard event) to a combine mode. */
export function modeFromEvent(e) {
  if (e && e.shiftKey && e.altKey) return 'intersect';
  if (e && e.shiftKey) return 'add';
  if (e && e.altKey) return 'subtract';
  return 'replace';
}
