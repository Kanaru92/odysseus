/**
 * Red Eye removal — a single-click "stamp" tool that neutralises the bright red
 * flash reflection in a subject's pupil. No drag: one click desaturates the red
 * pixels within a brush-sized radius of the click point.
 *
 * Per click: snapshot the active layer, scan a disc around the click (in layer-
 * local coords via the layer offset), and for every pixel that is strongly red
 * (R high AND clearly dominant over G and B) replace R with ~the average of G/B
 * and darken slightly, leaving alpha untouched so the pupil keeps its shape.
 *
 * `redEyeKernel` is a pure RGBA-buffer operation (no DOM) so the colour math is
 * unit-testable; the tool reads the layer once per click and writes the disc
 * rect back. Original code.
 *
 * @param {{
 *   activeLayer: () => object | null,
 *   saveState:   (label?: string) => void,
 *   composite:   () => void,
 * }} deps
 */
import { state } from '../state.js';
import { canvasCoords } from '../canvas-coords.js';

const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * Neutralise red-eye pixels IN PLACE on `data` (RGBA, w×h) within `radius` of
 * (px,py). A pixel is "red" when its red channel is high and noticeably greater
 * than both green and blue; such pixels have R pulled down to the mean of G/B
 * (with a slight darken) so the red flash reflection turns to a natural pupil
 * tone. Alpha is preserved.
 */
export function redEyeKernel(data, w, h, px, py, radius) {
  const r = radius <= 0 ? 1 : radius;
  const x0 = Math.max(0, Math.floor(px - r));
  const y0 = Math.max(0, Math.floor(py - r));
  const x1 = Math.min(w, Math.ceil(px + r));
  const y1 = Math.min(h, Math.ceil(py + r));
  const r2 = r * r;
  let changed = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = x - px, dy = y - py;
      if (dx * dx + dy * dy > r2) continue; // outside the disc
      const i = (y * w + x) * 4;
      if (data[i + 3] < 16) continue; // skip transparent pixels
      const R = data[i], G = data[i + 1], B = data[i + 2];
      // Strongly red: high red that clearly dominates green and blue.
      if (R > 60 && R > G * 1.4 && R > B * 1.4) {
        const neutral = (G + B) / 2;
        // Pull red down to the green/blue mean and darken slightly so the pupil
        // reads as a dark, desaturated reflection rather than a grey patch.
        data[i] = clamp8(neutral * 0.8);
        data[i + 1] = clamp8(G * 0.85);
        data[i + 2] = clamp8(B * 0.85);
        // alpha (data[i + 3]) left untouched
        changed++;
      }
    }
  }
  return changed;
}

export function createRedEyeTool({ activeLayer, saveState, composite }) {
  return {
    // Single-click stamp: no move/end phase. Mirrors heal/dodgeburn's begin()
    // shape but operates once per click instead of across a drag.
    begin(e) {
      const layer = activeLayer();
      if (!layer || layer.locked) return;
      const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
      const c = canvasCoords(e, state.mainCanvas);
      const lx = c.x - off.x, ly = c.y - off.y; // layer-local click point
      const ctx = layer.ctx;
      const W = layer.canvas.width, H = layer.canvas.height;
      const radius = Math.max(2, (state.brushSize || 20) / 2);
      // Bound read + write to the affected disc rect (matches the file's stated
      // intent: read once per click and write the disc rect back).
      const x0 = Math.max(0, Math.floor(lx - radius));
      const y0 = Math.max(0, Math.floor(ly - radius));
      const x1 = Math.min(W, Math.ceil(lx + radius));
      const y1 = Math.min(H, Math.ceil(ly + radius));
      const rw = x1 - x0, rh = y1 - y0;
      if (rw <= 0 || rh <= 0) return; // disc fully outside the layer
      saveState('Red Eye');
      const buf = ctx.getImageData(x0, y0, rw, rh);
      // Coords are buffer-local: shift the click point into the rect's frame.
      redEyeKernel(buf.data, rw, rh, lx - x0, ly - y0, radius);
      ctx.putImageData(buf, x0, y0);
      // Dirty-rect composite (document space); compositor falls back to a full
      // redraw on its own when unsafe (fx/mask/selection).
      composite({ x: x0 + off.x, y: y0 + off.y, w: rw, h: rh });
    },
  };
}
