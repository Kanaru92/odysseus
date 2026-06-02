// Module-level guard: the F-key accelerator is a document-level listener that
// must be installed ONCE for the page, not re-added on every openEditor() (which
// previously leaked a listener per open and multi-toggled panels).
let _accelWired = false;

/**
 * Wire the "Window" menu (build/menu-bar.js) — the panel show/hide list.
 *
 * Each Window item carries a data-relay-panel="<key>" attribute. This module
 * owns ALL the logic for those items (wire-menu-bar.js deliberately ignores
 * data-relay-panel): a per-key registry says how to read a panel's LIVE
 * visibility and how to toggle it. On every menu open we refresh each item's
 * leading checkmark from the live state; clicking an item flips the panel and
 * re-syncs the marker.
 *
 * Toggling strategy by panel kind:
 *  - Docked sections (Color / Layers / Brush Settings / Histogram / Toolbar /
 *    Options) toggle a `.ge-hidden` class directly on the element. Hiding a
 *    flex child reflows the right-panel split cleanly (the sibling region
 *    flex-grows to fill).
 *  - Color sub-tabs (OK Color Picker / Swatches) reuse the existing tab wiring
 *    by clicking the matching `.ge-color-tab` button — "visible" means that tab
 *    is the active pane (and the Color panel itself is shown). Hiding returns
 *    to the base Color tab.
 *  - Floating / on-demand panels (History / Actions / Timeline) defer to their
 *    already-wired toggle buttons, so this module never duplicates their
 *    create/destroy logic.
 *
 * Optional F-key accelerators (F5 Brush Settings, F6 Color, F7 Layers) are
 * bound on a private document keydown here — no edit to keyboard-shortcuts.js.
 */

const MARKER = '✔';

const $ = (sel) => document.querySelector(sel);
const shown = (el) => !!el && el.offsetParent !== null && getComputedStyle(el).display !== 'none';

// A docked section that toggles a `.ge-hidden` class. Visible when the element
// exists and is not class-hidden / display:none.
const sectionPanel = (sel) => ({
  exists: () => !!$(sel),
  isVisible: () => { const el = $(sel); return !!el && !el.classList.contains('ge-hidden') && shown(el); },
  toggle: () => { const el = $(sel); if (el) el.classList.toggle('ge-hidden'); },
});

// A Color-panel sub-tab. Visible when its pane is the active (displayed) pane.
// Showing = click its tab; hiding = click the base "Color" tab.
const colorTabPanel = (which) => ({
  exists: () => !!$(`.ge-color-tab[data-ctab="${which}"]`),
  isVisible: () => {
    const panel = $('#ge-color-panel');
    const pane = $(`.ge-color-pane[data-cpane="${which}"]`);
    return !!panel && !panel.classList.contains('ge-hidden') && shown(panel) && !!pane && shown(pane);
  },
  toggle() {
    const panel = $('#ge-color-panel');
    if (panel && panel.classList.contains('ge-hidden')) panel.classList.remove('ge-hidden');
    if (this.isVisible()) $('.ge-color-tab[data-ctab="color"]')?.click();
    else $(`.ge-color-tab[data-ctab="${which}"]`)?.click();
  },
});

// A floating / on-demand panel driven by an existing toggle button. `panelSel`
// is consulted for live visibility; `btnSel` performs the show/hide.
const relayPanel = (panelSel, btnSel) => ({
  exists: () => !!$(btnSel),
  isVisible: () => shown($(panelSel)),
  toggle: () => $(btnSel)?.click(),
});

const REGISTRY = {
  color:     sectionPanel('#ge-color-panel'),
  ok:        colorTabPanel('ok'),
  swatches:  colorTabPanel('swatches'),
  layers:    sectionPanel('.ge-layers'),
  brush:     sectionPanel('#ge-brush-section'),
  history:   relayPanel('#ge-history-panel', '#ge-history-btn'),
  histogram: sectionPanel('#ge-histogram-section'),
  actions:   relayPanel('#ge-actions-panel', '#ge-actions-toggle'),
  timeline:  relayPanel('.ge-timeline', '#ge-anim-toggle'),
  toolbar:   sectionPanel('.ge-toolbar'),
  options:   sectionPanel('.ge-options-bar'),
};

export function wireWindowMenu(bar) {
  if (!bar) return;
  const items = Array.from(bar.querySelectorAll('.ge-menu-item[data-relay-panel]'));
  if (!items.length) return;

  // Drop any item whose panel doesn't exist in this build (defensive — the
  // menu already lists only known panels, but a future variant might omit one).
  for (const item of items) {
    const def = REGISTRY[item.dataset.relayPanel];
    if (!def || !def.exists()) item.remove();
  }
  const live = items.filter((it) => it.isConnected && REGISTRY[it.dataset.relayPanel]);

  const setMark = (item, on) => {
    const m = item.querySelector('.ge-menu-check');
    if (m) m.textContent = on ? MARKER : '';
    item.setAttribute('aria-checked', on ? 'true' : 'false');
  };
  const refresh = () => live.forEach((item) => {
    const def = REGISTRY[item.dataset.relayPanel];
    setMark(item, !!def && def.isVisible());
  });

  // Refresh every checkmark whenever any menu opens (wire-menu-bar.js fires
  // ge:menu-open just before revealing a drop). Cheap; keeps the Window menu
  // correct even after a panel is toggled by other UI (keyboard, buttons).
  bar.addEventListener('ge:menu-open', refresh);

  live.forEach((item) => {
    item.addEventListener('click', () => {
      const def = REGISTRY[item.dataset.relayPanel];
      if (!def) return;
      def.toggle();
      // Re-read after the toggle so the marker reflects the new live state
      // (the menu is already closing, so this is for the next open).
      setMark(item, def.isVisible());
    });
  });

  refresh();

  // Optional F-key accelerators — bound here so keyboard-shortcuts.js is left
  // untouched. Only fire when not typing into a field, and let the registry's
  // toggle do the work so behaviour matches the menu exactly.
  const ACCEL = { F5: 'brush', F6: 'color', F7: 'layers' };
  if (!_accelWired) {
    _accelWired = true; // install once for the page (no per-open leak)
    document.addEventListener('keydown', (e) => {
      const key = ACCEL[e.key];
      if (!key) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const def = REGISTRY[key];
      if (!def || !def.exists()) return;
      e.preventDefault();
      def.toggle();
      // Resolve the item from the CURRENT DOM (not a captured `live` array that
      // goes stale when the menu bar is rebuilt on the next open).
      const item = document.querySelector(`[data-relay-panel="${key}"]`);
      if (item) setMark(item, def.isVisible());
    });
  }
}
