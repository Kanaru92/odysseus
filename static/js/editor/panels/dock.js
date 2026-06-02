/**
 * Panel dock controller — Phase 1 of the panel & docking framework
 * (documentation/painting-suite/PANEL-DOCKING-DESIGN.md).
 *
 * Implements the two non-drag capabilities + persistence:
 *   - COLLAPSE: a chevron in each group header toggles its body (hidden, header
 *     stays). Keyboard-operable (Enter/Space), aria-expanded reflects state.
 *   - TAB GROUP: N panels sharing one body area + a tab strip; click a tab to
 *     raise it. A single-panel group renders a plain header (no tabs).
 *   - PERSIST: layout state (group order, tab grouping, active tab, per-group
 *     collapsed) round-trips through localStorage under one JSON key.
 *
 * DEFERRED SEAM — floating / undock / drag-reorder (Phases 3-4) are intentionally
 * NOT built here. The layout model already carries a `floats` array and the
 * controller exposes `_seam` hooks (see DEFERRED SEAM block at the bottom) so the
 * later phases bolt on without reshaping state. Calling a seam method throws a
 * clear "not implemented in phase 1" error rather than silently no-op'ing.
 *
 * Design constraints honoured (DESIGN-GUIDE §1-2, §8):
 *   - Bodies are MOVED, never rebuilt — moving a live DOM node preserves its
 *     wired listeners + internal state (slider values, canvases). Render is a
 *     pure (layout) -> DOM re-derivation that re-homes the existing body nodes.
 *   - No new global Escape listener — the overflow menu (a later phase) routes
 *     through the editor's Esc hard-guard hook; the controller exposes
 *     `dismissTopTransient()` for that wiring (returns false in phase 1).
 *   - All chrome uses `.ge-*` classes + `--ge-*` tokens (see dock.css). No brand
 *     names in code/UI/comments — neutral, industry-standard terms only.
 *
 * The reducer half (createDefaultLayout / loadLayout / validateLayout / the
 * action functions) is DOM-free and unit-testable in node; the DOM half
 * (mountDock) is the thin glue. Keep that separation.
 */

export const LS_KEY = 'ge-panel-layout';
export const LAYOUT_VERSION = 1;

/* ------------------------------------------------------------------ *
 * Registry helpers
 * ------------------------------------------------------------------ *
 * A panel descriptor: { id, title, bodySel, defaultGroup, noFloat? }.
 * The caller owns the registry (an object keyed by panel id) so this module
 * stays free of editor-specific DOM ids. `bodySel` is resolved against the
 * mount root at render time; a panel whose body node is missing is skipped
 * (so the dock degrades gracefully if a section is not present for the
 * current tool/build).
 */

/** Ordered list of panel ids from a registry object (insertion order). */
function registryIds(registry) {
  return Object.keys(registry);
}

/* ------------------------------------------------------------------ *
 * Layout model (serializable — this IS the localStorage payload)
 * ------------------------------------------------------------------ */

/**
 * Build the default layout from a registry: each panel lands in its
 * `defaultGroup`; panels sharing a `defaultGroup` start tabbed together, in
 * registry order. Group order follows first-appearance of each group id.
 *
 * @param {Object} registry  panel-id -> descriptor
 * @param {string} [dockId]  dock the groups belong to (default 'right')
 * @returns {Object} a fresh layout object
 */
export function createDefaultLayout(registry, dockId = 'right') {
  const groupsById = new Map();
  const order = [];
  for (const id of registryIds(registry)) {
    const desc = registry[id] || {};
    const gid = desc.defaultGroup || ('g-' + id);
    if (!groupsById.has(gid)) {
      groupsById.set(gid, { id: gid, panels: [], active: id, collapsed: false });
      order.push(gid);
    }
    groupsById.get(gid).panels.push(id);
  }
  const groups = order.map((gid) => {
    const g = groupsById.get(gid);
    // active defaults to the first panel of the group.
    g.active = g.panels[0];
    return g;
  });
  return {
    version: LAYOUT_VERSION,
    docks: { [dockId]: { groups } },
    floats: [], // DEFERRED SEAM: populated by Phase 4 (undock).
  };
}

/**
 * Validate a parsed layout against a registry. Phase 5 hardening lives here.
 * A layout is valid iff: version matches, the dock exists, and every
 * registered panel appears EXACTLY ONCE across all groups + floats with no
 * unknown panels (registry drift -> reset, per §2.3 — a silently vanishing
 * panel is worse than a one-time reset).
 *
 * @returns {boolean}
 */
export function validateLayout(layout, registry, dockId = 'right') {
  if (!layout || typeof layout !== 'object') return false;
  if (layout.version !== LAYOUT_VERSION) return false;
  const dock = layout.docks && layout.docks[dockId];
  if (!dock || !Array.isArray(dock.groups)) return false;

  const known = new Set(registryIds(registry));
  const seen = new Set();
  const visitGroup = (g) => {
    if (!g || !Array.isArray(g.panels) || g.panels.length === 0) return false;
    for (const pid of g.panels) {
      if (!known.has(pid)) return false; // unknown panel
      if (seen.has(pid)) return false;   // duplicate
      seen.add(pid);
    }
    if (!g.panels.includes(g.active)) return false; // active not in group
    return true;
  };
  for (const g of dock.groups) if (!visitGroup(g)) return false;
  // floats array may exist (deferred); validate any entries the same way so a
  // forward-compatible payload written by a later phase still round-trips.
  if (layout.floats) {
    if (!Array.isArray(layout.floats)) return false;
    for (const g of layout.floats) if (!visitGroup(g)) return false;
  }
  // Every registered panel must be placed exactly once.
  return seen.size === known.size;
}

/**
 * Load layout from storage, falling back to the default when missing, corrupt,
 * or invalid against the current registry.
 *
 * @param {Object} registry
 * @param {Object} [opts]
 * @param {Storage} [opts.storage] storage shim (defaults to window.localStorage)
 * @param {string}  [opts.dockId]
 * @returns {Object}
 */
export function loadLayout(registry, opts = {}) {
  const dockId = opts.dockId || 'right';
  const storage = opts.storage || _defaultStorage();
  const fallback = () => createDefaultLayout(registry, dockId);
  if (!storage) return fallback();
  let raw;
  try { raw = storage.getItem(LS_KEY); } catch { return fallback(); }
  if (!raw) return fallback();
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return fallback(); }
  if (!validateLayout(parsed, registry, dockId)) {
    // Log once at debug level; never throw — a corrupt payload silently resets.
    try { console.debug('[panel-dock] stored layout invalid; using default'); } catch {}
    return fallback();
  }
  return parsed;
}

/** Persist a layout. Guarded — storage may be unavailable / quota-full. */
export function persistLayout(layout, opts = {}) {
  const storage = opts.storage || _defaultStorage();
  if (!storage) return false;
  try { storage.setItem(LS_KEY, JSON.stringify(layout)); return true; } catch { return false; }
}

function _defaultStorage() {
  try { return (typeof localStorage !== 'undefined') ? localStorage : null; } catch { return null; }
}

/* ------------------------------------------------------------------ *
 * Reducer actions — pure (layout) -> layout, no DOM, no side effects.
 * Each returns a NEW layout (structuredClone) so callers can diff / undo.
 * ------------------------------------------------------------------ */

function clone(layout) {
  return (typeof structuredClone === 'function')
    ? structuredClone(layout)
    : JSON.parse(JSON.stringify(layout));
}

function findGroup(layout, groupId, dockId) {
  const dock = layout.docks[dockId];
  return dock ? dock.groups.find((g) => g.id === groupId) : null;
}

/** Toggle (or force) a group's collapsed flag. */
export function toggleCollapse(layout, groupId, opts = {}) {
  const dockId = opts.dockId || 'right';
  const next = clone(layout);
  const g = findGroup(next, groupId, dockId);
  if (!g) return next;
  g.collapsed = (opts.force === undefined) ? !g.collapsed : !!opts.force;
  return next;
}

/** Raise a tab within its group (no-op if the panel is not in the group). */
export function setActiveTab(layout, groupId, panelId, opts = {}) {
  const dockId = opts.dockId || 'right';
  const next = clone(layout);
  const g = findGroup(next, groupId, dockId);
  if (g && g.panels.includes(panelId)) g.active = panelId;
  return next;
}

/**
 * Merge a panel into a target group as a new tab (the static-grouping action
 * that Phase 2 exposes via the overflow menu; the Phase-3 DnD merge calls the
 * same reducer). Removes the panel from its source group, pushes it onto the
 * target, makes it active. An emptied source group is deleted. The dragged
 * panel keeps the dock's invariant (every panel exactly once).
 *
 * @param {Object} layout
 * @param {string} panelId      panel to move
 * @param {string} targetGroupId group to merge into
 */
export function groupPanels(layout, panelId, targetGroupId, opts = {}) {
  const dockId = opts.dockId || 'right';
  const next = clone(layout);
  const dock = next.docks[dockId];
  if (!dock) return next;
  const target = dock.groups.find((g) => g.id === targetGroupId);
  if (!target) return next;
  // Remove the panel from whatever group currently holds it.
  let moved = false;
  for (const g of dock.groups) {
    const i = g.panels.indexOf(panelId);
    if (i !== -1) {
      g.panels.splice(i, 1);
      if (g.active === panelId) g.active = g.panels[0]; // re-point active
      moved = true;
      break;
    }
  }
  if (!moved) return next; // panel not found in this dock
  if (!target.panels.includes(panelId)) target.panels.push(panelId);
  target.active = panelId;
  // Drop any group emptied by the move (and re-point its active if needed).
  dock.groups = dock.groups.filter((g) => g.panels.length > 0);
  return next;
}

/**
 * Split a panel out of its (multi-panel) group into its own single-panel group,
 * inserted at `index` in dock order. The inverse of groupPanels; used by the
 * "ungroup" overflow action and the Phase-3 reorder-out-of-tab drop.
 */
export function ungroupPanel(layout, panelId, index, opts = {}) {
  const dockId = opts.dockId || 'right';
  const next = clone(layout);
  const dock = next.docks[dockId];
  if (!dock) return next;
  let src = null;
  for (const g of dock.groups) {
    if (g.panels.includes(panelId)) { src = g; break; }
  }
  if (!src || src.panels.length <= 1) return next; // already alone
  src.panels = src.panels.filter((p) => p !== panelId);
  if (src.active === panelId) src.active = src.panels[0];
  const newGroup = { id: _newGroupId(dock), panels: [panelId], active: panelId, collapsed: false };
  const at = (index == null) ? dock.groups.length : Math.max(0, Math.min(index, dock.groups.length));
  dock.groups.splice(at, 0, newGroup);
  return next;
}

/** Move a group to a new index in dock order (Phase-3 reorder reducer). */
export function reorderGroup(layout, groupId, index, opts = {}) {
  const dockId = opts.dockId || 'right';
  const next = clone(layout);
  const dock = next.docks[dockId];
  if (!dock) return next;
  const from = dock.groups.findIndex((g) => g.id === groupId);
  if (from === -1) return next;
  const [g] = dock.groups.splice(from, 1);
  const at = Math.max(0, Math.min(index, dock.groups.length));
  dock.groups.splice(at, 0, g);
  return next;
}

function _newGroupId(dock) {
  let n = 1;
  const ids = new Set(dock.groups.map((g) => g.id));
  while (ids.has('g-split-' + n)) n++;
  return 'g-split-' + n;
}

/* ------------------------------------------------------------------ *
 * DOM controller — thin glue. Renders the dock from a layout, wires
 * collapse + tab clicks, persists on every mutation. Bodies are moved.
 * ------------------------------------------------------------------ */

const CHEVRON_OPEN = '▾';   // ▾
const CHEVRON_CLOSED = '▸'; // ▸

/**
 * Mount the dock controller into a root element.
 *
 * @param {HTMLElement} root      container the dock DOM is rendered into
 * @param {Object}      registry  panel-id -> descriptor
 * @param {Object}      [opts]
 * @param {Storage}     [opts.storage] storage shim (test seam)
 * @param {string}      [opts.dockId]
 * @param {Document}    [opts.doc]   document for node creation (test seam)
 * @param {(panelId:string)=>HTMLElement|null} [opts.resolveBody]
 *        override body lookup (defaults to root.querySelector(desc.bodySel));
 *        lets the caller hand the controller live nodes that live elsewhere.
 * @returns {Object} controller API
 */
export function mountDock(root, registry, opts = {}) {
  if (!root) throw new Error('mountDock: root element required');
  const dockId = opts.dockId || 'right';
  const doc = opts.doc || root.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc) throw new Error('mountDock: no document available');
  const storage = opts.storage || _defaultStorage();
  const resolveBody = opts.resolveBody || ((pid) => {
    const sel = registry[pid] && registry[pid].bodySel;
    return sel ? root.querySelector(sel) : null;
  });

  let layout = loadLayout(registry, { storage, dockId });

  // Persisted-body cache: body nodes are looked up once and reused across
  // re-renders so we keep moving the SAME live node (preserving its state).
  const bodyCache = new Map();
  function bodyFor(pid) {
    if (!bodyCache.has(pid)) bodyCache.set(pid, resolveBody(pid));
    return bodyCache.get(pid);
  }

  const dockEl = doc.createElement('div');
  dockEl.className = 'ge-dock';
  dockEl.dataset.dock = dockId;
  root.appendChild(dockEl);

  function commit(nextLayout) {
    layout = nextLayout;
    persistLayout(layout, { storage });
    render();
  }

  function render() {
    // Detach existing body nodes before clearing so they are not destroyed;
    // they get re-homed below. (Clearing innerHTML would orphan but not
    // destroy them, yet detaching first keeps listeners untouched and avoids
    // a flash of layout.)
    for (const pid of registryIds(registry)) {
      const b = bodyFor(pid);
      if (b && b.parentNode) b.parentNode.removeChild(b);
    }
    dockEl.textContent = '';

    const dock = layout.docks[dockId];
    if (!dock) return;
    for (const g of dock.groups) {
      const groupEl = buildGroup(g);
      if (groupEl) dockEl.appendChild(groupEl);
    }
  }

  function buildGroup(g) {
    // Skip groups whose bodies are all missing (degrade gracefully).
    const present = g.panels.filter((pid) => !!bodyFor(pid));
    if (present.length === 0) return null;

    const groupEl = doc.createElement('div');
    groupEl.className = 'ge-panelgroup' + (present.length >= 2 ? ' tabbed' : '');
    groupEl.dataset.group = g.id;
    if (g.collapsed) groupEl.dataset.collapsed = 'true';

    const tabbed = present.length >= 2;
    const active = present.includes(g.active) ? g.active : present[0];

    const header = tabbed ? buildTabStrip(g, present, active) : buildHeader(g, present[0]);
    groupEl.appendChild(header);

    const bodyHost = doc.createElement('div');
    bodyHost.className = 'ge-panel-body';
    bodyHost.dataset.active = active;
    for (const pid of present) {
      const node = bodyFor(pid);
      // Tab visibility = cheap display swap within the host (the same
      // mechanism the legacy color tabs used).
      node.classList.add('ge-panel-body-slot');
      node.dataset.panel = pid;
      node.style.display = (pid === active) ? '' : 'none';
      bodyHost.appendChild(node);
    }
    groupEl.appendChild(bodyHost);
    return groupEl;
  }

  function chevronBtn(g) {
    const chevron = doc.createElement('button');
    chevron.type = 'button';
    chevron.className = 'ge-panel-chevron';
    chevron.textContent = g.collapsed ? CHEVRON_CLOSED : CHEVRON_OPEN;
    chevron.setAttribute('aria-expanded', String(!g.collapsed));
    chevron.title = g.collapsed ? 'Expand' : 'Collapse';
    chevron.addEventListener('click', (e) => {
      e.stopPropagation();
      commit(toggleCollapse(layout, g.id, { dockId }));
    });
    return chevron;
  }

  function buildHeader(g, panelId) {
    const header = doc.createElement('div');
    header.className = 'ge-panel-header';
    header.appendChild(chevronBtn(g));
    const title = doc.createElement('span');
    title.className = 'ge-panel-title';
    title.textContent = titleFor(panelId);
    header.appendChild(title);
    // Make the whole header keyboard-toggle the collapse (Enter/Space) for
    // reach parity with the chevron (DESIGN-GUIDE §9 Human).
    header.tabIndex = 0;
    header.setAttribute('role', 'button');
    header.setAttribute('aria-expanded', String(!g.collapsed));
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        commit(toggleCollapse(layout, g.id, { dockId }));
      }
    });
    return header;
  }

  function buildTabStrip(g, present, active) {
    const strip = doc.createElement('div');
    strip.className = 'ge-panel-tabs';
    strip.setAttribute('role', 'tablist');
    for (const pid of present) {
      const tab = doc.createElement('button');
      tab.type = 'button';
      tab.className = 'ge-panel-tab' + (pid === active ? ' active' : '');
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(pid === active));
      tab.dataset.panel = pid;
      tab.textContent = titleFor(pid);
      tab.title = titleFor(pid);
      tab.tabIndex = (pid === active) ? 0 : -1; // roving tabindex
      tab.addEventListener('click', () => {
        commit(setActiveTab(layout, g.id, pid, { dockId }));
      });
      tab.addEventListener('keydown', (e) => onTabKey(e, g, present, pid));
      strip.appendChild(tab);
    }
    const spacer = doc.createElement('span');
    spacer.className = 'ge-panel-tabs-spacer';
    strip.appendChild(spacer);
    strip.appendChild(chevronBtn(g));
    return strip;
  }

  // Arrow-key navigation between tabs (DESIGN-GUIDE accessibility: keyboard
  // tab switch). Left/Right move + raise; Home/End jump to ends.
  function onTabKey(e, g, present, pid) {
    const i = present.indexOf(pid);
    let target = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') target = present[(i + 1) % present.length];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') target = present[(i - 1 + present.length) % present.length];
    else if (e.key === 'Home') target = present[0];
    else if (e.key === 'End') target = present[present.length - 1];
    if (!target) return;
    e.preventDefault();
    commit(setActiveTab(layout, g.id, target, { dockId }));
    // Re-focus the now-active tab after re-render.
    const next = dockEl.querySelector(`.ge-panel-tab[data-panel="${cssEsc(target)}"]`);
    if (next) next.focus();
  }

  function titleFor(pid) {
    const d = registry[pid];
    return (d && d.title) || pid;
  }

  render();

  /* ----- public API ----- */
  return {
    /** Re-render from current layout (e.g. after an external body became available). */
    render,
    /** Current layout (clone — callers must not mutate it in place). */
    getLayout: () => clone(layout),
    /** Replace the layout wholesale (validated; invalid -> ignored, returns false). */
    setLayout(next) {
      if (!validateLayout(next, registry, dockId)) return false;
      commit(next);
      return true;
    },
    /** Reset to the registry-derived default and persist. */
    reset() { commit(createDefaultLayout(registry, dockId)); },
    /** Programmatic collapse/expand (mirrors the chevron). */
    setCollapsed(groupId, collapsed) { commit(toggleCollapse(layout, groupId, { dockId, force: collapsed })); },
    /** Programmatic tab raise. */
    setActive(groupId, panelId) { commit(setActiveTab(layout, groupId, panelId, { dockId })); },
    /** Static grouping (overflow "Tab with…" action). */
    group(panelId, targetGroupId) { commit(groupPanels(layout, panelId, targetGroupId, { dockId })); },
    /** Split a panel back out of its tab group. */
    ungroup(panelId, index) { commit(ungroupPanel(layout, panelId, index, { dockId })); },
    /** The dock root element (for the caller to position / style). */
    el: dockEl,

    /**
     * Esc hard-guard hook (DESIGN-GUIDE §6). The editor's window-capture Esc
     * guard calls this; it returns true iff it closed a transient (an open
     * overflow menu, later a focused float). Phase 1 has no transient overlay,
     * so it returns false and lets the guard's default swallow stand.
     */
    dismissTopTransient() { return false; },

    /* ----- DEFERRED SEAM (Phases 3-4) ----- *
     * These name the future capabilities so the integration site can be wired
     * once. They throw rather than silently no-op so a premature call is loud.
     * The layout model already carries `floats`; these only add DOM + a DnD FSM.
     */
    _seam: {
      /** Phase 3: pointer-FSM drag reorder + merge-as-tab. */
      enableDrag() { throw new Error('panel-dock: drag reorder is a Phase 3 seam (not implemented)'); },
      /** Phase 4: undock a group into a floating window over the canvas. */
      floatGroup() { throw new Error('panel-dock: floating/undock is a Phase 4 seam (not implemented)'); },
      /** Phase 4: re-dock a floating group. */
      redockGroup() { throw new Error('panel-dock: re-dock is a Phase 4 seam (not implemented)'); },
    },
  };
}

/** Minimal CSS.escape fallback for the small set of ids we generate. */
function cssEsc(s) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
  return String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);
}
