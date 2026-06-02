/**
 * Twirl — angular swirl remap around a centre point.
 *
 * An industry-standard distortion: pixels are rotated about a centre by an
 * angle that is strongest at the centre and falls off linearly to zero at a
 * given radius. Inside the radius the image appears to spin into a vortex;
 * outside it the image is untouched.
 *
 * Implemented as a backward map (the standard hole-free resample): for every
 * OUTPUT pixel we compute how far it sits from the centre, derive the local
 * twirl angle for that distance, rotate the output position BACKWARDS by that
 * angle to find where it came from in the SOURCE, then bilinearly sample
 * there. Reading source positions (rather than scattering each source pixel
 * forward) guarantees every output pixel is filled with no gaps.
 *
 * Falloff: angle(d) = fullAngle · (1 − d / radius) for d < radius, else 0.
 * At the exact centre (d = 0) the full angle is applied; at the radius the
 * angle is 0 so the effect blends seamlessly into the surrounding image.
 *
 * Sign convention: a positive `angle` twirls counter-clockwise in image
 * space (y grows downward), negative clockwise — flipping the sign mirrors
 * the swirl direction.
 *
 * Params shape:
 *   { angle?, cx?, cy?, radius? }
 *   - angle:  twirl strength in DEGREES, signed (default 90).
 *   - cx, cy: twirl centre in normalised 0..1 image coords (default 0.5).
 *   - radius: falloff radius in PIXELS (default = half the min dimension).
 *
 * Edge handling: source samples that fall outside the image are
 * transparent-padded (out-of-bounds corners contribute RGBA 0), so the swirl
 * fades cleanly at the borders instead of stretching edge pixels. Alpha is
 * sampled and preserved like any other channel.
 *
 * Pure pixel math — no DOM, no module state. Reads from a COPY of the source
 * and writes a FRESH output buffer so the remap never reads already-written
 * pixels, and returns a NEW Uint8ClampedArray (the input is not mutated).
 */

/**
 * Resolve a raw params object to concrete twirl values, filling sensible
 * defaults and guarding degenerate inputs. Pure — handy for tests.
 *
 * @param {number} width
 * @param {number} height
 * @param {object} [params]  see module header
 * @returns {{ angleRad: number, ccx: number, ccy: number, radius: number }}
 */
export function resolveTwirlParams(width, height, params = {}) {
  const w = width | 0, h = height | 0;
  const angleDeg = Number(params.angle);
  const angleRad = (Number.isFinite(angleDeg) ? angleDeg : 90) * Math.PI / 180;

  const cx = (params.cx !== undefined && params.cx !== null && Number.isFinite(Number(params.cx)))
    ? Number(params.cx) : 0.5;
  const cy = (params.cy !== undefined && params.cy !== null && Number.isFinite(Number(params.cy)))
    ? Number(params.cy) : 0.5;
  const ccx = cx * w, ccy = cy * h;

  // Default radius = half the smaller dimension (a circle that fits the
  // image). Guard against zero / non-finite so the falloff never divides by 0.
  let radius = Number(params.radius);
  if (!Number.isFinite(radius) || radius <= 0) {
    radius = Math.min(w, h) / 2;
  }
  if (!Number.isFinite(radius) || radius <= 0) radius = 1;

  return { angleRad, ccx, ccy, radius };
}

/**
 * Apply the twirl remap to a flat RGBA buffer.
 *
 * Pure: reads from a SOURCE copy and writes a fresh result so the backward
 * map never reads partially-overwritten pixels. Returns a NEW
 * Uint8ClampedArray (length w*h*4); the input `data` is not mutated. The
 * caller wires it as `d.set(twirl(d, w, h, params))`.
 *
 * @param {Uint8ClampedArray} data   source RGBA, length width*height*4
 * @param {number} width
 * @param {number} height
 * @param {object} [params]          see module header
 * @returns {Uint8ClampedArray}      remapped RGBA
 */
export function twirl(data, width, height, params = {}) {
  const w = width | 0, h = height | 0;
  const out = new Uint8ClampedArray(w * h * 4);
  if (w <= 0 || h <= 0) return out;

  // Read from an immutable copy so the backward map is unaffected by writes.
  const src = new Uint8ClampedArray(data);

  const { angleRad, ccx, ccy, radius } = resolveTwirlParams(w, h, params);
  const invRadius = 1 / radius;

  // Work in pixel-CENTRE space (index o has centre o+0.5) so the identity
  // region outside the radius maps each pixel back onto itself exactly.
  for (let oy = 0; oy < h; oy++) {
    const py = oy + 0.5 - ccy;
    for (let ox = 0; ox < w; ox++) {
      const px = ox + 0.5 - ccx;
      const di = (oy * w + ox) * 4;

      const dist = Math.hypot(px, py);
      if (dist >= radius) {
        // Outside the falloff radius: pass the source pixel straight through.
        out[di] = src[di];
        out[di + 1] = src[di + 1];
        out[di + 2] = src[di + 2];
        out[di + 3] = src[di + 3];
        continue;
      }

      // Local twirl angle: full at the centre, 0 at the radius (linear
      // falloff). Rotate the output offset BACKWARDS to find the source.
      const a = angleRad * (1 - dist * invRadius);
      const cos = Math.cos(-a), sin = Math.sin(-a);
      const sx = ccx + (px * cos - py * sin) - 0.5;
      const sy = ccy + (px * sin + py * cos) - 0.5;

      sampleBilinearTransparent(out, di, src, w, h, sx, sy);
    }
  }
  return out;
}

/**
 * Bilinear sample of `src` at fractional (sx, sy) into out[di..di+3].
 * Any of the four corners that falls outside the image contributes RGBA 0,
 * so edges fade to transparent instead of smearing the border pixel.
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
    if (wt === 0 || px < 0 || py < 0 || px >= w || py >= h) return;
    const i = (py * w + px) * 4;
    r += src[i] * wt; g += src[i + 1] * wt;
    b += src[i + 2] * wt; a += src[i + 3] * wt;
  };
  add(x0, y0, w00); add(x1, y0, w10); add(x0, y1, w01); add(x1, y1, w11);

  out[di] = r; out[di + 1] = g; out[di + 2] = b; out[di + 3] = a;
}
