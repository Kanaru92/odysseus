/**
 * Procedural grain textures for built-in brushes. The brush engine's grain
 * option (editor/brush/engine.js → ensureGrain) tiles a texture image and uses
 * its luminance to modulate stroke alpha — giving charcoal/chalk/dry-media
 * break-up. Imported `.brush` bundles supply a Grain.png; built-in presets have
 * none, so this generates one on demand (cached on the preset).
 *
 * @param {number} [w=128] @param {number} [h=128]
 * @returns {HTMLCanvasElement} grayscale noise canvas
 */
export function makeNoiseGrain(w = 128, h = 128) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  // Mid-biased monochrome noise — breaks the stroke up without punching full
  // holes (pure-black grain would erase too much once multiplied by depth).
  for (let i = 0; i < d.length; i += 4) {
    const v = 90 + Math.floor(Math.random() * 166);
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
