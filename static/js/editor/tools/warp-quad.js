/**
 * Free-distort quad warp — map a source canvas's rectangle onto an arbitrary
 * destination quad [TL, TR, BR, BL] using bilinear interpolation + triangle
 * subdivision (canvas 2D has no native projective transform). Each grid cell is
 * split into two triangles; for each, the affine map taking the source triangle
 * to the destination triangle is applied under a clip. With enough subdivisions
 * the piecewise-affine result reads as smooth distort/perspective.
 *
 * Pure: returns a NEW canvas (outW×outH); does not touch the DOM or any state.
 * This is the math core for a future interactive Distort/Perspective transform.
 *
 * @param {HTMLCanvasElement|HTMLImageElement} src
 * @param {{x:number,y:number}[]} corners  [TL, TR, BR, BL] in output pixels
 * @param {number} outW @param {number} outH
 * @param {number} [subdiv=20] cells per axis
 * @returns {HTMLCanvasElement}
 */
export function warpQuad(src, corners, outW, outH, subdiv = 20) {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(outW));
  out.height = Math.max(1, Math.round(outH));
  const ctx = out.getContext('2d');
  const [TL, TR, BR, BL] = corners;
  const sw = src.width || src.naturalWidth;
  const sh = src.height || src.naturalHeight;
  if (!sw || !sh) return out;

  // Bilinear position on the destination quad at grid coords (u,v) ∈ [0,1]².
  const bilerp = (u, v) => ({
    x: (1 - u) * (1 - v) * TL.x + u * (1 - v) * TR.x + u * v * BR.x + (1 - u) * v * BL.x,
    y: (1 - u) * (1 - v) * TL.y + u * (1 - v) * TR.y + u * v * BR.y + (1 - u) * v * BL.y,
  });

  for (let j = 0; j < subdiv; j++) {
    for (let i = 0; i < subdiv; i++) {
      const u0 = i / subdiv, u1 = (i + 1) / subdiv, v0 = j / subdiv, v1 = (j + 1) / subdiv;
      const s00 = { x: u0 * sw, y: v0 * sh }, s10 = { x: u1 * sw, y: v0 * sh };
      const s11 = { x: u1 * sw, y: v1 * sh }, s01 = { x: u0 * sw, y: v1 * sh };
      const d00 = bilerp(u0, v0), d10 = bilerp(u1, v0), d11 = bilerp(u1, v1), d01 = bilerp(u0, v1);
      // Tiny overlap (epsilon-grown clip) hides hairline seams between cells.
      drawTri(ctx, src, s00, s10, s11, d00, d10, d11);
      drawTri(ctx, src, s00, s11, s01, d00, d11, d01);
    }
  }
  return out;
}

/**
 * Inverse of warpQuad — straighten a quad region of `src` into a rectangle.
 * `corners` [TL,TR,BR,BL] are positions IN THE SOURCE (the marked quad); the
 * output is an outW×outH rectangle sampling that quad (perspective crop /
 * de-skew). Same triangle-subdivision technique, source↔dest roles swapped.
 *
 * @param {HTMLCanvasElement|HTMLImageElement} src
 * @param {{x:number,y:number}[]} corners  [TL,TR,BR,BL] in SOURCE pixels
 * @param {number} outW @param {number} outH
 * @param {number} [subdiv=24]
 * @returns {HTMLCanvasElement}
 */
export function unwarpQuad(src, corners, outW, outH, subdiv = 24) {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(outW));
  out.height = Math.max(1, Math.round(outH));
  const ctx = out.getContext('2d');
  const [TL, TR, BR, BL] = corners;
  const ow = out.width, oh = out.height;
  // Bilinear position on the SOURCE quad at grid coords (u,v) ∈ [0,1]².
  const bilerp = (u, v) => ({
    x: (1 - u) * (1 - v) * TL.x + u * (1 - v) * TR.x + u * v * BR.x + (1 - u) * v * BL.x,
    y: (1 - u) * (1 - v) * TL.y + u * (1 - v) * TR.y + u * v * BR.y + (1 - u) * v * BL.y,
  });
  for (let j = 0; j < subdiv; j++) {
    for (let i = 0; i < subdiv; i++) {
      const u0 = i / subdiv, u1 = (i + 1) / subdiv, v0 = j / subdiv, v1 = (j + 1) / subdiv;
      const s00 = bilerp(u0, v0), s10 = bilerp(u1, v0), s11 = bilerp(u1, v1), s01 = bilerp(u0, v1);
      const d00 = { x: u0 * ow, y: v0 * oh }, d10 = { x: u1 * ow, y: v0 * oh };
      const d11 = { x: u1 * ow, y: v1 * oh }, d01 = { x: u0 * ow, y: v1 * oh };
      drawTri(ctx, src, s00, s10, s11, d00, d10, d11);
      drawTri(ctx, src, s00, s11, s01, d00, d11, d01);
    }
  }
  return out;
}

// Draw the source triangle (s0,s1,s2) into the destination triangle (d0,d1,d2)
// via the affine map that takes source→dest, clipped to the dest triangle.
function drawTri(ctx, img, s0, s1, s2, d0, d1, d2) {
  const x0 = s0.x, y0 = s0.y, x1 = s1.x, y1 = s1.y, x2 = s2.x, y2 = s2.y;
  const denom = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(denom) < 1e-9) return;
  // Reject a degenerate (collinear/zero-area) DESTINATION triangle too — a
  // straightened/folded quad can collapse a dest cell, which yields a singular
  // affine map (NaN/Infinity coefficients) and a corrupt drawImage.
  const ddenom = (d1.x - d0.x) * (d2.y - d0.y) - (d2.x - d0.x) * (d1.y - d0.y);
  if (Math.abs(ddenom) < 1e-9) return;
  // x' = a·x + b·y + e ; y' = c·x + d·y + f
  const a = ((d1.x - d0.x) * (y2 - y0) - (d2.x - d0.x) * (y1 - y0)) / denom;
  const b = ((x1 - x0) * (d2.x - d0.x) - (x2 - x0) * (d1.x - d0.x)) / denom;
  const c = ((d1.y - d0.y) * (y2 - y0) - (d2.y - d0.y) * (y1 - y0)) / denom;
  const d = ((x1 - x0) * (d2.y - d0.y) - (x2 - x0) * (d1.y - d0.y)) / denom;
  const e = d0.x - a * x0 - b * y0;
  const f = d0.y - c * x0 - d * y0;
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) ||
      !Number.isFinite(d) || !Number.isFinite(e) || !Number.isFinite(f)) return;
  // Grow the clip triangle ~0.6px outward from its centroid so neighbouring
  // cells overlap — kills the hairline anti-aliased seams between triangles.
  const gx = (d0.x + d1.x + d2.x) / 3, gy = (d0.y + d1.y + d2.y) / 3;
  const grow = (p) => { const dx = p.x - gx, dy = p.y - gy; const len = Math.hypot(dx, dy) || 1; const k = (len + 0.6) / len; return { x: gx + dx * k, y: gy + dy * k }; };
  const g0 = grow(d0), g1 = grow(d1), g2 = grow(d2);
  // Bound the blit to this triangle's source sub-rect (padded 1px to keep edge
  // samples) instead of re-rasterizing the WHOLE source under the clip — the
  // active setTransform maps source coords→dest, so src and dest rects match.
  const iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
  let bx = Math.floor(Math.min(x0, x1, x2)) - 1;
  let by = Math.floor(Math.min(y0, y1, y2)) - 1;
  let bx2 = Math.ceil(Math.max(x0, x1, x2)) + 1;
  let by2 = Math.ceil(Math.max(y0, y1, y2)) + 1;
  bx = Math.max(0, Math.min(bx, iw)); by = Math.max(0, Math.min(by, ih));
  bx2 = Math.max(0, Math.min(bx2, iw)); by2 = Math.max(0, Math.min(by2, ih));
  const bw = bx2 - bx, bh = by2 - by;
  if (bw <= 0 || bh <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(g0.x, g0.y); ctx.lineTo(g1.x, g1.y); ctx.lineTo(g2.x, g2.y); ctx.closePath();
  ctx.clip();
  ctx.setTransform(a, c, b, d, e, f); // (m11,m12,m21,m22,dx,dy)
  ctx.drawImage(img, bx, by, bw, bh, bx, by, bw, bh);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.restore();
}
