/**
 * Shared stroke pipeline for brush / eraser / inpaint.
 *
 * Per-sample stamping happens in `_strokeTo` (still in galleryEditor.js
 * because it touches a lot of pixel-pass internals). This module owns
 * the begin / continue / end orchestration around it:
 *
 *  - begin: capture the inpaint-erase flag for the stroke, ensure a
 *           mask sub-layer exists when inpaint runs against an empty
 *           layer, push an undo entry with a tool-specific label, then
 *           kick off the first stamp.
 *  - continue: forward the new cursor position to `_strokeTo`.
 *  - end: clear the drawing flag, composite, sync any tool indicators
 *         that reflect mask state.
 *
 * Clone has its own begin (see tools/clone.js) but reuses `continue`
 * and `end` because once a clone stroke is in progress, the pipeline
 * is identical.
 *
 * @param {{
 *   saveState:               (label: string) => void,
 *   strokeTo:                (x: number, y: number) => void,
 *   composite:               () => void,
 *   getActiveMaskLayer:      () => object | null,
 *   activeParentLayer:       () => object | null,
 *   ensureActiveMaskLayer:   () => object | null,
 *   createLayer:             (name: string, w: number, h: number) => object,
 *   renderLayerPanel:        () => void,
 *   syncToolClearIndicators: () => void,
 * }} deps
 */
import { state } from '../state.js';
import { canvasCoords } from '../canvas-coords.js';

const STROKE_TOOLS = new Set(['brush', 'eraser', 'inpaint']);

function strokeLabel(tool) {
  if (tool === 'brush') return 'Brush stroke';
  if (tool === 'eraser') return 'Eraser stroke';
  if (tool === 'inpaint') return state.inpaintEraseStroke ? 'Erase mask' : 'Paint mask';
  return 'Stroke';
}

export function createStrokeTool({
  saveState, strokeTo, composite, flushComposite, bakeLayerOffset,
  getActiveMaskLayer, activeParentLayer, ensureActiveMaskLayer, createLayer,
  renderLayerPanel, syncToolClearIndicators,
}) {
  const bakeOffset = bakeLayerOffset || (() => {});
  // Render the final stroke frame synchronously on lift (flushes any rAF-coalesced
  // composite scheduled during the stroke). Falls back to composite if unwired.
  const finalComposite = flushComposite || composite;
  // Airbrush / build-up: while the brush is held, re-stamp at the current point
  // on a timer so paint keeps accumulating (the engine's flow buffer builds
  // toward the opacity cap) even when the cursor isn't moving.
  let airbrushTimer = null;
  function stopAirbrush() { if (airbrushTimer) { clearInterval(airbrushTimer); airbrushTimer = null; } }
  function startAirbrush() {
    stopAirbrush();
    if (state.tool !== 'brush' || !state.airbrush) return;
    airbrushTimer = setInterval(() => {
      if (state.drawing && state.tool === 'brush' && state.airbrush) strokeTo(state.lastX, state.lastY);
      else stopAirbrush();
    }, 40);
  }

  return {
    /**
     * Begin a stroke. Returns true if the dispatcher should consider
     * the event handled (i.e. tool is one of brush/eraser/inpaint).
     */
    tryBegin(e) {
      if (!STROKE_TOOLS.has(state.tool)) return false;
      state._engStrokeStarted = false; // new stroke → the brush engine begins exactly once (airbrush fix)
      // Shift-click straight line (brush/eraser): draw from the previous stroke's
      // end-point to the clicked point. Smoothing is bypassed so the line lands
      // exactly on the click; drawing stays on so a continued drag extends it.
      if ((state.tool === 'brush' || state.tool === 'eraser') && e && e.shiftKey && state.lineAnchor) {
        const c = canvasCoords(e, state.mainCanvas);
        saveState(strokeLabel(state.tool));
        bakeOffset(); // fold a moved layer's offset in so paint isn't clipped to its old bounds
        state.drawing = true;
        const savedSmooth = state.brushSmoothing;
        state.brushSmoothing = 0;
        state.lastX = state.lineAnchor.x;
        state.lastY = state.lineAnchor.y;
        strokeTo(state.lineAnchor.x, state.lineAnchor.y); // begin + dab at the anchor
        strokeTo(c.x, c.y);                                // straight segment to the click
        state.brushSmoothing = savedSmooth;
        state.lineAnchor = { x: state.lastX, y: state.lastY };
        return true;
      }
      // Capture the inpaint-erase flag for this stroke. Ctrl+Alt
      // pressed at pointerdown flips the persistent toggle for one
      // stroke only.
      if (state.tool === 'inpaint') {
        const flip = e && e.ctrlKey && e.altKey;
        state.inpaintEraseStroke = flip ? !state.inpaintEraseMode : state.inpaintEraseMode;
        // Make sure we're painting onto an existing mask sub-layer. If
        // there's no parent layer at all, create one first so a totally
        // empty canvas can accept an inpaint stroke.
        if (!getActiveMaskLayer()) {
          let parent = activeParentLayer();
          if (!parent) {
            parent = createLayer('Layer 1', state.imgWidth, state.imgHeight);
            state.layers.push(parent);
            state.activeLayerId = parent.id;
          }
          if (parent.masks && parent.masks.length) {
            parent.activeMaskId = parent.masks[parent.masks.length - 1].id;
            const m = getActiveMaskLayer();
            if (m) {
              state.maskCanvas = m.canvas;
              state.maskCtx = m.ctx;
              renderLayerPanel();
            }
          } else {
            const mk = ensureActiveMaskLayer();
            if (mk) {
              state.maskCanvas = mk.canvas;
              state.maskCtx = mk.ctx;
              renderLayerPanel();
            }
          }
        }
      }
      saveState(strokeLabel(state.tool));
      bakeOffset(); // fold a moved layer's offset in so paint isn't clipped to its old bounds
      state.drawing = true;
      const coords = canvasCoords(e, state.mainCanvas);
      state.lastX = coords.x;
      state.lastY = coords.y;
      strokeTo(coords.x, coords.y);
      startAirbrush();
      return true;
    },

    /**
     * Forward an in-progress stroke. Returns true if a stroke is
     * actually in progress (dispatcher should short-circuit).
     */
    tryContinue(e) {
      if (!state.drawing) return false;
      e.preventDefault();
      const coords = canvasCoords(e, state.mainCanvas);
      strokeTo(coords.x, coords.y);
      return true;
    },

    /**
     * Wrap up an in-progress stroke. Returns true if there was one.
     */
    tryEnd() {
      // Always kill the airbrush timer first: a stroke can be torn down by
      // other paths (tool switch, Escape, quick-select) that flip
      // state.drawing without routing through here, so make teardown
      // authoritative rather than relying on the drawing guard below.
      stopAirbrush();
      if (!state.drawing) return false;
      const wasDrawingInpaint = state.tool === 'inpaint';
      state.drawing = false;
      state._engStrokeStarted = false; // stroke ended → next one re-begins the engine
      // A clone stroke leaves a full-document source snapshot resident in
      // state; release it at stroke end so it doesn't pin a full-canvas
      // bitmap until the next source-pick/stroke.
      if (state.tool === 'clone') state.cloneSourceSnapshot = null;
      // Remember the stroke's end so a following Shift-click draws a straight
      // line from here (brush/eraser only).
      if (state.tool === 'brush' || state.tool === 'eraser') {
        state.lineAnchor = { x: state.lastX, y: state.lastY };
      }
      finalComposite();
      if (wasDrawingInpaint) syncToolClearIndicators();
      return true;
    },
  };
}
