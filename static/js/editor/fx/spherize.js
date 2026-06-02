/**
 * Spherize / Pinch — radial displacement that wraps the image onto (or sucks
 * it into) a sphere within a circular region. A single industry-standard
 * effect covering BOTH directions via the sign of `amount`:
 *
 *   - amount > 0  → SPHERIZE / bulge: the centre is magnified and pixels are
 *                   pushed outward, as if the picture were mapped onto a
 *                   convex lens / glass bead.
 *   - amount < 0  → PINCH: the centre is squeezed inward, as if pulled toward
 *                   a point behind the image (a "suck" / pucker).
 *   - amount = 0  → identity (no change).
 *
 * Like the other geometric remaps in this editor (see lens-distortion.js) this
 * is a BACKWARD map: for every OUTPUT pixel we compute where to read in the
 * SOURCE and bilinearly sample there, which resamples without holes. Only
 * pixels inside the circle of `radius` (centred on cx,cy) are remapped; outside
 * the circle the source is copied through untouched.
 *
 * Remap curve. Let `d` be the output pixel's distance from the centre and
 * `t = d / radius` its normalised radius in 0..1. We bend `t` to a source
 * radius `t'` with a spherical curve and read SOURCE distance `t' * radius`
 * along the same direction:
 *
 *     t' = t + strength * sin(t * π) * (1 - t)       (approximate sphere bend)
 *
 * `sin(t·π)` is 0 at the centre and at the rim and peaks mid-radius, so the
 * displacement fades smoothly to nothing at both the centre and the boundary
 * (no seam where the circle meets untouched pixels). The extra `(1 - t)`
 * weights the bend toward the centre, giving the characteristic centre-heavy
 * magnification of a sphere/bulge. With `strength > 0` the source radius is
 * pulled inward (t' < t) so the magnified centre is sampled from a smaller
 * source region — visual magnification (bulge). With `strength < 0` it is
 * pushed outward (pinch). `strength = amount / 100` maps the UI range
 * (-100..100) to a calibrated bend.
 *
 * Edge handling: source samples outside the image read as transparent RGBA 0
 * (per-corner), matching lens-distortion.js's transparent-pad mode, so a remap
 * that reaches off-frame fades cleanly instead of stretching a border pixel.
 * Alpha is sampled and preserved like any other channel.
 *
 * The core is PURE — raw math over a `Uint8ClampedArray`, no DOM, no module
 * state — so it is unit-testable in Node. It reads from a COPY of the source
 * and writes a FRESH output buffer, and RETURNS a new Uint8ClampedArray (the
 * input is never mutated); the caller wires it as `d.set(spherize(d,w,h,p))`.
 *
 * Params shape:
 *   { amount?, cx?, cy?, radius? }
 *   - amount: -100..100  (+ bulge/sphere, - pinch; default 0 = identity)
 *   - cx, cy: centre of the effect in 0..1 (default 0.5, 0.5)
 *   - radius: effect radius in PIXELS (default = half the smaller dimension)
 */

/**
 * Resolve a params object to concrete, clamped values with sensible defaults.
 * Pure — handy for tests and the core. Guards divide-by-zero on radius.
 *
 * @param {object} [params]
 * @param {number} width
 * @param {number} height
 * @returns {{ amount:number, ccx:number, ccy:number, radius:number }}
 */
export function resolveSpherizeParams(params, width, height) {
  const p = params || {};
  const w = width | 0, h = height | 0;
  const amount = Math.max(-100, Math.min(100, Number(p.amount) || 0));
  const cx = (p.cx !== undefined && p.cx !== null) ? Number(p.cx) : 0.5;
  const cy = (p.cy !== undefined && p.cy !== null) ? Number(p.cy) : 0.5;
  const defaultR = Math.min(w, h) / 2;
  let radius = (p.radius !== undefined && p.radius !== null)
    ? Number(p.radius)
    : defaultR;
  if (!Number.isFinite(radius) || radius <= 0) radius = defaultR || 1;
  return { amount, ccx: cx * w, ccy: cy * h, radius };
}

/**
 * Apply the Spherize/Pinch remap to a flat RGBA buffer.
 *
 * Pure: reads from a SOURCE copy and writes a fresh result so the backward map
 * never reads partially-overwritten pixels. Returns a NEW Uint8ClampedArray
 * (length w*h*4); the input `data` is not mutated.
 *
 * @param {Uint8ClampedArray} data   source RGBA, length width*height*4
 * @param {number} width
 * @param {number} height
 * @param {object} [params]          see module header
 * @returns {Uint8ClampedArray}      remapped RGBA
 */
export function spherize(data, width, height, params = {}) {
  const w = width | 0, h = height | 0;
  const out = new Uint8ClampedArray(w * h * 4);
  if (w <= 0 || h <= 0) return out;

  // Read from a stable copy so the backward map never sees our own writes.
  const src = new Uint8ClampedArray(data);
  const { amount, ccx, ccy, radius } = resolveSpherizeParams(params, w, h);

  // No-op: copy through untouched (still a fresh, independent buffer).
  if (amount === 0) {
    out.set(src);
    return out;
  }

  const strength = amount / 100; // + bulge, - pinch
  const invR = 1 / radius;       // radius guaranteed > 0 by resolver
  const r2 = radius * radius;    // squared radius for cheap circle test

  for (let oy = 0; oy < h; oy++) {
    // Work in pixel-CENTRE space so the identity map (t'=t) sends a pixel
    // index back to its own index exactly (no half-pixel bilinear smear).
    const dy = (oy + 0.5) - ccy;
    for (let ox = 0; ox < w; ox++) {
      const dx = (ox + 0.5) - ccx;
      const di = (oy * w + ox) * 4;
      const dist2 = dx * dx + dy * dy;

      // Outside the circle of influence → copy the source pixel straight
      // through, leaving the surrounding image untouched.
      if (dist2 >= r2) {
        out[di] = src[di]; out[di + 1] = src[di + 1];
        out[di + 2] = src[di + 2]; out[di + 3] = src[di + 3];
        continue;
      }

      const dist = Math.sqrt(dist2);
      // Exact centre: no direction to displace along; sample the centre.
      let sx, sy;
      if (dist < 1e-9) {
        sx = ccx - 0.5;
        sy = ccy - 0.5;
      } else {
        const t = dist * invR; // normalised radius 0..1 inside the circle
        // Spherical bend: zero at centre & rim, centre-weighted. Positive
        // strength pulls the source radius inward (magnify/bulge); negative
        // pushes it outward (pinch).
        const tPrime = t - strength * Math.sin(t * Math.PI) * (1 - t);
        // Source distance along the SAME radial direction.
        const srcDist = tPrime * radius;
        const scale = srcDist / dist; // ratio reuses the existing dx,dy vector
        sx = ccx + dx * scale - 0.5;
        sy = ccy + dy * scale - 0.5;
      }

      // Bilinear sample at (sx, sy); out-of-bounds corners → transparent.
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const fx = sx - x0, fy = sy - y0;
      sampleBilinearTransparent(out, di, src, w, h, x0, y0, fx, fy);
    }
  }
  return out;
}

/**
 * Bilinear blend where any out-of-bounds corner contributes RGBA 0
 * (transparent-pad edge mode). Edges of the remapped region fade to
 * transparent instead of stretching the border pixel. Mirrors the helper in
 * lens-distortion.js.
 */
function sampleBilinearTransparent(out, di, src, w, h, x0, y0, fx, fy) {
  const x1 = x0 + 1, y1 = y0 + 1;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  let r = 0, g = 0, b = 0, a = 0;
  const add = (px, py, wt) => {
    if (px < 0 || py < 0 || px >= w || py >= h || wt === 0) return;
    const i = (py * w + px) * 4;
    r += src[i] * wt; g += src[i + 1] * wt;
    b += src[i + 2] * wt; a += src[i + 3] * wt;
  };
  add(x0, y0, w00); add(x1, y0, w10); add(x0, y1, w01); add(x1, y1, w11);
  out[di] = r; out[di + 1] = g; out[di + 2] = b; out[di + 3] = a;
}

/**
 * Thin canvas wrapper: take a source canvas, apply the spherize/pinch remap,
 * return a NEW canvas with the result. DOM side — used by the editor; mirrors
 * the `applyLensDistortion(srcCanvas, params)` shape so it slots into the same
 * per-layer FX flow.
 *
 * @param {HTMLCanvasElement|OffscreenCanvas} srcCanvas
 * @param {object} [params]  see module header
 * @returns {HTMLCanvasElement}
 */
export function applySpherize(srcCanvas, params = {}) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  if (!w || !h) return out;

  const sctx = srcCanvas.getContext('2d');
  const img = sctx.getImageData(0, 0, w, h);
  const result = spherize(img.data, w, h, params);
  octx.putImageData(new ImageData(result, w, h), 0, 0);
  return out;
}

/** Default params for a Spherize dialog (industry-standard bulge preset). */
export function defaultSpherizeParams() {
  return { amount: 50, cx: 0.5, cy: 0.5 };
}
