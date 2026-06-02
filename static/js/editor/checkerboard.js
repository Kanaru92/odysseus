/**
 * Transparency-checkerboard pattern painted beneath every layer pass so empty
 * (transparent) document areas read as "see-through". Configurable like a pro
 * editor's Transparency preferences: square SIZE + the two square COLORS
 * (`c1` = the light square, `c2` = the gray square). `setChecker()` updates the
 * shared config; the editor wires a small preferences UI + persistence to it.
 *
 * Adobe doesn't publish exact constants, so the presets below match the
 * familiar Light/Medium/Dark look; users can also set any custom colors + size.
 */

// Square edge in DOCUMENT pixels for the named sizes.
export const CHECKER_SIZES = { small: 4, medium: 8, large: 16 };
// Light square stays light; the "gray" square (c2) is what the presets change.
export const CHECKER_PRESETS = {
  light:    { c1: '#ffffff', c2: '#cccccc' },
  medium:   { c1: '#ffffff', c2: '#999999' },
  dark:     { c1: '#ffffff', c2: '#666666' },
  charcoal: { c1: '#3a3a3a', c2: '#4a4a4a' }, // for dark-room / dark-art work
};

export const checkerConfig = { size: CHECKER_SIZES.medium, c1: '#ffffff', c2: '#cccccc' };

export function setChecker(cfg) {
  if (!cfg) return;
  if (cfg.size != null) checkerConfig.size = Math.max(1, Math.min(256, cfg.size | 0));
  if (cfg.c1) checkerConfig.c1 = cfg.c1;
  if (cfg.c2) checkerConfig.c2 = cfg.c2;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w  Width in canvas pixels.
 * @param {number} h  Height in canvas pixels.
 */
export function drawCheckerboard(ctx, w, h) {
  const size = Math.max(1, checkerConfig.size || 8);
  ctx.fillStyle = checkerConfig.c2; // base (gray square)
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = checkerConfig.c1; // light square on alternating cells
  for (let y = 0; y < h; y += size) {
    for (let x = 0; x < w; x += size) {
      if ((Math.floor(x / size) + Math.floor(y / size)) % 2 === 0) {
        ctx.fillRect(x, y, size, size);
      }
    }
  }
}
