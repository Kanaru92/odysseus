/**
 * Editor keyboard shortcuts — bound to `document` so shortcuts work
 * without first clicking into the canvas. Gated by `state.editorOpen`
 * so they don't leak into chat input when the editor is closed.
 *
 * Covers:
 *   ?              toggle the shortcuts cheatsheet
 *   Enter          confirm in-progress transform
 *   Esc            cancel transform / lasso / crop (in priority order)
 *   Ctrl+Z         undo (Shift adds redo)
 *   Ctrl+D / Ctrl+Shift+D   deselect (clears wand + lasso)
 *   Ctrl+S         save (Shift = save as / export to gallery)
 *   Ctrl+Shift+T   open resize popup
 *   Ctrl+Alt+T     start free transform
 *   Ctrl+Shift+I / Ctrl+Alt+I   invert wand / lasso selection
 *   Ctrl+Alt+J     new empty layer
 *   Ctrl+A / Ctrl+Alt+A   select all canvas (lasso polygon = full bounds)
 *   Ctrl+Alt+Shift+E   stamp visible to a new layer
 *   Ctrl+C/X       copy / cut wand or lasso selection (image clipboard
 *                  + internal clipboard)
 *   Ctrl+V         (handled by the paste event listener)
 *   Tool keys (V, B, E, L, …) → toolbar click
 *   [ / ]          shrink / grow brush size proportionally
 *   D, C, M (when lasso has 3+ points) → delete / copy / convert mask
 *   Delete / Backspace (wand or lasso) → delete pixels
 *
 * @param {{
 *   toolbar:                HTMLDivElement,
 *   toolKeyMap:             Record<string, string>,
 *   composite:              () => void,
 *   saveState:              (label?: string) => void,
 *   undo:                   () => void,
 *   redo:                   () => void,
 *   toggleShortcuts:        (show?: boolean) => void,
 *   confirmTransform:       () => void,
 *   cancelTransform:        () => void,
 *   startTransform:         () => void,
 *   resizeCustomPrompt:     () => void,
 *   addEmptyLayer:          () => void,
 *   brushSizeSync:          (source: HTMLInputElement | null) => void,
 *   invertSelection:        () => boolean,
 *   wandDeleteSelection:    () => void,
 *   wandCopyToNewLayer:     () => void,
 *   lassoDeleteSelection:   () => void,
 *   lassoCopyToLayer:       () => void,
 *   lassoToMask:            () => void,
 *   buildLassoMask:         (w: number, h: number, offX: number, offY: number, feather: number, grow: number) => HTMLCanvasElement,
 *   drawLassoOverlay:       () => void,
 *   activeLayer:            () => object | null,
 *   uiModule:               object,
 * }} deps
 */
import { state } from './state.js';
import { copyMerged, pasteInPlace } from './clipboard-ops.js';
import { nextGroupedTool } from './panels/tool-flyout.js';

export function wireKeyboardShortcuts(deps) {
  const {
    toolbar, toolKeyMap,
    composite, saveState, undo, redo,
    toggleShortcuts, confirmTransform, cancelTransform, startTransform,
    repeatLastTransform, resizeCustomPrompt, addEmptyLayer, brushSizeSync,
    invertSelection,
    wandDeleteSelection, wandCopyToNewLayer,
    lassoDeleteSelection, lassoCopyToLayer, lassoToMask,
    buildLassoMask, drawLassoOverlay,
    swapColors, defaultColors, toggleMaskView, runCommand,
    activeLayer, uiModule, renderLayerPanel, fillActiveLayer, stampVisible,
    confirmDistort, cancelDistort, applyPcrop,
    polyLassoClose, polyLassoCancel,
    magLassoClose, magLassoCancel,
    addManagedListener,
  } = deps;

  const _onKeyDown = (e) => {
    if (!state.editorOpen) return;
    // Arrow keys nudge the active layer when the Move tool is active: 1px, or
    // 10px with Shift (PS-style nudge). Skips text fields and active
    // transform/crop interactions (arrows belong to those then). Holding a key
    // moves every repeat but only records ONE undo step for the whole nudge.
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')
        && state.tool === 'move'
        && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA'
        && !state.transformActive && !state.distortActive && !state.pcropActive && !state.cropRect) {
      const layer = activeLayer && activeLayer();
      if (layer) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        if (!e.repeat && saveState) saveState('Nudge layer');
        const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
        state.layerOffsets.set(layer.id, { x: off.x + dx, y: off.y + dy });
        if (composite) composite();
        if (renderLayerPanel) renderLayerPanel();
      }
      return;
    }
    // `?` toggles the cheatsheet. Don't fire while typing in a text
    // field — the user might be typing a prompt with a `?`.
    if (e.key === '?' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      toggleShortcuts();
      return;
    }
    // Alt+Backspace = fill with foreground, Ctrl+Backspace = fill with background.
    if ((e.key === 'Backspace' || e.key === 'Delete') && (e.altKey || ((e.ctrlKey || e.metaKey) && !e.shiftKey)) &&
        e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      if (fillActiveLayer) fillActiveLayer(e.altKey ? state.color : state.bgColor);
      return;
    }
    // "/" toggles Lock Transparency on the active layer (paint existing pixels only).
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      const lyr = activeLayer && activeLayer();
      if (lyr) {
        if (saveState) saveState(lyr.lockAlpha ? 'Unlock transparency' : 'Lock transparency'); // undoable
        lyr.lockAlpha = !lyr.lockAlpha;
        if (renderLayerPanel) renderLayerPanel();
        if (uiModule) uiModule.showToast(lyr.lockAlpha ? 'Transparency locked' : 'Transparency unlocked');
      }
      return;
    }
    // Enter closes an in-progress polygonal-lasso selection (before transform).
    if (e.key === 'Enter' && state.polyLassoActive && polyLassoClose) {
      e.preventDefault(); polyLassoClose(); return;
    }
    if (e.key === 'Enter' && state.magLassoActive && magLassoClose) {
      e.preventDefault(); magLassoClose(); return;
    }
    if (e.key === 'Enter' && (state.transformActive || state.distortActive || state.pcropActive)) {
      e.preventDefault();
      if (state.pcropActive && applyPcrop) applyPcrop();
      else if (state.distortActive && confirmDistort) confirmDistort();
      else confirmTransform();
      return;
    }
    if (e.key === 'Escape') {
      // (Polygonal-lasso cancel is handled by the capture-phase Escape gate in
      // galleryEditor, which runs before this; kept here as a fallback.)
      if (state.polyLassoActive && polyLassoCancel) { e.preventDefault(); polyLassoCancel(); return; }
      if (state.magLassoActive && magLassoCancel) { e.preventDefault(); magLassoCancel(); return; }
      if (state.distortActive && cancelDistort) { e.preventDefault(); cancelDistort(); return; }
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      const inField = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
      // Shift+Ctrl+C — Copy Merged: flatten all visible layers (cropped to any
      // active selection) into the merged clipboard. Must run BEFORE the
      // selection-aware Ctrl+C paths below, which don't guard against Shift.
      if (e.shiftKey && !e.altKey && (e.key === 'c' || e.key === 'C' || e.code === 'KeyC') && !inField) {
        e.preventDefault();
        e.stopPropagation();
        copyMerged({ uiModule });
        return;
      }
      // Shift+Ctrl+V — Paste in Place: drop the merged clipboard onto a new
      // "Pasted" layer at the exact position it was copied from.
      if (e.shiftKey && !e.altKey && (e.key === 'v' || e.key === 'V' || e.code === 'KeyV') && !inField) {
        e.preventDefault();
        e.stopPropagation();
        pasteInPlace({ composite, saveState, renderLayerPanel, uiModule });
        return;
      }
      if ((e.code === 'KeyZ' || e.key === 'z' || e.key === 'Z') && !inField) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      // Ctrl+D / Ctrl+Shift+D = Deselect (PS uses Ctrl+D): clears the wand
      // selection (and lasso if active) without affecting layers.
      if (!e.altKey && !inField && (e.key === 'D' || e.key === 'd')) {
        if (state.wandMask || state.lassoPoints.length) {
          e.preventDefault();
          if (state.wandMask) {
            saveState();
            state.wandMask = null;
            state.wandLayerId = null;
            state.wandLastSeed = null;
          }
          if (state.lassoPoints.length) {
            state.lassoPoints = [];
            state.lassoActive = false;
          }
          composite();
        }
      }
      // Save shortcuts — match the hints shown in the Save dropdown.
      if ((e.key === 's' || e.key === 'S') && !e.altKey && !inField) {
        e.preventDefault();
        document.getElementById(e.shiftKey ? 'ge-export-gallery' : 'ge-save')?.click();
      }
      // Ctrl+E — merge the active layer down into the one below (PS standard).
      if ((e.key === 'e' || e.key === 'E') && !e.shiftKey && !e.altKey && !inField) {
        e.preventDefault();
        document.getElementById('ge-merge-down')?.click();
      }
      // Ctrl+Shift+T — Transform Again (PS standard). Falls back to the custom
      // resize prompt if transform-again isn't wired (defensive).
      if (e.shiftKey && e.key === 'T' && !inField) { e.preventDefault(); if (repeatLastTransform) repeatLastTransform(); else resizeCustomPrompt(); }
      if (e.altKey && e.key === 't' && !inField) { e.preventDefault(); startTransform(); }
      // Ctrl+Shift+X — Liquify (forward-warp deform). e.code dodges the
      // Shift-modified key value; matches the standard deform-tool binding.
      if (e.shiftKey && !e.altKey && e.code === 'KeyX' && !inField) {
        e.preventDefault();
        e.stopPropagation();
        toolbar.querySelector('[data-tool="liquify"]')?.click();
      }
      // Ctrl+Y — toggle the CMYK soft-proof (view-only print preview).
      if (!e.shiftKey && !e.altKey && !inField && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        e.stopPropagation();
        state.cmykProof = !state.cmykProof;
        composite();
        if (uiModule) uiModule.showToast(state.cmykProof ? 'Proof Colors: CMYK preview on' : 'Proof Colors off');
      }
      // Ctrl+'  → toggle grid · Ctrl+;  → toggle guide visibility (layout aids).
      if (e.key === "'" && !inField) { e.preventDefault(); e.stopPropagation(); state.showGrid = !state.showGrid; composite(); }
      if (e.key === ';' && !e.shiftKey && !inField) { e.preventDefault(); e.stopPropagation(); state.guidesVisible = !state.guidesVisible; composite(); }
      // Ctrl+Alt+I / Ctrl+Shift+I — invert current selection (PS uses
      // Ctrl+Shift+I). Uses e.code so Alt-modified key values don't break it.
      if (!inField && (e.altKey || e.shiftKey) && e.code === 'KeyI') {
        if (invertSelection()) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
      // Ctrl+I (no Shift/Alt) — invert the active layer (PS image invert).
      if (!inField && !e.altKey && !e.shiftKey && e.code === 'KeyI' && runCommand) {
        e.preventDefault(); e.stopPropagation(); runCommand('invert');
      }
      // Ctrl+Shift+U — Desaturate the active layer (PS).
      if (!inField && e.shiftKey && e.code === 'KeyU' && runCommand) {
        e.preventDefault(); e.stopPropagation(); runCommand('desaturate');
      }
      // Ctrl+Alt+J — new empty layer.
      if (e.altKey && e.code === 'KeyJ') {
        e.preventDefault();
        e.stopPropagation();
        addEmptyLayer();
      }
      // Ctrl+Shift+N — new layer (PS). Best-effort: Chrome/Edge reserve this for
      // incognito and may swallow it before the page sees it; Ctrl+Alt+J always
      // works as the fallback.
      if (e.shiftKey && e.code === 'KeyN') {
        e.preventDefault();
        e.stopPropagation();
        addEmptyLayer();
      }
      // Ctrl+Alt+Shift+E — stamp visible to a new layer.
      if (e.altKey && e.shiftKey && e.code === 'KeyE') {
        e.preventDefault();
        e.stopPropagation();
        if (stampVisible) stampVisible();
      }
      // Ctrl+Alt+G — clip / release the active layer to the layer below.
      if (e.altKey && e.code === 'KeyG') {
        e.preventDefault();
        e.stopPropagation();
        const lyr = activeLayer && activeLayer();
        const idx = lyr ? state.layers.findIndex((l) => l.id === lyr.id) : -1;
        if (lyr && idx > 0) {
          saveState(lyr.clipped ? 'Release clip' : 'Clip to below');
          lyr.clipped = !lyr.clipped;
          composite();
          if (renderLayerPanel) renderLayerPanel();
          if (uiModule) uiModule.showToast(lyr.clipped ? 'Clipped to layer below' : 'Clip released');
        } else if (uiModule) { uiModule.showToast('No layer below to clip to'); }
        return;
      }
      // Ctrl+G — group the active layer into a new folder. Ctrl+Shift+G —
      // ungroup (dissolve the folder, or remove the active layer from its
      // group). Members reference their group by id, so the folder gates
      // their visibility / opacity at composite regardless of stack position.
      if (e.code === 'KeyG' && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        const lyr = state.layers.find(l => l.id === state.activeLayerId) || null;
        if (!lyr) { if (uiModule) uiModule.showToast('Select a layer first'); return; }
        if (e.shiftKey) {
          // Ungroup.
          if (lyr.isGroup) {
            saveState('Ungroup');
            for (const m of state.layers) if (m.groupId === lyr.id) m.groupId = null;
            const fallback = state.layers.find(l => l.id !== lyr.id && !l.isGroup);
            state.layers = state.layers.filter(l => l.id !== lyr.id);
            if (state.activeLayerId === lyr.id) state.activeLayerId = fallback ? fallback.id : (state.layers[0] && state.layers[0].id);
            composite();
            if (renderLayerPanel) renderLayerPanel();
            if (uiModule) uiModule.showToast('Group dissolved');
          } else if (lyr.groupId) {
            saveState('Remove from group');
            const gid = lyr.groupId;
            lyr.groupId = null;
            // Drop the folder if it's now empty.
            if (!state.layers.some(l => l.groupId === gid)) {
              state.layers = state.layers.filter(l => l.id !== gid);
            }
            composite();
            if (renderLayerPanel) renderLayerPanel();
            if (uiModule) uiModule.showToast('Removed from group');
          } else if (uiModule) { uiModule.showToast('Layer is not in a group'); }
        } else {
          // Group — delegate to the panel's Group button, which handles the
          // multi-selection (Ctrl/Cmd+click) AND the single-layer case, sets the
          // pass-through blend mode, keeps members contiguous, and records history.
          if (lyr.isGroup) { if (uiModule) uiModule.showToast('Already a group'); return; }
          const btn = document.getElementById('ge-group-layer');
          if (btn) btn.click();
        }
        return;
      }
      // Wand selection: Delete = erase pixels. Ctrl+X = cut to
      // clipboard + new layer + erase. Ctrl+C = copy.
      // (Legacy `&& !_wandActive` clause referenced an undeclared
      // variable — removed; the wand is selection-only and has no
      // "active drag" state.)
      if (state.wandMask) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          wandDeleteSelection();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyX' || e.code === 'KeyC' || e.key === 'x' || e.key === 'X' || e.key === 'c' || e.key === 'C')) {
          e.preventDefault();
          const isCut = e.code === 'KeyX' || e.key === 'x' || e.key === 'X';
          const src = state.layers.find(l => l.id === state.wandLayerId);
          if (!src) return;
          // Clip source by wand mask into a temp canvas.
          const w = src.canvas.width, h = src.canvas.height;
          const tmp = document.createElement('canvas');
          tmp.width = w; tmp.height = h;
          const tCtx = tmp.getContext('2d');
          tCtx.drawImage(src.canvas, 0, 0);
          tCtx.globalCompositeOperation = 'destination-in';
          tCtx.drawImage(state.wandMask, 0, 0);
          state.internalClipboard = tmp;
          tmp.toBlob(blob => {
            if (blob && navigator.clipboard?.write) {
              navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(() => {
                uiModule.showToast(isCut ? 'Cut to clipboard' : 'Copied to clipboard');
              }).catch(() => uiModule.showToast(isCut ? 'Cut (editor only)' : 'Copied (editor only)'));
            }
          }, 'image/png');
          if (isCut) {
            // Cut also moves the selection to a new layer + erases source.
            wandCopyToNewLayer();
            wandDeleteSelection();
          }
          return;
        }
      }
      if ((e.code === 'KeyX' || e.code === 'KeyC' || e.key === 'x' || e.key === 'X' || e.key === 'c' || e.key === 'C') && state.lassoPoints.length >= 3) {
        e.preventDefault();
        const layer = activeLayer();
        if (!layer) return;
        const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
        const feather = parseInt(document.getElementById('ge-lasso-feather')?.value || '0');
        const grow = parseInt(document.getElementById('ge-lasso-grow')?.value || '0');
        const w = layer.canvas.width, h = layer.canvas.height;
        const mask = buildLassoMask(w, h, off.x, off.y, feather, grow);
        const srcData = layer.ctx.getImageData(0, 0, w, h);
        const maskData = mask.getContext('2d').getImageData(0, 0, w, h);
        // Build clipped image. NOTE: buildLassoMask stores selection strength
        // in the RED channel (alpha is pinned to 255 in its feather branch), so
        // the per-pixel multiply below reads maskData R — a GPU
        // destination-in (alpha-based) would silently drop the feather falloff.
        const tmp = document.createElement('canvas');
        tmp.width = w; tmp.height = h;
        const tCtx = tmp.getContext('2d');
        const outData = tCtx.createImageData(w, h);
        for (let i = 0; i < w * h; i++) {
          const mv = maskData.data[i * 4] / 255;
          if (mv > 0) {
            outData.data[i*4] = srcData.data[i*4];
            outData.data[i*4+1] = srcData.data[i*4+1];
            outData.data[i*4+2] = srcData.data[i*4+2];
            outData.data[i*4+3] = Math.round(srcData.data[i*4+3] * mv);
          }
        }
        tCtx.putImageData(outData, 0, 0);
        state.internalClipboard = tmp;
        const isCut = e.code === 'KeyX' || e.key === 'x' || e.key === 'X';
        tmp.toBlob(blob => {
          if (blob && navigator.clipboard?.write) {
            navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(() => {
              uiModule.showToast(isCut ? 'Cut to clipboard' : 'Copied to clipboard');
            }).catch(() => uiModule.showToast(isCut ? 'Cut (editor only)' : 'Copied (editor only)'));
          }
        }, 'image/png');
        if (isCut) {
          // Cut keeps the lasso points so lassoDeleteSelection() can erase the
          // selected region; clearing happens inside that call.
          lassoDeleteSelection();
        } else {
          state.lassoPoints = [];
          composite();
        }
        return; // handled lasso copy/cut — don't fall through to the full-layer copy
      }
      // Ctrl+C with no active selection → copy the entire active layer
      // to the system clipboard as a PNG. Gives a "just copy this image"
      // shortcut without having to lasso-select-all first. The
      // selection-aware Ctrl+C paths above run first (wand + lasso),
      // so this only fires when neither is active.
      if ((e.code === 'KeyC' || e.key === 'c' || e.key === 'C') && !e.shiftKey && !state.wandMask && state.lassoPoints.length < 3) {
        const layer = activeLayer();
        if (layer && layer.canvas && layer.canvas.width > 0) {
          e.preventDefault();
          layer.canvas.toBlob(blob => {
            if (blob && navigator.clipboard?.write) {
              navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
                .then(() => uiModule.showToast('Layer copied to clipboard'))
                .catch(() => uiModule.showToast('Copy failed (clipboard permission denied?)'));
            }
          }, 'image/png');
          return;
        }
      }
      // Ctrl+A / Ctrl+Alt+A = select all canvas (PS uses Ctrl+A). Guarded so
      // Ctrl+A still selects text inside form fields.
      if (!e.shiftKey && (e.key === 'a' || e.key === 'A') &&
          e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA' &&
          state.imgWidth > 0 && state.imgHeight > 0) {
        e.preventDefault();
        state.lassoPoints = [
          { x: 0, y: 0 }, { x: state.imgWidth, y: 0 },
          { x: state.imgWidth, y: state.imgHeight }, { x: 0, y: state.imgHeight },
        ];
        state.lassoActive = false;
        composite();
        drawLassoOverlay();
        uiModule.showToast('All selected — Ctrl+C to copy, Del to delete');
      }
      // Ctrl+V handled by the paste event listener.
      if (e.key === 'v') { /* no-op here */ }
      return;
    }
    // Alt+Shift+P — toggle Airbrush / build-up mode (PS standard).
    if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyP') {
      e.preventDefault();
      state.airbrush = !state.airbrush;
      const cb = document.getElementById('ge-brush-airbrush');
      if (cb) { cb.checked = state.airbrush; cb.dispatchEvent(new Event('change', { bubbles: true })); } // drive the options-bar mirror
      if (uiModule) uiModule.showToast(state.airbrush ? 'Airbrush on' : 'Airbrush off');
      return;
    }
    // Tool shortcuts (only when not typing in an input).
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    // R = rotate the VIEW 15° CW; Shift+R = reset to 0 (non-destructive, like
    // turning the paper). View rotation flows through canvasCoords so painting
    // stays correct while rotated.
    if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      state.viewRotation = e.shiftKey ? 0 : (((state.viewRotation || 0) + 15) % 360);
      const area = document.querySelector('.ge-canvas-area');
      if (area && area._reapplyView) area._reapplyView();
      if (uiModule) uiModule.showToast(state.viewRotation ? `View ${state.viewRotation}°` : 'View upright');
      return;
    }
    const toolId = toolKeyMap[e.key.toLowerCase()];
    if (toolId) {
      // Shift+<tool key> cycles through that slot's sub-tools (industry-standard,
      // e.g. Shift+L → Lasso → Polygonal → Magnetic). Plain key picks the slot.
      let target = toolId;
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const nx = nextGroupedTool(state.tool, toolId);
        if (nx) target = nx;
      }
      const toolBtn = toolbar.querySelector(`[data-tool="${target}"]`);
      if (toolBtn) toolBtn.click();
    }
    // Bracket keys for brush size — ±10% multiplier mirrors the
    // exponential slider curve so each press feels the same at any
    // size.
    if (e.key === '[' || e.key === ']') {
      const factor = e.key === '[' ? 0.9 : 1.1;
      state.brushSize = Math.max(1, Math.min(5000, Math.round(state.brushSize * factor)));
      try { brushSizeSync(null); } catch {}
    }
    // { / } adjust brush hardness. brushSoftness is the inverse of
    // hardness (0 = hard, 300 = very soft), so { reduces softness, } raises it.
    if (e.key === '{' || e.key === '}') {
      const delta = e.key === '{' ? -30 : 30;
      state.brushSoftness = Math.max(0, Math.min(300, (state.brushSoftness || 0) + delta));
      const sl = document.getElementById('ge-brush-softness');
      const lbl = document.getElementById('ge-brush-softness-label');
      if (sl) sl.value = String(state.brushSoftness);
      if (lbl) lbl.textContent = state.brushSoftness + '%';
    }
    // '\' toggles the layer-mask rubylith overlay (red over hidden areas) for
    // the active layer's mask.
    if (e.key === '\\' && toggleMaskView) { e.preventDefault(); toggleMaskView(); }
    // Color keys — X swaps FG/BG, D resets to default black/white.
    // D also serves as lasso-delete when a lasso selection is active, so only
    // treat it as default-colors when there's no lasso selection.
    if ((e.key === 'x' || e.key === 'X') && swapColors) { e.preventDefault(); swapColors(); }
    if ((e.key === 'd' || e.key === 'D') && state.lassoPoints.length < 3 && defaultColors) { e.preventDefault(); defaultColors(); }
    // Number keys set the active paint tool's opacity: 1 = 10% …
    // 9 = 90%, 0 = 100%.
    if (/^[0-9]$/.test(e.key) && (state.tool === 'brush' || state.tool === 'eraser' || state.tool === 'clone')) {
      const pct = e.key === '0' ? 100 : parseInt(e.key, 10) * 10;
      const field = state.tool === 'brush' ? 'brushOpacity' : state.tool === 'eraser' ? 'eraserOpacity' : 'cloneOpacity';
      state[field] = pct;
      const sl = document.getElementById('ge-' + state.tool + '-opacity');
      const lbl = document.getElementById('ge-' + state.tool + '-opacity-label');
      if (sl) sl.value = String(pct);
      if (lbl) lbl.textContent = pct + '%';
    }
    // Q toggles Quick Mask — paint the selection with the brush (E to subtract).
    if (e.key === 'q' || e.key === 'Q') {
      e.preventDefault();
      state.quickMask = !state.quickMask;
      if (state.quickMask && !state.wandMask && state.imgWidth) {
        const m = document.createElement('canvas');
        m.width = state.imgWidth; m.height = state.imgHeight;
        state.wandMask = m; state.wandLayerId = state.activeLayerId; state.wandMaskVisible = true;
      }
      composite();
      if (uiModule) uiModule.showToast(state.quickMask ? 'Quick Mask on — paint to select, Eraser to subtract' : 'Quick Mask off');
    }
    // Tab hides/shows the tool + side panels for a full-canvas view.
    if (e.key === 'Tab') {
      e.preventDefault();
      state.panelsHidden = !state.panelsHidden;
      const root = state.container;
      if (root) {
        root.querySelectorAll('.ge-toolbar, .ge-right-panel').forEach((el) => {
          el.style.display = state.panelsHidden ? 'none' : '';
        });
      }
    }
    // F toggles true fullscreen for the editor (fills the screen edge to edge).
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      const el = (state.container && state.container.closest && state.container.closest('.gallery-modal-content')) || state.container;
      if (el) {
        if (!document.fullscreenElement) {
          // Focus the editor after going fullscreen so keyboard shortcuts keep
          // working (a fullscreen element with no focus inside can swallow keys).
          try { const p = el.requestFullscreen(); if (p && p.then) p.then(() => { try { (state.container || el).focus({ preventScroll: true }); } catch {} }).catch(() => {}); } catch {}
        }
        else { try { document.exitFullscreen(); } catch {} }
      }
    }
    // Lasso shortcuts (when selection exists).
    if (state.lassoPoints.length >= 3) {
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); lassoDeleteSelection(); }
      if (e.key === 'd') { e.preventDefault(); lassoDeleteSelection(); }
      if (e.key === 'c') { e.preventDefault(); lassoCopyToLayer(); }
      if (e.key === 'm') { e.preventDefault(); lassoToMask(); }
    }
  };
  // Register via the editor's managed-listener system so it's removed on close
  // (the handler closes over `toolbar`; left attached it would retain the whole
  // toolbar DOM across reopens). Falls back to a raw listener if not provided.
  if (addManagedListener) addManagedListener(document, 'keydown', _onKeyDown);
  else document.addEventListener('keydown', _onKeyDown);
}
