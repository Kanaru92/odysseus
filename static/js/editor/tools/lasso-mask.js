/**
 * Lasso-tool pixel & path helpers.
 *
 * All functions take the lasso polygon `points` as an explicit
 * argument so they can be tested in isolation. The legacy gallery
 * editor calls them with its module-level `_lassoPoints` array.
 */

/**
 * Shift each polygon vertex along the outward normal by `grow` pixels.
 * Used by the lasso overlay (to draw the "feather" halo) and by
 * `buildLassoMask` (to bake the grown polygon into the mask).
 *
 * @param {{x: number, y: number}[]} points  Polygon vertices in draw order.
 * @param {number} grow                      Positive = expand outward, negative = contract.
 * @returns {{x: number, y: number}[]}       New array (same length, original is not mutated).
 */
export function lassoOffsetPoints(points, grow) {
  const n = points.length;
  if (n < 3 || !grow) return points;
  // Polygon winding (positive = CCW) — flip the normal so it points
  // away from the interior regardless of draw direction.
  let area = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i], q = points[(i + 1) % n];
    area += (q.x - p.x) * (q.y + p.y);
  }
  const sign = area > 0 ? 1 : -1;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = points[(i - 1 + n) % n], b = points[i], c = points[(i + 1) % n];
    const e1x = b.x - a.x, e1y = b.y - a.y;
    const e2x = c.x - b.x, e2y = c.y - b.y;
    const l1 = Math.hypot(e1x, e1y) || 1;
    const l2 = Math.hypot(e2x, e2y) || 1;
    // Perpendicular (dy, -dx); flip via `sign` for outward direction.
    const n1x = (e1y / l1) * sign, n1y = (-e1x / l1) * sign;
    const n2x = (e2y / l2) * sign, n2y = (-e2x / l2) * sign;
    const nx = (n1x + n2x) / 2;
    const ny = (n1y + n2y) / 2;
    const nl = Math.hypot(nx, ny) || 1;
    out[i] = { x: b.x + (nx / nl) * grow, y: b.y + (ny / nl) * grow };
  }
  return out;
}


/**
 * Trace the lasso polygon on the given context (move-to + line-to,
 * closed). Caller is responsible for `stroke()` / `fill()` choice.
 */
export function getLassoPath(ctx, points) {
  if (!points || points.length < 1) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
}


/**
 * Build a (optionally feathered, optionally grown) selection mask
 * from a lasso polygon.
 *
 * @param {{x: number, y: number}[]} points  Polygon vertices.
 * @param {number} w / h                     Output canvas dimensions.
 * @param {number} offX / offY               Translate the polygon by (offX, offY) before rasterising.
 * @param {number} feather                   Feather width in pixels. 0 = hard edge.
 * @param {number} grow                      Positive = dilate the polygon, negative = erode.
 * @returns {HTMLCanvasElement}              A `w × h` canvas with alpha = selection strength.
 */
export function buildLassoMask(points, w, h, offX, offY, feather, grow) {
  // Guard: an empty / degenerate polygon yields an empty mask (mirrors
  // getLassoPath's length check) so this helper is safe to call standalone.
  if (!points || points.length < 3) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  // Compute the polygon's dirty rect (translated by the offset), padded by
  // feather + |grow| so the feather falloff / grown edge stay inside it, then
  // clamped to the canvas. All per-pixel passes below are bounded to this
  // sub-rect instead of the full w×h — the rest of the canvas is untouched
  // (and stays transparent).
  const pad = Math.ceil((feather > 0 ? feather : 0) + Math.abs(grow || 0)) + 1;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const px = points[i].x - offX, py = points[i].y - offY;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  const bx0 = Math.max(0, Math.floor(minX) - pad);
  const by0 = Math.max(0, Math.floor(minY) - pad);
  const bx1 = Math.min(w, Math.ceil(maxX) + pad);
  const by1 = Math.min(h, Math.ceil(maxY) + pad);
  const bw = bx1 - bx0, bh = by1 - by0;

  // Step 1: draw hard mask
  const hard = document.createElement('canvas');
  hard.width = w; hard.height = h;
  const hCtx = hard.getContext('2d');
  // Fully off-canvas polygon: nothing to rasterise, return the empty mask.
  if (bw <= 0 || bh <= 0) return hard;
  hCtx.beginPath();
  hCtx.moveTo(points[0].x - offX, points[0].y - offY);
  for (let i = 1; i < points.length; i++) {
    hCtx.lineTo(points[i].x - offX, points[i].y - offY);
  }
  hCtx.closePath();
  hCtx.fillStyle = '#fff';
  hCtx.fill();

  // Step 1b: grow / shrink — blur the hard mask, threshold low for
  // grow and high for shrink. Same technique as the bg-remove edge
  // tuner. RGB is left alone, alpha is replaced.
  if (grow && grow !== 0) {
    const blurC = document.createElement('canvas');
    blurC.width = w; blurC.height = h;
    const bctx = blurC.getContext('2d');
    bctx.filter = `blur(${Math.abs(grow)}px)`;
    bctx.drawImage(hard, 0, 0);
    bctx.filter = 'none';
    const blurred = bctx.getImageData(bx0, by0, bw, bh).data;
    const hd = hCtx.getImageData(bx0, by0, bw, bh);
    const out = hd.data;
    const thr = grow > 0 ? 32 : 200;
    for (let i = 0; i < out.length; i += 4) {
      const a = blurred[i + 3] >= thr ? 255 : 0;
      out[i] = a; out[i + 1] = a; out[i + 2] = a; out[i + 3] = a;
    }
    hCtx.putImageData(hd, bx0, by0);
  }

  if (feather <= 0) return hard;

  // Step 2: pixel data and distance-based feather.
  // Read only the bbox sub-rect, but keep the inside/dist maps full-size and
  // indexed by `y*w+x` so the chamfer neighbour offsets (i±1, (y±1)*w+x)
  // stay valid; all loops below are bounded to the bbox.
  const hardData = hCtx.getImageData(bx0, by0, bw, bh);
  const d = hardData.data;

  // Build inside/outside map (default 0 outside the bbox).
  const inside = new Uint8Array(w * h);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const si = (by * bw + bx) * 4;
      inside[(by0 + by) * w + (bx0 + bx)] = d[si] > 128 ? 1 : 0;
    }
  }

  // Distance from edge (for pixels inside the selection, distance to nearest outside pixel).
  const dist = new Float32Array(w * h);
  dist.fill(feather + 1);

  // Seed: edge pixels (inside pixels adjacent to outside pixels).
  for (let y = by0; y < by1; y++) {
    for (let x = bx0; x < bx1; x++) {
      const i = y * w + x;
      if (!inside[i]) { dist[i] = 0; continue; }
      const hasOutside = (x > 0 && !inside[i-1]) || (x < w-1 && !inside[i+1]) ||
                         (y > 0 && !inside[(y-1)*w+x]) || (y < h-1 && !inside[(y+1)*w+x]);
      if (hasOutside) dist[i] = 1;
    }
  }

  // Two-pass chamfer distance transform (bounded to the bbox).
  for (let y = by0; y < by1; y++) {
    for (let x = bx0; x < bx1; x++) {
      const i = y * w + x;
      if (dist[i] === 0) continue;
      if (x > 0) dist[i] = Math.min(dist[i], dist[i-1] + 1);
      if (y > 0) dist[i] = Math.min(dist[i], dist[(y-1)*w+x] + 1);
    }
  }
  for (let y = by1-1; y >= by0; y--) {
    for (let x = bx1-1; x >= bx0; x--) {
      const i = y * w + x;
      if (dist[i] === 0) continue;
      if (x < w-1) dist[i] = Math.min(dist[i], dist[i+1] + 1);
      if (y < h-1) dist[i] = Math.min(dist[i], dist[(y+1)*w+x] + 1);
    }
  }

  // Pixels near the edge get reduced alpha (written only within the bbox).
  const result = document.createElement('canvas');
  result.width = w; result.height = h;
  const rCtx = result.getContext('2d');
  const rData = rCtx.createImageData(bw, bh);

  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const i = (by0 + by) * w + (bx0 + bx);
      if (!inside[i]) continue;
      const edgeDist = dist[i];
      const alpha = edgeDist >= feather ? 255 : Math.round((edgeDist / feather) * 255);
      const ri = (by * bw + bx) * 4;
      rData.data[ri] = alpha;
      rData.data[ri+1] = alpha;
      rData.data[ri+2] = alpha;
      rData.data[ri+3] = 255;
    }
  }
  rCtx.putImageData(rData, bx0, by0);
  return result;
}
