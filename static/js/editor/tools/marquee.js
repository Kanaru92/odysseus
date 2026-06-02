/**
 * Marquee selection tool (rectangular / elliptical). Drag to define a region.
 *
 * Rather than build a parallel selection model, the marquee writes
 * `state.lassoPoints` (a rect = 4 corners; an ellipse = a smooth polygon), so
 * it reuses ALL the existing lasso machinery for free: the dashed overlay,
 * Delete (clear pixels), Ctrl+C/X (copy/cut), M (convert to mask), Ctrl+Alt+I
 * (invert), and the Feather / Edge-stroke refine sliders. Original code.
 */
import { state } from '../state.js';
import { canvasCoords } from '../canvas-coords.js';
import { polygonToMask, combineMasks, modeFromEvent } from '../selection/mask-ops.js';

function rectPoints(x0, y0, x1, y1) {
  const ax = Math.min(x0, x1), ay = Math.min(y0, y1);
  const bx = Math.max(x0, x1), by = Math.max(y0, y1);
  return [{ x: ax, y: ay }, { x: bx, y: ay }, { x: bx, y: by }, { x: ax, y: by }];
}

function ellipsePoints(x0, y0, x1, y1, n = 48) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry });
  }
  return pts;
}

export function createMarqueeTool({ composite, drawLassoOverlay }) {
  function currentMode() {
    const b = document.querySelector('.ge-marquee-mode.active');
    return (b && b.dataset.marqueeMode) || 'rect';
  }
  // Resolve the marquee polygon for a mode. 'row'/'col' (Single Row / Single
  // Column) ignore the drag extent and select a 1px band across the whole
  // canvas at the start point — PS parity.
  function pointsFor(mode, x0, y0, x1, y1) {
    if (mode === 'row') return rectPoints(0, y0, state.imgWidth, y0 + 1);
    if (mode === 'col') return rectPoints(x0, 0, x0 + 1, state.imgHeight);
    if (mode === 'ellipse') return ellipsePoints(x0, y0, x1, y1);
    return rectPoints(x0, y0, x1, y1);
  }
  return {
    begin(e) {
      const c = canvasCoords(e, state.mainCanvas);
      state.marqueeActive = true;
      state.marqueeStart = { x: c.x, y: c.y };
      // Shift = add, Alt = subtract, Shift+Alt = intersect, none = replace.
      state.selCombineMode = modeFromEvent(e);
      // Row/Column commit on a plain click, so seed their band immediately.
      const m = currentMode();
      state.lassoPoints = (m === 'row' || m === 'col') ? pointsFor(m, c.x, c.y, c.x, c.y) : [];
      state.lassoActive = false;
    },
    move(e) {
      if (!state.marqueeActive || !state.marqueeStart) return;
      const c = canvasCoords(e, state.mainCanvas);
      const { x: x0, y: y0 } = state.marqueeStart;
      state.lassoPoints = pointsFor(currentMode(), x0, y0, c.x, c.y);
      composite();
      if (drawLassoOverlay) drawLassoOverlay();
    },
    end() {
      state.marqueeActive = false;
      state.marqueeStart = null;
      const pts = state.lassoPoints;
      state.lassoPoints = []; // selection becomes a mask, not a live polygon
      const mode = state.selCombineMode || 'replace';
      if (!pts || pts.length < 3) {
        // Click with no real drag → deselect (replace with nothing).
        if (mode === 'replace') { state.wandMask = null; state.wandLayerId = null; }
        composite();
        return;
      }
      // Rasterize the marquee shape and combine into the shared mask-based
      // selection (state.wandMask), so it reuses the existing overlay + Delete /
      // copy / invert / deselect machinery. Shift/Alt give the boolean ops.
      const candidate = polygonToMask(pts, state.imgWidth, state.imgHeight);
      const base = (mode !== 'replace' && state.wandMask) ? state.wandMask : null;
      state.wandMask = combineMasks(base, candidate, base ? mode : 'replace');
      state.wandLayerId = state.activeLayerId;
      state.wandLastSeed = null;
      composite();
    },
  };
}
