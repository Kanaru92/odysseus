/**
 * Chromatic Aberration — radial RGB channel separation.
 *
 * Simulates the coloured edge-fringing a real lens produces: the red and
 * blue channels are sampled at slightly different scales about the optical
 * centre while green stays fixed, so the three channels drift apart the
 * further a pixel is from the centre. At the centre there is zero shift
 * (sharp); at the frame edges the fringe is strongest — the physically
 * correct, radius-weighted behaviour (a uniform whole-image channel offset
 * would instead smear the centre and is wrong).
 *
 * Pure algorithm core — `chromaticAberration(data, w, h, params)` operates on
 * a flat RGBA `Uint8ClampedArray` with NO canvas / DOM, so it is unit-testable
 * in Node. `applyChromaticAberration(srcCanvas, params)` is the thin canvas
 * wrapper the editor's FX stack calls (same shape as fx/pixel-pass.js's
 * `applyAdjustment`): returns a fresh canvas with the result.
 *
 * Model
 * -----
 * For each output pixel at (x, y) we compute the radial vector from the
 * centre, then sample each channel from a position scaled along that vector:
 *
 *     sample R from  centre + radialVec * (1 + k * t^falloff)
 *     sample G from  (x, y)                       (fixed reference)
 *     sample B from  centre + radialVec * (1 - k * t^falloff)
 *
 * where
 *     t = normalisedRadius  (0 at centre, 1 at the farthest corner)
 *     k = the per-unit-radius scale derived from `amount`
 *
 * Scaling R outward and B inward (R and B move in opposite radial
 * directions) reproduces the classic red/cyan ⇄ blue/yellow fringe pair.
 * `falloff` shapes how quickly the fringe ramps up toward the edges
 * (1 = linear, 2 = quadratic — concentrates the effect at the rim like a
 * real lens). Bilinear sampling keeps the shifted channels smooth.
 *
 * Params (all optional; sensible industry-standard defaults):
 *   {
 *     amount:    number,   // strength. With unit:'percent' this is the % of the
 *                          //   half-diagonal the edge fringe spans (default 2).
 *                          //   With unit:'px' it is the max edge offset in px.
 *     unit:      'percent' | 'px',   // how `amount` is interpreted (default 'percent')
 *     falloff:   number,   // radial ramp exponent, >=1 (default 2)
 *     centerX:   number,   // optical centre X in [0,1] (default 0.5)
 *     centerY:   number,   // optical centre Y in [0,1] (default 0.5)
 *     direction: number,   // +1 = R outward / B inward (default), -1 swaps them
 *   }
 *
 * The adjustment type id is 'chromatic-aberration'.
 */

const DEFAULTS = {
  amount: 2,
  unit: 'percent',
  falloff: 2,
  centerX: 0.5,
  centerY: 0.5,
  direction: 1,
};

function _num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/**
 * Resolve raw params against the defaults and normalise ranges.
 * Exported so the canvas wrapper and tests share one source of truth.
 */
export function normalizeParams(params) {
  const p = params || {};
  const unit = p.unit === 'px' ? 'px' : 'percent';
  return {
    amount: _num(p.amount, DEFAULTS.amount),
    unit,
    falloff: Math.max(0.1, _num(p.falloff, DEFAULTS.falloff)),
    centerX: Math.min(1, Math.max(0, _num(p.centerX, DEFAULTS.centerX))),
    centerY: Math.min(1, Math.max(0, _num(p.centerY, DEFAULTS.centerY))),
    direction: _num(p.direction, DEFAULTS.direction) < 0 ? -1 : 1,
  };
}

/**
 * Bilinear sample of a single channel from a source RGBA buffer, with edge
 * clamping. `off` selects the channel (0=R,1=G,2=B,3=A).
 */
function sampleChannel(src, w, h, fx, fy, off) {
  // Clamp the sample point to the valid pixel area.
  if (fx < 0) fx = 0; else if (fx > w - 1) fx = w - 1;
  if (fy < 0) fy = 0; else if (fy > h - 1) fy = h - 1;
  const x0 = fx | 0, y0 = fy | 0;
  const x1 = x0 + 1 < w ? x0 + 1 : x0;
  const y1 = y0 + 1 < h ? y0 + 1 : y0;
  const dx = fx - x0, dy = fy - y0;
  const i00 = (y0 * w + x0) * 4 + off;
  const i10 = (y0 * w + x1) * 4 + off;
  const i01 = (y1 * w + x0) * 4 + off;
  const i11 = (y1 * w + x1) * 4 + off;
  const top = src[i00] + (src[i10] - src[i00]) * dx;
  const bot = src[i01] + (src[i11] - src[i01]) * dx;
  return top + (bot - top) * dy;
}

/**
 * PURE CORE. Apply radial chromatic aberration to an RGBA pixel buffer.
 *
 * Reads from a snapshot of the original pixels and writes the result back
 * into `data` in place (so the caller's buffer ends up holding the output).
 * Returns the same `data` reference for convenience.
 *
 * @param {Uint8ClampedArray} data  length must be w*h*4 (RGBA)
 * @param {number} w
 * @param {number} h
 * @param {object} [params]  see module header
 * @returns {Uint8ClampedArray} data (mutated in place)
 */
export function chromaticAberration(data, w, h, params) {
  if (!w || !h) return data;
  const { amount, unit, falloff, centerX, centerY, direction } = normalizeParams(params);

  const cx = centerX * (w - 1);
  const cy = centerY * (h - 1);

  // Farthest distance from the centre to any corner — the normalising radius
  // so `t` reaches 1.0 exactly at the most distant corner.
  const corners = [
    Math.hypot(0 - cx, 0 - cy),
    Math.hypot((w - 1) - cx, 0 - cy),
    Math.hypot(0 - cx, (h - 1) - cy),
    Math.hypot((w - 1) - cx, (h - 1) - cy),
  ];
  const maxR = Math.max(corners[0], corners[1], corners[2], corners[3]) || 1;

  // Convert `amount` to `k`, the per-radius positional scale applied to the
  // radial vector. With unit 'percent', `amount`% of the half-diagonal (maxR)
  // is the peak edge offset; with 'px' it is that peak offset directly. We
  // express the shift multiplicatively on the radial vector, so at the edge
  // (radius ~= maxR) the offset magnitude ≈ k * maxR.
  const edgeOffsetPx = unit === 'px' ? amount : (amount / 100) * maxR;
  const k = (edgeOffsetPx / maxR) * direction;

  // No measurable effect → leave the buffer untouched (identity).
  if (Math.abs(edgeOffsetPx) < 1e-6) return data;

  // Snapshot the source so writes don't corrupt later reads.
  const src = data.slice();

  for (let y = 0; y < h; y++) {
    const ry = y - cy;
    for (let x = 0; x < w; x++) {
      const rx = x - cx;
      const dist = Math.hypot(rx, ry);
      const t = dist / maxR; // 0..1
      // Radius-weighted scale: more shift toward the edges.
      const scale = k * Math.pow(t, falloff);

      // R outward, B inward (opposite radial directions). The sample point is
      // centre + radialVec * (1 ± scale); radialVec = (rx, ry).
      const rfx = cx + rx * (1 + scale);
      const rfy = cy + ry * (1 + scale);
      const bfx = cx + rx * (1 - scale);
      const bfy = cy + ry * (1 - scale);

      const o = (y * w + x) * 4;
      data[o]     = sampleChannel(src, w, h, rfx, rfy, 0); // R shifted
      data[o + 1] = src[o + 1];                            // G fixed
      data[o + 2] = sampleChannel(src, w, h, bfx, bfy, 2); // B shifted
      data[o + 3] = src[o + 3];                            // A unchanged
    }
  }
  return data;
}

/**
 * Canvas wrapper for the editor FX stack. Mirrors fx/pixel-pass.js's
 * `applyAdjustment(srcCanvas, adj)` calling convention: takes a source
 * canvas, returns a NEW canvas holding the aberrated result. Pure aside
 * from allocating the output canvas.
 *
 * @param {HTMLCanvasElement|OffscreenCanvas} srcCanvas
 * @param {object} [params]  see module header
 * @returns {HTMLCanvasElement} fresh canvas with the effect applied
 */
export function applyChromaticAberration(srcCanvas, params) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  octx.drawImage(srcCanvas, 0, 0);
  if (!w || !h) return out;
  const img = octx.getImageData(0, 0, w, h);
  chromaticAberration(img.data, w, h, params);
  octx.putImageData(img, 0, 0);
  return out;
}

export default applyChromaticAberration;
