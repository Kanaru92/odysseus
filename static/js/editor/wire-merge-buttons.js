import { isCustomBlend, blendInto } from './blend-modes.js';

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
  // Composite the upper layer down honouring its BLEND MODE (was source-over
  // only, which silently lost Multiply/Screen/etc. and dropped custom blends) —
  // mirror the shared renderer: native modes via globalCompositeOperation, custom
  // (per-pixel) modes via blendInto against the lower layer's pixels.
  let upperSrc = _effectiveCanvas(upper);
  const dx = upperOff.x - lowerOff.x, dy = upperOff.y - lowerOff.y;
  // If the upper layer is clipped to the lower (its base — i.e. lower itself is
  // NOT clipped), bake the clip by intersecting upper's pixels with the base's
  // current alpha before compositing. Otherwise merge-down lets the clipped
  // pixels escape the base's shape (the clipping mask is silently lost). When
  // lower is ALSO clipped the two are siblings clipping to a base further down,
  // so the upper merges unclipped and lower keeps its own clip flag.
  if (upper.clipped && !lower.clipped) {
    const ct = document.createElement('canvas');
    ct.width = upperSrc.width; ct.height = upperSrc.height;
    const cctx = ct.getContext('2d');
    cctx.drawImage(upperSrc, 0, 0);
    cctx.globalCompositeOperation = 'destination-in';
    cctx.drawImage(lower.canvas, -dx, -dy); // base alpha in the upper's local frame
    upperSrc = ct;
  }
  const bm = upper.blendMode || 'source-over';
  const opacity = upper.opacity == null ? 1 : upper.opacity;
  let merged = false;
  if (isCustomBlend(bm)) {
    try {
      const LW = lower.canvas.width, LH = lower.canvas.height;
      const back = lower.ctx.getImageData(0, 0, LW, LH);
      const tmp = document.createElement('canvas');
      tmp.width = LW; tmp.height = LH;
      tmp.getContext('2d').drawImage(upperSrc, dx, dy);
      const src = tmp.getContext('2d').getImageData(0, 0, LW, LH);
      blendInto(bm, back.data, src.data, opacity);
      lower.ctx.putImageData(back, 0, 0);
      merged = true;
    } catch { /* fall through to native source-over */ }
  }
  if (!merged) {
    lower.ctx.save();
    lower.ctx.globalAlpha = opacity;
    lower.ctx.globalCompositeOperation = isCustomBlend(bm) ? 'source-over' : bm;
    lower.ctx.drawImage(upperSrc, dx, dy);
    lower.ctx.restore();
  }
  // The destination now holds raster pixels (text/fill merged in). Drop its
  // editable text/fill models, else double-clicking re-renders ONLY the text/fill
  // and wipes the merged-in content (data loss).
  delete lower.text; delete lower.fill;
  state.layers.splice(idx, 1);
  state.layerOffsets.delete(upper.id);
  state.activeLayerId = lower.id;
  return lower;
}

export function wireMergeButtons({ saveState, createLayer, renderLayerPanel, composite, uiModule, effectiveCanvas, renderLayersTo }) {
  if (effectiveCanvas) _effectiveCanvas = effectiveCanvas;
  // Flatten the whole VISIBLE stack into `ctx`/`canvas` via the shared composite
  // renderer, so merges honour groups (incl. isolated group blend modes), layer
  // blend modes, masks, fx and adjustments exactly like the on-screen composite.
  const flattenStack = (ctx, canvas) => {
    if (renderLayersTo) { renderLayersTo(ctx, canvas); return; }
    // Fallback (renderLayersTo dep missing): source-over with group opacity.
    const groups = _groupMap();
    for (const l of state.layers) {
      if (l.isGroup || !l.visible) continue;
      let gm = 1;
      if (l.groupId && groups[l.groupId]) { const g = groups[l.groupId]; if (!g.visible) continue; gm = g.opacity == null ? 1 : g.opacity; }
      const off = state.layerOffsets.get(l.id) || { x: 0, y: 0 };
      ctx.globalAlpha = l.opacity * gm; ctx.drawImage(_effectiveCanvas(l), off.x, off.y); ctx.globalAlpha = 1;
    }
  };

  // Flatten Copy — new "Flattened" layer = the composited visible stack.
  document.getElementById('ge-flatten')?.addEventListener('click', () => {
    if (state.layers.length < 2) return;
    saveState('Flatten copy');
    const merged = createLayer('Flattened', state.imgWidth, state.imgHeight);
    flattenStack(merged.ctx, merged.canvas);
    state.layers.push(merged);
    state.activeLayerId = merged.id;
    renderLayerPanel();
    composite();
    uiModule.showToast('Flattened copy created');
  });

  // Merge All — flatten every visible layer into the lowest visible one.
  document.getElementById('ge-merge-all')?.addEventListener('click', () => {
    const groups = _groupMap();
    const groupHidden = (l) => l.groupId && groups[l.groupId] && !groups[l.groupId].visible;
    const visibleLayers = state.layers.filter(l => !l.isGroup && l.visible && !groupHidden(l));
    if (visibleLayers.length < 2) {
      if (uiModule) uiModule.showToast('Need at least two visible layers to merge');
      return;
    }
    saveState('Merge all');
    // Composite the whole visible stack into a buffer, then make the base layer = it.
    const tmp = document.createElement('canvas');
    tmp.width = state.imgWidth; tmp.height = state.imgHeight;
    flattenStack(tmp.getContext('2d'), tmp);
    const base = visibleLayers[0];
    base.canvas.width = state.imgWidth; base.canvas.height = state.imgHeight;
    base.ctx.clearRect(0, 0, base.canvas.width, base.canvas.height);
    base.ctx.drawImage(tmp, 0, 0);
    base.layerMask = null; base.fx = null; base.adjLayers = [];
    base._adjFinal = null; base._adjCache = null; delete base.maskEnabled;
    delete base.text; delete base.fill; // flattened raster — drop editable models (else re-edit wipes it)
    base.blendMode = 'source-over'; base.opacity = 1; base.groupId = null;
    for (const l of state.layers) { if (l !== base) state.layerOffsets.delete(l.id); }
    state.layerOffsets.set(base.id, { x: 0, y: 0 });
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
