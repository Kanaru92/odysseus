/**
 * Iterative 4-connected flood fill on RGBA pixel data.
 *
 * Pure function — takes the source pixel array + seed + tolerance and
 * returns a mask canvas with white where the fill landed. The legacy
 * gallery editor's magic-wand tool delegates to this.
 *
 * @param {Uint8ClampedArray|Uint8Array} src   RGBA bytes (length = w*h*4).
 * @param {number} w                           Pixel width.
 * @param {number} h                           Pixel height.
 * @param {number} seedX                       Floored seed X.
 * @param {number} seedY                       Floored seed Y.
 * @param {number} tolerance                   Tolerance 0..100. Internally
 *                                             squared and scaled to RGB+A
 *                                             space (max = 260100 at 100,
 *                                             the true 4-channel maximum).
 * @returns {HTMLCanvasElement|null}           A `w × h` mask canvas with
 *                                             white-opaque pixels for
 *                                             visited cells, or null if
 *                                             the seed is out of bounds.
 */
export function floodFillMask(src, w, h, seedX, seedY, tolerance) {
  const v = floodFillVisited(src, w, h, seedX, seedY, tolerance);
  if (!v) return null;
  return visitedToMask(v.visited, w, h, v.minX, v.minY, v.maxX, v.maxY);
}

// Pure BFS core (NO DOM) — returns the visited grid + bounding box so it can run
// in a Web Worker on a transferred buffer; the caller builds the mask canvas via
// visitedToMask(). Returns null if the seed is out of bounds.
export function floodFillVisited(src, w, h, seedX, seedY, tolerance) {
  if (seedX < 0 || seedY < 0 || seedX >= w || seedY >= h) return null;

  const seedIdx = (seedY * w + seedX) * 4;
  const sr = src[seedIdx], sg = src[seedIdx + 1];
  const sb = src[seedIdx + 2], sa = src[seedIdx + 3];

  // 0..100 → squared RGB+A distance threshold. Max single-channel diff
  // is 255, so sqrt(4 * 255²) ≈ 510; squared cap = 260100 at tol = 100,
  // i.e. tolerance 100 selects every reachable pixel.
  const tol = Math.pow(tolerance * 5.1, 2);

  const visited = new Uint8Array(w * h);
  // Typed work queue (x then y interleaved); grown geometrically to avoid
  // the unbounded growth / GC churn of a plain Array on large fills. minX/
  // minY/maxX/maxY track the visited bounding box so the mask write below is
  // bounded to the filled region rather than the whole document.
  let stack = new Int32Array(64);
  let sp = 0;
  const push = (px, py) => {
    if (sp + 2 > stack.length) {
      const grown = new Int32Array(stack.length * 2);
      grown.set(stack);
      stack = grown;
    }
    stack[sp++] = px;
    stack[sp++] = py;
  };

  let minX = seedX, minY = seedY, maxX = seedX, maxY = seedY;
  // RGB + alpha-aware so a click on a transparent pixel selects the
  // transparent region cleanly. Visits the 4-connected neighbour at
  // (nx, ny) without allocating per-pixel arrays.
  const tryVisit = (nx, ny) => {
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
    const idx = ny * w + nx;
    if (visited[idx]) return;
    const o = idx * 4;
    const dr = src[o] - sr, dg = src[o + 1] - sg;
    const db = src[o + 2] - sb, da = src[o + 3] - sa;
    if (dr * dr + dg * dg + db * db + da * da <= tol) {
      visited[idx] = 1;
      if (nx < minX) minX = nx; else if (nx > maxX) maxX = nx;
      if (ny < minY) minY = ny; else if (ny > maxY) maxY = ny;
      push(nx, ny);
    }
  };

  push(seedX, seedY);
  visited[seedY * w + seedX] = 1;
  while (sp) {
    const y = stack[--sp];
    const x = stack[--sp];
    tryVisit(x + 1, y);
    tryVisit(x - 1, y);
    tryVisit(x, y + 1);
    tryVisit(x, y - 1);
  }

  return { visited, minX, minY, maxX, maxY };
}

// Global (non-contiguous) match: every pixel within `tolerance` of the seed
// colour, anywhere in the source — the Magic Wand's "Contiguous off" mode. Uses
// the SAME alpha-aware RGBA metric + tolerance scale as floodFillVisited so
// toggling Contiguous keeps an identical tolerance feel and still selects
// transparent regions (unlike a colour-range match that skips them). Returns a
// w×h white-where-matched mask canvas, or null if the seed is out of bounds.
export function globalMatchMask(src, w, h, seedX, seedY, tolerance) {
  if (seedX < 0 || seedY < 0 || seedX >= w || seedY >= h) return null;
  const si = (seedY * w + seedX) * 4;
  const sr = src[si], sg = src[si + 1], sb = src[si + 2], sa = src[si + 3];
  const tol = Math.pow(tolerance * 5.1, 2); // matches floodFillVisited
  const mask = document.createElement('canvas');
  mask.width = w; mask.height = h;
  const mCtx = mask.getContext('2d');
  const mData = mCtx.createImageData(w, h);
  const mView = new Uint32Array(mData.data.buffer);
  const n = w * h;
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    const dr = src[o] - sr, dg = src[o + 1] - sg, db = src[o + 2] - sb, da = src[o + 3] - sa;
    if (dr * dr + dg * dg + db * db + da * da <= tol) mView[i] = 0xFFFFFFFF;
  }
  mCtx.putImageData(mData, 0, 0);
  return mask;
}

// Build a white-opaque mask canvas (w × h) from a visited grid + its bounding box.
// White-opaque (0xAABBGGRR little-endian = 0xFFFFFFFF) is written once per visited
// pixel via a 32-bit view, bounded to the visited bbox rather than the whole doc.
export function visitedToMask(visited, w, h, minX, minY, maxX, maxY) {
  const mask = document.createElement('canvas');
  mask.width = w;
  mask.height = h;
  const mCtx = mask.getContext('2d');
  const mData = mCtx.createImageData(w, h);
  const mView = new Uint32Array(mData.data.buffer);
  if (maxX >= minX && maxY >= minY) {
    for (let yy = minY; yy <= maxY; yy++) {
      const row = yy * w;
      for (let xx = minX; xx <= maxX; xx++) {
        const i = row + xx;
        if (visited[i]) mView[i] = 0xFFFFFFFF;
      }
    }
  }
  mCtx.putImageData(mData, 0, 0);
  return mask;
}
