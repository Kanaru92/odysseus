/**
 * Smart Objects — non-destructive, re-editable layers. A smart layer keeps a
 * PRISTINE source canvas plus the transform that produced its current rendered
 * pixels (`layer.smartXf`). Transforms re-derive `layer.canvas` from the source
 * each time instead of compounding resamples, so repeated scaling never loses
 * quality. The compositor still reads `layer.canvas`, so nothing downstream
 * changes — a smart layer is just a normal layer with a `sourceCanvas` sidecar.
 *
 *   convertToSmart  — snapshot the layer's pixels as the pristine source
 *   rasterize       — drop the source, becoming a plain layer
 *   replaceContents — swap the source for a new image, KEEPING the transform
 *   rebakeSmart     — re-render layer.canvas from source × smartXf (shared core)
 *
 * `smartXf` = { w, h, rot, flipH, flipV } — the same fields the Transform tool
 * tracks, so the Transform tool can read/write it for re-editable transforms.
 *
 * @param {{ activeLayer:()=>object, saveState:(l?:string)=>void, composite:()=>void,
 *           renderLayerPanel?:()=>void, uiModule?:object }} deps
 */
import { state } from './state.js';

function cloneCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

export function createSmartObject({ activeLayer, saveState, composite, renderLayerPanel, uiModule }) {
  // Render layer.sourceCanvas through layer.smartXf into layer.canvas, keeping
  // the layer's current visual centre fixed. Mirrors transform-session's
  // reapplyTransform math so on-canvas Transform and programmatic rebake agree.
  function rebakeSmart(layer) {
    if (!layer || !layer.isSmart || !layer.sourceCanvas || !layer.smartXf) return;
    const src = layer.sourceCanvas;
    const xf = layer.smartXf;
    const w = Math.max(1, xf.w), h = Math.max(1, xf.h);
    const rotRad = ((xf.rot || 0) * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rotRad)), sin = Math.abs(Math.sin(rotRad));
    const finalW = Math.max(1, Math.round(w * cos + h * sin));
    const finalH = Math.max(1, Math.round(w * sin + h * cos));
    const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
    const cx = off.x + layer.canvas.width / 2;   // current visual centre
    const cy = off.y + layer.canvas.height / 2;
    const tmp = document.createElement('canvas');
    tmp.width = finalW; tmp.height = finalH;
    const t = tmp.getContext('2d');
    t.imageSmoothingEnabled = true; t.imageSmoothingQuality = 'high';
    t.save();
    t.translate(finalW / 2, finalH / 2);
    if (xf.rot) t.rotate(rotRad);
    t.scale(xf.flipH ? -1 : 1, xf.flipV ? -1 : 1);
    t.drawImage(src, -w / 2, -h / 2, w, h);
    t.restore();
    layer.canvas.width = finalW; layer.canvas.height = finalH;
    layer.ctx = layer.canvas.getContext('2d');
    layer.ctx.clearRect(0, 0, finalW, finalH);
    layer.ctx.drawImage(tmp, 0, 0);
    state.layerOffsets.set(layer.id, { x: Math.round(cx - finalW / 2), y: Math.round(cy - finalH / 2) });
  }

  function convertToSmart() {
    const layer = activeLayer();
    if (!layer) { uiModule?.showToast?.('Select a layer'); return; }
    if (layer.isGroup) { uiModule?.showToast?.('Groups can’t be Smart Objects'); return; }
    if (layer.isSmart) { uiModule?.showToast?.('Already a Smart Object'); return; }
    saveState('Convert to Smart Object');
    layer.sourceCanvas = cloneCanvas(layer.canvas);
    layer.sourceW = layer.sourceCanvas.width;
    layer.sourceH = layer.sourceCanvas.height;
    layer.smartXf = { w: layer.canvas.width, h: layer.canvas.height, rot: 0, flipH: false, flipV: false };
    layer.isSmart = true;
    renderLayerPanel?.();
    composite();
    uiModule?.showToast?.('Converted to Smart Object');
  }

  function rasterize() {
    const layer = activeLayer();
    if (!layer || !layer.isSmart) { uiModule?.showToast?.('Not a Smart Object'); return; }
    saveState('Rasterize Smart Object');
    delete layer.sourceCanvas;
    layer.sourceW = layer.sourceH = null;
    layer.smartXf = null; layer.isSmart = false; layer.linked = null;
    renderLayerPanel?.();
    uiModule?.showToast?.('Rasterized');
  }

  function replaceContents() {
    const layer = activeLayer();
    if (!layer || !layer.isSmart) { uiModule?.showToast?.('Convert to a Smart Object first'); return; }
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          saveState('Replace Contents');
          const sc = document.createElement('canvas');
          sc.width = img.naturalWidth || img.width; sc.height = img.naturalHeight || img.height;
          sc.getContext('2d').drawImage(img, 0, 0);
          layer.sourceCanvas = sc; layer.sourceW = sc.width; layer.sourceH = sc.height;
          rebakeSmart(layer);
          composite(); renderLayerPanel?.();
          uiModule?.showToast?.('Contents replaced');
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
    document.body.appendChild(input);
    input.click();
    setTimeout(() => { try { input.remove(); } catch {} }, 0);
  }

  // ── Linked documents ──────────────────────────────────────────────────
  // A linked smart object's source is an external image URL (e.g. a gallery
  // asset). The link is stored so it survives save/reload; "Update Linked"
  // re-fetches the latest pixels (pull model — there's no push channel) and
  // re-derives through the existing transform, so placement is preserved.
  function _loadInto(layer, url, label, cacheBust) {
    const img = new Image();
    try { img.crossOrigin = 'anonymous'; } catch {}
    img.onload = () => {
      saveState(label);
      if (!layer.isSmart) {
        layer.isSmart = true;
        layer.smartXf = { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height, rot: 0, flipH: false, flipV: false };
      }
      const sc = document.createElement('canvas');
      sc.width = img.naturalWidth || img.width; sc.height = img.naturalHeight || img.height;
      sc.getContext('2d').drawImage(img, 0, 0);
      layer.sourceCanvas = sc; layer.sourceW = sc.width; layer.sourceH = sc.height;
      if (!layer.smartXf) layer.smartXf = { w: sc.width, h: sc.height, rot: 0, flipH: false, flipV: false };
      layer.linked = { kind: 'url', url };
      rebakeSmart(layer);
      composite(); renderLayerPanel?.();
      uiModule?.showToast?.(label === 'Update Linked' ? 'Linked contents updated' : 'Linked image placed');
    };
    img.onerror = () => uiModule?.showToast?.('Could not load linked image');
    let src = url;
    if (cacheBust) src += (url.includes('?') ? '&' : '?') + '_lb=' + (state._linkBust = (state._linkBust || 0) + 1);
    img.src = src;
  }

  // Link the active layer to an external image URL (becomes a Smart Object).
  function linkToUrl(url) {
    const layer = activeLayer();
    if (!layer) { uiModule?.showToast?.('Select a layer'); return; }
    if (layer.isGroup) { uiModule?.showToast?.('Groups can’t be linked'); return; }
    if (!url) return;
    _loadInto(layer, url, 'Place Linked Image', false);
  }

  // Re-fetch the linked source and re-derive (cache-busted so a changed asset
  // actually reloads).
  function updateLinked() {
    const layer = activeLayer();
    if (!layer || !layer.linked || !layer.linked.url) { uiModule?.showToast?.('No linked source'); return; }
    _loadInto(layer, layer.linked.url, 'Update Linked', true);
  }

  return { convertToSmart, rasterize, replaceContents, rebakeSmart, linkToUrl, updateLinked };
}
