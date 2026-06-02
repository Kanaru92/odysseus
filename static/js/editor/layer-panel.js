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
import { LAYER_COLOR_LABELS, cssForLayerLabel } from './build/popups.js';

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

  // ── Group-aware reorder ────────────────────────────────────────────────
  // The shared dragSort module only hands us the final VISUAL row order
  // (top→bottom). On its own that just shuffles array indices — it never
  // touches `groupId`, so a row "dropped into" a folder never actually
  // joins it, and a non-member dropped mid-band splits the folder visually.
  //
  // This rebuilds `state.layers` from the visual order so that:
  //   • a row whose visual slot is INSIDE a folder's contiguous band joins
  //     that folder (groupId := folder.id),
  //   • a row outside every band is ungrouped (groupId := null),
  //   • each folder's members stay contiguous and directly below the folder
  //     row, and array order always mirrors the rendered order.
  //
  // Membership rule (PS-like): walking the visual order top→bottom, every
  // non-folder row is "open" under the most recent folder until we hit a row
  // that the drag explicitly placed OUTSIDE the band. Because the panel only
  // ever renders members immediately under their (expanded) folder, the
  // contiguous run directly under a folder header == that folder's band. A
  // row dragged onto the header or anywhere inside the run is a member; the
  // first row at/after a run that was already a non-member ends the band.
  //
  // `orderedTopIds` is the visual order, top row first (folders + members +
  // standalone rows, but NOT sub-rows — those are filtered by the caller via
  // the `.ge-layer-item[data-layer-id]` selector).
  //
  // Membership is intent-driven, not re-derived from geometry: every row
  // keeps its current `groupId` EXCEPT the one row the user moved, which the
  // caller resolves to `forceIntoId` (join a folder) or `forceUngroupId`
  // (leave its folder). We then canonicalise the array so each folder's
  // members sit contiguously, directly below the folder, following the new
  // visual order — keeping array order == rendered order.
  function reorderLayersFromVisual(orderedTopIds, opts = {}) {
    const byId = new Map(state.layers.map((l) => [l.id, l]));
    const rows = orderedTopIds.map((id) => byId.get(id)).filter(Boolean);
    if (rows.length !== state.layers.length) return false; // refuse partial maps

    const forceUngroup = opts.forceUngroupId || null; // id pulled OUT this drop
    const forceInto = opts.forceIntoId || null;       // folder id joined this drop
    const validGroupIds = new Set(rows.filter((l) => l.isGroup).map((l) => l.id));

    // Apply the single moved row's intent.
    if (forceInto && validGroupIds.has(forceInto)) {
      const tgt = byId.get(opts.movedId);
      if (tgt && !tgt.isGroup) tgt.groupId = forceInto;
    }
    if (forceUngroup) {
      const tgt = byId.get(forceUngroup);
      if (tgt) tgt.groupId = null;
    }
    // Drop stale membership (folder no longer present).
    for (const l of rows) {
      if (!l.isGroup && l.groupId && !validGroupIds.has(l.groupId)) l.groupId = null;
    }

    // Canonical rebuild, bottom→top (array order == reverse of visual order).
    // Walk the visual order top→bottom; emit each folder followed by its
    // members (preserving their relative visual order), so in the final
    // bottom-up array members land immediately below their folder.
    const visualTopDown = rows;
    const placed = new Set();
    const visualOut = []; // top→bottom canonical order
    for (const l of visualTopDown) {
      if (placed.has(l.id)) continue;
      if (l.isGroup) {
        visualOut.push(l); placed.add(l.id);
        for (const m of visualTopDown) {
          if (!placed.has(m.id) && !m.isGroup && m.groupId === l.id) {
            visualOut.push(m); placed.add(m.id);
          }
        }
      } else if (!l.groupId) {
        visualOut.push(l); placed.add(l.id);
      }
      // members are emitted with their folder above; skip in-place here.
    }
    // Any leftover (e.g. member whose folder sits BELOW it visually) — append
    // next to its folder if possible, else as standalone.
    for (const l of visualTopDown) {
      if (placed.has(l.id)) continue;
      visualOut.push(l); placed.add(l.id);
    }
    if (visualOut.length !== state.layers.length) return false;
    state.layers = visualOut.reverse(); // visual top→bottom → array bottom→top
    return true;
  }

  // Determine the drop intent from the placeholder's resting slot in the
  // live DOM: is the gap the user released over INSIDE a folder's member
  // band (→ join that folder) or clear of every band (→ ungroup)? Returns
  // { forceIntoId, forceUngroupId } for the dragged layer id.
  function dropIntentFor(draggedId) {
    const list = document.getElementById('ge-layers-list');
    if (!list) return {};
    const rows = Array.from(list.querySelectorAll('.ge-layer-item[data-layer-id]'));
    const idx = rows.findIndex((r) => r.dataset.layerId === draggedId);
    if (idx < 0) return {};
    const byId = new Map(state.layers.map((l) => [l.id, l]));
    // Walk UP from the dragged row's new slot to find the nearest folder
    // header with no intervening folder; the rows between are its band.
    let intoId = null;
    for (let i = idx - 1; i >= 0; i--) {
      const l = byId.get(rows[i].dataset.layerId);
      if (!l) continue;
      if (l.isGroup) { intoId = l.id; break; }
      if (!l.groupId) break; // hit a standalone row → not inside a band
    }
    // Also treat "dropped directly under a folder header" (idx-1 is a folder)
    // as joining even if that folder currently has no members.
    if (!intoId && idx > 0) {
      const above = byId.get(rows[idx - 1].dataset.layerId);
      if (above && above.isGroup) intoId = above.id;
    }
    const dragged = byId.get(draggedId);
    const wasGrouped = dragged && dragged.groupId;
    if (intoId) return { forceIntoId: intoId };
    if (wasGrouped) return { forceUngroupId: draggedId };
    return {};
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

  // Mask thumbnail (PS-style): a small grayscale preview of the layer's raster
  // visibility mask, shown beside the layer thumbnail when one exists. Click =
  // edit the mask (toggles back to pixels if already editing it); Shift+click =
  // disable/enable; Alt+click = rubylith overlay (red over hidden areas). An
  // accent outline marks the mask being edited; a disabled mask is dimmed + slashed.
  function maskThumb(layer) {
    const W = 34;
    const aspect = (state.imgWidth && state.imgHeight) ? state.imgHeight / state.imgWidth : 1;
    const H = Math.max(10, Math.min(30, Math.round(W * aspect)));
    const box = document.createElement('canvas');
    box.width = W; box.height = H;
    box.className = 'ge-row-mask-thumb';
    const editing = !!(state.layerMaskEdit && state.activeLayerId === layer.id);
    const disabled = layer.maskEnabled === false;
    box.style.cssText = `width:${W}px;height:${H}px;border:${editing ? '2px solid #4a9eff' : '1px solid rgba(255,255,255,0.4)'};border-radius:2px;flex-shrink:0;margin:0 2px;opacity:${disabled ? '0.5' : '1'};cursor:pointer;`;
    box.title = `Layer mask — click: edit · Shift+click: ${disabled ? 'enable' : 'disable'} · Alt+click: view`;
    const c = box.getContext('2d');
    c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
    try {
      if (layer.layerMask) {
        c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
        c.drawImage(layer.layerMask, 0, 0, layer.layerMask.width, layer.layerMask.height, 0, 0, W, H);
      }
    } catch {}
    if (disabled) { c.strokeStyle = '#ff4d4d'; c.lineWidth = 2; c.beginPath(); c.moveTo(2, H - 2); c.lineTo(W - 2, 2); c.stroke(); }
    box.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasActive = state.activeLayerId === layer.id;
      state.activeLayerId = layer.id;
      if (e.shiftKey) {
        saveState(layer.maskEnabled === false ? 'Enable layer mask' : 'Disable layer mask');
        layer.maskEnabled = layer.maskEnabled === false; // false→true (enable), else→false (disable)
      } else if (e.altKey) {
        state.maskOverlay = (state.maskOverlay === layer.id) ? null : layer.id;
      } else {
        state.layerMaskEdit = !(wasActive && state.layerMaskEdit); // toggle edit-mask vs edit-pixels
      }
      document.getElementById('ge-layer-mask')?.classList.toggle('active', !!(state.layerMaskEdit && layer.layerMask));
      composite();
      render();
    });
    // Right-click → the full mask menu (Edit/Disable/View/Invert/Apply/From
    // Selection/Delete), re-dispatched to the header button that owns it.
    box.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      state.activeLayerId = layer.id;
      document.getElementById('ge-layer-mask')?.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: e.clientX, clientY: e.clientY }));
    });
    return box;
  }

  // ── Layer colour labels (row tag) ─────────────────────────────────────
  // A colour-label visually groups related rows (NOT pixel colour). Set it
  // from a small right-click context menu on the row. Persists in the draft +
  // history snapshot (serialized in galleryEditor.js).
  function setLayerColorLabel(layer, id) {
    saveState(id ? `Color label "${layer.name}"` : `Clear label "${layer.name}"`);
    layer.colorLabel = id || null;
    render();
  }

  // Tiny floating swatch picker anchored at (x, y). Closes on outside-click /
  // Escape. One menu instance at a time.
  function openColorLabelMenu(layer, x, y) {
    document.querySelectorAll('.ge-colorlabel-menu').forEach((m) => m.remove());
    const menu = document.createElement('div');
    menu.className = 'ge-colorlabel-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    for (const c of LAYER_COLOR_LABELS) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'ge-colorlabel-dot' +
        ((layer.colorLabel || null) === c.id ? ' active' : '') +
        (c.id == null ? ' none' : '');
      dot.title = c.name;
      dot.style.background = c.css;
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        close();
        setLayerColorLabel(layer, c.id);
      });
      menu.appendChild(dot);
    }
    document.body.appendChild(menu);
    // Keep the menu on-screen.
    const r = menu.getBoundingClientRect();
    if (r.right > window.innerWidth) menu.style.left = (window.innerWidth - r.width - 6) + 'px';
    if (r.bottom > window.innerHeight) menu.style.top = (window.innerHeight - r.height - 6) + 'px';
    function close() {
      menu.remove();
      document.removeEventListener('mousedown', onDoc, true);
      document.removeEventListener('keydown', onKey, true);
    }
    function onDoc(e) { if (!menu.contains(e.target)) close(); }
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }
    setTimeout(() => {
      document.addEventListener('mousedown', onDoc, true);
      document.addEventListener('keydown', onKey, true);
    }, 0);
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
    // 'Pass Through' (groups only) + the standard blend modes.
    blend.innerHTML = '<option value="pass-through">Pass Through</option>'
      + BLEND_MODES.map((b) => `<option value="${b.id}">${b.name}</option>`).join('');
    blend.addEventListener('change', () => {
      const l = _activeLayerOrGroup();
      if (!l) return;
      // Pass-Through is only meaningful for a group; ignore it for a pixel layer.
      if (!l.isGroup && blend.value === 'pass-through') { blend.value = l.blendMode || 'source-over'; return; }
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

    // Opacity chip → wide popover slider (PS-style; precision over a cramped inline
    // track). The slider keeps id #ge-active-opacity, so the wiring above is reused.
    const opChip = document.getElementById('ge-active-opacity-chip');
    const opPop = document.getElementById('ge-opacity-pop');
    if (opChip && opPop) {
      const closeOpPop = () => {
        opPop.hidden = true;
        opChip.setAttribute('aria-expanded', 'false');
        document.removeEventListener('pointerdown', onOpDoc, true);
      };
      function onOpDoc(e) { if (!opPop.contains(e.target) && !opChip.contains(e.target)) closeOpPop(); }
      opChip.addEventListener('click', () => {
        if (opPop.hidden) {
          opPop.hidden = false;
          opChip.setAttribute('aria-expanded', 'true');
          op.focus();
          setTimeout(() => document.addEventListener('pointerdown', onOpDoc, true), 0);
        } else { closeOpPop(); }
      });
      opPop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeOpPop(); opChip.focus(); } });
    }

    // Header Group (folder) + Delete (trash) — PS layers-panel footer parity.
    // Act on the active layer; mirror the Ctrl+G / per-row × logic so all three
    // entry points stay consistent.
    const groupBtn = document.getElementById('ge-group-layer');
    groupBtn?.addEventListener('click', () => {
      // Group the multi-selection if 2+ layers are selected; else the active layer.
      const selIds = new Set((state.selectedLayerIds || []).filter(Boolean));
      let members = state.layers.filter((l) => !l.isGroup && selIds.has(l.id));
      if (members.length < 2) {
        const l = _activeLayerOrGroup();
        if (!l) { uiModule?.showToast?.('Select a layer first'); return; }
        if (l.isGroup) { uiModule?.showToast?.('Already a group'); return; }
        members = [l];
      }
      saveState(members.length > 1 ? 'Group layers' : 'Group layer');
      const ngroups = state.layers.filter((x) => x.isGroup).length;
      const grp = {
        id: 'group-' + (state.nextLayerId++),
        name: 'Group ' + (ngroups + 1),
        isGroup: true, visible: true, opacity: 1, collapsed: false, blendMode: 'pass-through',
      };
      members.forEach((m) => { m.groupId = grp.id; });
      const memberSet = new Set(members.map((m) => m.id));
      const ordered = state.layers.filter((l) => memberSet.has(l.id)); // members, z-order
      const rest = state.layers.filter((l) => !memberSet.has(l.id));
      // Insert the contiguous member block + folder above, at the topmost member's spot.
      const topOrig = Math.max(...members.map((m) => state.layers.indexOf(m)));
      let insertIdx = 0; for (let k = 0; k < topOrig; k++) if (!memberSet.has(state.layers[k].id)) insertIdx++;
      rest.splice(insertIdx, 0, ...ordered, grp); // folder sits above its members
      state.layers = rest;
      state.activeLayerId = ordered[ordered.length - 1].id;
      state.selectedLayerIds = [];
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
      if (layer.layerMask) {
        const lm = document.createElement('canvas');
        lm.width = layer.layerMask.width; lm.height = layer.layerMask.height;
        lm.getContext('2d').drawImage(layer.layerMask, 0, 0);
        copy.layerMask = lm;
        if (layer.maskEnabled === false) copy.maskEnabled = false;
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
      if (layer.groupId) copy.groupId = layer.groupId; // keep group members contiguous (and in the group, PS-style)
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
      blend.value = l ? (l.blendMode || (isGroup ? 'pass-through' : 'source-over')) : 'source-over';
      blend.disabled = !l; // groups now selectable: Pass Through (default) or a blend mode
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

    // The parent layer rendered just above the current row — used to anchor
    // the alt-click clip hit-zone between two rows (clips the UPPER layer to
    // the one below). Reset each render.
    let prevParentLayer = null;

    // Alt-clickable boundary between two layer rows. Alt-clicking it toggles
    // the UPPER layer's `clipped` flag (clip it to the layer below) — the same
    // flag the action-row "Clip" button drives (PS Alt-click between layers).
    const makeClipZone = (upper) => {
      const z = document.createElement('div');
      z.className = 'ge-clip-zone' + (upper.clipped ? ' clipped' : '');
      z.dataset.clipUpper = upper.id;
      z.title = 'Alt-click to ' + (upper.clipped ? 'release' : 'create') +
        ' a clipping mask (clip the layer above to the one below)';
      z.addEventListener('click', (e) => {
        if (!e.altKey) return; // only alt-click toggles; plain clicks pass
        e.preventDefault();
        e.stopPropagation();
        saveState(upper.clipped ? `Release clip "${upper.name}"` : `Clip "${upper.name}" to below`);
        upper.clipped = !upper.clipped;
        composite();
        render();
      });
      return z;
    };

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

      // Clip hit-zone between this row and the parent row above it. The UPPER
      // layer (rendered on the previous iteration) is the one that gets
      // clipped to the layer below (this row). No zone above the topmost row.
      if (prevParentLayer) list.appendChild(makeClipZone(prevParentLayer));

      const item = document.createElement('div');
      // Parent row is highlighted ONLY when it's actually the paint
      // target — activated AND no mask sub-layer is currently active.
      const parentIsPaintTarget = layer.id === state.activeLayerId &&
        !(layer.masks && layer.activeMaskId && layer.masks.some(m => m.id === layer.activeMaskId));
      item.className = 'ge-layer-item' +
        (parentIsPaintTarget ? ' active' : '') +
        (layer.id === state.activeLayerId && !parentIsPaintTarget ? ' active-parent' : '') +
        (layer.clipped ? ' ge-clipped' : '');
      item.dataset.layerId = layer.id;
      // Multi-selection highlight (only meaningful when 2+ rows are selected).
      if (state.selectedLayerIds && state.selectedLayerIds.length > 1 && state.selectedLayerIds.includes(layer.id)) {
        item.style.boxShadow = 'inset 0 0 0 2px #4a9eff';
      }
      // Colour-label tag — a left-edge stripe so the row reads at a glance
      // without eating panel width. Right-click the row to set/clear it.
      if (layer.colorLabel) {
        item.classList.add('ge-has-colorlabel');
        item.style.boxShadow = `inset 3px 0 0 ${cssForLayerLabel(layer.colorLabel)}`;
      }
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openColorLabelMenu(layer, e.clientX, e.clientY);
      });
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
      if (layer.layerMask) item.appendChild(maskThumb(layer));
      // Small queryable colour-label swatch next to the name (mirrors the
      // left-edge stripe). Only present when the row carries a label.
      if (layer.colorLabel) {
        const sw = document.createElement('span');
        sw.className = 'ge-row-colorlabel';
        sw.dataset.colorLabel = layer.colorLabel;
        sw.title = 'Colour label: ' + layer.colorLabel;
        sw.style.background = cssForLayerLabel(layer.colorLabel);
        item.appendChild(sw);
      }
      item.appendChild(nameEl);

      item.addEventListener('click', (e) => {
        if (shouldIgnoreLayerTap()) return;
        // Ctrl/Cmd+click → toggle this layer in the multi-selection (for Ctrl+G
        // grouping of several layers at once). Doesn't change the mask target.
        if ((e.ctrlKey || e.metaKey) && !layer.isGroup) {
          const sel = new Set((state.selectedLayerIds && state.selectedLayerIds.length)
            ? state.selectedLayerIds : (state.activeLayerId ? [state.activeLayerId] : []));
          if (sel.has(layer.id) && sel.size > 1) sel.delete(layer.id); else sel.add(layer.id);
          state.selectedLayerIds = [...sel];
          state.activeLayerId = layer.id;
          render();
          return;
        }
        state.activeLayerId = layer.id;
        state.selectedLayerIds = [layer.id]; // plain click resets the multi-selection
        // Clicking the PARENT row makes layer pixels the paint target
        // (mask is no longer the target). Mask sub-rows stay in the
        // panel; clicking one re-targets it.
        layer.activeMaskId = null;
        state.maskCanvas = null;
        state.maskCtx = null;
        state.layerMaskEdit = false; // don't leak mask-edit mode across layers
        render();
        composite();
      });

      list.appendChild(item);
      prevParentLayer = layer; // anchor the next row's clip hit-zone

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
      // Snapshot the visual order at drag-start so onReorder can tell which
      // single row the user moved (→ compute its group drop-intent).
      const list = document.getElementById('ge-layers-list');
      let preDragIds = [];
      if (list && !list.__geDragStartWired) {
        list.__geDragStartWired = true;
        const snap = () => {
          preDragIds = Array.from(
            list.querySelectorAll('.ge-layer-item[data-layer-id]')
          ).map((el) => el.dataset.layerId);
        };
        list.addEventListener('mousedown', (e) => {
          if (e.target.closest('.ge-layer-drag')) snap();
        }, true);
        list.addEventListener('touchstart', (e) => {
          if (e.target.closest('.ge-layer-drag')) snap();
        }, { capture: true, passive: true });

        // Live drop-target hint: while a row is being dragged, light up the
        // folder header whose member band the cursor is currently over.
        const hoverHint = (clientY) => {
          const dragging = list.querySelector('.ge-layer-item.dragging, .ge-layer-item.touch-dragging');
          list.querySelectorAll('.ge-layer-group.ge-drop-into')
            .forEach((el) => el.classList.remove('ge-drop-into'));
          if (!dragging || dragging.classList.contains('ge-layer-group')) return;
          const ph = list.querySelector('.drag-placeholder');
          const probeY = ph ? (ph.getBoundingClientRect().top + ph.getBoundingClientRect().height / 2) : clientY;
          const rows = Array.from(list.querySelectorAll('.ge-layer-item[data-layer-id]'));
          // Find nearest folder header above the probe with an open band.
          let folder = null;
          for (const r of rows) {
            const rect = r.getBoundingClientRect();
            if (rect.top + rect.height / 2 > probeY) break;
            if (r.classList.contains('ge-layer-group')) folder = r;
            else if (!r.classList.contains('ge-grouped-member')) folder = null;
          }
          if (folder) folder.classList.add('ge-drop-into');
        };
        list.addEventListener('mousemove', (e) => hoverHint(e.clientY));
        list.addEventListener('touchmove', (e) => {
          if (e.touches && e.touches[0]) hoverHint(e.touches[0].clientY);
        }, { passive: true });
      }
      dragSortModule.enable('ge-layers-list', '.ge-layer-item', {
        instanceKey: 'ge-layers',
        handleSelector: '.ge-layer-drag',
        // Sub-rows (adjustment / mask) aren't reorderable layers.
        excludeSelector: '.ge-adj-sub-item',
        onReorder: (orderedItems) => {
          // Visual order, top row first — only true layer/group rows.
          const orderedIds = orderedItems
            .filter((el) => el.dataset.layerId)
            .map((el) => el.dataset.layerId);
          if (orderedIds.length !== state.layers.length) return;

          // Which single row moved? The first id whose new index differs
          // from its pre-drag index is the dragged one.
          let movedId = null;
          for (let i = 0; i < orderedIds.length; i++) {
            if (orderedIds[i] !== preDragIds[i]) { movedId = orderedIds[i]; break; }
          }
          // The new DOM already reflects the drop slot, so dropIntentFor()
          // can read the dragged row's neighbours to decide join/ungroup.
          const intent = movedId ? dropIntentFor(movedId) : {};
          intent.movedId = movedId;

          const prevActive = state.activeLayerId;
          if (reorderLayersFromVisual(orderedIds, intent)) {
            if (state.layers.some((l) => l.id === prevActive)) {
              state.activeLayerId = prevActive; // preserve selection
            }
            saveState();
            render();    // re-render so indent / membership styling updates
            composite();
          }
        },
      });
    }
  }

  // Expose the pure reorder logic so headless tests can drive a "drop" without
  // synthesising HTML5 drag events (which don't fire reliably headless).
  if (typeof window !== 'undefined') {
    window.__geLayerPanel = window.__geLayerPanel || {};
    window.__geLayerPanel.reorderLayersFromVisual = reorderLayersFromVisual;
    window.__geLayerPanel.dropIntentFor = dropIntentFor;
    window.__geLayerPanel.render = () => render();
    window.__geLayerPanel.setLayerColorLabel = (layer, id) => setLayerColorLabel(layer, id);
    window.__geLayerPanel.openColorLabelMenu = (layer, x, y) => openColorLabelMenu(layer, x || 40, y || 40);
  }

  return { render };
}
