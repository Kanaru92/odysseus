/**
 * Copy Merged + Paste in Place — clipboard ops that operate on the whole
 * document rather than a single layer.
 *
 *   - Copy Merged (Shift+Ctrl+C): flattens every VISIBLE layer (honouring each
 *     layer's offset, opacity, group opacity, and — best-effort — blend mode)
 *     into an offscreen canvas at document size. If a selection is active
 *     (wand mask or a lasso / marquee polygon) the result is cropped to the
 *     selection bounds and masked to the selection shape; otherwise the whole
 *     document is copied. The result lands in a MODULE-level clipboard
 *     `{canvas, x, y}` where (x, y) is the document-space top-left of the
 *     copied region. A PNG is also written to the system clipboard
 *     best-effort, but the module clipboard is the source of truth.
 *
 *   - Paste in Place (Shift+Ctrl+V): drops the module clipboard onto a NEW
 *     "Pasted" layer at the SAME document position it was copied from (not
 *     centred), makes it active, and recomposites. If the module clipboard is
 *     empty it tries the system clipboard (best-effort) and pastes at 0,0.
 *
 * Kept separate from `state.internalClipboard` (used by the existing lasso /
 * wand Ctrl+C/X + the native paste handler) so neither path stomps the other:
 * a plain Ctrl+V still pastes whatever the selection tools copied, while Paste
 * in Place pulls from this dedicated merged clipboard.
 *
 * Pure-ish: the only mutable module state is `_clipboard`. Everything else is
 * derived from the passed-in `state` + `deps`.
 */
import { state } from './state.js';
import { isCustomBlend, blendInto } from './blend-modes.js';

// Module-level merged clipboard. `canvas` is at the size of the copied region;
// `x`/`y` are its document-space top-left so Paste in Place can restore it.
let _clipboard = null;

/** Show a toast without ever letting a missing toast element abort the op. */
function _toast(uiModule, msg) {
  try { if (uiModule && uiModule.showToast) uiModule.showToast(msg); } catch {}
}

/** Test-only accessor for the internal clipboard. */
export function _getClipboard() {
  return _clipboard;
}

/**
 * Composite every visible layer into `ctx` at document size, honouring
 * offset / opacity / group opacity / blend mode. Native canvas blend modes go
 * through `globalCompositeOperation`; custom (per-pixel) modes fall back to a
 * `blendInto` pass, and anything that throws falls back to plain source-over so
 * a single odd layer never aborts the whole copy.
 *
 * This is a self-contained re-implementation of the editor's visible-layer
 * compositor (it intentionally ignores adjustment sub-layers / layer masks /
 * fx, which live in galleryEditor internals we don't import here — those are a
 * best-effort omission noted to the user). Plain pixel layers — the common
 * case — composite exactly.
 *
 * @returns {boolean} true if any custom-blend layer was forced to source-over.
 */
function _renderVisibleTo(ctx, canvas) {
  const groups = {};
  for (const l of state.layers) if (l.isGroup) groups[l.id] = l;
  let fellBack = false;

  for (const layer of state.layers) {
    if (layer.isGroup) continue;
    if (!layer.visible) continue;
    if (!layer.canvas || !layer.canvas.width || !layer.canvas.height) continue;

    let grpMul = 1;
    if (layer.groupId && groups[layer.groupId]) {
      const g = groups[layer.groupId];
      if (!g.visible) continue;
      grpMul = (g.opacity == null ? 1 : g.opacity);
    }
    const opacity = (layer.opacity == null ? 1 : layer.opacity) * grpMul;
    const mode = layer.blendMode || 'source-over';
    const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };

    if (isCustomBlend(mode)) {
      // Per-pixel custom blend against the current (opaque-ish) backdrop. Read
      // the backdrop, blend the layer's pixels in at its offset, write back.
      // Bound all work to the layer's destination rect (its doc-space bbox
      // intersected with the document) instead of the whole document, so a
      // large canvas with several custom-blend layers doesn't pay a full-frame
      // sync readback per layer.
      try {
        const W = canvas.width, H = canvas.height;
        const rx = Math.max(0, Math.floor(off.x));
        const ry = Math.max(0, Math.floor(off.y));
        const rRight = Math.min(W, Math.ceil(off.x + layer.canvas.width));
        const rBottom = Math.min(H, Math.ceil(off.y + layer.canvas.height));
        const rw = rRight - rx, rh = rBottom - ry;
        if (rw <= 0 || rh <= 0) continue; // layer fully offscreen
        const back = ctx.getImageData(rx, ry, rw, rh);
        // Realise the source layer at rect-local position so indices line up.
        const tmp = document.createElement('canvas');
        tmp.width = rw; tmp.height = rh;
        tmp.getContext('2d').drawImage(layer.canvas, off.x - rx, off.y - ry);
        const src = tmp.getContext('2d').getImageData(0, 0, rw, rh);
        blendInto(mode, back.data, src.data, opacity);
        ctx.putImageData(back, rx, ry);
        continue;
      } catch {
        fellBack = true; // fall through to native source-over below
      }
    }

    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = isCustomBlend(mode) ? 'source-over' : mode;
    ctx.drawImage(layer.canvas, off.x, off.y);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  return fellBack;
}

/**
 * Resolve the active selection (if any) to a binary mask canvas at document
 * size + its tight bounds. Returns null when there's no selection.
 *
 * Sources, in priority order:
 *   1. `state.wandMask` — a canvas (white = selected) sized to its source
 *      layer's pixels. Composited at the source layer's offset into doc space.
 *   2. `state.lassoPoints` (3+ pts) — a polygon in document/canvas coords
 *      (also written by the marquee tool). Filled into a mask.
 *
 * @returns {{mask: HTMLCanvasElement, x: number, y: number, w: number, h: number} | null}
 */
function _resolveSelection(docW, docH) {
  // ── Wand mask ──
  if (state.wandMask && state.wandMask.width && state.wandMask.height) {
    const srcLayer = state.layers.find((l) => l.id === state.wandLayerId);
    const off = srcLayer ? (state.layerOffsets.get(srcLayer.id) || { x: 0, y: 0 }) : { x: 0, y: 0 };
    const mask = document.createElement('canvas');
    mask.width = docW; mask.height = docH;
    const mctx = mask.getContext('2d');
    mctx.drawImage(state.wandMask, off.x, off.y);
    const bounds = _maskBounds(mask);
    if (!bounds) return null;
    return { mask, ...bounds };
  }

  // ── Lasso / marquee polygon ──
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
    const bounds = _maskBounds(mask);
    if (!bounds) return null;
    return { mask, ...bounds };
  }

  return null;
}

/** Tight non-transparent bounds of a mask canvas, clamped to the canvas. */
function _maskBounds(maskCanvas) {
  const w = maskCanvas.width, h = maskCanvas.height;
  let data;
  try {
    data = maskCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  } catch { return { x: 0, y: 0, w, h }; }
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null; // empty selection
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Copy Merged — flatten visible layers (cropped + masked to any active
 * selection) into the module clipboard, and best-effort to the system one.
 *
 * @param {object} deps  needs { uiModule }
 */
export function copyMerged(deps = {}) {
  const { uiModule } = deps;
  const docW = state.imgWidth, docH = state.imgHeight;
  if (!docW || !docH) return false;
  if (!state.layers.some((l) => !l.isGroup && l.visible)) {
    _toast(uiModule, 'Nothing visible to copy');
    return false;
  }

  // Flatten all visible layers at document size.
  const merged = document.createElement('canvas');
  merged.width = docW; merged.height = docH;
  const mctx = merged.getContext('2d');
  const fellBack = _renderVisibleTo(mctx, merged);

  const sel = _resolveSelection(docW, docH);
  let outCanvas, outX, outY;
  if (sel) {
    // Mask the flattened result to the selection, then crop to its bounds.
    mctx.globalCompositeOperation = 'destination-in';
    mctx.drawImage(sel.mask, 0, 0);
    mctx.globalCompositeOperation = 'source-over';
    outCanvas = document.createElement('canvas');
    outCanvas.width = sel.w; outCanvas.height = sel.h;
    outCanvas.getContext('2d').drawImage(merged, sel.x, sel.y, sel.w, sel.h, 0, 0, sel.w, sel.h);
    outX = sel.x; outY = sel.y;
  } else {
    outCanvas = merged;
    outX = 0; outY = 0;
  }

  _clipboard = { canvas: outCanvas, x: outX, y: outY };

  // Best-effort PNG to the system clipboard. Internal clipboard is the source
  // of truth, so any failure here is non-fatal.
  try {
    if (outCanvas.toBlob && navigator.clipboard && navigator.clipboard.write && typeof ClipboardItem !== 'undefined') {
      outCanvas.toBlob((blob) => {
        if (!blob) return;
        try {
          navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).catch(() => {});
        } catch {}
      }, 'image/png');
    }
  } catch {}

  const note = sel ? 'selection' : 'all visible';
  _toast(uiModule, fellBack
    ? `Copied merged (${note}) — some blend modes approximated`
    : `Copied merged (${note})`);
  return true;
}

/**
 * Build a "Pasted" layer object matching the editor's `createLayer` shape so
 * it composites + renders in the panel identically to any other layer. We
 * construct it here (rather than via deps.addEmptyLayer) so we can name it,
 * draw into it, and position it precisely in one shot.
 */
function _makePastedLayer(name, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  return {
    id: 'layer-' + (state.nextLayerId++),
    name,
    canvas,
    ctx: canvas.getContext('2d'),
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    clipped: false,
    lockAlpha: false,
    locked: false,
    masks: [],
    activeMaskId: null,
    adjustments: {
      brightness: 1,
      contrast: 1,
      saturation: 1,
      hue: 0,
      levels: { inBlack: 0, inWhite: 255, gamma: 1.0, outBlack: 0, outWhite: 255 },
      colorBalance: {
        shadows:    { r: 0, g: 0, b: 0 },
        midtones:   { r: 0, g: 0, b: 0 },
        highlights: { r: 0, g: 0, b: 0 },
      },
    },
  };
}

/**
 * Drop a source canvas/image onto a new "Pasted" layer at document position
 * (docX, docY), make it active, and recomposite. The layer canvas is full
 * document size and the content is drawn at (docX, docY) so it lands exactly
 * where it was copied from.
 */
function _pasteSourceAt(source, srcW, srcH, docX, docY, deps) {
  const { composite, saveState, renderLayerPanel, uiModule } = deps;
  const docW = state.imgWidth || (docX + srcW);
  const docH = state.imgHeight || (docY + srcH);
  if (saveState) saveState('Paste in place');

  const layer = _makePastedLayer('Pasted', docW, docH);
  layer.ctx.drawImage(source, docX, docY);
  state.layerOffsets.set(layer.id, { x: 0, y: 0 }); // content baked at doc pos
  state.layers.push(layer); // top of the stack
  state.activeLayerId = layer.id;

  if (composite) composite();
  if (renderLayerPanel) renderLayerPanel();
  _toast(uiModule, 'Pasted in place');
}

/**
 * Paste in Place — recreate the merged clipboard on a new layer at the exact
 * document position it was copied from. Falls back to the system clipboard
 * (pasted at 0,0) when the module clipboard is empty.
 *
 * Always returns a Promise that resolves to the REAL outcome (true on a
 * successful paste, false on empty/error). The module-clipboard path resolves
 * synchronously-true; the system-clipboard fallback is async, so the promise
 * only settles once the image has actually decoded + been placed (or failed).
 * Callers that gate UI/toasts/undo on the result should await it.
 *
 * @param {object} deps  needs { composite, saveState, renderLayerPanel, uiModule }
 * @returns {Promise<boolean>}
 */
export function pasteInPlace(deps = {}) {
  const { uiModule } = deps;

  if (_clipboard && _clipboard.canvas) {
    _pasteSourceAt(_clipboard.canvas, _clipboard.canvas.width, _clipboard.canvas.height,
      _clipboard.x, _clipboard.y, deps);
    return Promise.resolve(true);
  }

  // Fall back to the system clipboard — best-effort, async. Paste at 0,0.
  // Resolve with the real result so the async success isn't reported as false.
  return new Promise((resolve) => {
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        navigator.clipboard.read().then(async (items) => {
          for (const item of items) {
            const type = (item.types || []).find((t) => t.startsWith('image/'));
            if (!type) continue;
            const blob = await item.getType(type);
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
              try { _pasteSourceAt(img, img.width, img.height, 0, 0, deps); resolve(true); }
              finally { URL.revokeObjectURL(url); }
            };
            img.onerror = () => { URL.revokeObjectURL(url); resolve(false); };
            img.src = url;
            return;
          }
          _toast(uiModule, 'Clipboard is empty');
          resolve(false);
        }).catch(() => { _toast(uiModule, 'Clipboard is empty'); resolve(false); });
      } else {
        _toast(uiModule, 'Clipboard is empty');
        resolve(false);
      }
    } catch {
      _toast(uiModule, 'Clipboard is empty');
      resolve(false);
    }
  });
}
