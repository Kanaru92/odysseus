/**
 * Content-aware fill — remove the selected region and fill it from the
 * surrounding pixels. This is a diffusion (heat-equation) inpaint: the selection
 * is repeatedly replaced by the average of its neighbours, so colour propagates
 * inward from the border. Seamless on smooth/gradient areas; for heavy texture a
 * PatchMatch synthesis would do better (future work), but this covers the common
 * "paint out a blemish / object on a smooth background" case with no model server.
 *
 * Pure: mutates the RGBA `data` in place where `mask` (RGBA, white=fill) is set.
 * Work is confined to the selection's bounding box so cost scales with the hole,
 * not the whole canvas.
 *
 * @returns {boolean} true if anything was filled.
 */
export function diffusionFill(data, w, h, mask, maxIter = 600) {
  const fill = new Uint8Array(w * h);
  let bx0 = w, by0 = h, bx1 = -1, by1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[(y * w + x) * 4 + 3] > 128) {
        fill[y * w + x] = 1;
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
        if (y < by0) by0 = y; if (y > by1) by1 = y;
      }
    }
  }
  if (bx1 < 0) return false;
  bx0 = Math.max(0, bx0 - 1); by0 = Math.max(0, by0 - 1);
  bx1 = Math.min(w - 1, bx1 + 1); by1 = Math.min(h - 1, by1 + 1);
  // Diffusion converges ~geometrically; scale iterations to the hole size so the
  // centre fully resolves (cheap for small holes; capped for big ones).
  const iter = Math.max(120, Math.min(maxIter, Math.max(bx1 - bx0, by1 - by0) * 8));
  const tmp = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) { tmp[i * 3] = data[i * 4]; tmp[i * 3 + 1] = data[i * 4 + 1]; tmp[i * 3 + 2] = data[i * 4 + 2]; }
  for (let it = 0; it < iter; it++) {
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) {
        const idx = y * w + x;
        if (!fill[idx]) continue;
        let r = 0, g = 0, b = 0, n = 0;
        if (x > 0) { const j = (idx - 1) * 3; r += tmp[j]; g += tmp[j + 1]; b += tmp[j + 2]; n++; }
        if (x < w - 1) { const j = (idx + 1) * 3; r += tmp[j]; g += tmp[j + 1]; b += tmp[j + 2]; n++; }
        if (y > 0) { const j = (idx - w) * 3; r += tmp[j]; g += tmp[j + 1]; b += tmp[j + 2]; n++; }
        if (y < h - 1) { const j = (idx + w) * 3; r += tmp[j]; g += tmp[j + 1]; b += tmp[j + 2]; n++; }
        if (n) { tmp[idx * 3] = r / n; tmp[idx * 3 + 1] = g / n; tmp[idx * 3 + 2] = b / n; }
      }
    }
  }
  for (let i = 0; i < w * h; i++) {
    if (!fill[i]) continue;
    data[i * 4] = tmp[i * 3]; data[i * 4 + 1] = tmp[i * 3 + 1]; data[i * 4 + 2] = tmp[i * 3 + 2]; data[i * 4 + 3] = 255;
  }
  return true;
}
