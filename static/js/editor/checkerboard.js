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

// Cached 2×2-cell pattern tile. Re-painting the checkerboard with a per-square
// nested fillRect loop is O(canvas-area / size²) calls EVERY composite — tens of
// thousands of fillRects per frame on a large canvas, and the dirty-rect clip
// doesn't help (the loop still iterates the whole canvas). A repeating
// CanvasPattern collapses it to a single clipped fillRect. The tile is rebuilt
// only when size/colors change; createPattern() is cheap (references the tile,
// no pixel copy) so we make it per-ctx-call to stay valid across contexts.
let _tile = null, _tileKey = '';
function _checkerTile() {
  const size = Math.max(1, checkerConfig.size || 8);
  const key = size + '|' + checkerConfig.c1 + '|' + checkerConfig.c2;
  if (_tile && _tileKey === key) return _tile;
  const t = document.createElement('canvas');
  t.width = size * 2; t.height = size * 2;
  const tc = t.getContext('2d');
  tc.fillStyle = checkerConfig.c2; tc.fillRect(0, 0, size * 2, size * 2);
  tc.fillStyle = checkerConfig.c1; tc.fillRect(0, 0, size, size); tc.fillRect(size, size, size, size);
  _tile = t; _tileKey = key;
  return t;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w  Width in canvas pixels.
 * @param {number} h  Height in canvas pixels.
 */
export function drawCheckerboard(ctx, w, h) {
  const prev = ctx.fillStyle;
  const pat = ctx.createPattern(_checkerTile(), 'repeat');
  if (pat) { ctx.fillStyle = pat; ctx.fillRect(0, 0, w, h); ctx.fillStyle = prev; return; }
  // Fallback (createPattern unavailable): solid base so we never error.
  ctx.fillStyle = checkerConfig.c2; ctx.fillRect(0, 0, w, h); ctx.fillStyle = prev;
}
