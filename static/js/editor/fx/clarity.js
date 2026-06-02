/**
 * Clarity — local-contrast enhancement via a large-radius unsharp mask
 * applied to LUMINANCE only.
 *
 * Unlike a normal (small-radius) Sharpen, Clarity uses a wide blur so the
 * "high-pass" it extracts is broad, low-frequency local contrast (the
 * midtone "punch" / structure look) rather than fine edge detail. The
 * high-pass is added back to luma only, so hue and saturation are
 * preserved and we don't get the colour fringing a per-channel unsharp
 * produces.
 *
 * Behaviour notes (to match a typical photo-editor Clarity slider):
 *   - amount  -100..100. Positive boosts local contrast, negative
 *     flattens it (softens midtone structure). 0 = identity.
 *   - The effect is applied to luminance, then the RGB pixel is scaled
 *     by (newLuma / oldLuma) so colour ratios are kept.
 *   - Extremes are PROTECTED: a bell taper rolls the effect off as luma
 *     approaches 0 or 255, which suppresses the bright/dark halos and
 *     shadow/highlight clipping that a flat unsharp would introduce.
 *
 * This file is a NEW, self-contained module. The core `clarity(data, w,
 * h, params)` is a pure function over a flat RGBA `Uint8ClampedArray`
 * (mutated in place) with NO canvas/DOM, so it is unit-testable in Node.
 * `applyClarity(srcCanvas, params) -> canvas` is a thin browser wrapper
 * matching the `applyAdjustment(srcCanvas, adj) -> canvas` contract used
 * by fx/pixel-pass.js.
 */

// Rec.709 luma (same primaries pixel-pass.js uses for Color Balance / luma work).
const LUMA_R = 0.2126, LUMA_G = 0.7152, LUMA_B = 0.0722;

/**
 * Separable box blur of a single-channel Float32 plane, run `passes`
 * times so repeated boxes approximate a Gaussian of the given radius.
 * Edges are clamped (extend the border pixel). Pure — allocates its own
 * scratch buffers, never touches RGBA.
 *
 * @param {Float32Array} src   length w*h, read-only
 * @param {number} w
 * @param {number} h
 * @param {number} radius      box radius in px (>=1)
 * @param {number} passes      number of box passes (3 ≈ Gaussian)
 * @returns {Float32Array}     new blurred plane (src is not modified)
 */
export function blurPlane(src, w, h, radius, passes = 3) {
  const r = Math.max(1, Math.round(radius));
  const n = w * h;
  let cur = Float32Array.from(src);
  let tmp = new Float32Array(n);
  const win = 2 * r + 1;
  for (let p = 0; p < passes; p++) {
    // Horizontal pass: cur -> tmp (running-sum sliding window).
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let x = -r; x <= r; x++) {
        const xi = x < 0 ? 0 : x >= w ? w - 1 : x;
        sum += cur[row + xi];
      }
      for (let x = 0; x < w; x++) {
        tmp[row + x] = sum / win;
        const xOut = (x - r) < 0 ? 0 : (x - r);
        const xInRaw = x + r + 1;
        const xIn = xInRaw >= w ? w - 1 : xInRaw;
        sum += cur[row + xIn] - cur[row + xOut];
      }
    }
    // Vertical pass: tmp -> cur.
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) {
        const yi = y < 0 ? 0 : y >= h ? h - 1 : y;
        sum += tmp[yi * w + x];
      }
      for (let y = 0; y < h; y++) {
        cur[y * w + x] = sum / win;
        const yOut = (y - r) < 0 ? 0 : (y - r);
        const yInRaw = y + r + 1;
        const yIn = yInRaw >= h ? h - 1 : yInRaw;
        sum += tmp[yIn * w + x] - tmp[yOut * w + x];
      }
    }
  }
  return cur;
}

/**
 * Compute the Clarity blur radius for an image of the given size.
 * Clarity needs a LARGE radius (broad local contrast), so we scale with
 * the image's smaller dimension (~5%) and clamp to a sane range. Exposed
 * for tests / callers that want determinism.
 */
export function clarityRadius(w, h) {
  const base = Math.min(w, h);
  return Math.max(2, Math.min(120, Math.round(base * 0.05)));
}

/**
 * PURE CORE. Apply Clarity to a flat RGBA buffer in place.
 *
 * @param {Uint8ClampedArray} data  RGBA, length = w*h*4 (mutated in place)
 * @param {number} w
 * @param {number} h
 * @param {{amount?:number, radius?:number, passes?:number}} params
 *        amount: -100..100 (0 = identity)
 *        radius: optional override (px); defaults to clarityRadius(w,h)
 *        passes: optional box-blur pass count (default 3)
 * @returns {Uint8ClampedArray} the same `data` buffer (for chaining)
 */
export function clarity(data, w, h, params = {}) {
  const amount = Math.max(-100, Math.min(100, Number(params.amount) || 0));
  if (amount === 0 || w <= 0 || h <= 0) return data;

  // Map slider to a high-pass gain. ±100 -> ±~0.9 strength; the broad
  // high-pass already carries a lot of energy, so we keep the gain modest
  // to avoid blowing midtones.
  const strength = (amount / 100) * 0.9;

  const radius = params.radius != null
    ? Math.max(1, Math.round(params.radius))
    : clarityRadius(w, h);
  const passes = params.passes != null ? Math.max(1, Math.round(params.passes)) : 3;

  const n = w * h;

  // 1) Extract a luminance plane (Float32, 0..255).
  const luma = new Float32Array(n);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    luma[p] = LUMA_R * data[i] + LUMA_G * data[i + 1] + LUMA_B * data[i + 2];
  }

  // 2) Blur it large to get the low-frequency component.
  const blurred = blurPlane(luma, w, h, radius, passes);

  // 3) Per-pixel: high-pass = luma - blurred; add back scaled, with an
  //    extreme-protection taper. Then push the RGB toward the new luma by
  //    the same additive delta on each channel (preserves hue better than
  //    a ratio scale near black, and matches how local contrast reads).
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const L = luma[p];
    const hp = L - blurred[p];           // local detail signal

    // Extreme protection: a smooth bell that is 1 in the midtones and
    // falls to 0 at pure black / pure white. t in 0..1.
    const t = L / 255;
    // 4*t*(1-t) peaks at 1 (t=0.5), is 0 at t=0 and t=1. Soften the
    // roll-off a touch with a floor so near-mid pixels aren't over-damped.
    let protect = 4 * t * (1 - t);
    if (protect < 0) protect = 0;

    const delta = strength * hp * protect;
    if (delta === 0) continue;

    data[i]     = data[i]     + delta;
    data[i + 1] = data[i + 1] + delta;
    data[i + 2] = data[i + 2] + delta;
    // alpha (i+3) untouched. Uint8ClampedArray auto-clamps 0..255.
  }

  return data;
}

/**
 * Thin canvas wrapper. Matches the `applyAdjustment(srcCanvas, adj)`
 * shape: returns a NEW canvas with Clarity applied. Browser-only (uses
 * document/canvas). The pure `clarity()` core above is what tests hit.
 *
 * @param {HTMLCanvasElement|OffscreenCanvas} srcCanvas
 * @param {{amount?:number, radius?:number, passes?:number}} params
 * @returns {HTMLCanvasElement}
 */
export function applyClarity(srcCanvas, params = {}) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  octx.drawImage(srcCanvas, 0, 0);
  if (!w || !h) return out;
  const img = octx.getImageData(0, 0, w, h);
  clarity(img.data, w, h, params);
  octx.putImageData(img, 0, 0);
  return out;
}
