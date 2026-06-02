/**
 * Mosaic / Pixelate — the industry-standard blocky "pixel art" effect.
 *
 * The image is partitioned into a regular grid of `size`×`size` pixel
 * blocks. Every pixel inside a block is replaced with the AVERAGE colour
 * of that block, so each block becomes one flat tile — the classic
 * low-resolution "pixelated" / censor-bar look found in pro photo editors.
 *
 * Pure pixel math, no DOM, no module state. Following the displacement /
 * remap convention used by the other fx modules, the average for each
 * block is computed from a SOURCE read and written into a FRESH output
 * buffer, so a block's output never depends on pixels already overwritten.
 * A NEW `Uint8ClampedArray` is returned (the input is not mutated); the
 * caller wires it as `d.set(mosaic(d, w, h, params))`, matching
 * lens-distortion.js.
 *
 * Alpha handling: the average is alpha-weighted for R/G/B (transparent
 * source pixels contribute no colour, so a block that is part opaque keeps
 * the opaque colour instead of being darkened toward black), while the
 * alpha channel itself is the straight mean of the block. Fully
 * transparent blocks stay fully transparent. This preserves alpha rather
 * than letting RGBA-0 pixels bleed grey/black into semi-transparent tiles.
 *
 * Params:
 *   { size? }
 *   - size: block edge length in pixels (default 10). Values < 1 are
 *           clamped to 1 (a 1×1 block is a no-op copy). Non-integers are
 *           rounded. Blocks at the right/bottom edge are clipped to the
 *           image bounds, so any width/height works (no divide-by-zero).
 */

/**
 * Clamp / normalise the block size to a safe positive integer.
 * Missing, non-finite, or sub-1 values fall back to a sensible minimum.
 *
 * @param {number} size
 * @param {number} [fallback=10]
 * @returns {number} integer >= 1
 */
export function normalizeBlockSize(size, fallback = 10) {
  let s = Math.round(Number(size));
  if (!Number.isFinite(s)) s = Math.round(Number(fallback)) || 10;
  if (s < 1) s = 1;
  return s;
}

/**
 * Apply the mosaic / pixelate effect to a flat RGBA buffer.
 *
 * Pure: reads from the SOURCE `data` and writes a fresh result buffer so a
 * block's averaged colour never depends on pixels already overwritten.
 * Returns a NEW `Uint8ClampedArray` (length w*h*4); the input is not
 * mutated.
 *
 * @param {Uint8ClampedArray|Uint8Array|number[]} data  source RGBA, length width*height*4
 * @param {number} w   image width  in pixels
 * @param {number} h   image height in pixels
 * @param {{size?:number}} [params]
 * @returns {Uint8ClampedArray} pixelated RGBA
 */
export function mosaic(data, w, h, params) {
  const width = w | 0, height = h | 0;
  const out = new Uint8ClampedArray(Math.max(0, width * height * 4));
  if (width <= 0 || height <= 0) return out;

  const size = normalizeBlockSize(params && params.size, 10);

  // A 1×1 block is the identity (each pixel is its own average) — just copy
  // the source through so we never do redundant per-block work.
  if (size === 1) {
    out.set(data.subarray ? data.subarray(0, out.length) : data);
    return out;
  }

  // Walk the block grid. Blocks on the right/bottom edge are clipped to the
  // image bounds so non-multiple dimensions are handled without overrun.
  for (let by = 0; by < height; by += size) {
    const y1 = Math.min(by + size, height);
    for (let bx = 0; bx < width; bx += size) {
      const x1 = Math.min(bx + size, width);

      // Accumulate the block average. R/G/B are alpha-weighted so
      // transparent source pixels don't pull the colour toward black;
      // alpha is a straight mean over the block's pixels.
      let sumR = 0, sumG = 0, sumB = 0, sumA = 0, wsum = 0;
      let count = 0;
      for (let y = by; y < y1; y++) {
        let i = (y * width + bx) * 4;
        for (let x = bx; x < x1; x++, i += 4) {
          const a = data[i + 3];
          sumR += data[i] * a;
          sumG += data[i + 1] * a;
          sumB += data[i + 2] * a;
          sumA += a;
          wsum += a;
          count++;
        }
      }

      // Avoid divide-by-zero: an empty (impossible here) or fully
      // transparent block has no colour weight → leave it transparent.
      const avgA = count > 0 ? sumA / count : 0;
      let avgR = 0, avgG = 0, avgB = 0;
      if (wsum > 0) {
        avgR = sumR / wsum;
        avgG = sumG / wsum;
        avgB = sumB / wsum;
      }

      // Write the flat tile back into the fresh output buffer.
      for (let y = by; y < y1; y++) {
        let o = (y * width + bx) * 4;
        for (let x = bx; x < x1; x++, o += 4) {
          out[o] = avgR;
          out[o + 1] = avgG;
          out[o + 2] = avgB;
          out[o + 3] = avgA;
        }
      }
    }
  }

  return out;
}

/**
 * Thin canvas wrapper: take a source canvas, apply the mosaic effect, and
 * return a NEW canvas with the result. DOM side — used by the app. Mirrors
 * the `applyLensDistortion(srcCanvas, params)` shape so it slots into the
 * same per-layer FX flow.
 *
 * @param {HTMLCanvasElement|OffscreenCanvas} srcCanvas
 * @param {{size?:number}} [params]
 * @returns {HTMLCanvasElement}
 */
export function applyMosaic(srcCanvas, params = {}) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  if (!w || !h) return out;

  const sctx = srcCanvas.getContext('2d');
  const img = sctx.getImageData(0, 0, w, h);
  const result = mosaic(img.data, w, h, params);
  octx.putImageData(new ImageData(result, w, h), 0, 0);
  return out;
}

/** Default params for the Mosaic dialog. */
export function defaultMosaicParams() {
  return { size: 10 };
}
