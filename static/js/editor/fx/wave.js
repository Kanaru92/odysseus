/**
 * Wave — sinusoidal displacement remap (industry-standard "Wave" distortion).
 *
 * Each OUTPUT pixel is offset along the chosen orientation(s) by a sine wave
 * and the SOURCE position is bilinearly sampled ("backward mapping" — the
 * standard hole-free way to resample a geometric distortion):
 *
 *     dx = amplitude · sin(2π · y / wavelength)   (horizontal: shift rows along X)
 *     dy = amplitude · sin(2π · x / wavelength)   (vertical:   shift cols along Y)
 *
 * The offset for a given orientation is driven by the PERPENDICULAR coordinate,
 * so a "horizontal" wave makes vertical lines ripple left/right (the classic
 * flag/water-ripple look) and a "vertical" wave makes horizontal lines ripple
 * up/down. "both" applies both axes at once.
 *
 * Pure pixel math, no DOM, no module state. Reads from a COPY of the source
 * (the input `data`) and writes a fresh output buffer, so the remap never
 * reads pixels it has already overwritten. Returns a NEW Uint8ClampedArray
 * (length w*h*4); the input is not mutated — the caller wires it as
 * `d.set(wave(d, w, h, params))`. This matches lens-distortion.js.
 *
 * Edge handling: source samples that fall outside the image read as RGBA 0
 * (transparent pad), with per-corner contribution so partial edges fade out
 * cleanly. Alpha is preserved (sampled like the colour channels).
 *
 * Params shape:
 *   { amplitude?, wavelength?, orientation? }
 *   - amplitude:   peak displacement in pixels            (default 10)
 *   - wavelength:  distance for one full cycle in pixels   (default 40, > 0)
 *   - orientation: 'horizontal' | 'vertical' | 'both'      (default 'horizontal')
 */

/**
 * Normalise / clamp raw params to safe values, guarding divide-by-zero on
 * wavelength. Pure — handy for tests and the core.
 *
 * @param {{amplitude?:number, wavelength?:number, orientation?:string}} [params]
 * @returns {{amplitude:number, wavelength:number, orientation:string}}
 */
export function normalizeWaveParams(params) {
  const p = params || {};
  const amplitude = Number.isFinite(Number(p.amplitude)) ? Number(p.amplitude) : 10;
  let wavelength = Number(p.wavelength);
  if (!Number.isFinite(wavelength) || wavelength === 0) wavelength = 40;
  // Guard divide-by-zero / sign quirks: wavelength is a positive distance.
  wavelength = Math.max(1e-6, Math.abs(wavelength));
  const o = String(p.orientation || 'horizontal').toLowerCase();
  const orientation = (o === 'vertical' || o === 'both') ? o : 'horizontal';
  return { amplitude, wavelength, orientation };
}

/**
 * Apply a sine-wave displacement to a flat RGBA buffer.
 *
 * Pure: reads from the SOURCE `data` and writes a fresh result, so the
 * backward map never reads partially-overwritten pixels. Returns a NEW
 * Uint8ClampedArray (length w*h*4); the input `data` is not mutated.
 *
 * @param {Uint8ClampedArray} data   source RGBA, length width*height*4
 * @param {number} w
 * @param {number} h
 * @param {object} params            see module header
 * @returns {Uint8ClampedArray}      displaced RGBA
 */
export function wave(data, w, h, params = {}) {
  const width = w | 0, height = h | 0;
  const out = new Uint8ClampedArray(width * height * 4);
  if (width <= 0 || height <= 0) return out;

  const { amplitude, wavelength, orientation } = normalizeWaveParams(params);
  const k = (2 * Math.PI) / wavelength;
  const doH = orientation === 'horizontal' || orientation === 'both';
  const doV = orientation === 'vertical' || orientation === 'both';

  for (let oy = 0; oy < height; oy++) {
    // Horizontal wave: each row's X shift is driven by its Y coordinate.
    const dx = doH ? amplitude * Math.sin(k * oy) : 0;
    for (let ox = 0; ox < width; ox++) {
      // Vertical wave: each column's Y shift is driven by its X coordinate.
      const dy = doV ? amplitude * Math.sin(k * ox) : 0;
      // Backward map: read the source from where this output pixel came from.
      const sx = ox + dx;
      const sy = oy + dy;
      const di = (oy * width + ox) * 4;
      sampleBilinearTransparent(out, di, data, width, height, sx, sy);
    }
  }
  return out;
}

/**
 * Bilinear sample of `src` at sub-pixel (sx, sy), writing RGBA into
 * `out[di..di+3]`. Any of the four corners that fall outside the image
 * contribute RGBA 0, so edges that pull in off-image pixels fade to
 * transparent instead of stretching the border. Alpha is sampled too.
 */
function sampleBilinearTransparent(out, di, src, w, h, sx, sy) {
  const x0 = Math.floor(sx), y0 = Math.floor(sy);
  const x1 = x0 + 1, y1 = y0 + 1;
  const fx = sx - x0, fy = sy - y0;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  let r = 0, g = 0, b = 0, a = 0;
  const add = (px, py, wt) => {
    if (px < 0 || py < 0 || px >= w || py >= h || wt === 0) return;
    const i = (py * w + px) * 4;
    r += src[i] * wt; g += src[i + 1] * wt;
    b += src[i + 2] * wt; a += src[i + 3] * wt;
  };
  add(x0, y0, w00); add(x1, y0, w10); add(x0, y1, w01); add(x1, y1, w11);
  out[di] = r; out[di + 1] = g; out[di + 2] = b; out[di + 3] = a;
}
