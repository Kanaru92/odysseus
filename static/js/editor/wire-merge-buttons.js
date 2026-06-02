/**
 * Layer merge / flatten buttons in the layer-panel footer:
 *
 *   #ge-flatten     Flatten Copy — merge every visible layer into a
 *                   new "Flattened" layer, keep originals.
 *   #ge-merge-all   Merge All — flatten every VISIBLE layer into the
 *                   lowest visible one. Hidden layers dropped. Base
 *                   = lowest visible (not bottom of stack) so a
 *                   hidden base can't absorb the visible stack into
 *                   an invisible result.
 *   #ge-merge-down  Merge active layer into the one beneath it.
 *
 * @param {{
 *   saveState:        (label?: string) => void,
 *   createLayer:      (name, w, h) => object,
 *   renderLayerPanel: () => void,
 *   composite:        () => void,
 *   uiModule:         object,
 * }} deps
 */
import { state } from './state.js';

// Resolves a layer's fully-composited pixels (adjustment layers + raster mask +
// fx applied). Set by wireMergeButtons from galleryEditor so merges don't
// silently drop them; defaults to the raw canvas before init.
let _effectiveCanvas = (l) => l.canvas;

// Build an id→group map for gating members by their folder's visibility/opacity.
function _groupMap() {
  const m = {};
  for (const g of state.layers) if (g.isGroup) m[g.id] = g;
  return m;
}

export function mergeLayerDownAtIndex(idx) {
  if (idx < 1 || idx >= state.layers.length) return null;
  const upper = state.layers[idx];
  if (upper.isGroup) return null; // a folder has no pixels to merge
  // Skip any group (folder) entries beneath to land on a real raster layer.
  let li = idx - 1;
  while (li >= 0 && state.layers[li].isGroup) li--;
  if (li < 0) return null;
  const lower = state.layers[li];
  const upperOff = state.layerOffsets.get(upper.id) || { x: 0, y: 0 };
  const lowerOff = state.layerOffsets.get(lower.id) || { x: 0, y: 0 };
  // Bake the LOWER layer's own mask/fx/adjustments into its pixels first, then
  // clear them — otherwise they'd re-apply to the merged-in upper pixels (mirrors
  // the Merge All base-baking).
  if (lower.layerMask || lower.fx || (lower.adjLayers && lower.adjLayers.length)) {
    lower.ctx.save();
    lower.ctx.globalCompositeOperation = 'copy';
    lower.ctx.globalAlpha = 1;
    lower.ctx.drawImage(_effectiveCanvas(lower), 0, 0);
    lower.ctx.restore();
    lower.layerMask = null; lower.fx = null; lower.adjLayers = [];
    lower._adjFinal = null; lower._adjCache = null; delete lower.maskEnabled;
  }
  lower.ctx.save();
  lower.ctx.globalAlpha = upper.opacity;
  lower.ctx.drawImage(
    _effectiveCanvas(upper), // honour the upper layer's mask / fx / adjustments
    upperOff.x - lowerOff.x,
    upperOff.y - lowerOff.y,
  );
  lower.ctx.restore();
  state.layers.splice(idx, 1);
  state.layerOffsets.delete(upper.id);
  state.activeLayerId = lower.id;
  return lower;
}

export function wireMergeButtons({ saveState, createLayer, renderLayerPanel, composite, uiModule, effectiveCanvas }) {
  if (effectiveCanvas) _effectiveCanvas = effectiveCanvas;
  // Flatten Copy.
  document.getElementById('ge-flatten')?.addEventListener('click', () => {
    if (state.layers.length < 2) return;
    saveState('Flatten copy');
    const merged = createLayer('Flattened', state.imgWidth, state.imgHeight);
    const ctx = merged.ctx;
    const groups = _groupMap();
    for (const l of state.layers) {
      if (l.isGroup || !l.visible) continue;
      let gm = 1;
      if (l.groupId && groups[l.groupId]) {
        const g = groups[l.groupId];
        if (!g.visible) continue;            // member of a hidden folder
        gm = g.opacity == null ? 1 : g.opacity;
      }
      const off = state.layerOffsets.get(l.id) || { x: 0, y: 0 };
      ctx.globalAlpha = l.opacity * gm;
      ctx.drawImage(_effectiveCanvas(l), off.x, off.y);
      ctx.globalAlpha = 1;
    }
    state.layers.push(merged);
    state.activeLayerId = merged.id;
    renderLayerPanel();
    composite();
    uiModule.showToast('Flattened copy created');
  });

  // Merge All — drop hidden layers; base = lowest visible.
  document.getElementById('ge-merge-all')?.addEventListener('click', () => {
    const groups = _groupMap();
    const groupHidden = (l) => l.groupId && groups[l.groupId] && !groups[l.groupId].visible;
    const gmOf = (l) => (l.groupId && groups[l.groupId] && groups[l.groupId].opacity != null)
      ? groups[l.groupId].opacity : 1;
    const visibleLayers = state.layers.filter(l => !l.isGroup && l.visible && !groupHidden(l));
    if (visibleLayers.length < 2) {
      if (uiModule) uiModule.showToast('Need at least two visible layers to merge');
      return;
    }
    saveState('Merge all');
    const base = visibleLayers[0];
    const baseCtx = base.ctx;
    // Bake the base layer's OWN mask / fx / adjustments into its pixels first,
    // then clear them so they don't re-clip the whole merged result.
    if (base.layerMask || base.fx || (base.adjLayers && base.adjLayers.length)) {
      baseCtx.save();
      baseCtx.globalAlpha = 1;
      baseCtx.globalCompositeOperation = 'copy';
      baseCtx.drawImage(_effectiveCanvas(base), 0, 0);
      baseCtx.restore();
      base.layerMask = null; base.fx = null; base.adjLayers = [];
      base._adjFinal = null; base._adjCache = null;
    }
    for (let i = 1; i < visibleLayers.length; i++) {
      const l = visibleLayers[i];
      const off = state.layerOffsets.get(l.id) || { x: 0, y: 0 };
      baseCtx.globalAlpha = l.opacity * gmOf(l);
      baseCtx.drawImage(_effectiveCanvas(l), off.x, off.y);
      baseCtx.globalAlpha = 1;
    }
    // Free offset entries for the discarded layers; keep base.
    for (const l of state.layers) {
      if (l === base) continue;
      state.layerOffsets.delete(l.id);
    }
    base.groupId = null; // folders are gone after a full merge
    state.layers = [base];
    state.activeLayerId = base.id;
    renderLayerPanel();
    composite();
    uiModule.showToast('Visible layers merged');
  });

  // Merge Down.
  document.getElementById('ge-merge-down')?.addEventListener('click', () => {
    const idx = state.layers.findIndex(l => l.id === state.activeLayerId);
    if (idx < 1) return; // can't merge the bottom layer
    saveState('Merge down');
    mergeLayerDownAtIndex(idx);
    renderLayerPanel();
    composite();
    uiModule.showToast('Layer merged down');
  });
}
