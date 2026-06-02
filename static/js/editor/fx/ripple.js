/**
 * Ripple — sinusoidal pixel displacement ("water ripple" warp).
 *
 * The industry-standard Ripple distortion offsets each pixel by a small
 * sinusoidal amount, producing the wavy, water-on-glass look. This is a
 * geometric remap (no colour change), so it uses BACKWARD mapping — for
 * every OUTPUT pixel we compute a displaced SOURCE coordinate and
 * bilinearly sample there. Backward mapping is the standard resample
 * approach: it visits each output pixel exactly once and never leaves holes.
 *
 * Displacement model (per output pixel at integer position x, y):
 *
 *     dx = A · sin(2π · y / wavelength)
 *     dy = A · sin(2π · x / wavelength)
 *     src = ( x + dx ,  y + dy )
 *
 * where the wave amplitude
 *
 *     A = (amount / 100) · waveAmp
 *
 * The horizontal offset is driven by the pixel's Y coordinate and the
 * vertical offset by its X coordinate, so rows and columns ripple across
 * each other and the warp reads as a 2-D wave rather than a 1-D shear.
 *
 * Pure pixel math — no DOM, no canvas, no module state. Reads from a COPY
 * of the source (the input `data` itself, never partially-overwritten) and
 * writes a FRESH output buffer, then returns that new buffer. The input is
 * NOT mutated. This matches the lens-distortion module's contract; the
 * caller wires it as `d.set(ripple(d, w, h, params))`.
 *
 * Params shape:
 *   { amount?, wavelength?, waveAmp?, edge? }
 *   - amount:     0..100 strength of the effect          (default 50)
 *   - wavelength: distance in px between wave crests      (default 20)
 *   - waveAmp:    max pixel offset at amount = 100        (default 10)
 *   - edge:       'transparent' (default) | 'clamp'
 *                 how to treat source samples off the image:
 *                 'transparent' → off-frame reads as RGBA 0 (edges fade out),
 *                 'clamp'       → off-frame coords clamp to the border pixel.
 *
 * Alpha is preserved (sampled like the colour channels).
 */

/** Defaults for any missing / invalid params (named-tool-typical preset). */
export function defaultRippleParams() {
  return { amount: 50, wavelength: 20, waveAmp: 10, edge: 'transparent' };
}

/**
 * Normalise raw params to safe values, guarding divide-by-zero on the
 * wavelength. Pure — handy for tests and the core.
 *
 * @param {{amount?:number, wavelength?:number, waveAmp?:number, edge?:string}} [params]
 * @returns {{amount:number, wavelength:number, waveAmp:number, clampEdge:boolean}}
 */
export function normalizeRippleParams(params) {
  const p = params || {};
  const amount = Math.max(0, Math.min(100, Number(p.amount)));
  // Wavelength must be > 0 (it is the denominator of the sine phase); fall
  // back to the default and floor at a tiny positive value to be safe.
  let wavelength = Number(p.wavelength);
  if (!(wavelength > 0)) wavelength = 20;
  wavelength = Math.max(1e-6, wavelength);
  let waveAmp = Number(p.waveAmp);
  if (!(waveAmp >= 0)) waveAmp = 10;
  const clampEdge = p.edge === 'clamp';
  return {
    amount: Number.isFinite(amount) ? amount : 50,
    wavelength,
    waveAmp,
    clampEdge,
  };
}

/**
 * Apply the sinusoidal ripple remap to a flat RGBA buffer.
 *
 * Pure: reads from the SOURCE buffer and writes a fresh result so the
 * backward map never reads partially-overwritten pixels. Returns a NEW
 * Uint8ClampedArray (length w*h*4); the input `data` is not mutated.
 *
 * @param {Uint8ClampedArray} data   source RGBA, length width*height*4
 * @param {number} w                 image width
 * @param {number} h                 image height
 * @param {object} [params]          see module header
 * @returns {Uint8ClampedArray}      rippled RGBA
 */
export function ripple(data, w, h, params) {
  const width = w | 0, height = h | 0;
  const out = new Uint8ClampedArray(Math.max(0, width * height * 4));
  if (width <= 0 || height <= 0) return out;

  const { amount, wavelength, waveAmp, clampEdge } = normalizeRippleParams(params);
  const A = (amount / 100) * waveAmp;

  // Zero amplitude → identity remap; copy the source straight through so the
  // result is an exact, un-smeared copy (and we skip all the sine work).
  if (A === 0) {
    out.set(data.subarray(0, out.length));
    return out;
  }

  const TWO_PI = Math.PI * 2;
  const k = TWO_PI / wavelength;
  const maxX = width - 1, maxY = height - 1;

  for (let y = 0; y < height; y++) {
    // Horizontal offset depends on the row (Y); precompute once per row.
    const dx = A * Math.sin(k * y);
    for (let x = 0; x < width; x++) {
      // Vertical offset depends on the column (X).
      const dy = A * Math.sin(k * x);
      const sx = x + dx;
      const sy = y + dy;
      const di = (y * width + x) * 4;

      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const fx = sx - x0, fy = sy - y0;

      if (clampEdge) {
        const cx0 = x0 < 0 ? 0 : x0 > maxX ? maxX : x0;
        const cy0 = y0 < 0 ? 0 : y0 > maxY ? maxY : y0;
        const cx1 = (x0 + 1) < 0 ? 0 : (x0 + 1) > maxX ? maxX : (x0 + 1);
        const cy1 = (y0 + 1) < 0 ? 0 : (y0 + 1) > maxY ? maxY : (y0 + 1);
        sampleBilinearClamp(out, di, data, width, cx0, cy0, cx1, cy1, fx, fy);
      } else {
        // Fully off-frame → transparent; otherwise per-corner transparent pad.
        if (sx < -1 || sy < -1 || sx > width || sy > height) {
          out[di] = out[di + 1] = out[di + 2] = out[di + 3] = 0;
          continue;
        }
        sampleBilinearTransparent(out, di, data, width, height, x0, y0, fx, fy);
      }
    }
  }
  return out;
}

// Bilinear blend of four in-bounds corner indices (clamp mode — all corners
// pre-clamped to valid coords by the caller). Alpha is blended too.
function sampleBilinearClamp(out, di, src, w, x0, y0, x1, y1, fx, fy) {
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
// (transparent edge mode). Image borders fade to transparent instead of
// stretching the edge pixel. Alpha is blended too.
function sampleBilinearTransparent(out, di, src, w, h, x0, y0, fx, fy) {
  const x1 = x0 + 1, y1 = y0 + 1;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  let a0 = 0, a1 = 0, a2 = 0, a3 = 0;
  const add = (px, py, wt) => {
    if (px < 0 || py < 0 || px >= w || py >= h || wt === 0) return;
    const i = (py * w + px) * 4;
    a0 += src[i] * wt; a1 += src[i + 1] * wt;
    a2 += src[i + 2] * wt; a3 += src[i + 3] * wt;
  };
  add(x0, y0, w00); add(x1, y0, w10); add(x0, y1, w01); add(x1, y1, w11);
  out[di] = a0; out[di + 1] = a1; out[di + 2] = a2; out[di + 3] = a3;
}
