// Self-contained layer-style render helper: the "satin" interior-sheen effect
// (industry-standard "Blending Options" satin). Pure module — no shared state.
//
// Idea: take the layer silhouette (its alpha as a solid colour), make two copies
// offset by +/- the distance vector derived from `angle`, combine them so they
// interact along their overlap (a difference/lighten interaction), blur the
// result, then clip it to the layer's real alpha. What survives is a soft,
// folded interior sheen that follows the shape's contours. The layer's own
// pixels are never modified; we return a NEW canvas the same size as `source`
// containing ONLY the effect, pre-clipped to the layer alpha so the caller can
// draw it at the right z-order with the effect's own opacity.

// A silhouette of `src` (its alpha) flat-filled with `color`. Returns a NEW canvas.
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

// satin(source, params) -> HTMLCanvasElement
// source : HTMLCanvasElement (the layer's resolved pixels)
// params : { color, blur(px), distance(px), angle(deg), opacity, invert(bool) }
//          opacity is left to the CALLER (we bake it into the returned alpha so
//          a single value drives the whole effect); all params are optional.
export function satin(source, params) {
  const w = source && source.width || 0;
  const h = source && source.height || 0;
  const out = document.createElement('canvas');
  out.width = Math.max(1, w);
  out.height = Math.max(1, h);
  if (!w || !h) return out; // guard zero-size source

  const p = params || {};
  const color = p.color || '#000000';
  const blur = Math.max(0, p.blur == null ? 8 : p.blur);
  const distance = p.distance == null ? 11 : p.distance;
  const angle = p.angle == null ? 19 : p.angle;
  const opacity = p.opacity == null ? 0.5 : p.opacity;
  const invert = !!p.invert;

  // Offset vector from angle (screen Y points down; this matches the editor's
  // other offset effects). Two copies are placed at +v and -v.
  const rad = angle * Math.PI / 180;
  const dx = Math.cos(rad) * distance;
  const dy = Math.sin(rad) * distance;

  const sil = _silhouette(source, color);

  // Build the interaction layer: lay down one offset silhouette, then bring in
  // the opposite offset with an 'xor' interaction so the two copies survive only
  // where they DON'T overlap — i.e. a band that hugs the shape's contours. This
  // is the contour-following sheen that reads as folded satin.
  const sheen = document.createElement('canvas');
  sheen.width = out.width; sheen.height = out.height;
  const sx = sheen.getContext('2d');
  sx.drawImage(sil, dx, dy);
  sx.globalCompositeOperation = 'xor';
  sx.drawImage(sil, -dx, -dy);

  // Blur the sheen so the band softens into a gradient sweep.
  const ctx = out.getContext('2d');
  ctx.save();
  ctx.filter = `blur(${blur}px)`;
  ctx.drawImage(sheen, 0, 0);
  ctx.restore();

  // Optional invert: swap the sheen's coverage within the silhouette so the
  // bright/dark folds trade places (the "invert" toggle).
  if (invert) {
    const inv = document.createElement('canvas');
    inv.width = out.width; inv.height = out.height;
    const ix = inv.getContext('2d');
    ix.drawImage(_silhouette(source, color), 0, 0); // full solid silhouette
    ix.globalCompositeOperation = 'destination-out';
    ix.drawImage(out, 0, 0); // subtract current sheen -> inverted coverage
    ctx.save();
    ctx.globalCompositeOperation = 'copy';
    ctx.filter = 'none';
    ctx.drawImage(inv, 0, 0);
    ctx.restore();
  }

  // Clip to the layer's actual alpha so the sheen shows only over opaque pixels.
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.filter = 'none';
  ctx.drawImage(source, 0, 0);
  ctx.restore();

  // Bake the effect opacity into the returned alpha so one value drives it.
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = `rgba(0,0,0,${Math.max(0, Math.min(1, opacity))})`;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.restore();

  return out;
}
