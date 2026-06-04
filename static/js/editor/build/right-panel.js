/**
 * Build the right-hand panel (controls + layers) — DOM creation,
 * controls innerHTML population, mobile bottom-sheet swipe behavior,
 * controls-panel re-parenting on mobile, slider value-chip layout
 * normalization, layer-panel header + mobile peek/expand swipe, and
 * the panel-width drag-resize handle.
 *
 * Owns its own event listeners (touch swipe gestures, mouse resize
 * drag). Returns the `rightPanel` element + the `panelResize` handle
 * + the inner `controls` element so the caller can wire any post-
 * mount tweaks. Reads state.container (for mobile re-parenting) and
 * state.color / state.brushSize / state.wandTolerance (initial slider
 * values).
 *
 * @param {{
 *   controlsHTML:     (ctx: {color, brushSize, wandTolerance}) => string,
 *   layerPanelHTML:   () => string,
 * }} build
 *
 * @returns {{
 *   rightPanel:  HTMLDivElement,
 *   controls:    HTMLDivElement,
 *   layerPanel:  HTMLDivElement,
 *   panelResize: HTMLDivElement,
 * }}
 */
import { state } from '../state.js';
import { wireSectionReorder } from '../panels/section-reorder.js';

export function buildRightPanel({ controlsHTML, layerPanelHTML }) {
  const rightPanel = document.createElement('div');
  rightPanel.className = 'ge-right-panel';

  // Controls section.
  const controls = document.createElement('div');
  controls.className = 'ge-controls';
  // Swipe-down to dismiss on mobile. Tap the same tool again to bring
  // the sheet back. Only the top ~40 px (grab handle area) initiates
  // the gesture so taps on inputs/sliders inside the panel still work.
  {
    let sy = 0, dragging = false;
    controls.addEventListener('touchstart', (e) => {
      if (window.innerWidth > 700) return;
      const rect = controls.getBoundingClientRect();
      const t = e.touches[0];
      // Only engage if touch starts in the top grab zone.
      if (t.clientY - rect.top > 40) return;
      sy = t.clientY;
      dragging = true;
      controls.style.transition = 'none';
    }, { passive: true });
    controls.addEventListener('touchmove', (e) => {
      if (!dragging) return;
      const dy = e.touches[0].clientY - sy;
      if (dy > 0) controls.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    controls.addEventListener('touchend', (e) => {
      if (!dragging) return;
      dragging = false;
      const dy = e.changedTouches[0].clientY - sy;
      controls.style.transition = '';
      controls.style.transform = '';
      if (dy > 60) controls.classList.add('dismissed');
    });
  }
  controls.innerHTML = controlsHTML({
    color: state.color,
    brushSize: state.brushSize,
    wandTolerance: state.wandTolerance,
  });
  // Persist each disclosure section's collapsed state across editor reopens /
  // reloads (PS-style panels that remember whether they're open). Restore the
  // saved state on build, then save on every toggle.
  try {
    controls.querySelectorAll('details[id]').forEach((d) => {
      const k = 'ge-panel-open:' + d.id;
      const saved = localStorage.getItem(k);
      if (saved === '1') d.open = true; else if (saved === '0') d.open = false;
      d.addEventListener('toggle', () => { try { localStorage.setItem(k, d.open ? '1' : '0'); } catch {} });
    });
  } catch {}
  // Drag-to-reorder the document sections (grip in each header) + restore order.
  try { wireSectionReorder(controls); } catch {}
  rightPanel.appendChild(controls);
  // Mobile only (≤ 700 px — matches the .ge-editor-body column-stack
  // breakpoint): the right panel becomes a transformed bottom-sheet,
  // so any position:fixed descendant gets trapped by the transform
  // and rides along with the panel. Re-parent the controls panel to
  // the editor root so it can truly fix to the viewport bottom
  // regardless of the layers-sheet state. On desktop, controls stay
  // docked inside the right panel above the layers list.
  if (window.innerWidth <= 700 && state.container) {
    state.container.appendChild(controls);
    // Canvas-dominant default: the controls sheet (color picker + tool
    // options + docks) is a 60vh bottom sheet — leaving it open on launch
    // buries the whole canvas. Start it dismissed so the artwork is visible;
    // tapping a tool slides its controls (incl. the color picker) back up,
    // and re-tapping the same tool dismisses it again (handled in onSelectTool).
    controls.classList.add('dismissed');
  }

  // Move every slider-row's value chip out of its <label> and place
  // it AFTER the slider, so the value sits on the right edge of the
  // row instead of being smashed against the slider track on the left.
  controls.querySelectorAll('.ge-eraser-row').forEach(row => {
    const valueSpan = row.querySelector('label > span[id$="-label"]');
    const slider = row.querySelector('input[type="range"]');
    if (valueSpan && slider) {
      valueSpan.classList.add('ge-slider-value');
      slider.after(valueSpan);
    }
  });

  // Vertical splitter between the controls and the Layers dock — drag up to give
  // Layers more height (it's otherwise capped at ~46%), down to shrink it.
  const vsplit = document.createElement('div');
  vsplit.className = 'ge-vsplit';
  vsplit.title = 'Drag to resize the Layers panel';
  vsplit.style.cssText = 'flex:0 0 auto;height:8px;cursor:ns-resize;display:flex;align-items:center;justify-content:center;';
  vsplit.innerHTML = '<span style="width:34px;height:3px;border-radius:2px;background:var(--fg);opacity:0.28;pointer-events:none;"></span>';
  rightPanel.appendChild(vsplit);

  // Layer panel.
  const layerPanel = document.createElement('div');
  layerPanel.className = 'ge-layers';
  layerPanel.innerHTML = layerPanelHTML();
  rightPanel.appendChild(layerPanel);

  // Restore a saved Layers height + wire the vertical drag-resize (desktop).
  try {
    const savedH = parseInt(localStorage.getItem('ge-layers-height') || '', 10);
    if (savedH && savedH > 140) { layerPanel.style.flex = `0 0 ${savedH}px`; layerPanel.style.maxHeight = 'none'; }
  } catch {}
  let _vsY = 0, _vsH = 0;
  const onVMove = (e) => {
    const dy = _vsY - e.clientY; // drag up → taller Layers
    const panelH = rightPanel.getBoundingClientRect().height;
    const next = Math.max(140, Math.min(panelH - 140, _vsH + dy));
    layerPanel.style.flex = `0 0 ${next}px`;
    layerPanel.style.maxHeight = 'none';
  };
  const onVUp = () => {
    document.removeEventListener('mousemove', onVMove);
    document.removeEventListener('mouseup', onVUp);
    document.body.style.cursor = '';
    try { localStorage.setItem('ge-layers-height', String(Math.round(layerPanel.getBoundingClientRect().height))); } catch {}
  };
  vsplit.addEventListener('mousedown', (e) => {
    _vsY = e.clientY; _vsH = layerPanel.getBoundingClientRect().height;
    e.preventDefault();
    document.body.style.cursor = 'ns-resize';
    document.addEventListener('mousemove', onVMove);
    document.addEventListener('mouseup', onVUp);
  });
  // Mobile: tap the header grab handle or swipe up/down to toggle
  // the layers sheet between peek and expanded. The peek state
  // always shows the active layer so users never lose access to it.
  {
    const header = layerPanel.querySelector('.ge-layers-header');
    if (header) {
      let sy = 0, sx = 0, dragging = false, didSwipe = false;
      header.addEventListener('touchstart', (e) => {
        if (window.innerWidth > 700) return;
        if (e.target.closest('button')) return;
        sy = e.touches[0].clientY;
        sx = e.touches[0].clientX;
        dragging = true;
        didSwipe = false;
      }, { passive: true });
      header.addEventListener('touchend', (e) => {
        if (!dragging) return;
        dragging = false;
        const dy = e.changedTouches[0].clientY - sy;
        const dx = Math.abs(e.changedTouches[0].clientX - sx);
        // Real swipe — three states cycle by direction:
        //   minimized → peek → expanded   (swipe up)
        //   expanded → peek → minimized   (swipe down)
        if (Math.abs(dy) > 20 && Math.abs(dy) > dx) {
          didSwipe = true;
          const isExpanded = rightPanel.classList.contains('expanded');
          const isMinimized = rightPanel.classList.contains('minimized');
          if (dy < 0) {
            if (isMinimized) {
              rightPanel.classList.remove('minimized');
            } else if (!isExpanded) {
              rightPanel.classList.add('expanded');
            }
          } else {
            if (isExpanded) {
              rightPanel.classList.remove('expanded');
            } else if (!isMinimized) {
              rightPanel.classList.add('minimized');
            }
          }
          e.preventDefault();
        }
      });
      header.addEventListener('click', (e) => {
        if (window.innerWidth > 700) return;
        if (e.target.closest('button')) return;
        if (didSwipe) { didSwipe = false; return; }
        // Click cycles between peek and expanded; minimized comes
        // back to peek (so a tap on the handle always reveals at
        // least the active layer row).
        if (rightPanel.classList.contains('minimized')) {
          rightPanel.classList.remove('minimized');
        } else {
          rightPanel.classList.toggle('expanded');
        }
      });
    }
  }

  // Horizontal drag handle on the LEFT edge of the right panel — drag
  // left to widen, right to narrow. Persists chosen width in
  // localStorage so it survives reopens. (Earlier version was a
  // vertical-drag for height; horizontal feels more natural since
  // cramped LAYER ROWS are about width, not height.)
  const panelResize = document.createElement('div');
  panelResize.className = 'ge-panel-resize';
  panelResize.title = 'Drag to resize panel';
  rightPanel.appendChild(panelResize);
  try {
    const savedW = parseInt(localStorage.getItem('ge-right-panel-width') || '', 10);
    if (savedW && savedW > 160 && savedW < 800) rightPanel.style.flex = `0 0 ${savedW}px`;
  } catch {}
  // Drag-resize. The move/up listeners are attached to `document` ONLY for the
  // duration of a drag (added on mousedown, removed on mouseup) so they don't
  // accumulate on the global document across editor re-opens (was a leak: every
  // buildRightPanel added permanent document listeners) and don't run on every
  // pointer move when idle.
  let panelStartX = 0;
  let panelStartW = 0;
  const onPanelMove = (e) => {
    // Dragging left → wider panel (the panel sits on the right of the editor, so
    // a leftward drag pulls its left edge left).
    const delta = panelStartX - e.clientX;
    const next = Math.max(160, Math.min(window.innerWidth - 200, panelStartW + delta));
    rightPanel.style.flex = `0 0 ${next}px`;
  };
  const onPanelUp = () => {
    document.removeEventListener('mousemove', onPanelMove);
    document.removeEventListener('mouseup', onPanelUp);
    document.body.style.cursor = '';
    try {
      const w = Math.round(rightPanel.getBoundingClientRect().width);
      localStorage.setItem('ge-right-panel-width', String(w));
    } catch {}
  };
  panelResize.addEventListener('mousedown', (e) => {
    panelStartX = e.clientX;
    panelStartW = rightPanel.getBoundingClientRect().width;
    e.preventDefault();
    document.body.style.cursor = 'ew-resize';
    document.addEventListener('mousemove', onPanelMove);
    document.addEventListener('mouseup', onPanelUp);
  });

  // --- Float-out for the Layers + Color panels (PS-style undock) ---
  // A small ⤢ button in each panel's header pops it into a draggable window
  // (the live node is MOVED, so its listeners survive); "Dock" returns it to its
  // home slot. Floated windows are cleaned up by closeEditor's .ge-float-panel sweep.
  function makeFloatable(panel, title, headerSel) {
    if (!panel) return;
    const home = panel.parentNode;
    const anchor = panel.previousSibling;
    const headerHost = panel.querySelector(headerSel) || panel;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'Float / dock this panel';
    btn.textContent = '⤢';
    btn.style.cssText = 'background:none;border:none;color:var(--fg);opacity:0.5;cursor:pointer;font-size:12px;line-height:1;padding:0 4px;margin-left:auto;flex:0 0 auto;';
    headerHost.appendChild(btn);
    let win = null;
    const dock = () => {
      if (!win) return;
      panel.style.cssText = panel.dataset.geSavedCss || '';
      if (anchor && anchor.parentNode === home) home.insertBefore(panel, anchor.nextSibling);
      else if (home) home.insertBefore(panel, home.firstChild);
      win.remove(); win = null;
    };
    const float = () => {
      if (win) { dock(); return; }
      win = document.createElement('div');
      win.className = 'ge-float-panel';
      win.style.cssText = 'position:fixed;z-index:300;width:280px;background:#26262b;border:1px solid rgba(255,255,255,0.16);border-radius:8px;box-shadow:0 14px 40px rgba(0,0,0,0.55);color:#eee;left:' + Math.round(window.innerWidth * 0.42) + 'px;top:90px;';
      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 8px;cursor:grab;background:rgba(255,255,255,0.06);border-radius:8px 8px 0 0;font-size:11px;font-weight:600;';
      bar.innerHTML = `<span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${title}</span>`;
      const db = document.createElement('button');
      db.type = 'button'; db.className = 'ge-btn ge-btn-sm'; db.textContent = 'Dock'; db.title = 'Dock back into the panel';
      bar.appendChild(db);
      win.appendChild(bar);
      const body = document.createElement('div');
      body.style.cssText = 'padding:6px;max-height:72vh;overflow:auto;';
      panel.dataset.geSavedCss = panel.style.cssText;
      panel.style.cssText = 'max-height:none;flex:1 1 auto;display:flex;flex-direction:column;';
      body.appendChild(panel);
      win.appendChild(body);
      (state.container || document.body).appendChild(win);
      bar.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return;
        e.preventDefault();
        const r = win.getBoundingClientRect(), ox = r.left, oy = r.top, sx = e.clientX, sy = e.clientY;
        const mv = (ev) => {
          win.style.left = Math.max(0, Math.min(window.innerWidth - 60, ox + ev.clientX - sx)) + 'px';
          win.style.top = Math.max(0, Math.min(window.innerHeight - 30, oy + ev.clientY - sy)) + 'px';
        };
        const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); };
        document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
      });
      db.addEventListener('click', dock);
    };
    btn.addEventListener('click', float);
  }
  try { makeFloatable(layerPanel, 'Layers', '.ge-layers-header'); } catch {}
  try { makeFloatable(controls.querySelector('#ge-color-panel'), 'Color', '.ge-color-tabs'); } catch {}

  return { rightPanel, controls, layerPanel, panelResize };
}
