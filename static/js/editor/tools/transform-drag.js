/**
 * Transform-drag tool — handle drag interactions for the Transform
 * tool (resize via corner/edge handles, rotation via the rot grip).
 *
 * The transform UI runs in TWO modes: the floating popup (W/H/rot
 * numeric inputs, lives elsewhere) AND direct drag on the canvas
 * handles. Both ultimately mutate `state.transformPendingW/H/Rot` and
 * call `reapplyTransform()` to redraw. This module owns the drag
 * branch.
 *
 * The dispatcher in galleryEditor.js calls `tryBegin/tryContinue/
 * tryEnd` which return `true` when the event was for the transform
 * tool and was handled (so the dispatcher can short-circuit).
 *
 * @param {{
 *   beginMove:             (e: Event) => void,
 *   composite:              () => void,
 *   drawTransformHandles:   () => void,
 *   reapplyTransform:       () => void,
 *   getTransformHandle:     (x: number, y: number) => string | null,
 *   cursorForHandle:        (id: string | null) => string,
 * }} deps
 */
import { state } from '../state.js';
import { canvasCoords } from '../canvas-coords.js';

export function createTransformDragTool({
  beginMove, composite, drawTransformHandles, reapplyTransform,
  getTransformHandle, cursorForHandle,
}) {
  return {
    /**
     * Called on pointerdown. Returns true if the transform tool handled
     * the event (the dispatcher should NOT fall through to other tools).
     */
    tryBegin(e) {
      if (!state.transformActive) return false;
      const coords = canvasCoords(e, state.mainCanvas);
      state.transformHandle = getTransformHandle(coords.x, coords.y);
      if (state.transformHandle) {
        state.transformStartX = coords.x;
        state.transformStartY = coords.y;
        // Snapshot offset + size at drag-start so each frame computes
        // "start + dx" (correct delta) rather than accumulating off the
        // running offset, which was making top/left grabs drift.
        const layer = state.transformLayer;
        if (!layer) { state.transformHandle = null; return false; }
        const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
        state.transformStartOffX = off.x;
        state.transformStartOffY = off.y;
        // Seed the resize from the LOGICAL (unrotated) source size, not the
        // layer canvas — layer.canvas.{width,height} is the ROTATED bounding
        // box (reapplyTransform sizes it to finalW/finalH), whereas the resize
        // delta and transformPendingW/H are expressed in logical space. Using
        // the bbox here double-counts the rotation and makes resize jump on a
        // rotated layer. For a layer with no rotation the two are identical.
        state.transformOrigW = state.transformPendingW || layer.canvas.width;
        state.transformOrigH = state.transformPendingH || layer.canvas.height;
        // Visual centre at drag-start (rotation pivots about the layer centre,
        // which is the centre of the rotated bbox). Needed to anchor the
        // opposite edge correctly when a rotation is active.
        state.transformStartCenterX = off.x + layer.canvas.width / 2;
        state.transformStartCenterY = off.y + layer.canvas.height / 2;
        return true;
      }
      // No corner hit — if click inside the layer's bounding box, act
      // like Move so the user can drag the layer around without
      // switching tools.
      if (state.transformLayer) {
        const off = state.layerOffsets.get(state.transformLayer.id) || { x: 0, y: 0 };
        const w = state.transformLayer.canvas.width;
        const h = state.transformLayer.canvas.height;
        if (coords.x >= off.x && coords.x <= off.x + w &&
            coords.y >= off.y && coords.y <= off.y + h) {
          beginMove(e);
          return true;
        }
      }
      return false;
    },

    /**
     * Called on pointermove. Returns true if handled.
     *
     * When transformActive but no handle is grabbed, updates the
     * hover cursor + pulse. When a handle is grabbed, drives the
     * resize / rotation pipeline.
     */
    tryContinue(e) {
      if (!state.transformActive) return false;
      // No drag in progress — just hover-cursor + pulse.
      if (!state.transformHandle && state.mainCanvas) {
        const coords = canvasCoords(e, state.mainCanvas);
        const hovered = getTransformHandle(coords.x, coords.y);
        state.mainCanvas.style.cursor = hovered ? cursorForHandle(hovered) : 'default';
        if (hovered !== state.hoveredHandle) {
          state.hoveredHandle = hovered;
          composite();
        }
        return false; // didn't fully consume the event
      }
      if (!state.transformHandle) return false;
      // Layer can vanish mid-drag (deleted / doc switched) while a handle is
      // still grabbed — both the rotation and resize paths below dereference
      // it, so bail cleanly instead of throwing.
      if (!state.transformLayer) { state.transformHandle = null; return false; }
      e.preventDefault();
      const coords = canvasCoords(e, state.mainCanvas);
      // Rotation grip — angle measured from the layer's geometric
      // centre to the cursor. Mirror into the popup if it's open.
      if (state.transformHandle === 'rot') {
        const layer = state.transformLayer;
        const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
        const cx = off.x + layer.canvas.width / 2;
        const cy = off.y + layer.canvas.height / 2;
        const rad = Math.atan2(coords.y - cy, coords.x - cx) + Math.PI / 2;
        let deg = Math.round((rad * 180) / Math.PI);
        if (e.shiftKey) deg = Math.round(deg / 15) * 15; // 15° snap
        while (deg > 180) deg -= 360;
        while (deg <= -180) deg += 360;
        state.transformPendingRot = deg;
        reapplyTransform();
        if (state.transformPopup) {
          const rotIn = state.transformPopup.querySelector('#ge-transform-rot');
          if (rotIn) rotIn.value = String(deg);
        }
        return true;
      }
      // Resize via corner / edge handle.
      // Map the cursor delta into the layer's UNROTATED frame so a handle
      // drag scales along the layer's own W/H axes (which are rotated on
      // screen), not the screen axes. For an unrotated layer R(-θ)=identity
      // and this is byte-identical to the old screen-space delta.
      const rawDx = coords.x - state.transformStartX;
      const rawDy = coords.y - state.transformStartY;
      const rotRad = ((state.transformPendingRot || 0) * Math.PI) / 180;
      const cosR = Math.cos(rotRad);
      const sinR = Math.sin(rotRad);
      const dx = rawDx * cosR + rawDy * sinR;   // R(-θ) applied to (rawDx,rawDy)
      const dy = -rawDx * sinR + rawDy * cosR;
      let newW = state.transformOrigW;
      let newH = state.transformOrigH;
      if (state.transformHandle.includes('r')) newW = state.transformOrigW + dx;
      if (state.transformHandle.includes('l')) newW = state.transformOrigW - dx;
      if (state.transformHandle.includes('b')) newH = state.transformOrigH + dy;
      if (state.transformHandle.includes('t')) newH = state.transformOrigH - dy;
      // Shift = lock aspect ratio. Use whichever axis moved more
      // (relative to the original) as the driver.
      if (e.shiftKey && state.transformOrigW > 0 && state.transformOrigH > 0) {
        const aspect = state.transformOrigW / state.transformOrigH;
        const wDelta = Math.abs(newW - state.transformOrigW);
        const hDelta = Math.abs(newH - state.transformOrigH);
        if (wDelta >= hDelta) {
          newH = Math.max(1, Math.round(newW / aspect));
        } else {
          newW = Math.max(1, Math.round(newH * aspect));
        }
      }
      newW = Math.max(1, Math.round(newW));
      newH = Math.max(1, Math.round(newH));
      // Route through the popup-driven pipeline so popup + drag stay
      // in sync. Anchor the opposite corner via transformOrigOffset so
      // handles don't slide while the user drags.
      state.transformPendingW = newW;
      state.transformPendingH = newH;
      // Anchor the opposite edge: in the layer's UNROTATED frame the box
      // centre shifts by ±half the size change toward the grabbed edge. Rotate
      // that shift back into canvas space (R(θ)) and apply it to the start
      // centre to get the new visual centre, then express it as the offset
      // reapplyTransform consumes (offset = centre − logical/2). For an
      // unrotated layer this reduces exactly to the previous anchorOff math.
      let shiftU = 0;
      let shiftV = 0;
      if (state.transformHandle.includes('r')) shiftU = (newW - state.transformOrigW) / 2;
      if (state.transformHandle.includes('l')) shiftU = -(newW - state.transformOrigW) / 2;
      if (state.transformHandle.includes('b')) shiftV = (newH - state.transformOrigH) / 2;
      if (state.transformHandle.includes('t')) shiftV = -(newH - state.transformOrigH) / 2;
      const newCenterX = state.transformStartCenterX + (shiftU * cosR - shiftV * sinR);
      const newCenterY = state.transformStartCenterY + (shiftU * sinR + shiftV * cosR);
      // reapplyTransform derives the visual centre as
      // transformOrigOffset + transformOrigW/H ÷ 2, so back out the offset
      // using the SAME logical orig dims it will add (not newW/newH).
      state.transformOrigOffset = {
        x: newCenterX - state.transformOrigW / 2,
        y: newCenterY - state.transformOrigH / 2,
      };
      reapplyTransform();
      // Mirror the new W/H into the popup if it's open.
      if (state.transformPopup) {
        const wIn = state.transformPopup.querySelector('#ge-transform-w');
        const hIn = state.transformPopup.querySelector('#ge-transform-h');
        if (wIn) wIn.value = String(state.transformPendingFlipH ? -newW : newW);
        if (hIn) hIn.value = String(state.transformPendingFlipV ? -newH : newH);
      }
      return true;
    },

    /**
     * Called on pointerup. Returns true if handled.
     */
    tryEnd() {
      if (!(state.transformActive && state.transformHandle)) return false;
      state.transformHandle = null;
      // Leave transformOrigW/H in LOGICAL space so the session stays coherent
      // for subsequent popup edits / the next drag (reapplyTransform recenters
      // via transformOrigOffset + transformOrigW/H÷2, and aspect-lock reads the
      // ratio from them). The old code reseeded from layer.canvas.{w,h} — the
      // ROTATED bbox — which corrupted the pivot/ratio after a rotated drag.
      // Rebase transformOrigOffset onto the new logical size so the visual
      // centre is preserved across the basis change.
      const prevOrigW = state.transformOrigW;
      const prevOrigH = state.transformOrigH;
      const newOrigW = state.transformPendingW || prevOrigW;
      const newOrigH = state.transformPendingH || prevOrigH;
      if (state.transformOrigOffset) {
        state.transformOrigOffset = {
          x: state.transformOrigOffset.x + (prevOrigW - newOrigW) / 2,
          y: state.transformOrigOffset.y + (prevOrigH - newOrigH) / 2,
        };
      }
      state.transformOrigW = newOrigW;
      state.transformOrigH = newOrigH;
      composite();
      drawTransformHandles();
      return true;
    },
  };
}
