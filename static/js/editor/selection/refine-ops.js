/**
 * Pure selection-mask refinement on an 8-bit alpha matte.
 *
 * These are the global refinements behind a Select-&-Mask panel: feather,
 * smooth, contrast, shift-edge, and expand/contract. They operate on the
 * mask's *alpha* channel (coverage), which is the canonical representation
 * for a selection — white-on-transparent masks carry their selection in
 * alpha, and that is what the wand/lasso plumbing stores.
 *
 * Design:
 *  - The core math is pure and DOM-free: it works on a single-channel
 *    `Uint8ClampedArray` of length w*h (the alpha matte) plus dimensions,
 *    so every op is deterministic and unit-testable in plain node.
 *  - Thin canvas wrappers (`refineMaskCanvas`, and the per-op `*Canvas`
 *    helpers) extract the alpha matte from an HTMLCanvasElement mask, run
 *    the pure op, write the alpha back as a white-premultiplied matte, and
 *    return a *fresh* canvas — inputs are never mutated.
 *  - The Gaussian blur is a hand-rolled separable kernel (not the browser's
 *    `ctx.filter='blur()'`), so results are identical across engines and in
 *    node. That determinism is what lets the panel preview match the bake.
 *
 * No DOM is touched by the pure functions; only the `*Canvas` wrappers use
 * `document`. Keep new logic in the pure layer where possible.
 */

/* ────────────────────────────  matte <-> ImageData  ──────────────────────── */

/**
 * Extract the alpha channel of an RGBA `ImageData`-like buffer into a fresh
 * single-channel matte (`Uint8ClampedArray`, length w*h).
 * @param {{data: Uint8ClampedArray|Uint8Array, width: number, height: number}} imageData
 * @returns {Uint8ClampedArray}
 */
export function alphaFromImageData(imageData) {
  const { data, width, height } = imageData;
  const n = width * height;
  const out = new Uint8ClampedArray(n);
  for (let i = 0, j = 3; i < n; i++, j += 4) out[i] = data[j];
  return out;
}

/**
 * Write a single-channel matte back into an RGBA buffer as a white,
 * alpha-premultiplied matte (RGB = 255 where covered; alpha = matte). This
 * matches how the editor stores selection/inpaint masks (white-on-transparent).
 * Mutates and returns `imageData`.
 * @param {{data: Uint8ClampedArray|Uint8Array, width: number, height: number}} imageData
 * @param {Uint8ClampedArray|Uint8Array} alpha  length must be width*height
 * @returns {typeof imageData}
 */
export function alphaToImageData(imageData, alpha) {
  const { data, width, height } = imageData;
  const n = width * height;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = alpha[i];
    data[j] = 255; data[j + 1] = 255; data[j + 2] = 255; data[j + 3] = a;
  }
  return imageData;
}

/* ─────────────────────────────  gaussian blur  ───────────────────────────── */

/**
 * Build a normalized 1-D Gaussian kernel for a given radius.
 * sigma = radius/3 (the conventional "3-sigma covers the radius" rule), so a
 * larger radius spreads coverage further. radius<=0 → identity ([1]).
 * @param {number} radius  blur radius in px (rounded up)
 * @returns {{kernel: Float32Array, radius: number}}
 */
export function gaussianKernel1D(radius) {
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return { kernel: Float32Array.of(1), radius: 0 };
  const sigma = r / 3 || 1;
  const twoSigma2 = 2 * sigma * sigma;
  const size = r * 2 + 1;
  const k = new Float32Array(size);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / twoSigma2);
    k[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < size; i++) k[i] /= sum;
  return { kernel: k, radius: r };
}

/**
 * Separable Gaussian blur of a single-channel matte. Pure; returns a fresh
 * `Float32Array` (kept in float to avoid rounding accumulation between the two
 * passes — callers that need bytes should round/clamp the result).
 * Edges use clamp-to-edge sampling so the matte does not darken at the border.
 * @param {Uint8ClampedArray|Uint8Array|Float32Array} src  length w*h
 * @param {number} w
 * @param {number} h
 * @param {number} radius  blur radius in px
 * @returns {Float32Array}  length w*h
 */
export function blurAlpha(src, w, h, radius) {
  const { kernel, radius: r } = gaussianKernel1D(radius);
  if (r === 0) return Float32Array.from(src);
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  // Horizontal pass: src -> tmp
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) {
        let sx = x + k;
        if (sx < 0) sx = 0; else if (sx >= w) sx = w - 1;
        acc += src[row + sx] * kernel[k + r];
      }
      tmp[row + x] = acc;
    }
  }
  // Vertical pass: tmp -> out
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) {
        let sy = y + k;
        if (sy < 0) sy = 0; else if (sy >= h) sy = h - 1;
        acc += tmp[sy * w + x] * kernel[k + r];
      }
      out[y * w + x] = acc;
    }
  }
  return out;
}

/* ────────────────────────────  refinement ops  ───────────────────────────── */
/* Each op: pure (Uint8ClampedArray matte + dims [+ amount]) -> fresh matte.   */

/**
 * Feather — soften the matte edge with a Gaussian blur. Larger px = softer.
 * @param {Uint8ClampedArray|Uint8Array} alpha  length w*h
 * @param {number} w
 * @param {number} h
 * @param {number} px  feather radius in px (0 = copy)
 * @returns {Uint8ClampedArray}
 */
export function feather(alpha, w, h, px) {
  const out = new Uint8ClampedArray(w * h);
  if (!(px > 0)) { out.set(alpha); return out; }
  const blurred = blurAlpha(alpha, w, h, px);
  for (let i = 0; i < out.length; i++) out[i] = blurred[i];
  return out;
}

/**
 * Smooth — remove jaggies / single-pixel noise from the matte while keeping a
 * hard-ish edge: blur, then re-threshold at the 50% coverage midpoint. This is
 * the "round off the corners" refinement (the standard Smooth), distinct from feather
 * which keeps the soft gradient.
 * @param {Uint8ClampedArray|Uint8Array} alpha  length w*h
 * @param {number} w
 * @param {number} h
 * @param {number} px  smoothing radius in px (0 = copy)
 * @returns {Uint8ClampedArray}
 */
export function smooth(alpha, w, h, px) {
  const out = new Uint8ClampedArray(w * h);
  if (!(px > 0)) { out.set(alpha); return out; }
  const blurred = blurAlpha(alpha, w, h, px);
  for (let i = 0; i < out.length; i++) out[i] = blurred[i] >= 128 ? 255 : 0;
  return out;
}

/**
 * Contrast — "level the matte": steepen (amount>0) or flatten (amount<0) the
 * coverage ramp around the 50% midpoint. Steepening hardens a feathered edge;
 * flattening softens a hard one. amount is in [-1,1]; 0 = copy.
 *
 * Maps coverage c∈[0,1] through a midpoint-pivoted gain:
 *   amount>0: gain = 1/(1-amount)  (→∞ as amount→1, i.e. a hard step)
 *   amount<0: gain = 1+amount      (→0 as amount→-1, i.e. flat 50%)
 *   out = clamp( 0.5 + (c-0.5)*gain )
 * @param {Uint8ClampedArray|Uint8Array} alpha  length w*h
 * @param {number} w
 * @param {number} h
 * @param {number} amount  [-1,1]
 * @returns {Uint8ClampedArray}
 */
export function contrast(alpha, w, h, amount) {
  const out = new Uint8ClampedArray(w * h);
  const a = Math.max(-1, Math.min(1, amount || 0));
  if (a === 0) { out.set(alpha); return out; }
  const gain = a > 0 ? 1 / (1 - a) : 1 + a;
  // Precompute a 256-entry LUT for speed + determinism.
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    const c = v / 255;
    const o = 0.5 + (c - 0.5) * gain;
    lut[v] = Math.round(Math.max(0, Math.min(1, o)) * 255);
  }
  for (let i = 0; i < out.length; i++) out[i] = lut[alpha[i]];
  return out;
}

/**
 * Shift the matte edge outward (px>0, grow) or inward (px<0, shrink) by
 * re-thresholding a blurred copy. Blurring by |px| spreads coverage across the
 * edge; thresholding low (grow) captures the spread, thresholding high (shrink)
 * keeps only the still-solid interior. Produces a hard edge at the new
 * position — this is the matte equivalent of a morphological dilate/erode and
 * is what `mask-utils.dilateMask` does, but pure and edge-clamped.
 *
 * Implementation note: a Gaussian falls to ~50% coverage at roughly its
 * radius for a straight edge, so thresholds are picked off-centre (grow keeps
 * the low tail, shrink drops the high tail) to move the edge by ~px.
 * @param {Uint8ClampedArray|Uint8Array} alpha  length w*h
 * @param {number} w
 * @param {number} h
 * @param {number} px  +grow / -shrink (0 = copy)
 * @returns {Uint8ClampedArray}
 */
export function shiftEdge(alpha, w, h, px) {
  const out = new Uint8ClampedArray(w * h);
  if (!px) { out.set(alpha); return out; }
  const grow = px > 0;
  const blurred = blurAlpha(alpha, w, h, Math.abs(px));
  // grow: keep anything the blur reached at all (low cutoff) → edge moves out.
  // shrink: keep only near-solid interior (high cutoff)       → edge moves in.
  const threshold = grow ? 8 : 247;
  for (let i = 0; i < out.length; i++) {
    out[i] = blurred[i] >= threshold ? 255 : 0;
  }
  return out;
}

/**
 * Expand — grow the matte by `px` (hard edge). Alias of `shiftEdge(+px)`.
 * @param {Uint8ClampedArray|Uint8Array} alpha
 * @param {number} w
 * @param {number} h
 * @param {number} px  px to expand (>0)
 * @returns {Uint8ClampedArray}
 */
export function expand(alpha, w, h, px) {
  return shiftEdge(alpha, w, h, Math.abs(px));
}

/**
 * Contract — shrink the matte by `px` (hard edge). Alias of `shiftEdge(-px)`.
 * @param {Uint8ClampedArray|Uint8Array} alpha
 * @param {number} w
 * @param {number} h
 * @param {number} px  px to contract (>0)
 * @returns {Uint8ClampedArray}
 */
export function contract(alpha, w, h, px) {
  return shiftEdge(alpha, w, h, -Math.abs(px));
}

/* ─────────────────────────  combined refinement  ─────────────────────────── */

/**
 * @typedef {Object} RefineSpec
 * @property {number} [smoothPx=0]    smooth (blur+threshold) first
 * @property {number} [shiftPx=0]     then shift edge (+grow / -shrink)
 * @property {number} [featherPx=0]   then feather (soft edge)
 * @property {number} [contrast=0]    then contrast the matte [-1,1]
 */

/**
 * Apply a full Select-&-Mask global-refinement pass to a matte in the
 * conventional order: Smooth → Shift Edge → Feather → Contrast. Pure.
 * Any field omitted/0 is a no-op for that stage. Returns a fresh matte.
 * @param {Uint8ClampedArray|Uint8Array} alpha  length w*h
 * @param {number} w
 * @param {number} h
 * @param {RefineSpec} spec
 * @returns {Uint8ClampedArray}
 */
export function refineMatte(alpha, w, h, spec = {}) {
  const { smoothPx = 0, shiftPx = 0, featherPx = 0, contrast: contrastAmt = 0 } = spec;
  let cur = new Uint8ClampedArray(w * h);
  cur.set(alpha);
  if (smoothPx > 0) cur = smooth(cur, w, h, smoothPx);
  if (shiftPx) cur = shiftEdge(cur, w, h, shiftPx);
  if (featherPx > 0) cur = feather(cur, w, h, featherPx);
  if (contrastAmt) cur = contrast(cur, w, h, contrastAmt);
  return cur;
}

/* ──────────────────────────────  canvas glue  ────────────────────────────── */
/* Thin wrappers for the editor; only these touch the DOM. Inputs untouched.   */

function _matteFromCanvas(srcCanvas) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const ctx = srcCanvas.getContext('2d');
  const img = ctx.getImageData(0, 0, w, h);
  return { alpha: alphaFromImageData(img), w, h, img };
}

function _matteToCanvas(alpha, w, h) {
  const out = (typeof document !== 'undefined')
    ? document.createElement('canvas')
    : null;
  if (!out) throw new Error('refine-ops: canvas wrappers require a DOM');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);
  alphaToImageData(img, alpha);
  octx.putImageData(img, 0, 0);
  return out;
}

/**
 * Run a single refinement op on an HTMLCanvasElement mask and return a fresh
 * canvas (input untouched). `op` is one of the pure ops above.
 * @param {HTMLCanvasElement} srcCanvas
 * @param {(alpha: Uint8ClampedArray, w: number, h: number, amount: number) => Uint8ClampedArray} op
 * @param {number} amount
 * @returns {HTMLCanvasElement}
 */
export function applyOpToCanvas(srcCanvas, op, amount) {
  const { alpha, w, h } = _matteFromCanvas(srcCanvas);
  const next = op(alpha, w, h, amount);
  return _matteToCanvas(next, w, h);
}

/**
 * Run a full {@link RefineSpec} pass on an HTMLCanvasElement mask (e.g.
 * `state.wandMask`) and return a fresh canvas (input untouched).
 * @param {HTMLCanvasElement} srcCanvas
 * @param {RefineSpec} spec
 * @returns {HTMLCanvasElement}
 */
export function refineMaskCanvas(srcCanvas, spec = {}) {
  const { alpha, w, h } = _matteFromCanvas(srcCanvas);
  const next = refineMatte(alpha, w, h, spec);
  return _matteToCanvas(next, w, h);
}

/* Per-op canvas convenience wrappers (used by a live-preview panel). */
export const featherCanvas  = (c, px)     => applyOpToCanvas(c, feather, px);
export const smoothCanvas   = (c, px)     => applyOpToCanvas(c, smooth, px);
export const contrastCanvas = (c, amount) => applyOpToCanvas(c, contrast, amount);
export const shiftEdgeCanvas = (c, px)    => applyOpToCanvas(c, shiftEdge, px);
export const expandCanvas   = (c, px)     => applyOpToCanvas(c, expand, px);
export const contractCanvas = (c, px)     => applyOpToCanvas(c, contract, px);
