/**
 * Tone-curve math — maps control points to a 256-entry lookup table using
 * monotone cubic Hermite interpolation (Fritsch–Carlson). The curve through
 * the points stays smooth WITHOUT overshooting (overshoot would locally invert
 * tones / create false contours). Pure + DOM-free → unit-testable.
 *
 * A "curve" is an array of `[input, output]` points, both 0..255, sorted by
 * input ascending. Identity is `[[0,0],[255,255]]`.
 */
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * Build a 256-entry Uint8ClampedArray LUT from control points.
 * Inputs below the first point hold its output; inputs above the last hold
 * its output (flat clamp, like a standard curves tool).
 */
export function buildCurveLUT(points) {
  const lut = new Uint8ClampedArray(256);
  const pts = (points || [])
    .filter((p) => Array.isArray(p) && p.length === 2
      && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .slice()
    .sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) { for (let v = 0; v < 256; v++) lut[v] = v; return lut; }
  const n = pts.length;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);

  // Secant slopes between consecutive points.
  const d = new Array(n - 1);
  for (let k = 0; k < n - 1; k++) {
    const dx = xs[k + 1] - xs[k];
    d[k] = dx === 0 ? 0 : (ys[k + 1] - ys[k]) / dx;
  }
  // Initial tangents (one-sided at the ends, averaged in the interior).
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let k = 1; k < n - 1; k++) m[k] = (d[k - 1] + d[k]) / 2;
  // Fritsch–Carlson: clamp tangents so the spline is monotonic.
  for (let k = 0; k < n - 1; k++) {
    if (d[k] === 0) { m[k] = 0; m[k + 1] = 0; continue; }
    const a = m[k] / d[k];
    const b = m[k + 1] / d[k];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[k] = tau * a * d[k];
      m[k + 1] = tau * b * d[k];
    }
  }
  // Evaluate the Hermite spline at each integer input.
  let k = 0;
  for (let v = 0; v < 256; v++) {
    if (v <= xs[0]) { lut[v] = clamp255(Math.round(ys[0])); continue; }
    if (v >= xs[n - 1]) { lut[v] = clamp255(Math.round(ys[n - 1])); continue; }
    while (k < n - 2 && v > xs[k + 1]) k++;
    const h = xs[k + 1] - xs[k];
    const t = (v - xs[k]) / h;
    const t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    const y = h00 * ys[k] + h10 * h * m[k] + h01 * ys[k + 1] + h11 * h * m[k + 1];
    lut[v] = clamp255(Math.round(y));
  }
  return lut;
}

/**
 * Build per-channel LUTs from a curves params object, composing the master
 * (rgb) curve with each individual channel curve — the channel curve is
 * applied AFTER the master, matching the common composite + per-channel model.
 *
 * @param {{rgb?:Array, r?:Array, g?:Array, b?:Array}} params
 * @returns {{ r: Uint8ClampedArray, g: Uint8ClampedArray, b: Uint8ClampedArray }}
 */
export function buildCurvesLUTs(params) {
  const id = [[0, 0], [255, 255]];
  const p = params || {};
  const rgb = buildCurveLUT(p.rgb || id);
  const cr = buildCurveLUT(p.r || id);
  const cg = buildCurveLUT(p.g || id);
  const cb = buildCurveLUT(p.b || id);
  const compose = (chan) => {
    const out = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) out[v] = chan[rgb[v]];
    return out;
  };
  return { r: compose(cr), g: compose(cg), b: compose(cb) };
}

/** True if a curves params object is the identity (no-op) on every channel. */
export function curvesIsIdentity(params) {
  if (!params) return true;
  for (const ch of ['rgb', 'r', 'g', 'b']) {
    const pts = params[ch];
    if (!pts) continue;
    if (!Array.isArray(pts) || pts.length < 2) return false;
    // Identity = every control point lies on the input===output diagonal AND
    // the curve spans the full range (first input 0, last input 255). This
    // also matches collinear identities expressed with extra midpoints, e.g.
    // [[0,0],[128,128],[255,255]], which the strict 2-point check missed.
    let prevX = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const pt = pts[i];
      if (!Array.isArray(pt) || pt.length !== 2 || pt[0] !== pt[1]) return false;
      if (pt[0] < prevX) return false; // points must be ascending by input
      prevX = pt[0];
    }
    if (pts[0][0] !== 0 || pts[pts.length - 1][0] !== 255) return false;
  }
  return true;
}
