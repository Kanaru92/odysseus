/**
 * Lasso tool — freehand polygon selection. Mouse-down starts a fresh
 * polygon; every move appends a point and redraws the dashed outline;
 * mouse-up keeps the selection visible (the panel's action buttons
 * read `state.lassoPoints` to act on it).
 *
 * Owns its own begin/drag/end handlers and reads/writes shared state.
 *
 * @param {{
 *   composite:                 () => void,
 *   drawLassoOverlay:          () => void,
 *   syncToolClearIndicators:   () => void,
 * }} deps
 */
import { state } from '../state.js';
import { canvasCoords } from '../canvas-coords.js';
import { polygonToMask, combineMasks, modeFromEvent } from '../selection/mask-ops.js';

// Rasterize a doc-space polygon into the ACTIVE LAYER's local mask space (every
// wandMask consumer subtracts the layer offset).
function _polyToLayerMask(pts) {
  const lyr = state.layers.find((l) => l.id === state.activeLayerId);
  const off = (lyr && state.layerOffsets.get(lyr.id)) || { x: 0, y: 0 };
  const lw = lyr ? lyr.canvas.width : state.imgWidth;
  const lh = lyr ? lyr.canvas.height : state.imgHeight;
  return polygonToMask(pts.map((p) => ({ x: p.x - off.x, y: p.y - off.y })), lw, lh);
}

export function createLassoTool({ composite, drawLassoOverlay, syncToolClearIndicators }) {
  // rAF-coalesced redraw: every pointermove appends a point (cheap, keeps the
  // freehand path complete), but the expensive full recomposite + outline
  // redraw runs at most once per frame. While a lasso is active
  // _canDirtyComposite() forces a full-document composite on every call, so an
  // un-throttled redraw per move event recomposites the whole canvas dozens of
  // times/sec on a large doc.
  let rafId = 0;

  function redraw() {
    rafId = 0;
    if (!state.lassoActive) return;
    // Live overlay: dashed white outline + translucent red fill.
    composite();
    if (state.lassoPoints.length > 1) {
      state.mainCtx.beginPath();
      state.mainCtx.moveTo(state.lassoPoints[0].x, state.lassoPoints[0].y);
      for (let i = 1; i < state.lassoPoints.length; i++) {
        state.mainCtx.lineTo(state.lassoPoints[i].x, state.lassoPoints[i].y);
      }
      state.mainCtx.closePath();
      state.mainCtx.strokeStyle = '#fff';
      state.mainCtx.lineWidth = 1 / state.zoom;
      state.mainCtx.setLineDash([4 / state.zoom, 4 / state.zoom]);
      state.mainCtx.stroke();
      state.mainCtx.setLineDash([]);
      state.mainCtx.fillStyle = 'rgba(255, 80, 80, 0.15)';
      state.mainCtx.fill();
    }
  }

  return {
    begin(e) {
      // A fresh freehand selection replaces any existing mask-based selection
      // (marquee / wand / color-range) unless a combine modifier is held — without
      // this, a lasso drawn after a marquee left BOTH selections visible (the
      // "two overlapping selections" bug).
      state.selCombineMode = modeFromEvent(e);
      if (state.selCombineMode === 'replace') { state.wandMask = null; state.wandLayerId = null; }
      else if (!state.wandMask && state.lassoPoints && state.lassoPoints.length >= 3) {
        // Combining onto an existing lasso-polygon selection — rasterize it into
        // the shared mask first so end()'s boolean op has a base to act on.
        state.wandMask = _polyToLayerMask(state.lassoPoints);
        state.wandLayerId = state.activeLayerId;
      }
      state.lassoPoints = [];
      state.lassoActive = true;
      const coords = canvasCoords(e, state.mainCanvas);
      state.lassoPoints.push(coords);
    },

    drag(e) {
      if (!state.lassoActive) return;
      e.preventDefault();
      const coords = canvasCoords(e, state.mainCanvas);
      state.lassoPoints.push(coords);
      // Coalesce the redraw to one per frame; intermediate moves still record
      // their point above, so no path detail is lost.
      if (!rafId) rafId = requestAnimationFrame(redraw);
    },

    end() {
      // Drop any pending coalesced redraw — end() repaints synchronously below.
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      state.lassoActive = false;
      if (state.lassoPoints.length < 3) {
        state.lassoPoints = [];
        composite();
        syncToolClearIndicators();
        return;
      }
      // With a combine modifier, fold this polygon into the shared mask selection
      // (boolean op) instead of leaving a separate live polygon — otherwise the
      // downstream priority chain (mask > lasso > wand) would act on the polygon
      // ALONE and ignore the existing mask, so add/subtract/intersect did nothing.
      const mode = state.selCombineMode || 'replace';
      if (mode !== 'replace') {
        const cand = _polyToLayerMask(state.lassoPoints);
        const compatible = state.wandMask && state.wandLayerId === state.activeLayerId
          && state.wandMask.width === cand.width && state.wandMask.height === cand.height;
        const base = compatible ? state.wandMask : null;
        state.wandMask = combineMasks(base, cand, base ? mode : 'replace');
        state.wandLayerId = state.activeLayerId;
        state.wandMaskVisible = true;
        state.lassoPoints = []; // now a mask
        composite();
        syncToolClearIndicators();
        return;
      }
      // Replace mode — keep the live polygon (the panel's action buttons use it).
      composite();
      drawLassoOverlay();
      syncToolClearIndicators();
    },
  };
}
