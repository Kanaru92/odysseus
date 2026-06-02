/**
 * MorphBlend — FILM frame-interpolation morph between two layer states.
 *
 * Ported from the user's own morph plugin (their code). Generates N in-between
 * frames between image A (start) and image B (end) so a painter gets a
 * natural transition — e.g. reposition a head/limb on a new layer, then
 * morph the old pose into the new one to recover the intermediate poses.
 *
 * Two source modes:
 *   - 'two-layers'      A = layer A, B = layer B (explicit pickers)
 *   - 'active-vs-below' A = flattened composite below the active layer,
 *                       B = the active layer alone
 *
 * Async session flow (mirrors ai-inpaint.js): capture A+B → POST
 * /api/image/morph → poll status → scrub preview frames → insert the
 * chosen frame as a new layer. The heavy lifting runs in the optional
 * scripts/morph_server.py (FILM); a 503 means "start the server".
 *
 * @param {{
 *   createLayer:      (name: string, w: number, h: number) => object,
 *   composite:        () => void,
 *   renderLayerPanel: () => void,
 *   saveState:        (label?: string) => void,
 *   spinnerModule:    object,
 *   uiModule:         object | null,
 * }} deps
 */
import { state } from './state.js';

export function wireMorphTool({ createLayer, composite, renderLayerPanel, saveState, spinnerModule, uiModule }) {
  const $ = (id) => document.getElementById(id);
  const toast = (msg, ms) => { if (uiModule) uiModule.showToast(msg, ms || 4000); };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ── Layer capture ──────────────────────────────────────────────────
  // Both endpoints are rendered at full document size so FILM sees a
  // consistent grid; transparent regions flatten onto black (RGB), same
  // as the original plugin.
  function captureLayerFull(layerId) {
    const layer = state.layers.find((l) => l.id === layerId);
    if (!layer) return null;
    const c = document.createElement('canvas');
    c.width = state.imgWidth; c.height = state.imgHeight;
    const ctx = c.getContext('2d');
    const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
    ctx.drawImage(layer.canvas, off.x, off.y);
    return c.toDataURL('image/png').split(',')[1];
  }

  function captureCompositeBelow(activeId) {
    const idx = state.layers.findIndex((l) => l.id === activeId);
    if (idx <= 0) return null; // nothing beneath the active layer
    const c = document.createElement('canvas');
    c.width = state.imgWidth; c.height = state.imgHeight;
    const ctx = c.getContext('2d');
    for (let i = 0; i < idx; i++) {
      const layer = state.layers[i];
      if (!layer.visible) continue;
      ctx.globalAlpha = layer.opacity;
      const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
      ctx.drawImage(layer.canvas, off.x, off.y);
    }
    ctx.globalAlpha = 1;
    return c.toDataURL('image/png').split(',')[1];
  }

  // ── Layer pickers (two-layer mode) ─────────────────────────────────
  // Listed top-first to match the layer panel; default A = layer just
  // below the top (start), B = top layer (end), per the plugin default.
  function populatePickers() {
    const selA = $('ge-morph-layer-a');
    const selB = $('ge-morph-layer-b');
    if (!selA || !selB) return;
    const prevA = selA.value;
    const prevB = selB.value;
    const opts = state.layers
      .map((l) => `<option value="${l.id}">${esc(l.name)}</option>`)
      .reverse()
      .join('');
    selA.innerHTML = opts;
    selB.innerHTML = opts;
    const ids = state.layers.map((l) => String(l.id));
    const n = state.layers.length;
    selA.value = ids.includes(prevA) ? prevA : (n >= 2 ? String(state.layers[n - 2].id) : (n ? String(state.layers[0].id) : ''));
    selB.value = ids.includes(prevB) ? prevB : (n ? String(state.layers[n - 1].id) : '');
  }

  function setMode(mode) {
    state.morphMode = mode;
    document.querySelectorAll('.ge-morph-mode').forEach((b) => {
      b.classList.toggle('active', b.dataset.morphMode === mode);
    });
    const layersBox = $('ge-morph-layers');
    if (layersBox) layersBox.style.display = mode === 'two-layers' ? '' : 'none';
  }

  // ── Generate ────────────────────────────────────────────────────────
  let polling = false;
  let previewLayerId = null;    // the live "Morph" preview layer the scrubber drives
  const frameCache = new Map(); // idx → HTMLImageElement (preview JPEGs) for snappy scrub

  function setStatus(text) { const el = $('ge-morph-status'); if (el) el.textContent = text || ''; }
  function setProgress(frac) {
    const bar = $('ge-morph-progress');
    const fill = $('ge-morph-progress-fill');
    if (bar) bar.style.display = frac == null ? 'none' : '';
    if (fill && frac != null) fill.style.width = Math.round(frac * 100) + '%';
  }

  async function generate() {
    const btn = $('ge-morph-generate');
    if (!state.layers.length || !state.imgWidth) { toast('Open an image first'); return; }

    let imageA, imageB;
    if (state.morphMode === 'two-layers') {
      const idA = parseInt($('ge-morph-layer-a').value);
      const idB = parseInt($('ge-morph-layer-b').value);
      if (Number.isNaN(idA) || Number.isNaN(idB)) { toast('Pick both layers'); return; }
      if (idA === idB) { toast('Pick two different layers'); return; }
      imageA = captureLayerFull(idA);
      imageB = captureLayerFull(idB);
    } else {
      const active = state.activeLayerId;
      imageA = captureCompositeBelow(active);
      imageB = captureLayerFull(active);
      if (!imageA) { toast('Active vs below needs at least one layer beneath the active layer'); return; }
    }
    if (!imageA || !imageB) { toast('Could not capture layers'); return; }

    const numFrames = parseInt($('ge-morph-frames')?.value || '10');
    const maxSize = parseInt($('ge-morph-maxsize')?.value || '1024');

    if (btn) btn.disabled = true;
    setStatus('Sending to morph server…');
    setProgress(0.02);
    const result = $('ge-morph-result');
    if (result) result.style.display = 'none';
    // Fresh run — drop any prior preview layer + cached frames.
    frameCache.clear();
    removePreviewLayer();

    try {
      const res = await fetch('/api/image/morph', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_a: imageA, image_b: imageB, num_frames: numFrames, max_size: maxSize }),
      });
      if (!res.ok) {
        let detail = res.statusText;
        try { const e = await res.json(); detail = e.detail || e.error || detail; } catch {}
        throw new Error(detail);
      }
      const { session_id } = await res.json();
      if (!session_id) throw new Error('No session returned');
      const frameCount = await poll(session_id);
      state.morphSession = { sid: session_id, frameCount };
      showResult(session_id, frameCount);
      setStatus(`Done — ${frameCount} frames`);
    } catch (e) {
      setProgress(null);
      const msg = String(e && e.message ? e.message : e);
      // Keep the reason visible in the panel (a toast is easy to miss), and make
      // the common "server not running" case actionable.
      const friendly = /not running|503|Failed to fetch|NetworkError/i.test(msg)
        ? 'Morph server not running — start it: python scripts/morph_server.py (needs the FILM model + a GPU).'
        : 'Morph failed: ' + msg;
      setStatus(friendly);
      toast(friendly, 8000);
    } finally {
      if (btn) btn.disabled = false;
      polling = false;
    }
  }

  function poll(sid) {
    polling = true;
    return new Promise((resolve, reject) => {
      const tick = async () => {
        if (!polling || !state.editorOpen) { reject(new Error('cancelled')); return; }
        try {
          const r = await fetch(`/api/image/morph/status/${sid}`, { credentials: 'same-origin' });
          if (!r.ok) {
            let detail = r.statusText;
            try { const e = await r.json(); detail = e.detail || e.error || detail; } catch {}
            throw new Error(detail);
          }
          const d = await r.json();
          if (d.status === 'complete') { setProgress(1); resolve(d.frame_count); return; }
          if (d.status === 'error') { reject(new Error(d.error || 'processing failed')); return; }
          setProgress(0.05 + (d.progress || 0) * 0.9);
          setStatus(`Generating frames… ${Math.round((d.progress || 0) * 100)}%`);
          setTimeout(tick, 500);
        } catch (e) { reject(e); }
      };
      setTimeout(tick, 400);
    });
  }

  // ── Result: live on-canvas scrub + commit (opacity-slider feel) ──
  // The scrubber drives a real "Morph" preview layer that updates live on the
  // canvas as you drag — like dragging Opacity. "Keep this frame" upgrades it
  // to full-res and makes it permanent. Undo restores the pre-morph state
  // (saveState fires once, the first time the preview layer is created).
  function ensurePreviewLayer() {
    let layer = previewLayerId != null ? state.layers.find((l) => l.id === previewLayerId) : null;
    if (!layer) {
      saveState('Morph');                // undo point = pre-morph state
      layer = createLayer('Morph (preview)', state.imgWidth, state.imgHeight);
      state.layers.push(layer);
      state.activeLayerId = layer.id;
      previewLayerId = layer.id;
      renderLayerPanel();
    }
    return layer;
  }

  function removePreviewLayer() {
    if (previewLayerId == null) return;
    const i = state.layers.findIndex((l) => l.id === previewLayerId);
    if (i >= 0) {
      const removed = state.layers.splice(i, 1)[0];
      state.layerOffsets.delete(removed.id);
      if (state.activeLayerId === removed.id) {
        state.activeLayerId = state.layers.length ? state.layers[state.layers.length - 1].id : null;
      }
      renderLayerPanel();
      composite();
    }
    previewLayerId = null;
  }

  function loadFrameImage(idx, full) {
    const s = state.morphSession;
    const key = (full ? 'f' : 'p') + idx;
    if (!full && frameCache.has(key)) return Promise.resolve(frameCache.get(key));
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { if (!full) frameCache.set(key, img); resolve(img); };
      img.onerror = reject;
      img.src = `/api/image/morph/${full ? 'frame' : 'preview'}/${s.sid}/${idx}`;
    });
  }

  async function drawFrameToPreview(idx, full) {
    const s = state.morphSession;
    if (!s) return;
    let img;
    try { img = await loadFrameImage(idx, full); } catch { return; }
    // Bail if the editor closed, the session changed, or (for the light
    // preview) the user already scrubbed onward while this frame loaded.
    if (!state.editorOpen || !state.morphSession || state.morphSession.sid !== s.sid) return;
    if (!full && parseInt($('ge-morph-scrubber')?.value) !== idx) return;
    const layer = ensurePreviewLayer();
    layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    layer.ctx.imageSmoothingEnabled = true;
    layer.ctx.imageSmoothingQuality = 'high';
    layer.ctx.drawImage(img, 0, 0, state.imgWidth, state.imgHeight);
    composite();
  }

  function showResult(sid, frameCount) {
    const result = $('ge-morph-result');
    const scrub = $('ge-morph-scrubber');
    if (!result || !scrub) return;
    result.style.display = '';
    scrub.min = 0;
    scrub.max = Math.max(0, frameCount - 1);
    const mid = Math.floor((frameCount - 1) / 2); // mid frame = most "in-between"
    scrub.value = mid;
    $('ge-morph-frame-total').textContent = String(frameCount - 1);
    scrubTo(mid);
  }

  function scrubTo(idx) {
    const s = state.morphSession;
    if (!s) return;
    const img = $('ge-morph-preview');
    if (img) img.src = `/api/image/morph/preview/${s.sid}/${idx}`;
    const lbl = $('ge-morph-frame-label');
    if (lbl) lbl.textContent = String(idx);
    drawFrameToPreview(idx, false); // live on-canvas, light JPEG
  }

  async function commitFrame(idx) {
    const s = state.morphSession;
    if (!s) return;
    await drawFrameToPreview(idx, true); // upgrade the preview layer to full-res PNG
    const layer = previewLayerId != null ? state.layers.find((l) => l.id === previewLayerId) : null;
    if (layer) layer.name = `Morph [${idx}/${s.frameCount - 1}]`;
    previewLayerId = null; // detach — it is now a permanent layer
    renderLayerPanel();
    toast(`Kept morph frame ${idx}`);
  }

  // ── Wire DOM ──────────────────────────────────────────────────────────
  document.querySelectorAll('.ge-morph-mode').forEach((b) => {
    b.addEventListener('click', () => setMode(b.dataset.morphMode));
  });
  const framesSlider = $('ge-morph-frames');
  framesSlider?.addEventListener('input', () => { $('ge-morph-frames-label').textContent = framesSlider.value; });
  const maxSlider = $('ge-morph-maxsize');
  maxSlider?.addEventListener('input', () => { $('ge-morph-maxsize-label').textContent = maxSlider.value; });
  $('ge-morph-generate')?.addEventListener('click', generate);
  $('ge-morph-scrubber')?.addEventListener('input', (e) => scrubTo(parseInt(e.target.value)));
  $('ge-morph-insert')?.addEventListener('click', () => commitFrame(parseInt($('ge-morph-scrubber').value)));

  // Repopulate pickers whenever the morph panel is shown (fired by the
  // tool-select handler in galleryEditor.js) and on first wire.
  window.addEventListener('ge:morph-show', populatePickers);
  setMode(state.morphMode || 'two-layers');
  populatePickers();
}
