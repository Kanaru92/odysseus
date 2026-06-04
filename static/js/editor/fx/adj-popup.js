/**
 * FX / adjustment-popup machinery — the per-layer Brightness/Contrast,
 * Hue/Saturation, Levels, and Color-Balance editor.
 *
 * Self-contained subsystem with three external touchpoints:
 *
 *  - `composite()`         redraw the canvas after every staged change
 *  - `saveState(label)`    push an undo entry on Apply
 *  - `renderLayerPanel()`  refresh the layer panel after add/edit
 *
 * Lifecycle:
 *
 *   FX button on layer row → openFxPopup(layer, anchor)
 *     → small chooser menu (B/C, H/S, Levels, Color Balance)
 *     → openAdjPopup(layer, type, anchor[, existingAdj])
 *       → buildAdjBody renders the type-specific sliders + histogram
 *       → sliders / histogram handles mutate `layer._stagedAdj.params`
 *       → composite() previews live via the adjLayers stack
 *       → Apply commits to layer.adjLayers + saveState() + renderLayerPanel()
 *       → Cancel / Esc drops the staged state
 *
 * Popups can be minimised → modalManager dock chip → click chip to
 * restore. Re-opening a committed sub-layer (from the layer panel's
 * adj-row click) calls `editAdjLayer` which re-opens openAdjPopup
 * with the existing sub-layer's params staged for editing.
 *
 * @param {{
 *   composite:        () => void,
 *   saveState:        (label?: string) => void,
 *   renderLayerPanel: () => void,
 * }} deps
 *
 * @returns {{
 *   openFxPopup, openAdjPopup, editAdjLayer,
 *   closeFxPopup, closeFxMenu, closeAdjPopup,
 *   ensureFxDock, ensureAdjustments,
 *   syncFxPanelToActiveLayerIfPresent,
 *   minimiseAdjPopup,
 * }}
 */
import { state } from '../state.js';
import modalManager from '../../modalManager.js';
import {
  ADJ_ICONS,
  adjLayerLabel,
  defaultAdjParams,
} from '../layer-helpers.js';
import { drawHistogram } from './histogram.js';
import { buildCurveLUT } from './curves.js';
import { registerCube, hasLut } from './lut.js';

const clampV = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function createAdjPopupSystem({ composite, saveState, renderLayerPanel }) {
  function suppressLayerGhostTap() {
    window.__geSuppressLayerTapUntil = Date.now() + 650;
  }

  function closeFxPopup() {
    if (state.fxPopupEl) {
      state.fxPopupEl.remove();
      state.fxPopupEl = null;
      state.fxPopupLayerId = null;
    }
  }

  function ensureAdjustments(layer) {
    // Older layers (loaded from saved projects) may be missing the
    // adjustments structure entirely. Pad with identity values.
    if (!layer.adjustments) layer.adjustments = {};
    const a = layer.adjustments;
    if (a.brightness === undefined) a.brightness = 1;
    if (a.contrast === undefined) a.contrast = 1;
    if (a.saturation === undefined) a.saturation = 1;
    if (a.hue === undefined) a.hue = 0;
    if (!a.levels) a.levels = { inBlack: 0, inWhite: 255, gamma: 1.0, outBlack: 0, outWhite: 255 };
    if (!a.colorBalance) a.colorBalance = {
      shadows: { r: 0, g: 0, b: 0 },
      midtones: { r: 0, g: 0, b: 0 },
      highlights: { r: 0, g: 0, b: 0 },
    };
    return a;
  }

  // Floating dock for minimised FX popups — lives at bottom-right.
  function ensureFxDock() {
    let dock = document.getElementById('ge-fx-dock');
    if (!dock) {
      dock = document.createElement('div');
      dock.id = 'ge-fx-dock';
      document.body.appendChild(dock);
    }
    return dock;
  }

  function closeFxMenu() {
    if (state.fxMenuEl) {
      if (state.fxMenuEl._escHandler) {
        document.removeEventListener('keydown', state.fxMenuEl._escHandler, true);
      }
      if (state.fxMenuEl._awayHandler) {
        document.removeEventListener('pointerdown', state.fxMenuEl._awayHandler, true);
      }
      state.fxMenuEl.remove();
      state.fxMenuEl = null;
    }
    document.getElementById('ge-fx-menu-backdrop')?.remove();
  }

  function openFxPopup(layer, anchorEl) {
    // Toggle off ONLY if a menu for this layer is genuinely on-screen.
    // `state` is a shared singleton that survives editor close/reopen,
    // so a stale `fxMenuEl` from a previous session (whose detached
    // element still carries a now-recycled `_layerId`) used to make
    // this guard fire and silently swallow the first click. Verify the
    // element is still in the document before treating it as "open".
    if (state.fxMenuEl && document.body.contains(state.fxMenuEl) &&
        state.fxMenuEl._layerId === layer.id) { closeFxMenu(); return; }
    closeFxMenu();
    if (!layer.adjLayers) layer.adjLayers = [];
    const backdrop = document.createElement('div');
    backdrop.id = 'ge-fx-menu-backdrop';
    backdrop.style.cssText = 'position:fixed;inset:0;z-index:10001;background:transparent;pointer-events:auto;touch-action:none;';
    document.body.appendChild(backdrop);
    backdrop.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      closeFxMenu();
    }, true);
    backdrop.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    }, true);
    const menu = document.createElement('div');
    menu.className = 'ge-fx-menu ge-frosted';
    menu._layerId = layer.id;
    menu._ignoreActivationUntil = Date.now() + 350;
    menu.style.zIndex = '10002';
    menu.style.pointerEvents = 'auto';
    const items = [
      { type: 'brightness-contrast', label: 'Brightness / Contrast' },
      { type: 'hue-saturation',      label: 'Hue / Saturation' },
      { type: 'levels',              label: 'Levels' },
      { type: 'curves',              label: 'Curves' },
      { type: 'color-balance',       label: 'Color Balance' },
      { type: 'vibrance',            label: 'Vibrance' },
      { type: 'exposure',            label: 'Exposure' },
      { type: 'photo-filter',        label: 'Photo Filter' },
      { type: 'gradient-map',        label: 'Gradient Map' },
      { type: 'channel-mixer',       label: 'Channel Mixer' },
      { type: 'selective-color',     label: 'Selective Color' },
      { type: 'shadows-highlights',  label: 'Shadows/Highlights' },
      { type: 'vignette',            label: 'Vignette' },
      { type: 'clarity',             label: 'Clarity' },
      { type: 'chromatic-aberration', label: 'Chromatic Aberration' },
      { type: 'lens-distortion',     label: 'Lens Distortion' },
      { type: 'color-lookup',        label: 'Color Lookup' },
      { type: 'grain',               label: 'Grain' },
      { type: 'posterize',           label: 'Posterize' },
      { type: 'threshold',           label: 'Threshold' },
      { type: 'invert',              label: 'Invert' },
      { type: 'black-white',         label: 'Black & White' },
      { type: 'desaturate',          label: 'Desaturate' },
    ];
    menu.innerHTML = items.map(i =>
      `<button class="ge-fx-menu-item" data-fx-type="${i.type}"><span class="ge-fx-menu-icon">${ADJ_ICONS[i.type] || ''}</span><span>${i.label}</span></button>`
    ).join('');
    document.body.appendChild(menu);
    state.fxMenuEl = menu;
    const activateMenuItem = (btn, ev) => {
      ev?.preventDefault?.();
      ev?.stopPropagation?.();
      if (Date.now() < (menu._ignoreActivationUntil || 0)) return;
      if (!btn || btn.dataset.opening === '1') return;
      btn.dataset.opening = '1';
      const type = btn.dataset.fxType;
      closeFxMenu();
      openAdjPopup(layer, type, anchorEl);
    };
    menu.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
    }, true);
    menu.addEventListener('pointerup', (ev) => {
      const btn = ev.target.closest('.ge-fx-menu-item');
      if (btn) activateMenuItem(btn, ev);
      else ev.stopPropagation();
    }, true);
    menu.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.ge-fx-menu-item');
      if (btn) activateMenuItem(btn, ev);
      else ev.stopPropagation();
    }, true);

    const isMobile = window.matchMedia('(max-width: 820px)').matches;
    const r = isMobile ? null : anchorEl?.getBoundingClientRect?.();
    if (isMobile) {
      menu.style.left = '';
      menu.style.top = '';
      menu.style.right = '';
      menu.style.bottom = '';
    } else if (r) {
      const menuW = 220;
      const menuH = menu.offsetHeight || 200;
      const rightX = r.right + 4;
      const leftX  = r.left - menuW - 4;
      const fitsRight = rightX + menuW <= window.innerWidth - 8;
      let left = fitsRight ? rightX : Math.max(8, leftX);
      left = Math.min(window.innerWidth - menuW - 8, Math.max(8, left));
      menu.style.left = left + 'px';
      let top = r.top;
      if (top + menuH > window.innerHeight - 8) top = r.bottom - menuH;
      top = Math.min(window.innerHeight - menuH - 8, Math.max(8, top));
      menu.style.top = top + 'px';
    }
    menu.querySelectorAll('.ge-fx-menu-item').forEach(btn => {
      const activate = (ev) => {
        activateMenuItem(btn, ev);
      };
      btn.addEventListener('pointerup', activate);
      btn.addEventListener('click', activate);
    });
    // Esc closes the menu, capture-phase + stopPropagation so the
    // gallery modal's own Esc handler doesn't fire too.
    const onKey = (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        closeFxMenu();
        document.removeEventListener('keydown', onKey, true);
      }
    };
    document.addEventListener('keydown', onKey, true);
    menu._escHandler = onKey;
  }

  // Hide an adj popup and drop a chip into the FX dock. Click the chip
  // to restore the popup in its previous position with staged state
  // intact (we do NOT clear staged on minimise).
  function minimiseAdjPopup(pop) {
    if (!pop) return;
    const type = pop._type;
    const r = pop.getBoundingClientRect();
    pop._stashLeft = r.left;
    pop._stashTop  = r.top;
    pop.style.display = 'none';
    if (state.adjPopupEl === pop) state.adjPopupEl = null;
    const popupId = pop._modalId || `ge-fx-popup-${Math.random().toString(36).slice(2, 8)}`;
    pop._modalId = popupId;
    modalManager.register(popupId, {
      label: adjLayerLabel(type),
      icon: ADJ_ICONS[type] || '',
      restoreFn: () => {
        pop.style.left = pop._stashLeft + 'px';
        pop.style.top  = pop._stashTop  + 'px';
        pop.style.display = '';
        if (state.adjPopupEl && state.adjPopupEl !== pop) {
          const other = state.adjPopupEl;
          state.adjPopupEl = other;
          closeAdjPopup();
        }
        state.adjPopupEl = pop;
      },
      closeFn: () => {
        state.adjPopupEl = pop;
        closeAdjPopup();
        modalManager.unregister(popupId);
      },
    });
    modalManager.minimize(popupId);
  }

  // Re-open an existing committed adjustment sub-layer for editing.
  // Pre-loads its params as the staged state; Apply updates in place.
  function editAdjLayer(layer, adj, anchorEl) {
    openAdjPopup(layer, adj.type, anchorEl, adj);
  }

  function closeAdjPopup() {
    if (state.adjPopupEl) {
      suppressLayerGhostTap();
      const layer = state.adjPopupEl._layer;
      if (layer) {
        if (layer._stagedAdj) layer._stagedAdj = null;
        if (layer._editingAdjId) layer._editingAdjId = null;
        layer._adjFinalKey = null;
        composite();
      }
      if (state.adjPopupEl._escHandler) {
        document.removeEventListener('keydown', state.adjPopupEl._escHandler, true);
      }
      if (state.adjPopupEl._modalId) {
        try { modalManager.unregister(state.adjPopupEl._modalId); } catch {}
      }
      state.adjPopupEl.remove();
      state.adjPopupEl = null;
    }
  }

  function openAdjPopup(layer, type, anchorEl, existingAdj) {
    closeAdjPopup();
    // Editing an existing sub-layer? Pre-load its params as the staged
    // preview and mark the popup so Apply updates instead of appending.
    const editing = !!existingAdj;
    const startParams = editing
      ? JSON.parse(JSON.stringify(existingAdj.params))
      : defaultAdjParams(type);
    layer._stagedAdj = { type, params: startParams };
    if (editing) {
      // Hide the existing sub-layer from the render stack so the
      // staged preview shows correctly without doubling the effect.
      layer._editingAdjId = existingAdj.id;
      layer._adjFinalKey = null;
    }
    const pop = document.createElement('div');
    pop.className = 'ge-adj-popup ge-frosted';
    pop.style.zIndex = '10003';
    pop._layer = layer;
    pop._type = type;
    pop._anchorEl = anchorEl;
    pop._existingAdj = existingAdj || null;
    pop.innerHTML = `
    <div class="ge-adj-head" data-adj-drag>
      <span class="ge-adj-icon">${ADJ_ICONS[type] || ''}</span>
      <span class="ge-adj-title">${adjLayerLabel(type)}</span>
      <span class="ge-head-btns">
        <button class="ge-adj-min" type="button" title="Minimise">&minus;</button>
      </span>
    </div>
    <div class="ge-adj-body" data-adj-body></div>
    <div class="ge-adj-foot">
      <button class="ge-btn ge-btn-sm ge-adj-cancel-btn" data-adj-action="cancel">Cancel</button>
      <button class="ge-btn ge-btn-sm ge-btn-primary ge-adj-apply-btn" data-adj-action="ok">Apply</button>
    </div>
    `;
    document.body.appendChild(pop);
    state.adjPopupEl = pop;

    const r = anchorEl?.getBoundingClientRect?.();
    const pw = type === 'color-balance' ? 340 : 320;
    // Prefer right of anchor; fall back to left if no room.
    let left;
    if (r) {
      const rightX = r.right + 8;
      const leftX  = r.left - pw - 8;
      const fitsRight = rightX + pw <= window.innerWidth - 8;
      left = fitsRight ? rightX : Math.max(8, leftX);
    } else {
      left = (window.innerWidth - pw) / 2;
    }
    const top = r ? Math.max(8, r.top - 20) : 60;
    pop.style.left = left + 'px';
    pop.style.top  = top  + 'px';

    const body = pop.querySelector('[data-adj-body]');
    buildAdjBody(layer, type, body, pop);

    pop.querySelector('.ge-adj-close')?.addEventListener('click', closeAdjPopup);
    pop.querySelector('.ge-adj-min')?.addEventListener('click', () => minimiseAdjPopup(pop));
    // Drag by head — anywhere except buttons. Mobile pins via !important
    // rules; setProperty with 'important' lets inline styles win during drag.
    const head = pop.querySelector('[data-adj-drag]');
    if (head) {
      const isMobile = window.matchMedia('(max-width: 820px)').matches;
      const setPos = (x, y) => {
        if (isMobile) {
          pop.style.setProperty('left', x + 'px', 'important');
          pop.style.setProperty('top', y + 'px', 'important');
          pop.style.setProperty('right', 'auto', 'important');
          pop.style.setProperty('bottom', 'auto', 'important');
          pop.style.setProperty('width', 'auto', 'important');
          pop.style.setProperty('max-width', 'calc(100vw - 16px)', 'important');
        } else {
          pop.style.left = x + 'px';
          pop.style.top = y + 'px';
        }
      };
      head.style.touchAction = 'none';
      head.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return;
        e.preventDefault();
        const startX = e.clientX, startY = e.clientY;
        const r0 = pop.getBoundingClientRect();
        head.setPointerCapture(e.pointerId);
        head.style.cursor = 'grabbing';
        const onMove = (ev) => {
          const nx = Math.max(0, Math.min(window.innerWidth - 60, r0.left + (ev.clientX - startX)));
          const ny = Math.max(0, Math.min(window.innerHeight - 30, r0.top  + (ev.clientY - startY)));
          setPos(nx, ny);
        };
        const onUp = () => {
          head.releasePointerCapture(e.pointerId);
          head.style.cursor = '';
          head.removeEventListener('pointermove', onMove);
          head.removeEventListener('pointerup', onUp);
        };
        head.addEventListener('pointermove', onMove);
        head.addEventListener('pointerup', onUp);
      });
    }
    // Esc closes; capture-phase + stopPropagation so the gallery modal's
    // own Esc handler doesn't fire too.
    const onKey = (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        closeAdjPopup();
        document.removeEventListener('keydown', onKey, true);
      }
    };
    document.addEventListener('keydown', onKey, true);
    pop._escHandler = onKey;
    pop.querySelector('[data-adj-action="cancel"]')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeAdjPopup();
    });
    pop.querySelector('[data-adj-action="ok"]')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      suppressLayerGhostTap();
      saveState(editing ? `Edit ${adjLayerLabel(type)}` : `Add ${adjLayerLabel(type)}`);
      const params = layer._stagedAdj.params;
      layer._stagedAdj = null;
      if (editing) {
        const existing = (layer.adjLayers || []).find(a => a.id === existingAdj.id);
        if (existing) existing.params = params;
        layer._editingAdjId = null;
      } else {
        if (!layer.adjLayers) layer.adjLayers = [];
        layer.adjLayers.push({
          id: 'adj-' + Math.random().toString(36).slice(2, 9),
          type,
          name: adjLayerLabel(type),
          visible: true,
          opacity: 1,
          params,
        });
      }
      layer._adjFinalKey = null;
      composite();
      renderLayerPanel();
      closeAdjPopup();
    });
  }

  // rAF-throttled live preview while sliders are dragged.
  function scheduleAdjRefresh(layer) {
    if (state.adjRafPending) return;
    state.adjRafPending = true;
    requestAnimationFrame(() => {
      state.adjRafPending = false;
      layer._adjFinalKey = null;
      composite();
    });
  }

  // Resolve the Levels param object currently being edited. 'rgb' edits the
  // top-level master; 'r'/'g'/'b' edit (and lazily create) a per-channel
  // override under params.channels. Mirrors the selective-color _scFam pattern.
  function activeLevelsParams(layer) {
    const p = layer._stagedAdj.params;
    const ch = layer._levelsCh || 'rgb';
    if (ch === 'rgb') return p;
    if (!p.channels) p.channels = {};
    if (!p.channels[ch]) p.channels[ch] = { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };
    return p.channels[ch];
  }

  function buildAdjBody(layer, type, body, popEl) {
    const p = layer._stagedAdj.params;
    const revertIcon = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
    const sliderRow = (key, label, min, max, value, suffix) => `
      <div class="ge-adj-row" data-adj-key="${key}">
        <label>${label}</label>
        <input type="range" min="${min}" max="${max}" value="${value}" data-key="${key}" />
        <span class="ge-adj-value">${value}${suffix || ''}</span>
        <button class="ge-adj-revert" type="button" title="Reset this slider" data-revert-key="${key}">${revertIcon}</button>
      </div>
    `;
    if (type === 'brightness-contrast') {
      const bSlider = Math.round((p.brightness - 1) * 100);
      const cSlider = Math.round((p.contrast - 1) * 100);
      body.innerHTML = `
      ${sliderRow('brightness', 'Brightness', -100, 100, bSlider, '')}
      ${sliderRow('contrast',   'Contrast',   -100, 100, cSlider, '')}
    `;
    } else if (type === 'hue-saturation') {
      // Master (global hue/saturation) + per-hue ranges (Reds…Magentas), each
      // with Hue/Saturation/Lightness. The selector swaps the slider set.
      const HSR = [['master', 'Master'], ['reds', 'Reds'], ['yellows', 'Yellows'], ['greens', 'Greens'], ['cyans', 'Cyans'], ['blues', 'Blues'], ['magentas', 'Magentas']];
      const cur = layer._hsRange || 'master';
      const selHtml = `<div class="ge-adj-row" style="align-items:center;gap:8px;"><label>Range</label>
        <select class="ge-hs-range ge-tool-select" style="flex:1;min-width:0;">
          ${HSR.map(([k, lbl]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${lbl}</option>`).join('')}
        </select></div>`;
      if (cur === 'master') {
        body.innerHTML = selHtml +
          sliderRow('hue',        'Hue',        -180, 180, Math.round(p.hue), ' °') +
          sliderRow('saturation', 'Saturation', -100, 100, Math.round((p.saturation - 1) * 100), '');
      } else {
        if (!p.ranges) p.ranges = {};
        const rv = p.ranges[cur] || { hue: 0, saturation: 0, lightness: 0 };
        body.innerHTML = selHtml +
          sliderRow('hue',        'Hue',        -180, 180, Math.round(rv.hue || 0), ' °') +
          sliderRow('saturation', 'Saturation', -100, 100, Math.round(rv.saturation || 0), '') +
          sliderRow('lightness',  'Lightness',  -100, 100, Math.round(rv.lightness || 0), '');
      }
      body.querySelector('.ge-hs-range')?.addEventListener('change', (e) => {
        layer._hsRange = e.target.value; body.innerHTML = ''; buildAdjBody(layer, type, body, popEl);
      });
    } else if (type === 'levels') {
      // Histogram canvas + sliders. Histogram is computed from the
      // layer's pixel data (after any adjLayers below this one) so
      // the user is matching levels against what they're really seeing.
      // <details> wrapper is collapsed by default on mobile to save
      // vertical space; open by default on desktop.
      const isMobile = window.matchMedia('(max-width: 820px)').matches;
      // Per-channel Levels: RGB master + independent Red/Green/Blue. The
      // selector swaps which param set the sliders/handles/histogram edit.
      const chans = [['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']];
      const curCh = layer._levelsCh || 'rgb';
      const lp = activeLevelsParams(layer);
      body.innerHTML = `
      <div class="ge-adj-row" style="align-items:center;gap:8px;"><label>Channel</label>
        <select class="ge-levels-ch ge-tool-select" style="flex:1;min-width:0;">
          ${chans.map(([k, lbl]) => `<option value="${k}"${k === curCh ? ' selected' : ''}>${lbl}</option>`).join('')}
        </select></div>
      <details class="ge-adj-hist-details"${isMobile ? '' : ' open'}>
        <summary>Histogram</summary>
        <div class="ge-adj-hist-wrap">
          <canvas class="ge-adj-histogram" width="280" height="80"></canvas>
          <div class="ge-adj-hist-handles">
            <div class="ge-adj-hist-handle hist-h-black"  data-handle="inBlack"  title="Input black — drag"></div>
            <div class="ge-adj-hist-handle hist-h-gamma"  data-handle="gamma"    title="Gamma — drag"></div>
            <div class="ge-adj-hist-handle hist-h-white"  data-handle="inWhite"  title="Input white — drag"></div>
          </div>
        </div>
      </details>
      ${sliderRow('inBlack',  'Input black',  0, 254, lp.inBlack, '')}
      ${sliderRow('inWhite',  'Input white',  1, 255, lp.inWhite, '')}
      ${sliderRow('gamma',    'Gamma',        10, 990, Math.round((lp.gamma || 1) * 100), 'γ')}
      ${sliderRow('outBlack', 'Output black', 0, 255, lp.outBlack, '')}
      ${sliderRow('outWhite', 'Output white', 0, 255, lp.outWhite, '')}
    `;
      body.querySelector('.ge-levels-ch')?.addEventListener('change', (e) => {
        layer._levelsCh = e.target.value; body.innerHTML = ''; buildAdjBody(layer, type, body, popEl);
      });
      const hist = body.querySelector('.ge-adj-histogram');
      drawHistogram(hist, layer, curCh);
      wireHistogramHandles(body, layer, type);
      // Redraw histogram when the user opens the disclosure (canvas
      // dimensions are layout-dependent).
      body.querySelector('.ge-adj-hist-details')?.addEventListener('toggle', (e) => {
        if (e.target.open) drawHistogram(hist, layer, layer._levelsCh || 'rgb');
      });
    } else if (type === 'curves') {
      // Draggable tone curve. Master "RGB" plus per-channel R/G/B, like a
      // standard curves editor. Points live in p[channel] as [in,out] pairs.
      const ch = p.channel || 'rgb';
      body.innerHTML = `
      <div class="ge-adj-row" style="align-items:center;gap:8px;">
        <label>Channel</label>
        <select class="ge-adj-curve-channel ge-tool-select" style="flex:1;min-width:0;">
          <option value="rgb">RGB</option>
          <option value="r">Red</option>
          <option value="g">Green</option>
          <option value="b">Blue</option>
        </select>
        <button class="ge-btn ge-btn-sm ge-adj-curve-reset" type="button" title="Reset this channel to a straight line">Reset</button>
      </div>
      <canvas class="ge-adj-curve" width="256" height="256" style="display:block;margin:8px auto 2px;width:228px;height:228px;border-radius:6px;cursor:crosshair;background:rgba(0,0,0,0.16);touch-action:none;"></canvas>
      <p style="font-size:10px;opacity:0.55;margin:2px 0 0;text-align:center;">Click to add a point · drag to bend · double-click or drag out to delete</p>
    `;
      const drawCurve = wireCurveEditor(body, layer);
      const sel = body.querySelector('.ge-adj-curve-channel');
      if (sel) {
        sel.value = ch;
        sel.addEventListener('change', () => {
          layer._stagedAdj.params.channel = sel.value;
          drawCurve();
        });
      }
      body.querySelector('.ge-adj-curve-reset')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const cur = layer._stagedAdj.params.channel || 'rgb';
        layer._stagedAdj.params[cur] = [[0, 0], [255, 255]];
        layer._adjFinalKey = null;
        composite();
        drawCurve();
      });
      drawCurve();
    } else if (type === 'color-balance') {
      // Color-tinted slider ends so the user sees what direction does what.
      const cbRow = (key, leftCol, rightCol, label, value) => `
      <div class="ge-adj-row ge-adj-cb-row" data-adj-key="${key}">
        <span class="ge-adj-cb-dot" style="background:${leftCol}"></span>
        <input type="range" min="-100" max="100" value="${value}" data-key="${key}" />
        <span class="ge-adj-cb-dot" style="background:${rightCol}"></span>
        <span class="ge-adj-value">${value}</span>
        <button class="ge-adj-revert" type="button" title="Reset this slider" data-revert-key="${key}">${revertIcon}</button>
      </div>
    `;
      // Tone picker: one tone group visible at a time. Remember the
      // last picked tone on the popup so re-renders (revert button
      // etc.) keep it.
      const tone = popEl._cbTone || 'shadows';
      popEl._cbTone = tone;
      const toneSliders = (t) => `
      ${cbRow(`${t}-r`, '#00d2d2', '#ff5555', 'Cyan ↔ Red',      p[t].r)}
      ${cbRow(`${t}-g`, '#d855d8', '#55d855', 'Magenta ↔ Green', p[t].g)}
      ${cbRow(`${t}-b`, '#e6e64a', '#4a78ff', 'Yellow ↔ Blue',   p[t].b)}
    `;
      body.innerHTML = `
      <div class="ge-adj-cb-tone-picker">
        <select class="ge-adj-cb-tone-select">
          <option value="shadows"${tone === 'shadows' ? ' selected' : ''}>Shadows</option>
          <option value="midtones"${tone === 'midtones' ? ' selected' : ''}>Midtones</option>
          <option value="highlights"${tone === 'highlights' ? ' selected' : ''}>Highlights</option>
        </select>
      </div>
      <div class="ge-adj-cb-sliders" data-cb-tone="${tone}">
        ${toneSliders(tone)}
      </div>
    `;
      body.querySelector('.ge-adj-cb-tone-select')?.addEventListener('change', (e) => {
        popEl._cbTone = e.target.value;
        body.innerHTML = '';
        buildAdjBody(layer, type, body, popEl);
      });
    } else if (type === 'vibrance') {
      body.innerHTML = sliderRow('amount', 'Vibrance', -100, 100, Math.round(p.amount || 0), '');
    } else if (type === 'exposure') {
      body.innerHTML = sliderRow('exposure', 'Exposure', -100, 100, Math.round(p.exposure || 0), '');
    } else if (type === 'posterize') {
      body.innerHTML = sliderRow('levels', 'Levels', 2, 32, Math.round(p.levels || 4), '');
    } else if (type === 'threshold') {
      body.innerHTML = sliderRow('level', 'Threshold', 1, 255, Math.round(p.level || 128), '');
    } else if (type === 'photo-filter') {
      body.innerHTML = `
      <div class="ge-adj-row" style="align-items:center;gap:8px;">
        <label>Color</label>
        <input type="color" class="ge-adj-color" data-color-key="color" value="${p.color || '#ec8a00'}" style="width:34px;height:24px;padding:0;border:1px solid var(--border);border-radius:4px;background:none;" />
      </div>
      ${sliderRow('density', 'Density', 0, 100, Math.round(p.density || 25), '%')}`;
    } else if (type === 'gradient-map') {
      body.innerHTML = `
      <div class="ge-adj-row" style="align-items:center;gap:8px;">
        <label>Shadows</label>
        <input type="color" class="ge-adj-color" data-color-key="lo" value="${p.lo || '#000000'}" style="width:34px;height:24px;padding:0;border:1px solid var(--border);border-radius:4px;background:none;" />
        <label style="margin-left:auto;">Highlights</label>
        <input type="color" class="ge-adj-color" data-color-key="hi" value="${p.hi || '#ffffff'}" style="width:34px;height:24px;padding:0;border:1px solid var(--border);border-radius:4px;background:none;" />
      </div>`;
    } else if (type === 'shadows-highlights') {
      body.innerHTML =
        sliderRow('shadows', 'Shadows', 0, 100, Math.round(p.shadows || 0), '') +
        sliderRow('highlights', 'Highlights', 0, 100, Math.round(p.highlights || 0), '') +
        sliderRow('radius', 'Radius', 0, 200, Math.round(p.radius || 0), '');
    } else if (type === 'vignette') {
      body.innerHTML =
        sliderRow('amount', 'Amount', -100, 100, Math.round(p.amount || 0), '') +
        sliderRow('midpoint', 'Midpoint', 0, 100, Math.round(p.midpoint ?? 50), '') +
        sliderRow('roundness', 'Roundness', -100, 100, Math.round(p.roundness || 0), '') +
        sliderRow('feather', 'Feather', 0, 100, Math.round(p.feather ?? 50), '');
    } else if (type === 'clarity') {
      body.innerHTML = sliderRow('amount', 'Clarity', -100, 100, Math.round(p.amount || 0), '');
    } else if (type === 'chromatic-aberration') {
      body.innerHTML = sliderRow('amount', 'Amount', 0, 20, Math.round(p.amount || 0), '');
    } else if (type === 'lens-distortion') {
      body.innerHTML = sliderRow('amount', 'Amount', -100, 100, Math.round(p.amount || 0), '');
    } else if (type === 'color-lookup') {
      const loaded = p.lutId && hasLut(p.lutId);
      body.innerHTML =
        `<div class="ge-adj-row" style="gap:var(--ge-s3,6px);">
           <button type="button" class="ge-btn ge-btn-sm ge-cl-load">Load .cube…</button>
           <span class="ge-cl-name" style="font-size:var(--ge-fs-hint,10px);opacity:var(--ge-op-mid,0.7);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${loaded ? (p.lutName || 'LUT loaded') : 'No LUT loaded'}</span>
           <input type="file" class="ge-cl-file" accept=".cube,.CUBE" style="display:none" />
         </div>` +
        sliderRow('amount', 'Amount', 0, 100, Math.round(p.amount == null ? 100 : p.amount), '');
      const fileEl = body.querySelector('.ge-cl-file');
      body.querySelector('.ge-cl-load')?.addEventListener('click', () => fileEl && fileEl.click());
      fileEl?.addEventListener('change', async (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        try {
          const text = await f.text();
          const name = f.name.replace(/\.[^.]+$/, '');
          const id = registerCube(text, { name });
          if (id) {
            p.lutId = id; p.lutName = name; layer._adjFinalKey = null;
            body.innerHTML = ''; buildAdjBody(layer, type, body, popEl); scheduleAdjRefresh(layer);
          } else {
            const nm = body.querySelector('.ge-cl-name');
            if (nm) nm.textContent = 'Could not parse .cube';
          }
        } catch (err) { console.warn('[color-lookup] LUT load failed', err); }
      });
    } else if (type === 'grain') {
      body.innerHTML = sliderRow('amount', 'Amount', 0, 100, Math.round(p.amount || 0), '%');
    } else if (type === 'channel-mixer') {
      const out = p.mono ? 'gray' : (popEl._cmOut || 'r');
      popEl._cmOut = out;
      const o = p[out];
      body.innerHTML = `
      <label style="display:flex;align-items:center;gap:6px;margin:2px 2px 6px;cursor:pointer;font-size:11px;"><input type="checkbox" class="ge-cm-mono" ${p.mono ? 'checked' : ''}> Monochrome</label>
      ${p.mono ? '' : `<div class="ge-adj-row" style="align-items:center;gap:8px;"><label>Output</label>
        <select class="ge-cm-out ge-tool-select" style="flex:1;min-width:0;">
          <option value="r"${out === 'r' ? ' selected' : ''}>Red</option>
          <option value="g"${out === 'g' ? ' selected' : ''}>Green</option>
          <option value="b"${out === 'b' ? ' selected' : ''}>Blue</option>
        </select></div>`}
      ${sliderRow(out + '-r', 'Red',   -200, 200, o.r, '%')}
      ${sliderRow(out + '-g', 'Green', -200, 200, o.g, '%')}
      ${sliderRow(out + '-b', 'Blue',  -200, 200, o.b, '%')}`;
      body.querySelector('.ge-cm-mono')?.addEventListener('change', (e) => {
        layer._stagedAdj.params.mono = e.target.checked;
        popEl._cmOut = e.target.checked ? 'gray' : 'r';
        layer._adjFinalKey = null; body.innerHTML = ''; buildAdjBody(layer, type, body, popEl); scheduleAdjRefresh(layer);
      });
      body.querySelector('.ge-cm-out')?.addEventListener('change', (e) => {
        popEl._cmOut = e.target.value; body.innerHTML = ''; buildAdjBody(layer, type, body, popEl);
      });
    } else if (type === 'selective-color') {
      const fam = layer._scFam || 'reds';
      layer._scFam = fam;
      const f = p[fam] || { c: 0, m: 0, y: 0, k: 0 };
      const FAMS = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas', 'whites', 'neutrals', 'blacks'];
      body.innerHTML = `
      <div class="ge-adj-row" style="align-items:center;gap:8px;"><label>Colors</label>
        <select class="ge-sc-fam ge-tool-select" style="flex:1;min-width:0;">
          ${FAMS.map((k) => `<option value="${k}"${k === fam ? ' selected' : ''}>${k[0].toUpperCase() + k.slice(1)}</option>`).join('')}
        </select></div>
      ${sliderRow('c', 'Cyan',    -100, 100, Math.round(f.c * 100), '%')}
      ${sliderRow('m', 'Magenta', -100, 100, Math.round(f.m * 100), '%')}
      ${sliderRow('y', 'Yellow',  -100, 100, Math.round(f.y * 100), '%')}
      ${sliderRow('k', 'Black',   -100, 100, Math.round(f.k * 100), '%')}
      <label style="display:flex;align-items:center;gap:6px;margin:6px 2px;font-size:11px;cursor:pointer;"><input type="checkbox" class="ge-sc-rel" ${p.relative !== false ? 'checked' : ''}> Relative</label>`;
      body.querySelector('.ge-sc-fam')?.addEventListener('change', (e) => {
        layer._scFam = e.target.value; body.innerHTML = ''; buildAdjBody(layer, type, body, popEl);
      });
      body.querySelector('.ge-sc-rel')?.addEventListener('change', (e) => {
        p.relative = e.target.checked; layer._adjFinalKey = null; scheduleAdjRefresh(layer);
      });
    } else {
      // Parameter-free adjustments (Invert, Black & White): nothing to tweak.
      body.innerHTML = '<p style="font-size:11px;opacity:0.6;margin:4px 2px;">No options. Click Apply to add this adjustment — blend with the layer opacity or delete it from the layer panel.</p>';
    }
    // Wire colour inputs (photo-filter / gradient-map) → staged params.
    body.querySelectorAll('.ge-adj-color').forEach((ci) => {
      ci.addEventListener('input', () => {
        layer._stagedAdj.params[ci.dataset.colorKey] = ci.value;
        layer._adjFinalKey = null;
        scheduleAdjRefresh(layer);
      });
    });
    // Wire all sliders.
    body.querySelectorAll('input[type="range"]').forEach(sl => {
      sl.addEventListener('input', () => onAdjSliderInput(layer, type, sl));
    });
    // Per-slider revert buttons.
    body.querySelectorAll('.ge-adj-revert').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = btn.dataset.revertKey;
        revertAdjKey(layer, type, key);
        // Rebuild body so values + histogram refresh.
        body.innerHTML = '';
        buildAdjBody(layer, type, body, popEl);
      });
    });
  }

  // Reset a single slider key back to identity. Updates staged params
  // and triggers a composite refresh.
  function revertAdjKey(layer, type, key) {
    const defaults = defaultAdjParams(type);
    const p = layer._stagedAdj.params;
    if (type === 'brightness-contrast') {
      p[key] = defaults[key];
    } else if (type === 'hue-saturation') {
      const rng = layer._hsRange || 'master';
      if (rng === 'master') p[key] = defaults[key];
      else if (p.ranges && p.ranges[rng]) p.ranges[rng][key] = 0;
    } else if (type === 'levels') {
      activeLevelsParams(layer)[key] = defaults[key];
    } else if (type === 'color-balance') {
      const [tone, ch] = key.split('-');
      p[tone][ch] = defaults[tone][ch];
    } else if (type === 'selective-color') {
      const fam = layer._scFam || 'reds';
      if (p[fam]) p[fam][key] = 0;
    } else if (type === 'channel-mixer') {
      const [out, ch] = key.split('-');
      const def = (defaults && defaults[out]) || {};
      if (p[out]) p[out][ch] = def[ch] != null ? def[ch] : 0;
    } else if (defaults && key in defaults) {
      // Flat-param adjustments (vibrance/exposure/shadows-highlights/vignette/
      // clarity/chromatic-aberration/lens-distortion/…) revert to their default.
      p[key] = defaults[key];
    }
    layer._adjFinalKey = null;
    composite();
  }

  function onAdjSliderInput(layer, type, sl) {
    const key = sl.dataset.key;
    const raw = parseInt(sl.value, 10);
    const valEl = sl.parentElement.querySelector('.ge-adj-value');
    const p = layer._stagedAdj.params;
    let display = String(raw);
    if (type === 'brightness-contrast') {
      if (key === 'brightness' || key === 'contrast') p[key] = 1 + raw / 100;
    } else if (type === 'hue-saturation') {
      const rng = layer._hsRange || 'master';
      if (rng === 'master') {
        if (key === 'saturation') p.saturation = 1 + raw / 100;
        else if (key === 'hue') { p.hue = raw; display = raw + ' °'; }
      } else {
        if (!p.ranges) p.ranges = {};
        if (!p.ranges[rng]) p.ranges[rng] = { hue: 0, saturation: 0, lightness: 0 };
        p.ranges[rng][key] = raw;
        if (key === 'hue') display = raw + ' °';
      }
    } else if (type === 'levels') {
      const lp = activeLevelsParams(layer);
      if (key === 'gamma') {
        lp.gamma = raw / 100; display = (raw / 100).toFixed(2) + 'γ';
      } else {
        lp[key] = raw;
      }
    } else if (type === 'color-balance') {
      const [tone, ch] = key.split('-');
      p[tone][ch] = raw;
    } else if (type === 'selective-color') {
      const fam = layer._scFam || 'reds';
      if (!p[fam]) p[fam] = { c: 0, m: 0, y: 0, k: 0 };
      p[fam][key] = raw / 100; display = raw + '%';
    } else if (type === 'channel-mixer') {
      // keys are 'r-r'|'r-g'|...|'gray-b' — write into the per-output {r,g,b} object
      // pixel-pass reads, not a junk flat key.
      const [out, ch] = key.split('-');
      if (!p[out]) p[out] = { r: 0, g: 0, b: 0 };
      p[out][ch] = raw; display = raw + '%';
    } else {
      // vibrance/exposure/posterize/threshold/photo-filter density: 1:1 numeric.
      p[key] = raw;
      if (key === 'density') display = raw + '%';
    }
    if (valEl) valEl.textContent = display;
    scheduleAdjRefresh(layer);
  }

  // Position the three histogram triangle handles by current staged
  // values + wire pointer drags.
  function wireHistogramHandles(bodyEl, layer, type) {
    const wrap = bodyEl.querySelector('.ge-adj-hist-wrap');
    const canvas = bodyEl.querySelector('.ge-adj-histogram');
    if (!wrap || !canvas) return;
    const handles = bodyEl.querySelectorAll('.ge-adj-hist-handle');
    const placeHandles = () => {
      const w = canvas.getBoundingClientRect().width;
      const p = activeLevelsParams(layer);
      const xB = (p.inBlack  / 255) * w;
      const xW = (p.inWhite  / 255) * w;
      // Gamma handle sits at a fraction of the (xB..xW) span, mapped
      // from gamma's log scale (1 = midpoint, 0.1 = far right, 10 = far left).
      const gammaT = 1 - (Math.log(p.gamma || 1) / Math.log(10) * 0.5 + 0.5);
      const xG = xB + (xW - xB) * gammaT;
      const set = (sel, x) => {
        const el = bodyEl.querySelector(sel);
        if (el) el.style.left = (x - 6) + 'px';
      };
      set('.hist-h-black', xB);
      set('.hist-h-gamma', xG);
      set('.hist-h-white', xW);
    };
    placeHandles();
    handles.forEach(h => {
      h.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        h.setPointerCapture(e.pointerId);
        const which = h.dataset.handle;
        const rect = canvas.getBoundingClientRect();
        const onMove = (ev) => {
          const x = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
          const v = Math.round((x / rect.width) * 255);
          const p = activeLevelsParams(layer);
          if (which === 'inBlack') {
            p.inBlack = Math.min(p.inWhite - 1, v);
          } else if (which === 'inWhite') {
            p.inWhite = Math.max(p.inBlack + 1, v);
          } else if (which === 'gamma') {
            const xB = (p.inBlack / 255) * rect.width;
            const xW = (p.inWhite / 255) * rect.width;
            const span = Math.max(1, xW - xB);
            let t = (x - xB) / span;
            t = Math.max(0.01, Math.min(0.99, t));
            // Invert the placeHandles mapping: t = 1 - (log10(g)*0.5+0.5).
            const log10g = -((t - 0.5) * 2);
            p.gamma = Math.pow(10, log10g);
          }
          placeHandles();
          // Update visible slider rows + value labels.
          const updateRow = (key, displayVal) => {
            const sl = bodyEl.querySelector(`input[type="range"][data-key="${key}"]`);
            if (sl) sl.value = String(key === 'gamma' ? Math.round(p.gamma * 100) : p[key]);
            const val = sl?.parentElement.querySelector('.ge-adj-value');
            if (val) val.textContent = displayVal;
          };
          if (which === 'inBlack') updateRow('inBlack', String(p.inBlack));
          if (which === 'inWhite') updateRow('inWhite', String(p.inWhite));
          if (which === 'gamma')   updateRow('gamma',   p.gamma.toFixed(2) + 'γ');
          drawHistogram(canvas, layer, layer._levelsCh || 'rgb');
          scheduleAdjRefresh(layer);
        };
        const onUp = () => {
          h.releasePointerCapture(e.pointerId);
          h.removeEventListener('pointermove', onMove);
          h.removeEventListener('pointerup', onUp);
        };
        h.addEventListener('pointermove', onMove);
        h.addEventListener('pointerup', onUp);
      });
    });
  }

  // Curve editor — a draggable tone-curve canvas. Mutates the staged params
  // for the active channel and previews live. Returns its redraw function.
  function wireCurveEditor(body, layer) {
    const canvas = body.querySelector('.ge-adj-curve');
    if (!canvas) return () => {};
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const HIT = 13;
    const toCanvas = (x, y) => [(x / 255) * W, H - (y / 255) * H];
    const evtXY = (e) => {
      const rect = canvas.getBoundingClientRect();
      return [(e.clientX - rect.left) * (W / rect.width), (e.clientY - rect.top) * (H / rect.height)];
    };
    const fromCanvas = (cx, cy) => [
      Math.round(clampV((cx / W) * 255, 0, 255)),
      Math.round(clampV(255 - (cy / H) * 255, 0, 255)),
    ];
    const curPts = () => { const p = layer._stagedAdj.params; return p[p.channel || 'rgb']; };

    function draw() {
      const p = layer._stagedAdj.params;
      const ch = p.channel || 'rgb';
      const pts = p[ch];
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(255,255,255,0.09)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < 4; i++) {
        const gx = (i / 4) * W; ctx.moveTo(gx, 0); ctx.lineTo(gx, H);
        const gy = (i / 4) * H; ctx.moveTo(0, gy); ctx.lineTo(W, gy);
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(W, 0); ctx.stroke();
      const lut = buildCurveLUT(pts);
      const col = ch === 'r' ? '#ff6b6b' : ch === 'g' ? '#5ed98a' : ch === 'b' ? '#6ba8ff' : '#e8e8e8';
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath();
      for (let v = 0; v < 256; v++) {
        const cx = (v / 255) * W, cy = H - (lut[v] / 255) * H;
        if (v === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
      }
      ctx.stroke();
      for (const pt of pts) {
        const [cx, cy] = toCanvas(pt[0], pt[1]);
        ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fillStyle = col; ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.lineWidth = 1; ctx.stroke();
      }
    }

    let dragIdx = -1;
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const [cx, cy] = evtXY(e);
      const pts = curPts();
      let best = -1, bestD = HIT * HIT;
      for (let i = 0; i < pts.length; i++) {
        const [px, py] = toCanvas(pts[i][0], pts[i][1]);
        const dd = (px - cx) * (px - cx) + (py - cy) * (py - cy);
        if (dd < bestD) { bestD = dd; best = i; }
      }
      if (best >= 0) {
        dragIdx = best;
      } else {
        const [nx, ny] = fromCanvas(cx, cy);
        pts.push([nx, ny]);
        pts.sort((a, b) => a[0] - b[0]);
        dragIdx = pts.findIndex((pp) => pp[0] === nx && pp[1] === ny);
        layer._adjFinalKey = null; scheduleAdjRefresh(layer);
      }
      try { canvas.setPointerCapture(e.pointerId); } catch {}
      draw();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (dragIdx < 0) return;
      e.preventDefault();
      const [cx, cy] = evtXY(e);
      const pts = curPts();
      const n = pts.length;
      const isFirst = dragIdx === 0, isLast = dragIdx === n - 1;
      if (!isFirst && !isLast && (cy < -18 || cy > H + 18)) {
        pts.splice(dragIdx, 1);
        dragIdx = -1;
        layer._adjFinalKey = null; scheduleAdjRefresh(layer); draw();
        return;
      }
      let [nx, ny] = fromCanvas(cx, cy);
      if (isFirst) nx = 0;
      else if (isLast) nx = 255;
      else nx = clampV(nx, pts[dragIdx - 1][0] + 1, pts[dragIdx + 1][0] - 1);
      pts[dragIdx] = [nx, ny];
      layer._adjFinalKey = null; scheduleAdjRefresh(layer); draw();
    });
    const endDrag = (e) => {
      if (dragIdx >= 0) { try { canvas.releasePointerCapture(e.pointerId); } catch {} dragIdx = -1; }
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('dblclick', (e) => {
      e.preventDefault(); e.stopPropagation();
      const [cx, cy] = evtXY(e);
      const pts = curPts();
      let best = -1, bestD = HIT * HIT;
      for (let i = 0; i < pts.length; i++) {
        const [px, py] = toCanvas(pts[i][0], pts[i][1]);
        const dd = (px - cx) * (px - cx) + (py - cy) * (py - cy);
        if (dd < bestD) { bestD = dd; best = i; }
      }
      if (best > 0 && best < pts.length - 1) {
        pts.splice(best, 1);
        layer._adjFinalKey = null; composite(); draw();
      }
    });
    return draw;
  }

  // Legacy sidebar-FX panel sync — FX now lives in a per-layer popup;
  // stubbed so any stale callers don't error.
  function syncFxPanelToActiveLayerIfPresent() { /* no-op */ }

  return {
    openFxPopup, openAdjPopup, editAdjLayer,
    closeFxPopup, closeFxMenu, closeAdjPopup,
    ensureFxDock, ensureAdjustments,
    syncFxPanelToActiveLayerIfPresent,
    minimiseAdjPopup,
  };
}
