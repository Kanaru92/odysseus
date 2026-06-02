/**
 * Filters panel wiring — live, non-destructive preview of the pure filter lib
 * (editor/filters/filters.js) on the active layer. Snapshot the layer on open;
 * preview restores the snapshot then applies the filter; Apply bakes it (with a
 * pre-filter undo point); Reset / leaving the tool reverts.
 */
import { state } from './state.js';
import { applyFilter, FILTERS } from './filters/filters.js';

export function wireFilters({ activeLayer, saveState, composite }) {
  let orig = null;        // ImageData of the active layer before any preview
  let origLayerId = null;
  let applied = false;

  const $ = (id) => document.getElementById(id);
  const typeEl = () => $('ge-filter-type');
  const amtEl = () => $('ge-filter-amount');
  const opts = () => ({
    type: typeEl() ? typeEl().value : 'grayscale',
    amount: amtEl() ? parseInt(amtEl().value, 10) : 50,
  });
  // Extra data for filters that need more than an amount — Gradient Map maps
  // luminance from the editor BG (shadows) to FG (highlights).
  const extraOpts = (type) => (type === 'gradient-map'
    ? { shadow: state.bgColor || '#000000', highlight: state.color || '#ffffff' }
    : undefined);

  function snapshot() {
    const l = activeLayer();
    if (!l) { orig = null; origLayerId = null; return; }
    orig = l.ctx.getImageData(0, 0, l.canvas.width, l.canvas.height);
    origLayerId = l.id;
    applied = false;
  }
  function restoreOrig() {
    const l = activeLayer();
    if (orig && l && l.id === origLayerId) { l.ctx.putImageData(orig, 0, 0); composite(); }
  }
  function preview() {
    let l = activeLayer();
    if (!orig || !l || l.id !== origLayerId) snapshot();
    l = activeLayer();
    if (!orig || !l) return;
    l.ctx.putImageData(orig, 0, 0); // start from the original each time
    const { type, amount } = opts();
    const img = l.ctx.getImageData(0, 0, l.canvas.width, l.canvas.height);
    applyFilter(img, type, amount, extraOpts(type));
    l.ctx.putImageData(img, 0, 0);
    applied = false;
    composite();
  }
  function apply() {
    const l = activeLayer();
    if (!orig || !l || l.id !== origLayerId) return;
    l.ctx.putImageData(orig, 0, 0); // restore so the undo point = pre-filter
    saveState('Filter');
    const { type, amount } = opts();
    const img = l.ctx.getImageData(0, 0, l.canvas.width, l.canvas.height);
    applyFilter(img, type, amount, extraOpts(type));
    l.ctx.putImageData(img, 0, 0);
    applied = true;
    orig = null; // committed; next change re-snapshots
    composite();
  }

  function populate() {
    const s = typeEl();
    if (!s || s._filled) return;
    s.innerHTML = FILTERS.map((f) => `<option value="${f.id}">${f.name}</option>`).join('');
    s._filled = true;
  }
  function syncAmountVisibility() {
    const s = typeEl(); const row = $('ge-filter-amount-row');
    if (!s || !row) return;
    const f = FILTERS.find((x) => x.id === s.value);
    row.style.display = f && f.amount ? '' : 'none';
  }

  typeEl()?.addEventListener('change', () => { syncAmountVisibility(); preview(); });
  amtEl()?.addEventListener('input', () => { const l = $('ge-filter-amount-label'); if (l) l.textContent = amtEl().value; preview(); });
  $('ge-filter-apply')?.addEventListener('click', apply);
  $('ge-filter-reset')?.addEventListener('click', () => { restoreOrig(); orig = null; });

  // Show/hide are driven by tool selection in galleryEditor via window events
  // (decoupled — no init-order dependency). Show snapshots; hide reverts an
  // un-applied preview.
  function onShow() { populate(); syncAmountVisibility(); snapshot(); }
  function onHide() { if (!applied) restoreOrig(); orig = null; applied = false; }
  window.addEventListener('ge:filter-show', onShow);
  window.addEventListener('ge:filter-hide', onHide);
}
