/**
 * Shared AI-tool runner. Used by Sharpen / Harmonize / Upscale / Style /
 * Bg-Remove / etc. — every tool that flattens the document, POSTs the
 * PNG to a server-side image endpoint, and drops the result back in
 * as a new layer.
 *
 * Handles all the orchestration around the request:
 *
 *  - Button busy state: swap label for "<verbing>…" + whirlpool
 *    spinner, lock width so the button doesn't visually jump.
 *  - Endpoint+model selection from the tool's own picker (or the
 *    global fallback) so the backend knows which model to invoke.
 *  - Response handling: decode the returned PNG, push it as a new
 *    layer, save state, composite, refresh the layer panel.
 *  - Error reporting: surface failures via toast. Detects "needs
 *    img2img server" and "package not installed" failure modes and
 *    surfaces an action-toast that opens Cookbook to fix.
 *
 * @param {{
 *   flatten:                    () => HTMLCanvasElement,
 *   saveState:                  (label?: string) => void,
 *   createLayer:                (name: string, w: number, h: number) => object,
 *   composite:                  () => void,
 *   renderLayerPanel:           () => void,
 *   deriveBusyLabel:            (layerName: string) => string,
 *   getSelectedAIEndpoint:      (type: string | null) => { endpoint?: string, model?: string },
 *   openCookbookForDependency:  (pkg: string) => void,
 *   openCookbookForImg2img:     () => void,
 *   spinnerModule:              object,
 *   uiModule:                   object | null,
 * }} deps
 *
 * @returns {(endpoint: string, extraPayload: object, layerName: string, btn: HTMLButtonElement, opts?: { busyLabel?: string }) => Promise<void>}
 */
import { state } from './state.js';

const KNOWN_DEPS = ['realesrgan', 'rembg'];

export function createApplyImageTool({
  flatten, saveState, createLayer, composite, renderLayerPanel,
  deriveBusyLabel, getSelectedAIEndpoint,
  openCookbookForDependency, openCookbookForImg2img,
  spinnerModule, uiModule,
}) {
  return async function applyImageTool(endpoint, extraPayload, layerName, btn, opts) {
    const origHTML = btn.innerHTML;
    const origWidth = btn.offsetWidth;  // lock width so the button doesn't jump
    btn.disabled = true;
    btn.classList.add('ge-btn-processing');
    btn.style.minWidth = origWidth + 'px';
    // Swap label for a "<verbing>…" text + whirlpool while the
    // request runs. Falls back to deriving a busy label from
    // layerName when the caller didn't supply one.
    const busyLabel = (opts && opts.busyLabel) || deriveBusyLabel(layerName);
    btn.innerHTML = '';
    let btnSpinner = null;
    try {
      btnSpinner = spinnerModule.create('', 'clean', 'whirlpool');
      const sp = btnSpinner.createElement();
      btn.appendChild(sp);
      const txt = document.createElement('span');
      txt.className = 'ge-btn-busy-label';
      txt.textContent = busyLabel;
      btn.appendChild(txt);
      btnSpinner.start();
    } catch { btn.textContent = busyLabel; }
    // Tool-specific model picker — pulled from the per-tool select
    // (harmonize/style) if available, otherwise the global
    // fallback. Derived from the endpoint URL.
    if (!extraPayload._endpoint) {
      const m = /\/api\/image\/([\w-]+)/.exec(endpoint || '');
      const type = m ? m[1].replace('upscale-ai', 'upscale').replace('remove-bg', 'rembg') : null;
      const sel = getSelectedAIEndpoint(type);
      if (sel.endpoint) extraPayload._endpoint = sel.endpoint;
      if (sel.model && !extraPayload._model) extraPayload._model = sel.model;
    }
    // Track the request so closeEditor can abort it — otherwise the server keeps
    // generating a result that will never be shown when the user closes mid-run.
    const ac = new AbortController();
    (state.aiInflight || (state.aiInflight = new Set())).add(ac);
    try {
      const flatCanvas = flatten();
      const imageB64 = flatCanvas.toDataURL('image/png').split(',')[1];
      const body = { image: imageB64, ...extraPayload };
      const res = await fetch(endpoint, {
        method: 'POST', credentials: 'same-origin', signal: ac.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let err = res.statusText;
        try { const e = await res.json(); err = e.detail || e.error || err; } catch {}
        throw new Error(err);
      }
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (!data.image) throw new Error('No image returned');
      // Await the decode before the finally cleanup runs, so the button/spinner
      // aren't re-enabled (and the "complete" toast doesn't fire) while the
      // result is still decoding — which would let a second click start a
      // duplicate request mid-decode.
      const img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('Failed to load result'));
        im.src = 'data:image/png;base64,' + data.image;
      });
      if (!state.editorOpen) return; // user closed mid-decode (v2 review HIGH-4)
      saveState();
      // Size the layer to the actual returned image rather than hardcoding the
      // document size — a result whose dimensions differ (e.g. an upscaled
      // return) would otherwise be cropped or only partially fill the layer.
      const layerW = img.naturalWidth || img.width || state.imgWidth;
      const layerH = img.naturalHeight || img.height || state.imgHeight;
      const layer = createLayer(layerName, layerW, layerH);
      layer.ctx.drawImage(img, 0, 0);
      state.layers.push(layer);
      state.activeLayerId = layer.id;
      composite();
      renderLayerPanel();
      if (uiModule) uiModule.showToast(layerName + ' complete', 4500);
    } catch (e) {
      if (e && e.name === 'AbortError') return; // editor closed mid-request — silent cancel
      // Detect known failure modes and surface an action-toast.
      const msg = (e?.message || '').toLowerCase();
      const needsImg2Img = (
        msg.includes('img2img') ||
        msg.includes('diffusion server') ||
        msg.includes("doesn't expose")
      );
      let depMatch = null;
      for (const pkg of KNOWN_DEPS) {
        if (msg.includes(`${pkg} not installed`) || msg.includes(`no module named '${pkg}'`)) {
          depMatch = pkg; break;
        }
      }
      if (uiModule) {
        if (depMatch && uiModule.showToast.length >= 2) {
          uiModule.showToast(layerName + ' failed: ' + depMatch + ' is not installed on the server.', {
            duration: 9000,
            action: `Install ${depMatch}`,
            onAction: () => openCookbookForDependency(depMatch),
          });
        } else if (needsImg2Img && uiModule.showToast.length >= 2) {
          uiModule.showToast(layerName + ' failed: ' + e.message, {
            duration: 9000,
            action: 'Open Cookbook',
            onAction: () => openCookbookForImg2img(),
          });
        } else {
          uiModule.showToast(layerName + ' failed: ' + e.message, 6000);
        }
      }
    } finally {
      try { if (state.aiInflight) state.aiInflight.delete(ac); } catch {}
      btn.disabled = false;
      btn.classList.remove('ge-btn-processing');
      try { btnSpinner?.destroy(); } catch {}
      btn.innerHTML = origHTML;
      btn.style.minWidth = '';
    }
  };
}
