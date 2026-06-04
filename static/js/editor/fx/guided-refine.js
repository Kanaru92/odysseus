/**
 * Edge-aware selection refinement via a guided filter (luminance guide).
 *
 * Snaps a rough selection's alpha to the image's real edges within `radius`,
 * approximating the standard Refine Edge / Select & Mask "Radius" — without the
 * heavy closed-form matting solve (a large sparse linear system). In uniform
 * regions the filter feathers the alpha; near a guide edge it pulls the alpha
 * transition onto that edge, so an over/under-shooting selection boundary snaps
 * to the visible boundary.
 *
 * Clean-room implementation of He, Sun & Tang, "Guided Image Filtering" (2010),
 * scalar (grayscale-guide) variant. All O(n) via an integral-image box mean, so
 * the radius is free. No dependencies; pure pixel math (safe to run in a worker).
 */

// O(n) box mean of a Float32 plane, window (2r+1)², edges clamped (partial
// windows divided by their true area). Uses a Float64 summed-area table.
function boxMean(src, w, h, r) {
  const W1 = w + 1;
  const sat = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    const o = (y + 1) * W1, p = y * W1;
    for (let x = 0; x < w; x++) { row += src[y * w + x]; sat[o + x + 1] = sat[p + x + 1] + row; }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = y - r < 0 ? 0 : y - r, y1 = y + r >= h ? h - 1 : y + r;
    const a = y0 * W1, c = (y1 + 1) * W1;
    for (let x = 0; x < w; x++) {
      const x0 = x - r < 0 ? 0 : x - r, x1 = x + r >= w ? w - 1 : x + r;
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      out[y * w + x] = (sat[c + x1 + 1] - sat[a + x1 + 1] - sat[c + x0] + sat[a + x0]) / area;
    }
  }
  return out;
}

/**
 * @param {Uint8ClampedArray} maskData  RGBA of the selection (alpha = membership)
 * @param {Uint8ClampedArray} guideData RGBA of the image to snap to (same w×h)
 * @param {number} w
 * @param {number} h
 * @param {number} radius   guided-filter radius in px (the "Radius" band)
 * @param {number} [eps]    regularization (smaller = sharper, edge-stickier)
 * @returns {Uint8ClampedArray} fresh RGBA (white, alpha = refined membership)
 */
export function guidedRefineSelection(maskData, guideData, w, h, radius, eps) {
  const N = w * h;
  const r = Math.max(1, radius | 0);
  const e = eps != null ? eps : 1e-4;
  const p = new Float32Array(N);  // selection alpha in [0,1]
  const I = new Float32Array(N);  // guide luminance in [0,1]
  for (let i = 0, j = 0; i < N; i++, j += 4) {
    p[i] = maskData[j + 3] / 255;
    I[i] = (0.299 * guideData[j] + 0.587 * guideData[j + 1] + 0.114 * guideData[j + 2]) / 255;
  }
  const Ip = new Float32Array(N), II = new Float32Array(N);
  for (let i = 0; i < N; i++) { Ip[i] = I[i] * p[i]; II[i] = I[i] * I[i]; }
  const meanI = boxMean(I, w, h, r);
  const meanp = boxMean(p, w, h, r);
  const corrIp = boxMean(Ip, w, h, r);
  const corrII = boxMean(II, w, h, r);
  const a = new Float32Array(N), b = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const varI = corrII[i] - meanI[i] * meanI[i];
    const covIp = corrIp[i] - meanI[i] * meanp[i];
    a[i] = covIp / (varI + e);
    b[i] = meanp[i] - a[i] * meanI[i];
  }
  const meana = boxMean(a, w, h, r);
  const meanb = boxMean(b, w, h, r);
  const out = new Uint8ClampedArray(N * 4);
  for (let i = 0, j = 0; i < N; i++, j += 4) {
    let q = meana[i] * I[i] + meanb[i];
    q = q < 0 ? 0 : q > 1 ? 1 : q;
    out[j] = out[j + 1] = out[j + 2] = 255;
    out[j + 3] = q * 255;
  }
  return out;
}
