/**
 * Application menu bar — the familiar File / Edit / Image / Layer / Select /
 * Filter / View row at the very top, matching the layout pro editors use.
 *
 * Pure DOM + a scoped <style>. Every item is a thin RELAY: it carries a
 * data-relay-* attribute describing how to trigger an ALREADY-wired action
 * (click an existing button/menu item, pick a tool, or dispatch a keyboard
 * shortcut). wire-menu-bar.js reads those attributes — so the menu owns no
 * logic and can't drift from the controls it mirrors.
 *
 * @returns {HTMLDivElement}
 */
const MENUS = [
  { title: 'File', items: [
    { label: 'New Document', click: '.ge-doc-tab-new' },
    { sep: true },
    { label: 'Save over original', click: '#ge-save' },
    { label: 'Save as copy', click: '#ge-export-gallery' },
    { label: 'Download PNG', click: '#ge-download' },
    { label: 'Export As… (PNG / JPG / WebP / TGA)', click: '#ge-export-as-trigger' },
    { label: 'Export Animation… (GIF / WebM)', click: '#ge-export-anim-trigger' },
    { sep: true },
    { label: 'Save project…', click: '#ge-save-project' },
    { label: 'Open project…', click: '#ge-load-project' },
    { sep: true },
    { label: 'Import image…', click: '#ge-import-topbar' },
  ] },
  { title: 'Edit', items: [
    { label: 'Undo', click: '#ge-undo', sc: 'Ctrl+Z' },
    { label: 'Redo', click: '#ge-redo', sc: 'Ctrl+Shift+Z' },
    { sep: true },
    { label: 'Fill (Content-Aware)', click: '#ge-content-fill' },
    { sep: true },
    { label: 'History…', click: '#ge-history-btn' },
    { sep: true },
    { label: 'Connect Drawing Tablet (Ink-off pressure)…', click: '#ge-pen-hid-trigger' },
  ] },
  { title: 'Image', items: [
    { label: 'Image size… (resample)', click: '#ge-image-size-trigger' },
    { label: 'Canvas size…', image: 'resize' },
    { sep: true },
    { label: 'Rotate 90° CW', image: 'rotate-90' },
    { label: 'Rotate 90° CCW', image: 'rotate-270' },
    { label: 'Rotate 180°', image: 'rotate-180' },
    { label: 'Flip Horizontal', image: 'flip-h' },
    { label: 'Flip Vertical', image: 'flip-v' },
  ] },
  { title: 'Layer', items: [
    { label: 'New Layer', click: '#ge-add-layer', sc: 'Ctrl+Alt+J' },
    { label: 'New Fill Layer: Solid Color', click: '#ge-fill-solid' },
    { label: 'New Fill Layer: Gradient', click: '#ge-fill-gradient' },
    { label: 'Group Layer', key: 'ctrl+g', sc: 'Ctrl+G' },
    { label: 'Ungroup', key: 'ctrl+shift+g', sc: 'Ctrl+Shift+G' },
    { label: 'Add / Edit Layer Mask', click: '#ge-layer-mask' },
    { label: 'Blending Options…', click: '#ge-layer-fx' },
    { sep: true },
    { label: 'Convert to Smart Object', click: '#ge-smart-convert' },
    { label: 'Replace Contents…', click: '#ge-smart-replace' },
    { label: 'Place Linked Image…', click: '#ge-smart-link' },
    { label: 'Update Linked Contents', click: '#ge-smart-update-linked' },
    { label: 'Rasterize Layer', click: '#ge-smart-rasterize' },
    { sep: true },
    { label: 'Stamp Visible', key: 'ctrl+alt+shift+e', sc: 'Ctrl+Alt+Shift+E' },
    { sep: true },
    { label: 'Merge Down', click: '#ge-merge-down' },
    { label: 'Merge All', click: '#ge-merge-all' },
  ] },
  { title: 'Select', items: [
    { label: 'All', key: 'ctrl+alt+a' },
    { label: 'Deselect', key: 'ctrl+shift+d' },
    { label: 'Inverse', key: 'ctrl+alt+i' },
    { sep: true },
    { label: 'Color Range (foreground)…', click: '#ge-color-range' },
  ] },
  { title: 'Filter', items: [
    { label: 'Gaussian Blur…', filter: 'blur-gaussian' },
    { label: 'Zoom Blur…', filter: 'blur-zoom' },
    { sep: true },
    { label: 'All Filters…', tool: 'filter' },
    { sep: true },
    { label: 'Actions…', click: '#ge-actions-toggle' },
    { label: 'Script Console…', click: '#ge-script-toggle' },
    { sep: true },
    { label: 'Animation Timeline', click: '#ge-anim-toggle' },
    { label: 'Transparency Checkerboard…', click: '#ge-checker-trigger' },
  ] },
  { title: 'View', items: [
    { label: 'Zoom In', click: '#ge-zoom-in' },
    { label: 'Zoom Out', click: '#ge-zoom-out' },
    { label: 'Fit on Screen', click: '#ge-zoom-fit' },
    { label: 'Actual Pixels (100%)', click: '#ge-zoom-100' },
    { sep: true },
    { label: 'Proof Colors (CMYK)', key: 'ctrl+y', sc: 'Ctrl+Y' },
    { sep: true },
    { label: 'Rotate View 15° CW', key: 'r', sc: 'R' },
    { label: 'Reset View Rotation', key: 'shift+r', sc: 'Shift+R' },
    { sep: true },
    { label: 'Show / Hide Grid', key: "ctrl+'", sc: "Ctrl+'" },
    { label: 'Show / Hide Guides', key: 'ctrl+;', sc: 'Ctrl+;' },
    { label: 'Add Vertical Guide', click: '#ge-guide-v' },
    { label: 'Add Horizontal Guide', click: '#ge-guide-h' },
    { label: 'Clear Guides', click: '#ge-guide-clear' },
    { sep: true },
    { label: 'Fullscreen', click: '#ge-fullscreen-btn', sc: 'F' },
  ] },
  // Window — show / hide each app panel. Every item is a CHECKBOX whose
  // marker reflects the panel's LIVE visibility; wire-window-menu.js owns the
  // toggle + checkmark-refresh logic and reads the data-relay-panel key. Only
  // panels that ACTUALLY exist in this build are listed (verified by selector).
  { title: 'Window', items: [
    { label: 'Color', panel: 'color', sc: 'F6' },
    { label: 'OK Color Picker', panel: 'ok' },
    { label: 'Swatches', panel: 'swatches' },
    { label: 'Layers', panel: 'layers', sc: 'F7' },
    { label: 'Brush Settings', panel: 'brush', sc: 'F5' },
    { label: 'History', panel: 'history' },
    { label: 'Histogram', panel: 'histogram' },
    { label: 'Actions', panel: 'actions' },
    { label: 'Timeline', panel: 'timeline' },
    { sep: true },
    { label: 'Toolbar', panel: 'toolbar' },
    { label: 'Options', panel: 'options' },
  ] },
];

const STYLE = `
.ge-menu-bar{display:flex;align-items:center;gap:1px;padding:1px 6px;background:rgba(0,0,0,0.22);border-bottom:1px solid rgba(255,255,255,0.06);font-size:12px;flex:0 0 auto;position:relative;z-index:60;user-select:none;}
.ge-menu{position:relative;}
.ge-menu-title{background:none;border:none;color:inherit;padding:3px 9px;border-radius:4px;cursor:pointer;font:inherit;}
.ge-menu-title:hover,.ge-menu.open .ge-menu-title{background:rgba(255,255,255,0.12);}
.ge-menu-drop{position:absolute;top:100%;left:0;min-width:190px;background:#2a2a2e;border:1px solid rgba(255,255,255,0.14);border-radius:6px;padding:4px;box-shadow:0 10px 26px rgba(0,0,0,0.45);z-index:100;}
.ge-menu-drop[hidden]{display:none;}
.ge-menu-item{display:flex;justify-content:space-between;gap:18px;align-items:center;width:100%;text-align:left;background:none;border:none;color:inherit;padding:5px 10px;border-radius:4px;cursor:pointer;font:inherit;white-space:nowrap;}
.ge-menu-item:hover{background:rgba(120,150,255,0.25);}
.ge-menu-item .ge-menu-sc{opacity:0.45;font-size:11px;}
.ge-menu-sep{height:1px;background:rgba(255,255,255,0.1);margin:4px 2px;}
/* Window-menu checkbox items: a fixed-width leading marker column so the
   labels align whether or not the panel is currently shown. The marker glyph
   is injected by wire-window-menu.js when the panel is visible. */
.ge-menu-item[data-relay-panel]{padding-left:6px;}
.ge-menu-item .ge-menu-check{display:inline-block;width:14px;flex:0 0 14px;text-align:center;opacity:0.95;}
`;

function relayAttr(it) {
  if (it.click) return `data-relay-click="${it.click}"`;
  if (it.image) return `data-relay-image="${it.image}"`;
  if (it.filter) return `data-relay-filter="${it.filter}"`;
  if (it.tool) return `data-relay-tool="${it.tool}"`;
  if (it.key) return `data-relay-key="${it.key}"`;
  if (it.panel) return `data-relay-panel="${it.panel}"`;
  return '';
}

export function buildMenuBar() {
  const bar = document.createElement('div');
  bar.className = 'ge-menu-bar';
  bar.innerHTML = `<style>${STYLE}</style>` + MENUS.map((m) => `
    <div class="ge-menu" data-menu>
      <button type="button" class="ge-menu-title">${m.title}</button>
      <div class="ge-menu-drop" hidden>
        ${m.items.map((it) => it.sep
          ? '<div class="ge-menu-sep"></div>'
          : `<button type="button" class="ge-menu-item" ${relayAttr(it)} role="${it.panel ? 'menuitemcheckbox' : 'menuitem'}" aria-checked="false"><span>${it.panel ? '<span class="ge-menu-check" aria-hidden="true"></span>' : ''}${it.label}</span>${it.sc ? `<span class="ge-menu-sc">${it.sc}</span>` : ''}</button>`
        ).join('')}
      </div>
    </div>
  `).join('');
  return bar;
}
