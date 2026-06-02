/**
 * Median filter — edge-preserving denoise.
 *
 * Replaces each pixel's R/G/B with the MEDIAN of every value in a square
 * (2r+1)x(2r+1) neighbourhood, per channel, independently. The median (vs a
 * mean/box blur) rejects outliers — salt-and-pepper specks, sensor noise, and
 * stray hot pixels vanish while genuine edges stay crisp, because a median
 * never invents an in-between value the way an average does. This matches the
 * standard image-editor "Median" noise filter: a per-channel rank filter that
 * smooths flat noise yet preserves boundaries.
 *
 * Edge handling clamps sample coordinates to the image bounds (replicate),
 * matching the other neighbourhood filters in this editor. Alpha is passed
 * through unchanged (median is applied to colour only; opacity is preserved).
 *
 * The core is a PURE function over a raw RGBA buffer so it is unit-testable in
 * Node with no canvas/DOM. `applyMedian(srcCanvas, params)` is a thin browser
 * wrapper that returns a fresh canvas.
 *
 *   medianFilter(data, width, height, { radius })  // mutates `data` in place
 *   applyMedian(srcCanvas, { radius }) -> HTMLCanvasElement
 */

export const MEDIAN_RADIUS_MIN = 1;
export const MEDIAN_RADIUS_MAX = 5;

/** Clamp the radius param to the supported 1..5 integer range. */
export function clampRadius(radius) {
  let r = Math.round(Number(radius));
  if (!Number.isFinite(r)) r = MEDIAN_RADIUS_MIN;
  if (r < MEDIAN_RADIUS_MIN) r = MEDIAN_RADIUS_MIN;
  if (r > MEDIAN_RADIUS_MAX) r = MEDIAN_RADIUS_MAX;
  return r;
}

/**
 * Median-of-a-window helper. For the small windows this filter uses
 * (max 11x11 = 121 samples) an in-place insertion sort of a reused scratch
 * buffer is both fast and branch-friendly — effectively a sorting network for
 * the small fixed sizes, with no per-pixel allocation. Returns the middle
 * (lower-median) element after sorting `buf[0..count-1]`.
 */
function medianOf(buf, count) {
  // Insertion sort — O(n^2) but tiny n, fully in cache, no allocation.
  for (let i = 1; i < count; i++) {
    const v = buf[i];
    let j = i - 1;
    while (j >= 0 && buf[j] > v) { buf[j + 1] = buf[j]; j--; }
    buf[j + 1] = v;
  }
  return buf[count >> 1];
}

/**
 * Pure median filter over an RGBA byte buffer. Mutates `data` IN PLACE.
 *
 * @param {Uint8ClampedArray|Uint8Array|number[]} data  RGBA, length = w*h*4
 * @param {number} width
 * @param {number} height
 * @param {{radius?: number}} [params]  radius 1..5 (default 1)
 * @returns {typeof data} the same `data` reference (mutated)
 */
export function medianFilter(data, width, height, params) {
  const w = width | 0, h = height | 0;
  if (w <= 0 || h <= 0) return data;
  const r = clampRadius(params && params.radius != null ? params.radius : MEDIAN_RADIUS_MIN);
  const win = 2 * r + 1;
  const maxCount = win * win;

  // Work from a copy so each output pixel reads ONLY original neighbours
  // (an in-place median would feed already-filtered values back in).
  const src = data.slice();

  // Reused per-channel scratch buffers — no allocation inside the pixel loop.
  const bR = new Uint8Array(maxCount);
  const bG = new Uint8Array(maxCount);
  const bB = new Uint8Array(maxCount);

  const wm1 = w - 1, hm1 = h - 1;

  for (let y = 0; y < h; y++) {
    const y0 = y - r, y1 = y + r;
    for (let x = 0; x < w; x++) {
      const x0 = x - r, x1 = x + r;
      let n = 0;
      for (let yy = y0; yy <= y1; yy++) {
        // Replicate-edge clamp on the row.
        const cy = yy < 0 ? 0 : yy > hm1 ? hm1 : yy;
        const rowBase = cy * w;
        for (let xx = x0; xx <= x1; xx++) {
          const cx = xx < 0 ? 0 : xx > wm1 ? wm1 : xx;
          const j = (rowBase + cx) << 2;
          bR[n] = src[j];
          bG[n] = src[j + 1];
          bB[n] = src[j + 2];
          n++;
        }
      }
      const o = (y * w + x) << 2;
      data[o]     = medianOf(bR, n);
      data[o + 1] = medianOf(bG, n);
      data[o + 2] = medianOf(bB, n);
      // Alpha preserved (already correct in `data`; src copy is identical).
    }
  }
  return data;
}

/**
 * ImageData-friendly variant: takes/returns the `{ data, width, height }`
 * shape the editor's pixel-filter lib uses, mutating `img.data` in place.
 *
 * @param {{data: Uint8ClampedArray, width: number, height: number}} img
 * @param {{radius?: number}} [params]
 * @returns {typeof img}
 */
export function medianFilterImageData(img, params) {
  medianFilter(img.data, img.width, img.height, params);
  return img;
}

/**
 * Browser wrapper: median-filter a source canvas, returning a NEW canvas with
 * the result (the source is left untouched). DOM-only — not used by tests.
 *
 * @param {HTMLCanvasElement|OffscreenCanvas} srcCanvas
 * @param {{radius?: number}} [params]  radius 1..5
 * @returns {HTMLCanvasElement}
 */
export function applyMedian(srcCanvas, params) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  if (!w || !h) return out;
  octx.drawImage(srcCanvas, 0, 0);
  const img = octx.getImageData(0, 0, w, h);
  medianFilter(img.data, w, h, params);
  octx.putImageData(img, 0, 0);
  return out;
}

export default applyMedian;
