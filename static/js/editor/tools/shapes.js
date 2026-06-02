/**
 * Shape tool — drag on the canvas to draw a primitive (rectangle, ellipse, or
 * line) filled / stroked with the foreground colour. Original implementation
 * using the canvas 2D path API.
 *
 * Drag defines the shape's bounding box (start → end). A live preview is drawn
 * over the composite while dragging (semi-transparent fill for rect/ellipse, a
 * solid stroke for line) plus a 1px dashed outline; the final shape is committed
 * to the active layer only on release. Holding Shift constrains the shape: a
 * rectangle becomes a square, an ellipse a circle, and a line snaps to the
 * nearest 45°. When a marquee/lasso/wand selection is active the committed
 * shape is clipped to it (mirroring the gradient tool).
 */
import { state } from '../state.js';
import { canvasCoords } from '../canvas-coords.js';

// Active shape kind from the options-bar toggle; defaults to 'rect'.
function shapeKind() {
  const b = document.querySelector('.ge-shape-mode.active');
  return (b && b.dataset.shapeMode) || 'rect';
}

// Resolve the drag's effective end point, applying the Shift constraint for the
// given kind: square / circle bounding box, or a 45°-snapped line.
function constrained(kind, s, en, shift) {
  if (!shift) return { x: en.x, y: en.y };
  const dx = en.x - s.x, dy = en.y - s.y;
  if (kind === 'line') {
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return { x: en.x, y: en.y };
    const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    return { x: s.x + Math.cos(a) * len, y: s.y + Math.sin(a) * len };
  }
  // rect / ellipse → square bounding box (largest extent, sign-preserved).
  const m = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: s.x + Math.sign(dx || 1) * m, y: s.y + Math.sign(dy || 1) * m };
}

// Build a document-space selection mask (white = inside) sized to the document,
// mirroring gradient.resolveSelectionMask. Sources, in priority order:
//   1. state.wandMask (a canvas; composited at its source layer's offset)
//   2. state.lassoPoints (3+ pts in doc/canvas coords — also written by marquee)
// Returns null when there's no selection (→ fill the whole layer, as before).
function resolveSelectionMask(docW, docH) {
  if (state.wandMask && state.wandMask.width && state.wandMask.height) {
    const srcLayer = state.layers.find((l) => l.id === state.wandLayerId);
    const off = srcLayer ? (state.layerOffsets.get(srcLayer.id) || { x: 0, y: 0 }) : { x: 0, y: 0 };
    const mask = document.createElement('canvas');
    mask.width = docW; mask.height = docH;
    mask.getContext('2d').drawImage(state.wandMask, off.x, off.y);
    return mask;
  }
  if (state.lassoPoints && state.lassoPoints.length >= 3) {
    const pts = state.lassoPoints;
    const mask = document.createElement('canvas');
    mask.width = docW; mask.height = docH;
    const mctx = mask.getContext('2d');
    mctx.fillStyle = '#fff';
    mctx.beginPath();
    mctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) mctx.lineTo(pts[i].x, pts[i].y);
    mctx.closePath();
    mctx.fill();
    return mask;
  }
  return null;
}

// Trace the shape's path into `ctx`. Coords are whatever space the caller set up
// (document space for the preview, layer space for the commit).
function tracePath(ctx, kind, s, en) {
  if (kind === 'ellipse') {
    const cx = (s.x + en.x) / 2, cy = (s.y + en.y) / 2;
    const rx = Math.abs(en.x - s.x) / 2, ry = Math.abs(en.y - s.y) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(0, rx), Math.max(0, ry), 0, 0, Math.PI * 2);
  } else if (kind === 'line') {
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(en.x, en.y);
  } else {
    const ax = Math.min(s.x, en.x), ay = Math.min(s.y, en.y);
    const w = Math.abs(en.x - s.x), h = Math.abs(en.y - s.y);
    ctx.beginPath();
    ctx.rect(ax, ay, w, h);
  }
}

export function createShapeTool({ activeLayer, saveState, composite }) {
  // Repaint the composite then overlay the about-to-be-applied shape + a dashed
  // outline so the user sees the result while dragging — committed on release.
  function drawPreview(shift) {
    const ctx = state.mainCtx;
    const s = state.shapeStart, en = state.shapeEnd;
    if (!ctx || !s || !en) return;
    composite(); // repaint base, then overlay the preview in doc space
    const kind = shapeKind();
    const e2 = constrained(kind, s, en, shift);
    const fg = state.color || '#000000';
    const z = state.zoom || 1;
    ctx.save();
    if (kind === 'line') {
      ctx.strokeStyle = fg;
      ctx.lineWidth = Math.max(1, state.brushSize || 4);
      ctx.lineCap = 'round';
      tracePath(ctx, kind, s, e2);
      ctx.stroke();
    } else {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = fg;
      tracePath(ctx, kind, s, e2);
      ctx.fill();
    }
    ctx.restore();
    // Dashed outline (1px on-screen regardless of zoom).
    ctx.save();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1 / z;
    ctx.setLineDash([5 / z, 4 / z]);
    tracePath(ctx, kind, s, e2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
  return {
    begin(e) {
      const layer = activeLayer();
      if (!layer || layer.locked) return;
      const c = canvasCoords(e, state.mainCanvas);
      state.shapeActive = true;
      state.shapeStart = { x: c.x, y: c.y };
      state.shapeEnd = { x: c.x, y: c.y };
      state.shapeShift = false;
    },
    move(e) {
      if (!state.shapeActive) return;
      const c = canvasCoords(e, state.mainCanvas);
      state.shapeEnd = { x: c.x, y: c.y };
      // Persist the modifier — _endDraw() commits with NO event, so without this
      // a Shift-drag would preview a square/circle but commit the raw rectangle.
      state.shapeShift = !!e.shiftKey;
      drawPreview(state.shapeShift);
    },
    end(e) {
      if (!state.shapeActive) return;
      state.shapeActive = false;
      const layer = activeLayer();
      const s = state.shapeStart;
      const en = state.shapeEnd;
      state.shapeStart = null;
      state.shapeEnd = null;
      // No real drag (start ≈ end) → discard, just clean up the preview overlay.
      if (!layer || !s || !en || (Math.abs(en.x - s.x) < 1 && Math.abs(en.y - s.y) < 1)) {
        state.shapeShift = false;
        composite();
        return;
      }
      const kind = shapeKind();
      // Use the modifier from the last move (e may be undefined — _endDraw()
      // passes no event), falling back to a live shiftKey if one was provided.
      const shift = (e && e.shiftKey) || !!state.shapeShift;
      state.shapeShift = false;
      const e2 = constrained(kind, s, en, shift);
      const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
      const ls = { x: s.x - off.x, y: s.y - off.y };
      const le = { x: e2.x - off.x, y: e2.y - off.y };
      const ctx = layer.ctx;
      const fg = state.color || '#000000';

      // Selection mask is in document space; shift it into the layer's pixel
      // space (subtract the layer offset) so it lines up with the layer canvas.
      const W = state.mainCanvas.width, H = state.mainCanvas.height;
      const docMask = resolveSelectionMask(W, H);
      let layerMask = null;
      if (docMask) {
        layerMask = document.createElement('canvas');
        layerMask.width = layer.canvas.width; layerMask.height = layer.canvas.height;
        layerMask.getContext('2d').drawImage(docMask, -off.x, -off.y);
      }

      saveState('Shape');
      // Without a selection, draw straight onto the layer (original path). With a
      // selection, render to a scratch canvas and keep only the selected pixels
      // (destination-in) before compositing onto the layer.
      const target = layerMask
        ? Object.assign(document.createElement('canvas'), {
            width: layer.canvas.width, height: layer.canvas.height,
          }).getContext('2d')
        : ctx;
      target.save();
      target.globalCompositeOperation = 'source-over';
      if (kind === 'line') {
        target.strokeStyle = fg;
        target.lineWidth = Math.max(1, state.brushSize || 4);
        target.lineCap = 'round';
        tracePath(target, kind, ls, le);
        target.stroke();
      } else {
        target.fillStyle = fg;
        tracePath(target, kind, ls, le);
        target.fill();
      }
      target.restore();
      if (layerMask) {
        target.save();
        target.globalCompositeOperation = 'destination-in';
        target.drawImage(layerMask, 0, 0);
        target.restore();
        ctx.drawImage(target.canvas, 0, 0);
      }
      composite();
    },
  };
}
