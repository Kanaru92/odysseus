/**
 * Liquify (forward-warp / push) — drag to shove pixels along the cursor motion
 * with a soft radial falloff, accumulating each move (a forward-warp
 * "push"/"warp" deform). Great for nudging forms while posing a
 * figure — complements MorphBlend. Original code.
 *
 * Core (`warpRegion`) is a pure backward-map resample on a pixel buffer, so
 * it's unit-testable with no DOM.
 */
import { state } from '../state.js';
import { canvasCoords } from '../canvas-coords.js';

/** Bilinear-sample src (w×h RGBA) at (sx,sy) into out[oi..oi+3], clamped. */
function sampleInto(data, w, h, sx, sy, out, oi) {
  if (sx < 0) sx = 0; else if (sx > w - 1) sx = w - 1;
  if (sy < 0) sy = 0; else if (sy > h - 1) sy = h - 1;
  const x0 = Math.floor(sx), y0 = Math.floor(sy);
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const fx = sx - x0, fy = sy - y0;
  const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4;
  const i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
  for (let c = 0; c < 4; c++) {
    const top = data[i00 + c] * (1 - fx) + data[i10 + c] * fx;
    const bot = data[i01 + c] * (1 - fx) + data[i11 + c] * fx;
    out[oi + c] = top * (1 - fy) + bot * fy;
  }
}

/**
 * Pure forward-warp on a region buffer. `(cx,cy)` is the brush center in
 * region-local coords; pixels within `radius` are pulled along `(dx,dy)` with a
 * smooth falloff. Backward map: each output pixel samples from where its content
 * came FROM, so the visible result moves in the drag direction. Returns a new
 * Uint8ClampedArray (w*h*4).
 */
export function warpRegion(srcData, w, h, cx, cy, dx, dy, radius, strength) {
  const out = new Uint8ClampedArray(w * h * 4);
  const r2 = radius * radius;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ddx = x - cx, ddy = y - cy;
      const dist2 = ddx * ddx + ddy * ddy;
      let sx = x, sy = y;
      if (dist2 < r2) {
        const fall = 1 - Math.sqrt(dist2) / radius;
        const f = fall * fall * strength;
        sx = x - dx * f;
        sy = y - dy * f;
      }
      sampleInto(srcData, w, h, sx, sy, out, (y * w + x) * 4);
    }
  }
  return out;
}

export function createLiquifyTool({ activeLayer, saveState, composite }) {
  function applyWarp(layer, cxImg, cyImg, dx, dy) {
    const ctx = layer.ctx;
    const W = layer.canvas.width, H = layer.canvas.height;
    const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
    const cx = cxImg - off.x, cy = cyImg - off.y; // layer-local center
    const radius = Math.max(4, state.brushSize);
    const sEl = document.getElementById('ge-liquify-strength');
    const strength = Math.max(0, Math.min(1, (parseInt(sEl && sEl.value, 10) || 50) / 100));
    const r = Math.ceil(radius) + 1;
    const x0 = Math.max(0, Math.floor(cx - r)), y0 = Math.max(0, Math.floor(cy - r));
    const x1 = Math.min(W, Math.ceil(cx + r)), y1 = Math.min(H, Math.ceil(cy + r));
    const w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0) return;
    const region = ctx.getImageData(x0, y0, w, h);
    const warped = warpRegion(region.data, w, h, cx - x0, cy - y0, dx, dy, radius, strength);
    region.data.set(warped);
    ctx.putImageData(region, x0, y0);
  }
  return {
    begin(e) {
      const layer = activeLayer();
      if (!layer || layer.locked) return;
      const c = canvasCoords(e, state.mainCanvas);
      saveState('Liquify');
      state.liquifyActive = true;
      state.liquifyLast = { x: c.x, y: c.y };
    },
    move(e) {
      if (!state.liquifyActive) return;
      const layer = activeLayer();
      if (!layer) return;
      const c = canvasCoords(e, state.mainCanvas);
      const last = state.liquifyLast || c;
      const dx = c.x - last.x, dy = c.y - last.y;
      if (dx !== 0 || dy !== 0) applyWarp(layer, c.x, c.y, dx, dy);
      state.liquifyLast = { x: c.x, y: c.y };
      composite();
    },
    end() {
      state.liquifyActive = false;
      state.liquifyLast = null;
    },
  };
}
