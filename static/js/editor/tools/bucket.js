/**
 * Paint Bucket — click to flood-fill the contiguous similar-colour region under
 * the cursor with the foreground colour (tolerance-based). Reuses the shared
 * flood-fill to compute the region mask, then paints the FG colour through that
 * mask onto the active layer. Honours the layer's lock-transparency. A single-
 * click tool (no drag). Original code.
 *
 * The flood runs OFF the main thread (filter-worker-client → Web Worker, with a
 * synchronous fallback) so a large/high-res fill doesn't freeze the UI; a
 * generation guard drops a stale fill if the user clicks again, and the result
 * is re-validated against the active layer before painting.
 */
import { state } from '../state.js';
import { canvasCoords } from '../canvas-coords.js';
import { runFloodAsync } from '../filter-worker-client.js';

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
      const img = layer.ctx.getImageData(0, 0, w, h);
      const raw = parseInt((document.getElementById('ge-bucket-tolerance') || {}).value, 10);
      const tol = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 30;
      // Off-thread flood; capture the FG colour + layer id at click time so a
      // later colour/layer change can't corrupt this fill.
      const gen = (state._bucketFloodGen = (state._bucketFloodGen || 0) + 1);
      const targetId = layer.id, color = state.color;
      runFloodAsync(img.data, w, h, sx, sy, tol).then((mask) => {
        if (gen !== state._bucketFloodGen || !mask) return; // superseded / no region
        const lyr = activeLayer();
        // Re-validate: same active layer, still unlocked, same dimensions.
        if (!lyr || lyr.id !== targetId || lyr.locked
          || lyr.canvas.width !== w || lyr.canvas.height !== h) return;
        const ctx = lyr.ctx;
        saveState('Fill');
        const snap = lyr.lockAlpha ? cloneCanvas(lyr.canvas) : null;
        // FG colour confined to the flood region.
        const tmp = document.createElement('canvas');
        tmp.width = w; tmp.height = h;
        const tctx = tmp.getContext('2d');
        tctx.fillStyle = color;
        tctx.fillRect(0, 0, w, h);
        tctx.globalCompositeOperation = 'destination-in';
        tctx.drawImage(mask, 0, 0);
        // Confine the fill to the active selection too (marquee/lasso/wand), like
        // the gradient + shape tools do — the standard clips bucket fill to the selection.
        let selCv = null;
        if (state.wandMask && state.wandMask.width) {
          selCv = document.createElement('canvas'); selCv.width = w; selCv.height = h;
          const selOff = state.layerOffsets.get(state.wandLayerId) || { x: 0, y: 0 };
          selCv.getContext('2d').drawImage(state.wandMask, selOff.x - off.x, selOff.y - off.y);
        } else if (state.lassoPoints && state.lassoPoints.length >= 3) {
          selCv = document.createElement('canvas'); selCv.width = w; selCv.height = h;
          const mx = selCv.getContext('2d'); mx.fillStyle = '#fff'; mx.beginPath();
          const pts = state.lassoPoints; mx.moveTo(pts[0].x - off.x, pts[0].y - off.y);
          for (let i = 1; i < pts.length; i++) mx.lineTo(pts[i].x - off.x, pts[i].y - off.y);
          mx.closePath(); mx.fill();
        }
        if (selCv) { tctx.globalCompositeOperation = 'destination-in'; tctx.drawImage(selCv, 0, 0); tctx.globalCompositeOperation = 'source-over'; }
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.drawImage(tmp, 0, 0);
        if (snap) { ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(snap, 0, 0); }
        ctx.restore();
        composite();
      });
    },
  };
}
