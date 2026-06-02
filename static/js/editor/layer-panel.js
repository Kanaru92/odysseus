/**
 * Layer panel renderer — rebuilds the right-side layer list from
 * `state.layers` every time it's called. The full row tree per layer:
 *
 *   parent row
 *     [drag handle] [eye] [name] [opacity slider] [FX] [dup] [mask] [merge-down] [×]
 *   adjustment sub-rows (FX entries)
 *     [eye] [name+icon] [opacity slider] [merge] [×]
 *   mask sub-rows
 *     [eye] [name] [merge-up?] [×]
 *
 * Reads/writes shared `state` directly (layers, activeLayerId,
 * layerOffsets, imgWidth, imgHeight, lassoPoints/lassoActive,
 * wandMask, maskCanvas/maskCtx, nextLayerId). Function deps are
 * orchestration callbacks still living in galleryEditor.js.
 *
 * Returns `{ render }` so the recursive self-call works via closure
 * over `render` rather than module-state lookup.
 *
 * @param {{
 *   composite:                       () => void,
 *   saveState:                       (label?: string) => void,
 *   showLayerThumb:                  (rowEl: HTMLElement, layer: object) => void,
 *   hideLayerThumb:                  () => void,
 *   loadLayerAlphaAsSelection:       (layer: object) => void,
 *   openFxPopup:                     (layer: object, anchor: HTMLElement) => void,
 *   editAdjLayer:                    (layer: object, adj: object, anchor: HTMLElement) => void,
 *   createLayer:                     (name: string, w: number, h: number) => object,
 *   lassoToMask:                     () => void,
 *   wandToMask:                      () => void,
 *   getActiveMaskLayer:              () => object | null,
 *   syncFxPanelToActiveLayerIfPresent: () => void,
 *   dragSortModule:                  object | null,
 *   uiModule:                        object | null,
 * }} deps
 */
import { state } from './state.js';
import {
  isLayerEmpty,
  isMaskCanvasEmpty,
  adjLayerLabel,
  ADJ_ICONS,
} from './layer-helpers.js';
import { applyAdjustment } from './fx/pixel-pass.js';
import { BLEND_MODES } from './blend-modes.js';

const EYE_OPEN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF  = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><line x1="8" y1="16" x2="16" y2="8"/><line x1="8" y1="8" x2="16" y2="16"/></svg>';
const EYE_OPEN_SM = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_SM  = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><line x1="8" y1="16" x2="16" y2="8"/><line x1="8" y1="8" x2="16" y2="16"/></svg>';

export function createLayerPanelRenderer(deps) {
  const {
    composite, saveState, showLayerThumb, hideLayerThumb,
    loadLayerAlphaAsSelection, openFxPopup, editAdjLayer,
    createLayer, lassoToMask, wandToMask, getActiveMaskLayer,
    syncFxPanelToActiveLayerIfPresent,
    dragSortModule, uiModule,
  } = deps;

  function shouldIgnoreLayerTap() {
    return Date.now() < (window.__geSuppressLayerTapUntil || 0);
  }

  // Inline layer preview (PS-style): a small thumbnail of the layer's pixels
  // over a checkerboard so transparency reads. Layer canvases are document-
  // sized, so a straight fit-draw is faithful. Regenerated per render (cheap at
  // this size); the row stays a fixed height.
  function layerThumb(layer) {
    const W = 34;
    const aspect = (state.imgWidth && state.imgHeight) ? state.imgHeight / state.imgWidth : 1;
    let H = Math.round(W * aspect);
    H = Math.max(10, Math.min(30, H));
    const box = document.createElement('canvas');
    box.width = W; box.height = H;
    box.className = 'ge-row-thumb';
    box.style.cssText = `width:${W}px;height:${H}px;border:1px solid rgba(255,255,255,0.22);border-radius:2px;flex-shrink:0;margin:0 2px;`;
    const c = box.getContext('2d');
    const s = 5; // checkerboard
    for (let y = 0; y < H; y += s) for (let x = 0; x < W; x += s) { c.fillStyle = (((x / s) + (y / s)) & 1) ? '#9a9a9a' : '#cfcfcf'; c.fillRect(x, y, s, s); }
    try {
      if (layer.canvas && layer.canvas.width && layer.canvas.height) {
        c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
        c.drawImage(layer.canvas, 0, 0, layer.canvas.width, layer.canvas.height, 0, 0, W, H);
      }
    } catch {}
    return box;
  }

  // ── Panel-header blend + opacity (PS layout) ──────────────────────────
  // These live in the header and act on the ACTIVE layer (or group), replacing
  // the old per-row controls. Wired once; values synced each render.
  let _headerWired = false;
  function _activeLayerOrGroup() {
    return state.layers.find((l) => l.id === state.activeLayerId) || null;
  }
  function wireHeaderProps() {
    if (_headerWired) return;
    const blend = document.getElementById('ge-active-blend');
    const op = document.getElementById('ge-active-opacity');
    if (!blend || !op) return; // header not built yet
    _headerWired = true;
    blend.innerHTML = BLEND_MODES.map((b) => `<option value="${b.id}">${b.name}</option>`).join('');
    blend.addEventListener('change', () => {
      const l = _activeLayerOrGroup();
      if (!l || l.isGroup) return;
      l.blendMode = blend.value;
      composite();
    });
    op.addEventListener('input', () => {
      const l = _activeLayerOrGroup();
      if (!l) return;
      l.opacity = parseInt(op.value, 10) / 100;
      const v = document.getElementById('ge-active-opacity-val');
      if (v) v.textContent = op.value + '%';
      composite();
    });

    // Header Group (folder) + Delete (trash) — PS layers-panel footer parity.
    // Act on the active layer; mirror the Ctrl+G / per-row × logic so all three
    // entry points stay consistent.
    const groupBtn = document.getElementById('ge-group-layer');
    groupBtn?.addEventListener('click', () => {
      const l = _activeLayerOrGroup();
      if (!l) { uiModule?.showToast?.('Select a layer first'); return; }
      if (l.isGroup) { uiModule?.showToast?.('Already a group'); return; }
      saveState('Group layer');
      const ngroups = state.layers.filter((x) => x.isGroup).length;
      const grp = {
        id: 'group-' + (state.nextLayerId++),
        name: 'Group ' + (ngroups + 1),
        isGroup: true, visible: true, opacity: 1, collapsed: false,
      };
      l.groupId = grp.id;
      const idx = state.layers.findIndex((x) => x.id === l.id);
      state.layers.splice(idx + 1, 0, grp); // folder sits above its member
      composite();
      render();
      uiModule?.showToast?.('Grouped into "' + grp.name + '"');
    });
    const delBtn = document.getElementById('ge-del-layer');
    delBtn?.addEventListener('click', async () => {
      const l = _activeLayerOrGroup();
      if (!l) return;
      if (state.layers.length <= 1) { uiModule?.showToast?.('Can’t delete the only layer'); return; }
      const i = state.layers.findIndex((x) => x.id === l.id);
      if (i < 0) return;
      if (l.isBase && uiModule?.styledConfirm) {
        const ok = await uiModule.styledConfirm(
          'Delete the original photo layer? Ctrl+Z brings it back.',
          { confirmText: 'Delete', cancelText: 'Cancel', danger: true }
        );
        if (!ok) return;
      }
      saveState(`Delete layer "${l.name}"`);
      // Deleting a group folder also drops its members from the stack.
      if (l.isGroup) {
        state.layers = state.layers.filter((x) => x.groupId !== l.id && x.id !== l.id);
      } else {
        state.layers.splice(i, 1);
      }
      state.layerOffsets.delete(l.id);
      if (!state.layers.some((x) => x.id === state.activeLayerId)) {
        const survivor = state.layers.find((x) => !x.isGroup) || state.layers[0];
        state.activeLayerId = survivor ? survivor.id : null;
      }
      composite();
      render();
    });

    // Duplicate — clones pixels + offset + opacity + visibility + masks +
    // adjLayers (+ smart-object source) of the ACTIVE layer; inserts the copy
    // above the original and makes it active. Ported from the old per-row
    // button so behaviour is identical.
    const dupBtn = document.getElementById('ge-dup-layer');
    dupBtn?.addEventListener('click', () => {
      const layer = _activeLayerOrGroup();
      if (!layer) { uiModule?.showToast?.('Select a layer first'); return; }
      if (layer.isGroup) { uiModule?.showToast?.('Can’t duplicate a group'); return; }
      saveState(`Duplicate "${layer.name}"`);
      const copy = createLayer(layer.name + ' copy', layer.canvas.width, layer.canvas.height);
      copy.ctx.drawImage(layer.canvas, 0, 0);
      copy.opacity = layer.opacity;
      copy.visible = layer.visible;
      const srcOff = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
      state.layerOffsets.set(copy.id, { x: srcOff.x, y: srcOff.y });
      if (Array.isArray(layer.masks) && layer.masks.length) {
        copy.masks = layer.masks.map((m) => {
          const c = document.createElement('canvas');
          c.width = m.canvas.width; c.height = m.canvas.height;
          c.getContext('2d').drawImage(m.canvas, 0, 0);
          return {
            id: 'mask-' + (state.nextLayerId++),
            name: m.name,
            canvas: c,
            ctx: c.getContext('2d'),
            visible: m.visible !== false,
          };
        });
      }
      if (Array.isArray(layer.adjLayers) && layer.adjLayers.length) {
        copy.adjLayers = layer.adjLayers.map((a) => ({
          id: 'adj-' + Math.random().toString(36).slice(2, 9),
          type: a.type,
          name: a.name,
          visible: a.visible !== false,
          opacity: a.opacity != null ? a.opacity : 1,
          params: JSON.parse(JSON.stringify(a.params || {})),
        }));
      }
      if (layer.isSmart && layer.sourceCanvas) {
        const sc = document.createElement('canvas');
        sc.width = layer.sourceCanvas.width; sc.height = layer.sourceCanvas.height;
        sc.getContext('2d').drawImage(layer.sourceCanvas, 0, 0);
        copy.isSmart = true;
        copy.sourceCanvas = sc;
        copy.sourceW = sc.width; copy.sourceH = sc.height;
        copy.smartXf = layer.smartXf ? { ...layer.smartXf } : null;
        copy.linked = layer.linked ? { ...layer.linked } : null;
      }
      const idx = state.layers.findIndex((l) => l.id === layer.id);
      if (idx >= 0) state.layers.splice(idx + 1, 0, copy);
      else state.layers.push(copy);
      state.activeLayerId = copy.id;
      composite();
      render();
      uiModule?.showToast?.('Layer duplicated');
    });

    // Clip to layer below — clipping mask (Ctrl+Alt+G). Toggles on the ACTIVE
    // layer; the bottom layer has nothing to clip to.
    const clipBtn = document.getElementById('ge-clip-layer');
    clipBtn?.addEventListener('click', () => {
      const layer = _activeLayerOrGroup();
      if (!layer || layer.isGroup) { uiModule?.showToast?.('Select a layer first'); return; }
      const idx = state.layers.findIndex((l) => l.id === layer.id);
      if (idx <= 0) { uiModule?.showToast?.('No layer below to clip to'); return; }
      saveState(layer.clipped ? `Release clip "${layer.name}"` : `Clip "${layer.name}" to below`);
      layer.clipped = !layer.clipped;
      composite();
      render();
    });

    // Lock transparency — paint recolours existing pixels only, never spilling
    // into transparent areas ("/"). Toggles on the ACTIVE layer.
    const lockAlphaBtn = document.getElementById('ge-lockalpha-layer');
    lockAlphaBtn?.addEventListener('click', () => {
      const layer = _activeLayerOrGroup();
      if (!layer || layer.isGroup) { uiModule?.showToast?.('Select a layer first'); return; }
      layer.lockAlpha = !layer.lockAlpha;
      render();
      uiModule?.showToast?.(layer.lockAlpha ? 'Transparency locked' : 'Transparency unlocked');
    });
  }
  function syncHeaderProps() {
    wireHeaderProps();
    const blend = document.getElementById('ge-active-blend');
    const op = document.getElementById('ge-active-opacity');
    const v = document.getElementById('ge-active-opacity-val');
    const l = _activeLayerOrGroup();
    const isGroup = !!(l && l.isGroup);
    if (blend) {
      blend.value = (l && !isGroup) ? (l.blendMode || 'source-over') : 'source-over';
      blend.disabled = !l || isGroup; // groups composite pass-through
    }
    const pct = l ? Math.round((l.opacity == null ? 1 : l.opacity) * 100) : 100;
    if (op) { op.value = String(pct); op.disabled = !l; }
    if (v) v.textContent = pct + '%';
    // Reflect toggle state of clip / lock-alpha on the action-row buttons.
    const clipBtn = document.getElementById('ge-clip-layer');
    if (clipBtn) clipBtn.classList.toggle('active', !!(l && !isGroup && l.clipped));
    const lockBtn = document.getElementById('ge-lockalpha-layer');
    if (lockBtn) lockBtn.classList.toggle('active', !!(l && !isGroup && l.lockAlpha));
  }

  function render() {
    // FX panel mirrors the active layer's adjustments — re-sync on
    // every layer event (activation, add, delete, etc).
    try { syncFxPanelToActiveLayerIfPresent(); } catch {}
    try { syncHeaderProps(); } catch {}
    const list = document.getElementById('ge-layers-list');
    if (!list) return;
    // Mobile bottom-sheet peek height — header + N rows, capped so a
    // 20-layer document doesn't get a peek that eats the canvas.
    const panel = document.querySelector('.ge-right-panel');
    if (panel) {
      requestAnimationFrame(() => {
        const header = panel.querySelector('.ge-layers-header');
        const firstRow = list.querySelector('.ge-layer-item');
        const headerH = header ? header.offsetHeight : 52;
        const rowH = firstRow ? firstRow.offsetHeight : 36;
        const allRows = list.querySelectorAll('.ge-layer-item').length;
        const MAX_ROWS = 2;
        const rows = Math.min(allRows, MAX_ROWS);
        panel.style.setProperty('--peek-height', `${headerH + rows * rowH + 6}px`);
      });
    }
    list.innerHTML = '';

    // Render in reverse order (top layer first).
    for (let i = state.layers.length - 1; i >= 0; i--) {
      const layer = state.layers[i];

      // ── Group (folder) entry ─────────────────────────────────────────
      // No canvas of its own — a header row whose eye/opacity gate every
      // member (layer.groupId === this id) at composite time.
      if (layer.isGroup) {
        const grp = document.createElement('div');
        grp.className = 'ge-layer-item ge-layer-group' +
          (layer.id === state.activeLayerId ? ' active' : '');
        grp.dataset.layerId = layer.id;
        grp.style.background = 'rgba(255,255,255,0.04)';
        grp.addEventListener('click', (e) => {
          if (shouldIgnoreLayerTap()) { e.preventDefault(); e.stopPropagation(); return; }
          if (state.activeLayerId === layer.id) return;
          state.activeLayerId = layer.id;
          document.querySelectorAll('.ge-layers-list .ge-layer-item').forEach(el =>
            el.classList.toggle('active', el.dataset.layerId === state.activeLayerId));
        });

        const handle = document.createElement('span');
        handle.className = 'ge-layer-drag';
        handle.title = 'Drag to reorder';
        handle.innerHTML = '<svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor"><circle cx="2" cy="2" r="1"/><circle cx="6" cy="2" r="1"/><circle cx="2" cy="7" r="1"/><circle cx="6" cy="7" r="1"/><circle cx="2" cy="12" r="1"/><circle cx="6" cy="12" r="1"/></svg>';
        grp.appendChild(handle);

        // Collapse / expand caret — hides member rows when collapsed.
        const caret = document.createElement('button');
        caret.className = 'ge-layer-vis ge-group-caret';
        caret.title = layer.collapsed ? 'Expand group' : 'Collapse group';
        caret.innerHTML = layer.collapsed
          ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5l8 7-8 7z"/></svg>'
          : '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M5 8l7 8 7-8z"/></svg>';
        caret.addEventListener('click', (e) => {
          e.stopPropagation();
          layer.collapsed = !layer.collapsed;
          render();
        });
        grp.appendChild(caret);

        const visBtn = document.createElement('button');
        visBtn.className = 'ge-layer-vis' + (layer.visible ? ' visible' : '');
        visBtn.innerHTML = layer.visible ? EYE_OPEN : EYE_OFF;
        visBtn.title = layer.visible ? 'Hide group' : 'Show group';
        visBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          layer.visible = !layer.visible;
          composite();
          render();
        });
        grp.appendChild(visBtn);

        const nameEl = document.createElement('span');
        nameEl.className = 'ge-layer-name';
        const memberCount = state.layers.filter(l => l.groupId === layer.id).length;
        const folderIcon = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
        nameEl.innerHTML = folderIcon + String(layer.name).replace(/[<>&]/g, '') +
          ` <span style="opacity:0.5;">(${memberCount})</span>`;
        nameEl.addEventListener('dblclick', () => {
          const input = document.createElement('input');
          input.type = 'text';
          input.value = layer.name;
          input.className = 'ge-layer-name-input';
          nameEl.replaceWith(input);
          input.focus();
          const save = () => { layer.name = input.value || layer.name; render(); };
          input.addEventListener('blur', save);
          input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') save(); });
        });
        grp.appendChild(nameEl);

        const opSlider = document.createElement('input');
        opSlider.type = 'range';
        opSlider.min = '0'; opSlider.max = '100';
        opSlider.value = String(Math.round((layer.opacity == null ? 1 : layer.opacity) * 100));
        opSlider.className = 'ge-layer-opacity';
        opSlider.title = 'Group opacity';
        opSlider.addEventListener('click', (e) => e.stopPropagation());
        opSlider.addEventListener('input', (e) => {
          e.stopPropagation();
          layer.opacity = parseInt(e.target.value, 10) / 100;
          composite();
        });
        grp.appendChild(opSlider);

        const controls = document.createElement('div');
        controls.className = 'ge-layer-controls';
        // Ungroup (dissolve) — members survive, folder is removed.
        const ungroupBtn = document.createElement('button');
        ungroupBtn.className = 'ge-layer-btn';
        ungroupBtn.title = 'Ungroup (Ctrl+Shift+G)';
        ungroupBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2"/><line x1="3" y1="17" x2="21" y2="17"/></svg>';
        ungroupBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          saveState('Ungroup');
          for (const m of state.layers) if (m.groupId === layer.id) m.groupId = null;
          state.layers = state.layers.filter(l => l.id !== layer.id);
          if (state.activeLayerId === layer.id) {
            const fb = state.layers.find(l => !l.isGroup);
            state.activeLayerId = fb ? fb.id : (state.layers[0] && state.layers[0].id);
          }
          composite();
          render();
          if (uiModule) uiModule.showToast('Group dissolved');
        });
        controls.appendChild(ungroupBtn);
        grp.appendChild(controls);

        list.appendChild(grp);
        continue;
      }

      // Hide members of a collapsed group.
      if (layer.groupId) {
        const pg = state.layers.find(l => l.isGroup && l.id === layer.groupId);
        if (pg && pg.collapsed) continue;
      }

      const item = document.createElement('div');
      // Parent row is highlighted ONLY when it's actually the paint
      // target — activated AND no mask sub-layer is currently active.
      const parentIsPaintTarget = layer.id === state.activeLayerId &&
        !(layer.masks && layer.activeMaskId && layer.masks.some(m => m.id === layer.activeMaskId));
      item.className = 'ge-layer-item' +
        (parentIsPaintTarget ? ' active' : '') +
        (layer.id === state.activeLayerId && !parentIsPaintTarget ? ' active-parent' : '');
      item.dataset.layerId = layer.id;
      // Indent + accent members so the folder hierarchy reads at a glance.
      if (layer.groupId && state.layers.some(l => l.isGroup && l.id === layer.groupId)) {
        item.classList.add('ge-grouped-member');
        item.style.marginLeft = '14px';
        item.style.borderLeft = '2px solid rgba(255,255,255,0.12)';
      }
      // Hover thumbnail.
      item.addEventListener('mouseenter', () => showLayerThumb(item, layer));
      item.addEventListener('mouseleave', () => hideLayerThumb());
      item.addEventListener('click', (e) => {
        if (shouldIgnoreLayerTap()) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        // Shift+click → load layer transparency as wand selection.
        if (e.shiftKey) {
          e.preventDefault();
          loadLayerAlphaAsSelection(layer);
          return;
        }
        if (state.activeLayerId === layer.id) return;
        state.activeLayerId = layer.id;
        // Toggle the active class inline (avoid full re-render so the
        // dblclick listener on the name element stays alive between
        // clicks — a re-render destroys the element after the first
        // click and the second lands on a different node).
        document.querySelectorAll('.ge-layers-list .ge-layer-item').forEach(el => {
          el.classList.toggle('active', el.dataset.layerId === state.activeLayerId);
        });
      });

      // Drag handle — grip dots; dragSortModule.enable() below scopes
      // drag-init to this handle so row body clicks still activate.
      const handle = document.createElement('span');
      handle.className = 'ge-layer-drag';
      handle.title = 'Drag to reorder';
      handle.innerHTML = '<svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor"><circle cx="2" cy="2" r="1"/><circle cx="6" cy="2" r="1"/><circle cx="2" cy="7" r="1"/><circle cx="6" cy="7" r="1"/><circle cx="2" cy="12" r="1"/><circle cx="6" cy="12" r="1"/></svg>';
      item.appendChild(handle);

      const visBtn = document.createElement('button');
      visBtn.className = 'ge-layer-vis' + (layer.visible ? ' visible' : '');
      visBtn.innerHTML = layer.visible ? EYE_OPEN : EYE_OFF;
      visBtn.title = layer.visible ? 'Hide layer' : 'Show layer';
      visBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        layer.visible = !layer.visible;
        composite();
        render();
      });

      const nameEl = document.createElement('span');
      nameEl.className = 'ge-layer-name';
      nameEl.textContent = layer.name + (isLayerEmpty(layer) ? ' (empty)' : '');
      // Smart Object badge — a small corner glyph so smart layers read at a glance.
      if (layer.isSmart) {
        const so = document.createElement('span');
        so.className = 'ge-smart-badge';
        so.title = 'Smart Object — transforms are non-destructive';
        so.textContent = '◆';
        so.style.cssText = 'margin-left:5px;font-size:9px;opacity:0.8;color:#7aa8ff;';
        nameEl.appendChild(so);
      }
      nameEl.addEventListener('dblclick', () => {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = layer.name;
        input.className = 'ge-layer-name-input';
        nameEl.replaceWith(input);
        input.focus();
        const save = () => { layer.name = input.value || layer.name; render(); };
        input.addEventListener('blur', save);
        input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') save(); });
      });

      // Per-row actions removed — the active-layer action bar in the panel
      // header (controls.js `.ge-layers-actions-row`, wired in wireHeaderProps)
      // now owns add / duplicate / group / mask / fx / clip / lock-alpha /
      // merge-down / merge-all / flatten / delete. The parent row is just
      // drag-handle + eye + thumbnail + name so it reads cleanly and never
      // overflows the 280px panel. (Adjustment + mask SUB-rows keep their own
      // controls below — those manage individual sub-layers, not the parent.)

      item.appendChild(visBtn);
      item.appendChild(layerThumb(layer));
      item.appendChild(nameEl);

      item.addEventListener('click', () => {
        if (shouldIgnoreLayerTap()) return;
        state.activeLayerId = layer.id;
        // Clicking the PARENT row makes layer pixels the paint target
        // (mask is no longer the target). Mask sub-rows stay in the
        // panel; clicking one re-targets it.
        layer.activeMaskId = null;
        state.maskCanvas = null;
        state.maskCtx = null;
        render();
        composite();
      });

      list.appendChild(item);

      // Adjustment sub-layer rows, indented under the parent.
      if (layer.adjLayers && layer.adjLayers.length) {
        for (const adj of layer.adjLayers) {
          const sub = document.createElement('div');
          sub.className = 'ge-layer-item ge-adj-sub-item';
          sub.dataset.adjId = adj.id;
          const sVis = document.createElement('button');
          sVis.className = 'ge-layer-vis' + (adj.visible ? ' visible' : '');
          sVis.innerHTML = adj.visible ? EYE_OPEN_SM : EYE_OFF_SM;
          sVis.title = adj.visible ? 'Hide adjustment' : 'Show adjustment';
          sVis.addEventListener('click', (e) => {
            e.stopPropagation();
            adj.visible = !adj.visible;
            layer._adjFinalKey = null;
            composite();
            render();
          });
          const sName = document.createElement('span');
          sName.className = 'ge-layer-name ge-adj-sub-name';
          sName.innerHTML = `<span class="ge-adj-sub-icon">${ADJ_ICONS[adj.type] || ''}</span><span>${(adj.name || adjLayerLabel(adj.type)).replace(/[<>&]/g,'')}</span>`;
          const sOp = document.createElement('input');
          sOp.type = 'range';
          sOp.min = '0'; sOp.max = '100';
          sOp.value = Math.round(adj.opacity * 100);
          sOp.className = 'ge-layer-opacity';
          sOp.title = 'Adjustment opacity';
          sOp.addEventListener('input', () => {
            adj.opacity = parseInt(sOp.value, 10) / 100;
            layer._adjFinalKey = null;
            composite();
          });
          const sControls = document.createElement('div');
          sControls.className = 'ge-layer-controls';
          const mergeBtn = document.createElement('button');
          mergeBtn.className = 'ge-layer-btn';
          mergeBtn.title = 'Merge into layer (bake)';
          mergeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
          mergeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Bake just this adjustment into layer.canvas, then drop it.
            saveState(`Merge ${adjLayerLabel(adj.type)}`);
            const baked = applyAdjustment(layer.canvas, adj);
            layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
            layer.ctx.drawImage(baked, 0, 0);
            layer.adjLayers = layer.adjLayers.filter(x => x.id !== adj.id);
            layer._adjFinalKey = null;
            composite();
            render();
          });
          sControls.appendChild(mergeBtn);
          const delBtn = document.createElement('button');
          delBtn.className = 'ge-layer-btn danger';
          delBtn.textContent = '×';
          delBtn.title = 'Delete adjustment';
          delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            saveState(`Delete ${adjLayerLabel(adj.type)}`);
            layer.adjLayers = layer.adjLayers.filter(x => x.id !== adj.id);
            layer._adjFinalKey = null;
            composite();
            render();
          });
          sControls.appendChild(delBtn);

          sub.appendChild(sVis);
          sub.appendChild(sName);
          sub.appendChild(sOp);
          sub.appendChild(sControls);
          // Single-click on the sub-row (outside the inline controls)
          // reopens the adj popup with this sub-layer's params staged.
          sub.addEventListener('click', (e) => {
            if (shouldIgnoreLayerTap()) {
              e.preventDefault();
              e.stopPropagation();
              return;
            }
            if (e.target.closest('.ge-layer-vis, .ge-layer-opacity, .ge-layer-btn')) return;
            if (!e.target.closest('.ge-adj-sub-name')) return;
            e.stopPropagation();
            editAdjLayer(layer, adj, sub);
          });
          list.appendChild(sub);
        }
      }

      // Mask sub-layer rows.
      if (layer.masks && layer.masks.length) {
        for (let mi = 0; mi < layer.masks.length; mi++) {
          const mk = layer.masks[mi];
          const sub = document.createElement('div');
          sub.className = 'ge-layer-item ge-adj-sub-item ge-mask-sub-item' +
            (layer.activeMaskId === mk.id ? ' active' : '');
          sub.dataset.maskId = mk.id;
          const sVis = document.createElement('button');
          sVis.className = 'ge-layer-vis' + (mk.visible ? ' visible' : '');
          sVis.innerHTML = mk.visible ? EYE_OPEN_SM : EYE_OFF_SM;
          sVis.title = mk.visible ? 'Hide mask' : 'Show mask';
          sVis.addEventListener('click', (e) => {
            e.stopPropagation();
            mk.visible = !mk.visible;
            composite();
            render();
          });
          const sName = document.createElement('span');
          sName.className = 'ge-layer-name ge-adj-sub-name';
          const maskIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12c4 0 4-4 8-4s4 4 8 4-4 4-8 4-4-4-8-4z" fill="currentColor"/></svg>';
          const mkName = String(mk.name || 'Mask').replace(/[<>&]/g, '');
          const mkEmpty = isMaskCanvasEmpty(mk.canvas) ? ' <span style="opacity:0.55;">(empty)</span>' : '';
          sName.innerHTML = `<span class="ge-adj-sub-icon">${maskIcon}</span><span>${mkName}${mkEmpty}</span>`;
          const sControls = document.createElement('div');
          sControls.className = 'ge-layer-controls';
          // Merge-up — combine this mask into the one above (lower mi).
          if (mi > 0) {
            const mergeBtn = document.createElement('button');
            mergeBtn.className = 'ge-layer-btn';
            mergeBtn.title = 'Merge into mask above';
            mergeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="6 11 12 5 18 11"/></svg>';
            mergeBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              const above = layer.masks[mi - 1];
              if (!above) return;
              saveState(`Merge mask "${mk.name}" into "${above.name}"`);
              // Union of alpha — `source-over` already does max for
              // fully opaque white masks; this also handles partial alpha.
              above.ctx.save();
              above.ctx.globalCompositeOperation = 'source-over';
              above.ctx.drawImage(mk.canvas, 0, 0);
              above.ctx.restore();
              layer.masks = layer.masks.filter(x => x.id !== mk.id);
              if (layer.activeMaskId === mk.id) layer.activeMaskId = above.id;
              const a = getActiveMaskLayer();
              if (a) { state.maskCanvas = a.canvas; state.maskCtx = a.ctx; }
              else   { state.maskCanvas = null;     state.maskCtx = null; }
              composite();
              render();
            });
            sControls.appendChild(mergeBtn);
          }
          const delBtn = document.createElement('button');
          delBtn.className = 'ge-layer-btn danger';
          delBtn.textContent = '×';
          delBtn.title = 'Delete mask';
          delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            saveState(`Delete mask "${mk.name}"`);
            layer.masks = layer.masks.filter(x => x.id !== mk.id);
            if (layer.activeMaskId === mk.id) {
              layer.activeMaskId = layer.masks[layer.masks.length - 1]?.id || null;
            }
            // Sync global mask plumbing.
            const a = getActiveMaskLayer();
            if (a) { state.maskCanvas = a.canvas; state.maskCtx = a.ctx; }
            else   { state.maskCanvas = null;     state.maskCtx = null; }
            composite();
            render();
          });
          sControls.appendChild(delBtn);
          sub.appendChild(sVis);
          sub.appendChild(sName);
          sub.appendChild(sControls);
          sub.addEventListener('click', (e) => {
            if (e.target.closest('.ge-layer-vis, .ge-layer-btn')) return;
            e.stopPropagation();
            // Activate this mask: paint/inpaint/generate target.
            layer.activeMaskId = mk.id;
            state.activeLayerId = layer.id;
            state.maskCanvas = mk.canvas;
            state.maskCtx = mk.ctx;
            render();
            composite();
          });
          list.appendChild(sub);
        }
      }
    }

    // Wire the shared dragSort module — limit drag-init to the grip
    // handle so row body clicks still activate. Called every render
    // because `enable()` cleans up the previous instance keyed on
    // instanceKey.
    if (dragSortModule) {
      dragSortModule.enable('ge-layers-list', '.ge-layer-item', {
        instanceKey: 'ge-layers',
        handleSelector: '.ge-layer-drag',
        onReorder: (orderedItems) => {
          // DOM is top→bottom = reverse of array order, so the new
          // array is the reverse of the DOM order.
          const byId = new Map(state.layers.map(l => [l.id, l]));
          const newLayers = orderedItems
            .map(el => byId.get(el.dataset.layerId))
            .filter(Boolean)
            .reverse();
          if (newLayers.length === state.layers.length) {
            state.layers = newLayers;
            saveState();
            composite();
          }
        },
      });
    }
  }

  return { render };
}
