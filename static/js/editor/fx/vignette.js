/**
 * Vignette — radially darken (or lighten) toward the edges, like the
 * lens-correction / lens-vignetting control in a standard photo editor.
 *
 * Model (matches the common photo-tool behaviour):
 *   - Distance of each pixel from the image centre, normalised by the
 *     half-diagonal so the extreme corners sit at d ≈ 1.0.
 *   - `roundness` warps that distance metric between an elliptical falloff
 *     that follows the frame aspect (square corners last) and a circular
 *     one (round corners), so the vignette can hug the frame or stay round.
 *   - `midpoint` sets where the falloff begins: the inner radius is clean,
 *     and from there a smoothstep ramp (widened by `feather`) blends to full
 *     strength at the outer radius.
 *   - `amount` < 0 darkens the edges (multiply toward black); `amount` > 0
 *     lightens them (screen toward white). 0 = identity / no-op.
 *
 * The core is a PURE function over a raw RGBA buffer — no canvas, no DOM —
 * so it is unit-testable in Node. `applyVignette` is a thin canvas wrapper
 * the editor uses; `applyAdjustmentVignette` matches the pixel-pass
 * `applyAdjustment(srcCanvas, adj)` contract for the per-layer FX stack.
 *
 * Params (all optional, defaults = identity-ish):
 *   {
 *     amount:    -100..100   (default 0)  // <0 darken edges, >0 lighten edges
 *     midpoint:   0..100     (default 50) // start radius of the falloff (% of max)
 *     roundness: -100..100   (default 0)  // -100 elliptical(frame) … +100 circular
 *     feather:    0..100     (default 50) // softness of the ramp
 *   }
 */

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const clampN = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Hermite smoothstep on the unit interval; t outside [0,1] saturates. */
function smoothstep(edge0, edge1, x) {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  let t = (x - edge0) / (edge1 - edge0);
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return t * t * (3 - 2 * t);
}

/**
 * Normalise + sanitise raw UI params into the numeric form the core uses.
 * Exported for testing and so the wrappers stay DRY.
 */
export function normalizeVignetteParams(params) {
  const p = params || {};
  return {
    amount: clampN(Number(p.amount) || 0, -100, 100),
    midpoint: clampN(p.midpoint == null ? 50 : Number(p.midpoint), 0, 100),
    roundness: clampN(Number(p.roundness) || 0, -100, 100),
    feather: clampN(p.feather == null ? 50 : Number(p.feather), 0, 100),
  };
}

/** True if the params produce no visible change (amount 0). */
export function vignetteIsIdentity(params) {
  const p = normalizeVignetteParams(params);
  return p.amount === 0;
}

/**
 * PURE CORE — apply a vignette to an RGBA pixel buffer in place.
 *
 * @param {Uint8ClampedArray} data  RGBA, length === width*height*4. Mutated.
 * @param {number} width
 * @param {number} height
 * @param {object} params           see module header
 * @returns {Uint8ClampedArray}     the same `data` (for chaining)
 */
export function vignettePixels(data, width, height, params) {
  const { amount, midpoint, roundness, feather } = normalizeVignetteParams(params);
  if (amount === 0 || width <= 0 || height <= 0) return data;

  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  // Half-extents. Elliptical metric divides each axis by its own half-extent
  // (so the falloff follows the frame); circular metric uses the half-diagonal
  // for both (so corners go round). `roundness` blends between them.
  const halfX = Math.max(1, cx);
  const halfY = Math.max(1, cy);
  const halfDiag = Math.max(1, Math.hypot(cx, cy));
  // roundness -100 → 0 (fully elliptical/frame), +100 → 1 (fully circular).
  const round = (roundness + 100) / 200;
  // Per-axis divisor lerps from the axis half-extent (elliptical) toward the
  // shared half-diagonal (circular).
  const divX = halfX + (halfDiag - halfX) * round;
  const divY = halfY + (halfDiag - halfY) * round;

  // Falloff band: inner radius (clean) → 1.0 (full strength at the corner).
  // midpoint pushes the inner radius outward; feather widens the ramp inward
  // from that inner radius so a high feather starts the darkening earlier.
  const inner = midpoint / 100;                 // 0..1 of the normalised radius
  const f = feather / 100;                       // 0..1
  // edge0 = where the ramp starts, edge1 = where it reaches full strength.
  // Feather pulls edge0 back toward the centre; with f=0 the ramp is a hard
  // step at `inner`, with f=1 it ramps all the way from the centre.
  const edge1 = 1.0;
  const edge0 = clampN(inner - f * inner, 0, edge1 - 1e-4);

  const darken = amount < 0;
  const strength = Math.abs(amount) / 100; // 0..1

  for (let y = 0; y < height; y++) {
    const ny = (y - cy) / divY;
    const ny2 = ny * ny;
    let i = y * width * 4;
    for (let x = 0; x < width; x++, i += 4) {
      const nx = (x - cx) / divX;
      const dist = Math.sqrt(nx * nx + ny2); // 0 at centre, ~1 at corner
      const t = smoothstep(edge0, edge1, dist) * strength; // 0..strength
      if (t > 0) {
        if (darken) {
          // multiply toward black: factor 1 → (1 - t)
          const m = 1 - t;
          data[i]     = clamp255(data[i] * m);
          data[i + 1] = clamp255(data[i + 1] * m);
          data[i + 2] = clamp255(data[i + 2] * m);
        } else {
          // screen toward white: v + (255 - v) * t
          data[i]     = clamp255(data[i] + (255 - data[i]) * t);
          data[i + 1] = clamp255(data[i + 1] + (255 - data[i + 1]) * t);
          data[i + 2] = clamp255(data[i + 2] + (255 - data[i + 2]) * t);
        }
      }
      // alpha (i+3) is left untouched
    }
  }
  return data;
}

/**
 * Thin canvas wrapper — returns a NEW canvas with the vignette applied.
 * Mirrors the `applyAdjustment(srcCanvas, adj)` style used elsewhere in fx/.
 *
 * @param {HTMLCanvasElement|OffscreenCanvas} srcCanvas
 * @param {object} params
 * @returns {HTMLCanvasElement} new canvas with the result
 */
export function applyVignette(srcCanvas, params) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  octx.drawImage(srcCanvas, 0, 0);
  if (vignetteIsIdentity(params) || w <= 0 || h <= 0) return out;
  const img = octx.getImageData(0, 0, w, h);
  vignettePixels(img.data, w, h, params);
  octx.putImageData(img, 0, 0);
  return out;
}

/**
 * Adjustment-stack entry point. Matches `applyAdjustment(srcCanvas, adj)`
 * so it can be slotted into pixel-pass.js's switch:
 *   if (adj.type === 'vignette') return applyAdjustmentVignette(srcCanvas, adj);
 *
 * @param {HTMLCanvasElement} srcCanvas
 * @param {{ type: string, params: object }} adj
 * @returns {HTMLCanvasElement}
 */
export function applyAdjustmentVignette(srcCanvas, adj) {
  return applyVignette(srcCanvas, (adj && adj.params) || {});
}
