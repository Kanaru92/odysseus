/**
 * Approximate CMYK soft-proof — a non-destructive "how will this look in print"
 * VIEW pass. It is applied to the on-screen composite only (never to layer
 * pixels or exports), so toggling it changes nothing about the document.
 *
 * This is a perceptual APPROXIMATION, not an ICC-colour-managed proof (that
 * would need a profile + a CMS). It models the three things a print preview
 * makes visible:
 *   1. CMYK prints DARKER than the screen commands — simulated with dot gain
 *      (a gamma > 1 applied to each ink) + a total-ink-coverage limit.
 *   2. The CMYK gamut is SMALLER — the most saturated RGB primaries can't be
 *      reproduced, so chroma is compressed toward the achromatic (luma) axis.
 *   3. Process inks aren't perfectly pure — recombination dulls the result.
 *
 * Pure pixel math lives in `cmykProofPixels` (unit-testable); `applyCmykProof`
 * is the canvas wrapper used by the compositor.
 */

const DOT_GAIN = 1.18;     // inks print darker than commanded (gamma on each ink)
const MAX_TAC = 3.0;       // total-area-coverage limit (~300%), C+M+Y+K
const CHROMA_COMPRESS = 0.12; // pull colour 12% toward luma (smaller gamut)

/**
 * Transform an RGBA pixel buffer IN PLACE to its simulated CMYK appearance.
 * Alpha is left untouched.
 * @param {Uint8ClampedArray} d
 */
export function cmykProofPixels(d) {
  const inv = 1 / DOT_GAIN;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a === 0) continue; // fully transparent — nothing to proof
    let r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    // RGB → CMYK with full grey-component replacement (GCR).
    let c = 1 - r, m = 1 - g, y = 1 - b;
    let k = Math.min(c, m, y);
    if (k < 1) { const ik = 1 / (1 - k); c = (c - k) * ik; m = (m - k) * ik; y = (y - k) * ik; }
    else { c = m = y = 0; }
    // Dot gain — inks reproduce darker than commanded.
    c = Math.pow(c, inv); m = Math.pow(m, inv); y = Math.pow(y, inv);
    const kk = Math.pow(k, inv);
    // Ink-limit: scale process inks down if total coverage is too high.
    const tac = c + m + y + kk;
    if (tac > MAX_TAC) { const f = MAX_TAC / tac; c *= f; m *= f; y *= f; }
    // CMYK → RGB through the (impure) ink model.
    let R = (1 - c) * (1 - kk), G = (1 - m) * (1 - kk), B = (1 - y) * (1 - kk);
    // Chroma compression toward luma — the CMYK gamut can't hit vivid RGB.
    const luma = 0.299 * R + 0.587 * G + 0.114 * B;
    R += (luma - R) * CHROMA_COMPRESS;
    G += (luma - G) * CHROMA_COMPRESS;
    B += (luma - B) * CHROMA_COMPRESS;
    d[i] = Math.round(Math.max(0, Math.min(1, R)) * 255);
    d[i + 1] = Math.round(Math.max(0, Math.min(1, G)) * 255);
    d[i + 2] = Math.round(Math.max(0, Math.min(1, B)) * 255);
  }
}

/**
 * Apply the soft-proof to a canvas region in place (reads → transforms → writes).
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} canvas
 */
export function applyCmykProof(ctx, canvas) {
  const w = canvas.width, h = canvas.height;
  if (!w || !h) return;
  const img = ctx.getImageData(0, 0, w, h);
  cmykProofPixels(img.data);
  ctx.putImageData(img, 0, 0);
}
