/**
 * Topbar dropdown menus — Image, Filter, and Resize.
 *
 *   Image menu (#ge-image-menu-btn → #ge-image-menu):
 *     resize, selection (edge feather/delete), fill, rotate 90/180,
 *     flip horizontal/vertical.
 *
 *   Filter menu (#ge-filter-menu-btn → #ge-filter-menu):
 *     Blur sub-menu — Gaussian, Zoom.
 *
 *   Resize menu (#ge-resize-menu-btn → #ge-resize-menu):
 *     preset W×H items (data-resize-w/-h) apply immediately;
 *     [data-resize-custom] opens a themed prompt for arbitrary sizes.
 *
 * Returns the resize helpers so the keyboard-shortcuts module can
 * call them too (Ctrl+Shift+T opens the custom prompt).
 *
 * @param {{
 *   closeOtherTopbarMenus: (keepId: string) => void,
 *   registerDocClickAway:  (handler: (e: Event) => void) => void,
 *   saveState:             (label?: string) => void,
 *   composite:             () => void,
 *   fitZoom:               () => void,
 *   promptCanvasSize:      (opts: object) => Promise<{w, h} | null>,
 *   doFillSelection:       () => void,
 *   rotateAllLayers:       (deg: number) => void,
 *   flipAllLayers:         (axis: 'h' | 'v') => void,
 *   applyGaussianBlur:     () => void,
 *   applyZoomBlur:         () => void,
 *   uiModule:              object,
 * }} deps
 *
 * @returns {{
 *   applyResize:         (newW: number, newH: number) => void,
 *   resizeCustomPrompt:  () => Promise<void>,
 * }}
 */
import { state } from './state.js';

export function wireTopbarMenus({
  closeOtherTopbarMenus, registerDocClickAway,
  saveState, composite, fitZoom,
  promptCanvasSize, doFillSelection,
  rotateAllLayers, flipAllLayers, trimToContent,
  applyGaussianBlur, applyZoomBlur,
  uiModule,
}) {
  // ── Resize canvas ──
  // Extracted so both the popup presets and the Ctrl+Shift+T shortcut
  // can call it.
  function applyResize(newW, newH) {
    if (!newW || !newH || newW < 1 || newH < 1) {
      uiModule.showToast('Invalid size');
      return;
    }
    saveState('Resize canvas');
    // Only resize the main canvas — layers keep their original size.
    // Content outside the new bounds is clipped during composite, not
    // destroyed.
    if (state.maskCanvas) {
      const tmpMask = document.createElement('canvas');
      tmpMask.width = state.maskCanvas.width;
      tmpMask.height = state.maskCanvas.height;
      tmpMask.getContext('2d').drawImage(state.maskCanvas, 0, 0);
      state.maskCanvas.width = newW;
      state.maskCanvas.height = newH;
      state.maskCtx.drawImage(tmpMask, 0, 0);
    }
    state.imgWidth = newW;
    state.imgHeight = newH;
    state.mainCanvas.width = newW;
    state.mainCanvas.height = newH;
    const sizeLabel = document.getElementById('ge-canvas-size');
    if (sizeLabel) sizeLabel.textContent = `${newW}×${newH}`;
    fitZoom();
    composite();
    uiModule.showToast(`Canvas resized to ${newW}×${newH}`);
  }

  async function resizeCustomPrompt() {
    const result = await promptCanvasSize({
      title: 'Canvas size',
      okLabel: 'Apply',
      initialW: state.imgWidth,
      initialH: state.imgHeight,
    });
    if (!result) return;
    applyResize(result.w, result.h);
  }

  // ── Image actions (hidden relay registry) ──
  // The visible "Image ▾" trigger button was removed — the app menu bar's
  // Image menu now drives these actions. wire-menu-bar.js relays each click
  // onto the matching [data-image-action] item inside the (permanently
  // hidden) #ge-image-menu div, so we only keep the action-execution handler;
  // there is no longer any open/close/toggle or click-away logic to wire.
  {
    const menu = document.getElementById('ge-image-menu');
    if (menu) {
      menu.addEventListener('click', (e) => {
        const item = e.target.closest('[data-image-action]');
        if (!item || item.disabled) return;
        const action = item.dataset.imageAction;
        if (action === 'resize') resizeCustomPrompt();
        else if (action === 'selection') document.getElementById('ge-edge-menu-btn')?.click();
        else if (action === 'fill') doFillSelection();
        else if (action === 'rotate-90') rotateAllLayers(90);
        else if (action === 'rotate-270') rotateAllLayers(270);
        else if (action === 'rotate-180') rotateAllLayers(180);
        else if (action === 'flip-h') flipAllLayers('h');
        else if (action === 'flip-v') flipAllLayers('v');
        else if (action === 'trim') { if (trimToContent) trimToContent(); }
      });
    }
  }

  // ── Filter actions (hidden relay registry — Gaussian / Zoom blur) ──
  // The visible "Filter ▾" trigger button was removed — the app menu bar's
  // Filter menu now drives these actions via wire-menu-bar.js relaying clicks
  // onto the [data-filter-action] items in the hidden #ge-filter-menu div.
  // Keep only the action-execution handler.
  {
    const menu = document.getElementById('ge-filter-menu');
    if (menu) {
      menu.addEventListener('click', (e) => {
        const item = e.target.closest('[data-filter-action]');
        if (!item) return;
        const action = item.dataset.filterAction;
        if (action === 'blur-gaussian') applyGaussianBlur();
        else if (action === 'blur-zoom') applyZoomBlur();
      });
    }
  }

  // ── Resize popup (preset items + Custom… → resizeCustomPrompt) ──
  {
    const btn = document.getElementById('ge-resize-menu-btn');
    const menu = document.getElementById('ge-resize-menu');
    if (btn && menu) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = menu.hidden;
        if (willOpen) closeOtherTopbarMenus('ge-resize-menu');
        menu.hidden = !menu.hidden;
      });
      menu.querySelectorAll('[data-resize-w]').forEach(item => {
        item.addEventListener('click', () => {
          menu.hidden = true;
          applyResize(parseInt(item.dataset.resizeW, 10), parseInt(item.dataset.resizeH, 10));
        });
      });
      menu.querySelector('[data-resize-custom]')?.addEventListener('click', () => {
        menu.hidden = true;
        resizeCustomPrompt();
      });
      registerDocClickAway((e) => {
        if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) menu.hidden = true;
      });
    }
  }

  return { applyResize, resizeCustomPrompt };
}
