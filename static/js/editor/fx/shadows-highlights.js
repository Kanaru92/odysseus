/**
 * Shadows / Highlights adjustment — lift detail out of crushed shadows and
 * recover blown highlights without flattening the whole image (the classic
 * "tone recovery" control found in pro photo editors).
 *
 * Pure pixel math, no DOM. The core operates on a raw RGBA buffer so it is
 * unit-testable in Node:
 *
 *   applyShadowsHighlights(data, width, height, params)   // mutates `data`
 *
 * A thin canvas wrapper for the editor's FX stack:
 *
 *   applyShadowsHighlightsCanvas(srcCanvas, params) -> canvas
 *
 * How it works (matches the standard Shadows/Highlights behaviour):
 *  1. Compute a per-pixel luminance L (Rec.709) in 0..1.
 *  2. Build a TONE MASK M:
 *       - radius <= 0  → global: M = L (the pixel's own luminance).
 *       - radius  > 0  → local adaptation: M = a blurred luminance map, so a
 *         dark pixel sitting inside a bright region is treated more like the
 *         region around it (this is what gives the localised, halo-aware look
 *         and prevents flat global lifting).
 *  3. Two smooth tone responses, both 0..1:
 *       - shadow weight  wS = smoothShadow(M)  ≈ strong where M is dark,
 *         fading out toward mid/highlights (weighted by 1-M with a soft knee).
 *       - highlight weight wH = smoothHighlight(M) ≈ strong where M is bright.
 *  4. Target a new luminance:
 *       Lnew = L + shadowsAmt * wS * (1 - L)   // lift darks toward mid
 *                - highlightsAmt * wH * L        // pull brights toward mid
 *     `(1-L)` / `L` keep the move bounded (can't push past white/black) and
 *     make the lift gentle near the ends — the same shape pro tools use.
 *  5. Re-apply the luminance change to RGB by ratio (preserve hue/saturation):
 *       gain = Lnew / L   → r,g,b *= gain  (with a small additive fallback for
 *     near-black pixels where the ratio is unstable).
 *
 * params:
 *   { shadows: 0..100,      // shadow lift amount (0 = off)
 *     highlights: 0..100,   // highlight recovery amount (0 = off)
 *     radius: 0..N pixels }  // 0 = global; >0 = local-adaptation blur radius
 */

const SH_DEFAULTS = { shadows: 0, highlights: 0, radius: 0 };

// Rec.709 luma weights (matches the rest of the FX stack's luminance basis).
const LR = 0.2126, LG = 0.7152, LB = 0.0722;

/** clamp to 0..255 */
function clamp8(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

/**
 * Separable box blur of a single-channel Float32 luminance plane (0..1).
 * Edge pixels clamp (replicate). Two box passes approximate a light Gaussian,
 * which is enough for a tone-mask and keeps it cheap. Returns a NEW array.
 */
function blurLumaPlane(luma, w, h, radius) {
  if (radius < 1) return luma;
  const r = Math.max(1, Math.round(radius));
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const win = 2 * r + 1;

  const onePass = (src, dst) => {
    // horizontal
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let x = -r; x <= r; x++) {
        const xi = x < 0 ? 0 : x >= w ? w - 1 : x;
        sum += src[row + xi];
      }
      for (let x = 0; x < w; x++) {
        tmp[row + x] = sum / win;
        const xOut = x - r < 0 ? 0 : x - r;
        const xIn = x + r + 1 >= w ? w - 1 : x + r + 1;
        sum += src[row + xIn] - src[row + xOut];
      }
    }
    // vertical
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) {
        const yi = y < 0 ? 0 : y >= h ? h - 1 : y;
        sum += tmp[yi * w + x];
      }
      for (let y = 0; y < h; y++) {
        dst[y * w + x] = sum / win;
        const yOut = y - r < 0 ? 0 : y - r;
        const yIn = y + r + 1 >= h ? h - 1 : y + r + 1;
        sum += tmp[yIn * w + x] - tmp[yOut * w + x];
      }
    }
  };

  onePass(luma, out);
  // second pass (out → out via tmp) to smooth the box-blur blockiness.
  onePass(out, out);
  return out;
}

/**
 * Apply Shadows/Highlights to an RGBA buffer in place.
 *
 * @param {Uint8ClampedArray} data  RGBA pixels (length = width*height*4).
 * @param {number} width
 * @param {number} height
 * @param {{shadows?:number, highlights?:number, radius?:number}} params
 * @returns {Uint8ClampedArray} the same `data` (mutated), for chaining.
 */
export function applyShadowsHighlights(data, width, height, params) {
  const p = params || {};
  // Clamp inputs to their documented ranges.
  const sAmt = Math.max(0, Math.min(100, p.shadows ?? SH_DEFAULTS.shadows)) / 100;
  const hAmt = Math.max(0, Math.min(100, p.highlights ?? SH_DEFAULTS.highlights)) / 100;
  const radius = Math.max(0, p.radius ?? SH_DEFAULTS.radius);

  // No-op fast path.
  if (sAmt <= 0 && hAmt <= 0) return data;

  const n = width * height;

  // 1) Per-pixel luminance plane (0..1).
  const luma = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    luma[i] = (LR * data[j] + LG * data[j + 1] + LB * data[j + 2]) / 255;
  }

  // 2) Tone mask: blurred luma for local adaptation, else the luma itself.
  const mask = radius >= 1 ? blurLumaPlane(luma, width, height, radius) : luma;

  // Tonal-width knee: how far up/down the tonal range each control reaches.
  // Larger amount → reaches a touch further into the midtones (gentle), which
  // mirrors how the pro control's range opens up as you push it.
  const sKnee = 0.5 + 0.5 * sAmt;   // shadow weight falls off by ~this point
  const hKnee = 0.5 + 0.5 * hAmt;   // highlight weight rises from ~(1-this)

  // 3..5) Per-pixel tone push, re-applied to RGB by luminance ratio.
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const L = luma[i];
    const M = mask[i];

    // Shadow weight: strong where the (masked) tone is dark, smooth knee.
    // wS = smoothstep falloff of (1 - M/sKnee), clamped to 0..1.
    let wS = 0;
    if (sAmt > 0 && M < sKnee) {
      const t = 1 - M / sKnee;            // 1 at black → 0 at the knee
      wS = t * t * (3 - 2 * t);           // smoothstep for a soft shoulder
    }
    // Highlight weight: strong where the (masked) tone is bright.
    let wH = 0;
    if (hAmt > 0 && M > 1 - hKnee) {
      const t = (M - (1 - hKnee)) / hKnee; // 0 at the knee → 1 at white
      wH = t * t * (3 - 2 * t);
    }

    // Target luminance. Bounded by (1-L)/L so it never crosses white/black.
    const lift = sAmt * wS * (1 - L);
    const pull = hAmt * wH * L;
    let Lnew = L + lift - pull;
    if (Lnew < 0) Lnew = 0; else if (Lnew > 1) Lnew = 1;

    if (Lnew === L) continue;

    if (L > 0.0039) {
      // Re-apply as a ratio so hue/saturation are preserved.
      const gain = Lnew / L;
      data[j]     = clamp8(data[j]     * gain);
      data[j + 1] = clamp8(data[j + 1] * gain);
      data[j + 2] = clamp8(data[j + 2] * gain);
    } else {
      // Near-black: ratio is unstable, add the luminance delta directly.
      const add = (Lnew - L) * 255;
      data[j]     = clamp8(data[j]     + add);
      data[j + 1] = clamp8(data[j + 1] + add);
      data[j + 2] = clamp8(data[j + 2] + add);
    }
    // alpha (j+3) untouched
  }

  return data;
}

/**
 * Canvas wrapper for the editor FX stack: returns a fresh canvas with the
 * Shadows/Highlights adjustment applied. Mirrors `applyAdjustment` in
 * fx/pixel-pass.js (no module state, no mutation of the source).
 *
 * @param {HTMLCanvasElement} srcCanvas
 * @param {{shadows?:number, highlights?:number, radius?:number}} params
 * @returns {HTMLCanvasElement}
 */
export function applyShadowsHighlightsCanvas(srcCanvas, params) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  octx.drawImage(srcCanvas, 0, 0);
  if (!w || !h) return out;
  const img = octx.getImageData(0, 0, w, h);
  applyShadowsHighlights(img.data, w, h, params);
  octx.putImageData(img, 0, 0);
  return out;
}

export { SH_DEFAULTS };
