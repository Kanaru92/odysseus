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
      // Keep the selection drawn — the panel's action buttons use it.
      composite();
      drawLassoOverlay();
      syncToolClearIndicators();
    },
  };
}
