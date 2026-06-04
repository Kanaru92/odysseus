// Bevel & Emboss layer style (inner bevel) — an industry-standard layer effect
// that fakes a raised, 3D-lit edge from the layer's own silhouette. There is no
// real height field, so we derive a pseudo-height from the layer's alpha: blur the
// alpha by ~size to get a soft edge ramp, take its gradient (a finite-difference
// "Sobel" of the blurred alpha) as the surface slope, build a surface normal from
// that slope, then dot it with a light direction (from angle + altitude). Where the
// surface faces the light (lit > 0) we paint the highlight; where it faces away
// (lit < 0) we paint the shadow. The result is clipped to the layer's real alpha so
// the bevel only appears over opaque pixels. Pure: no module state; the source is
// never modified; returns a NEW canvas the same size as the source containing ONLY
// the effect (pre-clipped), so the caller draws it at the right z-order/opacity.

// Parse a CSS hex colour (#rgb / #rrggbb) into [r,g,b] 0..255. Falls back to the
// supplied default rgb on anything unparseable.
function _hexToRgb(hex, fallback) {
  if (typeof hex === 'string') {
    let h = hex.trim().replace(/^#/, '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length === 6 && /^[0-9a-fA-F]{6}$/.test(h)) {
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
  }
  return fallback;
}

// Bevel & Emboss (inner bevel). `source` is the layer's resolved pixels
// (HTMLCanvasElement). Returns a NEW HTMLCanvasElement of the same size containing
// only the bevel, clipped to the source alpha.
export function bevelEmboss(source, params) {
  const p = params || {};
  const w = source.width | 0, h = source.height | 0;
  const out = document.createElement('canvas');
  out.width = Math.max(1, w); out.height = Math.max(1, h);
  if (w <= 0 || h <= 0) return out; // guard zero-size

  const size = Math.max(1, p.size == null ? 5 : p.size);
  const depth = p.depth == null ? 1 : Math.max(0, Math.min(1, p.depth));
  const angleDeg = p.angle == null ? 120 : p.angle;
  const altitudeDeg = p.altitude == null ? 30 : p.altitude;
  const opacity = p.opacity == null ? 0.75 : Math.max(0, Math.min(1, p.opacity));
  const hi = _hexToRgb(p.highlight, [255, 255, 255]);
  const sh = _hexToRgb(p.shadow, [0, 0, 0]);

  // Light direction. Canvas y grows downward, so we flip the y component so that a
  // conventional angle (measured counter-clockwise from +x) lights the expected side.
  const az = angleDeg * Math.PI / 180;
  const alt = altitudeDeg * Math.PI / 180;
  const cosAlt = Math.cos(alt);
  const lx = Math.cos(az) * cosAlt;
  const ly = -Math.sin(az) * cosAlt;
  const lz = Math.sin(alt);

  // 1) Soft edge ramp: render the alpha as a grey field and blur it by ~size. The
  // blur turns the hard alpha edge into a gradient we can read a slope from.
  const ramp = document.createElement('canvas');
  ramp.width = w; ramp.height = h;
  const rctx = ramp.getContext('2d');
  rctx.drawImage(source, 0, 0);
  // Keep only alpha, painted white, so the ramp encodes coverage (not the layer's
  // colours). source-in keeps the existing alpha while replacing rgb with white.
  rctx.globalCompositeOperation = 'source-in';
  rctx.fillStyle = '#ffffff';
  rctx.fillRect(0, 0, w, h);
  rctx.globalCompositeOperation = 'source-over';
  // Blur the coverage field. ctx.filter is the same blur primitive the sibling
  // effects use; we re-read it through a second context so the blur is baked in.
  const blurred = document.createElement('canvas');
  blurred.width = w; blurred.height = h;
  const bctx = blurred.getContext('2d');
  bctx.filter = `blur(${size}px)`;
  bctx.drawImage(ramp, 0, 0);
  bctx.filter = 'none';

  // Read the blurred coverage as a scalar height (use the alpha channel, which the
  // blur spreads smoothly even where rgb was premultiplied to 0 at the edge).
  const hData = bctx.getImageData(0, 0, w, h).data;
  const height = new Float32Array(w * h);
  for (let i = 0, j = 3; i < w * h; i++, j += 4) height[i] = hData[j] / 255;

  // 2) Per-pixel surface normal from the height gradient (finite-difference Sobel),
  // dotted with the light direction -> a lit value in roughly [-1, 1]. The gradient
  // magnitude is scaled by `depth` so the slope (and thus contrast) tracks depth.
  const overlay = document.createElement('canvas');
  overlay.width = w; overlay.height = h;
  const octx = overlay.getContext('2d');
  const img = octx.createImageData(w, h);
  const px = img.data;
  // Slope gain: stronger depth -> steeper normals. The constant keeps mid values
  // visible for typical sizes without clipping immediately.
  const gain = depth * 4;

  const at = (x, y) => height[y * w + x];
  for (let y = 0; y < h; y++) {
    const ym = y > 0 ? y - 1 : 0;
    const yp = y < h - 1 ? y + 1 : h - 1;
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x < w - 1 ? x + 1 : w - 1;
      // Sobel-ish finite differences of the blurred height.
      const dx = (at(xp, ym) + 2 * at(xp, y) + at(xp, yp)) - (at(xm, ym) + 2 * at(xm, y) + at(xm, yp));
      const dy = (at(xm, yp) + 2 * at(x, yp) + at(xp, yp)) - (at(xm, ym) + 2 * at(x, ym) + at(xp, ym));
      // Surface normal: a flat region -> (0,0,1); a slope tilts the normal toward
      // the downhill direction. Negate gradient so normals point "outward/up" the ramp.
      let nx = -dx * gain, ny = -dy * gain, nz = 1;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= inv; ny *= inv; nz *= inv;
      // Lambert-style dot with the light direction.
      let lit = nx * lx + ny * ly + nz * lz;
      // Subtract the flat-surface response so unbevelled interior stays neutral and
      // only the sloped edge band lights up.
      lit -= lz;
      lit = Math.max(-1, Math.min(1, lit * 2));

      const o = (y * w + x) * 4;
      if (lit > 0) {
        px[o] = hi[0]; px[o + 1] = hi[1]; px[o + 2] = hi[2];
        px[o + 3] = Math.round(lit * 255);
      } else if (lit < 0) {
        px[o] = sh[0]; px[o + 1] = sh[1]; px[o + 2] = sh[2];
        px[o + 3] = Math.round(-lit * 255);
      } else {
        px[o + 3] = 0;
      }
    }
  }
  octx.putImageData(img, 0, 0);

  // 3) Clip the bevel to the layer's real alpha, then composite onto the output at
  // the effect opacity. destination-in keeps the bevel only over opaque source pixels.
  octx.globalCompositeOperation = 'destination-in';
  octx.drawImage(source, 0, 0);
  octx.globalCompositeOperation = 'source-over';

  const ctx = out.getContext('2d');
  ctx.globalAlpha = opacity;
  ctx.drawImage(overlay, 0, 0);
  return out;
}
