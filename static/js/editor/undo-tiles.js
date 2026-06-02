/**
 * Tile-based copy-on-write history storage — the model Photoshop uses for its
 * undo/History: the image is divided into a grid of fixed tiles, and each
 * history state stores ONLY the tiles whose pixels changed since the previous
 * state. Unchanged tiles are shared by reference between states (copy-on-write),
 * so a localized edit (a brush dab, a small fill) costs a few tiles instead of
 * a full-image copy per undo step.
 *
 * Correctness is by construction: a tile is shared ONLY when its bytes are
 * EXACTLY equal to the previous state's same-position tile (full memcmp — no
 * hashing, no dirty-region guesses), and tiles are immutable after capture
 * (getImageData returns fresh buffers; we only ever read them back via
 * putImageData). So reassembling a tiled state yields pixels identical to a
 * full-frame snapshot — undo stays flawless, just lighter.
 *
 * A tiled entry: { w, h, cols, rows, tiles: Tile[] }, row-major.
 * A Tile:        { x, y, tw, th, data: Uint8ClampedArray }  (length === tw*th*4)
 */

export const TILE = 128;

function bytesEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Split `imageData` into tiles, reusing (by reference) any tile from `prev`
 * (the same surface's previously-captured entry) whose bytes are identical.
 * @param {ImageData} imageData
 * @param {object|null} prev  prior tiled entry for this surface, or null
 * @returns {object} tiled entry
 */
export function tileize(imageData, prev) {
  const w = imageData.width, h = imageData.height;
  const src = imageData.data;
  const cols = Math.ceil(w / TILE), rows = Math.ceil(h / TILE);
  // Only reuse when the grid matches (same canvas dimensions).
  const reuse = (prev && prev.w === w && prev.h === h && prev.tiles) ? prev.tiles : null;
  const tiles = new Array(cols * rows);
  for (let ry = 0, ti = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++, ti++) {
      const x = rx * TILE, y = ry * TILE;
      const tw = Math.min(TILE, w - x), th = Math.min(TILE, h - y);
      const buf = new Uint8ClampedArray(tw * th * 4);
      const rowBytes = tw * 4;
      for (let row = 0; row < th; row++) {
        const s0 = ((y + row) * w + x) * 4;
        buf.set(src.subarray(s0, s0 + rowBytes), row * rowBytes);
      }
      const pt = reuse ? reuse[ti] : null;
      if (pt && pt.tw === tw && pt.th === th && bytesEqual(pt.data, buf)) {
        tiles[ti] = pt;                 // identical → share the existing tile
      } else {
        tiles[ti] = { x, y, tw, th, data: buf };
      }
    }
  }
  return { w, h, cols, rows, tiles };
}

/**
 * Paint a tiled entry back onto a 2D context. Tiles tile the whole surface, so
 * every pixel is overwritten (putImageData replaces, including alpha) — no clear
 * needed. The destination canvas must already be sized to entry.w × entry.h.
 * @returns {boolean} true if anything was painted
 */
export function detileTo(ctx, entry) {
  if (!entry || !entry.tiles) return false;
  for (const t of entry.tiles) {
    if (!t || !t.data) continue;
    ctx.putImageData(new ImageData(t.data, t.tw, t.th), t.x, t.y);
  }
  return true;
}

/**
 * Approximate retained bytes of one or more entries, counting each SHARED tile
 * once (by object identity). Pass a persistent `seen` Set across entries to get
 * the true retained footprint of a whole history stack. Diagnostics only.
 */
export function entryBytes(entry, seen) {
  if (!entry || !entry.tiles) return 0;
  let n = 0;
  for (const t of entry.tiles) {
    if (!t || !t.data) continue;
    if (seen) { if (seen.has(t)) continue; seen.add(t); }
    n += t.data.byteLength;
  }
  return n;
}
