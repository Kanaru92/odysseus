/**
 * Paint Bucket — click to flood-fill the contiguous similar-colour region under
 * the cursor with the foreground colour (tolerance-based). Reuses the shared
 * flood-fill (tools/flood-fill.js) to compute the region mask, then paints the
 * FG colour through that mask onto the active layer. Honours the layer's
 * lock-transparency. A single-click tool (no drag). Original code.
 */
import { state } from '../state.js';
import { canvasCoords } from '../canvas-coords.js';
import { floodFillMask } from './flood-fill.js';

function cloneCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

export function createBucketTool({ activeLayer, saveState, composite }) {
  return {
    fill(e) {
      const layer = activeLayer();
      if (!layer || layer.locked) return;
      const c = canvasCoords(e, state.mainCanvas);
      const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
      const w = layer.canvas.width, h = layer.canvas.height;
      const sx = Math.floor(c.x - off.x), sy = Math.floor(c.y - off.y);
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;
      const ctx = layer.ctx;
      const img = ctx.getImageData(0, 0, w, h);
      const raw = parseInt((document.getElementById('ge-bucket-tolerance') || {}).value, 10);
      const tol = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 30;
      const mask = floodFillMask(img.data, w, h, sx, sy, tol);
      if (!mask) return;
      saveState('Fill');
      const snap = layer.lockAlpha ? cloneCanvas(layer.canvas) : null;
      // FG colour confined to the flood region.
      const tmp = document.createElement('canvas');
      tmp.width = w; tmp.height = h;
      const tctx = tmp.getContext('2d');
      tctx.fillStyle = state.color;
      tctx.fillRect(0, 0, w, h);
      tctx.globalCompositeOperation = 'destination-in';
      tctx.drawImage(mask, 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.drawImage(tmp, 0, 0);
      if (snap) { ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(snap, 0, 0); }
      ctx.restore();
      composite();
    },
  };
}
