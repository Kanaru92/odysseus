/**
 * Gallery Editor — canvas-based image editor with layers, brush, eraser, text, crop, inpaint mask.
 */

import uiModule from './ui.js';
import dragSortModule from './dragSort.js';
import spinnerModule from './spinner.js';
import { attachColorPicker } from './colorPicker.js';
import modalManager from './modalManager.js';
import { canvasCoords as _canvasCoords } from './editor/canvas-coords.js';
import { drawCheckerboard as _drawCheckerboard, setChecker, checkerConfig, CHECKER_SIZES, CHECKER_PRESETS } from './editor/checkerboard.js';
import { dilateMask as _dilateMask, applyInpaintFeather as _applyInpaintFeather } from './editor/mask-utils.js';
import {
  lassoOffsetPoints as _lassoOffsetPointsImpl,
  getLassoPath as _getLassoPathImpl,
  buildLassoMask as _buildLassoMaskImpl,
} from './editor/tools/lasso-mask.js';
import { floodFillMask as _floodFillMask } from './editor/tools/flood-fill.js';
import { colorRangeMask as _colorRangeMask } from './editor/tools/color-range.js';
import { diffusionFill as _diffusionFill } from './editor/tools/content-fill.js';
import { drawHistogram as _drawHistogram } from './editor/fx/histogram.js';
import { applyCmykProof } from './editor/fx/cmyk-proof.js';
import { wirePasteboard } from './editor/wire-pasteboard.js';
import { isCustomBlend as _isCustomBlend, blendInto as _blendInto } from './editor/blend-modes.js';
import { tileize as _tileize, detileTo as _detileTo } from './editor/undo-tiles.js';
import {
  applyAdjustment as _applyAdjToCanvas,
  renderLayerPixelAdjustments as _renderLayerPixelAdjustmentsImpl,
  renderLayerWithAdjLayers as _renderLayerWithAdjLayers,
} from './editor/fx/pixel-pass.js';
import {
  layerFilterString as _layerFilterString,
  fxFilterToSlider as _fxFilterToSlider,
} from './editor/fx/filter-string.js';
import {
  layerHasAdjustments as _layerHasAdjustments,
  layerNeedsPixelPass as _layerNeedsPixelPass,
  adjustmentsKey as _adjustmentsKey,
  defaultAdjParams as _defaultAdjParams,
  adjLayerLabel as _adjLayerLabel,
  ADJ_ICONS as _ADJ_ICONS,
  HISTORY_ICON as _HISTORY_ICON,
  isMaskCanvasEmpty as _isMaskCanvasEmpty,
  isLayerEmpty as _isLayerEmpty,
  relTime as _relTime,
} from './editor/layer-helpers.js';
import { computeSnap as _computeSnapImpl, cursorForHandle as _cursorForHandle } from './editor/snap.js';
import {
  layerUnionAlpha as _layerUnionAlphaImpl,
  seamMask as _seamMaskImpl,
  layerBodyMask as _layerBodyMaskImpl,
} from './editor/harmonize-masks.js';
import {
  gaussianBlur as _gaussianBlur,
  zoomBlur as _zoomBlur,
  motionBlur as _motionBlur,
} from './editor/filters/blur.js';
import { edgeFeather as _edgeFeather } from './editor/filters/edge-feather.js';
import {
  buildMergedMaskCanvas as _buildMergedMaskCanvasImpl,
} from './editor/composite-helpers.js';
import { buildToolbar as _buildToolbar } from './editor/build/toolbar.js';
import { buildTopbar as _buildTopbar } from './editor/build/topbar.js';
import { buildOptionsBar as _buildOptionsBar } from './editor/build/options-bar.js';
import { createOptionsBar } from './editor/wire-options-bar.js';
import { buildMenuBar as _buildMenuBar } from './editor/build/menu-bar.js';
import { wireMenuBar } from './editor/wire-menu-bar.js';
import { wireSwatches } from './editor/wire-swatches.js';
import { wireOkPicker } from './editor/ok-picker.js';
import { wireHsvPane } from './editor/hsv-pane.js';
import { mountPressureCurve } from './editor/pressure-curve.js';
import { mountBrushPreview } from './editor/brush-preview.js';
import { createGradientEditor } from './editor/gradient-editor.js';
import { wireScriptRunner } from './editor/script-runner.js';
import { wireDocTabs } from './editor/doc-tabs.js';
import { initCommands, registerCommand, runCommand } from './editor/commands.js';
import { wireActions } from './editor/actions-panel.js';
import { wireReference } from './editor/wire-reference.js';
import { wireHistogram } from './editor/wire-histogram.js';
import {
  controlsHTML as _controlsHTML,
  layerPanelHTML as _layerPanelHTML,
} from './editor/build/controls.js';
import {
  transformPopupHTML as _transformPopupHTML,
  attachSpinRepeat as _attachSpinRepeat,
} from './editor/build/transform-popup.js';
import {
  shortcutsPopupHTML as _shortcutsPopupHTML,
  historyPanelHTML as _historyPanelHTMLImpl,
  canvasSizePromptHTML as _canvasSizePromptHTML,
} from './editor/build/popups.js';
import { state } from './editor/state.js';
import { createMoveTool } from './editor/tools/move.js';
import { createCropTool } from './editor/tools/crop.js';
import { createLassoTool } from './editor/tools/lasso.js';
import { createPolyLassoTool } from './editor/tools/poly-lasso.js';
import { createMagneticLassoTool } from './editor/tools/magnetic-lasso.js';
import { createRedEyeTool } from './editor/tools/red-eye.js';
import { createRulerTool } from './editor/tools/ruler.js';
import { createBrushQuickPick } from './editor/brush-quickpick.js';
import { createShapeTool } from './editor/tools/shapes.js';
import { createSmartObject } from './editor/smart-object.js';
import { downloadImage, EXPORT_FORMATS } from './editor/export-image.js';
import { createAnimation } from './editor/anim/animation.js';
import { createTimeline } from './editor/anim/timeline.js';
import { exportAnimation, downloadAnim, ANIM_FORMATS } from './editor/anim/export-anim.js';
import { createPenHid } from './editor/pen-hid.js';
import { createWandTool } from './editor/tools/wand.js';
import { createCloneTool } from './editor/tools/clone.js';
import { createTransformDragTool } from './editor/tools/transform-drag.js';
import { createStrokeTool } from './editor/tools/stroke.js';
import { createLayerPanelRenderer } from './editor/layer-panel.js';
import {
  syncOverlay as _syncTransformOverlayImpl,
  drawHandles as _drawTransformHandlesImpl,
  getHandleAt as _getTransformHandleImpl,
} from './editor/tools/transform-handles.js';
import { createCanvasTransforms } from './editor/canvas-transforms.js';
import { createApplyImageTool } from './editor/ai-tool-runner.js';
import { createStrokePipeline } from './editor/stroke-pipeline.js';
import { createAdjPopupSystem } from './editor/fx/adj-popup.js';
import { createHistoryPanel } from './editor/history-panel.js';
import { createTransformSession } from './editor/tools/transform-session.js';
import { wireCanvasEvents } from './editor/canvas-events.js';
import { buildRightPanel } from './editor/build/right-panel.js';
import { wireSliderUx } from './editor/slider-ux.js';
import { createShortcutsPopover } from './editor/shortcuts-popover.js';
import { wireKeyboardShortcuts } from './editor/keyboard-shortcuts.js';
import { wireClipboardAndDrop } from './editor/clipboard-and-drop.js';
import { wireAIModelSelectors } from './editor/ai-models.js';
import { wireInpaintButtons } from './editor/ai-inpaint.js';
import { wireAIToolsMisc } from './editor/ai-tools-misc.js';
import { wireRembgAndSharpen } from './editor/ai-rembg.js';
import { wireStrokeToolSliders } from './editor/stroke-tool-sliders.js';
import { wireImport } from './editor/wire-import.js';
import { wireMergeButtons } from './editor/wire-merge-buttons.js';
import { wireSelectionControls } from './editor/wire-selection-controls.js';
import { wireInpaintControls } from './editor/wire-inpaint-controls.js';
import { wireBrushPresets } from './editor/wire-brush-presets.js';
import { createGradientTool } from './editor/tools/gradient.js';
import { wireGradientControls } from './editor/wire-gradient-controls.js';
import { createMarqueeTool } from './editor/tools/marquee.js';
import { createLiquifyTool } from './editor/tools/liquify.js';
import { createSmudgeTool } from './editor/tools/smudge.js';
import { createMixerTool } from './editor/tools/mixer.js';
import { createHealTool } from './editor/tools/heal.js';
import { createDodgeBurnTool } from './editor/tools/dodgeburn.js';
import { createBucketTool } from './editor/tools/bucket.js';
import { createDistortTool } from './editor/tools/distort.js';
import { createPerspectiveCropTool } from './editor/tools/perspective-crop.js';
import { unwarpQuad as _unwarpQuad } from './editor/tools/warp-quad.js';
import { wireFilters } from './editor/wire-filters.js';
import { wireTopbar, closeOtherTopbarMenus as _closeOtherTopbarMenus } from './editor/wire-topbar.js';
import { wireTopbarOverflow } from './editor/wire-topbar-overflow.js';
import { wireTopbarMenus } from './editor/wire-topbar-menus.js';

const API_BASE = window.location.origin;
// ── State ──
// Transform-overlay canvas — sits over the main canvas with extra margin
// so resize / rotation handles render OUTSIDE the image edges. Pointer
// events disabled; the main canvas still handles all input.
const _TRANSFORM_OVERLAY_MARGIN = 60; // image-space px of slack on each side
// Thin wrappers around the transform-handles impls — the refactor
// imported them under *Impl aliases but several call sites still use
// the bare names. Without these, _startTransform threw a ReferenceError
// before opening the popup, so Transform showed no handles / no popup.
function _drawTransformHandles() { _drawTransformHandlesImpl(_TRANSFORM_OVERLAY_MARGIN); }
function _getTransformHandle(x, y) { return _getTransformHandleImpl(x, y); }
function _syncTransformOverlay() { _syncTransformOverlayImpl(_TRANSFORM_OVERLAY_MARGIN); }
// Inpaint uses a much bigger default brush — when the user enters
// the inpaint tool for the first time in this editor session we bump
// the slider to this value (without touching other tools).
const _INPAINT_DEFAULT_BRUSH = 100;

function _galleryEditMounted() {
  return !!document.querySelector('#gallery-editor-container .gallery-editor');
}

// Close handle for whichever editor-owned modal prompt is open (image-size,
// etc.) so the Escape hard guard below can dismiss it — the guard runs first
// (window capture) and otherwise swallows Escape before the prompt sees it.
let _activePromptClose = null;
// Animation controller + timeline panel — assigned during openEditor (they need
// container/createLayer/composite), referenced module-scope so composite() can
// draw the onion-skin overlay.
let _anim = null, _timeline = null;
// WebHID pen-pressure bridge (Windows-Ink-off pressure) — assigned in openEditor.
let _penHid = null;

if (!window.__galleryEditEscHardGuardInstalled) {
  window.__galleryEditEscHardGuardInstalled = true;
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (window.__galleryEditLive || _galleryEditMounted()) {
      // This guard runs first (window capture) and otherwise swallows Escape
      // entirely, so any Escape-dismissible editor affordance has to be handled
      // right here: cancel an in-progress polygonal lasso, or close the brush
      // quick-pick popup.
      if (_activePromptClose) { try { _activePromptClose(); } catch {} }
      else if (state.polyLassoActive) { try { _polyLassoTool.cancel(); } catch {} }
      else if (state.magLassoActive) { try { _magLassoTool.cancel(); } catch {} }
      else if (_brushQuickPick && _brushQuickPick.isOpen()) { try { _brushQuickPick.close(); } catch {} }
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
  }, true);
}

// Document-level click-away handlers for topbar dropdowns. Each
// openEditor invocation adds 6 of these (save / edge / image / filter /
// resize / more), and without removal they accumulated across reopens.
// Tracked here and removed wholesale in closeEditor.
function _registerDocClickAway(handler) {
  document.addEventListener('click', handler);
  state.editorDocClickHandlers.push(handler);
}

// Drawing state

// Move tool state
// Crop state
// Persistent mode toggle for wand clicks. 'replace' = a new click
// replaces the selection (default); 'add' = always union; 'subtract' =
// always remove from the existing selection. Shift / Alt held during a
// click still override this transiently.
// Last seed click so the tolerance slider can re-run the wand live.
// Stored in canvas coords (same units `_runMagicWand` accepts).
// Lasso state

// Transform state
// Snapshot of the layer's pixels at the moment the transform started.
// Lets the popup live-preview by re-applying from the original on every
// input change instead of stacking destructive edits.
// Current popup-driven values (re-applied on every change).

// Inpaint mask (separate canvas, same dimensions as image)
// Cached canvas reused each composite() to merge every visible mask
// sub-layer into a single tinted overlay (avoids re-allocating on each
// frame). Recreated lazily if dimensions change.
// Softer default than the original full-saturation red — the user
// found the previous tint distracting. Tweakable via the color picker
// under the Paint/Erase row.
// Persistent paint/erase toggle for the Inpaint brush. False = paint
// (default), true = erase. Ctrl+Alt held during a stroke flips this
// transiently for the duration of that one stroke.
// Resolved per-stroke at pointerdown: state.inpaintEraseMode XOR (Ctrl+Alt).
// Most-recent inpaint result layer id — the post-generation Feather
// slider edits this layer's alpha edge live.

// _dilateMask + _applyInpaintFeather live in editor/mask-utils.js
// — see import at top of file.

// Eraser settings
// Edge softness, 0..100. 0 = hard pixel edge; higher values blur the
// stroke's alpha so the eraser fades out at the brush perimeter.
// Brush settings (same shape as eraser).
// Clone Stamp brush modifiers — independent from the Brush tool's
// settings so users can dial in cloning without losing their brush
// preset (and vice-versa).
// `state.cloneSourceX/Y` is the sample anchor set by Alt-click. While
// painting, the source point moves in lockstep with the brush so the
// sampled offset stays constant ("aligned" clone mode).
// First brush coord of the current stroke — used to compute the
// running offset (`sample = source + (current - strokeStart)`).
// Snapshot of the source layer's pixels at stroke-start so we can keep
// sampling clean pixels even after the brush has painted over them
// (avoids feedback / smearing).
// Double-tap detection for the Clone tool on touch devices — sets the
// sample anchor without a keyboard Alt modifier.

// Undo/Redo
// History snapshots are tile-deduplicated (see tileFor/_histTiles): unchanged
// tiles are shared by reference across states, so memory scales with the unique
// tiles touched, not states × full canvas. That makes deep history cheap — keep
// a high cap so you can step back to the start of a normal session; only very
// long sessions hit the ceiling.
const MAX_HISTORY = 5000;

/** Get the selected AI endpoint+model. Returns { endpoint, model }.
 * Dropdown values are encoded as "<base_url>::<model_id>" so users can pick
 * a specific model on a multi-model endpoint (e.g. dall-e-2 vs gpt-image-1). */
function _getSelectedAIEndpoint(type) {
  let raw = '';
  if (type === 'inpaint') {
    raw = document.getElementById('ge-ai-inpaint')?.value || '';
  } else if (type) {
    // Per-tool dropdowns (harmonize/upscale/style). Each lives in its
    // own section's panel and is marked with data-ge-tool-model="<name>".
    const sel = document.querySelector(`select[data-ge-tool-model="${type}"]`);
    raw = sel?.value || '';
  }
  if (!raw) raw = document.getElementById('ge-ai-model')?.value || '';
  if (!raw) return { endpoint: '', model: '' };
  const idx = raw.indexOf('::');
  if (idx < 0) return { endpoint: raw, model: '' };
  return { endpoint: raw.slice(0, idx), model: raw.slice(idx + 2) };
}

/** Shared helper: flatten layers → POST to API → add result as new layer. */
// Maps a layer-name (the past-participle returned from each AI tool —
// "BG Removed", "Sharpened", etc.) into a present-progressive label for
// the busy button state ("Removing…", "Sharpening…"). Falls back to a
// neutral "Processing…" when the layer name doesn't match a known verb.
const _BUSY_LABELS = {
  'bg removed': 'Removing…',
  'sharpened': 'Sharpening…',
  'enhanced': 'Enhancing…',
  'harmonized': 'Harmonizing…',
  'upscaled': 'Upscaling…',
  'styled': 'Styling…',
};
function _deriveBusyLabel(layerName) {
  if (!layerName) return 'Processing…';
  return _BUSY_LABELS[String(layerName).toLowerCase()] || 'Processing…';
}

// AI-tool runner — sharpen / harmonize / upscale / style / bg-remove
// all flatten the doc, POST a PNG to a server endpoint, and drop the
// result back as a new layer. Full implementation in editor/ai-tool-
// runner.js; instantiated lazily (so it can reference function decls
// that haven't hoisted at module load time? — actually all named
// function decls hoist, so we instantiate at module top).
const _applyImageTool = createApplyImageTool({
  flatten: () => flatten(),
  saveState: _saveState,
  createLayer,
  composite,
  renderLayerPanel: () => _renderLayerPanel(),
  deriveBusyLabel: (name) => _deriveBusyLabel(name),
  getSelectedAIEndpoint: (type) => _getSelectedAIEndpoint(type),
  openCookbookForDependency: (pkg) => _openCookbookForDependency(pkg),
  openCookbookForImg2img: () => _openCookbookForImg2img(),
  spinnerModule,
  uiModule,
});

// Layer offsets for move tool

// ── Layer class ──


function createLayer(name, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const layer = {
    id: 'layer-' + (state.nextLayerId++),
    name,
    canvas,
    ctx: canvas.getContext('2d'),
    visible: true,
    opacity: 1,
    blendMode: 'source-over', // canvas globalCompositeOperation (see editor/blend-modes.js)
    clipped: false,           // clip to the layer below (PS Ctrl+Alt+G)
    lockAlpha: false,         // preserve transparency — paint existing pixels only (PS "/")
    locked: false,
    // Mask sub-layers — same shape as adjLayers, parallel concept.
    // Each entry: {id, name, canvas, visible}. The "active" mask is the
    // one that paint / lasso / inpaint operations target; rendered as a
    // red overlay in composite().
    masks: [],
    activeMaskId: null,
    // Non-destructive adjustments. B/C/S/H are applied at composite()
    // via ctx.filter (fast, CSS). Levels + Color Balance need per-pixel
    // math and are baked into a cached canvas (layer._adjCache) that
    // gets re-rendered only when those values change.
    adjustments: {
      brightness: 1, // 0..2 (1 = neutral)
      contrast: 1,   // 0..2 (1 = neutral)
      saturation: 1, // 0..2 (0 = grayscale, 1 = neutral)
      hue: 0,        // degrees, -180..180
      // Levels — three-stop (black/gamma/white) adjust applied per channel.
      // input 0..255, gamma 0.1..9.9. Default is identity.
      levels: { inBlack: 0, inWhite: 255, gamma: 1.0, outBlack: 0, outWhite: 255 },
      // Color Balance — additive per-channel shifts weighted by tone.
      // Each value is -100..+100 mapping to roughly ±60 in 0..255 space.
      colorBalance: {
        shadows:    { r: 0, g: 0, b: 0 },
        midtones:   { r: 0, g: 0, b: 0 },
        highlights: { r: 0, g: 0, b: 0 },
      },
    },
  };
  state.layerOffsets.set(layer.id, { x: 0, y: 0 });
  return layer;
}

// _layerFilterString + _fxFilterToSlider live in editor/fx/filter-string.js
// — see import at top.

// _layerHasAdjustments lives in editor/layer-helpers.js — see import at top.

// ── Mask sub-layers ──
// Resolves to the parent layer that should own masks for the current
// edit. The "active" parent is whichever layer the user has selected,
// excluding mask-sublayer entries themselves.
function _activeParentLayer() {
  return state.layers.find(l => l.id === state.activeLayerId) || state.layers[state.layers.length - 1] || null;
}

// Find the active mask sub-layer (the one paint/lasso/inpaint ops
// target). Returns null if the parent has no masks OR if no mask is
// currently activated (i.e. the user explicitly selected the parent
// pixels as the paint target). Earlier code fell back to "last mask
// in the list" which meant clicking the parent row couldn't escape
// mask-paint mode — that surprised the user, so the fallback is
// gone.
function _getActiveMaskLayer() {
  const parent = _activeParentLayer();
  if (!parent || !parent.masks || !parent.masks.length) return null;
  if (!parent.activeMaskId) return null;
  return parent.masks.find(m => m.id === parent.activeMaskId) || null;
}

// Get-or-create a mask sub-layer on the active parent. Used by tools
// that need a mask to write into (Brush on mask, Inpaint stroke,
// lasso→mask, wand→mask).
function _ensureActiveMaskLayer() {
  const parent = _activeParentLayer();
  if (!parent) return null;
  if (!parent.masks) parent.masks = [];
  let mask = _getActiveMaskLayer();
  if (mask) return mask;
  const c = document.createElement('canvas');
  c.width = state.imgWidth;
  c.height = state.imgHeight;
  mask = {
    id: 'mask-' + (state.nextLayerId++),
    name: 'Mask ' + (parent.masks.length + 1),
    canvas: c,
    ctx: c.getContext('2d'),
    visible: true,
  };
  parent.masks.push(mask);
  parent.activeMaskId = mask.id;
  return mask;
}

// True if any visible layer in the doc carries a mask sub-layer; drives
// the "red overlay" pass in composite().
function _hasAnyMasks() {
  for (const l of state.layers) {
    if (l.masks && l.masks.length) return true;
  }
  return false;
}

// Union of every VISIBLE mask sub-layer across the whole document,
// returned as a fresh image-sized canvas with white = masked area.
// Used by inpaint Generate/Remove so the AI sees the combined region
// instead of just the active mask. Returns null when no masks exist
// (caller should fall back to the active mask plumbing in that case).
function _buildMergedMaskCanvas() {
  return _buildMergedMaskCanvasImpl(state.layers, state.imgWidth, state.imgHeight);
}

// True if the layer needs the (slower) per-pixel LUT pass — i.e. Levels
// or Color Balance are non-identity. Brightness/Contrast/Saturation/Hue
// alone can stay on the fast CSS-filter path.
// _layerNeedsPixelPass + _adjustmentsKey live in editor/layer-helpers.js.

// Per-pixel Levels + Color Balance. Renders the layer.canvas into a
// cached canvas (layer._adjCache) with the LUT-style transforms applied.
// CSS-filter adjustments (B/C/S/H) are still applied at composite() on
// top of this cache.
// Pixel-pass adjustment math lives in editor/fx/pixel-pass.js. This
// wrapper forwards the layer + a fresh adjustments-cache key so
// existing callers stay unchanged.
function _renderLayerPixelAdjustments(layer) {
  return _renderLayerPixelAdjustmentsImpl(layer, _adjustmentsKey(layer.adjustments));
}
// Layer FX popup — floating window bound to a specific layer. Sliders
// edit that layer's adjustments and live-update composite(). The popup
// stays open across clicks elsewhere unless dismissed via its × button.

// FX / adjustment-popup machinery — full implementation in
// editor/fx/adj-popup.js. Wrappers preserve the legacy names that
// every layer-row FX button, panel-row click, and undo/redo path
// already references.
const _adjPopupSystem = createAdjPopupSystem({
  composite,
  saveState: _saveState,
  renderLayerPanel: () => _renderLayerPanel(),
});
const _closeFxPopup                     = _adjPopupSystem.closeFxPopup;
const _ensureAdjustments                = _adjPopupSystem.ensureAdjustments;
const _ensureFxDock                     = _adjPopupSystem.ensureFxDock;
const _closeFxMenu                      = _adjPopupSystem.closeFxMenu;
const _openFxPopup                      = _adjPopupSystem.openFxPopup;
const _openAdjPopup                     = _adjPopupSystem.openAdjPopup;
const _editAdjLayer                     = _adjPopupSystem.editAdjLayer;
const _closeAdjPopup                    = _adjPopupSystem.closeAdjPopup;
const _minimiseAdjPopup                 = _adjPopupSystem.minimiseAdjPopup;
const _syncFxPanelToActiveLayerIfPresent = _adjPopupSystem.syncFxPanelToActiveLayerIfPresent;

function activeLayer() {
  const l = state.layers.find(l => l.id === state.activeLayerId) || null;
  // Group (folder) entries carry no pixels, so they're never a valid paint /
  // adjust target — treat a selected group as "no active layer" so every
  // pixel op safely no-ops rather than dereferencing a missing canvas.
  return (l && l.isGroup) ? null : l;
}

// Flood-fill enclosed regions of the inpaint mask. After the user
// draws a closed shape (circle, lasso, whatever), the interior is
// alpha=0 surrounded by white mask. We mark all alpha=0 pixels
// reachable from the canvas edges as "outside"; anything still alpha=0
// after that pass is enclosed and gets filled with white.
function _fillEnclosedMaskRegions() {
  if (!state.maskCanvas || !state.maskCtx) return;
  const w = state.maskCanvas.width, h = state.maskCanvas.height;
  if (w * h > 4096 * 4096) return; // safety cap
  const img = state.maskCtx.getImageData(0, 0, w, h);
  const d = img.data;
  // visited bitmap — 0 = unvisited, 1 = reached from edge (outside),
  // 2 = mask (alpha>0). After BFS, alpha=0 pixels with visited[i]=0
  // are enclosed.
  const visited = new Uint8Array(w * h);
  const stack = [];
  // Pre-mark all mask pixels as visited=2 so we don't cross them.
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    if (d[i + 3] > 0) visited[j] = 2;
  }
  // Seed flood from every edge pixel that's empty.
  const seed = (x, y) => {
    const k = y * w + x;
    if (visited[k] === 0) { visited[k] = 1; stack.push(k); }
  };
  for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
  for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
  // BFS — 4-connected.
  while (stack.length) {
    const k = stack.pop();
    const x = k % w, y = (k - x) / w;
    if (x > 0)     { const n = k - 1; if (visited[n] === 0) { visited[n] = 1; stack.push(n); } }
    if (x < w - 1) { const n = k + 1; if (visited[n] === 0) { visited[n] = 1; stack.push(n); } }
    if (y > 0)     { const n = k - w; if (visited[n] === 0) { visited[n] = 1; stack.push(n); } }
    if (y < h - 1) { const n = k + w; if (visited[n] === 0) { visited[n] = 1; stack.push(n); } }
  }
  // Anything still visited=0 → enclosed empty region. Fill white.
  let filled = false;
  for (let j = 0, i = 0; j < visited.length; j++, i += 4) {
    if (visited[j] === 0) {
      d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255;
      filled = true;
    }
  }
  if (filled) state.maskCtx.putImageData(img, 0, 0);
}

// True if a layer has no opaque pixels — used to tag the row in the
// layer panel as "(empty)" so the user can tell at a glance which
// layers carry actual content.
// Lightweight loading overlay anchored to the canvas area. Used for
// blocking operations (rotation on big images, etc.) so the user gets
// feedback while the main thread is busy. The actual heavy call should
// be deferred with rAF so the overlay paints before the block.
function _showCanvasLoading(message) {
  if (!state.container) return;
  let overlay = state.container.querySelector('.ge-canvas-loading');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'ge-canvas-loading ge-frosted';
    overlay.innerHTML = `
      <div class="ge-canvas-loading-spinner"></div>
      <div class="ge-canvas-loading-msg"></div>
    `;
    state.container.appendChild(overlay);
  }
  overlay.querySelector('.ge-canvas-loading-msg').textContent = message || 'Working…';
  overlay.style.display = '';
}
function _hideCanvasLoading() {
  const overlay = state.container && state.container.querySelector('.ge-canvas-loading');
  if (overlay) overlay.style.display = 'none';
}

// Cheap "is this mask canvas blank?" check. Used to suffix "(empty)" on
// mask sub-layer rows in the panel so the user can tell at a glance
// which masks have actually been painted on.
// _isMaskCanvasEmpty lives in editor/layer-helpers.js.

// Document-wide rotate / flip — implementations in
// editor/canvas-transforms.js. Wrappers preserve the legacy names that
// the topbar Image menu and shortcuts already wire to.
const _canvasTransforms = createCanvasTransforms({
  saveState: _saveState,
  composite,
  fitZoom: () => _fitZoom(),
  showCanvasLoading: (label) => _showCanvasLoading(label),
  hideCanvasLoading: () => _hideCanvasLoading(),
});
function _rotateAllLayers(deg) { return _canvasTransforms.rotateAll(deg); }
function _flipAllLayers(axis)  { return _canvasTransforms.flipAll(axis); }

// _isLayerEmpty lives in editor/layer-helpers.js.

// ── Composite ──

// Composite a layer that uses a non-native (custom) blend mode. Reads the
// backdrop already painted below it, blends per-pixel via blend-modes.js, and
// writes the result back. Operates only over the layer's on-canvas rectangle.
function _compositeCustomBlend(source, off, opacity, mode, ctx, canvas) {
  ctx = ctx || state.mainCtx; canvas = canvas || state.mainCanvas;
  const cw = canvas.width, ch = canvas.height;
  const x0 = Math.max(0, Math.floor(off.x));
  const y0 = Math.max(0, Math.floor(off.y));
  const x1 = Math.min(cw, Math.floor(off.x + source.width));
  const y1 = Math.min(ch, Math.floor(off.y + source.height));
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return;
  const back = ctx.getImageData(x0, y0, w, h);
  // Rasterize the source into a rect-sized buffer aligned to the backdrop.
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const tctx = tmp.getContext('2d');
  tctx.drawImage(source, off.x - x0, off.y - y0);
  const src = tctx.getImageData(0, 0, w, h);
  _blendInto(mode, back.data, src.data, opacity == null ? 1 : opacity);
  ctx.putImageData(back, x0, y0);
}

// Apply a PS-style raster layer mask: returns a NEW canvas = `source` with its
// alpha intersected by the mask's alpha coverage (white/opaque mask = visible,
// transparent = hidden). The mask is layer-local (same size as the layer canvas)
// and stored on `layer.layerMask`, kept DISTINCT from the inpaint-region
// `layer.masks`. Non-destructive — the layer's own pixels are never altered.
function _applyLayerMask(source, mask) {
  const c = document.createElement('canvas');
  c.width = source.width; c.height = source.height;
  const mc = c.getContext('2d');
  mc.drawImage(source, 0, 0);
  mc.globalCompositeOperation = 'destination-in';
  mc.drawImage(mask, 0, 0);
  mc.globalCompositeOperation = 'source-over';
  return c;
}

// Add a PS visibility mask to the active layer (Reveal All = opaque white) and
// enter mask-edit mode; if one exists, toggle editing the mask vs the pixels.
function _toggleLayerMask() {
  const layer = activeLayer();
  if (!layer) return;
  if (!layer.layerMask) {
    const m = document.createElement('canvas');
    m.width = layer.canvas.width; m.height = layer.canvas.height;
    const mc = m.getContext('2d');
    mc.fillStyle = '#fff'; mc.fillRect(0, 0, m.width, m.height); // Reveal All
    _saveState('Add layer mask');
    layer.layerMask = m;
    state.layerMaskEdit = true;
  } else {
    state.layerMaskEdit = !state.layerMaskEdit;
  }
  _syncLayerMaskBtn();
  composite();
}
function _deleteLayerMask() {
  const layer = activeLayer();
  if (!layer || !layer.layerMask) return;
  _saveState('Delete layer mask');
  layer.layerMask = null;
  state.layerMaskEdit = false;
  _syncLayerMaskBtn();
  composite();
}
// Reflect mask-edit state on the header button (active = currently painting the mask).
function _syncLayerMaskBtn() {
  const btn = document.getElementById('ge-layer-mask');
  if (!btn) return;
  const layer = activeLayer();
  const has = !!(layer && layer.layerMask);
  const editing = !!(state.layerMaskEdit && has);
  btn.classList.toggle('active', editing);
  btn.title = editing ? 'Editing layer mask — click to edit pixels (right-click: delete mask)'
    : has ? 'Edit layer mask (right-click: delete)'
    : 'Add layer mask (paint to reveal, erase to hide)';
}

// Blending Options popup — toggle + tune the active layer's effects. Effects are
// applied live at composite via _applyLayerFx; no caching, so just re-composite
// on change. (Persistence of layer.fx across undo/save is a tracked follow-up.)
function _openFxMenu() {
  document.getElementById('ge-fx-popup')?.remove();
  const layer = activeLayer();
  if (!layer) return;
  if (!layer.fx) layer.fx = {};
  const fx = layer.fx;
  const defaults = {
    stroke: { enabled: false, size: 3, color: '#000000' },
    dropShadow: { enabled: false, dx: 5, dy: 5, blur: 6, color: '#000000', opacity: 0.6 },
    glow: { enabled: false, blur: 8, color: '#ffd24d', opacity: 0.75 },
    colorOverlay: { enabled: false, color: '#ff3030', opacity: 0.5 },
  };
  for (const k in defaults) if (!fx[k]) fx[k] = { ...defaults[k] };
  const pop = document.createElement('div');
  pop.id = 'ge-fx-popup';
  pop.style.cssText = 'position:fixed;z-index:200;right:18px;top:84px;background:#2a2a2e;border:1px solid rgba(255,255,255,0.16);border-radius:8px;padding:10px 12px;box-shadow:0 12px 32px rgba(0,0,0,0.55);font-size:12px;color:#eee;min-width:236px;';
  const row = (key, label, extra) => `<label style="display:flex;align-items:center;gap:6px;margin:5px 0;cursor:pointer;">
      <input type="checkbox" data-fx="${key}" ${fx[key].enabled ? 'checked' : ''}><span>${label}</span>
      <span style="margin-left:auto;display:flex;align-items:center;gap:6px;">${extra}</span></label>`;
  pop.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
      <strong>Blending Options</strong>
      <button id="ge-fx-close" style="background:none;border:none;color:#aaa;cursor:pointer;font-size:14px;line-height:1;">✕</button>
    </div>
    ${row('stroke', 'Stroke', `<input type="number" data-fxp="stroke.size" value="${fx.stroke.size}" min="1" max="50" style="width:44px;"><input type="color" data-fxp="stroke.color" value="${fx.stroke.color}">`)}
    ${row('dropShadow', 'Drop Shadow', `<input type="color" data-fxp="dropShadow.color" value="${fx.dropShadow.color}">`)}
    ${row('glow', 'Outer Glow', `<input type="color" data-fxp="glow.color" value="${fx.glow.color}">`)}
    ${row('colorOverlay', 'Color Overlay', `<input type="color" data-fxp="colorOverlay.color" value="${fx.colorOverlay.color}">`)}
    <p style="font-size:10px;opacity:0.5;margin:6px 0 0;">Non-destructive effects on the active layer. Defaults are sensible; tweak colours/size here.</p>`;
  document.body.appendChild(pop);
  pop.querySelector('#ge-fx-close').addEventListener('click', () => pop.remove());
  pop.querySelectorAll('[data-fx]').forEach((cb) => cb.addEventListener('change', () => {
    fx[cb.dataset.fx].enabled = cb.checked; composite();
  }));
  pop.querySelectorAll('[data-fxp]').forEach((inp) => inp.addEventListener('input', () => {
    const [k, prop] = inp.dataset.fxp.split('.');
    fx[k][prop] = inp.type === 'number' ? (parseFloat(inp.value) || 0) : inp.value;
    composite();
  }));
}

// A silhouette of `src` (its alpha) flat-filled with `color`.
function _fxSilhouette(src, color) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const x = c.getContext('2d');
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}
// An OUTER stroke ring around `src`'s alpha: dilate the silhouette by `size`
// (stamp it around concentric rings) then knock out the original shape.
function _fxOuterStroke(src, size, color) {
  const sil = _fxSilhouette(src, color);
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const x = c.getContext('2d');
  const steps = Math.max(8, Math.round(size * 4));
  for (let r = 1; r <= size; r++) {
    for (let a = 0; a < steps; a++) {
      const t = (a / steps) * Math.PI * 2;
      x.drawImage(sil, Math.cos(t) * r, Math.sin(t) * r);
    }
  }
  x.globalCompositeOperation = 'destination-out';
  x.drawImage(src, 0, 0); // keep only the ring outside the original alpha
  return c;
}
// Non-destructive layer effects (PS "Blending Options"): drop shadow + outer
// glow behind the layer, outer stroke around it, colour overlay on top. Returns
// a NEW canvas; the layer's own pixels are never modified. No-op (returns the
// source) when no effect is enabled.
function _applyLayerFx(source, fx) {
  if (!fx) return source;
  const ds = fx.dropShadow, gl = fx.glow, st = fx.stroke, co = fx.colorOverlay;
  if (!(ds && ds.enabled) && !(gl && gl.enabled) && !(st && st.enabled) && !(co && co.enabled)) return source;
  const w = source.width, h = source.height;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d');
  if (ds && ds.enabled) {
    const sil = _fxSilhouette(source, ds.color || '#000000');
    ctx.save();
    ctx.globalAlpha = ds.opacity == null ? 0.6 : ds.opacity;
    ctx.filter = `blur(${ds.blur == null ? 6 : ds.blur}px)`;
    ctx.drawImage(sil, ds.dx == null ? 5 : ds.dx, ds.dy == null ? 5 : ds.dy);
    ctx.restore();
  }
  if (gl && gl.enabled) {
    const sil = _fxSilhouette(source, gl.color || '#ffd24d');
    ctx.save();
    ctx.globalAlpha = gl.opacity == null ? 0.75 : gl.opacity;
    ctx.filter = `blur(${gl.blur == null ? 8 : gl.blur}px)`;
    ctx.drawImage(sil, 0, 0); ctx.drawImage(sil, 0, 0); // double for intensity
    ctx.restore();
  }
  if (st && st.enabled) {
    ctx.drawImage(_fxOuterStroke(source, Math.max(1, st.size || 3), st.color || '#000000'), 0, 0);
  }
  ctx.drawImage(source, 0, 0);
  if (co && co.enabled) {
    ctx.save();
    ctx.globalAlpha = co.opacity == null ? 1 : co.opacity;
    ctx.globalCompositeOperation = 'source-atop'; // clip overlay to the layer's pixels
    ctx.fillStyle = co.color || '#ff0000';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  return out;
}

// Draw all visible layers (honouring opacity, blend mode, clipping masks, raster
// layer masks, and layer effects) onto an arbitrary target ctx/canvas. Shared by
// composite() (main canvas) and Stamp Visible. No checkerboard / overlays.
function _renderLayersTo(ctx, canvas) {
  const drawWithMode = (src, o, opacity, mode) => {
    if (_isCustomBlend(mode)) {
      _compositeCustomBlend(src, o, opacity, mode, ctx, canvas);
    } else {
      ctx.globalAlpha = opacity;
      ctx.globalCompositeOperation = mode;
      ctx.drawImage(src, o.x, o.y);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  };
  // Layer groups (Pass-Through): group entries (isGroup) carry no pixels; their
  // members reference them via groupId and inherit the group's visibility +
  // opacity. Flat model so existing ordering/compositing is unchanged for
  // ungrouped layers.
  const groups = {};
  for (const l of state.layers) if (l.isGroup) groups[l.id] = l;
  let clipBase = null;
  for (const layer of state.layers) {
    if (layer.isGroup) continue; // groups have no pixels of their own
    if (!layer.visible) continue;
    let grpMul = 1;
    if (layer.groupId && groups[layer.groupId]) {
      const g = groups[layer.groupId];
      if (!g.visible) continue;                 // group hidden → skip member
      grpMul = (g.opacity == null ? 1 : g.opacity);
    }
    const mode = layer.blendMode || 'source-over';
    const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
    let source = _renderLayerWithAdjLayers(layer);
    if (layer.layerMask) source = _applyLayerMask(source, layer.layerMask);
    if (layer.fx) source = _applyLayerFx(source, layer.fx);
    if (layer.clipped && clipBase) {
      const tmp = document.createElement('canvas');
      tmp.width = canvas.width; tmp.height = canvas.height;
      const tctx = tmp.getContext('2d');
      tctx.drawImage(source, off.x, off.y);
      tctx.globalCompositeOperation = 'destination-in';
      tctx.drawImage(clipBase.source, clipBase.off.x, clipBase.off.y);
      tctx.globalCompositeOperation = 'source-over';
      drawWithMode(tmp, { x: 0, y: 0 }, layer.opacity * grpMul, mode);
    } else {
      drawWithMode(source, off, layer.opacity * grpMul, mode);
      clipBase = { source, off };
    }
  }
}

// Whether composite() may take the cheap dirty-rect path. Only when nothing
// needs a GLOBAL redraw: no view-wide overlays/proofs, no per-pixel (custom)
// blend mode (its getImageData passes ignore the clip), and the layer being
// painted has no fx / mask that would spread the change beyond the dab. Any
// false → fall back to the full redraw so output stays pixel-identical.
function _canDirtyComposite() {
  if (state.cmykProof || state.maskVisible) return false;
  if (state.transformActive || state.pcropActive) return false;
  if (state.cropRect || state.cropping) return false;
  if (state.lassoPoints && state.lassoPoints.length) return false;
  if (state.wandMask) return false;
  if (state.showGrid) return false;
  if (state.guidesVisible && state.guides && state.guides.length) return false;
  if (state.activeSnapGuides && state.activeSnapGuides.length) return false;
  if (state.brushSymmetry && state.brushSymmetry !== 'none') return false;
  if (state.brushScatter > 0) return false;
  const a = state.layers.find(l => l.id === state.activeLayerId);
  if (a && (a.fx || a.layerMask)) return false;
  for (const l of state.layers) {
    if (l.isGroup) continue;
    if (_isCustomBlend(l.blendMode || 'source-over')) return false;
  }
  return true;
}

// composite(dirty?) — `dirty` (an image-space {x,y,w,h}, e.g. a brush dab's
// bounding box) enables the dirty-rect fast path. View zoom/pan/rotate is a CSS
// transform on the canvas element, so composite() always renders the document
// 1:1 in image space — the clip below is exact. Unchanged areas keep their last
// valid composite; only the dab rect is re-rendered.
function composite(dirty) {
  if (!state.mainCtx) return;
  // Animation mode needs a full repaint each time so the onion-skin overlay
  // (and per-frame cel visibility) always redraw — skip the dirty-rect path.
  if (state.anim && state.anim.enabled) dirty = null;
  const W = state.mainCanvas.width, H = state.mainCanvas.height;
  if (dirty && _canDirtyComposite()) {
    const ctx = state.mainCtx;
    const x = Math.max(0, Math.floor(dirty.x));
    const y = Math.max(0, Math.floor(dirty.y));
    const r = Math.min(W, Math.ceil(dirty.x + dirty.w));
    const bt = Math.min(H, Math.ceil(dirty.y + dirty.h));
    const w = r - x, h = bt - y;
    if (w > 0 && h > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.clearRect(x, y, w, h);
      _drawCheckerboard(ctx, W, H);
      _renderLayersTo(ctx, state.mainCanvas);
      ctx.restore();
      try { window.dispatchEvent(new Event('ge:composited')); } catch {}
      return;
    }
  }
  state.mainCtx.clearRect(0, 0, state.mainCanvas.width, state.mainCanvas.height);
  // Checkerboard background
  _drawCheckerboard(state.mainCtx, state.mainCanvas.width, state.mainCanvas.height);
  _renderLayersTo(state.mainCtx, state.mainCanvas);
  // Animation onion skin (light table) — faint tinted neighbour cels over the
  // rendered frame, under the UI overlays below.
  if (state.anim && state.anim.enabled && _anim) _anim.drawOnion();
  // CMYK soft-proof — a view-only pass over the composited image (BEFORE the UI
  // overlays below, so handles / marching-ants / mask tint stay un-proofed).
  // Never touches layer pixels or exports (flatten() rebuilds from layers).
  if (state.cmykProof) applyCmykProof(state.mainCtx, state.mainCanvas);
  // Show mask overlay as red tint whenever a mask sub-layer is present
  // on the active parent (was previously gated on inpaint-tool only; now
  // masks are first-class layer entities, so users see them in any tool).
  // Mask canvas has white pixels — we tint them red for visibility.
  if (state.maskVisible) {
    // Build a SINGLE merged mask canvas from every visible mask
    // sub-layer (union of alpha — `lighter` keeps max alpha per pixel,
    // so overlapping strokes don't visually stack). Then tint it red
    // once and composite at the configured opacity. Result: the user
    // sees a flat, consistent translucent red over the masked area
    // regardless of how many strokes / masks contributed to it. Mask
    // visibility is INDEPENDENT of parent visibility — hiding the
    // parent layer doesn't hide its masks.
    let _haveAny = false;
    if (!state.compositeMaskUnion) state.compositeMaskUnion = document.createElement('canvas');
    const union = state.compositeMaskUnion;
    union.width = state.mainCanvas.width;
    union.height = state.mainCanvas.height;
    const uctx = union.getContext('2d');
    uctx.clearRect(0, 0, union.width, union.height);
    uctx.globalCompositeOperation = 'lighter';
    for (const ly of state.layers) {
      if (!ly.masks || !ly.masks.length) continue;
      for (const mk of ly.masks) {
        if (!mk.visible) continue;
        if (!mk.canvas || !mk.canvas.width || !mk.canvas.height) continue;
        uctx.drawImage(mk.canvas, 0, 0);
        _haveAny = true;
      }
    }
    uctx.globalCompositeOperation = 'source-over';
    if (_haveAny) {
      // Tint the merged mask in-place: anywhere alpha exists becomes
      // red; everywhere else stays transparent.
      uctx.globalCompositeOperation = 'source-in';
      uctx.fillStyle = state.maskTintColor || 'rgba(255, 50, 50, 1)';
      uctx.fillRect(0, 0, union.width, union.height);
      uctx.globalCompositeOperation = 'source-over';
      state.mainCtx.globalAlpha = state.maskTintOpacity;
      state.mainCtx.drawImage(union, 0, 0);
      state.mainCtx.globalAlpha = 1;
    }
  }
  // Draw transform handles if active
  if (state.transformActive) _drawTransformHandles();
  else if (state.transformOverlay) state.transformOverlay.style.display = 'none';
  // Persist the lasso selection overlay across composite redraws — without
  // this, leaving/re-entering the canvas (which triggers _endDraw →
  // composite) would visually wipe a completed selection even though
  // state.lassoPoints is still populated.
  if (!state.lassoActive && state.lassoPoints.length >= 3) _drawLassoOverlay();
  // Same idea for the crop overlay — once the user releases the drag,
  // the crop rect should remain visible until they Apply or cancel.
  // Hovering over the floating Apply button counts as a mouseleave on
  // the canvas, which used to wipe the overlay.
  if (state.cropRect && !state.cropping) _drawCropOverlay();
  // Grid + user guides (layout aids) — above the image, below selection overlays.
  _drawGridAndGuides();
  if (state.pcropActive) _drawPcropOverlay();
  // Snap guides — drawn while the user is moving a layer with Ctrl held.
  if (state.activeSnapGuides && state.activeSnapGuides.length) _drawSnapGuides();
  // Magic-wand selection overlay (translucent red tint of the mask).
  if (state.wandMask && state.wandLayerId && state.wandMaskVisible) _drawWandOverlay();
  // Keep the per-tool clear-X badges in sync. Cheap: two classList
  // toggles. Composite runs on every visible state change, so this
  // catches every lasso/wand mutation site without each one having to
  // remember to call the sync helper.
  _syncToolClearIndicators();
  _syncLayerMaskBtn();
  if (_selectionActive()) _ensureAntsLoop(); // keep the marching-ants animation alive
  // Lightweight "frame rendered" hook — read-only panels (e.g. the histogram)
  // listen and refresh themselves, rAF-coalesced, only when visible.
  try { window.dispatchEvent(new Event('ge:composited')); } catch {}
}

// Perspective-crop overlay: dim outside the marked quad + draw its outline.
function _drawPcropOverlay() {
  const ctx = state.mainCtx, p = state.pcropCorners;
  if (!ctx || !p) return;
  const z = state.zoom || 1;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.rect(0, 0, state.mainCanvas.width, state.mainCanvas.height);
  ctx.moveTo(p[0].x, p[0].y); ctx.lineTo(p[1].x, p[1].y); ctx.lineTo(p[2].x, p[2].y); ctx.lineTo(p[3].x, p[3].y); ctx.closePath();
  ctx.fill('evenodd'); // dims everything except the quad
  ctx.strokeStyle = '#4af'; ctx.lineWidth = 1.5 / z;
  ctx.beginPath();
  ctx.moveTo(p[0].x, p[0].y); ctx.lineTo(p[1].x, p[1].y); ctx.lineTo(p[2].x, p[2].y); ctx.lineTo(p[3].x, p[3].y); ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

// Render the grid + user guides as a view overlay (display-only).
function _drawGridAndGuides() {
  const ctx = state.mainCtx;
  if (!ctx) return;
  const w = state.mainCanvas.width, h = state.mainCanvas.height, z = state.zoom || 1;
  if (state.showGrid && state.gridSize > 0) {
    const gs = state.gridSize;
    ctx.save();
    ctx.strokeStyle = 'rgba(120,140,200,0.28)';
    ctx.lineWidth = 1 / z;
    ctx.beginPath();
    for (let x = gs; x < w; x += gs) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = gs; y < h; y += gs) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    ctx.restore();
  }
  if (state.guidesVisible && state.guides && state.guides.length) {
    ctx.save();
    ctx.strokeStyle = 'rgba(0,180,255,0.9)';
    ctx.lineWidth = 1 / z;
    for (const g of state.guides) {
      ctx.beginPath();
      if (g.axis === 'v') { ctx.moveTo(g.pos, 0); ctx.lineTo(g.pos, h); }
      else { ctx.moveTo(0, g.pos); ctx.lineTo(w, g.pos); }
      ctx.stroke();
    }
    ctx.restore();
  }
}
function _addGuide(axis) {
  state.guides = state.guides || [];
  state.guides.push({ axis, pos: axis === 'v' ? Math.round(state.imgWidth / 2) : Math.round(state.imgHeight / 2) });
  state.guidesVisible = true;
  composite();
}
function _clearGuides() { state.guides = []; composite(); }

function _drawSnapGuides() {
  const ctx = state.mainCtx;
  ctx.save();
  ctx.strokeStyle = 'rgba(224, 108, 117, 0.85)';
  ctx.lineWidth = 1 / state.zoom;
  ctx.setLineDash([4 / state.zoom, 3 / state.zoom]);
  for (const g of state.activeSnapGuides) {
    ctx.beginPath();
    if (g.vertical) {
      ctx.moveTo(g.x, 0);
      ctx.lineTo(g.x, state.imgHeight);
    } else {
      ctx.moveTo(0, g.y);
      ctx.lineTo(state.imgWidth, g.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// Draw the dim-everything-else + cleared-crop-window overlay for the
// current `state.cropRect`. Shared by _continueCrop (live preview during drag)
// and composite() (re-draw after canvas redraws while the crop is held).
function _drawCropOverlay() {
  if (!state.cropRect || !state.mainCtx || !state.mainCanvas) return;
  const { x, y, w, h } = state.cropRect;
  state.mainCtx.fillStyle = 'rgba(0,0,0,0.4)';
  state.mainCtx.fillRect(0, 0, state.mainCanvas.width, state.mainCanvas.height);
  state.mainCtx.clearRect(x, y, w, h);
  state.mainCtx.save();
  state.mainCtx.beginPath();
  state.mainCtx.rect(x, y, w, h);
  state.mainCtx.clip();
  _drawCheckerboard(state.mainCtx, state.mainCanvas.width, state.mainCanvas.height);
  for (const layer of state.layers) {
    if (!layer.visible) continue;
    state.mainCtx.globalAlpha = layer.opacity;
    const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
    state.mainCtx.drawImage(layer.canvas, off.x, off.y);
  }
  state.mainCtx.globalAlpha = 1;
  state.mainCtx.restore();
  state.mainCtx.strokeStyle = '#fff';
  state.mainCtx.lineWidth = 1;
  state.mainCtx.setLineDash([4, 4]);
  state.mainCtx.strokeRect(x, y, w, h);
  state.mainCtx.setLineDash([]);
}

// _drawCheckerboard lives in editor/checkerboard.js — see import at top.

// ── History ──

function _snapshotState() {
  let wand = null;
  if (state.wandMask) {
    try {
      const wctx = state.wandMask.getContext('2d');
      wand = {
        layerId: state.wandLayerId,
        w: state.wandMask.width,
        h: state.wandMask.height,
        imageData: wctx.getImageData(0, 0, state.wandMask.width, state.wandMask.height),
        seed: state.wandLastSeed ? { ...state.wandLastSeed } : null,
      };
    } catch {}
  }
  // Tile-based copy-on-write history (PS-style): each layer/mask's pixels are
  // captured as a grid of tiles, sharing byte-identical tiles with the previous
  // capture so a localized edit costs only its changed tiles. `_histTiles`
  // (id → prior tiled entry) is the dedup source; we rebuild it fresh here so
  // deleted surfaces drop out automatically, then swap it in at the end.
  const prevHist = state._histTiles || new Map();
  const newHist = new Map();
  const tileFor = (id, ctx, w, h) => {
    if (!(w > 0 && h > 0)) return null;
    try {
      const entry = _tileize(ctx.getImageData(0, 0, w, h), prevHist.get(id));
      newHist.set(id, entry);
      return entry;
    } catch (_) { return null; }
  };
  const snap = {
    imgWidth: state.imgWidth,
    imgHeight: state.imgHeight,
    wand,
    layers: state.layers.map(l => {
      // Group (folder) entries hold no pixels — snapshot just their metadata.
      if (l.isGroup) {
        return { id: l.id, name: l.name, visible: l.visible, opacity: l.opacity,
                 locked: !!l.locked, isGroup: true, collapsed: !!l.collapsed };
      }
      const tiles = tileFor(l.id, l.ctx, l.canvas.width, l.canvas.height);
      return {
        id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, locked: l.locked,
        canvasW: l.canvas.width,
        canvasH: l.canvas.height,
        tiles,
        offset: { ...(state.layerOffsets.get(l.id) || { x: 0, y: 0 }) },
        // Deep-clone defensively — a non-serializable / circular value here
        // would throw out of the whole snapshot (and historically aborted
        // every mutating op). Fall back to [] rather than blow up.
        adjLayers: (() => {
          try { return l.adjLayers ? JSON.parse(JSON.stringify(l.adjLayers)) : []; }
          catch (e) { console.error('[gallery] adjLayers not serializable, dropping from snapshot:', e); return []; }
        })(),
        masks: (l.masks || []).map(m => ({
          id: m.id,
          name: m.name,
          visible: m.visible !== false,
          canvasW: m.canvas.width,
          canvasH: m.canvas.height,
          tiles: tileFor(m.id, m.ctx, m.canvas.width, m.canvas.height),
        })),
        activeMaskId: l.activeMaskId || null,
        isBase: !!l.isBase,
        groupId: l.groupId || null,
        // Smart Object metadata — snapshots are in-memory, so we carry the
        // pristine source by REFERENCE (cheap; convert/rasterize replace it).
        isSmart: !!l.isSmart,
        smartXf: l.isSmart && l.smartXf ? { ...l.smartXf } : null,
        sourceCanvas: l.isSmart ? (l.sourceCanvas || null) : null,
        linked: l.linked || null,
      };
    }),
  };
  state._histTiles = newHist; // dedup source for the NEXT capture
  return snap;
}

function _saveState(label) {
  // saveState() runs FIRST in every mutating op (import, paste, copy,
  // merge, mask, delete, brush, …). If anything here throws, the whole
  // operation aborts before its real work runs — which silently breaks
  // import ("no layer created") and every layer button. So each step is
  // isolated: a history-snapshot failure must degrade (lose one undo
  // step) rather than kill the user's action.
  try {
    const snap = _snapshotState();
    snap._label = label || 'Edit';
    snap._ts = Date.now();
    state.undoStack.push(snap);
    if (state.undoStack.length > MAX_HISTORY) state.undoStack.shift();
    state.redoStack = [];
  } catch (e) {
    console.error('[gallery] saveState snapshot failed (continuing without this undo step):', e);
  }
  try { _invalidateWandCache(); } catch (e) { console.error('[gallery] invalidateWandCache:', e); }
  try { _schedulePersist(); } catch (e) { console.error('[gallery] schedulePersist:', e); }
  try { _refreshHistoryPanelIfOpen(); } catch (e) { console.error('[gallery] refreshHistoryPanel:', e); }
}

// ────────── Persistent edit drafts (server-backed) ──────────
// The previous implementation keyed drafts by gallery image-id in
// localStorage; that meant blank-canvas sessions silently lost work and
// drafts couldn't roam between devices. We now hold a server-side draft
// row identified by a uuid (`state.draftId`) and PUT updates to it on a
// debounced timer. `state.imageId` (gallery id) is still tracked separately
// for "save back to the original photo" behaviour.
const PERSIST_DEBOUNCE_MS = 800;
const THUMB_MAX = 160;

function _schedulePersist() {
  if (!state.editorOpen || !state.layers.length) return;
  if (state.persistTimer) clearTimeout(state.persistTimer);
  state.persistTimer = setTimeout(() => { state.persistTimer = null; _persistDraft(); }, PERSIST_DEBOUNCE_MS);
}

function _buildDraftPayload() {
  return {
    v: 2,
    imageId: state.imageId,
    imgWidth: state.imgWidth,
    imgHeight: state.imgHeight,
    activeLayerId: state.activeLayerId,
    nextLayerId: state.nextLayerId,
    layers: state.layers.map(l => {
      // Group (folder) entry — metadata only, no pixel data.
      if (l.isGroup) {
        return { id: l.id, name: l.name, visible: l.visible, opacity: l.opacity,
                 isGroup: true, collapsed: !!l.collapsed };
      }
      return {
        id: l.id,
        name: l.name,
        visible: l.visible,
        opacity: l.opacity,
        blendMode: l.blendMode || 'source-over',
        clipped: !!l.clipped,
        lockAlpha: !!l.lockAlpha,
        locked: l.locked,
        isBase: !!l.isBase,
        groupId: l.groupId || null,
        canvasW: l.canvas.width,
        canvasH: l.canvas.height,
        offset: { ...(state.layerOffsets.get(l.id) || { x: 0, y: 0 }) },
        dataUrl: l.canvas.toDataURL('image/png'),
        // Non-destructive extras (so they survive reload): PS visibility mask,
        // layer effects (Blending Options), and editable text.
        layerMask: l.layerMask ? l.layerMask.toDataURL('image/png') : null,
        fx: l.fx || null,
        text: l.text || null,
        // Smart Object: pristine source + applied transform (+ optional link).
        isSmart: !!l.isSmart,
        smartXf: l.isSmart ? l.smartXf : null,
        sourceUrl: (l.isSmart && l.sourceCanvas) ? l.sourceCanvas.toDataURL('image/png') : null,
        linked: l.linked || null,
      };
    }),
  };
}

function _buildThumbnail() {
  if (!state.imgWidth || !state.imgHeight) return null;
  try {
    // Downscale the REAL composite (flatten() honours blend/clip/adjustments)
    // so gallery thumbnails match the artwork — a naive per-layer draw loop
    // dropped all of that, same bug flatten() itself had.
    const full = flatten();
    const scale = Math.min(1, THUMB_MAX / Math.max(state.imgWidth, state.imgHeight));
    const tw = Math.max(1, Math.round(state.imgWidth * scale));
    const th = Math.max(1, Math.round(state.imgHeight * scale));
    const c = document.createElement('canvas');
    c.width = tw; c.height = th;
    c.getContext('2d').drawImage(full, 0, 0, tw, th);
    return c.toDataURL('image/jpeg', 0.6);
  } catch (_) {
    return null;
  }
}

async function _persistDraft() {
  if (!state.editorOpen || !state.layers.length) return;
  // Coalesce concurrent saves — if one's already in-flight, mark dirty
  // and let the running call kick off another when it returns.
  if (state.persistInFlight) { state.persistDirty = true; return; }
  const payload = _buildDraftPayload();
  const thumbnail = _buildThumbnail();
  const body = {
    name: state.draftName || 'Untitled',
    source_image_id: state.imageId || null,
    width: state.imgWidth,
    height: state.imgHeight,
    payload,
    thumbnail,
  };
  const doRequest = async () => {
    if (state.draftId) {
      const res = await fetch(`/api/editor-drafts/${encodeURIComponent(state.draftId)}`, {
        method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      // 404 means our row was deleted while editing — fall through to
      // create a fresh one so the user doesn't lose work.
      if (res.status === 404) {
        state.draftId = null;
        return doRequest();
      }
      if (!res.ok) throw new Error(`PUT failed: ${res.status}`);
      return res.json();
    } else {
      const res = await fetch('/api/editor-drafts', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`POST failed: ${res.status}`);
      const out = await res.json();
      if (out && out.id) state.draftId = out.id;
      return out;
    }
  };
  state.persistInFlight = doRequest()
    .catch((e) => { console.warn('[ge] draft save failed', e); })
    .then(() => {
      state.persistInFlight = null;
      if (state.persistDirty) {
        state.persistDirty = false;
        _schedulePersist();
      }
    });
  return state.persistInFlight;
}

async function _loadDraftById(draftId) {
  if (!draftId) return null;
  try {
    const res = await fetch(`/api/editor-drafts/${encodeURIComponent(draftId)}`, {
      credentials: 'same-origin',
    });
    if (!res.ok) return null;
    const out = await res.json();
    if (!out || !out.payload || !Array.isArray(out.payload.layers)) return null;
    return out;
  } catch (_) {
    return null;
  }
}

async function _findDraftForImage(imageId) {
  if (!imageId) return null;
  try {
    const res = await fetch('/api/editor-drafts', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const out = await res.json();
    const match = (out.drafts || []).find(d => d.source_image_id === imageId);
    if (!match) return null;
    return _loadDraftById(match.id);
  } catch (_) {
    return null;
  }
}

async function _clearDraftServer(draftId) {
  if (!draftId) return;
  try {
    await fetch(`/api/editor-drafts/${encodeURIComponent(draftId)}`, {
      method: 'DELETE', credentials: 'same-origin',
    });
  } catch (_) { /* best-effort */ }
}

// Hydrate state.layers from a previously-persisted draft. Accepts either the
// raw payload (v1 localStorage shape) or a server response with
// {payload: {...}}. Returns a promise that resolves once every layer's
// dataURL has decoded into its canvas.
function _restoreDraft(draft) {
  return new Promise((resolve) => {
    // Server response: {id, name, payload:{...}, ...}. Unwrap.
    const data = draft.payload && draft.payload.layers ? draft.payload : draft;
    state.imgWidth = data.imgWidth;
    state.imgHeight = data.imgHeight;
    _initCanvasFromDims(data.imgWidth, data.imgHeight);
    state.layers = [];
    state.layerOffsets.clear();
    // Each NON-group layer image + each layer mask image is an async load.
    let pending = data.layers.filter((s) => !s.isGroup).length +
      data.layers.filter((s) => s.layerMask).length +
      data.layers.filter((s) => s.isSmart && s.sourceUrl).length;
    if (pending === 0) {
      // No pixel loads (e.g. an all-group doc) — still materialize groups.
      data.layers.forEach((s, idx) => {
        if (s.isGroup) state.layers[idx] = { id: s.id, name: s.name || 'Group',
          isGroup: true, visible: s.visible !== false,
          opacity: typeof s.opacity === 'number' ? s.opacity : 1, collapsed: !!s.collapsed };
      });
      state.nextLayerId = data.nextLayerId || state.nextLayerId;
      state.activeLayerId = data.activeLayerId || (state.layers[state.layers.length - 1]?.id ?? null);
      resolve(); return;
    }
    data.layers.forEach((s, idx) => {
      // Group (folder) entry — synchronous, no image to decode.
      if (s.isGroup) {
        state.layers[idx] = { id: s.id, name: s.name || 'Group', isGroup: true,
          visible: s.visible !== false,
          opacity: typeof s.opacity === 'number' ? s.opacity : 1,
          collapsed: !!s.collapsed };
        return;
      }
      const layer = createLayer(s.name || 'Layer', s.canvasW || state.imgWidth, s.canvasH || state.imgHeight);
      layer.id = s.id;
      layer.visible = s.visible !== false;
      layer.opacity = typeof s.opacity === 'number' ? s.opacity : 1;
      layer.blendMode = s.blendMode || 'source-over';
      layer.clipped = !!s.clipped;
      layer.lockAlpha = !!s.lockAlpha;
      layer.locked = !!s.locked;
      layer.groupId = s.groupId || null;
      if (s.isBase) layer.isBase = true;
      if (s.fx) layer.fx = s.fx;       // layer effects (Blending Options)
      if (s.text) layer.text = s.text; // editable text field
      // Smart Object: rehydrate the applied transform + decode the pristine
      // source (an extra async image, counted in `pending`). The baked
      // layer.canvas still restores from s.dataUrl so the doc renders meanwhile.
      if (s.isSmart) {
        layer.isSmart = true;
        layer.smartXf = s.smartXf || null;
        layer.linked = s.linked || null;
        if (s.sourceUrl) {
          const sc = document.createElement('canvas');
          const simg = new Image();
          simg.onload = () => {
            sc.width = simg.naturalWidth || simg.width; sc.height = simg.naturalHeight || simg.height;
            sc.getContext('2d').drawImage(simg, 0, 0);
            layer.sourceCanvas = sc; layer.sourceW = sc.width; layer.sourceH = sc.height;
            if (--pending === 0) resolve();
          };
          simg.onerror = () => { if (--pending === 0) resolve(); };
          simg.src = s.sourceUrl;
        }
      }
      state.layers[idx] = layer;
      state.layerOffsets.set(layer.id, { ...(s.offset || { x: 0, y: 0 }) });
      const img = new Image();
      img.onload = () => {
        if (!state.editorOpen) { resolve(); return; }
        layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
        layer.ctx.drawImage(img, 0, 0);
        if (--pending === 0) resolve();
      };
      img.onerror = () => { if (--pending === 0) resolve(); };
      img.src = s.dataUrl;
      // Restore the PS visibility mask (separate async image).
      if (s.layerMask) {
        const mc = document.createElement('canvas');
        mc.width = layer.canvas.width; mc.height = layer.canvas.height;
        const mimg = new Image();
        mimg.onload = () => { mc.getContext('2d').drawImage(mimg, 0, 0); layer.layerMask = mc; if (--pending === 0) resolve(); };
        mimg.onerror = () => { if (--pending === 0) resolve(); };
        mimg.src = s.layerMask;
      }
    });
    state.nextLayerId = data.nextLayerId || (state.layers.reduce((m, l) => Math.max(m, l.id || 0), 0) + 1);
    state.activeLayerId = data.activeLayerId || (state.layers[state.layers.length - 1]?.id ?? null);
  });
}

// Used both by the fresh openEditor path and by _restoreDraft. The full
// _initCanvas in openEditor is closure-scoped, so factored out here.
function _initCanvasFromDims(w, h) {
  state.imgWidth = w;
  state.imgHeight = h;
  if (state.mainCanvas) {
    state.mainCanvas.width = w;
    state.mainCanvas.height = h;
  }
  state.maskCanvas = document.createElement('canvas');
  state.maskCanvas.width = w;
  state.maskCanvas.height = h;
  state.maskCtx = state.maskCanvas.getContext('2d');
}

function _restoreState(snap) {
  // Restore canvas dimensions first so layer imageData fits cleanly. This
  // is what makes Ctrl+Z work for crops (which change the main canvas
  // size) in addition to paint strokes.
  const dimsChanged = snap.imgWidth && snap.imgHeight &&
    (snap.imgWidth !== state.imgWidth || snap.imgHeight !== state.imgHeight);
  if (snap.imgWidth && snap.imgHeight) {
    state.imgWidth = snap.imgWidth;
    state.imgHeight = snap.imgHeight;
    if (state.mainCanvas) {
      state.mainCanvas.width = snap.imgWidth;
      state.mainCanvas.height = snap.imgHeight;
    }
    if (state.maskCanvas) {
      state.maskCanvas.width = snap.imgWidth;
      state.maskCanvas.height = snap.imgHeight;
    }
  }
  const layerStates = snap.layers || snap;
  // Rebuild the state.layers array from the snapshot order. This lets Ctrl+Z
  // restore deleted layers (previously the loop only updated existing
  // ones and silently dropped any layer the snapshot still knew about).
  // Layers absent from the snapshot are dropped — that's the desired
  // behavior for undoing an "+Add" or a paste.
  const _existingById = new Map(state.layers.map(l => [l.id, l]));
  const _rebuilt = [];
  for (const s of layerStates) {
    // Group (folder) entry — no canvas; reuse or recreate the metadata holder.
    if (s.isGroup) {
      let g = _existingById.get(s.id);
      if (g) _existingById.delete(s.id);
      else g = { id: s.id, isGroup: true };
      g.isGroup = true;
      g.name = s.name;
      g.visible = s.visible;
      g.opacity = typeof s.opacity === 'number' ? s.opacity : 1;
      g.locked = !!s.locked;
      g.collapsed = !!s.collapsed;
      _rebuilt.push(g);
      continue;
    }
    let layer = _existingById.get(s.id);
    if (!layer) {
      // Layer was deleted (or merged away). Recreate it from the
      // snapshot's ImageData so Ctrl+Z brings it back.
      const c = document.createElement('canvas');
      c.width = s.canvasW || state.imgWidth;
      c.height = s.canvasH || state.imgHeight;
      layer = { id: s.id, name: s.name, canvas: c, ctx: c.getContext('2d'),
                visible: true, opacity: 1, locked: false };
    } else {
      _existingById.delete(s.id);
    }
    layer.name = s.name;
    layer.visible = s.visible;
    layer.opacity = s.opacity;
    layer.locked = s.locked;
    if (s.canvasW && s.canvasH) {
      layer.canvas.width = s.canvasW;
      layer.canvas.height = s.canvasH;
    }
    // Repaint pixels from the tiled snapshot (legacy full-frame imageData still
    // accepted as a fallback). Tiles cover the whole surface, so this fully
    // overwrites — no clear needed.
    try {
      if (s.tiles) _detileTo(layer.ctx, s.tiles);
      else if (s.imageData) layer.ctx.putImageData(s.imageData, 0, 0);
    } catch (_) {}
    state.layerOffsets.set(layer.id, { ...s.offset });
    // Restore adjustment sub-layers + invalidate the composite cache
    // so the live render reflects the rolled-back FX state.
    layer.adjLayers = s.adjLayers ? JSON.parse(JSON.stringify(s.adjLayers)) : [];
    if (s.isBase !== undefined) layer.isBase = s.isBase;
    layer.groupId = s.groupId || null; // restore group membership (undo of group/ungroup)
    // Restore Smart Object metadata (undo of convert / rasterize / replace).
    layer.isSmart = !!s.isSmart;
    layer.smartXf = s.smartXf || null;
    layer.sourceCanvas = s.isSmart ? (s.sourceCanvas || null) : null;
    layer.linked = s.linked || null;
    // Restore mask sub-layers — rebuild each mask's canvas from the
    // snapshot's imageData. We don't reuse old mask canvases (snapshot
    // dims might differ after a transform) so a fresh canvas is safer.
    layer.masks = (s.masks || []).map(ms => {
      const mc = document.createElement('canvas');
      mc.width = ms.canvasW || state.imgWidth;
      mc.height = ms.canvasH || state.imgHeight;
      const mctx = mc.getContext('2d');
      try {
        if (ms.tiles) _detileTo(mctx, ms.tiles);
        else if (ms.imageData) mctx.putImageData(ms.imageData, 0, 0);
      } catch {}
      return { id: ms.id, name: ms.name, canvas: mc, ctx: mctx, visible: ms.visible !== false };
    });
    layer.activeMaskId = s.activeMaskId || (layer.masks[0]?.id ?? null);
    layer._adjFinal = null;
    layer._adjFinalKey = null;
    layer._stagedAdj = null;
    layer._editingAdjId = null;
    _rebuilt.push(layer);
  }
  // Drop any layer that's no longer in the snapshot.
  for (const lost of _existingById.values()) state.layerOffsets.delete(lost.id);
  state.layers = _rebuilt;
  // Re-sync the tile-dedup source to the just-restored pixels so the next
  // capture shares unchanged tiles rather than re-copying the whole image.
  {
    const h = new Map();
    for (const s of layerStates) {
      if (s.isGroup) continue;
      if (s.tiles) h.set(s.id, s.tiles);
      for (const ms of (s.masks || [])) if (ms.tiles) h.set(ms.id, ms.tiles);
    }
    state._histTiles = h;
  }
  if (!state.layers.find(l => l.id === state.activeLayerId) && state.layers.length) {
    state.activeLayerId = state.layers[state.layers.length - 1].id;
  }
  // Repoint the global mask plumbing at the active parent's active
  // mask sub-layer (if any) — undo can swap the actual canvas object.
  {
    const m = _getActiveMaskLayer();
    if (m) { state.maskCanvas = m.canvas; state.maskCtx = m.ctx; }
  }
  // Restore wand selection (or clear it if the snapshot had none).
  if (snap.wand && snap.wand.imageData) {
    const mc = document.createElement('canvas');
    mc.width = snap.wand.w;
    mc.height = snap.wand.h;
    mc.getContext('2d').putImageData(snap.wand.imageData, 0, 0);
    state.wandMask = mc;
    state.wandLayerId = snap.wand.layerId;
    state.wandLastSeed = snap.wand.seed ? { ...snap.wand.seed } : null;
  } else {
    state.wandMask = null;
    state.wandLayerId = null;
    state.wandLastSeed = null;
  }
  composite();
  _renderLayerPanel();
  _syncToolClearIndicators();
  // Refit the viewport when canvas size changed (crop undo/redo) so the
  // user sees the full restored image, not the zoomed-in upper-left
  // corner left over from the previous fit.
  if (dimsChanged) _fitZoom();
  // Update the topbar canvas-size badge directly (the helper is scoped
  // inside _buildEditor, so we touch the DOM here).
  const sizeLabel = document.getElementById('ge-canvas-size');
  if (sizeLabel) sizeLabel.textContent = `${state.imgWidth}×${state.imgHeight}`;
}

function undo() {
  if (state.undoStack.length === 0) return;
  const cur = _snapshotState();
  cur._label = 'Current';
  cur._ts = Date.now();
  state.redoStack.push(cur);
  _restoreState(state.undoStack.pop());
  _refreshHistoryPanelIfOpen();
}

function redo() {
  if (state.redoStack.length === 0) return;
  const cur = _snapshotState();
  cur._label = 'Current';
  cur._ts = Date.now();
  state.undoStack.push(cur);
  _restoreState(state.redoStack.pop());
  _refreshHistoryPanelIfOpen();
}

// Jump to any state in the labeled history. Negative offsets go back
// (into state.undoStack), positive go forward (into state.redoStack). 0 = current.
// Used by the history panel.
// History panel — full implementation in editor/history-panel.js.
// Wrappers preserve the legacy names that the topbar History button
// + undo/redo paths already reference.
const _historyPanel = createHistoryPanel({ undo, redo });
const _jumpToHistory             = _historyPanel.jumpToHistory;
const _toggleHistoryPanel        = _historyPanel.toggleHistoryPanel;
const _refreshHistoryPanelIfOpen = _historyPanel.refreshHistoryPanelIfOpen;

// _relTime lives in editor/layer-helpers.js.

// ── Canvas event helpers ──

// _canvasCoords lives in editor/canvas-coords.js — see import at top.

// ── Drawing ──

function _beginDraw(e) {
  // Right mouse button: Alt+right-drag = on-canvas brush HUD (horizontal = size,
  // vertical = opacity); a plain right-press never paints. Left / touch fall
  // through to normal drawing.
  if (e.button === 2) {
    if (e.altKey && (state.tool === 'brush' || state.tool === 'eraser')) {
      e.preventDefault();
      const opField = state.tool === 'eraser' ? 'eraserOpacity' : 'brushOpacity';
      state.brushHudActive = true;
      state.brushHudStart = { x: e.clientX, y: e.clientY, size: state.brushSize, opacity: state[opField], opField };
    }
    return;
  }
  // Fall back to the parent resolver so a stale activeLayerId doesn't
  // block strokes when there ARE layers present.
  const layer = activeLayer() || _activeParentLayer();
  // Move tool: make sure the always-on transform box targets the CURRENT
  // active layer before hit-testing its handles (a bare layer-list click
  // only toggles selection, so the box may be stale here).
  if (state.tool === 'move') _resyncMoveTransform();
  // Transform-tool drag (handle grab or move-fallback) — handler in
  // editor/tools/transform-drag.js.
  if (_transformDragTool.tryBegin(e)) return;
  // Magic wand is selection-only — works even on locked layers because
  // it doesn't mutate the layer until an action (Erase/Copy) is taken.
  // Full implementation in editor/tools/wand.js.
  if (state.tool === 'wand') return _wandTool.click(e);
  // Polygonal Lasso — selection-only (works on locked layers), click-based:
  // each pointerdown drops a vertex; closing leaves a polygon in lassoPoints.
  if (state.tool === 'polylasso') return _polyLassoTool.click(e);
  // Magnetic Lasso — selection-only, click-based with edge snapping.
  if (state.tool === 'maglasso') return _magLassoTool.click(e);
  // Ruler — measure overlay; no layer needed (non-destructive).
  if (state.tool === 'ruler') return _rulerTool.begin(e);
  // Text / Type — click places an editable text layer.
  if (state.tool === 'text') { _placeTextLayer(e); return; }
  // Quick Selection — drag-flood select. Begins the drag here.
  if (state.tool === 'quickselect') {
    if (!(activeLayer() || _activeParentLayer())) return;
    _saveState();
    state.drawing = true; state.quickSelecting = true;
    const c = _canvasCoords(e, state.mainCanvas);
    _quickSelectAt(c.x, c.y);
    return;
  }
  // Eyedropper — sample the composited pixel into the active color. Works on
  // any tool state (no active layer needed), like the wand above.
  if (state.tool === 'eyedropper') return _eyedropperPick(e);
  if (state.tool === 'gradient') return _gradientTool.begin(e);
  if (state.tool === 'shapes') return _shapeTool.begin(e);
  if (state.tool === 'bucket') return _bucketTool.fill(e);
  if (state.tool === 'marquee') return _marqueeTool.begin(e);
  if (state.tool === 'liquify') return _liquifyTool.begin(e);
  if (state.tool === 'smudge') return _smudgeTool.begin(e);
  if (state.tool === 'mixer') return _mixerTool.begin(e);
  if (state.tool === 'heal') return _healTool.begin(e);
  if (state.tool === 'dodgeburn') return _dodgeBurnTool.begin(e);
  if (state.tool === 'redeye') return _redEyeTool.begin(e);
  // Alt+click = quick eyedropper while painting — sample, don't paint.
  if (e.altKey && (state.tool === 'brush' || state.tool === 'eraser')) return _eyedropperPick(e);
  // Inpaint can create its own layer + mask on the fly, so skip the
  // "no active layer → bail" gate for it specifically.
  if (state.tool !== 'inpaint' && (!layer || layer.locked)) return;
  // Keep activeLayerId in sync so downstream lookups resolve.
  if (layer && state.activeLayerId !== layer.id) state.activeLayerId = layer.id;
  if (state.tool === 'move') return _beginMove(e);
  if (state.tool === 'crop') return _beginCrop(e);
  if (state.tool === 'lasso') return _beginLasso(e);
  // Clone-stamp — source pick + stroke start. Full implementation in
  // editor/tools/clone.js; per-sample stamping continues through the
  // shared `_strokeTo` pipeline below.
  if (state.tool === 'clone') return _cloneTool.begin(e);
  // Brush / Eraser / Inpaint share a stroke pipeline — handler in
  // editor/tools/stroke.js. Returns true for those tools, false
  // otherwise (any other tool that reached here is a no-op).
  _strokeTool.tryBegin(e);
}

// Eyedropper — read the composited pixel under the cursor and set it as the
// active brush color, reflecting it in the color-picker swatch(es).
function _eyedropperPick(e) {
  if (!state.mainCtx || !state.mainCanvas) return;
  const { x, y } = _canvasCoords(e, state.mainCanvas);
  const cw = state.mainCanvas.width, ch = state.mainCanvas.height;
  const px = Math.max(0, Math.min(cw - 1, Math.round(x)));
  const py = Math.max(0, Math.min(ch - 1, Math.round(y)));
  const n = state.eyedropperSampleSize || 1;
  let r, g, b;
  if (n <= 1) {
    let d;
    try { d = state.mainCtx.getImageData(px, py, 1, 1).data; } catch { return; }
    r = d[0]; g = d[1]; b = d[2];
  } else {
    // N×N average — steadier picks off noisy / dithered areas (PS sample size).
    const half = (n - 1) >> 1;
    const x0 = Math.max(0, px - half), y0 = Math.max(0, py - half);
    const w = Math.min(cw, px + half + 1) - x0, h = Math.min(ch, py + half + 1) - y0;
    let d;
    try { d = state.mainCtx.getImageData(x0, y0, w, h).data; } catch { return; }
    let sr = 0, sg = 0, sb = 0;
    const cnt = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; }
    r = Math.round(sr / cnt); g = Math.round(sg / cnt); b = Math.round(sb / cnt);
  }
  const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  state.color = hex;
  if (state.container) {
    state.container.querySelectorAll('.ge-color-picker').forEach((el) => {
      el.value = hex;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
}

function _continueDraw(e) {
  // _continueDraw is now bound to the window so drags can extend past
  // the canvas. The brush-cursor overlay should only follow the cursor
  // when it's actually over the canvas, otherwise hide it.
  const overCanvas = state.mainCanvas && e.target === state.mainCanvas;
  if (['eraser', 'inpaint', 'lasso', 'brush', 'liquify', 'smudge', 'mixer', 'dodgeburn'].includes(state.tool) && state.mainCanvas) {
    if (overCanvas) _updateBrushCursor(e);
    else if (state.cursorEl) state.cursorEl.style.display = 'none';
  }
  // Transform-tool hover-cursor + handle drag — handler in
  // editor/tools/transform-drag.js. Returns true when the drag is
  // consuming the event (rotation / resize); the hover-cursor pass
  // returns false so the dispatcher can still fall through to other
  // tools that share the canvas hover (none currently, but kept for
  // future-proofing).
  if (_transformDragTool.tryContinue(e)) return;
  // Polygonal lasso rubber-band follows the cursor between clicks (button up),
  // so handle it before the `state.drawing` gate below.
  if (state.tool === 'polylasso' && state.polyLassoActive) return _polyLassoTool.move(e);
  if (state.tool === 'maglasso' && state.magLassoActive) return _magLassoTool.move(e);
  if (state.rulerActive) return _rulerTool.move(e);
  if (state.lassoActive) return _continueLasso(e);
  if (state.gradActive) return _gradientTool.move(e);
  if (state.shapeActive) return _shapeTool.move(e);
  if (state.marqueeActive) return _marqueeTool.move(e);
  if (state.liquifyActive) return _liquifyTool.move(e);
  if (state.smudgeActive) return _smudgeTool.move(e);
  if (state.mixerActive) return _mixerTool.move(e);
  if (state.healActive) return _healTool.move(e);
  if (state.dodgeBurnActive) return _dodgeBurnTool.move(e);
  if (!state.drawing) {
    if (state.moving) return _continueMove(e);
    if (state.cropping || state.cropMoving) return _continueCrop(e);
    return;
  }
  if (state.quickSelecting) { const c = _canvasCoords(e, state.mainCanvas); _quickSelectAt(c.x, c.y); return; }
  // In-progress stroke (brush / eraser / inpaint / clone) — handler in
  // editor/tools/stroke.js.
  _strokeTool.tryContinue(e);
}

function _endDraw() {
  // Transform-tool drag end — handler in editor/tools/transform-drag.js.
  if (_transformDragTool.tryEnd()) return;
  if (state.lassoActive) return _endLasso();
  if (state.gradActive) return _gradientTool.end();
  if (state.rulerActive) return _rulerTool.end();
  if (state.shapeActive) return _shapeTool.end();
  if (state.marqueeActive) return _marqueeTool.end();
  if (state.liquifyActive) return _liquifyTool.end();
  if (state.smudgeActive) return _smudgeTool.end();
  if (state.mixerActive) return _mixerTool.end();
  if (state.healActive) return _healTool.end();
  if (state.dodgeBurnActive) return _dodgeBurnTool.end();
  if (state.quickSelecting) { state.drawing = false; state.quickSelecting = false; _syncToolClearIndicators(); return; }
  if (state.moving) return _endMove();
  if (state.cropping || state.cropMoving) return _endCrop();
  // "Catch-up on Stroke End" — with the stabilizer on, the painted brush lags
  // behind the cursor; on lift, run the remaining lagged distance to where the
  // pen actually ended so the line reaches the cursor instead of falling short.
  // (Skipped in Pulled-String mode, which intentionally trails by a radius.)
  if (state.drawing && state.brushSmoothCatchupEnd && !state.brushSmoothPull &&
      (state.brushSmoothing > 0) && state.useBrushEngine &&
      (state.tool === 'brush' || state.tool === 'eraser') && state.rawX != null) {
    let guard = 0;
    while (guard++ < 48 &&
      (Math.abs(state.rawX - state.lastX) > 0.6 || Math.abs(state.rawY - state.lastY) > 0.6)) {
      _strokeTo(state.rawX, state.rawY);
    }
  }
  state.rawX = null; state.rawY = null;
  // Stroke end (brush / eraser / inpaint / clone) — handler in
  // editor/tools/stroke.js.
  _strokeTool.tryEnd();
}

// Floating popup that appears after an inpaint stroke so the user can
// type a prompt and Generate without diverting to the side panel. The
// popup re-uses the existing #ge-inpaint-prompt and #ge-inpaint-run
// elements by reparenting them into a positioned wrapper, so all the
// existing handlers (Enter to submit, generate-button click) still fire.
// Inpaint-stroke prompt popup feature was removed — the user types in
// the side panel and hits Generate there. Helpers _showInpaintPrompt /
// _dismissInpaintPrompt and their dismiss-handlers were dead code and
// have been deleted.

// Clone Stamp painter — stamps circular samples from the source
// snapshot at every interpolated point between the last brush position
// and the current one, so a drag produces a continuous clone. The
// sample offset is fixed at stroke-start ("aligned" clone mode):
// `sample = source + (cursor − strokeStart)`.
// Stroke pipeline — paints one segment last→current onto the active
// layer (or active mask sub-layer). Full implementation in
// editor/stroke-pipeline.js.
const _strokePipeline = createStrokePipeline({
  // Use the fallback-capable parent resolver so the stroke pipeline
  // and _getActiveMaskLayer() agree on which layer is active. Plain
  // activeLayer() returns null when activeLayerId is stale, which made
  // strokeTo bail even though a mask had been created on the fallback
  // parent — the "inpaint draws nothing" bug.
  activeLayer: () => activeLayer() || _activeParentLayer(),
  getActiveMaskLayer: () => _getActiveMaskLayer(),
  composite,
});
const _strokeTo      = _strokePipeline.strokeTo;
const _cloneStrokeTo = _strokePipeline.cloneStrokeTo;

// ── Brush cursor overlay ──


function _updateBrushCursor(e) {
  if (!state.mainCanvas) return;
  const rect = state.mainCanvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;

  if (!state.cursorEl) {
    state.cursorEl = document.createElement('div');
    state.cursorEl.className = 'ge-brush-cursor';
    // Append inside the editor container (not document.body) so the cursor still
    // renders when the editor is in element-fullscreen — body-level siblings of
    // the fullscreen element are not painted.
    (state.container || document.body).appendChild(state.cursorEl);
  }

  // Lasso uses the feather radius (or a sensible default) so the circle
  // shows the area that will be selected. Other tools use the brush size.
  let basePx;
  if (state.tool === 'lasso') {
    const f = parseInt(document.getElementById('ge-lasso-feather')?.value || '0');
    basePx = Math.max(10, f * 2);
  } else {
    basePx = state.brushSize;
  }
  const diameter = basePx * state.zoom;
  state.cursorEl.style.width = diameter + 'px';
  state.cursorEl.style.height = diameter + 'px';
  state.cursorEl.style.left = (clientX - diameter / 2) + 'px';
  state.cursorEl.style.top = (clientY - diameter / 2) + 'px';
  state.cursorEl.style.display = '';
  if (state.tool === 'inpaint') {
    // Visual cue for paint vs erase mode. Ctrl+Alt held mid-hover also
    // flips the cursor so the user sees the effective mode before they
    // click. Red = paint mask, white-dashed = erase mask.
    const flip = e && e.ctrlKey && e.altKey;
    const eraseEffective = flip ? !state.inpaintEraseMode : state.inpaintEraseMode;
    if (eraseEffective) {
      state.cursorEl.style.borderColor = 'rgba(255,255,255,0.9)';
      state.cursorEl.style.background = 'rgba(255,255,255,0.10)';
      state.cursorEl.style.borderStyle = 'dashed';
    } else {
      state.cursorEl.style.borderColor = 'rgba(255,80,80,0.8)';
      state.cursorEl.style.background = 'rgba(255,50,50,0.25)';
      state.cursorEl.style.borderStyle = 'solid';
    }
  } else if (state.tool === 'lasso') {
    state.cursorEl.style.borderColor = 'rgba(255,255,255,0.85)';
    state.cursorEl.style.background = 'rgba(0,0,0,0.15)';
    state.cursorEl.style.borderStyle = 'solid';
  } else {
    state.cursorEl.style.borderColor = state.tool === 'eraser' ? 'rgba(255,255,255,0.6)' : state.color;
    state.cursorEl.style.background = 'transparent';
    state.cursorEl.style.borderStyle = 'solid';
  }
}

// Live readout shown while Alt+right-dragging the brush HUD: diameter + opacity.
// Appended inside the editor container so it renders in element-fullscreen.
function _showBrushHudReadout(e, size, opacity) {
  if (!state.brushHudReadoutEl || !state.brushHudReadoutEl.isConnected) {
    const el = document.createElement('div');
    el.className = 'ge-brush-hud-readout';
    el.style.cssText = 'position:fixed;z-index:10010;pointer-events:none;padding:3px 7px;border-radius:4px;' +
      'font:600 11px/1.2 system-ui,sans-serif;color:#fff;background:rgba(0,0,0,0.78);white-space:nowrap;';
    (state.container || document.body).appendChild(el);
    state.brushHudReadoutEl = el;
  }
  const el = state.brushHudReadoutEl;
  el.textContent = '⌀ ' + size + ' px  ·  ' + opacity + '%';
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  const cy = e.touches ? e.touches[0].clientY : e.clientY;
  el.style.left = (cx + 18) + 'px';
  el.style.top = (cy + 18) + 'px';
  el.style.display = '';
}
function _hideBrushHudReadout() {
  if (state.brushHudReadoutEl) state.brushHudReadoutEl.style.display = 'none';
}

// ── Move tool ──

// Move tool — full implementation lives in editor/tools/move.js. Wrap
// `_beginMove` / `_continueMove` / `_endMove` to the factory output so
// the existing dispatcher (_beginDraw / _continueDraw / _endDraw) keeps
// working without changes.
const _moveTool = createMoveTool({ activeLayer, saveState: _saveState, composite });
const _beginMove    = _moveTool.begin;
const _continueMove = _moveTool.drag;
const _endMove      = _moveTool.end;

// Feature 2 — Move tool's always-on transform box. Starts a SILENT transform
// session (no popup, no zoom-fit) around the active layer so the standard 8
// handles + rotation grip render and resize/rotate work, while a plain in-box
// drag still moves the layer. Non-destructive until commit (reuses the
// transform session's clean snapshot). No-op if a session is already running
// (e.g. the dedicated Transform tool) or there's no unlocked active layer.
function _ensureMoveTransform() {
  if (state.tool !== 'move') return;
  if (state.transformActive) return;
  const layer = activeLayer();
  if (!layer || layer.locked) return;
  _startTransform({ silent: true });
}

// True when the live silent session hasn't actually changed the layer (no
// resize / rotation / flip). A pristine session can be torn down without a
// real commit — important so re-arming on layer-select doesn't pollute undo.
function _moveTransformPristine() {
  return state.transformSilent &&
    state.transformPendingRot === 0 &&
    !state.transformPendingFlipH && !state.transformPendingFlipV &&
    state.transformPendingW === state.transformOrigW &&
    state.transformPendingH === state.transformOrigH;
}

// Re-sync the Move-tool box when the active layer changes underneath it.
// If the current silent session is pristine, tear it down cheaply (no
// commit, no undo entry); otherwise commit the edit onto the old layer.
// Then re-arm on the new layer. No-op outside Move / when a non-silent
// (Free Transform) session owns the canvas. Guarded against re-entrancy so a
// composite() triggered during teardown can't recurse back in.
let _resyncingMoveTransform = false;
function _resyncMoveTransform() {
  if (_resyncingMoveTransform) return;
  if (state.tool !== 'move') return;
  if (state.transformActive) {
    if (!state.transformSilent) return; // don't disturb Free Transform
    if (state.transformLayer === activeLayer()) return; // already on this layer
    _resyncingMoveTransform = true;
    try {
      if (_moveTransformPristine()) {
        // Pristine: drop session state without a commit/undo entry.
        state.transformOrigCanvas = null;
        state.transformOrigOffset = null;
        state.transformActive = false;
        state.transformSilent = false;
        state.transformLayer = null;
        state.transformHandle = null;
      } else {
        _confirmTransform();
      }
    } finally {
      _resyncingMoveTransform = false;
    }
  }
  _ensureMoveTransform();
}

// ── Crop tool ──

// Crop tool — full implementation in editor/tools/crop.js. Wire
// `_beginCrop` / `_continueCrop` / `_endCrop` to the factory output so
// the existing dispatcher keeps working without changes.
const _cropTool = createCropTool({ composite, showCropApply: () => _showCropApply() });
const _beginCrop    = _cropTool.begin;
const _continueCrop = _cropTool.drag;
const _endCrop      = _cropTool.end;

function _showCropApply() {
  let pop = state.container.querySelector('.ge-crop-apply');
  if (pop) pop.remove();
  // A small floating panel: W × H inputs and the Apply button.
  pop = document.createElement('div');
  pop.className = 'ge-crop-apply';
  pop.innerHTML = `
    <input type="number" class="ge-crop-w" min="1" max="20000" value="${Math.round(state.cropRect.w)}" title="Width">
    <span class="ge-crop-x">×</span>
    <input type="number" class="ge-crop-h" min="1" max="20000" value="${Math.round(state.cropRect.h)}" title="Height">
    <button class="ge-crop-apply-btn">Apply</button>
  `;
  const area = state.container.querySelector('.ge-canvas-area');
  if (!area || !state.cropRect || !state.mainCanvas) return;
  area.appendChild(pop);

  pop.querySelector('.ge-crop-apply-btn').addEventListener('click', () => _applyCrop());
  // Editing W/H updates the crop rect anchored at its top-left so the
  // user sees the dimensions live in the overlay.
  const wInput = pop.querySelector('.ge-crop-w');
  const hInput = pop.querySelector('.ge-crop-h');
  const onSize = () => {
    if (!state.cropRect) return;
    const w = Math.max(1, parseInt(wInput.value, 10) || state.cropRect.w);
    const h = Math.max(1, parseInt(hInput.value, 10) || state.cropRect.h);
    state.cropRect = { ...state.cropRect, w, h };
    composite();
  };
  wInput.addEventListener('input', onSize);
  hInput.addEventListener('input', onSize);
  // Enter in either field triggers apply.
  [wInput, hInput].forEach(inp => {
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') _applyCrop(); });
  });

  // Position the panel just outside the bottom-right corner of the
  // crop rectangle (where the user finished dragging), in area coords.
  const canvasRect = state.mainCanvas.getBoundingClientRect();
  const areaRect = area.getBoundingClientRect();
  const scaleX = canvasRect.width / state.mainCanvas.width;
  const scaleY = canvasRect.height / state.mainCanvas.height;
  const localX = (canvasRect.left - areaRect.left) + (state.cropRect.x + state.cropRect.w) * scaleX;
  const localY = (canvasRect.top - areaRect.top) + (state.cropRect.y + state.cropRect.h) * scaleY;
  pop.style.position = 'absolute';
  pop.style.left = (localX + 6) + 'px';
  pop.style.top = (localY + 6) + 'px';
  // Clamp inside the CANVAS image bounds (not just the canvas-area) so
  // the panel doesn't sit on the dark padding around the canvas — it
  // stays anchored over the actual image.
  requestAnimationFrame(() => {
    const bRect = pop.getBoundingClientRect();
    const canvasLeft = canvasRect.left - areaRect.left;
    const canvasTop = canvasRect.top - areaRect.top;
    const canvasRight = canvasLeft + canvasRect.width;
    const canvasBottom = canvasTop + canvasRect.height;
    let nx = parseFloat(pop.style.left) || 0;
    let ny = parseFloat(pop.style.top) || 0;
    if (nx + bRect.width > canvasRight - 4) nx = canvasRight - bRect.width - 4;
    if (ny + bRect.height > canvasBottom - 4) ny = canvasBottom - bRect.height - 4;
    nx = Math.max(canvasLeft + 4, nx);
    ny = Math.max(canvasTop + 4, ny);
    pop.style.left = nx + 'px';
    pop.style.top = ny + 'px';
  });
}

function _applyCrop() {
  if (!state.cropRect) return;
  _saveState('Crop');
  const { x, y, w, h } = state.cropRect;
  const cw = Math.round(w);
  const ch = Math.round(h);
  const rx = Math.round(x);
  const ry = Math.round(y);
  if (state.cropDeletePixels === false) {
    // Keep cropped-out pixels: leave each layer's canvas intact and just
    // shift its offset so the crop's top-left becomes the new (0,0). Pixels
    // outside the new document bounds stay on the layer (hidden via overscan)
    // and reappear if the canvas is later extended back out. Handles extend
    // (negative rx/ry or oversize) the same way.
    for (const layer of state.layers) {
      const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
      state.layerOffsets.set(layer.id, { x: off.x - rx, y: off.y - ry });
    }
  } else {
    for (const layer of state.layers) {
      const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
      const data = layer.ctx.getImageData(rx - off.x, ry - off.y, cw, ch);
      layer.canvas.width = cw;
      layer.canvas.height = ch;
      layer.ctx.putImageData(data, 0, 0);
      state.layerOffsets.set(layer.id, { x: 0, y: 0 });
    }
  }
  state.mainCanvas.width = cw;
  state.mainCanvas.height = ch;
  state.imgWidth = cw;
  state.imgHeight = ch;
  if (state.maskCanvas) { state.maskCanvas.width = cw; state.maskCanvas.height = ch; }
  state.cropRect = null;
  const btn = state.container.querySelector('.ge-crop-apply');
  if (btn) btn.remove();
  composite();
  _fitZoom();
}

// Image Size (resample) — scale EVERY layer's pixels (+ masks + offsets) to a
// new document size with a chosen interpolation. Distinct from Canvas Size,
// which crops/extends without resampling. `method`: 'nearest' | 'bilinear' |
// 'bicubic' (the canvas 2D context has no true bicubic; 'high' smoothing is the
// closest approximation and is labelled as such).
function _resampleImage(newW, newH, method) {
  newW = Math.round(newW); newH = Math.round(newH);
  if (!newW || !newH || newW < 1 || newH < 1) { uiModule.showToast('Invalid size'); return; }
  const oldW = state.imgWidth, oldH = state.imgHeight;
  if (!oldW || !oldH) return;
  if (newW === oldW && newH === oldH) return;
  _saveState('Image size');
  const sx = newW / oldW, sy = newH / oldH;
  const smoothing = method !== 'nearest';
  const quality = method === 'bicubic' ? 'high' : (method === 'bilinear' ? 'medium' : 'low');
  const scaleCanvas = (cv) => {
    const nw = Math.max(1, Math.round(cv.width * sx));
    const nh = Math.max(1, Math.round(cv.height * sy));
    const tmp = document.createElement('canvas');
    tmp.width = cv.width; tmp.height = cv.height;
    tmp.getContext('2d').drawImage(cv, 0, 0);
    cv.width = nw; cv.height = nh;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = smoothing;
    ctx.imageSmoothingQuality = quality;
    ctx.clearRect(0, 0, nw, nh);
    ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, 0, 0, nw, nh);
  };
  for (const layer of state.layers) {
    if (layer.isGroup) continue;
    if (layer.canvas) { scaleCanvas(layer.canvas); layer.ctx = layer.canvas.getContext('2d'); }
    if (layer.layerMask && layer.layerMask.width) scaleCanvas(layer.layerMask);
    const off = state.layerOffsets.get(layer.id);
    if (off) state.layerOffsets.set(layer.id, { x: Math.round(off.x * sx), y: Math.round(off.y * sy) });
  }
  if (state.maskCanvas) { scaleCanvas(state.maskCanvas); state.maskCtx = state.maskCanvas.getContext('2d'); }
  state.imgWidth = newW; state.imgHeight = newH;
  state.mainCanvas.width = newW; state.mainCanvas.height = newH;
  const sizeLabel = document.getElementById('ge-canvas-size');
  if (sizeLabel) sizeLabel.textContent = `${newW}×${newH}`;
  _fitZoom();
  composite();
  if (typeof _renderLayerPanel === 'function') { try { _renderLayerPanel(); } catch {} }
  uiModule.showToast(`Image resampled to ${newW}×${newH}`);
}

// Export As… — pick a format (PNG/JPEG/WebP/TGA) + quality (lossy only) and
// download the flattened composite. PNG/WebP/TGA keep alpha; JPEG flattens onto
// white. Encoders live in editor/export-image.js.
function _promptExportAs() {
  let overlay = document.getElementById('ge-export-overlay');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.id = 'ge-export-overlay';
  overlay.className = 'modal';
  const opts = EXPORT_FORMATS.map((f) => `<option value="${f.id}">${f.label}</option>`).join('');
  overlay.innerHTML = `
    <div class="ge-prompt-card" style="background:#26262b;border:1px solid rgba(255,255,255,0.14);border-radius:10px;padding:18px;min-width:300px;color:#eee;box-shadow:0 18px 48px rgba(0,0,0,0.55);">
      <div style="font-weight:600;margin-bottom:12px;">Export As</div>
      <label style="display:flex;align-items:center;gap:8px;margin:6px 0;font-size:12px;">
        <span style="min-width:54px;opacity:0.7;">Format</span>
        <select id="ge-export-format" style="flex:1;padding:5px 8px;background:#1d1d22;border:1px solid rgba(255,255,255,0.15);border-radius:5px;color:#eee;">${opts}</select>
      </label>
      <label id="ge-export-q-row" style="display:flex;align-items:center;gap:8px;margin:6px 0;font-size:12px;">
        <span style="min-width:54px;opacity:0.7;">Quality</span>
        <input id="ge-export-q" type="range" min="10" max="100" value="92" style="flex:1;">
        <span id="ge-export-q-val" style="min-width:36px;text-align:right;opacity:0.85;">92%</span>
      </label>
      <p id="ge-export-alpha-note" style="font-size:10px;opacity:0.55;margin:4px 0 0;"></p>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
        <button id="ge-export-cancel" class="ge-btn">Cancel</button>
        <button id="ge-export-ok" class="ge-btn ge-btn-primary">Export</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const fmtSel = overlay.querySelector('#ge-export-format');
  const qRow = overlay.querySelector('#ge-export-q-row');
  const qIn = overlay.querySelector('#ge-export-q');
  const qVal = overlay.querySelector('#ge-export-q-val');
  const note = overlay.querySelector('#ge-export-alpha-note');
  const sync = () => {
    const f = EXPORT_FORMATS.find((x) => x.id === fmtSel.value) || EXPORT_FORMATS[0];
    qRow.style.display = f.lossy ? '' : 'none';
    note.textContent = f.alpha ? 'Transparency preserved.' : 'No alpha — transparent areas become white.';
  };
  qIn.addEventListener('input', () => { qVal.textContent = qIn.value + '%'; });
  fmtSel.addEventListener('change', sync);
  sync();
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); _activePromptClose = null; };
  _activePromptClose = close;
  const apply = () => {
    const fmt = fmtSel.value;
    const q = parseInt(qIn.value, 10) / 100;
    close();
    try { downloadImage(flatten(), fmt, q, 'image'); }
    catch (e) { uiModule.showToast('Export failed'); }
  };
  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); apply(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); close(); }
  };
  overlay.querySelector('#ge-export-ok').addEventListener('click', apply);
  overlay.querySelector('#ge-export-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => { fmtSel.focus(); }, 0);
}

// Themed prompt for placing a LINKED image (Smart Object whose source is an
// external URL — e.g. a gallery asset — that "Update Linked" can re-fetch).
function _promptLinkUrl() {
  let overlay = document.getElementById('ge-link-url-overlay');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.id = 'ge-link-url-overlay';
  overlay.className = 'modal';
  overlay.innerHTML = `
    <div class="ge-prompt-card" style="background:#26262b;border:1px solid rgba(255,255,255,0.14);border-radius:10px;padding:18px;min-width:320px;color:#eee;box-shadow:0 18px 48px rgba(0,0,0,0.55);">
      <div style="font-weight:600;margin-bottom:10px;">Place Linked Image</div>
      <p style="font-size:11px;opacity:0.6;margin:0 0 8px;">The layer becomes a Smart Object linked to this image URL. "Update Linked Contents" re-fetches the latest version.</p>
      <input id="ge-link-url" type="text" placeholder="https://…/image.png" style="width:100%;box-sizing:border-box;padding:6px 9px;background:#1d1d22;border:1px solid rgba(255,255,255,0.15);border-radius:5px;color:#eee;font:inherit;">
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
        <button id="ge-link-cancel" class="ge-btn">Cancel</button>
        <button id="ge-link-ok" class="ge-btn ge-btn-primary">Place</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const input = overlay.querySelector('#ge-link-url');
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); _activePromptClose = null; };
  _activePromptClose = close;
  const apply = () => { const url = input.value.trim(); if (!url) { close(); return; } close(); _smartObject.linkToUrl(url); };
  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); apply(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); close(); }
  };
  overlay.querySelector('#ge-link-ok').addEventListener('click', apply);
  overlay.querySelector('#ge-link-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => { input.focus(); }, 0);
}

// Export Animation… — pick GIF / WebM + FPS (+ loop for GIF) and download all
// the timeline's frames. Frames come from the animation controller; if anim
// mode is off there's nothing to export.
function _promptExportAnim() {
  if (!_anim || !_anim.isEnabled()) { uiModule.showToast('Turn on the Animation Timeline first (View ▸ Animation Timeline)'); return; }
  let overlay = document.getElementById('ge-expanim-overlay');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.id = 'ge-expanim-overlay';
  overlay.className = 'modal';
  const opts = ANIM_FORMATS.map((f) => `<option value="${f.id}">${f.label}</option>`).join('');
  const defFps = (state.anim && state.anim.fps) || 12;
  overlay.innerHTML = `
    <div class="ge-prompt-card" style="background:#26262b;border:1px solid rgba(255,255,255,0.14);border-radius:10px;padding:18px;min-width:300px;color:#eee;box-shadow:0 18px 48px rgba(0,0,0,0.55);">
      <div style="font-weight:600;margin-bottom:12px;">Export Animation</div>
      <label style="display:flex;align-items:center;gap:8px;margin:6px 0;font-size:12px;">
        <span style="min-width:54px;opacity:0.7;">Format</span>
        <select id="ge-expanim-format" style="flex:1;padding:5px 8px;background:#1d1d22;border:1px solid rgba(255,255,255,0.15);border-radius:5px;color:#eee;">${opts}</select>
      </label>
      <label style="display:flex;align-items:center;gap:8px;margin:6px 0;font-size:12px;">
        <span style="min-width:54px;opacity:0.7;">FPS</span>
        <input id="ge-expanim-fps" type="number" min="1" max="60" value="${defFps}" style="width:60px;padding:5px 8px;background:#1d1d22;border:1px solid rgba(255,255,255,0.15);border-radius:5px;color:#eee;">
      </label>
      <label id="ge-expanim-loop-row" style="display:flex;align-items:center;gap:8px;margin:6px 0;font-size:12px;cursor:pointer;">
        <input id="ge-expanim-loop" type="checkbox" checked> Loop (GIF)
      </label>
      <p id="ge-expanim-note" style="font-size:10px;opacity:0.55;margin:4px 0 0;"></p>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
        <button id="ge-expanim-cancel" class="ge-btn">Cancel</button>
        <button id="ge-expanim-ok" class="ge-btn ge-btn-primary">Export</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const fmt = overlay.querySelector('#ge-expanim-format');
  const loopRow = overlay.querySelector('#ge-expanim-loop-row');
  const note = overlay.querySelector('#ge-expanim-note');
  const sync = () => {
    loopRow.style.display = fmt.value === 'gif' ? '' : 'none';
    note.textContent = fmt.value === 'webm' ? 'WebM records in real time via the browser; keep the tab focused.' : `${(state.anim && state.anim.frameCount) || 1} frames.`;
  };
  fmt.addEventListener('change', sync); sync();
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); _activePromptClose = null; };
  _activePromptClose = close;
  const apply = async () => {
    const format = fmt.value;
    const fps = parseInt(overlay.querySelector('#ge-expanim-fps').value, 10) || 12;
    const loop = overlay.querySelector('#ge-expanim-loop').checked;
    close();
    try {
      uiModule.showToast('Encoding ' + format.toUpperCase() + '…');
      const blob = await exportAnimation(_anim.frameCanvases(), { format, fps, loop });
      downloadAnim(blob, format);
    } catch (e) { uiModule.showToast('Animation export failed: ' + (e && e.message || e)); }
  };
  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); apply(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); close(); }
  };
  overlay.querySelector('#ge-expanim-ok').addEventListener('click', apply);
  overlay.querySelector('#ge-expanim-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey, true);
}

// Transparency-checkerboard preferences (PS parity) — square size + the two
// square colours, with Light/Medium/Dark/Charcoal presets + custom colours and
// a live preview. Changes apply immediately and persist in localStorage.
function _persistChecker() {
  try { localStorage.setItem('ge-checker', JSON.stringify({ size: checkerConfig.size, c1: checkerConfig.c1, c2: checkerConfig.c2 })); } catch {}
}
function _applyChecker(cfg) {
  setChecker(cfg);
  _persistChecker();
  composite();
  const pv = document.getElementById('ge-checker-preview');
  if (pv) _drawCheckerboard(pv.getContext('2d'), pv.width, pv.height);
  const c1 = document.getElementById('ge-checker-c1'); if (c1) c1.value = checkerConfig.c1;
  const c2 = document.getElementById('ge-checker-c2'); if (c2) c2.value = checkerConfig.c2;
}
function _loadChecker() {
  try { const s = JSON.parse(localStorage.getItem('ge-checker') || 'null'); if (s) setChecker(s); } catch {}
}
function _promptCheckerboard() {
  let overlay = document.getElementById('ge-checker-overlay');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.id = 'ge-checker-overlay';
  overlay.className = 'modal';
  const sizeBtns = Object.entries(CHECKER_SIZES).map(([k, v]) => `<button type="button" class="ge-btn ge-btn-sm ge-chk-size" data-size="${v}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('');
  const presetBtns = Object.keys(CHECKER_PRESETS).map((k) => `<button type="button" class="ge-btn ge-btn-sm ge-chk-preset" data-preset="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('');
  overlay.innerHTML = `
    <div class="ge-prompt-card" style="background:#26262b;border:1px solid rgba(255,255,255,0.14);border-radius:10px;padding:18px;min-width:320px;color:#eee;box-shadow:0 18px 48px rgba(0,0,0,0.55);">
      <div style="font-weight:600;margin-bottom:10px;">Transparency Checkerboard</div>
      <canvas id="ge-checker-preview" width="288" height="64" style="width:100%;height:64px;border:1px solid rgba(255,255,255,0.2);border-radius:5px;display:block;image-rendering:pixelated;"></canvas>
      <div style="font-size:11px;opacity:0.7;margin:10px 0 4px;">Grid size</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">${sizeBtns}</div>
      <div style="font-size:11px;opacity:0.7;margin:10px 0 4px;">Grid colors</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">${presetBtns}</div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:10px;font-size:11px;">
        <label style="display:inline-flex;align-items:center;gap:5px;">Square A <input id="ge-checker-c1" type="color" value="${checkerConfig.c1}" style="width:30px;height:22px;padding:0;border:1px solid rgba(255,255,255,0.2);border-radius:3px;background:none;cursor:pointer;"></label>
        <label style="display:inline-flex;align-items:center;gap:5px;">Square B <input id="ge-checker-c2" type="color" value="${checkerConfig.c2}" style="width:30px;height:22px;padding:0;border:1px solid rgba(255,255,255,0.2);border-radius:3px;background:none;cursor:pointer;"></label>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
        <button id="ge-checker-done" class="ge-btn ge-btn-primary">Done</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const pv = overlay.querySelector('#ge-checker-preview');
  _drawCheckerboard(pv.getContext('2d'), pv.width, pv.height);
  overlay.querySelectorAll('.ge-chk-size').forEach((b) => b.addEventListener('click', () => _applyChecker({ size: parseInt(b.dataset.size, 10) })));
  overlay.querySelectorAll('.ge-chk-preset').forEach((b) => b.addEventListener('click', () => _applyChecker(CHECKER_PRESETS[b.dataset.preset])));
  overlay.querySelector('#ge-checker-c1').addEventListener('input', (e) => _applyChecker({ c1: e.target.value }));
  overlay.querySelector('#ge-checker-c2').addEventListener('input', (e) => _applyChecker({ c2: e.target.value }));
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); _activePromptClose = null; };
  _activePromptClose = close;
  const onKey = (e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); close(); } };
  overlay.querySelector('#ge-checker-done').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey, true);
}

// Themed prompt for Image Size: W / H with an optional aspect lock + an
// interpolation method selector. Self-contained overlay (no shared markup) so
// it can't regress the new-canvas dialog.
function _promptImageSize() {
  const oldW = state.imgWidth || 1024, oldH = state.imgHeight || 1024;
  let overlay = document.getElementById('ge-image-size-overlay');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.id = 'ge-image-size-overlay';
  overlay.className = 'modal';
  overlay.innerHTML = `
    <div class="ge-prompt-card" style="background:#26262b;border:1px solid rgba(255,255,255,0.14);border-radius:10px;padding:18px;min-width:280px;color:#eee;box-shadow:0 18px 48px rgba(0,0,0,0.55);">
      <div style="font-weight:600;margin-bottom:12px;">Image size (resample)</div>
      <label style="display:flex;align-items:center;gap:8px;margin:6px 0;font-size:12px;">
        <span style="min-width:54px;opacity:0.7;">Width</span>
        <input id="ge-is-w" type="number" min="1" max="8192" value="${oldW}" style="flex:1;min-width:0;padding:5px 8px;background:#1d1d22;border:1px solid rgba(255,255,255,0.15);border-radius:5px;color:#eee;">
        <span style="opacity:0.5;">px</span>
      </label>
      <label style="display:flex;align-items:center;gap:8px;margin:6px 0;font-size:12px;">
        <span style="min-width:54px;opacity:0.7;">Height</span>
        <input id="ge-is-h" type="number" min="1" max="8192" value="${oldH}" style="flex:1;min-width:0;padding:5px 8px;background:#1d1d22;border:1px solid rgba(255,255,255,0.15);border-radius:5px;color:#eee;">
        <span style="opacity:0.5;">px</span>
      </label>
      <label style="display:flex;align-items:center;gap:8px;margin:8px 0;font-size:12px;cursor:pointer;">
        <input id="ge-is-lock" type="checkbox" checked> Constrain proportions
      </label>
      <label style="display:flex;align-items:center;gap:8px;margin:8px 0;font-size:12px;">
        <span style="min-width:54px;opacity:0.7;">Resample</span>
        <select id="ge-is-method" style="flex:1;padding:5px 8px;background:#1d1d22;border:1px solid rgba(255,255,255,0.15);border-radius:5px;color:#eee;">
          <option value="bicubic">Bicubic (smoother)</option>
          <option value="bilinear" selected>Bilinear</option>
          <option value="nearest">Nearest (hard edges)</option>
        </select>
      </label>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
        <button id="ge-is-cancel" class="ge-btn">Cancel</button>
        <button id="ge-is-ok" class="ge-btn ge-btn-primary">Resample</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const wIn = overlay.querySelector('#ge-is-w');
  const hIn = overlay.querySelector('#ge-is-h');
  const lock = overlay.querySelector('#ge-is-lock');
  const methodSel = overlay.querySelector('#ge-is-method');
  const aspect = oldW / oldH;
  const clamp = (n) => Math.max(1, Math.min(8192, Math.round(n)));
  wIn.addEventListener('input', () => { if (lock.checked) { const w = parseInt(wIn.value, 10); if (w > 0) hIn.value = String(clamp(w / aspect)); } });
  hIn.addEventListener('input', () => { if (lock.checked) { const h = parseInt(hIn.value, 10); if (h > 0) wIn.value = String(clamp(h * aspect)); } });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); _activePromptClose = null; };
  _activePromptClose = close; // let the Escape hard guard dismiss this prompt
  const apply = () => {
    const w = parseInt(wIn.value, 10), h = parseInt(hIn.value, 10);
    if (!(w > 0) || !(h > 0)) { uiModule.showToast('Invalid size'); return; }
    close();
    _resampleImage(w, h, methodSel.value);
  };
  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); apply(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); close(); }
  };
  overlay.querySelector('#ge-is-ok').addEventListener('click', apply);
  overlay.querySelector('#ge-is-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => { wIn.focus(); wIn.select(); }, 0);
}

// Text tool was removed from the toolbar; the _placeText implementation
// (and the `state.tool === 'text'` dispatcher branch) used to live here
// but had no remaining call sites and was dead code.

// ── Free Transform (Ctrl+Alt+T) ──

// Transform session — full implementation in
// editor/tools/transform-session.js. Wrappers preserve the legacy
// names that the dispatcher / toolbar / shortcuts already reference.
const _transformSession = createTransformSession({
  activeLayer,
  saveState: _saveState,
  composite,
  fitZoom: () => _fitZoom(),
  drawTransformHandles: () => _drawTransformHandles(),
  showCanvasLoading: (label) => _showCanvasLoading(label),
  hideCanvasLoading: () => _hideCanvasLoading(),
  undo,
  uiModule,
});
// Smart Objects — non-destructive re-editable layers (pristine source + applied
// transform). Full implementation in editor/smart-object.js.
const _smartObject = createSmartObject({
  activeLayer: () => activeLayer() || _activeParentLayer(),
  saveState: _saveState,
  composite,
  renderLayerPanel: () => _renderLayerPanel(),
  uiModule,
});

const _startTransform      = _transformSession.startTransform;
const _openTransformPopup  = _transformSession.openTransformPopup;
const _closeTransformPopup = _transformSession.closeTransformPopup;
const _reapplyTransform    = _transformSession.reapplyTransform;
const _confirmTransform    = _transformSession.confirmTransform;
const _cancelTransform     = _transformSession.cancelTransform;

// ── Lasso tool ──

// Lasso tool — full implementation in editor/tools/lasso.js.
const _lassoTool = createLassoTool({
  composite,
  drawLassoOverlay: () => _drawLassoOverlay(),
  syncToolClearIndicators: () => _syncToolClearIndicators(),
});
const _beginLasso    = _lassoTool.begin;
const _continueLasso = _lassoTool.drag;
const _endLasso      = _lassoTool.end;

// Polygonal Lasso — click-to-place straight-edge selection. Shares the lasso's
// selection machinery (writes state.lassoPoints), so all lasso actions apply.
const _polyLassoTool = createPolyLassoTool({
  composite,
  drawLassoOverlay: () => _drawLassoOverlay(),
  syncToolClearIndicators: () => _syncToolClearIndicators(),
});

// Magnetic Lasso — edge-snapping selection. Shares the lasso machinery (writes
// state.lassoPoints). Full implementation in editor/tools/magnetic-lasso.js.
const _magLassoTool = createMagneticLassoTool({
  composite,
  drawLassoOverlay: () => _drawLassoOverlay(),
  syncToolClearIndicators: () => _syncToolClearIndicators(),
});

// Brush quick-pick popup (right-click with Brush/Eraser) — Size/Hardness +
// preset thumbnails. Full implementation in editor/brush-quickpick.js.
const _brushQuickPick = createBrushQuickPick();

// Shape tool — drag to draw a rect/ellipse/line filled/stroked with the FG
// colour onto the active layer. Full implementation in editor/tools/shapes.js.
const _shapeTool = createShapeTool({
  activeLayer: () => activeLayer() || _activeParentLayer(),
  saveState: _saveState,
  composite,
});

// Red Eye — single-click desaturation of strongly-red pixels. editor/tools/red-eye.js.
const _redEyeTool = createRedEyeTool({
  activeLayer: () => activeLayer() || _activeParentLayer(),
  saveState: _saveState,
  composite,
});

// Ruler — non-destructive measure overlay (length + angle). editor/tools/ruler.js.
const _rulerTool = createRulerTool({ composite });

// Magic wand — selection-only click handler in editor/tools/wand.js.
const _wandTool = createWandTool({
  activeLayer,
  saveState: _saveState,
  composite,
  wandHits: (x, y) => _wandHits(x, y),
  runMagicWand: (x, y, mode) => _runMagicWand(x, y, mode),
});

// Clone-stamp tool — source-pick + stroke-start handler in
// editor/tools/clone.js. Per-sample stamping still runs through the
// shared stroke pipeline (`_strokeTo`) since clone-mode is detected
// there from state.cloneSourceSnapshot.
const _cloneTool = createCloneTool({
  activeLayer,
  saveState: _saveState,
  strokeTo: (x, y) => _strokeTo(x, y),
  showToast: (msg) => { if (uiModule) uiModule.showToast(msg); },
});

// Transform-tool drag interactions (handle picking, rotation, resize)
// in editor/tools/transform-drag.js. The dispatcher calls
// `tryBegin/tryContinue/tryEnd` and short-circuits when they return true.
const _transformDragTool = createTransformDragTool({
  beginMove: (e) => _beginMove(e),
  composite,
  drawTransformHandles: () => _drawTransformHandles(),
  reapplyTransform: () => _reapplyTransform(),
  getTransformHandle: (x, y) => _getTransformHandle(x, y),
  cursorForHandle: _cursorForHandle,
});

// Shared stroke pipeline (brush / eraser / inpaint) in
// editor/tools/stroke.js. Clone reuses tryContinue / tryEnd via the
// shared drawing flag; clone's own begin is in editor/tools/clone.js.
const _strokeTool = createStrokeTool({
  saveState: _saveState,
  strokeTo: (x, y) => _strokeTo(x, y),
  composite,
  getActiveMaskLayer: () => _getActiveMaskLayer(),
  activeParentLayer: () => _activeParentLayer(),
  ensureActiveMaskLayer: () => _ensureActiveMaskLayer(),
  createLayer,
  renderLayerPanel: () => _renderLayerPanel(),
  syncToolClearIndicators: () => _syncToolClearIndicators(),
});

// Gradient tool — drag to fill the active layer with a FG→BG / FG→transparent
// linear or radial gradient. Full implementation in editor/tools/gradient.js.
const _gradientTool = createGradientTool({
  activeLayer: () => activeLayer() || _activeParentLayer(),
  saveState: _saveState,
  composite,
});

// Marquee selection (rect/ellipse) — writes state.lassoPoints to reuse the
// lasso selection machinery. Full implementation in editor/tools/marquee.js.
const _marqueeTool = createMarqueeTool({
  composite,
  drawLassoOverlay: () => _drawLassoOverlay(),
});

// Liquify (forward-warp / push) — editor/tools/liquify.js.
const _liquifyTool = createLiquifyTool({
  activeLayer: () => activeLayer() || _activeParentLayer(),
  saveState: _saveState,
  composite,
});

// Smudge (smear) — editor/tools/smudge.js.
const _smudgeTool = createSmudgeTool({
  activeLayer: () => activeLayer() || _activeParentLayer(),
  saveState: _saveState,
  composite,
});

// Dodge / Burn / Sponge — editor/tools/dodgeburn.js.
const _dodgeBurnTool = createDodgeBurnTool({
  activeLayer: () => activeLayer() || _activeParentLayer(),
  saveState: _saveState,
  composite,
});

// Mixer Brush (wet-paint blending) — editor/tools/mixer.js.
const _mixerTool = createMixerTool({
  activeLayer: () => activeLayer() || _activeParentLayer(),
  saveState: _saveState,
  composite,
});

// Spot Healing brush — editor/tools/heal.js.
const _healTool = createHealTool({
  activeLayer: () => activeLayer() || _activeParentLayer(),
  saveState: _saveState,
  composite,
});

// Paint Bucket (flood fill) — editor/tools/bucket.js.
const _bucketTool = createBucketTool({
  activeLayer: () => activeLayer() || _activeParentLayer(),
  saveState: _saveState,
  composite,
});

// Distort (free 4-corner warp) — editor/tools/distort.js.
const _distortTool = createDistortTool({
  activeLayer: () => activeLayer() || _activeParentLayer(),
  saveState: _saveState,
  composite,
});

// Perspective crop — de-skew a marked quad to a rectangle (editor/tools/perspective-crop.js).
function _applyPerspectiveCrop(corners) {
  const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const [TL, TR, BR, BL] = corners;
  const outW = Math.max(1, Math.round((d2(TL, TR) + d2(BL, BR)) / 2));
  const outH = Math.max(1, Math.round((d2(TL, BL) + d2(TR, BR)) / 2));
  _saveState('Perspective crop');
  for (const layer of state.layers) {
    const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
    const lc = corners.map((c) => ({ x: c.x - off.x, y: c.y - off.y }));
    const res = _unwarpQuad(layer.canvas, lc, outW, outH);
    layer.canvas.width = outW; layer.canvas.height = outH;
    layer.ctx.clearRect(0, 0, outW, outH);
    layer.ctx.drawImage(res, 0, 0);
    layer.layerMask = null; // mask sizes no longer match; drop on geometry change
    state.layerOffsets.set(layer.id, { x: 0, y: 0 });
  }
  state.mainCanvas.width = outW; state.mainCanvas.height = outH;
  state.imgWidth = outW; state.imgHeight = outH;
  if (state.maskCanvas) { state.maskCanvas.width = outW; state.maskCanvas.height = outH; }
  state.wandMask = null; state.wandLayerId = null;
  composite();
  _fitZoom();
}
const _pcropTool = createPerspectiveCropTool({
  activeLayer: () => activeLayer() || _activeParentLayer(),
  composite,
  applyCrop: _applyPerspectiveCrop,
});

// Solid fill of the active layer (or the active wand selection) with a colour —
// Alt+Backspace = foreground, Ctrl+Backspace = background. Honours lock-alpha.
function _fillActiveLayer(color) {
  const layer = activeLayer();
  if (!layer || layer.locked) return;
  _saveState('Fill');
  const ctx = layer.ctx;
  const w = layer.canvas.width, h = layer.canvas.height;
  let snap = null;
  if (layer.lockAlpha) {
    snap = document.createElement('canvas'); snap.width = w; snap.height = h;
    snap.getContext('2d').drawImage(layer.canvas, 0, 0);
  }
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  if (state.wandMask) {
    // Constrain to the active wand selection (white = selected, image-space).
    const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
    const tctx = tmp.getContext('2d');
    tctx.fillStyle = color; tctx.fillRect(0, 0, w, h);
    tctx.globalCompositeOperation = 'destination-in';
    tctx.drawImage(state.wandMask, 0, 0);
    ctx.drawImage(tmp, 0, 0);
  } else {
    ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
  }
  if (snap) { ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(snap, 0, 0); }
  ctx.restore();
  composite();
}

// Stamp Visible (Ctrl+Alt+Shift+E) — flatten all visible layers into a NEW layer
// on top, leaving the originals intact. Reuses the shared layer renderer.
function _stampVisible() {
  if (!state.imgWidth || !state.imgHeight) return;
  if (!state.layers.some((l) => l.visible)) return;
  _saveState('Stamp Visible');
  const merged = createLayer('Merged', state.imgWidth, state.imgHeight);
  _renderLayersTo(merged.ctx, merged.canvas); // current visible layers (merged not yet in the stack)
  state.layerOffsets.set(merged.id, { x: 0, y: 0 });
  state.layers.push(merged); // top of the stack
  state.activeLayerId = merged.id;
  composite();
  _renderLayerPanel();
  if (uiModule) uiModule.showToast('Stamped visible to a new layer');
}

// Compute the outward-normal offset of the lasso polygon by `grow`
// pixels at each vertex. Lets the Edge stroke slider visually move
// the dashed outline in/out without re-running the mask raster.
// Thin wrapper around the pure helper in editor/tools/lasso-mask.js
// so existing callers using module state stay unchanged.
function _lassoOffsetPoints(grow) {
  return _lassoOffsetPointsImpl(state.lassoPoints, grow);
}

function _drawLassoOverlay() {
  if (state.lassoPoints.length < 3) return;
  // Read live slider values so the overlay shows the actual edge that
  // will be committed: Edge stroke shifts the polygon outline in/out;
  // Feather draws a soft red halo to suggest the alpha fade.
  const featherEl = document.getElementById('ge-lasso-feather');
  const growEl = document.getElementById('ge-lasso-grow');
  const feather = featherEl ? parseInt(featherEl.value || '0', 10) : 0;
  const grow = growEl ? parseInt(growEl.value || '0', 10) : 0;
  const ringPts = grow ? _lassoOffsetPoints(grow) : state.lassoPoints;
  const tracePath = (pts) => {
    state.mainCtx.beginPath();
    state.mainCtx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) state.mainCtx.lineTo(pts[i].x, pts[i].y);
    state.mainCtx.closePath();
  };
  if (feather > 0) {
    // Concentric outer outlines that fade out, suggesting the feather
    // fade band that will be applied to the mask alpha at commit.
    const rings = 4;
    for (let r = 1; r <= rings; r++) {
      const offset = (feather * r) / rings;
      tracePath(_lassoOffsetPoints(grow + offset));
      state.mainCtx.strokeStyle = `rgba(255, 80, 80, ${0.4 * (1 - r / rings)})`;
      state.mainCtx.lineWidth = 1 / state.zoom;
      state.mainCtx.setLineDash([]);
      state.mainCtx.stroke();
    }
  }
  tracePath(ringPts);
  // Marching ants: a solid black underlay + crawling white dashes (offset by the
  // animated phase) so the outline reads on any background and "moves" like PS.
  state.mainCtx.lineWidth = 1 / state.zoom;
  state.mainCtx.setLineDash([]);
  state.mainCtx.lineDashOffset = 0;
  state.mainCtx.strokeStyle = '#000';
  state.mainCtx.stroke();
  state.mainCtx.setLineDash([4 / state.zoom, 4 / state.zoom]);
  state.mainCtx.lineDashOffset = -_antsPhase / state.zoom;
  state.mainCtx.strokeStyle = '#fff';
  state.mainCtx.stroke();
  state.mainCtx.setLineDash([]);
  state.mainCtx.lineDashOffset = 0;
  state.mainCtx.fillStyle = 'rgba(255, 80, 80, 0.08)';
  state.mainCtx.fill();
}

function _getLassoPath(ctx) {
  _getLassoPathImpl(ctx, state.lassoPoints);
}

/**
 * Build a feathered selection mask from the current lasso polygon.
 * Implementation lives in editor/tools/lasso-mask.js — this wrapper
 * forwards the current `state.lassoPoints` so existing callers keep
 * working unchanged.
 */
function _buildLassoMask(w, h, offX, offY, feather, grow) {
  return _buildLassoMaskImpl(state.lassoPoints, w, h, offX, offY, feather, grow);
}

// ── Magic Wand ──

// Click-fill from (cx, cy) on the active layer. Builds a binary mask of
// all pixels reachable from the seed whose RGB distance is within
// state.wandTolerance × 4.42 (4.42 ≈ scale factor so tolerance=100 ≈ max).
//
// `mode`:
//   'replace'  (default) — replaces any previous selection
//   'add'      — unions the new region with the existing selection
//   'subtract' — removes the new region from the existing selection
// Cached layer pixel data + dimensions for the wand. `getImageData` is
// the dominant cost when live-retuning tolerance (millions of pixels →
// 50–200 ms per call on a 4K canvas). Invalidated by _invalidateWandCache
// whenever the active layer changes or the editor closes.
// Pristine snapshot of the last Bg-Removed cutout so the Edge cleanup
// sliders can live-rebuild the alpha without re-running the model.
function _invalidateWandCache() { state.wandSrcCache = null; }
function _getWandSource(layer) {
  if (state.wandSrcCache && state.wandSrcCache.layerId === layer.id
      && state.wandSrcCache.w === layer.canvas.width
      && state.wandSrcCache.h === layer.canvas.height) {
    return state.wandSrcCache;
  }
  const w = layer.canvas.width, h = layer.canvas.height;
  state.wandSrcCache = {
    layerId: layer.id, w, h,
    data: layer.ctx.getImageData(0, 0, w, h).data,
  };
  return state.wandSrcCache;
}

// Click-deselect helper: returns true if (cx, cy) lands inside the
// existing wand selection on the same layer. Used by the mousedown
// handler to make a second click "in the selection" toggle it off.
function _wandHits(cx, cy) {
  if (!state.wandMask || !state.wandLayerId) return false;
  const layer = state.layers.find(l => l.id === state.wandLayerId);
  if (!layer) return false;
  const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
  const lx = Math.floor(cx - off.x);
  const ly = Math.floor(cy - off.y);
  if (lx < 0 || ly < 0 || lx >= state.wandMask.width || ly >= state.wandMask.height) return false;
  try {
    const px = state.wandMask.getContext('2d').getImageData(lx, ly, 1, 1).data;
    return px[3] > 128;
  } catch { return false; }
}

function _runMagicWand(cx, cy, mode = 'replace', opts = {}) {
  if (!opts.retune && !opts.deferred) {
    const cleanup = _showWandLoading();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          _runMagicWand(cx, cy, mode, { ...opts, deferred: true });
        } finally {
          cleanup();
        }
      });
    });
    return;
  }
  const layer = activeLayer();
  if (!layer || layer.locked) return;
  // If an active mask sub-layer is selected, the wand operates on the
  // MASK pixels rather than the parent layer's pixels — lets the user
  // click inside / outside an existing mask to select that region for
  // further editing. Mask canvases are doc-sized with no per-layer
  // offset, so the seed coords are used as-is.
  const activeMask = _getActiveMaskLayer();
  const sourceCanvas = activeMask ? activeMask.canvas : layer.canvas;
  const sourceCtx = activeMask ? activeMask.ctx : layer.ctx;
  // Snapshot current state to undo BEFORE mutating the selection, but
  // skip when called via the tolerance slider (`opts.retune`) so dragging
  // the slider doesn't fill the undo stack with intermediate states.
  if (!opts.retune) _saveState();
  // Remember the seed so the tolerance slider can re-run the wand live.
  state.wandLastSeed = { x: cx, y: cy, mode };
  const off = activeMask ? { x: 0, y: 0 } : (state.layerOffsets.get(layer.id) || { x: 0, y: 0 });
  const lx = Math.floor(cx - off.x);
  const ly = Math.floor(cy - off.y);
  const w = sourceCanvas.width, h = sourceCanvas.height;
  if (lx < 0 || ly < 0 || lx >= w || ly >= h) return;
  // Read pixels from the chosen source. Bypass the cache when sourcing
  // from a mask — masks change frequently and the cache is keyed by
  // parent layer id, not by mask id.
  const src = activeMask
    ? sourceCtx.getImageData(0, 0, w, h).data
    : _getWandSource(layer).data;
  // Pixel-level flood fill lives in editor/tools/flood-fill.js.
  // Returns a mask canvas at (w × h) with white where the fill landed.
  const mask = _floodFillMask(src, w, h, lx, ly, state.wandTolerance);
  if (!mask) return;
  // Merge with existing selection per `mode`. If the existing mask is
  // for a different layer or has different dimensions, treat as replace
  // since merging doesn't make sense across canvases.
  const compatible = state.wandMask && state.wandLayerId === layer.id &&
    state.wandMask.width === mask.width && state.wandMask.height === mask.height;
  if (compatible && mode === 'add') {
    // Union: paint new selection on top of the existing one.
    state.wandMask.getContext('2d').drawImage(mask, 0, 0);
    state.wandMask._ants = null; // invalidate marching-ants boundary cache
  } else if (compatible && mode === 'subtract') {
    // Difference: erase new selection from the existing one.
    const ec = state.wandMask.getContext('2d');
    ec.save();
    ec.globalCompositeOperation = 'destination-out';
    ec.drawImage(mask, 0, 0);
    ec.restore();
    state.wandMask._ants = null;
  } else {
    state.wandMask = mask;
    state.wandLayerId = layer.id;
  }
  composite();
  _syncToolClearIndicators();
}

// Color Range — select every pixel matching the foreground colour within the
// wand Tolerance (reused as fuzziness), globally (not contiguous). Builds the
// shared wand selection so it reuses overlay / delete / invert / feather.
function _runColorRange() {
  const layer = activeLayer();
  if (!layer || layer.locked) return;
  _saveState();
  const w = layer.canvas.width, h = layer.canvas.height;
  const src = _getWandSource(layer).data;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(state.color || '#000000');
  const hex = m ? m[1] : '000000';
  const target = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  const mask = _colorRangeMask(src, w, h, target, state.wandTolerance);
  state.wandMask = mask;
  state.wandLayerId = layer.id;
  state.wandLastSeed = null;
  state.wandMaskVisible = true;
  composite();
  _syncToolClearIndicators();
}

// Quick Selection — drag-flood: as you drag, flood-fill from the cursor into the
// similar-coloured contiguous region (wand Tolerance) and union into the shared
// selection. Skips points already selected so a drag efficiently extends into new
// regions. Reuses the wand's flood-fill + mask plumbing.
function _quickSelectAt(cx, cy) {
  const layer = activeLayer();
  if (!layer) return;
  const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
  const lx = Math.floor(cx - off.x), ly = Math.floor(cy - off.y);
  const w = layer.canvas.width, h = layer.canvas.height;
  if (lx < 0 || ly < 0 || lx >= w || ly >= h) return;
  const compatible = state.wandMask && state.wandLayerId === layer.id &&
    state.wandMask.width === w && state.wandMask.height === h;
  if (compatible && state.wandMask.getContext('2d').getImageData(lx, ly, 1, 1).data[3] > 128) return; // already selected
  const src = _getWandSource(layer).data;
  const mask = _floodFillMask(src, w, h, lx, ly, state.wandTolerance);
  if (!mask) return;
  if (compatible) { state.wandMask.getContext('2d').drawImage(mask, 0, 0); state.wandMask._ants = null; } // union → invalidate ants cache
  else { state.wandMask = mask; state.wandLayerId = layer.id; }
  state.wandMaskVisible = true;
  state.wandLastSeed = null;
  composite();
}

// ── Text / Type tool ──
// A text layer is a normal raster layer that also carries `layer.text`
// ({content,x,y,size,color,font}); the text is rasterised onto the layer canvas
// whenever it changes, and the field is kept for re-editing (double-click).
function _renderTextLayer(layer) {
  const t = layer && layer.text;
  if (!t) return;
  const ctx = layer.ctx;
  ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  ctx.fillStyle = t.color || '#000000';
  ctx.textBaseline = 'top';
  ctx.font = `${t.size}px ${t.font || 'sans-serif'}`;
  const lines = String(t.content || '').split('\n');
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], t.x, t.y + i * t.size * 1.25);
}
function _placeTextLayer(e) {
  const c = _canvasCoords(e, state.mainCanvas);
  _saveState('Text');
  const layer = createLayer('Text', state.imgWidth, state.imgHeight);
  layer.text = { content: '', x: Math.round(c.x), y: Math.round(c.y), size: state.textSize || 48, color: state.color || '#000000', font: state.textFont || 'sans-serif' };
  state.layers.push(layer);
  state.activeLayerId = layer.id;
  _renderLayerPanel();
  _openTextEditor(layer);
}
function _positionTextEditor(inp, layer) {
  const canvas = state.mainCanvas;
  const area = state.container.querySelector('.ge-canvas-area');
  if (!canvas || !area) return;
  const rect = canvas.getBoundingClientRect(), arect = area.getBoundingClientRect();
  const z = state.zoom || 1;
  inp.style.left = (rect.left - arect.left + layer.text.x * z) + 'px';
  inp.style.top = (rect.top - arect.top + layer.text.y * z) + 'px';
  inp.style.fontSize = (layer.text.size * z) + 'px';
  inp.style.color = layer.text.color;
}
function _openTextEditor(layer) {
  const area = state.container.querySelector('.ge-canvas-area');
  if (!area) return;
  document.getElementById('ge-text-input')?.remove();
  const inp = document.createElement('textarea');
  inp.id = 'ge-text-input';
  inp.className = 'ge-text-input';
  inp.value = layer.text.content;
  inp.rows = 1;
  inp.style.cssText = 'position:absolute;z-index:80;background:rgba(0,0,0,0.30);border:1px dashed #4af;outline:none;font-family:sans-serif;line-height:1.25;resize:none;overflow:hidden;white-space:pre;padding:0;margin:0;min-width:40px;';
  _positionTextEditor(inp, layer);
  inp.style.fontFamily = layer.text.font || 'sans-serif';
  area.appendChild(inp);
  state.textEditingLayerId = layer.id;
  inp.focus();
  inp.addEventListener('input', () => { layer.text.content = inp.value; _renderTextLayer(layer); composite(); });
  inp.addEventListener('keydown', (ev) => {
    ev.stopPropagation(); // don't fire editor shortcuts while typing
    if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey))) { ev.preventDefault(); _commitText(layer, inp); }
  });
  inp.addEventListener('blur', () => _commitText(layer, inp));
}
function _commitText(layer, inp) {
  // Removing the focused textarea fires `blur`, which re-enters here — guard so
  // we only commit once (idempotent).
  if (!inp || inp._committed) return;
  inp._committed = true;
  layer.text.content = inp.value;
  try { inp.remove(); } catch {}
  state.textEditingLayerId = null;
  if (!String(layer.text.content).trim()) {
    state.layers = state.layers.filter((l) => l.id !== layer.id);
    if (state.activeLayerId === layer.id) state.activeLayerId = state.layers.length ? state.layers[state.layers.length - 1].id : null;
    _renderLayerPanel();
  } else {
    _renderTextLayer(layer);
  }
  composite();
}

// Content-aware fill — diffusion-inpaint the active selection from its
// surroundings (Edit ▸ Fill (Content-Aware)). Needs a wand/quick-select/color-
// range selection on the active layer.
function _contentAwareFill() {
  const layer = activeLayer();
  if (!layer) return;
  if (!state.wandMask || state.wandLayerId !== layer.id) { if (uiModule && uiModule.showToast) uiModule.showToast('Make a selection first'); return; }
  const w = layer.canvas.width, h = layer.canvas.height;
  if (state.wandMask.width !== w || state.wandMask.height !== h) return;
  _saveState('Content-aware fill');
  const img = layer.ctx.getImageData(0, 0, w, h);
  const mask = state.wandMask.getContext('2d').getImageData(0, 0, w, h).data;
  if (_diffusionFill(img.data, w, h, mask)) { layer.ctx.putImageData(img, 0, 0); composite(); }
}

function _showWandLoading() {
  const area = state.container?.querySelector('.ge-canvas-area');
  if (!area) return () => {};
  const overlay = document.createElement('div');
  overlay.className = 'ge-wand-loading';
  let spinner = null;
  try {
    spinner = spinnerModule.createWhirlpool(30);
    spinner.element.style.cssText = 'width:30px;height:30px;margin:0;';
    overlay.appendChild(spinner.element);
  } catch (_) {
    overlay.textContent = 'Selecting...';
  }
  area.appendChild(overlay);
  return () => {
    try { spinner?.destroy?.(); } catch {}
    overlay.remove();
  };
}

// Draw the wand selection as a translucent red overlay, mirroring the
// inpaint-mask visual so users know what's selected.
// ── Marching ants ──
// Animate the selection outline. The phase advances on a slow timer (only while
// a selection is visible) and the overlays draw dashes offset by it, so the
// boundary "crawls" like Photoshop.
let _antsPhase = 0;
let _antsTimer = null;
function _selectionActive() {
  return !!(state.wandMask && state.wandLayerId && state.wandMaskVisible) ||
    (!state.lassoActive && state.lassoPoints && state.lassoPoints.length >= 3);
}
function _ensureAntsLoop() {
  if (_antsTimer) return;
  _antsTimer = setInterval(() => {
    if (!_selectionActive()) { clearInterval(_antsTimer); _antsTimer = null; return; }
    _antsPhase = (_antsPhase + 1) & 4095;
    composite();
  }, 90);
}
// Boundary pixels of a white-where-selected mask, as a flat [x0,y0,x1,y1,…].
// Cached on the mask canvas (`._ants`) since it's O(w·h); invalidated by
// reassigning the mask (fresh canvas) or clearing `._ants` after in-place unions.
function _computeMaskBoundary(mask) {
  const w = mask.width, h = mask.height;
  const d = mask.getContext('2d').getImageData(0, 0, w, h).data;
  const sel = (x, y) => !(x < 0 || y < 0 || x >= w || y >= h) && d[(y * w + x) * 4 + 3] > 128;
  const out = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!sel(x, y)) continue;
      if (!sel(x - 1, y) || !sel(x + 1, y) || !sel(x, y - 1) || !sel(x, y + 1)) out.push(x, y);
    }
  }
  return out;
}

function _drawWandOverlay() {
  if (!state.wandMask || !state.mainCtx) return;
  const layer = state.layers.find(l => l.id === state.wandLayerId);
  if (!layer) return;
  const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
  // Tint the white mask red, draw at the layer's offset on the main canvas.
  const tint = document.createElement('canvas');
  tint.width = state.wandMask.width;
  tint.height = state.wandMask.height;
  const tc = tint.getContext('2d');
  tc.drawImage(state.wandMask, 0, 0);
  tc.globalCompositeOperation = 'source-in';
  tc.fillStyle = 'rgba(255, 60, 60, 1)';
  tc.fillRect(0, 0, tint.width, tint.height);
  state.mainCtx.save();
  state.mainCtx.globalAlpha = 0.18; // lighter tint so the marching-ants edge reads clearly
  state.mainCtx.drawImage(tint, off.x, off.y);
  state.mainCtx.globalAlpha = 1;
  state.mainCtx.restore();
  // Marching-ants boundary (cached; crawls with _antsPhase).
  if (!state.wandMask._ants) state.wandMask._ants = _computeMaskBoundary(state.wandMask);
  const b = state.wandMask._ants, ph = _antsPhase, c = state.mainCtx, ox = off.x, oy = off.y;
  for (let i = 0; i < b.length; i += 2) {
    const x = b[i], y = b[i + 1];
    c.fillStyle = (((x + y - ph) >> 1) & 1) ? '#000' : '#fff';
    c.fillRect(ox + x, oy + y, 1, 1);
  }
}

function _wandClear() {
  state.wandMask = null;
  state.wandLayerId = null;
  state.wandLastSeed = null;
  _invalidateWandCache();
  composite();
  _syncToolClearIndicators();
}

// Hover thumbnail — generated by downscaling the layer's canvas into a
// small floating panel. Lives in document.body so panel `overflow:
// hidden` can't clip it. One singleton element, repositioned per hover.
function _showLayerThumb(rowEl, layer) {
  if (!layer || !layer.canvas) return;
  if (!state.layerThumbEl) {
    state.layerThumbEl = document.createElement('div');
    state.layerThumbEl.className = 'ge-layer-thumb';
    document.body.appendChild(state.layerThumbEl);
  }
  const SIZE = 120;
  // Downscale layer onto a small canvas, preserving aspect.
  const lw = layer.canvas.width, lh = layer.canvas.height;
  const scale = Math.min(SIZE / lw, SIZE / lh);
  const tw = Math.max(1, Math.round(lw * scale));
  const th = Math.max(1, Math.round(lh * scale));
  const c = document.createElement('canvas');
  c.width = tw; c.height = th;
  // Checker bg so transparency reads
  const ctx = c.getContext('2d');
  const tile = 8;
  for (let y = 0; y < th; y += tile) for (let x = 0; x < tw; x += tile) {
    ctx.fillStyle = ((x / tile + y / tile) & 1) ? '#444' : '#333';
    ctx.fillRect(x, y, tile, tile);
  }
  ctx.drawImage(layer.canvas, 0, 0, tw, th);
  state.layerThumbEl.innerHTML = '';
  state.layerThumbEl.appendChild(c);
  // Position to the LEFT of the row so it doesn't cover other layers.
  const r = rowEl.getBoundingClientRect();
  state.layerThumbEl.style.top = Math.max(8, r.top - 4) + 'px';
  state.layerThumbEl.style.right = (window.innerWidth - r.left + 8) + 'px';
  state.layerThumbEl.style.left = '';
  state.layerThumbEl.style.display = 'block';
}
function _hideLayerThumb() {
  if (state.layerThumbEl) state.layerThumbEl.style.display = 'none';
}

// Shift+click on a layer row → use that layer's opaque pixels as a
// wand-style selection. Lifts pixel alpha > 0 into the wand mask so the
// user can immediately Bg-Remove / Erase / Copy through the layer.
function _loadLayerAlphaAsSelection(layer) {
  if (!layer || !layer.canvas) return;
  const w = layer.canvas.width, h = layer.canvas.height;
  const src = layer.ctx.getImageData(0, 0, w, h).data;
  const mask = document.createElement('canvas');
  mask.width = w; mask.height = h;
  const mctx = mask.getContext('2d');
  const mdata = mctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    if (src[i * 4 + 3] > 0) {
      mdata.data[i * 4]     = 255;
      mdata.data[i * 4 + 1] = 255;
      mdata.data[i * 4 + 2] = 255;
      mdata.data[i * 4 + 3] = 255;
    }
  }
  mctx.putImageData(mdata, 0, 0);
  _saveState();
  state.wandMask = mask;
  state.wandLayerId = layer.id;
  state.wandLastSeed = null;
  composite();
  if (uiModule) uiModule.showToast('Layer pixels selected');
}

// Invert the active selection: lasso (point list — turn into a polygon
// covering the canvas with the lasso polygon as a hole) or wand (flip
// the mask alpha). Wired to Ctrl+Alt+I.
function _invertSelection() {
  if (state.wandMask && state.wandLayerId) {
    _saveState();
    const w = state.wandMask.width, h = state.wandMask.height;
    const ctx = state.wandMask.getContext('2d');
    const data = ctx.getImageData(0, 0, w, h);
    const d = data.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] > 128 ? 0 : 255;
      d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = a;
    }
    ctx.putImageData(data, 0, 0);
    composite();
    if (uiModule) uiModule.showToast('Selection inverted');
    return true;
  }
  if (state.lassoPoints.length >= 3 && !state.lassoActive) {
    // Build polygon covering the whole canvas, with the lasso as a hole.
    // Easiest: convert lasso to wand mask, then invert.
    _saveState();
    const w = state.imgWidth, h = state.imgHeight;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cctx = c.getContext('2d');
    cctx.fillStyle = '#fff';
    cctx.fillRect(0, 0, w, h);
    cctx.globalCompositeOperation = 'destination-out';
    cctx.beginPath();
    cctx.moveTo(state.lassoPoints[0].x, state.lassoPoints[0].y);
    for (let i = 1; i < state.lassoPoints.length; i++) cctx.lineTo(state.lassoPoints[i].x, state.lassoPoints[i].y);
    cctx.closePath();
    cctx.fill();
    state.wandMask = c;
    state.wandLayerId = state.activeLayerId;
    state.wandLastSeed = null;
    state.lassoPoints = [];
    state.lassoActive = false;
    composite();
    if (uiModule) uiModule.showToast('Selection inverted (converted to wand)');
    return true;
  }
  return false;
}

// Convert the wand selection into the inpaint mask, mirroring _lassoToMask.
// Switches to the inpaint tool so the user sees the result right away.
function _wandToMask() {
  if (!state.wandMask || !state.wandLayerId) return;
  const layer = state.layers.find(l => l.id === state.wandLayerId);
  if (!layer) return;
  const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
  // Make the wand's parent active so the mask is attached to it, then
  // get-or-create a mask sub-layer on it. Repoint the global mask
  // plumbing at the new sub-layer's canvas/ctx.
  state.activeLayerId = layer.id;
  const mask = _ensureActiveMaskLayer();
  if (!mask) return;
  state.maskCanvas = mask.canvas;
  state.maskCtx = mask.ctx;
  // Refine the wand mask with the panel's Feather + Edge stroke values
  // before merging into the inpaint mask. Grow/shrink uses the same
  // blur+threshold dilate/erode as the lasso path; feather blurs the
  // result's alpha for a soft edge.
  const wFeather = parseInt(document.getElementById('ge-wand-feather')?.value || '0', 10);
  const wGrow = parseInt(document.getElementById('ge-wand-grow')?.value || '0', 10);
  let refinedWand = state.wandMask;
  if (wGrow !== 0) {
    const c = document.createElement('canvas');
    c.width = state.wandMask.width; c.height = state.wandMask.height;
    const bctx = c.getContext('2d');
    bctx.filter = `blur(${Math.abs(wGrow)}px)`;
    bctx.drawImage(state.wandMask, 0, 0);
    bctx.filter = 'none';
    const blurred = bctx.getImageData(0, 0, c.width, c.height).data;
    const out = bctx.createImageData(c.width, c.height);
    const od = out.data;
    const thr = wGrow > 0 ? 32 : 200;
    for (let i = 0; i < od.length; i += 4) {
      const a = blurred[i + 3] >= thr ? 255 : 0;
      od[i] = a; od[i + 1] = a; od[i + 2] = a; od[i + 3] = a;
    }
    bctx.putImageData(out, 0, 0);
    refinedWand = c;
  }
  if (wFeather > 0) {
    const c = document.createElement('canvas');
    c.width = refinedWand.width; c.height = refinedWand.height;
    const fctx = c.getContext('2d');
    fctx.filter = `blur(${wFeather}px)`;
    fctx.drawImage(refinedWand, 0, 0);
    fctx.filter = 'none';
    refinedWand = c;
  }
  // Draw the refined wand mask into the inpaint mask canvas at the
  // layer's offset. OR-like merge: any painted pixel in the wand mask
  // is added to the inpaint mask (max alpha wins). Matches the lasso
  // path's semantics.
  const tmp = document.createElement('canvas');
  tmp.width = state.maskCanvas.width;
  tmp.height = state.maskCanvas.height;
  const tctx = tmp.getContext('2d');
  tctx.drawImage(refinedWand, off.x, off.y);
  const incoming = tctx.getImageData(0, 0, tmp.width, tmp.height);
  const cur = state.maskCtx.getImageData(0, 0, state.maskCanvas.width, state.maskCanvas.height);
  for (let i = 0; i < incoming.data.length; i += 4) {
    if (incoming.data[i + 3] > cur.data[i + 3]) {
      cur.data[i]     = 255;
      cur.data[i + 1] = 255;
      cur.data[i + 2] = 255;
      cur.data[i + 3] = incoming.data[i + 3];
    }
  }
  state.maskCtx.putImageData(cur, 0, 0);
  // Stay on the Wand tool — just bake the selection into the mask.
  // Clear the wand selection so a re-click starts fresh (and the red
  // overlay doesn't double up over the inpaint-mask red tint).
  state.wandMask = null;
  state.wandLayerId = null;
  state.wandLastSeed = null;
  composite();
  _renderLayerPanel();
  if (uiModule) uiModule.showToast('Selection added to mask');
}

// Reveal/hide the small "X" badge on the Lasso and Wand tool buttons
// based on whether each tool currently holds a selection. Called from
// anywhere selection state mutates (wand click, lasso close, undo, etc.).
function _syncToolClearIndicators() {
  // Selection state drives:
  //   (1) the "from-selection" highlight on each layer's Add-mask btn
  //   (2) the visibility of the post-selection refine rows (Feather +
  //       Edge stroke) on the lasso / wand panels.
  //   (3) the topbar Fill button — visible whenever lasso/wand/active
  //       mask gives us a region to fill.
  const lassoHasSel = state.lassoPoints.length >= 3 && !state.lassoActive;
  const wandHasSel = !!state.wandMask;
  const hasMaskTarget = !!_getActiveMaskLayer();
  const hasSel = lassoHasSel || wandHasSel;
  document.querySelectorAll('.ge-layer-mask-btn').forEach(b => {
    b.classList.toggle('from-selection', hasSel);
  });
  // Fill action now lives in the Image menu — enable when there's
  // something fillable (selection or active mask).
  const fillItem = document.getElementById('ge-image-action-fill');
  if (fillItem) {
    fillItem.disabled = !(hasSel || hasMaskTarget);
    fillItem.title = fillItem.disabled
      ? 'Make a selection or pick a mask first'
      : 'Fill the active selection / mask with the current color';
  }
  // Topbar Selection button only makes sense with an active selection.
  const edgeWrap = document.getElementById('ge-edge-wrap');
  if (edgeWrap) edgeWrap.hidden = !hasSel;
  const lFeather = document.getElementById('ge-lasso-refine-feather');
  const lGrow = document.getElementById('ge-lasso-refine-grow');
  if (lFeather) lFeather.style.display = lassoHasSel ? '' : 'none';
  if (lGrow) lGrow.style.display = lassoHasSel ? '' : 'none';
  const wFeather = document.getElementById('ge-wand-refine-feather');
  const wGrow = document.getElementById('ge-wand-refine-grow');
  if (wFeather) wFeather.style.display = wandHasSel ? '' : 'none';
  if (wGrow) wGrow.style.display = wandHasSel ? '' : 'none';
  if (!state.container) return;
  const lassoBtn = state.container.querySelector('.ge-tool-btn[data-tool="lasso"]');
  const polyBtn  = state.container.querySelector('.ge-tool-btn[data-tool="polylasso"]');
  const magBtn   = state.container.querySelector('.ge-tool-btn[data-tool="maglasso"]');
  const wandBtn  = state.container.querySelector('.ge-tool-btn[data-tool="wand"]');
  const inpaintBtn = state.container.querySelector('.ge-tool-btn[data-tool="inpaint"]');
  const hasLassoPoly = state.lassoPoints.length >= 3 && !state.lassoActive && !state.polyLassoActive && !state.magLassoActive;
  if (lassoBtn) lassoBtn.classList.toggle('has-selection', hasLassoPoly);
  if (polyBtn)  polyBtn.classList.toggle('has-selection', hasLassoPoly);
  if (magBtn)   magBtn.classList.toggle('has-selection', hasLassoPoly);
  if (wandBtn)  wandBtn.classList.toggle('has-selection', !!state.wandMask);
  // Inpaint no longer carries a clear-X badge; masks live as sub-layers
  // in the layer panel and are deleted from there.
  if (inpaintBtn) inpaintBtn.classList.remove('has-selection');
}

function _hasMaskPixels() {
  if (!state.maskCanvas || !state.maskCtx) return false;
  try {
    const d = state.maskCtx.getImageData(0, 0, state.maskCanvas.width, state.maskCanvas.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
  } catch (_) {}
  return false;
}

function _wandDeleteSelection() {
  if (!state.wandMask) return;
  const layer = state.layers.find(l => l.id === state.wandLayerId);
  if (!layer || layer.locked) return;
  _saveState();
  // Use destination-out with the mask to erase the selected pixels.
  layer.ctx.save();
  layer.ctx.globalCompositeOperation = 'destination-out';
  layer.ctx.drawImage(state.wandMask, 0, 0);
  layer.ctx.restore();
  _wandClear();
}

function _wandCopyToNewLayer() {
  if (!state.wandMask) return;
  const src = state.layers.find(l => l.id === state.wandLayerId);
  if (!src) return;
  _saveState();
  // Clip the source by the mask, put it on a new layer.
  const tmp = document.createElement('canvas');
  tmp.width = src.canvas.width;
  tmp.height = src.canvas.height;
  const tCtx = tmp.getContext('2d');
  tCtx.drawImage(src.canvas, 0, 0);
  tCtx.globalCompositeOperation = 'destination-in';
  tCtx.drawImage(state.wandMask, 0, 0);
  const newLayer = createLayer('Wand copy', src.canvas.width, src.canvas.height);
  newLayer.ctx.drawImage(tmp, 0, 0);
  const srcOff = state.layerOffsets.get(src.id) || { x: 0, y: 0 };
  state.layerOffsets.set(newLayer.id, { ...srcOff });
  const idx = state.layers.findIndex(l => l.id === src.id);
  state.layers.splice(idx + 1, 0, newLayer);
  state.activeLayerId = newLayer.id;
  composite();
  _renderLayerPanel();
  _revealLayerPanel();
  if (uiModule) uiModule.showToast('Copied to new layer');
}

function _lassoDeleteSelection() {
  const layer = activeLayer();
  if (!layer || state.lassoPoints.length < 3) return;
  const feather = parseInt(document.getElementById('ge-lasso-feather')?.value || '0');
  const grow = parseInt(document.getElementById('ge-lasso-grow')?.value || '0');
  _saveState();
  const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
  const w = layer.canvas.width, h = layer.canvas.height;

  const mask = _buildLassoMask(w, h, off.x, off.y, feather, grow);
  const maskData = mask.getContext('2d').getImageData(0, 0, w, h);
  const imgData = layer.ctx.getImageData(0, 0, w, h);

  for (let i = 0; i < w * h; i++) {
    const maskVal = maskData.data[i * 4]; // red channel
    if (maskVal > 0) {
      const fade = maskVal / 255;
      imgData.data[i * 4 + 3] = Math.round(imgData.data[i * 4 + 3] * (1 - fade));
    }
  }
  layer.ctx.putImageData(imgData, 0, 0);

  state.lassoPoints = [];
  composite();
  uiModule.showToast('Selection deleted');
}

function _lassoCopyToLayer() {
  const layer = activeLayer();
  if (!layer || state.lassoPoints.length < 3) return;
  const feather = parseInt(document.getElementById('ge-lasso-feather')?.value || '0');
  const grow = parseInt(document.getElementById('ge-lasso-grow')?.value || '0');
  _saveState();
  const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
  const w = layer.canvas.width, h = layer.canvas.height;

  const mask = _buildLassoMask(w, h, off.x, off.y, feather, grow);
  const newLayer = createLayer('Selection', state.imgWidth, state.imgHeight);

  // Copy layer pixels masked by the selection
  const srcData = layer.ctx.getImageData(0, 0, w, h);
  const maskData = mask.getContext('2d').getImageData(0, 0, w, h);
  const outData = newLayer.ctx.createImageData(w, h);

  for (let i = 0; i < w * h; i++) {
    const maskVal = maskData.data[i * 4];
    if (maskVal > 0) {
      const fade = maskVal / 255;
      outData.data[i * 4] = srcData.data[i * 4];
      outData.data[i * 4 + 1] = srcData.data[i * 4 + 1];
      outData.data[i * 4 + 2] = srcData.data[i * 4 + 2];
      outData.data[i * 4 + 3] = Math.round(srcData.data[i * 4 + 3] * fade);
    }
  }
  newLayer.ctx.putImageData(outData, 0, 0);

  state.layers.push(newLayer);
  state.activeLayerId = newLayer.id;
  state.lassoPoints = [];
  _renderLayerPanel();
  _revealLayerPanel();
  composite();
  uiModule.showToast('Selection copied to new layer');
}

function _lassoToMask() {
  if (state.lassoPoints.length < 3) return;
  // Get-or-create a mask sub-layer on the active parent layer and
  // repoint the global mask plumbing at it.
  const mask = _ensureActiveMaskLayer();
  if (!mask) return;
  state.maskCanvas = mask.canvas;
  state.maskCtx = mask.ctx;

  // Fill selection into the mask with feather + grow/shrink applied.
  const feather = parseInt(document.getElementById('ge-lasso-feather')?.value || '0');
  const grow = parseInt(document.getElementById('ge-lasso-grow')?.value || '0');
  const lassoFill = _buildLassoMask(state.maskCanvas.width, state.maskCanvas.height, 0, 0, feather, grow);
  const maskData = lassoFill.getContext('2d').getImageData(0, 0, state.maskCanvas.width, state.maskCanvas.height);
  const curData = state.maskCtx.getImageData(0, 0, state.maskCanvas.width, state.maskCanvas.height);
  // Merge: add the new selection to existing mask
  for (let i = 0; i < maskData.data.length; i += 4) {
    const val = maskData.data[i];
    if (val > curData.data[i]) {
      curData.data[i] = val;
      curData.data[i + 1] = val;
      curData.data[i + 2] = val;
      curData.data[i + 3] = val;
    }
  }
  state.maskCtx.putImageData(curData, 0, 0);

  // Stay on the Lasso tool — just bake the selection into the mask.
  // Keep the lasso points so the user can keep tweaking; clear the
  // active-shape state so the next click starts fresh if they want.
  state.lassoPoints = [];
  composite();
  _renderLayerPanel();
  uiModule.showToast('Selection added to mask');
}

// ── Edge feather ──

// Themed slider modal for filter parameters. Builds a single in-line
// overlay anchored to the canvas-area's centre. `params` is an array
// of `{ key, label, min, max, step, value, suffix }`. As the user
// drags any slider the `onPreview(values)` callback fires for live
// rendering; clicking Apply commits and resolves the returned Promise
// with the final values; Cancel / Esc resolves with null. The caller
// is responsible for snapshotting state BEFORE opening (so Cancel can
// restore the layer's pixels).
function _filterSliderPrompt(title, params, onPreview) {
  return new Promise((resolve) => {
    if (!state.container) { resolve(null); return; }
    const overlay = document.createElement('div');
    overlay.className = 'ge-filter-overlay';
    let rows = '';
    for (const p of params) {
      // Reuse the editor's eraser-row class so the slider picks up the
      // standard slim red-thumb styling instead of the bare browser
      // default. Value chip on the same line as the label.
      rows += `
        <div class="ge-filter-row ge-eraser-row">
          <label>${p.label} <span class="ge-filter-row-value" data-val-for="${p.key}">${p.value}${p.suffix || ''}</span></label>
          <input type="range" data-key="${p.key}" min="${p.min}" max="${p.max}" step="${p.step || 1}" value="${p.value}" />
        </div>
      `;
    }
    overlay.innerHTML = `
      <div class="ge-filter-modal">
        <div class="ge-filter-modal-head">${title}</div>
        ${rows}
        <div class="ge-filter-modal-actions">
          <button type="button" class="ge-btn ge-btn-sm" data-action="cancel">Cancel</button>
          <button type="button" class="ge-btn ge-btn-sm ge-btn-primary" data-action="apply">Apply</button>
        </div>
      </div>
    `;
    state.container.appendChild(overlay);
    const values = {};
    for (const p of params) values[p.key] = p.value;
    // Initial preview render.
    try { onPreview(values); } catch {}
    overlay.querySelectorAll('input[type="range"]').forEach(inp => {
      inp.addEventListener('input', (e) => {
        const k = e.target.dataset.key;
        const v = parseFloat(e.target.value);
        values[k] = v;
        const lbl = overlay.querySelector(`[data-val-for="${k}"]`);
        const param = params.find(p => p.key === k);
        if (lbl) lbl.textContent = v + (param && param.suffix ? param.suffix : '');
        try { onPreview(values); } catch {}
      });
    });
    const cleanup = (result) => {
      try { overlay.remove(); } catch {}
      document.removeEventListener('keydown', onKey, true);
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cleanup(null); }
      else if (e.key === 'Enter') { e.preventDefault(); cleanup(values); }
    };
    document.addEventListener('keydown', onKey, true);
    overlay.querySelector('[data-action="apply"]').addEventListener('click', () => cleanup(values));
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => cleanup(null));
    // Click outside the modal (on the dim backdrop) = cancel.
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(null); });
  });
}

// Generic helper for live-preview blur filters. Saves the PRE-blur
// state to the undo stack first (so Ctrl-Z reverts cleanly), snapshots
// the layer for re-rendering, applies `renderer(snap, values)` into
// the layer on every slider change for instant feedback. Apply keeps
// the result; Cancel / Esc restores the snapshot AND pops the undo
// entry we pre-saved so the canceled run leaves no trace.
async function _applyLiveBlur({ title, params, label, renderer }) {
  const layer = activeLayer();
  if (!layer || layer.locked) { if (uiModule) uiModule.showToast('Select an unlocked layer'); return; }
  const w = layer.canvas.width, h = layer.canvas.height;
  const snap = document.createElement('canvas');
  snap.width = w; snap.height = h;
  snap.getContext('2d').drawImage(layer.canvas, 0, 0);
  // Save state BEFORE any preview — the undo stack now holds the
  // pre-blur pixels. Apply leaves it; Cancel pops it.
  _saveState(label);
  const draw = (values) => {
    layer.ctx.clearRect(0, 0, w, h);
    try { renderer(snap, values, layer.ctx); } catch (_) { layer.ctx.drawImage(snap, 0, 0); }
    composite();
  };
  const result = await _filterSliderPrompt(title, params, draw);
  if (result === null) {
    layer.ctx.clearRect(0, 0, w, h);
    layer.ctx.drawImage(snap, 0, 0);
    composite();
    // Drop the snapshot we pushed — there's nothing to undo to.
    if (state.undoStack.length) state.undoStack.pop();
    _refreshHistoryPanelIfOpen();
    return;
  }
  // Final render from snapshot for a clean commit.
  layer.ctx.clearRect(0, 0, w, h);
  renderer(snap, result, layer.ctx);
  composite();
  if (uiModule) uiModule.showToast(label + ' applied');
}

function _applyGaussianBlur() {
  _applyLiveBlur({
    title: 'Gaussian Blur',
    label: 'Gaussian Blur',
    params: [{ key: 'radius', label: 'Radius', min: 0, max: 100, step: 1, value: 6, suffix: 'px' }],
    renderer: _gaussianBlur,
  });
}

function _applyZoomBlur() {
  _applyLiveBlur({
    title: 'Zoom Blur',
    label: 'Zoom Blur',
    params: [{ key: 'strength', label: 'Strength', min: 1, max: 50, step: 1, value: 15 }],
    renderer: _zoomBlur,
  });
}

function _applyMotionBlur() {
  _applyLiveBlur({
    title: 'Motion Blur',
    label: 'Motion Blur',
    params: [
      { key: 'length', label: 'Length', min: 1, max: 200, step: 1, value: 20, suffix: 'px' },
      { key: 'angle', label: 'Angle', min: -180, max: 180, step: 1, value: 0, suffix: '°' },
    ],
    renderer: _motionBlur,
  });
}

function _applyEdgeFeather(layer, width, hardDelete) {
  const w = layer.canvas.width;
  const h = layer.canvas.height;
  const imgData = layer.ctx.getImageData(0, 0, w, h);
  _edgeFeather(imgData, width, hardDelete);
  layer.ctx.putImageData(imgData, 0, 0);
}

// ── Zoom ──

function _fitZoom() {
  const fit = _getFitZoom();
  if (!fit) return;
  state.zoom = fit;
  _applyZoom();
}

function _getFitZoom() {
  const area = state.container.querySelector('.ge-canvas-area');
  if (!area || !state.imgWidth) return null;
  const pad = 20;
  const maxW = area.clientWidth - pad * 2;
  const maxH = area.clientHeight - pad * 2;
  return Math.min(1, maxW / state.imgWidth, maxH / state.imgHeight);
}

function _applyZoom() {
  if (!state.mainCanvas) return;
  state.mainCanvas.style.width = (state.imgWidth * state.zoom) + 'px';
  state.mainCanvas.style.height = (state.imgHeight * state.zoom) + 'px';
  // Crisp pixels zoomed in, smooth downscale zoomed out (matches the wheel path).
  state.mainCanvas.style.imageRendering = state.zoom >= 4 ? 'pixelated' : 'auto';
  const label = state.container.querySelector('.ge-zoom-label');
  if (label) label.textContent = Math.round(state.zoom * 100) + '%';
  _syncZoomControls();
  const area = state.container && state.container.querySelector('.ge-canvas-area');
  if (area && area._resetPan) area._resetPan();
}

function _syncZoomControls() {
  const fitBtn = document.getElementById('ge-zoom-fit');
  const actualBtn = document.getElementById('ge-zoom-100');
  const fit = _getFitZoom();
  const isFit = fit !== null && Math.abs(state.zoom - fit) < 0.001;
  const isActual = !isFit && Math.abs(state.zoom - 1) < 0.001;
  if (fitBtn) {
    fitBtn.classList.toggle('active', isFit);
    fitBtn.setAttribute('aria-pressed', isFit ? 'true' : 'false');
  }
  if (actualBtn) {
    actualBtn.classList.toggle('active', isActual);
    actualBtn.setAttribute('aria-pressed', isActual ? 'true' : 'false');
  }
}

function _positionInpaintPanel(anchorBtn) {
  const panel = document.getElementById('ge-inpaint-section');
  if (!panel || window.innerWidth <= 820) return;
  if (panel.dataset.userMoved === '1') {
    panel.classList.add('ge-inpaint-popover');
    return;
  }
  panel.classList.add('ge-inpaint-popover');
  // Anchor to the Layers header on the right panel so the popover
  // appears to slide out from there. The toolbar button on the left
  // shifts around as controls reflow, which was causing the popover
  // to land in different spots on each open and look "jumpy" when the
  // user grabbed it to move. Anchoring to the right panel — which has
  // a stable position — keeps the docked appearance steady.
  const layersHeader = document.querySelector('.ge-layers-header');
  const rightPanel = document.querySelector('.ge-right-panel');
  const ref = layersHeader || rightPanel;
  if (!ref) {
    // Fallback to the old toolbar-button anchor if the layers panel
    // isn't on screen yet.
    const r = anchorBtn?.getBoundingClientRect?.();
    if (!r) return;
    requestAnimationFrame(() => {
      const panelW = panel.offsetWidth || 320;
      const panelH = panel.offsetHeight || 520;
      const left = Math.min(window.innerWidth - panelW - 12, Math.max(12, r.right + 10));
      const top = Math.min(window.innerHeight - panelH - 12, Math.max(12, r.top));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    });
    return;
  }
  requestAnimationFrame(() => {
    const refRect = ref.getBoundingClientRect();
    const panelW = panel.offsetWidth || 320;
    const panelH = panel.offsetHeight || 520;
    // Sit immediately to the left of the right panel, top-aligned with
    // the Layers header. 10px gap so it's clearly a separate window
    // and not visually fused with the panel.
    let left = refRect.left - panelW - 10;
    let top = refRect.top;
    // Clamp into the viewport so the popover never leaves the screen.
    left = Math.max(12, Math.min(window.innerWidth - panelW - 12, left));
    top = Math.max(12, Math.min(window.innerHeight - panelH - 12, top));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  });
}

function _wireInpaintPopoverWindow() {
  const panel = document.getElementById('ge-inpaint-section');
  if (!panel || panel.dataset.windowWired === '1') return;
  panel.dataset.windowWired = '1';
  const closeBtn = document.getElementById('ge-inpaint-popover-close');
  closeBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    panel.classList.add('dismissed');
    panel.style.display = 'none';
    document.getElementById('ge-controls')?.classList.remove('ge-inpaint-popover-host');
  });
  const head = panel.querySelector('[data-inpaint-drag]');
  if (!head) return;
  head.addEventListener('pointerdown', (e) => {
    if (window.innerWidth <= 820 || e.target.closest('button')) return;
    e.preventDefault();
    e.stopPropagation();
    panel.classList.add('ge-inpaint-popover');
    const startX = e.clientX;
    const startY = e.clientY;
    const r0 = panel.getBoundingClientRect();
    head.setPointerCapture(e.pointerId);
    head.style.cursor = 'grabbing';
    const onMove = (ev) => {
      const w = panel.offsetWidth || r0.width;
      const h = panel.offsetHeight || r0.height;
      const nx = Math.max(8, Math.min(window.innerWidth - w - 8, r0.left + ev.clientX - startX));
      const ny = Math.max(8, Math.min(window.innerHeight - h - 8, r0.top + ev.clientY - startY));
      panel.dataset.userMoved = '1';
      panel.style.left = `${nx}px`;
      panel.style.top = `${ny}px`;
    };
    const onUp = () => {
      try { head.releasePointerCapture(e.pointerId); } catch {}
      head.style.cursor = '';
      head.removeEventListener('pointermove', onMove);
      head.removeEventListener('pointerup', onUp);
    };
    head.addEventListener('pointermove', onMove);
    head.addEventListener('pointerup', onUp);
  });
}

// ── Build DOM ──

function _buildEditor(container) {
  container.innerHTML = '';
  container.className = 'gallery-editor';

  // Tool options bar controller (DOM appended below the top bar). Declared
  // before the toolbar so onSelectTool can refresh it on every tool change.
  const _optionsBar = createOptionsBar();

  // Toolbar (left) — DOM construction lives in editor/build/toolbar.js;
  // the big tool-switch handler stays here so it can touch module state.
  const { toolbar, toolKeyMap: _toolKeyMap } = _buildToolbar({
    currentTool: state.tool,
    onClearSelection: (which) => {
      if (which === 'lasso' || which === 'polylasso' || which === 'maglasso') {
        state.lassoPoints = [];
        state.lassoActive = false;
        state.polyLassoActive = false;
        state.polyLassoPreview = null;
        state.magLassoActive = false;
        state.magLassoPreview = null;
        state.magLassoAnchors = [];
        composite();
      } else if (which === 'wand') {
        _wandClear();
      }
      _syncToolClearIndicators();
    },
    onSelectTool: (toolId, _btn, toolbarEl) => {
      // Leaving transform mode without confirm? Treat tool change as confirm.
      // The Move tool's always-on box runs a SILENT transform session
      // (state.transformSilent); it must also commit when switching to the
      // dedicated Transform tool so we don't toggle it off in _startTransform
      // below. Free Transform proper still only commits for non-transform tools.
      if (state.transformActive && (toolId !== 'transform' || state.transformSilent)) _confirmTransform();
      if (state.distortActive && toolId !== 'distort') _distortTool.commit();
      if (state.pcropActive && toolId !== 'pcrop') _pcropTool.cancel();
      // Leaving the polygonal lasso mid-polygon? Drop the in-progress points so
      // a dangling rubber-band doesn't linger (a closed selection is kept).
      if (state.polyLassoActive && toolId !== 'polylasso') _polyLassoTool.cancel();
      if (state.magLassoActive && toolId !== 'maglasso') _magLassoTool.cancel();
      // Re-clicking the active tool toggles the mobile control sheet —
      // lets the user swipe-down to dismiss, then tap the tool again to
      // bring it back. On desktop this is a no-op visually since the
      // controls live in the right panel.
      const reactivated = state.tool === toolId;
      state.tool = toolId;
      _optionsBar.refresh(toolId);
      const controls = document.getElementById('ge-controls') || document.querySelector('.ge-controls');
      if (controls) {
        if (reactivated) controls.classList.toggle('dismissed');
        else controls.classList.remove('dismissed');
      }
      // On mobile, picking a tool that's about to SHOW its controls
      // panel auto-minimises the layers sheet so the controls aren't
      // covered. Swiping the layers handle back up restores it.
      const isMobile = window.innerWidth <= 820;
      const hasToolControls = ['brush', 'eraser', 'clone', 'inpaint'].includes(toolId);
      const controlsVisible = controls && !controls.classList.contains('dismissed');
      if (isMobile && hasToolControls && controlsVisible) {
        const rp = document.querySelector('.ge-right-panel');
        if (rp) {
          rp.classList.remove('expanded');
          rp.classList.add('minimized');
        }
      }
      toolbarEl.querySelectorAll('.ge-tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === state.tool));
      // Activate drag-resize handles when picking the Resize tool
      if (toolId === 'transform' && !state.transformActive) _startTransform();
      if (toolId === 'distort' && !state.distortActive) _distortTool.start();
      if (toolId === 'pcrop' && !state.pcropActive) _pcropTool.start();
      // Move tool — show the active layer's transform box + handles via a
      // SILENT transform session (Feature 2). Reuses the Free-Transform rig
      // (8 handles + rotation, non-destructive snapshot) but with no popup /
      // zoom-fit. A plain in-box drag still moves the layer (handled by the
      // transform-drag fallback → _beginMove).
      if (toolId === 'move') _ensureMoveTransform();
      // Show/hide brush controls. Brush, Eraser AND Clone use the
      // shared size+color row; Inpaint has its OWN size slider.
      const brushControls = document.getElementById('ge-brush-controls');
      const needsBrush = ['brush', 'eraser', 'clone'].includes(toolId);
      if (brushControls) brushControls.style.display = needsBrush ? '' : 'none';
      // Eraser and Clone don't care about color — hide the color row.
      const colorRow = document.getElementById('ge-color-row');
      if (colorRow) colorRow.style.display = (toolId === 'eraser' || toolId === 'clone') ? 'none' : '';
      const colorLabel = colorRow?.querySelector('label');
      if (colorLabel) colorLabel.textContent = 'Color';
      const sizeLabelEl = brushControls?.querySelector('.ge-size-slider')?.parentElement?.querySelector('label');
      if (sizeLabelEl && sizeLabelEl.firstChild && sizeLabelEl.firstChild.nodeType === Node.TEXT_NODE) {
        sizeLabelEl.firstChild.nodeValue = (toolId === 'eraser') ? 'Brush Size ' : 'Size ';
      }
      // Per-tool stroke-modifier sections (opacity / flow / softness).
      const brushSection = document.getElementById('ge-brush-section');
      if (brushSection) brushSection.style.display = toolId === 'brush' ? '' : 'none';
      const cloneSection = document.getElementById('ge-clone-section');
      if (cloneSection) cloneSection.style.display = toolId === 'clone' ? '' : 'none';
      const lassoSection = document.getElementById('ge-lasso-section');
      if (lassoSection) lassoSection.style.display = (state.tool === 'lasso' || state.tool === 'polylasso' || state.tool === 'maglasso') ? '' : 'none';
      const wandSection = document.getElementById('ge-wand-section');
      if (wandSection) wandSection.style.display = state.tool === 'wand' ? '' : 'none';
      const inpaintSection = document.getElementById('ge-inpaint-section');
      if (inpaintSection) {
        if (state.tool === 'inpaint') {
          if (reactivated) inpaintSection.classList.toggle('dismissed');
          else inpaintSection.classList.remove('dismissed');
          inpaintSection.style.display = inpaintSection.classList.contains('dismissed') ? 'none' : '';
          const inpaintOpen = !inpaintSection.classList.contains('dismissed');
          controls?.classList.toggle('ge-inpaint-popover-host', inpaintOpen && window.innerWidth > 820);
          if (inpaintOpen) _positionInpaintPanel(_btn);
        } else {
          controls?.classList.remove('ge-inpaint-popover-host');
          inpaintSection.classList.remove('dismissed');
          inpaintSection.style.display = 'none';
        }
      }
      // Entering inpaint mode: make sure the active parent layer has a
      // mask sub-layer, and point the global mask plumbing at it. Also
      // force the global mask-visibility flag back on — a previous
      // Generate cleared it, but on re-entry the user expects to see
      // their mask again.
      if (state.tool === 'inpaint') {
        // First inpaint entry per session: bump the brush size to the
        // mask-friendly default (other tools keep their own size).
        if (!state.inpaintBrushInitialised) {
          state.brushSize = _INPAINT_DEFAULT_BRUSH;
          state.inpaintBrushInitialised = true;
          const inp = document.getElementById('ge-inpaint-brush-slider');
          if (inp) {
            const pos = Math.round(Math.log(Math.max(1, state.brushSize)) / Math.log(800) * 1000);
            inp.value = String(pos);
            const lbl = document.getElementById('ge-inpaint-brush-label');
            if (lbl) lbl.textContent = `${state.brushSize}px`;
          }
        }
        // If the active parent already carries one or more masks, reuse
        // the most-recent one instead of creating a new "Mask 2" /
        // "Mask 3" every time the user re-enters inpaint.
        const parent = _activeParentLayer();
        if (parent && parent.masks && parent.masks.length) {
          if (!parent.activeMaskId) {
            parent.activeMaskId = parent.masks[parent.masks.length - 1].id;
          }
          const m = _getActiveMaskLayer();
          if (m) { state.maskCanvas = m.canvas; state.maskCtx = m.ctx; }
        } else {
          const mask = _ensureActiveMaskLayer();
          if (mask) {
            state.maskCanvas = mask.canvas;
            state.maskCtx = mask.ctx;
            // Reflect the freshly-created mask sub-row in the panel.
            _renderLayerPanel();
          }
        }
        if (!state.maskVisible) {
          state.maskVisible = true;
          const maskBtn = document.getElementById('ge-mask-vis');
          if (maskBtn) {
            maskBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
            maskBtn.title = 'Hide mask';
            maskBtn.classList.add('visible');
          }
        }
      }
      const eraserSection = document.getElementById('ge-eraser-section');
      if (eraserSection) eraserSection.style.display = state.tool === 'eraser' ? '' : 'none';
      const sharpenSection = document.getElementById('ge-sharpen-section');
      if (sharpenSection) sharpenSection.style.display = state.tool === 'sharpen' ? '' : 'none';
      const rembgSection = document.getElementById('ge-rembg-section');
      if (rembgSection) {
        const show = state.tool === 'rembg';
        rembgSection.style.display = show ? '' : 'none';
        if (show) _checkRembgInstalled();
      }
      const importSection = document.getElementById('ge-import-section');
      if (importSection) importSection.style.display = state.tool === 'import' ? '' : 'none';
      const harmonizeSection = document.getElementById('ge-harmonize-section');
      if (harmonizeSection) harmonizeSection.style.display = state.tool === 'harmonize' ? '' : 'none';
      const upscaleSection = document.getElementById('ge-upscale-section');
      if (upscaleSection) upscaleSection.style.display = state.tool === 'upscale' ? '' : 'none';
      const styleSection = document.getElementById('ge-style-section');
      if (styleSection) styleSection.style.display = state.tool === 'style' ? '' : 'none';
      const gradientSection = document.getElementById('ge-gradient-section');
      if (gradientSection) gradientSection.style.display = state.tool === 'gradient' ? '' : 'none';
      const shapeSection = document.getElementById('ge-shape-section');
      if (shapeSection) shapeSection.style.display = state.tool === 'shapes' ? '' : 'none';
      const marqueeSection = document.getElementById('ge-marquee-section');
      if (marqueeSection) marqueeSection.style.display = state.tool === 'marquee' ? '' : 'none';
      const liquifySection = document.getElementById('ge-liquify-section');
      if (liquifySection) liquifySection.style.display = state.tool === 'liquify' ? '' : 'none';
      const smudgeSection = document.getElementById('ge-smudge-section');
      if (smudgeSection) smudgeSection.style.display = state.tool === 'smudge' ? '' : 'none';
      const mixerSection = document.getElementById('ge-mixer-section');
      if (mixerSection) mixerSection.style.display = state.tool === 'mixer' ? '' : 'none';
      const textSection = document.getElementById('ge-text-section');
      if (textSection) textSection.style.display = state.tool === 'text' ? '' : 'none';
      const dodgeBurnSection = document.getElementById('ge-dodgeburn-section');
      if (dodgeBurnSection) dodgeBurnSection.style.display = state.tool === 'dodgeburn' ? '' : 'none';
      const bucketSection = document.getElementById('ge-bucket-section');
      if (bucketSection) bucketSection.style.display = state.tool === 'bucket' ? '' : 'none';
      const cropSection = document.getElementById('ge-crop-section');
      if (cropSection) cropSection.style.display = state.tool === 'crop' ? '' : 'none';
      const eyedropperSection = document.getElementById('ge-eyedropper-section');
      if (eyedropperSection) eyedropperSection.style.display = state.tool === 'eyedropper' ? '' : 'none';
      const distortSection = document.getElementById('ge-distort-section');
      if (distortSection) distortSection.style.display = state.tool === 'distort' ? '' : 'none';
      const pcropSection = document.getElementById('ge-pcrop-section');
      if (pcropSection) pcropSection.style.display = state.tool === 'pcrop' ? '' : 'none';
      const filterSection = document.getElementById('ge-filter-section');
      if (filterSection) {
        const wasShown = filterSection.style.display !== 'none';
        const show = state.tool === 'filter';
        filterSection.style.display = show ? '' : 'none';
        if (show && !wasShown) window.dispatchEvent(new CustomEvent('ge:filter-show'));
        else if (!show && wasShown) window.dispatchEvent(new CustomEvent('ge:filter-hide'));
      }
      // Toggle cursor — hide native cursor for tools that draw via our
      // own circle overlay (brush/eraser/inpaint/lasso); for other tools
      // pick a cursor that matches the tool's affordance.
      const useCircle = state.tool === 'brush' || state.tool === 'eraser' || state.tool === 'inpaint' || state.tool === 'lasso' || state.tool === 'clone' || state.tool === 'liquify' || state.tool === 'smudge' || state.tool === 'mixer' || state.tool === 'heal' || state.tool === 'dodgeburn' || state.tool === 'redeye';
      if (state.mainCanvas) {
        // Custom SVG cursor for the Move tool — white fill with black
        // stroke so it reads on both light and dark canvases.
        const moveCursorSvg = `data:image/svg+xml;utf8,${encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="black" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 L9 5 H11 V11 H5 V9 L2 12 L5 15 V13 H11 V19 H9 L12 22 L15 19 H13 V13 H19 V15 L22 12 L19 9 V11 H13 V5 H15 Z"/></svg>'
        )}`;
        let cursor = 'crosshair';
        if (state.tool === 'move') cursor = `url("${moveCursorSvg}") 12 12, move`;
        else if (state.tool === 'transform') cursor = 'default';
        else if (state.tool === 'text') cursor = 'text';
        else if (useCircle) cursor = 'crosshair';
        state.mainCanvas.style.cursor = cursor;
      }
      if (state.cursorEl) state.cursorEl.style.display = useCircle ? '' : 'none';
      composite();
    },
  });
  // Top bar — static DOM lives in editor/build/topbar.js; all click
  // handlers below wire to the IDs baked into the markup.
  // Application menu bar (File/Edit/Image/Layer/Select/Filter/View) — sits at
  // the very top and relays to the already-wired controls/shortcuts.
  const menuBar = _buildMenuBar();
  container.appendChild(menuBar);
  wireMenuBar(menuBar);
  _loadChecker(); // apply persisted transparency-checkerboard prefs before first composite
  // Hidden relay target for the menu bar's "Image size… (resample)" item.
  const _imageSizeTrigger = document.createElement('button');
  _imageSizeTrigger.id = 'ge-image-size-trigger';
  _imageSizeTrigger.hidden = true;
  _imageSizeTrigger.addEventListener('click', () => _promptImageSize());
  container.appendChild(_imageSizeTrigger);
  // Hidden relay targets for the Layer menu's Smart Object items.
  for (const [id, fn] of [
    ['ge-smart-convert', () => _smartObject.convertToSmart()],
    ['ge-smart-replace', () => _smartObject.replaceContents()],
    ['ge-smart-rasterize', () => _smartObject.rasterize()],
    ['ge-smart-link', () => _promptLinkUrl()],
    ['ge-smart-update-linked', () => _smartObject.updateLinked()],
    ['ge-export-as-trigger', () => _promptExportAs()],
    ['ge-anim-toggle', () => { if (_anim) _anim.toggle(); }],
    ['ge-checker-trigger', () => _promptCheckerboard()],
    ['ge-export-anim-trigger', () => _promptExportAnim()],
    ['ge-pen-hid-trigger', () => { if (_penHid) _penHid.connect(); }],
  ]) {
    const b = document.createElement('button');
    b.id = id; b.hidden = true; b.addEventListener('click', fn);
    container.appendChild(b);
  }

  const topBar = _buildTopbar();
  container.appendChild(topBar);

  // Tool options bar — full-width strip under the top bar showing the active
  // tool's name + its primary controls (remotes of the right-panel inputs).
  const optionsBar = _buildOptionsBar();
  container.appendChild(optionsBar);

  // Editor body (toolbar + canvas + panel)
  const editorBody = document.createElement('div');
  editorBody.className = 'ge-editor-body';
  editorBody.appendChild(toolbar);

  // Canvas area (center)
  const canvasArea = document.createElement('div');
  canvasArea.className = 'ge-canvas-area';
  state.mainCanvas = document.createElement('canvas');
  state.mainCanvas.className = 'ge-main-canvas';
  state.mainCtx = state.mainCanvas.getContext('2d');
  // Initial cursor matches the default tool (move) so the user sees the
  // four-arrow icon as soon as the editor opens. Uses a filled white
  // arrow with black stroke for readability on light AND dark canvases.
  if (state.tool === 'move') {
    const svg = `data:image/svg+xml;utf8,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="black" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 L9 5 H11 V11 H5 V9 L2 12 L5 15 V13 H11 V19 H9 L12 22 L15 19 H13 V13 H19 V15 L22 12 L19 9 V11 H13 V5 H15 Z"/></svg>'
    )}`;
    state.mainCanvas.style.cursor = `url("${svg}") 12 12, move`;
  } else {
    state.mainCanvas.style.cursor = 'crosshair';
  }
  canvasArea.appendChild(state.mainCanvas);
  // Pasteboard background colour (right-click the canvas area) — display-only.
  wirePasteboard(canvasArea, state);

  // Transform overlay — separate canvas positioned over the main canvas
  // with extra margin so the resize/rotation handles can render OUTSIDE
  // the image bounds. Sized + zoomed in sync with the main canvas via
  // _syncTransformOverlay(). The overlay is pointer-events:none so it
  // doesn't intercept clicks; hit-testing still happens in image coords.
  state.transformOverlay = document.createElement('canvas');
  state.transformOverlay.className = 'ge-transform-overlay';
  state.transformOverlayCtx = state.transformOverlay.getContext('2d');
  canvasArea.appendChild(state.transformOverlay);
  // Keep the transform handles glued to the photo while the canvas-area
  // scrolls (the overlay is anchored to the canvas's live rect, so a
  // re-draw on scroll re-reads its position).
  canvasArea.addEventListener('scroll', () => {
    if (state.transformActive) _drawTransformHandles();
  }, { passive: true });

  // Canvas events (mouse + touch + pinch-zoom + pan) — full
  // implementation in editor/canvas-events.js.
  wireCanvasEvents({
    canvasArea,
    beginDraw: _beginDraw,
    continueDraw: _continueDraw,
    endDraw: _endDraw,
    updateBrushCursor: (e) => _updateBrushCursor(e),
    syncZoomControls: () => _syncZoomControls(),
  });
  // Double-click closes an in-progress polygonal-lasso selection (PS parity).
  canvasArea.addEventListener('dblclick', (e) => {
    if (state.tool === 'polylasso' && state.polyLassoActive) { e.preventDefault(); _polyLassoTool.close(); }
    if (state.tool === 'maglasso' && state.magLassoActive) { e.preventDefault(); _magLassoTool.close(); }
  });

  editorBody.appendChild(canvasArea);

  // Right panel (controls + layers + resize handle) — full
  // implementation in editor/build/right-panel.js.
  const { rightPanel, controls, layerPanel } = buildRightPanel({
    controlsHTML: _controlsHTML,
    layerPanelHTML: _layerPanelHTML,
  });
  editorBody.appendChild(rightPanel);
  container.appendChild(editorBody);
  // Initial options-bar fill now that the canonical controls exist.
  _optionsBar.refresh(state.tool);
  // PS layout: the active tool's PRIMARY settings live on the top options bar,
  // so hide their duplicate rows in the right panel. The canonical inputs stay
  // in the DOM (just hidden) — the top-bar remotes proxy them, so all wiring
  // still runs. What remains in the right "Brush" section is the advanced
  // dynamics (Brush Settings panel parity). Done once at build time.
  {
    const dupSelectors = [
      '.ge-size-slider',
      '#ge-brush-blend', '#ge-brush-opacity', '#ge-brush-flow', '#ge-brush-softness',
      '#ge-brush-symmetry', '#ge-brush-pressure-opacity', '#ge-brush-airbrush',
      '#ge-eraser-opacity', '#ge-eraser-flow', '#ge-eraser-softness',
    ];
    for (const sel of dupSelectors) {
      const input = container.querySelector(sel);
      const row = input && input.closest('.ge-control-row');
      if (row) row.classList.add('ge-dup-top');
    }
    // The eraser section's controls all moved to the top bar — leave a hint so
    // the section doesn't read as empty.
    const eraserSection = container.querySelector('#ge-eraser-section');
    if (eraserSection && !eraserSection.querySelector('.ge-dup-hint')) {
      const hint = document.createElement('p');
      hint.className = 'ge-dup-hint';
      hint.style.cssText = 'font-size:10px;opacity:0.5;margin:2px 0 0;';
      hint.textContent = 'Eraser options are on the top bar ↑';
      eraserSection.appendChild(hint);
    }
  }
  _wireInpaintPopoverWindow();

  // Slider UX (expand-while-using, floating bubble, click-to-type) —
  // full implementation in editor/slider-ux.js.
  wireSliderUx({ registerDocClickAway: _registerDocClickAway });

  // Shortcuts cheatsheet popover — full implementation in
  // editor/shortcuts-popover.js. (Dead `_makeShortcutsDraggable`
  // helper for the old centered-modal version was dropped.)
  const _shortcutsPopover = createShortcutsPopover();
  const _toggleShortcuts = _shortcutsPopover.toggleShortcuts;
  document.getElementById('ge-shortcuts-btn')?.addEventListener('click', () => _toggleShortcuts());

  // Fullscreen toggle button (mirrors the F shortcut). Resolves the modal via
  // closest() so it needs no editor-state reference; reflects pressed state.
  const _fsBtn = document.getElementById('ge-fullscreen-btn');
  _fsBtn?.addEventListener('click', () => {
    const el = _fsBtn.closest('.gallery-modal-content') || _fsBtn.parentElement;
    if (!el) return;
    if (!document.fullscreenElement) { try { el.requestFullscreen(); } catch {} }
    else { try { document.exitFullscreen(); } catch {} }
  });
  document.addEventListener('fullscreenchange', () => {
    if (_fsBtn) _fsBtn.setAttribute('aria-pressed', document.fullscreenElement ? 'true' : 'false');
    // Keyboard Lock API — while fullscreen, route normally-reserved browser
    // shortcuts (Ctrl+W/T/N, Ctrl+Tab, Ctrl+1-9, F-keys, …) to the page so they
    // can't yank the user out of the editor. Only effective in fullscreen + a
    // secure context; degrades silently where unsupported. Escape stays a
    // hold-to-exit per the spec. Released on exit so it never leaks outside.
    try {
      const kb = navigator.keyboard;
      if (kb && kb.lock) {
        if (document.fullscreenElement) { kb.lock().catch(() => {}); }
        else if (kb.unlock) { kb.unlock(); }
      }
    } catch {}
    // Re-focus the editor after any fullscreen transition so document-level
    // shortcuts keep firing (a fullscreen element with no focused descendant
    // can swallow keydowns).
    if (document.fullscreenElement) { try { (state.container || document.fullscreenElement).focus({ preventScroll: true }); } catch {} }
  });

  // Dismiss-listeners for the inpaint popup are attached lazily by
  // _showInpaintPrompt() and removed by _dismissInpaintPrompt(), so the
  // active-edit path doesn't pay for them on every event. (Listening on
  // mousedown/wheel/touchstart/input/change at capture phase, even with
  // a fast `closest()` check, added up to noticeable lag during heavy
  // brush use.)

  // Wire up controls — foreground color (first .ge-color-picker = FG).
  controls.querySelector('.ge-color-picker').addEventListener('input', (e) => { state.color = e.target.value; });
  // Background color + swap (X) / default (D).
  controls.querySelector('.ge-bg-color')?.addEventListener('input', (e) => { state.bgColor = e.target.value; });
  function _syncColorSwatches() {
    const fgEl = controls.querySelector('.ge-fg-color');
    const bgEl = controls.querySelector('.ge-bg-color');
    if (fgEl) { fgEl.value = state.color; fgEl.dispatchEvent(new Event('input', { bubbles: true })); }
    if (bgEl) { bgEl.value = state.bgColor; bgEl.dispatchEvent(new Event('input', { bubbles: true })); }
  }
  function _swapColors() {
    const fg = state.color;
    state.color = state.bgColor || '#ffffff';
    state.bgColor = fg;
    _syncColorSwatches();
  }
  function _defaultColors() { state.color = '#000000'; state.bgColor = '#ffffff'; _syncColorSwatches(); }
  controls.querySelector('#ge-swap-colors')?.addEventListener('click', _swapColors);
  controls.querySelector('#ge-default-colors')?.addEventListener('click', _defaultColors);
  // Swap the editor's native color inputs for the in-house HSV picker
  // we built in the theme system — eyedropper, suggestions, recents,
  // no native OS dialog. Each picker keeps its existing `input` event
  // wiring so callers just keep reading `e.target.value`.
  controls.querySelectorAll('.ge-color-picker').forEach(attachColorPicker);
  controls.querySelectorAll('.ge-color-picker').forEach(el => {
    // Set the initial swatch background so it reflects the starting value.
    el.value = el.value;
  });
  // Swatches / colour palette (default + saved + recent) — drives the FG picker.
  wireSwatches();
  // Classic HSV "Color" pane (square + hue strip).
  wireHsvPane();
  // OK Color Picker (OKhsl perceptual H/S/L) + Color-panel tabs.
  wireOkPicker();
  // Pressure-response curve editor (drives pressure-response.js).
  mountPressureCurve();
  // Brush Settings live preview + test-paint strip.
  mountBrushPreview();
  // Multi-stop gradient editor (writes state.gradStops; the Gradient tool builds
  // from it once engaged — see editor/gradient-editor.js + tools/gradient.js).
  {
    const gradHost = document.getElementById('ge-gradient-editor-host');
    if (gradHost) { const ed = createGradientEditor(); ed.mount(gradHost); }
  }
  // Animation system — cel timeline (bottom strip) + onion skin + playback.
  // Toggled via View ▸ Animation Timeline (#ge-anim-toggle). A cel is a normal
  // layer, so the brush/mask/blend tools paint animation frames unchanged.
  _anim = createAnimation({
    composite,
    createLayer,
    renderLayerPanel: () => _renderLayerPanel(),
    onChange: () => { if (_timeline) _timeline.render(); },
  });
  _timeline = createTimeline(_anim, container);
  // WebHID tablet bridge — real stylus pressure with Windows Ink off. Connect is
  // user-gesture-gated (Edit ▸ Connect Drawing Tablet → #ge-pen-hid-trigger).
  _penHid = createPenHid({ onStatus: (s) => { try { uiModule.showToast(s); } catch {} } });
  // ── Command registry: one path for undo + scripting + Actions ──
  initCommands({ saveState: _saveState, composite });
  registerCommand('fill', { label: 'Fill', run: (a) => { const l = activeLayer(); if (!l) return; l.ctx.save(); l.ctx.fillStyle = (a && a.color) || state.color; l.ctx.fillRect(0, 0, l.canvas.width, l.canvas.height); l.ctx.restore(); } });
  registerCommand('add-layer', { label: 'New Layer', run: (a) => { const l = createLayer((a && a.name) || 'Layer', state.imgWidth, state.imgHeight); state.layers.push(l); state.activeLayerId = l.id; _renderLayerPanel(); return l.id; } });
  registerCommand('adjust', { label: 'Adjustment', run: (a) => { const l = activeLayer(); if (!l || !a || !a.type) return; const baked = _applyAdjToCanvas(l.canvas, { type: a.type, params: { ..._defaultAdjParams(a.type), ...(a.params || {}) } }); l.ctx.clearRect(0, 0, l.canvas.width, l.canvas.height); l.ctx.drawImage(baked, 0, 0); } });
  registerCommand('invert', { label: 'Invert', run: () => runCommand('adjust', { type: 'invert' }, { history: false, composite: false, record: false }) });
  registerCommand('flip-h', { label: 'Flip Horizontal', undoable: false, run: () => _flipAllLayers('h') });
  registerCommand('flip-v', { label: 'Flip Vertical', undoable: false, run: () => _flipAllLayers('v') });
  registerCommand('rotate-cw', { label: 'Rotate 90° CW', undoable: false, run: () => _rotateAllLayers(90) });
  registerCommand('rotate-ccw', { label: 'Rotate 90° CCW', undoable: false, run: () => _rotateAllLayers(270) });
  // Script Console (power-user automation; opened from the Filter menu).
  wireScriptRunner({ composite, createLayer, renderLayerPanel: _renderLayerPanel, saveState: _saveState, activeLayer });
  // Actions — record/replay the command stream (Filter ▸ Actions…).
  wireActions({ saveState: _saveState, composite });
  // Tabbed documents — work between multiple open files.
  let _newDocSeq = 1;
  wireDocTabs({
    composite, renderLayerPanel: _renderLayerPanel, createLayer, fitZoom: _fitZoom,
    promptNewSize: () => _promptCanvasSize({ initialName: 'Untitled ' + (++_newDocSeq) }),
    // Renaming the ACTIVE document keeps the editor's draft name + Edit-tab
    // label in sync and re-persists so the new title survives reload.
    onRenameActive: (name) => {
      state.draftName = name;
      try { _setEditTabLabel(name); } catch {}
      try { _schedulePersist(); } catch {}
    },
  });
  // Reference image panel (display-only docker).
  wireReference();
  // Histogram panel (read-only, live tonal feedback).
  wireHistogram({ activeLayer });
  // Hide brush controls initially (default tool is Move)
  const initBrushCtrl = document.getElementById('ge-brush-controls');
  if (initBrushCtrl) initBrushCtrl.style.display = 'none';
  // Brush-size slider is exponential — slider position 0..1000 maps to
  // brush size 1..800 via Math.pow(800, pos/1000). This gives fine
  // control at small sizes (where precision matters most) and bigger
  // jumps at the high end (where +/-50 px is barely visible anyway).
  // We expose two sliders (global brush-controls + inpaint section) and
  // keep them in sync via _brushSizeSync.
  function _brushSizeSync(source) {
    const globalLabel = controls.querySelector('.ge-size-label');
    const globalInput = controls.querySelector('.ge-size-slider');
    const inpaintLabel = document.getElementById('ge-inpaint-brush-label');
    const inpaintInput = document.getElementById('ge-inpaint-brush-slider');
    const pos = Math.round(Math.log(Math.max(1, state.brushSize)) / Math.log(800) * 1000);
    if (globalLabel) globalLabel.textContent = state.brushSize + 'px';
    if (inpaintLabel) inpaintLabel.textContent = state.brushSize + 'px';
    if (globalInput && source !== globalInput) globalInput.value = String(pos);
    if (inpaintInput && source !== inpaintInput) inpaintInput.value = String(pos);
  }
  function _wireBrushSlider(el) {
    if (!el) return;
    el.addEventListener('input', (e) => {
      const pos = parseInt(e.target.value, 10);
      state.brushSize = Math.max(1, Math.round(Math.pow(800, pos / 1000)));
      _brushSizeSync(e.target);
    });
  }
  _wireBrushSlider(controls.querySelector('.ge-size-slider'));
  _wireBrushSlider(document.getElementById('ge-inpaint-brush-slider'));

  // On-canvas brush HUD — Alt+right-drag adjusts Size (horizontal) and Opacity
  // (vertical; drag UP = more opaque) live with a readout, so the artist never
  // leaves the canvas. Started in _beginDraw.
  window.addEventListener('mousemove', (e) => {
    if (!state.brushHudActive || !state.brushHudStart) return;
    const s = state.brushHudStart;
    state.brushSize = Math.max(1, Math.min(800, Math.round(s.size + (e.clientX - s.x))));
    // Vertical → opacity 0-100; up (negative dy) increases. ~200px = full range.
    const opField = s.opField || 'brushOpacity';
    const newOp = Math.max(0, Math.min(100, Math.round(s.opacity - (e.clientY - s.y) * 0.5)));
    state[opField] = newOp;
    const opTool = opField === 'eraserOpacity' ? 'eraser' : 'brush';
    const opEl = document.getElementById('ge-' + opTool + '-opacity');
    if (opEl) { opEl.value = String(newOp); opEl.dispatchEvent(new Event('input', { bubbles: true })); }
    _brushSizeSync(null);
    try { _updateBrushCursor(e); } catch {}
    _showBrushHudReadout(e, state.brushSize, newOp);
  });
  window.addEventListener('mouseup', () => { state.brushHudActive = false; _hideBrushHudReadout(); });
  // Right-click on the canvas with Brush/Eraser → the brush quick-pick popup
  // (Size / Hardness / preset grid, PS parity). Otherwise: suppress the browser
  // menu only while Alt+right-dragging the size HUD; any other right-click falls
  // through to the pasteboard background-colour menu (wired on the canvas area).
  state.mainCanvas.addEventListener('contextmenu', (e) => {
    if (!e.altKey && !state.brushHudActive && (state.tool === 'brush' || state.tool === 'eraser')) {
      e.preventDefault();
      e.stopPropagation(); // don't also open the pasteboard menu on the parent
      _brushQuickPick.open(e.clientX, e.clientY);
      return;
    }
    if (e.altKey || state.brushHudActive) e.preventDefault();
  });

  // Alt-hover eyedropper PREVIEW — while the Eyedropper tool is active, or while
  // Alt is held with a paint tool (the quick-pick gesture), show a swatch of the
  // colour under the cursor so the pick is predictable (PS shows this ring).
  let _eyedropPrev = null;
  const _hideEyedropPrev = () => { if (_eyedropPrev) _eyedropPrev.style.display = 'none'; };
  window.addEventListener('mousemove', (e) => {
    const tool = state.tool;
    const eligible = tool === 'eyedropper' || ((tool === 'brush' || tool === 'eraser') && e.altKey);
    if (!eligible || state.brushHudActive || !state.mainCanvas || e.target !== state.mainCanvas) { _hideEyedropPrev(); return; }
    const { x, y } = _canvasCoords(e, state.mainCanvas);
    const cw = state.mainCanvas.width, ch = state.mainCanvas.height;
    const px = Math.max(0, Math.min(cw - 1, Math.round(x))), py = Math.max(0, Math.min(ch - 1, Math.round(y)));
    let d; try { d = state.mainCtx.getImageData(px, py, 1, 1).data; } catch { _hideEyedropPrev(); return; }
    const hex = '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
    if (!_eyedropPrev) {
      _eyedropPrev = document.createElement('div');
      _eyedropPrev.className = 'ge-eyedrop-preview';
      (state.container || document.body).appendChild(_eyedropPrev);
    }
    _eyedropPrev.style.background = hex;
    _eyedropPrev.style.left = (e.clientX + 18) + 'px';
    _eyedropPrev.style.top = (e.clientY + 18) + 'px';
    _eyedropPrev.style.display = '';
  });
  window.addEventListener('keyup', (e) => { if (e.key === 'Alt') _hideEyedropPrev(); });
  state.mainCanvas.addEventListener('mouseleave', _hideEyedropPrev);
  // Topbar wiring (undo/redo/history, Save dropdown, zoom buttons,
  // Export/Download/Project, Edge popup, cross-dropdown coordination) —
  // full implementation in editor/wire-topbar.js.
  wireTopbar({
    undo, redo,
    toggleHistoryPanel: _toggleHistoryPanel,
    fitZoom: () => _fitZoom(),
    applyZoom: () => _applyZoom(),
    exportToGallery, downloadPNG,
    saveProject: () => _saveProject(),
    loadProjectPrompt: () => _loadProjectPrompt(),
    activeLayer,
    saveState: _saveState,
    applyEdgeFeather: _applyEdgeFeather,
    composite,
    registerDocClickAway: _registerDocClickAway,
    uiModule,
  });
  // Fill — visible only when a selection or active mask exists. Pours
  // the current colour into whichever target is live:
  //   - active mask sub-layer → fills the layer's pixels clipped by
  //     the mask (uses mask alpha as a stencil).
  //   - lasso closed → fills the polygon area on the active layer.
  //   - wand selection → fills the wand mask area on the active layer.
  // Fill — invoked from the Image menu's "Fill selection / mask" item.
  // Pours the current colour into whichever target is live:
  //   - active mask sub-layer → fills the layer's pixels clipped by
  //     the mask (uses mask alpha as a stencil).
  //   - lasso closed → fills the polygon area on the active layer.
  //   - wand selection → fills the wand mask area on the active layer.
  function _doFillSelection() {
    const layer = activeLayer();
    if (!layer || layer.locked) return;
    const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
    const w = layer.canvas.width;
    const h = layer.canvas.height;
    const mask = _getActiveMaskLayer();
    const hasLasso = state.lassoPoints.length >= 3 && !state.lassoActive;
    const stencil = document.createElement('canvas');
    stencil.width = w; stencil.height = h;
    const sctx = stencil.getContext('2d');
    if (mask) {
      sctx.drawImage(mask.canvas, -off.x, -off.y);
    } else if (hasLasso) {
      const feather = parseInt(document.getElementById('ge-lasso-feather')?.value || '0');
      const grow = parseInt(document.getElementById('ge-lasso-grow')?.value || '0');
      sctx.drawImage(_buildLassoMask(w, h, off.x, off.y, feather, grow), 0, 0);
    } else if (state.wandMask) {
      sctx.drawImage(state.wandMask, 0, 0);
    } else {
      return;
    }
    _saveState('Fill selection');
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = state.color;
    sctx.fillRect(0, 0, w, h);
    sctx.globalCompositeOperation = 'source-over';
    layer.ctx.drawImage(stencil, 0, 0);
    composite();
    _renderLayerPanel();
    if (uiModule) uiModule.showToast('Filled');
  }

  // AI model selectors (Gen, Inpaint, per-tool) — full
  // implementation in editor/ai-models.js.
  wireAIModelSelectors({
    container,
    apiBase: API_BASE,
    openCookbookForImg2img: () => _openCookbookForImg2img(),
  });

  document.getElementById('ge-save').addEventListener('click', async () => {
    if (!state.imageId) {
      await exportToGallery();
      return;
    }
    const endBusy = _saveButtonBusy('Saving…');
    let blob = null;
    let savedOk = false;
    const t0 = performance.now();
    try {
      // Encode directly from the flattened canvas via toBlob() to avoid
      // the dataURL round-trip (which doubles peak memory). Pick JPEG for
      // photo sources so 24MP uploads don't balloon to 200MB+ PNG —
      // critical when the editor is accessed over Tailscale Funnel etc.
      const flat = flatten();
      const ext = (state.originalExt || 'png').toLowerCase();
      const isJpeg = ext === 'jpg' || ext === 'jpeg';
      const mime = isJpeg ? 'image/jpeg' : 'image/png';
      const quality = isJpeg ? 0.92 : undefined;
      blob = await new Promise((resolve, reject) => {
        flat.toBlob(b => b ? resolve(b) : reject(new Error('Canvas encode failed')), mime, quality);
      });
      const fd = new FormData();
      fd.append('image', blob, `edited.${isJpeg ? 'jpg' : 'png'}`);
      const resp = await fetch(`${API_BASE}/api/gallery/${state.imageId}/replace`, {
        method: 'POST',
        credentials: 'same-origin',
        body: fd,
      });
      if (!resp.ok) {
        let detail = '';
        try { const j = await resp.json(); detail = j.detail || j.error || ''; } catch {}
        throw new Error(`HTTP ${resp.status}${detail ? `: ${detail}` : ''}`);
      }
      const totalMs = Math.round(performance.now() - t0);
      if (uiModule) uiModule.showToast(`Saved over original (${(blob.size / 1024 / 1024).toFixed(1)}MB · ${(totalMs / 1000).toFixed(1)}s)`, 4000);
      window.dispatchEvent(new CustomEvent('gallery-refresh'));
      savedOk = true;
    } catch (e) {
      console.error('[save] error:', e);
      const sizeMB = blob ? ` (${(blob.size / 1024 / 1024).toFixed(1)}MB)` : '';
      let msg = e?.message || 'unknown';
      if (e?.name === 'TypeError' || /fetch|network|load failed/i.test(msg)) {
        msg = `network dropped${sizeMB} — try "Save as copy" or check connection`;
      } else {
        msg += sizeMB;
      }
      if (uiModule) uiModule.showToast('Failed to save: ' + msg, 6000);
    } finally {
      endBusy();
      if (savedOk) _flashSaveButtonOk();
    }
  });

  // Topbar overflow + canvas-size badge — full implementation in
  // editor/wire-topbar-overflow.js.
  wireTopbarOverflow({ container, registerDocClickAway: _registerDocClickAway });

  // Topbar dropdown menus (Image, Filter, Resize) + the resize-canvas
  // helpers — full implementation in editor/wire-topbar-menus.js. The
  // returned `_resizeCustomPrompt` is consumed by the keyboard
  // shortcuts module (Ctrl+Shift+T).
  const { resizeCustomPrompt: _resizeCustomPrompt } = wireTopbarMenus({
    closeOtherTopbarMenus: _closeOtherTopbarMenus,
    registerDocClickAway: _registerDocClickAway,
    saveState: _saveState,
    composite,
    fitZoom: () => _fitZoom(),
    promptCanvasSize: (opts) => _promptCanvasSize(opts),
    doFillSelection: () => _doFillSelection(),
    rotateAllLayers: (deg) => _rotateAllLayers(deg),
    flipAllLayers: (axis) => _flipAllLayers(axis),
    applyGaussianBlur: () => _applyGaussianBlur(),
    applyZoomBlur: () => _applyZoomBlur(),
    uiModule,
  });

  // Inpaint side-panel controls (Feather/Strength previews, post-gen
  // edge tuner, mask vis/invert/clear, paint-erase toggle, mask tint
  // pickers) — full implementation in editor/wire-inpaint-controls.js.
  wireInpaintControls({
    composite,
    applyInpaintFeather: _applyInpaintFeather,
    syncToolClearIndicators: () => _syncToolClearIndicators(),
    attachColorPicker,
    uiModule,
  });

  // AI inpaint (Generate / Remove / Outpaint) — full implementation
  // in editor/ai-inpaint.js.
  wireInpaintButtons({
    buildMergedMaskCanvas: () => _buildMergedMaskCanvas(),
    dilateMask: _dilateMask,
    applyInpaintFeather: _applyInpaintFeather,
    getSelectedAIEndpoint: (type) => _getSelectedAIEndpoint(type),
    ensureActiveMaskLayer: () => _ensureActiveMaskLayer(),
    saveState: _saveState,
    createLayer,
    composite,
    renderLayerPanel: () => _renderLayerPanel(),
    spinnerModule,
    uiModule,
  });

  // Per-tool Opacity / Flow / Softness sliders (Eraser / Brush /
  // Clone) — full implementation in editor/stroke-tool-sliders.js.
  wireStrokeToolSliders();

  // Brush preset picker (engine tips + pressure dynamics) — editor/wire-brush-presets.js.
  wireBrushPresets();

  // Filters panel — live, non-destructive preview of editor/filters/filters.js.
  wireFilters({
    activeLayer: () => activeLayer() || _activeParentLayer(),
    saveState: _saveState,
    composite,
  });

  // Gradient tool controls (type / mode / opacity) — editor/wire-gradient-controls.js.
  wireGradientControls();

  // Marquee mode toggle (rectangle / ellipse / row / column).
  document.querySelectorAll('.ge-marquee-mode').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ge-marquee-mode').forEach((b) => b.classList.toggle('active', b === btn));
    });
  });

  // Shape mode toggle (rectangle / ellipse / line).
  document.querySelectorAll('.ge-shape-mode').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ge-shape-mode').forEach((b) => b.classList.toggle('active', b === btn));
    });
  });

  // Liquify strength label.
  const _liqS = document.getElementById('ge-liquify-strength');
  _liqS?.addEventListener('input', () => {
    const lbl = document.getElementById('ge-liquify-strength-label');
    if (lbl) lbl.textContent = _liqS.value + '%';
  });

  // Smudge strength label.
  const _smudgeS = document.getElementById('ge-smudge-strength');
  _smudgeS?.addEventListener('input', () => {
    const lbl = document.getElementById('ge-smudge-strength-label');
    if (lbl) lbl.textContent = _smudgeS.value + '%';
  });
  // Mixer brush slider labels (Wet / Mix / Flow).
  [['ge-mixer-wet', 'ge-mixer-wet-label'], ['ge-mixer-mix', 'ge-mixer-mix-label'], ['ge-mixer-flow', 'ge-mixer-flow-label']].forEach(([id, lid]) => {
    const el = document.getElementById(id);
    el?.addEventListener('input', () => { const l = document.getElementById(lid); if (l) l.textContent = el.value + '%'; });
  });

  // Dodge/Burn strength label.
  const _dbS = document.getElementById('ge-dodgeburn-strength');
  _dbS?.addEventListener('input', () => {
    const lbl = document.getElementById('ge-dodgeburn-strength-label');
    if (lbl) lbl.textContent = _dbS.value + '%';
  });

  // Paint Bucket tolerance label.
  const _bkT = document.getElementById('ge-bucket-tolerance');
  _bkT?.addEventListener('input', () => {
    const lbl = document.getElementById('ge-bucket-tolerance-label');
    if (lbl) lbl.textContent = _bkT.value;
  });

  // Eyedropper sample size (point / 3×3 / 5×5 average).
  const _eyeSample = document.getElementById('ge-eyedropper-sample');
  _eyeSample?.addEventListener('change', () => { state.eyedropperSampleSize = parseInt(_eyeSample.value, 10) || 1; });

  // Crop "Delete cropped pixels" toggle (PS parity) — off keeps outside pixels.
  const _cropDel = document.getElementById('ge-crop-delete');
  _cropDel?.addEventListener('change', () => { state.cropDeletePixels = _cropDel.checked; });

  // Smudge "Finger painting" toggle — load each stroke with the FG colour.
  const _smudgeFinger = document.getElementById('ge-smudge-finger');
  _smudgeFinger?.addEventListener('change', () => { state.smudgeFingerPaint = _smudgeFinger.checked; });

  // Airbrush / build-up toggle (also Alt+Shift+P).
  const _airbrushCb = document.getElementById('ge-brush-airbrush');
  _airbrushCb?.addEventListener('change', () => { state.airbrush = _airbrushCb.checked; });

  // Velocity taper (speed sensor) — fast strokes thinner.
  const _velEl = document.getElementById('ge-brush-velocity');
  _velEl?.addEventListener('input', () => {
    state.brushVelocityTaper = parseInt(_velEl.value, 10) || 0;
    const lbl = document.getElementById('ge-brush-velocity-label'); if (lbl) lbl.textContent = state.brushVelocityTaper + '%';
  });

  // Type tool — size + font (live-update the text layer being edited).
  const _textSizeEl = document.getElementById('ge-text-size');
  _textSizeEl?.addEventListener('input', () => {
    state.textSize = parseInt(_textSizeEl.value, 10) || 48;
    const lbl = document.getElementById('ge-text-size-label'); if (lbl) lbl.textContent = state.textSize;
    if (state.textEditingLayerId) {
      const l = state.layers.find((x) => x.id === state.textEditingLayerId);
      if (l && l.text) { l.text.size = state.textSize; _renderTextLayer(l); const inp = document.getElementById('ge-text-input'); if (inp) _positionTextEditor(inp, l); composite(); }
    }
  });
  const _textFontEl = document.getElementById('ge-text-font');
  _textFontEl?.addEventListener('change', () => {
    state.textFont = _textFontEl.value;
    if (state.textEditingLayerId) {
      const l = state.layers.find((x) => x.id === state.textEditingLayerId);
      if (l && l.text) { l.text.font = state.textFont; _renderTextLayer(l); const inp = document.getElementById('ge-text-input'); if (inp) inp.style.fontFamily = state.textFont; composite(); }
    }
  });

  // Layer mask button: click = add / toggle editing; right-click = delete.
  const _maskBtn = document.getElementById('ge-layer-mask');
  _maskBtn?.addEventListener('click', () => _toggleLayerMask());
  _maskBtn?.addEventListener('contextmenu', (e) => { e.preventDefault(); _deleteLayerMask(); });

  // Layer effects (Blending Options) button → opens the fx popup.
  document.getElementById('ge-layer-fx')?.addEventListener('click', () => _openFxMenu());

  // Topbar Rotate & Flip (commonly-used, surfaced next to Fit/Scale) → command bus.
  document.getElementById('ge-tb-fliph')?.addEventListener('click', () => runCommand('flip-h'));
  document.getElementById('ge-tb-flipv')?.addEventListener('click', () => runCommand('flip-v'));
  document.getElementById('ge-tb-rotccw')?.addEventListener('click', () => runCommand('rotate-ccw'));
  document.getElementById('ge-tb-rotcw')?.addEventListener('click', () => runCommand('rotate-cw'));

  // Guide actions — hidden relay targets the View menu clicks.
  const _mkGuideBtn = (id, fn) => { const b = document.createElement('button'); b.id = id; b.type = 'button'; b.style.display = 'none'; b.addEventListener('click', fn); state.container.appendChild(b); };
  _mkGuideBtn('ge-guide-v', () => _addGuide('v'));
  _mkGuideBtn('ge-guide-h', () => _addGuide('h'));
  _mkGuideBtn('ge-guide-clear', () => _clearGuides());
  _mkGuideBtn('ge-color-range', () => _runColorRange());
  _mkGuideBtn('ge-content-fill', () => _contentAwareFill());

  // Quick Rotate & Flip row (always visible) — flip-horizontal is a constant
  // painter habit ("flip to check the drawing"); reuse the whole-canvas ops.
  document.getElementById('ge-qt-fliph')?.addEventListener('click', () => _flipAllLayers('h'));
  document.getElementById('ge-qt-flipv')?.addEventListener('click', () => _flipAllLayers('v'));
  document.getElementById('ge-qt-rotccw')?.addEventListener('click', () => _rotateAllLayers(270));
  document.getElementById('ge-qt-rotcw')?.addEventListener('click', () => _rotateAllLayers(90));

  // Distort tool — Apply / Cancel buttons; keep the corner handles glued to the
  // canvas on every redraw (zoom / pan / scroll fire ge:composited).
  document.getElementById('ge-distort-apply')?.addEventListener('click', () => { _distortTool.commit(); composite(); });
  document.getElementById('ge-distort-cancel')?.addEventListener('click', () => { _distortTool.cancel(); });
  const _distortMode = document.getElementById('ge-distort-mode');
  _distortMode?.addEventListener('change', () => { state.distortMode = _distortMode.value; });
  window.addEventListener('ge:composited', () => { if (state.distortActive) _distortTool.reposition(); });
  // Perspective crop — Apply de-skews; Cancel discards; handles track redraws.
  document.getElementById('ge-pcrop-apply')?.addEventListener('click', () => { _pcropTool.apply(); });
  document.getElementById('ge-pcrop-cancel')?.addEventListener('click', () => { _pcropTool.cancel(); });
  window.addEventListener('ge:composited', () => { if (state.pcropActive) _pcropTool.reposition(); });

  // Crop aspect-ratio presets — constrain the crop drag to a fixed ratio.
  document.querySelectorAll('.ge-crop-ratio').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ge-crop-ratio').forEach((b) => b.classList.toggle('active', b === btn));
      const r = parseFloat(btn.dataset.cropRatio) || 0;
      state.cropAspectPreset = r > 0 ? r : null;
    });
  });

  // Sharpen + Bg Remove + edge cleanup — full implementation in
  // editor/ai-rembg.js. Returns the selection-hint-mask builder so
  // the wand-rembg button (in the wand controls section) can reuse it.
  const { buildSelectionHintMask: _buildSelectionHintMask } = wireRembgAndSharpen({
    applyImageTool: _applyImageTool,
    openCookbookForDependency: (pkg) => _openCookbookForDependency(pkg),
    composite,
    renderLayerPanel: () => _renderLayerPanel(),
    uiModule,
  });

  // Image import (topbar / panel File / Clipboard / Gallery picker) —
  // full implementation in editor/wire-import.js. Returns the shared
  // handleImportedImage sink so drag-drop wires through the same path.
  const { handleImportedImage: _handleImportedImage } = wireImport({
    container,
    saveState: _saveState,
    createLayer,
    composite,
    renderLayerPanel: () => _renderLayerPanel(),
    uiModule,
  });

  // Harmonize / Canvas Upscale / AI Upscale / Style Transfer +
  // Add-Empty-Layer — full implementation in editor/ai-tools-misc.js.
  const { addEmptyLayer: _addEmptyLayer } = wireAIToolsMisc({
    apiBase: API_BASE,
    buildLayerBodyMask: _buildLayerBodyMask,
    buildSeamMask: _buildSeamMask,
    applyImageTool: _applyImageTool,
    flatten,
    saveState: _saveState,
    fitZoom: () => _fitZoom(),
    composite,
    createLayer,
    renderLayerPanel: () => _renderLayerPanel(),
    spinnerModule,
    uiModule,
  });
  // (Merge dropdown removed — Merge Down / Merge All / Flatten Copy
  // are now three inline icon buttons in the layers header next to
  // + Add. Their individual click handlers below already bind by id.)

  // Lasso + Magic Wand panel controls — full implementation in
  // editor/wire-selection-controls.js.
  wireSelectionControls({
    composite,
    invertSelection: _invertSelection,
    lassoDeleteSelection: _lassoDeleteSelection,
    lassoCopyToLayer: _lassoCopyToLayer,
    lassoToMask: _lassoToMask,
    runMagicWand: (x, y, mode, opts) => _runMagicWand(x, y, mode, opts),
    wandClear: _wandClear,
    wandDeleteSelection: _wandDeleteSelection,
    wandCopyToNewLayer: _wandCopyToNewLayer,
    wandToMask: _wandToMask,
    buildSelectionHintMask: _buildSelectionHintMask,
    applyImageTool: _applyImageTool,
    uiModule,
  });

  // Merge / Flatten buttons (layer-panel footer) — full
  // implementation in editor/wire-merge-buttons.js.
  wireMergeButtons({
    saveState: _saveState,
    createLayer,
    renderLayerPanel: () => _renderLayerPanel(),
    composite,
    uiModule,
  });

  // Capture-phase Escape interceptor — runs BEFORE any bubble-phase
  // handler (gallery, keyboard-shortcuts module, etc.) so cancelling a
  // crop / lasso / transform inside the editor can't ever bubble up and
  // accidentally close the gallery modal.
  document.addEventListener('keydown', (e) => {
    if (!state.editorOpen) return;
    // Esc on the shortcuts overlay closes it; takes priority over the
    // other modal cancels so the cheatsheet feels responsive AND so the
    // gallery's own Esc handler doesn't fire and close gallery instead.
    if (e.key === 'Escape' && _shortcutsPopover.isOpen()) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      _toggleShortcuts(false);
      return;
    }
    // Enter accepts an active crop (same as the Apply button). Skip when
    // typing in a field — the crop W/H inputs handle their own Enter, and
    // we don't want to hijack Enter elsewhere.
    if (e.key === 'Enter' && state.cropRect && !state.cropping && !state.cropMoving) {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      e.stopPropagation();
      _applyCrop();
      return;
    }
    if (e.key !== 'Escape') return;
    // Escape is disabled inside Gallery Edit. It must not close the
    // editor, close Gallery, or cancel active editor state. (Polygonal-lasso
    // cancel is handled by the window-capture hard guard, which runs first.)
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }, true);

  // Keyboard shortcuts — full implementation in
  // editor/keyboard-shortcuts.js.
  wireKeyboardShortcuts({
    toolbar, toolKeyMap: _toolKeyMap,
    composite, saveState: _saveState, undo, redo,
    toggleShortcuts: _toggleShortcuts,
    confirmTransform: _confirmTransform,
    cancelTransform: _cancelTransform,
    startTransform: _startTransform,
    resizeCustomPrompt: _resizeCustomPrompt,
    addEmptyLayer: _addEmptyLayer,
    brushSizeSync: _brushSizeSync,
    invertSelection: _invertSelection,
    wandDeleteSelection: _wandDeleteSelection,
    wandCopyToNewLayer: _wandCopyToNewLayer,
    lassoDeleteSelection: _lassoDeleteSelection,
    lassoCopyToLayer: _lassoCopyToLayer,
    lassoToMask: _lassoToMask,
    buildLassoMask: _buildLassoMask,
    drawLassoOverlay: _drawLassoOverlay,
    swapColors: _swapColors,
    defaultColors: _defaultColors,
    activeLayer,
    uiModule,
    renderLayerPanel: () => _renderLayerPanel(),
    fillActiveLayer: (c) => _fillActiveLayer(c),
    stampVisible: () => _stampVisible(),
    confirmDistort: () => { _distortTool.commit(); composite(); },
    cancelDistort: () => _distortTool.cancel(),
    polyLassoClose: () => _polyLassoTool.close(),
    polyLassoCancel: () => _polyLassoTool.cancel(),
    magLassoClose: () => _magLassoTool.close(),
    magLassoCancel: () => _magLassoTool.cancel(),
  });
  container.setAttribute('tabindex', '0');

  // Paste + drag-and-drop image import — full implementation in
  // editor/clipboard-and-drop.js.
  wireClipboardAndDrop({
    container,
    saveState: _saveState,
    createLayer,
    renderLayerPanel: () => _renderLayerPanel(),
    composite,
    handleImportedImage: (img) => _handleImportedImage(img),
    uiModule,
  });
}

// ── Layer panel rendering ──

// Layer-panel renderer — implementation in editor/layer-panel.js.
// Wrap to the legacy name so the dozens of `_renderLayerPanel()` call
// sites scattered across the file keep working unchanged.
const _layerPanelRenderer = createLayerPanelRenderer({
  composite,
  saveState: _saveState,
  showLayerThumb: (row, layer) => _showLayerThumb(row, layer),
  hideLayerThumb: () => _hideLayerThumb(),
  loadLayerAlphaAsSelection: (layer) => _loadLayerAlphaAsSelection(layer),
  openFxPopup: (layer, anchor) => _openFxPopup(layer, anchor),
  editAdjLayer: (layer, adj, anchor) => _editAdjLayer(layer, adj, anchor),
  createLayer,
  lassoToMask: () => _lassoToMask(),
  wandToMask: () => _wandToMask(),
  getActiveMaskLayer: () => _getActiveMaskLayer(),
  syncFxPanelToActiveLayerIfPresent: () => _syncFxPanelToActiveLayerIfPresent(),
  dragSortModule,
  uiModule,
});
function _renderLayerPanel() {
  const r = _layerPanelRenderer.render();
  // Keep the Move-tool transform box glued to the active layer after any
  // panel re-render. Arms the box if none is up yet (covers editor open,
  // where every load path calls _renderLayerPanel() once the layer exists)
  // and re-targets it if the active layer changed (add / delete / reorder /
  // merge). Re-composite so the box repaints on the right layer. Skipped
  // while a non-silent Free-Transform session owns the canvas.
  if (state.tool === 'move' && !(state.transformActive && !state.transformSilent) &&
      state.transformLayer !== activeLayer()) {
    _resyncMoveTransform();
    composite();
  }
  return r;
}

function _revealLayerPanel() {
  requestAnimationFrame(() => {
    const panel = state.container?.querySelector?.('.ge-right-panel') ||
      document.querySelector('.ge-right-panel');
    if (!panel) return;
    panel.classList.remove('minimized');
    panel.classList.add('expanded');
  });
}

// ── Flatten / Export ──

function flatten() {
  const out = document.createElement('canvas');
  out.width = state.imgWidth;
  out.height = state.imgHeight;
  const ctx = out.getContext('2d');
  // Use the SAME renderer as the on-screen composite so the saved/exported image
  // honours blend modes, clipping masks, layer opacity, and adjustment layers
  // (a plain drawImage loop dropped all of those → exports didn't match the
  // canvas). No checkerboard/overlays — transparent areas stay transparent.
  _renderLayersTo(ctx, out);
  return out;
}

// Build the union of all "foreground" visible-layer alphas (binary).
// "Background" = the BOTTOMMOST visible layer (Harmonize's colour-match
// reference). Everything visible ABOVE it = foreground that goes into
// the body mask. Independent of the `isBase` flag, so reordering layers
// (or hiding the original photo after a bg-remove) doesn't break the
// semantics.
// Harmonize-pipeline mask builders live in editor/harmonize-masks.js.
// Thin wrappers translate module state into the pure helpers.
function _harmonizeLayerList() {
  return state.layers.filter(l => !l.isGroup).map(l => ({
    visible: l.visible,
    id: l.id,
    canvas: l.canvas,
    offset: state.layerOffsets.get(l.id) || { x: 0, y: 0 },
  }));
}
function _buildLayerUnionAlpha() { return _layerUnionAlphaImpl(state.imgWidth, state.imgHeight, _harmonizeLayerList()); }
function _buildSeamMask(featherPx = 12) { return _seamMaskImpl(state.imgWidth, state.imgHeight, _harmonizeLayerList(), featherPx); }
function _buildLayerBodyMask(featherPx = 12) { return _layerBodyMaskImpl(state.imgWidth, state.imgHeight, _harmonizeLayerList(), featherPx); }

export function exportPNG() {
  return flatten().toDataURL('image/png');
}

// Briefly turn the Save button green with a checkmark so the user can't
// miss a successful save (the toast alone is easy to miss on remote
// connections where focus drifts during the upload).
function _flashSaveButtonOk() {
  const btn = document.getElementById('ge-save-menu-btn');
  if (!btn) return;
  const origHTML = btn.innerHTML;
  const origBg = btn.style.background;
  btn.style.background = '#3aa75a';
  btn.style.color = '#fff';
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:4px;"><polyline points="20 6 9 17 4 12"/></svg>Saved';
  setTimeout(() => {
    btn.style.background = origBg;
    btn.style.color = '';
    btn.innerHTML = origHTML;
  }, 1800);
}

// Show whirlpool + label on the visible "Save ▾" topbar button while a
// save operation runs. Returns a function to call when done (or in finally).
function _saveButtonBusy(label) {
  const btn = document.getElementById('ge-save-menu-btn');
  if (!btn) return () => {};
  const origHTML = btn.innerHTML;
  const origWidth = btn.offsetWidth;
  btn.disabled = true;
  btn.style.minWidth = origWidth + 'px';
  btn.innerHTML = '';
  let sp = null;
  try {
    sp = spinnerModule.create('', 'clean', 'whirlpool');
    btn.appendChild(sp.createElement());
    const txt = document.createElement('span');
    txt.className = 'ge-btn-busy-label';
    txt.textContent = label || 'Saving…';
    btn.appendChild(txt);
    sp.start();
  } catch { btn.textContent = label || 'Saving…'; }
  return () => {
    try { sp && sp.stop && sp.stop(); } catch {}
    btn.disabled = false;
    btn.innerHTML = origHTML;
    btn.style.minWidth = '';
  };
}

export async function exportToGallery() {
  const endBusy = _saveButtonBusy('Saving copy…');
  let blob = null;
  let savedOk = false;
  const t0 = performance.now();
  try {
    // toBlob() avoids the 2x peak memory of dataURL → fetch → blob. JPEG
    // re-encode for camera photos keeps uploads small enough to make it
    // through remote tunnels.
    const flat = flatten();
    const ext = (state.originalExt || 'png').toLowerCase();
    const isJpeg = ext === 'jpg' || ext === 'jpeg';
    const mime = isJpeg ? 'image/jpeg' : 'image/png';
    const quality = isJpeg ? 0.92 : undefined;
    blob = await new Promise((resolve, reject) => {
      flat.toBlob(b => b ? resolve(b) : reject(new Error('Canvas encode failed')), mime, quality);
    });
    const formData = new FormData();
    formData.append('file', blob, `edited.${isJpeg ? 'jpg' : 'png'}`);

    const saveRes = await fetch(`${API_BASE}/api/gallery/upload`, {
      method: 'POST',
      credentials: 'same-origin',
      body: formData,
    });
    if (!saveRes.ok) {
      const errBody = await saveRes.text().catch(() => '');
      throw new Error(`HTTP ${saveRes.status}: ${errBody.substring(0, 120)}`);
    }
    const totalMs = Math.round(performance.now() - t0);
    window.dispatchEvent(new CustomEvent('gallery-refresh'));
    if (uiModule) uiModule.showToast(`Saved copy to gallery (${(blob.size / 1024 / 1024).toFixed(1)}MB · ${(totalMs / 1000).toFixed(1)}s)`, 4000);
    savedOk = true;
    if (state.draftId) {
      _clearDraftServer(state.draftId);
      state.draftId = null;
    }
  } catch (e) {
    console.error('[save-as-copy] error:', e);
    const sizeMB = blob ? ` (${(blob.size / 1024 / 1024).toFixed(1)}MB)` : '';
    let msg = e?.message || 'unknown';
    if (e?.name === 'TypeError' || /fetch|network|load failed/i.test(msg)) {
      msg = `network dropped${sizeMB} — check connection`;
    } else {
      msg += sizeMB;
    }
    if (uiModule) uiModule.showToast('Save failed: ' + msg, 6000);
  } finally {
    endBusy();
    if (savedOk) _flashSaveButtonOk();
  }
}

// Open the Cookbook modal scoped to img2img-capable models so the user
// can serve one in a few clicks. Falls back to plain Cookbook if the
// filter hook isn't available.
// Open Cookbook on its Dependencies tab and highlight a specific
// package row. Used for "rembg not installed" → install path.
function _openCookbookForDependency(pkgName) {
  // Use cookbookModule.open({ tab: 'Dependencies' }) so the intent is
  // honored after Cookbook's async render. The old path clicked the
  // sidebar button + polled for the modal, but Cookbook's _renderRecipes
  // runs AFTER an awaited _syncFromServer, so depsTab.click() often
  // raced and the user landed on Download.
  const cookbook = window.cookbookModule;
  if (!cookbook || typeof cookbook.open !== 'function') {
    // Fall back to the old click-then-poll path if the module isn't
    // on window for some reason.
    const btn = document.getElementById('tool-cookbook-btn');
    if (btn) btn.click();
    else if (uiModule) uiModule.showToast(`Open Cookbook to install ${pkgName}`, 6000);
    return;
  }
  cookbook.open({ tab: 'Dependencies' });
  // Now wait for the Dependencies group to render, switch the server
  // selector to Local, and highlight the package row.
  const cb = document.getElementById('cookbook-modal');
  if (cb) cb.style.zIndex = 260;
  const tryServer = (attempt = 0) => {
    const serverSel = document.getElementById('hwfit-deps-server');
    if (!serverSel) {
      if (attempt < 25) return setTimeout(() => tryServer(attempt + 1), 80);
      return;
    }
    if (serverSel.value !== 'local') {
      serverSel.value = 'local';
      serverSel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };
  tryServer();
  const tryHighlight = (a2 = 0) => {
    const rows = document.querySelectorAll('[data-pkg-name]');
    if (!rows.length) {
      if (a2 < 40) return setTimeout(() => tryHighlight(a2 + 1), 100);
      return;
    }
    const row = Array.from(rows).find(r => (r.dataset.pkgName || '').toLowerCase() === pkgName.toLowerCase());
    if (row) {
      row.scrollIntoView({ block: 'center' });
      row.classList.add('cookbook-pkg-flash');
      setTimeout(() => row.classList.remove('cookbook-pkg-flash'), 2000);
    }
  };
  tryHighlight();
}

// Async check whether `rembg` is installed on the Odysseus server.
// Toggles the "install rembg" notice + the Bg Remove run button. The
// `/api/cookbook/packages` endpoint is cheap (importlib calls only).
async function _checkRembgInstalled() {
  const noticeEl = document.getElementById('ge-rembg-dep-missing');
  const runRow = document.getElementById('ge-rembg-run-row');
  if (!noticeEl || !runRow) return;
  // Use cached result if we already checked this editor session.
  if (state.rembgInstalledCache !== null) {
    noticeEl.style.display = state.rembgInstalledCache ? 'none' : '';
    runRow.style.display = state.rembgInstalledCache ? '' : 'none';
    return;
  }
  try {
    const r = await fetch('/api/cookbook/packages', { credentials: 'same-origin' });
    if (!r.ok) throw new Error('packages query failed');
    const data = await r.json();
    const pkg = (data.packages || []).find(p => (p.name || '').toLowerCase() === 'rembg');
    state.rembgInstalledCache = pkg ? !!pkg.installed : null;
  } catch (e) {
    state.rembgInstalledCache = null; // unknown — fall back to silent
  }
  if (state.rembgInstalledCache === false) {
    noticeEl.style.display = '';
    runRow.style.display = 'none';
  } else {
    noticeEl.style.display = 'none';
    runRow.style.display = '';
  }
}

function _openCookbookForImg2img() {
  // Try multiple openers in order — the sidebar button may be hidden on
  // mobile so we fall back to the rail button, then to modalManager.
  let opened = false;
  const btn = document.getElementById('tool-cookbook-btn');
  const railBtn = document.getElementById('rail-cookbook');
  if (btn && btn.offsetParent !== null) { btn.click(); opened = true; }
  else if (railBtn) { railBtn.click(); opened = true; }
  else { try { modalManager.restore('cookbook-modal'); opened = true; } catch {} }
  if (opened) {
    // Two-stage navigation: 1) wait for modal mount, 2) click Serve tab,
    // 3) after the serve tag chips render, click the "image" one.
    const tryServe = (attempt = 0) => {
      const cb = document.getElementById('cookbook-modal');
      const serveTab = cb ? cb.querySelector('.cookbook-tab[data-backend="Serve"]') : null;
      // Retry until BOTH the modal mounts AND its tab bar has rendered.
      // Cookbook builds its body html after the modal opens, so we need
      // to wait a bit longer than just "modal exists".
      if (!cb || !serveTab) {
        if (attempt < 40) return setTimeout(() => tryServe(attempt + 1), 80);
        return;
      }
      cb.style.zIndex = 260;
      serveTab.click();
      // Now wait for the serve-tags container to populate (it lazy-loads
      // after the cached-models fetch resolves) and click the image chip.
      const tryImageFilter = (a2 = 0) => {
        const tags = document.getElementById('serve-tags');
        if (!tags || !tags.querySelector('.memory-cat-chip')) {
          if (a2 < 20) return setTimeout(() => tryImageFilter(a2 + 1), 100);
          return;
        }
        const imgChip = Array.from(tags.querySelectorAll('.memory-cat-chip'))
          .find(c => /^image$/i.test(c.dataset.serveTag || '') || /image/i.test(c.textContent || ''));
        if (imgChip) imgChip.click();
      };
      tryImageFilter();
    };
    tryServe();
    return;
  }
  if (uiModule) uiModule.showToast('Open Cookbook from the sidebar to serve an img2img model', 6000);
}

export function downloadPNG() {
  const dataUrl = exportPNG();
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = 'edited-image.png';
  a.click();
}

// Save the entire layered editor state as a JSON project file. Each
// layer is encoded as a base64 PNG so transparency / partial alpha
// survives the round-trip. Use Load Project to restore.
function _saveProject() {
  if (!state.layers.length) {
    if (uiModule) uiModule.showToast('Nothing to save');
    return;
  }
  const project = {
    v: 1,
    type: 'odysseus-gallery-editor-project',
    imgWidth: state.imgWidth,
    imgHeight: state.imgHeight,
    activeLayerId: state.activeLayerId,
    nextLayerId: state.nextLayerId,
    layers: state.layers.map(l => {
      if (l.isGroup) {
        return { id: l.id, name: l.name, visible: l.visible, opacity: l.opacity,
                 isGroup: true, collapsed: !!l.collapsed };
      }
      return {
        id: l.id,
        name: l.name,
        visible: l.visible,
        opacity: l.opacity,
        blendMode: l.blendMode || 'source-over',
        clipped: !!l.clipped,
        lockAlpha: !!l.lockAlpha,
        locked: l.locked,
        groupId: l.groupId || null,
        canvasW: l.canvas.width,
        canvasH: l.canvas.height,
        offset: { ...(state.layerOffsets.get(l.id) || { x: 0, y: 0 }) },
        dataUrl: l.canvas.toDataURL('image/png'),
        layerMask: l.layerMask ? l.layerMask.toDataURL('image/png') : null,
        fx: l.fx || null,
        text: l.text || null,
        // Smart Object: pristine source + applied transform (+ optional link).
        isSmart: !!l.isSmart,
        smartXf: l.isSmart ? l.smartXf : null,
        sourceUrl: (l.isSmart && l.sourceCanvas) ? l.sourceCanvas.toDataURL('image/png') : null,
        linked: l.linked || null,
      };
    }),
  };
  const json = JSON.stringify(project);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'project.geproj.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  if (uiModule) uiModule.showToast('Project saved', 3000);
}

// Open-file picker for Load Project. Restores layers + canvas size.
function _loadProjectPrompt() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'application/json,.json';
  inp.addEventListener('change', async () => {
    const file = inp.files && inp.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const proj = JSON.parse(text);
      if (proj.type !== 'odysseus-gallery-editor-project') {
        if (uiModule) uiModule.showToast('Not a project file', 5000);
        return;
      }
      await _restoreDraft(proj);
      composite();
      _renderLayerPanel();
      _fitZoom();
      if (uiModule) uiModule.showToast('Project loaded', 3000);
    } catch (e) {
      if (uiModule) uiModule.showToast('Load failed: ' + (e.message || e), 6000);
    }
  });
  inp.click();
}

// ── Public API ──

// Styled in-app prompt for canvas size — replaces the browser's
// native prompt() which doesn't follow the app theme. Returns a Promise
// resolving to { w, h, name, bg:{type,color} } on submit, or null on
// cancel. Optional opts: title, okLabel, initialW, initialH, initialName.
function _promptCanvasSize(opts) {
  opts = opts || {};
  const title    = opts.title    || 'New canvas';
  const okLabel  = opts.okLabel  || 'Create';
  const initialW = opts.initialW || 1024;
  const initialH = opts.initialH || 1024;
  const initialName = opts.initialName || 'Untitled';
  return new Promise(resolve => {
    let overlay = document.getElementById('ge-canvas-size-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'ge-canvas-size-overlay';
      overlay.className = 'modal';
      overlay.innerHTML = _canvasSizePromptHTML();
      document.body.appendChild(overlay);
    }
    overlay.style.display = '';
    overlay.classList.remove('hidden');
    const nameInput = document.getElementById('ge-canvas-prompt-name');
    const wInput = document.getElementById('ge-canvas-prompt-w');
    const hInput = document.getElementById('ge-canvas-prompt-h');
    const okBtn = document.getElementById('ge-canvas-prompt-ok');
    const cancelBtn = document.getElementById('ge-canvas-prompt-cancel');
    const titleEl = document.getElementById('ge-canvas-prompt-title');
    const ratioBtns = Array.from(overlay.querySelectorAll('.ge-cp-ratio'));
    const presetBtns = Array.from(overlay.querySelectorAll('.ge-cp-preset'));
    const bgBtns = Array.from(overlay.querySelectorAll('.ge-cp-bg'));
    const bgColorInput = document.getElementById('ge-canvas-prompt-bgcolor');
    if (titleEl) titleEl.textContent = title;
    if (okBtn) okBtn.textContent = okLabel;
    if (nameInput) nameInput.value = initialName;
    wInput.value = String(initialW);
    hInput.value = String(initialH);

    // Background contents — segmented White / Transparent / Color. The
    // color swatch is only shown while "Color" is selected.
    let bgType = 'white';
    function setActiveBg(btn) {
      bgType = btn.dataset.bg;
      bgBtns.forEach((b) => b.classList.toggle('active', b === btn));
      if (bgColorInput) bgColorInput.style.display = (bgType === 'color') ? '' : 'none';
    }
    const onBgClick = (e) => setActiveBg(e.currentTarget);
    // Reset to White each open.
    bgBtns.forEach((b) => { b.classList.toggle('active', b.dataset.bg === 'white'); b.addEventListener('click', onBgClick); });
    if (bgColorInput) bgColorInput.style.display = 'none';

    // Aspect-ratio constraint: with a ratio selected (not "free"), editing one
    // dimension auto-fills the other. Default to "free".
    let ratio = null; // { rw, rh } or null for free
    const clampPx = (n) => Math.max(1, Math.min(8192, Math.round(n)));
    function setActiveRatio(btn) {
      ratioBtns.forEach((b) => b.classList.toggle('active', b === btn));
      const r = btn.dataset.ratio;
      if (r === 'free') { ratio = null; return; }
      const m = r.split(':'); ratio = { rw: +m[0], rh: +m[1] };
      // Recompute height from the current width so the shown pair matches.
      const w = parseInt(wInput.value, 10);
      if (w > 0) hInput.value = String(clampPx(w * ratio.rh / ratio.rw));
    }
    const onWidthIn = () => { if (!ratio) return; const w = parseInt(wInput.value, 10); if (w > 0) hInput.value = String(clampPx(w * ratio.rh / ratio.rw)); };
    const onHeightIn = () => { if (!ratio) return; const h = parseInt(hInput.value, 10); if (h > 0) wInput.value = String(clampPx(h * ratio.rw / ratio.rh)); };
    const onRatioClick = (e) => setActiveRatio(e.currentTarget);
    const onPresetClick = (e) => {
      wInput.value = e.currentTarget.dataset.w;
      hInput.value = e.currentTarget.dataset.h;
      ratio = null; // a preset sets an exact size; leave further edits free
      ratioBtns.forEach((b) => b.classList.toggle('active', b.dataset.ratio === 'free'));
    };
    // Reset to "free" each open + wire.
    ratioBtns.forEach((b) => { b.classList.toggle('active', b.dataset.ratio === 'free'); b.addEventListener('click', onRatioClick); });
    presetBtns.forEach((b) => b.addEventListener('click', onPresetClick));
    wInput.addEventListener('input', onWidthIn);
    hInput.addEventListener('input', onHeightIn);

    // Focus the NAME field on open (most users want to title the doc first).
    setTimeout(() => { if (nameInput) { nameInput.focus(); nameInput.select(); } else { wInput.focus(); wInput.select(); } }, 0);
    function cleanup(result) {
      overlay.style.display = 'none';
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      ratioBtns.forEach((b) => b.removeEventListener('click', onRatioClick));
      presetBtns.forEach((b) => b.removeEventListener('click', onPresetClick));
      bgBtns.forEach((b) => b.removeEventListener('click', onBgClick));
      wInput.removeEventListener('input', onWidthIn);
      hInput.removeEventListener('input', onHeightIn);
      resolve(result);
    }
    function onOk() {
      const dims = _parseCanvasSizePrompt(wInput.value, hInput.value, initialW, initialH);
      if (!dims) { uiModule.showToast('Invalid size'); return; }
      const name = (nameInput && nameInput.value.trim()) || initialName;
      const bg = { type: bgType, color: (bgColorInput && bgColorInput.value) || '#ffffff' };
      cleanup({ w: dims.w, h: dims.h, name, bg });
    }
    function onCancel() { cleanup(null); }
    function onBackdrop(e) { if (e.target === overlay) cleanup(null); }
    function onKey(e) {
      if (e.key === 'Enter') { e.preventDefault(); onOk(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cleanup(null); }
    }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
  });
}

function _parseCanvasSizePrompt(widthText, heightText, initialW = 1024, initialH = 1024) {
  const parseWhole = (value) => {
    const text = String(value || '').trim();
    if (!/^\d+$/.test(text)) return null;
    const n = Number(text);
    return Number.isSafeInteger(n) && n >= 1 && n <= 8192 ? n : null;
  };
  const parseRatio = (value) => {
    const m = String(value || '').trim().match(/^(\d+(?:\.\d+)?)\s*(?:x|×|:|\/)\s*(\d+(?:\.\d+)?)$/i);
    if (!m) return null;
    const rw = Number(m[1]);
    const rh = Number(m[2]);
    if (!Number.isFinite(rw) || !Number.isFinite(rh) || rw <= 0 || rh <= 0) return null;
    const w = Math.max(1, Math.min(8192, Math.round(initialW)));
    const h = Math.max(1, Math.min(8192, Math.round(w * rh / rw)));
    return { w, h };
  };
  const ratioDims = parseRatio(widthText) || parseRatio(heightText);
  if (ratioDims) return ratioDims;
  const w = parseWhole(widthText);
  const h = parseWhole(heightText);
  if (!w || !h) return null;
  return { w, h };
}

// imageUrl=null + presetSize={w,h} → skips the size prompt and creates a
// blank canvas at the given dimensions (used by template tiles in the
// gallery's Edit-tab landing). `displayName` is optional — when provided,
// the Edit tab in the gallery is renamed to "Edit: <name>".
// Shared loading-overlay mount/unmount — used by the image-load path AND
// the draft-restore paths so every "we're waiting on something" moment
// in the editor surfaces the same whirlpool + label instead of a blank
// canvas that looks broken.
function _mountEditorLoading(label, dims) {
  if (!state.container) return;
  const area = state.container.querySelector('.ge-canvas-area');
  _unmountEditorLoading();
  // Cover the WHOLE editor (toolbar + canvas + panel), not just the canvas area
  // — otherwise the toolbar/old content shows above the overlay at the top while
  // a past project loads, which looks half-rendered.
  const el = document.createElement('div');
  el.className = 'ge-loading-overlay ge-loading-overlay-full';
  // Aspect-ratio placeholder so the user sees the shape of the canvas they're
  // about to land in. Sized to the canvas area but centered in the overlay.
  let placeholder = null;
  if (dims && dims.w > 0 && dims.h > 0 && area) {
    placeholder = document.createElement('div');
    placeholder.className = 'ge-canvas-placeholder';
    const areaRect = area.getBoundingClientRect();
    const maxW = Math.max(0, areaRect.width - 32);
    const maxH = Math.max(0, areaRect.height - 32);
    const ratio = dims.w / dims.h;
    let w = maxW;
    let h = w / ratio;
    if (h > maxH) { h = maxH; w = h * ratio; }
    placeholder.style.width = w + 'px';
    placeholder.style.height = h + 'px';
    el.appendChild(placeholder);
  }
  const inner = document.createElement('div');
  inner.className = 'ge-loading-inner';
  inner.innerHTML = `<span class="ge-loading-text">${label || 'Loading…'}</span>`;
  el.appendChild(inner);
  // Mount on the editor BODY (toolbar + canvas + panel) — it sits below the
  // gallery's search/select bar, so the cover doesn't bleed up over those.
  const _mountTarget = state.container.querySelector('.ge-editor-body') || state.container;
  _mountTarget.appendChild(el);
  try {
    const sp = spinnerModule.create('', 'clean', 'whirlpool');
    inner.insertBefore(sp.createElement(), inner.firstChild);
    sp.start();
    el._spinner = sp;
  } catch {}
  el._placeholder = placeholder;
  state.editorLoadingEl = el;
}
function _unmountEditorLoading() {
  if (!state.editorLoadingEl) return;
  try { state.editorLoadingEl._spinner?.destroy(); } catch {}
  try { state.editorLoadingEl._placeholder?.remove(); } catch {}
  try { state.editorLoadingEl.remove(); } catch {}
  state.editorLoadingEl = null;
}

export function openEditor(imageUrl, imageId, presetSize, displayName, draftId) {
  _setEditTabLabel(displayName || (presetSize ? 'New canvas' : 'Untitled'));
  state.imageId = imageId || null;
  // Track original file extension so save-over-original can re-encode in the
  // same format. JPEG re-encoding cuts upload size 5-10x for camera photos,
  // which matters over remote tunnels (Tailscale Funnel etc.).
  try {
    const m = (imageUrl || '').match(/\.([a-z0-9]{2,5})(?:\?|$)/i);
    state.originalExt = m ? m[1].toLowerCase() : 'png';
  } catch { state.originalExt = 'png'; }
  state.draftId = draftId || null;
  state.draftName = displayName || (presetSize ? `New ${presetSize.w}×${presetSize.h}` : 'Untitled');
  state.editorOpen = true;
  state.layers = [];
  state.undoStack = [];
  state.redoStack = [];
  state.layerOffsets.clear();
  state.nextLayerId = 1;
  state.tool = 'move';
  state.cropRect = null;
  state.lassoPoints = [];
  state.lassoActive = false;
  window.__galleryEditLive = true;
  if (state.persistTimer) { clearTimeout(state.persistTimer); state.persistTimer = null; }
  state.persistDirty = false;

  state.container = document.getElementById('gallery-editor-container');
  if (!state.container) {
    console.error('[openEditor] #gallery-editor-container not found in DOM — editor cannot open');
    if (uiModule) uiModule.showError('Editor container missing');
    return;
  }
  state.container.style.display = 'flex';

  try {
    _buildEditor(state.container);
  } catch (e) {
    console.error('[openEditor] _buildEditor threw:', e);
    if (uiModule) uiModule.showError('Editor failed to build: ' + (e?.message || 'unknown'));
    return;
  }

  function _initCanvas(w, h) {
    state.imgWidth = w;
    state.imgHeight = h;
    state.mainCanvas.width = w;
    state.mainCanvas.height = h;
    state.maskCanvas = document.createElement('canvas');
    state.maskCanvas.width = w;
    state.maskCanvas.height = h;
    state.maskCtx = state.maskCanvas.getContext('2d');
  }

  if (!imageUrl && draftId) {
    // Re-open a saved draft by its server-side id — covers the
    // "Resume" buttons on the Edit-tab landing.
    _mountEditorLoading('Loading draft…', presetSize || null);
    // Bail if the user closes the editor while the async load is in
    // flight — without this guard, the .then() callbacks fire after
    // closeEditor and re-mount the spinner / draw into a dead canvas,
    // leaving "stuck" preview artefacts on the next open.
    return _loadDraftById(draftId)
      .then(d => {
        if (!state.editorOpen) return;
        if (!d) {
          _unmountEditorLoading();
          if (uiModule) uiModule.showToast('Draft not found');
          closeEditor();
          return;
        }
        state.draftId = d.id;
        state.draftName = d.name || 'Untitled';
        _setEditTabLabel(state.draftName);
        state.imageId = d.source_image_id || null;
        return _restoreDraft(d).then(() => {
          if (!state.editorOpen) return;
          composite();
          _renderLayerPanel();
          _fitZoom();
          const sizeLabel = document.getElementById('ge-canvas-size');
          if (sizeLabel) sizeLabel.textContent = `${state.imgWidth}×${state.imgHeight}`;
          _unmountEditorLoading();
          if (uiModule) uiModule.showToast('Resumed draft');
        });
      })
      .catch(err => {
        if (!state.editorOpen) return;
        _unmountEditorLoading();
        console.warn('[ge] draft load failed', err);
        if (uiModule) uiModule.showToast('Failed to load draft');
        closeEditor();
      });
  }

  if (!imageUrl) {
    // Empty canvas — use preset size if supplied, otherwise show the
    // styled prompt. Asynchronous: we promise-chain so callers can await
    // openEditor() and still rely on isEditorOpen() afterwards.
    const _finishBlank = (w, h, name, bg) => {
      _initCanvas(w, h);
      // Background filled per chosen contents (white / solid colour /
      // transparent-skip), then a separate transparent Edit layer on top —
      // keeps user's work isolated from the underlying canvas, the
      // standard editor pattern.
      const bgLayer = createLayer('Background', w, h);
      const bgType = (bg && bg.type) || 'white';
      if (bgType === 'transparent') {
        // leave the Background layer cleared (alpha 0)
      } else {
        bgLayer.ctx.fillStyle = (bgType === 'color' && bg && bg.color) ? bg.color : '#ffffff';
        bgLayer.ctx.fillRect(0, 0, w, h);
      }
      const editLayer = createLayer('Edit', w, h);
      state.layers.push(bgLayer);
      state.layers.push(editLayer);
      state.activeLayerId = editLayer.id;
      // Title the document from the dialog before the first persist.
      state.draftName = name || 'Untitled';
      _setEditTabLabel(state.draftName);
      composite();
      _renderLayerPanel();
      _fitZoom();
      // First persist creates the server-side row (blank-canvas drafts).
      _schedulePersist();
    };
    if (presetSize && presetSize.w > 0 && presetSize.h > 0) {
      _finishBlank(presetSize.w, presetSize.h, presetSize.name || displayName || 'Untitled', presetSize.bg);
      return;
    }
    return _promptCanvasSize({ initialName: displayName || 'Untitled' }).then(size => {
      if (!size) { closeEditor(); return; }
      _finishBlank(size.w, size.h, size.name, size.bg);
    });
  }

  // Try to restore a previously-persisted draft for this image — that
  // way closing the gallery / editor mid-edit doesn't lose progress.
  // (Server-backed: look up by source_image_id.)
  _mountEditorLoading('Looking up draft…');
  _findDraftForImage(imageId).then(_draft => {
    if (!state.editorOpen) return;
    if (!_draft) return null;
    state.draftId = _draft.id;
    state.draftName = _draft.name || displayName || 'Untitled';
    const innerLabel = state.editorLoadingEl?.querySelector('.ge-loading-text');
    if (innerLabel) innerLabel.textContent = 'Resuming draft…';
    return _restoreDraft(_draft).then(() => {
      if (!state.editorOpen) return null;
      // If the draft was broken/empty (0 layers reconstructed), fall
      // through to loading the source image as a normal edit. Without
      // this guard the editor would sit empty and the user would be
      // stuck with no way to recover.
      if (state.layers.length === 0) {
        console.warn('[openEditor] draft restored but produced 0 layers — falling back to source image');
        return null;
      }
      composite();
      _renderLayerPanel();
      _fitZoom();
      const sizeLabel = document.getElementById('ge-canvas-size');
      if (sizeLabel) sizeLabel.textContent = `${state.imgWidth}×${state.imgHeight}`;
      _unmountEditorLoading();
      if (uiModule) uiModule.showToast('Resumed previous edit');
      return 'restored';
    });
  }).then(restored => {
    if (!state.editorOpen) return;
    if (restored) return;
    _loadSourceImage();
  }).catch(err => {
    if (!state.editorOpen) return;
    _unmountEditorLoading();
    console.warn('[openEditor] draft lookup failed', err);
    _loadSourceImage();
  });
  function _loadSourceImage() {

  // Loading overlay — whirlpool + "Loading" label while the source image
  // downloads / decodes. Especially important for multi-MB photos where
  // the canvas would otherwise sit blank for several seconds with no
  // feedback. If a draft-lookup overlay is already mounted, reuse it.
  if (!state.editorLoadingEl) _mountEditorLoading('Loading…');
  else {
    const inner = state.editorLoadingEl.querySelector('.ge-loading-text');
    if (inner) inner.textContent = 'Loading…';
  }
  const _removeLoading = () => _unmountEditorLoading();

  // Load image — single layer named "Photo" (no extra Edit layer; the
  // user can add one manually if they want isolated edits).
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    if (!state.editorOpen) return;
    _initCanvas(img.naturalWidth, img.naturalHeight);
    const photoLayer = createLayer('Photo', state.imgWidth, state.imgHeight);
    photoLayer.ctx.drawImage(img, 0, 0);
    photoLayer.isBase = true;
    state.layers.push(photoLayer);
    state.activeLayerId = photoLayer.id;
    composite();
    _renderLayerPanel();
    _fitZoom();
    _removeLoading();
    _schedulePersist();
  };
  img.onerror = (e) => {
    console.error('[_loadSourceImage] onerror — failed to load', imageUrl, e);
    _removeLoading();
    if (uiModule) uiModule.showToast('Failed to load image');
    closeEditor();
  };
  img.src = imageUrl;
  }
}

// Update the gallery's Edit tab label to reflect what's currently open.
// Pass null to reset to plain "Edit". Only mutates the inner label span
// so the SVG icon next to it survives the update.
function _setEditTabLabel(name) {
  const tab = document.getElementById('gallery-editor-tab');
  if (!tab) return;
  const labelEl = tab.querySelector('.gallery-tab-label') || tab;
  if (!name) {
    labelEl.textContent = 'Edit';
    tab.classList.remove('has-edit');
    return;
  }
  const trimmed = name.length > 24 ? name.slice(0, 22) + '…' : name;
  labelEl.textContent = `Edit: ${trimmed}`;
  tab.classList.add('has-edit');
}

export function closeEditor() {
  const editorMounted = _galleryEditMounted();
  if ((state.editorOpen || editorMounted) && !window.__galleryAllowCloseEditor) {
    try { uiModule.showToast('Close the edit tab first'); } catch {}
    return false;
  }
  // Flush any pending debounced persist + fire one final save so closing
  // the editor mid-stroke doesn't lose work. The call is fire-and-forget;
  // the server commit lands shortly after the modal hides.
  if (state.persistTimer) { clearTimeout(state.persistTimer); state.persistTimer = null; }
  if (state.layers.length) {
    try { _persistDraft(); } catch {}
  }
  _setEditTabLabel(null);
  _unmountEditorLoading();
  state.editorOpen = false;
  // Drop every document-level click-away handler registered by this
  // openEditor invocation. Without this, dropdown closers accumulated
  // across reopens (six handlers × N opens).
  while (state.editorDocClickHandlers.length) {
    const h = state.editorDocClickHandlers.pop();
    try { document.removeEventListener('click', h); } catch {}
  }
  if (state.cursorEl) { state.cursorEl.remove(); state.cursorEl = null; }
  // Tear down all floating popups + the dock so closing the editor
  // doesn't leave stale chips/panels behind on top of the gallery.
  try { _closeFxMenu(); } catch {}
  try { _closeAdjPopup(); } catch {}
  try { _closeHistoryPanel(); } catch {}
  try {
    const dock = document.getElementById('ge-fx-dock');
    if (dock) dock.remove();
  } catch {}
  try {
    document.querySelectorAll('.ge-inpaint-popup, .ge-fx-popup, .ge-adj-popup').forEach(el => {
      if (el._escHandler) {
        document.removeEventListener('keydown', el._escHandler, true);
      }
      // v2 review HIGH-2/3: unregister any modalManager entry left over
      // from FX-popup / History-panel minimise so _state and _LABELS
      // don't grow unboundedly across editor opens.
      if (el._modalId) {
        try { modalManager.unregister(el._modalId); } catch {}
      }
      el.remove();
    });
  } catch {}
  // Belt-and-suspenders: scrub any minimized-dock chip + modalManager
  // entry whose id matches our ephemeral popups (in case the DOM node
  // was already removed when the user dragged the chip to trash).
  try {
    const dock = document.getElementById('minimized-dock');
    if (dock) {
      dock.querySelectorAll('[data-modal-id^="ge-fx-popup-"], [data-modal-id="ge-history-panel-min"]').forEach(c => {
        const mid = c.dataset.modalId;
        try { modalManager.unregister(mid); } catch {}
        c.remove();
      });
    }
  } catch {}
  if (state.container) {
    state.container.style.display = 'none';
    state.container.innerHTML = '';
  }
  state.layers = [];
  state.undoStack = [];
  state.redoStack = [];
  state.layerOffsets.clear();
  state.mainCanvas = null;
  state.mainCtx = null;
  state.maskCanvas = null;
  state.maskCtx = null;
  state.imageId = null;
  state.container = null;
  window.__galleryEditLive = false;
  return true;
}

export function isEditorOpen() {
  return state.editorOpen;
}

const galleryEditorModule = {
  openEditor,
  closeEditor,
  isEditorOpen,
  exportPNG,
  exportToGallery,
  downloadPNG,
};

export default galleryEditorModule;
