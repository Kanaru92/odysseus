/**
 * Radial Blur — directional blur about a centre point, in two industry-
 * standard flavours:
 *
 *   - ZOOM: blur along radial lines from the centre. Each output pixel is
 *     averaged with a short trail of samples taken between the centre and
 *     a point slightly beyond it (the source pixel scaled toward / away
 *     from the centre). Gives the "rushing forward" / explosive zoom streak.
 *
 *   - SPIN: blur along concentric arcs. Each output pixel is averaged with
 *     samples rotated a few small angular steps around the centre, so the
 *     image smears tangentially — the "spinning record" / rotary motion look.
 *
 * Implementation is a pure backward-mapped resample (the standard hole-free
 * way to remap): for every OUTPUT pixel we gather N SOURCE samples along the
 * effect's path and average them. Sub-pixel source positions are read with
 * bilinear interpolation. Reads always come from the original `data` buffer
 * and results are written to a fresh output buffer, so no sample ever reads
 * a pixel we have already overwritten.
 *
 * Geometry: the blur amount grows with distance from the centre (pixels at
 * the centre barely move, the edges streak the most) — matching how the
 * named tools behave. `amount` (0..100) scales both the per-pixel blur
 * extent and the number of samples, so a small amount is cheap and a large
 * amount is smooth.
 *
 * Params shape:
 *   { amount?, mode?, cx?, cy? }
 *   - amount : 0..100 blur strength (default 50). 0 = identity (returns a
 *              copy of the source).
 *   - mode   : 'zoom' | 'spin' (default 'zoom').
 *   - cx, cy : centre of the effect in 0..1 normalised image coords
 *              (default 0.5, 0.5).
 *
 * Pure pixel math: no DOM, no module state. Alpha is sampled and averaged
 * along with RGB so semi-transparent edges blur correctly. Returns a NEW
 * Uint8ClampedArray (length w*h*4); the input `data` is never mutated, so a
 * caller wires it as `d.set(radialBlur(d, w, h, params))`.
 */

/**
 * Normalise / clamp raw params to safe ranges with sensible defaults.
 * @param {{amount?:number, mode?:string, cx?:number, cy?:number}} [params]
 * @returns {{amount:number, mode:string, cx:number, cy:number}}
 */
export function normalizeRadialParams(params) {
  const p = params || {};
  const amount = Math.max(0, Math.min(100, Number(p.amount)));
  const mode = p.mode === 'spin' ? 'spin' : 'zoom';
  const cx = Number.isFinite(Number(p.cx)) ? Number(p.cx) : 0.5;
  const cy = Number.isFinite(Number(p.cy)) ? Number(p.cy) : 0.5;
  return {
    amount: Number.isFinite(amount) ? amount : 50,
    mode,
    cx,
    cy,
  };
}

/**
 * Bilinear sample of the source buffer at sub-pixel (sx, sy). Out-of-bounds
 * corners contribute RGBA 0 (transparent pad) so the blur fades cleanly at
 * the borders instead of smearing the edge pixel. Accumulates the weighted
 * RGBA into `acc` (length-4) — the caller divides by the sample count.
 *
 * @param {Uint8ClampedArray} src  source RGBA
 * @param {number} w
 * @param {number} h
 * @param {number} sx              sub-pixel x
 * @param {number} sy              sub-pixel y
 * @param {Float64Array|number[]} acc  4-element accumulator (mutated)
 */
function accumBilinear(src, w, h, sx, sy, acc) {
  const x0 = Math.floor(sx), y0 = Math.floor(sy);
  const fx = sx - x0, fy = sy - y0;
  const x1 = x0 + 1, y1 = y0 + 1;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  // Per-corner: out-of-range corners contribute nothing (transparent pad).
  add(src, w, h, x0, y0, w00, acc);
  add(src, w, h, x1, y0, w10, acc);
  add(src, w, h, x0, y1, w01, acc);
  add(src, w, h, x1, y1, w11, acc);
}

function add(src, w, h, px, py, wt, acc) {
  if (wt === 0 || px < 0 || py < 0 || px >= w || py >= h) return;
  const i = (py * w + px) * 4;
  acc[0] += src[i] * wt;
  acc[1] += src[i + 1] * wt;
  acc[2] += src[i + 2] * wt;
  acc[3] += src[i + 3] * wt;
}

/**
 * Apply Radial Blur (zoom or spin) to a flat RGBA buffer.
 *
 * Pure: reads from the source `data` and writes a fresh result so the
 * backward map never reads partially-overwritten pixels. Returns a NEW
 * Uint8ClampedArray (length w*h*4); the input `data` is not mutated.
 *
 * @param {Uint8ClampedArray} data   source RGBA, length width*height*4
 * @param {number} w                 width
 * @param {number} h                 height
 * @param {object} params            see module header
 * @returns {Uint8ClampedArray}      blurred RGBA
 */
export function radialBlur(data, w, h, params) {
  const width = w | 0, height = h | 0;
  const out = new Uint8ClampedArray(Math.max(0, width * height * 4));
  if (width <= 0 || height <= 0) return out;

  const { amount, mode, cx, cy } = normalizeRadialParams(params);

  // Zero strength → identity: hand back a copy of the source untouched.
  if (amount <= 0) {
    out.set(data.subarray(0, out.length));
    return out;
  }

  const ccx = cx * width;
  const ccy = cy * height;
  // Normalising radius: half-diagonal to the farthest corner from the
  // centre, so the most distant pixel has normalised radius ~1 and streaks
  // the most. Guard divide-by-zero for a degenerate 1px image.
  let half = 0;
  for (const [x, y] of [[0, 0], [width, 0], [0, height], [width, height]]) {
    const dx = x - ccx, dy = y - ccy;
    const d = Math.hypot(dx, dy);
    if (d > half) half = d;
  }
  if (half <= 0) half = 1;

  // Sample count scales with strength (more samples = smoother streak).
  // Clamp to a sane range so a tiny amount stays cheap.
  const steps = Math.max(1, Math.round((amount / 100) * 32));

  if (mode === 'spin') {
    // Maximum sweep angle (radians) at the rim, scaled by strength. ~22.5°
    // at full strength gives a strong rotary smear without wrapping.
    const maxAngle = (amount / 100) * (Math.PI / 8);
    for (let oy = 0; oy < height; oy++) {
      const dyBase = oy + 0.5 - ccy;
      for (let ox = 0; ox < width; ox++) {
        const dxBase = ox + 0.5 - ccx;
        const radius = Math.hypot(dxBase, dyBase);
        const di = (oy * width + ox) * 4;
        if (radius < 1e-6) {
          // At the exact centre rotation is a no-op — copy the source pixel.
          out[di] = data[di]; out[di + 1] = data[di + 1];
          out[di + 2] = data[di + 2]; out[di + 3] = data[di + 3];
          continue;
        }
        const baseAngle = Math.atan2(dyBase, dxBase);
        // Sweep grows with distance from centre (rim spins most).
        const sweep = maxAngle * Math.min(1, radius / half);
        const acc = [0, 0, 0, 0];
        let count = 0;
        for (let s = 0; s < steps; s++) {
          // Symmetric sweep centred on the pixel's own angle.
          const t = steps > 1 ? (s / (steps - 1)) * 2 - 1 : 0; // -1..1
          const a = baseAngle + t * sweep;
          const sx = ccx + Math.cos(a) * radius - 0.5;
          const sy = ccy + Math.sin(a) * radius - 0.5;
          accumBilinear(data, width, height, sx, sy, acc);
          count++;
        }
        const inv = count > 0 ? 1 / count : 0;
        out[di] = acc[0] * inv; out[di + 1] = acc[1] * inv;
        out[di + 2] = acc[2] * inv; out[di + 3] = acc[3] * inv;
      }
    }
  } else {
    // ZOOM: sample along the radial line through the pixel, scaling its
    // distance from the centre between (1 - maxScale) and 1. Streak length
    // grows with distance from the centre (rim streaks most).
    const maxScale = (amount / 100) * 0.25; // up to 25% radial reach.
    for (let oy = 0; oy < height; oy++) {
      const dyBase = oy + 0.5 - ccy;
      for (let ox = 0; ox < width; ox++) {
        const dxBase = ox + 0.5 - ccx;
        const di = (oy * width + ox) * 4;
        const radius = Math.hypot(dxBase, dyBase);
        if (radius < 1e-6) {
          // Centre pixel does not move under a zoom blur.
          out[di] = data[di]; out[di + 1] = data[di + 1];
          out[di + 2] = data[di + 2]; out[di + 3] = data[di + 3];
          continue;
        }
        const acc = [0, 0, 0, 0];
        let count = 0;
        for (let s = 0; s < steps; s++) {
          // Scale factor sweeps from 1 down toward the centre by maxScale.
          // t in 0..1 → scale in [1 - maxScale, 1].
          const t = steps > 1 ? s / (steps - 1) : 0;
          const scale = 1 - maxScale * t;
          const sx = ccx + dxBase * scale - 0.5;
          const sy = ccy + dyBase * scale - 0.5;
          accumBilinear(data, width, height, sx, sy, acc);
          count++;
        }
        const inv = count > 0 ? 1 / count : 0;
        out[di] = acc[0] * inv; out[di + 1] = acc[1] * inv;
        out[di + 2] = acc[2] * inv; out[di + 3] = acc[3] * inv;
      }
    }
  }

  return out;
}

/** Default params for the Radial Blur dialog (named-tool-typical preset). */
export function defaultRadialParams() {
  return { amount: 50, mode: 'zoom', cx: 0.5, cy: 0.5 };
}
