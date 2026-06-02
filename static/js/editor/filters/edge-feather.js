/**
 * Edge feather / edge delete via a two-pass chamfer distance transform.
 *
 * Operates in-place on the supplied ImageData. For each opaque pixel,
 * compute the (approximate) distance to the nearest transparent pixel
 * OR canvas edge. Pixels within `width` of that boundary either get
 * faded (`hardDelete=false`) or fully cleared (`hardDelete=true`).
 *
 * @param {ImageData} imgData
 * @param {number} width        Feather radius in pixels.
 * @param {boolean} hardDelete  If true, clear pixels inside the band
 *                              instead of fading.
 * @param {boolean} includeCanvasEdge  If true, treat the canvas border as a
 *                              boundary too (feathers/deletes a `width`-wide
 *                              frame off even fully-opaque content). Defaults
 *                              to false so full-bleed opaque layers are left
 *                              untouched.
 */
export function edgeFeather(imgData, width, hardDelete, includeCanvasEdge = false) {
  // A non-positive / NaN radius is a no-op feather; bail before any work so
  // the fade divide (edgeDist / width) can never produce Infinity or NaN.
  if (!(width > 0)) return;
  const w = imgData.width;
  const h = imgData.height;
  const d = imgData.data;
  const dist = new Float32Array(w * h);
  dist.fill(width + 1);

  // Seed: transparent pixels are at distance 0.
  for (let i = 0; i < w * h; i++) {
    if (d[i * 4 + 3] === 0) dist[i] = 0;
  }

  // Two-pass chamfer distance transform.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (dist[i] === 0) continue;
      let min = dist[i];
      if (x > 0) min = Math.min(min, dist[i - 1] + 1);
      if (y > 0) min = Math.min(min, dist[(y - 1) * w + x] + 1);
      dist[i] = min;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (dist[i] === 0) continue;
      let min = dist[i];
      if (x < w - 1) min = Math.min(min, dist[i + 1] + 1);
      if (y < h - 1) min = Math.min(min, dist[(y + 1) * w + x] + 1);
      dist[i] = min;
    }
  }

  // Optionally treat the canvas border itself as a boundary. Off by default so
  // a fully-opaque full-bleed layer keeps its rim. Only pixels within `width`
  // of an edge can ever change the Apply result (it fades only where
  // dist[i] < width), so we scan just that frame instead of the whole w*h
  // image: the top/bottom bands in full, plus the left/right bands of the
  // interior rows.
  if (includeCanvasEdge) {
    const band = Math.min(width, w, h);
    const setEdge = (x, y) => {
      const edgeDist = Math.min(x, y, w - 1 - x, h - 1 - y);
      const i = y * w + x;
      if (edgeDist < dist[i]) dist[i] = edgeDist;
    };
    for (let y = 0; y < h; y++) {
      if (y < band || y >= h - band) {
        // Full top/bottom band row.
        for (let x = 0; x < w; x++) setEdge(x, y);
      } else {
        // Interior row: only the left/right band columns are in range.
        for (let x = 0; x < band; x++) setEdge(x, y);
        for (let x = Math.max(band, w - band); x < w; x++) setEdge(x, y);
      }
    }
  }

  // Apply.
  for (let i = 0; i < w * h; i++) {
    if (d[i * 4 + 3] === 0) continue;
    const edgeDist = dist[i];
    if (edgeDist < width) {
      if (hardDelete) {
        d[i * 4 + 3] = 0;
      } else {
        const fade = edgeDist / width;
        d[i * 4 + 3] = Math.round(d[i * 4 + 3] * fade);
      }
    }
  }
}
