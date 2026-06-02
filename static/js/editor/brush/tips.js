/**
 * Brush tip generation — produces an offscreen canvas "stamp" the engine
 * draws repeatedly along a stroke. Procedural mask generators: round (hard),
 * soft (curve falloff), gaussian. The mask is
 * built in white then tinted with `source-in`, so ANY CSS color works.
 *
 * Aspect (ratio) and rotation are applied by the engine at stamp time, not
 * baked here, so a single cached tip serves every angle.
 */
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function makeTip({ type = 'round', size = 16, hardness = 1, color = '#000', image = null }) {
  const s = Math.max(1, Math.round(size));
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');

  // Imported tip (.abr / .gbr / PNG): use the image as an ALPHA MASK, tinted
  // by the brush color. If the image carries transparency, its alpha defines
  // the shape (e.g. black-on-transparent ink); otherwise luminance does
  // (.gbr convention, white = opaque).
  if (type === 'image' && image) {
    const tmp = document.createElement('canvas');
    tmp.width = s; tmp.height = s;
    const tctx = tmp.getContext('2d');
    tctx.drawImage(image, 0, 0, s, s);
    const src = tctx.getImageData(0, 0, s, s).data;
    let hasAlpha = false;
    for (let i = 3; i < src.length; i += 4) { if (src[i] < 250) { hasAlpha = true; break; } }
    const out = ctx.createImageData(s, s);
    const o = out.data;
    for (let i = 0; i < src.length; i += 4) {
      const lum = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
      o[i] = 255; o[i + 1] = 255; o[i + 2] = 255;
      o[i + 3] = hasAlpha ? src[i + 3] : lum;
    }
    ctx.putImageData(out, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, s, s);
    return c;
  }

  const r = s / 2;

  if (type === 'round' && hardness >= 0.999) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(r, r, r, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const g = ctx.createRadialGradient(r, r, 0, r, r, r);
    if (type === 'gaussian') {
      // bell-ish falloff via a few stops
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
      g.addColorStop(0.7, 'rgba(255,255,255,0.22)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
    } else {
      // soft: solid core out to `hardness`, linear fade to the rim
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(clamp01(hardness), 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }

  // Tint the alpha mask with the brush color.
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, s, s);
  return c;
}

/** Wrap an arbitrary image (predefined/PNG/GBR tip) as a stamp source. */
export function imageTip(imgOrCanvas) {
  return imgOrCanvas;
}
