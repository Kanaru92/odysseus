/**
 * Lens Distortion — geometric radial remap (barrel / pincushion).
 *
 * Pure pixel math, no DOM. Each OUTPUT pixel is mapped back through a
 * radial polynomial to a SOURCE position and bilinearly sampled
 * ("backward mapping" — the standard way to resample without holes):
 *
 *     r' = r · (1 + k1·r² + k2·r⁴)
 *
 * where `r` is the output pixel's distance from the image centre,
 * normalised so the half-diagonal = 1, and `r'` is the source distance
 * we read from. This is the radial part of the Brown–Conrady model used
 * by OpenCV / standard camera-calibration math.
 *
 * Sign convention (matches a photo-editor "Remove Distortion" slider):
 *   - k1 < 0  → barrel:     centre magnified, corners pulled in
 *               (straightens lines that bow OUT — the GoPro/fisheye fix).
 *   - k1 > 0  → pincushion: corners magnified, centre pulled in
 *               (straightens lines that bow IN).
 *   - k2 is the higher-order term that tames residual "moustache"
 *     distortion on very wide lenses.
 *
 * `amount` is a convenience UI control (−100..100). It drives k1 on a
 * gentle scale (±100 ≈ k1 ±0.5) when an explicit `k1` is not supplied.
 *
 * Edge handling (`edge`):
 *   - 'transparent' (default): source samples outside the image read as
 *     RGBA 0 — corners that map off-frame become transparent.
 *   - 'clamp': source coordinates are clamped to the border so corners
 *     stretch the edge pixel instead of going transparent.
 *
 * `scale` (default 1) zooms the source lookup. With `fit:true` the wrapper
 * computes a scale that pulls the four corners back inside the frame so a
 * correction that maps corners off-frame (pincushion, k1>0) doesn't leave
 * transparent wedges (the "scale to fill" behaviour of a lens-correction
 * dialog). Barrel (k1<0) reads inside the frame, so fit is a no-op there.
 *
 * Params shape:
 *   { amount?, k1?, k2?, scale?, fit?, edge?, centerX?, centerY? }
 *   - amount: -100..100 (ignored if k1 given)
 *   - k1, k2: raw polynomial coefficients (override amount)
 *   - scale:  source zoom multiplier (default 1)
 *   - fit:    auto scale-to-fill for barrel (overrides scale when true)
 *   - edge:   'transparent' | 'clamp'
 *   - centerX, centerY: optical centre in 0..1 (default 0.5, 0.5)
 */

/** UI amount (−100..100) → k1 coefficient. ±100 maps to roughly ±0.5. */
export function amountToK1(amount) {
  const a = Math.max(-100, Math.min(100, Number(amount) || 0));
  return (a / 100) * 0.5;
}

/**
 * Resolve a params object to concrete coefficients, with `amount` as a
 * fallback driver for k1. Pure — handy for tests and the wrapper.
 */
export function resolveLensParams(params = {}) {
  const k1 = (params.k1 !== undefined && params.k1 !== null)
    ? Number(params.k1)
    : amountToK1(params.amount);
  const k2 = Number(params.k2) || 0;
  const cx = (params.centerX !== undefined) ? Number(params.centerX) : 0.5;
  const cy = (params.centerY !== undefined) ? Number(params.centerY) : 0.5;
  const edge = params.edge === 'clamp' ? 'clamp' : 'transparent';
  return { k1, k2, cx, cy, edge };
}

/**
 * Compute the source scale needed so the worst (most outward-mapped)
 * corner lands exactly on the frame edge — the "scale to fill" that keeps
 * a correction from exposing transparent wedges.
 *
 * Backward map: an output pixel at radius r reads SOURCE radius r·factor,
 * factor = 1 + k1·r² + k2·r⁴. When factor > 1 the output corners read
 * BEYOND the frame → transparent gaps (this happens for pincushion, k1>0).
 * To fill them we shrink the source lookup by `scale` so the worst corner's
 * source radius lands on the edge: r·factor·scale ≤ r ⇒ scale ≤ 1/factor.
 * We take the tightest 1/factor across the four corners.
 *
 * When every corner's factor ≤ 1 (barrel, k1<0) the corners already read
 * inside the frame, so no zoom is needed and the result is clamped to 1.
 */
export function computeFitScale(width, height, params = {}) {
  const { k1, k2, cx, cy } = resolveLensParams(params);
  const w = width, h = height;
  const ccx = cx * w, ccy = cy * h;
  // Normalise by the half-diagonal from the optical centre to the
  // farthest corner (so the farthest corner has output radius 1).
  let half = 0;
  const corners = [[0, 0], [w, 0], [0, h], [w, h]];
  for (const [x, y] of corners) {
    const dx = x - ccx, dy = y - ccy;
    half = Math.max(half, Math.hypot(dx, dy));
  }
  if (half <= 0) return 1;
  let scale = 1;
  for (const [x, y] of corners) {
    const dx = (x - ccx) / half, dy = (y - ccy) / half;
    const r2 = dx * dx + dy * dy;
    const factor = 1 + k1 * r2 + k2 * r2 * r2; // srcR / outR
    // Only corners that read PAST the frame (factor>1) need shrinking;
    // for those scale ≤ 1/factor pulls them back to the edge.
    if (factor > 1) scale = Math.min(scale, 1 / factor);
  }
  // Only ever zoom IN (scale<=1) to cover gaps; never push corners further
  // out (that would only add MORE empty area).
  return Math.min(1, scale);
}

/**
 * Apply the lens-distortion remap to a flat RGBA buffer.
 *
 * Pure: reads from a SOURCE copy and writes a fresh result so the
 * backward map never reads partially-overwritten pixels. Returns a NEW
 * Uint8ClampedArray (length w*h*4); the input `data` is not mutated.
 *
 * @param {Uint8ClampedArray} data   source RGBA, length width*height*4
 * @param {number} width
 * @param {number} height
 * @param {object} params            see module header
 * @returns {Uint8ClampedArray}      remapped RGBA
 */
export function lensDistortPixels(data, width, height, params = {}) {
  const w = width | 0, h = height | 0;
  const out = new Uint8ClampedArray(w * h * 4);
  if (w <= 0 || h <= 0) return out;

  const { k1, k2, cx, cy, edge } = resolveLensParams(params);
  const scale = (params.scale !== undefined && params.scale !== null)
    ? Number(params.scale)
    : 1;
  const clampEdge = edge === 'clamp';

  const ccx = cx * w, ccy = cy * h;
  // Half-diagonal from the optical centre to the farthest corner →
  // the normalising radius so corners sit near r=1.
  let half = 0;
  for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]]) {
    half = Math.max(half, Math.hypot(x - ccx, y - ccy));
  }
  if (half <= 0) half = 1;
  const inv = 1 / half;

  const maxX = w - 1, maxY = h - 1;

  // Work in pixel-CENTRE space: a pixel index `o` has centre `o+0.5`.
  // We map the output centre through the polynomial and convert the
  // resulting source CENTRE back to a sampling coordinate by subtracting
  // 0.5, so the identity map (factor=1) sends pixel index → same index
  // exactly (no half-pixel bilinear smear).
  for (let oy = 0; oy < h; oy++) {
    const ndy = (oy + 0.5 - ccy) * inv;
    for (let ox = 0; ox < w; ox++) {
      const ndx = (ox + 0.5 - ccx) * inv;
      const r2 = ndx * ndx + ndy * ndy;
      // r' = r·(1 + k1 r² + k2 r⁴) → apply the same factor to the
      // normalised vector, then scale, then de-normalise back to pixels.
      const factor = (1 + k1 * r2 + k2 * r2 * r2) * scale;
      const sx = ccx + ndx * factor * half - 0.5;
      const sy = ccy + ndy * factor * half - 0.5;

      const di = (oy * w + ox) * 4;

      // Bilinear sample at (sx, sy).
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const fx = sx - x0, fy = sy - y0;

      if (clampEdge) {
        const cx0 = x0 < 0 ? 0 : x0 > maxX ? maxX : x0;
        const cy0 = y0 < 0 ? 0 : y0 > maxY ? maxY : y0;
        const cx1 = (x0 + 1) < 0 ? 0 : (x0 + 1) > maxX ? maxX : (x0 + 1);
        const cy1 = (y0 + 1) < 0 ? 0 : (y0 + 1) > maxY ? maxY : (y0 + 1);
        sampleBilinearInto(out, di, data, w, cx0, cy0, cx1, cy1, fx, fy);
      } else {
        // Transparent edge: any sample fully outside the image → RGBA 0.
        if (sx < -1 || sy < -1 || sx > w || sy > h) {
          out[di] = out[di + 1] = out[di + 2] = out[di + 3] = 0;
          continue;
        }
        // Per-corner: out-of-range corners contribute RGBA 0, so partial
        // edges fade out cleanly.
        sampleBilinearTransparent(out, di, data, w, h, x0, y0, fx, fy);
      }
    }
  }
  return out;
}

// Bilinear blend of four in-bounds corner indices (clamp mode — all
// corners pre-clamped to valid coords by the caller).
function sampleBilinearInto(out, di, src, w, x0, y0, x1, y1, fx, fy) {
  const i00 = (y0 * w + x0) * 4;
  const i10 = (y0 * w + x1) * 4;
  const i01 = (y1 * w + x0) * 4;
  const i11 = (y1 * w + x1) * 4;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  for (let c = 0; c < 4; c++) {
    out[di + c] = src[i00 + c] * w00 + src[i10 + c] * w10 +
                  src[i01 + c] * w01 + src[i11 + c] * w11;
  }
}

// Bilinear blend where any out-of-bounds corner contributes RGBA 0
// (transparent edge mode). Edges of the remapped image fade to
// transparent instead of stretching the border pixel.
function sampleBilinearTransparent(out, di, src, w, h, x0, y0, fx, fy) {
  const x1 = x0 + 1, y1 = y0 + 1;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  const acc = [0, 0, 0, 0];
  const add = (px, py, wt) => {
    if (px < 0 || py < 0 || px >= w || py >= h || wt === 0) return;
    const i = (py * w + px) * 4;
    acc[0] += src[i] * wt; acc[1] += src[i + 1] * wt;
    acc[2] += src[i + 2] * wt; acc[3] += src[i + 3] * wt;
  };
  add(x0, y0, w00); add(x1, y0, w10); add(x0, y1, w01); add(x1, y1, w11);
  out[di] = acc[0]; out[di + 1] = acc[1]; out[di + 2] = acc[2]; out[di + 3] = acc[3];
}

/**
 * Thin canvas wrapper: take a source canvas, apply the lens distortion,
 * return a NEW canvas with the result. DOM side — used by the app.
 *
 * Mirrors the `applyAdjustment(srcCanvas, adj)` shape in pixel-pass.js so
 * it slots into the same per-layer FX flow.
 *
 * @param {HTMLCanvasElement|OffscreenCanvas} srcCanvas
 * @param {object} params  see module header (supports `fit`)
 * @returns {HTMLCanvasElement}
 */
export function applyLensDistortion(srcCanvas, params = {}) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  if (!w || !h) return out;

  const sctx = srcCanvas.getContext('2d');
  const img = sctx.getImageData(0, 0, w, h);

  // `fit` auto-derives a scale-to-fill so an off-frame (pincushion) map
  // leaves no transparent corner gaps.
  const p = { ...params };
  if (p.fit) p.scale = computeFitScale(w, h, p);

  const result = lensDistortPixels(img.data, w, h, p);
  octx.putImageData(new ImageData(result, w, h), 0, 0);
  return out;
}
