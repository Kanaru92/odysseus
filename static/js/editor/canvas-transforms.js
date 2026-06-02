/**
 * Whole-document transforms: rotate by 90/180/270° or flip horizontal/
 * vertical. These mutate every layer's canvas + the offset map + the
 * document's overall width/height so the result feels like the whole
 * image rotated as one piece.
 *
 * Pure-ish — reads/writes shared state directly; the factory takes a
 * small dep bag for the orchestration plumbing (undo snapshot, canvas
 * loading overlay, fit-zoom-to-viewport, composite redraw).
 *
 * @param {{
 *   saveState:           (label?: string) => void,
 *   composite:           () => void,
 *   fitZoom:             () => void,
 *   showCanvasLoading:   (label: string) => void,
 *   hideCanvasLoading:   () => void,
 * }} deps
 */
import { state } from './state.js';

export function createCanvasTransforms({ saveState, composite, fitZoom, showCanvasLoading, hideCanvasLoading }) {
  // Rotate a document-sized source canvas into a new (newW×newH) canvas by
  // `rad`, mirroring the per-layer rotation math but pivoted on the whole
  // document. Returns a fresh canvas; null if there's nothing to copy.
  function rotateDocCanvas(src, oldW, oldH, newW, newH, rad) {
    if (!src) return null;
    const out = document.createElement('canvas');
    out.width = newW;
    out.height = newH;
    const octx = out.getContext('2d');
    octx.translate(newW / 2, newH / 2);
    octx.rotate(rad);
    octx.drawImage(src, -oldW / 2, -oldH / 2);
    return out;
  }

  // Mirror a document-sized source canvas in place (same dimensions).
  function flipDocCanvas(src, axis) {
    if (!src) return null;
    const w = src.width, h = src.height;
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const octx = out.getContext('2d');
    if (axis === 'h') { octx.translate(w, 0); octx.scale(-1, 1); }
    else              { octx.translate(0, h); octx.scale(1, -1); }
    octx.drawImage(src, 0, 0);
    return out;
  }

  return {
    /**
     * Rotate the entire document by `deg` (90 / 180 / 270). 90 and 270
     * swap canvas dimensions. Each layer is rotated around its own
     * centre, then its centre is rotated around the old image centre
     * and translated into the new image's frame.
     *
     * Wrapped in requestAnimationFrame because the rotation pass can
     * block the UI for 0.5–2 s on big images — the spinner overlay
     * paints before we block.
     */
    rotateAll(deg) {
      if (!state.layers.length) return;
      saveState(`Rotate ${deg}°`);
      showCanvasLoading('Rotating…');
      const oldW = state.imgWidth, oldH = state.imgHeight;
      const swap = (deg === 90 || deg === 270);
      const newW = swap ? oldH : oldW;
      const newH = swap ? oldW : oldH;
      const rad = (deg * Math.PI) / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      requestAnimationFrame(() => {
        try {
          for (const layer of state.layers) {
            const lw = layer.canvas.width, lh = layer.canvas.height;
            const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
            // Layer centre in old image coords.
            const cx = off.x + lw / 2;
            const cy = off.y + lh / 2;
            // Rotate the centre around the old image centre and
            // translate so the new image centre lands at (newW/2, newH/2).
            const dx = cx - oldW / 2;
            const dy = cy - oldH / 2;
            const nx = dx * cos - dy * sin + newW / 2;
            const ny = dx * sin + dy * cos + newH / 2;
            // New per-layer dims: swap when 90/270.
            const newLw = swap ? lh : lw;
            const newLh = swap ? lw : lh;
            const tmp = document.createElement('canvas');
            tmp.width = newLw; tmp.height = newLh;
            const tctx = tmp.getContext('2d');
            tctx.translate(newLw / 2, newLh / 2);
            tctx.rotate(rad);
            tctx.drawImage(layer.canvas, -lw / 2, -lh / 2);
            layer.canvas.width = newLw;
            layer.canvas.height = newLh;
            layer.ctx.drawImage(tmp, 0, 0);
            // Rotate the per-layer raster mask in lockstep with the pixels.
            // layerMask is layer-sized and drawn scaled over the layer, so it
            // must follow the same dim-swap + rotation (transform-session.js
            // does the equivalent for the interactive transform tool).
            if (layer.layerMask) {
              const mlw = layer.layerMask.width, mlh = layer.layerMask.height;
              const mtmp = document.createElement('canvas');
              mtmp.width = swap ? mlh : mlw;
              mtmp.height = swap ? mlw : mlh;
              const mctx = mtmp.getContext('2d');
              mctx.translate(mtmp.width / 2, mtmp.height / 2);
              mctx.rotate(rad);
              mctx.drawImage(layer.layerMask, -mlw / 2, -mlh / 2);
              layer.layerMask = mtmp;
            }
            // Mask sub-layers (layer.masks) are document-sized; rotate each by
            // the document-level transform and re-fetch its cached ctx.
            if (Array.isArray(layer.masks) && layer.masks.length) {
              for (const mk of layer.masks) {
                if (!mk.canvas) continue;
                mk.canvas = rotateDocCanvas(mk.canvas, oldW, oldH, newW, newH, rad);
                mk.ctx = mk.canvas.getContext('2d');
              }
            }
            // The adjustment-render caches are keyed only by the adjustment
            // signature, which rotation doesn't change — so composite would draw
            // the STALE pre-rotation cache (the "had to click twice" bug). Drop
            // them so the next composite re-renders from the rotated canvas.
            layer._adjCacheKey = null;
            layer._adjFinalKey = null;
            state.layerOffsets.set(layer.id, {
              x: Math.round(nx - newLw / 2),
              y: Math.round(ny - newLh / 2),
            });
          }
          state.imgWidth = newW;
          state.imgHeight = newH;
          state.mainCanvas.width = newW;
          state.mainCanvas.height = newH;
          if (state.maskCanvas) {
            // Resizing the canvas clears it, so the selection/inpaint mask
            // must be re-rotated rather than silently wiped. Snapshot, resize,
            // then redraw through the same rotation, and re-fetch maskCtx
            // (the old context is invalidated by the resize).
            const maskSnap = rotateDocCanvas(state.maskCanvas, oldW, oldH, newW, newH, rad);
            state.maskCanvas.width = newW;
            state.maskCanvas.height = newH;
            state.maskCtx = state.maskCanvas.getContext('2d');
            if (maskSnap) state.maskCtx.drawImage(maskSnap, 0, 0);
          }
          const sizeLabel = document.getElementById('ge-canvas-size');
          if (sizeLabel) sizeLabel.textContent = `${newW}×${newH}`;
          fitZoom();
          composite();
        } finally {
          hideCanvasLoading();
        }
      });
    },

    /**
     * Mirror every layer horizontally ('h') or vertically ('v').
     * Canvas dimensions don't change. Each layer offset is reflected
     * around the image centre.
     */
    flipAll(axis) {
      if (!state.layers.length) return;
      saveState(axis === 'h' ? 'Flip horizontal' : 'Flip vertical');
      for (const layer of state.layers) {
        const lw = layer.canvas.width, lh = layer.canvas.height;
        const tmp = document.createElement('canvas');
        tmp.width = lw; tmp.height = lh;
        const tctx = tmp.getContext('2d');
        tctx.save();
        if (axis === 'h') { tctx.translate(lw, 0); tctx.scale(-1, 1); }
        else              { tctx.translate(0, lh); tctx.scale(1, -1); }
        tctx.drawImage(layer.canvas, 0, 0);
        tctx.restore();
        layer.ctx.clearRect(0, 0, lw, lh);
        layer.ctx.drawImage(tmp, 0, 0);
        // Mirror the per-layer raster mask the same way as the pixels so the
        // revealed/hidden regions stay aligned after a flip.
        if (layer.layerMask) {
          layer.layerMask = flipDocCanvas(layer.layerMask, axis);
        }
        // Mask sub-layers are document-sized; mirror each and refresh its ctx.
        if (Array.isArray(layer.masks) && layer.masks.length) {
          for (const mk of layer.masks) {
            if (!mk.canvas) continue;
            mk.canvas = flipDocCanvas(mk.canvas, axis);
            mk.ctx = mk.canvas.getContext('2d');
          }
        }
        // Invalidate the adjustment-render caches (keyed by adjustment sig only)
        // so composite redraws from the flipped canvas, not a stale cache.
        layer._adjCacheKey = null;
        layer._adjFinalKey = null;
        const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
        if (axis === 'h') {
          state.layerOffsets.set(layer.id, { x: state.imgWidth - off.x - lw, y: off.y });
        } else {
          state.layerOffsets.set(layer.id, { x: off.x, y: state.imgHeight - off.y - lh });
        }
      }
      // Mirror the selection/inpaint mask so it stays aligned with the flipped
      // image (dimensions are unchanged for a flip).
      if (state.maskCanvas) {
        const maskSnap = flipDocCanvas(state.maskCanvas, axis);
        if (maskSnap) {
          state.maskCtx = state.maskCanvas.getContext('2d');
          state.maskCtx.clearRect(0, 0, state.maskCanvas.width, state.maskCanvas.height);
          state.maskCtx.drawImage(maskSnap, 0, 0);
        }
      }
      composite();
    },
  };
}
