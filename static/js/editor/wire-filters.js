/**
 * Filters panel wiring — live, non-destructive preview of the pure filter lib
 * (editor/filters/filters.js) on the active layer. Snapshot the layer on open;
 * preview restores the snapshot then applies the filter; Apply bakes it (with a
 * pre-filter undo point); Reset / leaving the tool reverts.
 */
import { state } from './state.js';
import { applyFilter, FILTERS } from './filters/filters.js';
import { runFilterAsync } from './filter-worker-client.js';

// wireFilters runs once per editor open, but the ge:filter-show/hide listeners
// live on window (not on the rebuilt container DOM), so without cleanup each
// reopen would stack another stale pair. Track the previous pair at module
// scope and remove it before re-wiring so exactly one live pair ever exists.
let _prevShowHandler = null;
let _prevHideHandler = null;

export function wireFilters({ activeLayer, saveState, composite }) {
  let orig = null;        // ImageData of the active layer before any preview
  let origLayerId = null;
  let origLayer = null;   // direct ref to the snapshotted layer (for cross-layer restore)
  let applied = false;
  let rafPending = false; // coalesces slider 'input' previews into one per frame
  let previewGen = 0;     // drops stale off-thread preview results (worker is async)

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
    if (!l) { orig = null; origLayerId = null; origLayer = null; return; }
    orig = l.ctx.getImageData(0, 0, l.canvas.width, l.canvas.height);
    origLayerId = l.id;
    origLayer = l;
    applied = false;
  }
  // Restore the previously-snapshotted layer (which may no longer be active) to
  // its pristine pixels — used when the active layer changes mid-preview so an
  // un-applied preview isn't permanently baked into the old layer.
  function restorePrevLayer() {
    if (!orig || !origLayer || applied) return;
    try { origLayer.ctx.putImageData(orig, 0, 0); } catch (_) { /* layer gone/resized */ }
  }
  function restoreOrig() {
    const l = activeLayer();
    if (orig && l && l.id === origLayerId) { l.ctx.putImageData(orig, 0, 0); composite(); }
  }
  function preview() {
    let l = activeLayer();
    if (!orig || !l || l.id !== origLayerId) {
      // Active layer changed mid-preview: revert the old layer's un-applied
      // preview before snapshotting the new one (the doc contract promises
      // leaving/switching reverts), since restoreOrig/onHide only ever touch
      // the currently-active layer.
      if (orig && origLayer && l && l.id !== origLayerId) restorePrevLayer();
      snapshot();
    }
    l = activeLayer();
    if (!orig || !l) return;
    l.ctx.putImageData(orig, 0, 0); // start from the original each time
    const { type, amount } = opts();
    const img = l.ctx.getImageData(0, 0, l.canvas.width, l.canvas.height);
    // Run the filter OFF the main thread so dragging the slider doesn't freeze the
    // UI; a generation guard drops stale results, and the worker client falls back
    // to the synchronous kernel when Workers are unavailable.
    const gen = ++previewGen;
    const targetId = origLayerId;
    runFilterAsync(img, type, amount, extraOpts(type)).then((out) => {
      if (gen !== previewGen) return;                 // superseded by a newer preview
      const cur = activeLayer();
      if (!orig || !cur || cur.id !== targetId) return; // layer/tool changed mid-flight
      cur.ctx.putImageData(out, 0, 0);
      cur._pixVer = (cur._pixVer || 0) + 1; // preview is async + skips saveState; invalidate the fx-cache
      applied = false;
      composite();
    });
  }
  function apply() {
    const l = activeLayer();
    if (!orig || !l || l.id !== origLayerId) return;
    previewGen++; // invalidate any in-flight async preview so it can't land after the bake
    l.ctx.putImageData(orig, 0, 0); // restore so the undo point = pre-filter
    saveState('Filter');
    const { type, amount } = opts();
    const img = l.ctx.getImageData(0, 0, l.canvas.width, l.canvas.height);
    applyFilter(img, type, amount, extraOpts(type));
    l.ctx.putImageData(img, 0, 0);
    applied = true;
    orig = null; origLayer = null; // committed; next change re-snapshots
    composite();
  }

  // rAF-throttle the slider preview so dragging the amount slider runs the
  // full-canvas filter pass at most once per frame (mirrors the adjRafPending
  // pattern used by the adjustment popups) instead of once per 'input' tick.
  function schedulePreview() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; preview(); });
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
  amtEl()?.addEventListener('input', () => { const l = $('ge-filter-amount-label'); if (l) l.textContent = amtEl().value; schedulePreview(); });
  $('ge-filter-apply')?.addEventListener('click', apply);
  $('ge-filter-reset')?.addEventListener('click', () => { restoreOrig(); orig = null; origLayer = null; });

  // Show/hide are driven by tool selection in galleryEditor via window events
  // (decoupled — no init-order dependency). Show snapshots; hide reverts an
  // un-applied preview.
  function onShow() { populate(); syncAmountVisibility(); snapshot(); }
  function onHide() { if (!applied) restoreOrig(); orig = null; origLayer = null; applied = false; }
  // Drop the previous open's window listeners before adding this open's pair so
  // exactly one live pair exists — otherwise each editor reopen would stack a
  // stale onShow/onHide closure bound to a dead session.
  if (_prevShowHandler) window.removeEventListener('ge:filter-show', _prevShowHandler);
  if (_prevHideHandler) window.removeEventListener('ge:filter-hide', _prevHideHandler);
  window.addEventListener('ge:filter-show', onShow);
  window.addEventListener('ge:filter-hide', onHide);
  _prevShowHandler = onShow;
  _prevHideHandler = onHide;
}
