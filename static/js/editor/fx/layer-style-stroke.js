// Layer-style "stroke" effect — an industry-standard outline drawn relative to a
// layer's silhouette (the alpha of its resolved pixels). Position controls where
// the outline sits about the edge: OUTSIDE (ring beyond the edge), INSIDE (ring
// just within the edge), or CENTER (straddling the edge, half in / half out).
//
// Self-contained: no module state. Every helper builds its own offscreen canvas,
// uses the 2D context + globalCompositeOperation + ctx.filter, and RETURNS a new
// canvas — the passed-in source pixels are never modified. The result is a NEW
// HTMLCanvasElement the same size as `source` holding ONLY the effect, pre-clipped
// so the caller can draw it at the right z-order with the effect's own opacity.

// A silhouette of `src` (its alpha) flat-filled with `color`.
function _silhouette(src, color) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const x = c.getContext('2d');
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

// Grow `sil`'s shape outward by `radius` px by stamping it around concentric
// angular rings. Returns a NEW canvas the same size containing the dilated,
// `color`-filled shape (slightly larger silhouette).
function _dilate(sil, radius, color) {
  const c = document.createElement('canvas');
  c.width = sil.width; c.height = sil.height;
  const x = c.getContext('2d');
  const steps = Math.max(8, Math.round(radius * 4));
  // include r=0 so the interior stays solid, then expand outward
  x.drawImage(sil, 0, 0);
  for (let r = 1; r <= radius; r++) {
    for (let a = 0; a < steps; a++) {
      const t = (a / steps) * Math.PI * 2;
      x.drawImage(sil, Math.cos(t) * r, Math.sin(t) * r);
    }
  }
  // re-tint to a flat `color` (the overlapping stamps are already opaque)
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

// Shrink `src`'s shape inward by `radius` px and return its silhouette, flat-
// filled with `color` (morphological erosion). Start from the solid colour
// silhouette, then keep ONLY pixels also covered by the source at every ring
// offset (an intersection via destination-in) — a pixel survives iff the shape
// surrounds it within `radius`, i.e. the eroded interior.
function _erode(src, radius, color) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const x = c.getContext('2d');
  x.drawImage(_silhouette(src, color), 0, 0);
  x.globalCompositeOperation = 'destination-in';
  const steps = Math.max(8, Math.round(radius * 4));
  for (let r = 1; r <= radius; r++) {
    for (let a = 0; a < steps; a++) {
      const t = (a / steps) * Math.PI * 2;
      x.drawImage(src, Math.cos(t) * r, Math.sin(t) * r); // intersect with the offset shape
    }
  }
  return c;
}

// industry-standard layer stroke (outline). `source` is an HTMLCanvasElement of
// the layer's resolved pixels. `params`: {size(px), color, position, opacity}.
// Returns a NEW canvas the same size as `source` containing ONLY the outline,
// pre-clipped per position so the caller can draw it directly.
export function strokeStyle(source, params) {
  const p = params || {};
  const size = Math.max(1, Math.round(p.size == null ? 3 : p.size));
  const color = p.color || '#000000';
  const position = p.position || 'outside';
  const opacity = p.opacity == null ? 1 : p.opacity;

  const w = (source && source.width) | 0;
  const h = (source && source.height) | 0;
  const out = document.createElement('canvas');
  out.width = Math.max(1, w); out.height = Math.max(1, h);
  if (!w || !h) return out; // guard zero-size source
  const ctx = out.getContext('2d');

  const sil = _silhouette(source, color);

  if (position === 'inside') {
    // Ring just INSIDE the edge: silhouette minus an eroded silhouette, then
    // clip to the layer's real alpha so it shows only over opaque pixels.
    ctx.drawImage(sil, 0, 0);
    const inner = _erode(source, size, color);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(inner, 0, 0); // knock out the interior → leaves the inset band
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(source, 0, 0); // re-clip to the layer's actual pixels
  } else if (position === 'center') {
    // Straddle the edge: dilate by half outward and erode by half inward, then
    // subtract the eroded core so a band of `size` px centred on the edge remains.
    const half = Math.max(1, Math.round(size / 2));
    const grown = _dilate(sil, half, color);
    const core = _erode(source, half, color);
    ctx.drawImage(grown, 0, 0);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(core, 0, 0); // remove the shrunken interior → centred band
  } else {
    // OUTSIDE: dilate the silhouette by `size`, then knock out the original shape
    // so the ring lives entirely beyond the layer edge (never over its interior).
    const grown = _dilate(sil, size, color);
    ctx.drawImage(grown, 0, 0);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(source, 0, 0); // keep only the ring outside the original alpha
  }

  // Bake the effect's own opacity into the alpha so the caller can draw the
  // returned canvas straight at z-order without re-applying globalAlpha.
  if (opacity < 1) {
    const op = document.createElement('canvas');
    op.width = out.width; op.height = out.height;
    const ox = op.getContext('2d');
    ox.globalAlpha = Math.max(0, Math.min(1, opacity));
    ox.drawImage(out, 0, 0);
    return op;
  }
  return out;
}

export default strokeStyle;
