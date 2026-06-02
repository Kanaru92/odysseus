/**
 * Lens Blur — a disc (bokeh) blur, distinct from a Gaussian/box blur: every
 * source pixel spreads into a flat-edged circle, so out-of-focus highlights form
 * the characteristic round "bokeh" discs of a camera lens rather than a soft
 * Gaussian falloff. Bright source pixels (above `threshold`) get extra weight so
 * speculars bloom into visible discs (industry-standard "specular highlights").
 *
 * Pure pixel math — no DOM, no module state. Reads from the source and RETURNS a
 * fresh Uint8ClampedArray (input is never mutated), matching the displacement/blur
 * fx contract so the caller wires it as `d.set(lensBlur(d, w, h, params))`.
 *
 * @param {Uint8ClampedArray} data  RGBA source pixels (length w*h*4)
 * @param {number} w
 * @param {number} h
 * @param {{radius?:number, brightness?:number, threshold?:number}} [params]
 *   radius: disc radius in px (default 8). brightness: 0..100 bloom strength for
 *   bright pixels (default 50). threshold: luma 0..255 above which a pixel blooms
 *   (default 235).
 * @returns {Uint8ClampedArray} new transformed buffer
 */
export function lensBlur(data, w, h, params = {}) {
  const radius = Math.max(0, Math.round(params.radius != null ? params.radius : 8));
  const out = new Uint8ClampedArray(data); // copy → radius<1 is an exact identity
  if (radius < 1 || !(w > 0) || !(h > 0)) return out;

  const threshold = params.threshold != null ? params.threshold : 235;
  const bloom = (params.brightness != null ? params.brightness : 50) / 100; // extra weight for speculars

  // Precompute the disc kernel offsets once.
  const offs = [];
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= r2) { offs.push(dx, dy); }
    }
  }
  const n = offs.length;
  const src = data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let k = 0; k < n; k += 2) {
        let sx = x + offs[k];
        let sy = y + offs[k + 1];
        if (sx < 0) sx = 0; else if (sx >= w) sx = w - 1;
        if (sy < 0) sy = 0; else if (sy >= h) sy = h - 1;
        const i = (sy * w + sx) * 4;
        const lum = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
        const wt = lum >= threshold ? 1 + bloom * 4 : 1; // bright pixels bloom into discs
        r += src[i] * wt; g += src[i + 1] * wt; b += src[i + 2] * wt; a += src[i + 3] * wt;
        wsum += wt;
      }
      const o = (y * w + x) * 4;
      const inv = wsum > 0 ? 1 / wsum : 0;
      out[o] = r * inv; out[o + 1] = g * inv; out[o + 2] = b * inv; out[o + 3] = a * inv;
    }
  }
  return out;
}
