/**
 * Response curve — maps a sensor value [0,1] through a user-editable curve to
 * an output [0,1]. This is the heart of the dynamics model: a sensor
 * (pressure/speed/…) drives a parameter THROUGH a curve, not linearly.
 *
 * Control points are [[x,y], …] in [0,1], x ascending. Baked into a LUT once
 * so per-dab evaluation is O(1) — strokes stamp hundreds of dabs.
 */
const RES = 256;

export function makeCurve(points) {
  const pts = (points && points.length >= 2 ? points.slice() : [[0, 0], [1, 1]])
    .sort((a, b) => a[0] - b[0]);
  const lut = new Float32Array(RES + 1);
  let j = 0;
  for (let i = 0; i <= RES; i++) {
    const x = i / RES;
    while (j < pts.length - 2 && x > pts[j + 1][0]) j++;
    const [x0, y0] = pts[j];
    const [x1, y1] = pts[j + 1];
    const t = x1 > x0 ? (x - x0) / (x1 - x0) : 0;
    lut[i] = y0 + (y1 - y0) * Math.max(0, Math.min(1, t));
  }
  return {
    sample(x) {
      const xi = Math.max(0, Math.min(1, x)) * RES;
      const i = Math.floor(xi);
      if (i >= RES) return lut[RES];
      return lut[i] + (lut[i + 1] - lut[i]) * (xi - i);
    },
  };
}

/** Common curve presets so callers don't hand-write control points. */
export const CURVES = {
  linear: [[0, 0], [1, 1]],
  // gentle ease so light pressure still lays down some paint
  soft: [[0, 0.15], [0.5, 0.55], [1, 1]],
  // steep — only firm pressure registers (inking)
  hard: [[0, 0], [0.6, 0.2], [1, 1]],
  flat: [[0, 1], [1, 1]],
};
