/**
 * Tabbed documents — work between multiple open files (PS document tabs). The
 * editor holds ONE document in `state`; this keeps an array of document SLOTS
 * (each a snapshot of the per-doc state fields, holding the LIVE layer canvases
 * so switching is instant — no serialize/decode) and swaps them in/out on tab
 * click. `nextLayerId` stays GLOBAL across docs so layer ids never collide.
 *
 * @param {{ composite, renderLayerPanel, createLayer, fitZoom }} deps
 */
import { state } from './state.js';

// Per-document state fields that move with the active tab. nextLayerId is
// intentionally excluded (global monotonic id counter → no cross-doc collisions).
const DOC_FIELDS = ['layers', 'layerOffsets', 'imgWidth', 'imgHeight', 'activeLayerId', 'undoStack', 'redoStack', '_histTiles'];

export function wireDocTabs({ composite, renderLayerPanel, createLayer, fitZoom, promptNewSize }) {
  if (document.querySelector('.ge-doc-tabs')) return;
  // Mount ABOVE the editor body (which is a horizontal flex row of
  // toolbar | canvas | panel). Inserting inside that row made the tab bar a tall
  // vertical column; placing it before the body in the editor's column stack
  // makes it the full-width horizontal bar it should be.
  const body = document.querySelector('.ge-editor-body');
  if (!body || !body.parentNode) return;

  const bar = document.createElement('div');
  bar.className = 'ge-doc-tabs';
  body.parentNode.insertBefore(bar, body);

  let seq = 1;
  const docs = [];
  let active = 0;

  function captureInto(slot) {
    for (const k of DOC_FIELDS) slot[k] = state[k];
  }
  function applyFrom(slot) {
    for (const k of DOC_FIELDS) state[k] = slot[k];
    if (!state._histTiles) state._histTiles = new Map();
    if (state.mainCanvas) { state.mainCanvas.width = slot.imgWidth; state.mainCanvas.height = slot.imgHeight; }
    // Fresh mask plumbing sized to this doc (no active mask sub-layer yet).
    state.maskCanvas = document.createElement('canvas');
    state.maskCanvas.width = slot.imgWidth; state.maskCanvas.height = slot.imgHeight;
    state.maskCtx = state.maskCanvas.getContext('2d');
    // Drop transient overlays/selection from the other doc.
    state.wandMask = null; state.wandLayerId = null;
    state.lassoPoints = []; state.lassoActive = false;
    state.cropRect = null; state.transformActive = false; state.pcropActive = false;
    try { composite(); } catch {}
    try { renderLayerPanel(); } catch {}
    try { fitZoom(); } catch {}
  }

  function switchTo(i) {
    if (i === active || i < 0 || i >= docs.length) return;
    captureInto(docs[active]);
    active = i;
    applyFrom(docs[active]);
    renderTabs();
  }
  function _makeDoc(w, h) {
    captureInto(docs[active]);
    const bg = createLayer('Background', w, h);
    bg.ctx.fillStyle = '#ffffff'; bg.ctx.fillRect(0, 0, w, h);
    const offsets = new Map(); offsets.set(bg.id, { x: 0, y: 0 });
    docs.push({ id: 'doc-' + (seq++), name: 'Untitled ' + (docs.length + 1),
      layers: [bg], layerOffsets: offsets, imgWidth: w, imgHeight: h,
      activeLayerId: bg.id, undoStack: [], redoStack: [], _histTiles: new Map() });
    active = docs.length - 1;
    applyFrom(docs[active]);
    renderTabs();
  }
  // New document: ask for a size first (presets + aspect ratio) via the
  // shared new-canvas dialog, then create at the chosen dimensions. Falls
  // back to the current doc's size if no size-prompt dep was provided or the
  // user cancels with no prior size.
  function newDoc() {
    if (promptNewSize) {
      const p = promptNewSize();
      if (p && p.then) { p.then(size => { if (size && size.w > 0 && size.h > 0) _makeDoc(size.w, size.h); }).catch(() => {}); return; }
    }
    _makeDoc(state.imgWidth || 1024, state.imgHeight || 1024);
  }
  function closeDoc(i) {
    if (docs.length <= 1) return; // keep at least one document open
    const wasActive = (i === active);
    docs.splice(i, 1);
    if (active > i) active--;
    if (wasActive) { active = Math.min(active, docs.length - 1); applyFrom(docs[active]); }
    renderTabs();
  }

  function renderTabs() {
    bar.innerHTML = '';
    docs.forEach((d, i) => {
      const tab = document.createElement('div');
      tab.className = 'ge-doc-tab' + (i === active ? ' active' : '');
      tab.dataset.docIndex = String(i);
      const z = Math.round((state.zoom || 1) * 100);
      const label = document.createElement('span');
      label.className = 'ge-doc-tab-label';
      label.textContent = d.name + (i === active ? ` @ ${z}%` : '');
      label.addEventListener('click', () => switchTo(i));
      tab.appendChild(label);
      if (docs.length > 1) {
        const x = document.createElement('button');
        x.className = 'ge-doc-tab-x'; x.textContent = '×'; x.title = 'Close';
        x.addEventListener('click', (e) => { e.stopPropagation(); closeDoc(i); });
        tab.appendChild(x);
      }
      bar.appendChild(tab);
    });
    const plus = document.createElement('button');
    plus.className = 'ge-doc-tab-new'; plus.textContent = '+'; plus.title = 'New document';
    plus.addEventListener('click', newDoc);
    bar.appendChild(plus);
  }

  // Seed slot 0 from the document the editor opened with.
  const first = { id: 'doc-' + (seq++), name: state.draftName || 'Untitled 1' };
  captureInto(first);
  docs.push(first);
  renderTabs();
  // Keep the active tab's zoom% label fresh as the view changes.
  window.addEventListener('ge:composited', () => {
    const lbl = bar.querySelector('.ge-doc-tab.active .ge-doc-tab-label');
    if (lbl && docs[active]) lbl.textContent = docs[active].name + ` @ ${Math.round((state.zoom || 1) * 100)}%`;
  });
}
