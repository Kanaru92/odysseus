/**
 * Polygonal Lasso — click to drop straight-edge vertices, with a live
 * rubber-band segment to the cursor between clicks. Close by clicking the
 * start vertex, double-clicking, or pressing Enter; Esc cancels.
 *
 * Reuses the freehand lasso's selection machinery: on close it leaves the
 * polygon in `state.lassoPoints` (and clears `lassoActive`), so every existing
 * lasso action — feather, grow, invert, delete, copy-to-layer, to-mask — works
 * unchanged. While placing, `state.polyLassoActive` is true and
 * `state.polyLassoPreview` holds the live cursor point for the rubber band.
 *
 * @param {{
 *   composite:               () => void,
 *   drawLassoOverlay:        () => void,
 *   syncToolClearIndicators: () => void,
 * }} deps
 */
import { state } from '../state.js';
import { canvasCoords } from '../canvas-coords.js';

export function createPolyLassoTool({ composite, drawLassoOverlay, syncToolClearIndicators }) {
  const z = () => state.zoom || 1;
  // Close when a click lands within this many IMAGE px of the start vertex.
  const closeDist = () => 8 / z();
  // Two clicks land at (very nearly) the same spot when the user double-clicks
  // to close — drop a vertex that is coincident with the previous one so the
  // polygon doesn't gain a degenerate zero-length edge.
  const coincident = (a, b) => a && b && Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;

  // The rubber-band redraw recomposites the whole document; coalesce the
  // bursty pointermove events into one repaint per animation frame so a fast
  // mouse drag between vertices doesn't queue a full recomposite per event.
  let rafId = 0;
  function scheduleRedraw() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => { rafId = 0; redraw(); });
  }
  function cancelScheduledRedraw() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  }

  function redraw() {
    composite();
    const pts = state.lassoPoints;
    if (!pts || pts.length === 0) return;
    const ctx = state.mainCtx;
    if (!ctx) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (state.polyLassoActive && state.polyLassoPreview) {
      ctx.lineTo(state.polyLassoPreview.x, state.polyLassoPreview.y);
    }
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1 / z();
    ctx.setLineDash([4 / z(), 4 / z()]);
    ctx.stroke();
    ctx.setLineDash([]);
    // Start-vertex marker so the user can aim the closing click.
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, 3 / z(), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  return {
    // pointerdown — drop a vertex, or close if it lands on the start point.
    click(e) {
      const c = canvasCoords(e, state.mainCanvas);
      if (!state.polyLassoActive) {
        state.lassoPoints = [c];
        state.polyLassoActive = true;
        state.polyLassoPreview = c;
        redraw();
        return;
      }
      const start = state.lassoPoints[0];
      const near = start && Math.hypot(c.x - start.x, c.y - start.y) <= closeDist();
      if (near && state.lassoPoints.length >= 3) { this.close(); return; }
      // Ignore a click coincident with the last vertex (e.g. the second click
      // of a double-click-to-close) so we don't push a degenerate vertex.
      const last = state.lassoPoints[state.lassoPoints.length - 1];
      if (coincident(c, last)) { redraw(); return; }
      state.lassoPoints.push(c);
      redraw();
    },

    // free pointermove (button up) — rubber-band the open edge to the cursor.
    move(e) {
      if (!state.polyLassoActive) return;
      state.polyLassoPreview = canvasCoords(e, state.mainCanvas);
      scheduleRedraw();
    },

    close() {
      cancelScheduledRedraw();
      state.polyLassoActive = false;
      state.polyLassoPreview = null;
      // Drop a trailing vertex left coincident with its predecessor (a
      // double-click close fires two click() events before this runs).
      const pts = state.lassoPoints;
      if (pts && pts.length >= 2 && coincident(pts[pts.length - 1], pts[pts.length - 2])) {
        pts.pop();
      }
      if (!state.lassoPoints || state.lassoPoints.length < 3) {
        state.lassoPoints = [];
        composite();
        syncToolClearIndicators();
        return;
      }
      composite();
      drawLassoOverlay();
      syncToolClearIndicators();
    },

    cancel() {
      cancelScheduledRedraw();
      state.polyLassoActive = false;
      state.polyLassoPreview = null;
      state.lassoPoints = [];
      composite();
      syncToolClearIndicators();
    },

    get active() { return !!state.polyLassoActive; },
  };
}
