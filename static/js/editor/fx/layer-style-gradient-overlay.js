// Gradient Overlay layer style (industry-standard "Blending Options" effect): a
// linear or radial gradient painted across the layer and clipped to its alpha so
// it only shows over opaque pixels. Pure helper — no module state, the layer's own
// pixels are never modified. Returns a NEW canvas the same size as `source`
// containing ONLY the effect, pre-clipped; the caller draws it over the layer at
// the right z-order with the effect's opacity.

// `source` is an HTMLCanvasElement (the layer's resolved pixels). `params`:
//   gradType : "linear" | "radial"   (default "linear")
//   angle    : degrees, 0 = left->right, sweeps clockwise (default 0; linear only)
//   stops    : [{ pos: 0..1, color }] colour stops (default black -> white)
//   opacity  : 0..1, baked into the gradient fill (default 1; the caller may also
//              apply the effect's own opacity on top)
export function gradientOverlay(source, params) {
  const w = source && source.width | 0;
  const h = source && source.height | 0;
  const c = document.createElement('canvas');
  // Guard zero-size: return an empty same-(or 0)-size canvas the caller can draw.
  if (!w || !h) { c.width = w || 0; c.height = h || 0; return c; }
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  const p = params || {};
  const gradType = p.gradType === 'radial' ? 'radial' : 'linear';
  const angle = typeof p.angle === 'number' ? p.angle : 0;
  const opacity = p.opacity == null ? 1 : Math.max(0, Math.min(1, p.opacity));
  // Default stops: black -> white.
  let stops = Array.isArray(p.stops) && p.stops.length ? p.stops
    : [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' }];

  let grad;
  if (gradType === 'radial') {
    // From the centre outward to the farthest corner so the gradient always fills.
    const cx = w / 2, cy = h / 2;
    const r = Math.sqrt(cx * cx + cy * cy);
    grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r || 1);
  } else {
    // Project the angle onto the bounding box so the gradient spans the whole layer
    // edge-to-edge regardless of direction.
    const rad = angle * Math.PI / 180;
    const dx = Math.cos(rad), dy = Math.sin(rad);
    const cx = w / 2, cy = h / 2;
    // Half-length of the gradient axis once clamped to the box extents.
    const half = (Math.abs(dx) * w + Math.abs(dy) * h) / 2;
    grad = ctx.createLinearGradient(
      cx - dx * half, cy - dy * half,
      cx + dx * half, cy + dy * half
    );
  }

  for (const s of stops) {
    const pos = Math.max(0, Math.min(1, typeof s.pos === 'number' ? s.pos : 0));
    grad.addColorStop(pos, s.color || '#000000');
  }

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // Clip the gradient to the layer's actual pixels so it survives only over opaque
  // areas — keep only where the layer already has alpha.
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(source, 0, 0);
  ctx.restore();

  return c;
}
