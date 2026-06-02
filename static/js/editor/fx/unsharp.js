/**
 * Unsharp Mask — local-contrast sharpening that matches the classic
 * photo-darkroom / pro-editor behaviour:
 *
 *     out = src + amount * (src - gaussianBlur(src, radius))
 *
 * with a *threshold* so flat / low-contrast areas (skin, gradients, sky,
 * noise) are left untouched and only genuine edges are sharpened.
 *
 * Why a real Gaussian (not the box-blur sharpen in filters/filters.js):
 * Unsharp Mask quality depends on the smoothness of the blurred "mask".
 * A box blur produces blocky halos at large radii; a true Gaussian gives
 * the smooth, even halo the named pro tools produce. The blur here is a
 * separable Gaussian (horizontal then vertical pass), O(n * kernel) and
 * DOM-free so the core is unit-testable in Node.
 *
 * The core (`unsharpMask`) is a pure function over a raw
 * `Uint8ClampedArray` (RGBA, length = width*height*4) plus width/height
 * and a params object — no canvas, no DOM, no module state. A thin
 * `applyUnsharp(srcCanvas, params) -> canvas` wraps it for the editor.
 *
 * Params (industry-standard ranges/semantics):
 *   radius    : Gaussian blur radius in pixels   (0.1 .. 250, PS uses 0.1..1000)
 *   amount    : sharpening strength as a percent  (0 .. 500, PS uses 1..500;
 *               100 = add the full unsharp difference, 50 = half, etc.)
 *   threshold : minimum per-channel difference (0..255 "levels") a pixel must
 *               exceed before it is sharpened at all. 0 = sharpen everything.
 *
 * Alpha is preserved untouched (only R/G/B are sharpened), matching how the
 * named tools treat the unsharp filter on RGB.
 */

const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * Build a normalised 1-D Gaussian kernel for a given radius.
 * sigma = radius / 3 (3-sigma ≈ the visible support), kernel half-width =
 * ceil(radius). Returned kernel is symmetric, length 2*r+1, sums to 1.
 *
 * @param {number} radius
 * @returns {{ kernel: Float64Array, r: number }}
 */
export function gaussianKernel(radius) {
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return { kernel: Float64Array.of(1), r: 0 };
  const sigma = radius / 3 || 1e-6;
  const twoSigSq = 2 * sigma * sigma;
  const kernel = new Float64Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / twoSigSq);
    kernel[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  return { kernel, r };
}

/**
 * Separable Gaussian blur of the RGB channels of an RGBA buffer.
 * Returns a NEW Float32Array of length data.length holding the blurred
 * R/G/B (alpha slots are copied through unchanged). Edges use clamped
 * (replicate) sampling so borders don't darken.
 *
 * Kept as its own export so callers / tests can inspect the blurred mask
 * directly, and so a future filter could reuse it as a plain Gaussian.
 *
 * @param {Uint8ClampedArray|Uint8Array|number[]} data  RGBA, length w*h*4
 * @param {number} width
 * @param {number} height
 * @param {number} radius
 * @returns {Float32Array}
 */
export function gaussianBlurRGB(data, width, height, radius) {
  const { kernel, r } = gaussianKernel(radius);
  const n = width * height * 4;
  const out = new Float32Array(n);
  if (r === 0) {
    for (let i = 0; i < n; i++) out[i] = data[i];
    return out;
  }
  const tmp = new Float32Array(n);

  // Horizontal pass: data -> tmp
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      let accR = 0, accG = 0, accB = 0;
      for (let k = -r; k <= r; k++) {
        let xx = x + k;
        if (xx < 0) xx = 0; else if (xx >= width) xx = width - 1;
        const wgt = kernel[k + r];
        const j = row + xx * 4;
        accR += data[j] * wgt;
        accG += data[j + 1] * wgt;
        accB += data[j + 2] * wgt;
      }
      const o = row + x * 4;
      tmp[o] = accR; tmp[o + 1] = accG; tmp[o + 2] = accB;
      tmp[o + 3] = data[o + 3];
    }
  }

  // Vertical pass: tmp -> out
  for (let x = 0; x < width; x++) {
    const col = x * 4;
    for (let y = 0; y < height; y++) {
      let accR = 0, accG = 0, accB = 0;
      for (let k = -r; k <= r; k++) {
        let yy = y + k;
        if (yy < 0) yy = 0; else if (yy >= height) yy = height - 1;
        const wgt = kernel[k + r];
        const j = (yy * width) * 4 + col;
        accR += tmp[j] * wgt;
        accG += tmp[j + 1] * wgt;
        accB += tmp[j + 2] * wgt;
      }
      const o = (y * width) * 4 + col;
      out[o] = accR; out[o + 1] = accG; out[o + 2] = accB;
      out[o + 3] = tmp[o + 3];
    }
  }
  return out;
}

/**
 * Normalise / clamp raw params to safe, named-tool-equivalent ranges.
 * @param {{radius?:number, amount?:number, threshold?:number}} [params]
 */
export function normalizeUnsharpParams(params) {
  const p = params || {};
  const radius = Math.max(0, Math.min(250, Number(p.radius) || 0));
  const amount = Math.max(0, Math.min(500, Number(p.amount) || 0));
  const threshold = Math.max(0, Math.min(255, Math.round(Number(p.threshold) || 0)));
  return { radius, amount, threshold };
}

/**
 * Pure Unsharp Mask. Mutates `data` IN PLACE (R/G/B; alpha untouched) and
 * also returns it for convenience. No canvas / DOM dependency.
 *
 *   diff   = src - gaussianBlur(src, radius)        (per channel)
 *   if |diff| < threshold  -> leave the channel unchanged
 *   else                   -> out = src + (amount/100) * diff
 *
 * Threshold is the classic "skip low-contrast detail" gate from the named
 * tool: a pixel/channel is only sharpened when its difference from the
 * blurred version is at least `threshold` levels, which suppresses noise
 * amplification and protects smooth gradients.
 *
 * @param {Uint8ClampedArray} data   RGBA pixels, length width*height*4
 * @param {number} width
 * @param {number} height
 * @param {{radius:number, amount:number, threshold:number}} params
 * @returns {Uint8ClampedArray} the same `data`, mutated
 */
export function unsharpMask(data, width, height, params) {
  const { radius, amount, threshold } = normalizeUnsharpParams(params);
  // Nothing to do: zero strength or zero radius means src - blur == 0.
  if (amount <= 0 || radius <= 0) return data;

  const strength = amount / 100;
  const blur = gaussianBlurRGB(data, width, height, radius);
  const n = width * height * 4;

  for (let i = 0; i < n; i += 4) {
    for (let c = 0; c < 3; c++) {
      const idx = i + c;
      const src = data[idx];
      const diff = src - blur[idx];
      // Threshold gate: only sharpen edges whose local contrast is large
      // enough. Comparison is on the raw (pre-amount) difference, matching
      // the named tool — threshold is in input "levels", not output.
      if (threshold > 0 && Math.abs(diff) < threshold) continue;
      data[idx] = clamp8(src + strength * diff);
    }
  }
  return data;
}

/**
 * Canvas wrapper used by the editor: read pixels from `srcCanvas`, run the
 * pure Unsharp Mask, and return a NEW canvas with the result. The source
 * canvas is not modified.
 *
 * @param {HTMLCanvasElement} srcCanvas
 * @param {{radius:number, amount:number, threshold:number}} params
 * @returns {HTMLCanvasElement}
 */
export function applyUnsharp(srcCanvas, params) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  octx.drawImage(srcCanvas, 0, 0);
  const img = octx.getImageData(0, 0, w, h);
  unsharpMask(img.data, w, h, params);
  octx.putImageData(img, 0, 0);
  return out;
}

/** Default params for the Unsharp Mask dialog (named-tool-typical preset). */
export function defaultUnsharpParams() {
  return { radius: 1.0, amount: 100, threshold: 0 };
}
