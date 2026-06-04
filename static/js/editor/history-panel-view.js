/**
 * History-panel VIEW — a self-contained, Photoshop-style visual History list
 * that renders the editor's labeled undo/redo timeline into a host element you
 * provide, highlights the current position, and jumps the document to any state
 * on click.
 *
 * ── Why this module (and how it relates to the existing one) ──────────────────
 * There is already an `editor/history-panel.js` that owns the FLOATING, topbar-
 * anchored, draggable/minimisable History popup (its factory is
 * `createHistoryPanel({ undo, redo })` → `{ toggleHistoryPanel, … }`, coupled to
 * `state.historyPanelEl`, `modalManager`, and `build/popups.js`). This file is a
 * *different* deliverable: a dependency-injected list view that mounts into ANY
 * `rootEl` (e.g. a docked side-panel tab in the new panel-docking system) with no
 * topbar / modalManager / global-singleton coupling. It deliberately exports a
 * distinct name (`createHistoryPanelView`) and lives in a distinct file so it
 * never clobbers the production popup.
 *
 * ── What is the source of truth for history? ─────────────────────────────────
 * `editor/undo-tiles.js` is ONLY the tile copy-on-write *storage* primitive
 * (`tileize` / `detileTo` / `entryBytes`). It exposes NO enumerable list of
 * states, no current-index, and no undo()/redo() — it just packs/unpacks a
 * single snapshot's pixels. The enumerable history actually lives on the central
 * `state` object as two arrays the editor's orchestration maintains
 * (galleryEditor.js `_saveState` / `undo` / `redo`):
 *
 *     state.undoStack   // past states, oldest→newest; each has `_label`, `_ts`
 *     state.redoStack   // future states, newest→oldest (LIFO); each has `_label`, `_ts`
 *
 * The CURRENT document sits implicitly BETWEEN those two stacks. A new edit
 * pushes onto `undoStack` and clears `redoStack` (PS linear-history truncation —
 * we don't fight it; we render whatever the stacks say). So this view ENUMERATES
 * those two arrays (the "use step count / labels" path the brief asks for), and
 * JUMPS by calling the injected `undo()` / `redo()` the right number of times —
 * the exact same machinery the keyboard shortcuts and topbar use. We never poke
 * the stacks directly, so correctness stays owned by galleryEditor.js.
 *
 * Offset convention (matches galleryEditor's `_jumpToHistory`):
 *   offset < 0  → step BACK   |offset| times  (undo)
 *   offset > 0  → step FORWARD  offset times   (redo)
 *   offset = 0  → current (no-op)
 *
 * ── Dependencies (injected via the factory) ──────────────────────────────────
 *   rootEl  HTMLElement   host to render into (innerHTML is owned by this view).
 *   undo    () => void    the editor's undo (galleryEditor `undo`).
 *   redo    () => void    the editor's redo (galleryEditor `redo`). Optional; if
 *                         absent, forward jumps are disabled (back-only history).
 *   state   object        the central editor state (for undoStack/redoStack).
 *   onJump  (offset,row)  optional callback after a successful jump (e.g. to
 *                         re-composite, or to refresh other panels). The view
 *                         already re-renders itself; this is for side effects.
 *
 * No imports from heavy editor modules are required — everything comes through
 * the factory, keeping this view portable and unit-testable. (`relTime` is a
 * 6-line pure helper inlined below so the view has zero import surface; it
 * matches `editor/layer-helpers.js`'s `relTime` formatting.)
 */

// Relative-time formatter — mirrors editor/layer-helpers.js `relTime` so the
// rendered timestamps read identically to the rest of the editor, without
// pulling in that module's import graph.
function relTime(ts) {
  if (!ts) return '';
  const dt = (Date.now() - ts) / 1000;
  if (dt < 5) return 'now';
  if (dt < 60) return Math.round(dt) + 's';
  if (dt < 3600) return Math.round(dt / 60) + 'm';
  return Math.round(dt / 3600) + 'h';
}

// Escape the three characters that matter when interpolating a user-controlled
// label into innerHTML. Layer/op labels can contain a layer name the user typed
// (e.g. `Delete layer "<img>"`), so this guards XSS the same way the layer panel
// and the existing history popup do (`.replace(/[<>&]/g, '')`), but as a proper
// entity-escape rather than a strip so the text stays faithful.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * @param {{
 *   rootEl: HTMLElement,
 *   undo: () => void,
 *   redo?: () => void,
 *   state: { undoStack: any[], redoStack: any[] },
 *   onJump?: (offset: number, row: object) => void,
 * }} deps
 * @returns {{ refresh: () => void, jump: (offset: number) => void, dispose: () => void }}
 */
export function createHistoryPanelView({ rootEl, undo, redo, state, onJump } = {}) {
  if (!rootEl) throw new Error('createHistoryPanelView: rootEl is required');
  if (typeof undo !== 'function') throw new Error('createHistoryPanelView: undo() is required');
  if (!state) throw new Error('createHistoryPanelView: state is required');

  let disposed = false;

  // While a multi-step jump runs, each undo()/redo() call may trigger the
  // editor's own history-refresh path (galleryEditor calls
  // `_refreshHistoryPanelIfOpen()` inside undo/redo). If THIS view is also wired
  // to that refresh, we'd rebuild the DOM once per step — O(n) churn for a
  // single jump. Suppress our own refresh during a jump and run exactly one at
  // the end. (Mirrors the `_suppressRefresh` guard in editor/history-panel.js.)
  let suppressRefresh = false;

  // Build the static shell once; refresh() only rewrites the scrollable list.
  rootEl.innerHTML = `
    <div class="ge-history-list" id="ge-history-view-list" role="listbox"
         aria-label="Document history"></div>`;
  const listEl = rootEl.querySelector('#ge-history-view-list');

  // Single delegated click handler for all rows (cheaper than per-row wiring on
  // every refresh, and survives innerHTML rebuilds since it's bound to listEl).
  function onListClick(e) {
    const btn = e.target.closest('.ge-history-row');
    if (!btn || !listEl.contains(btn)) return;
    const off = parseInt(btn.dataset.offset, 10);
    if (Number.isFinite(off)) jump(off);
  }
  // Keyboard: Enter/Space on a focused row activates it (rows are <button>s, so
  // browsers already do this, but we keep arrow-key roving for a11y parity).
  function onListKey(e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = Array.from(listEl.querySelectorAll('.ge-history-row'));
    if (!rows.length) return;
    const i = rows.indexOf(document.activeElement);
    e.preventDefault();
    const next = e.key === 'ArrowDown'
      ? rows[Math.min(rows.length - 1, i + 1)]
      : rows[Math.max(0, i - 1)];
    if (next) next.focus();
  }
  listEl.addEventListener('click', onListClick);
  listEl.addEventListener('keydown', onListKey);

  /**
   * Jump the document to the state `offset` steps from current by replaying the
   * editor's real undo()/redo() — so undo-tiles detile + every side effect the
   * editor attaches to a step (composite, persist, etc.) happen exactly as if
   * the user pressed the shortcut that many times. Linear history: jumping back
   * then editing truncates the forward states, because the editor's saveState
   * clears redoStack — we don't special-case it here.
   */
  function jump(offset) {
    if (disposed || !offset) return;
    // Clamp to what's actually available so a stale row (rendered just before
    // the stacks changed) can't over-step past the ends.
    const back = Math.min(-offset, state.undoStack.length);
    const fwd = Math.min(offset, state.redoStack.length);
    suppressRefresh = true;
    try {
      if (offset < 0) {
        for (let i = 0; i < back; i++) undo();
      } else if (offset > 0) {
        if (typeof redo !== 'function') return; // back-only history
        for (let i = 0; i < fwd; i++) redo();
      }
    } finally {
      suppressRefresh = false;
    }
    refresh();
    if (typeof onJump === 'function') {
      try { onJump(offset, null); } catch (e) { console.error('[history-view] onJump:', e); }
    }
  }

  // Build the row model in chronological order — oldest at top, newest at the
  // bottom, the Current marker sitting between past and future, exactly like the
  // Photoshop History panel (and the existing popup). Each row carries the
  // signed `offset` the jump machinery needs.
  function buildRows() {
    const u = state.undoStack || [];
    const r = state.redoStack || [];
    const rows = [];
    // Past states (undo): index 0 is the oldest. The topmost row is the FARTHEST
    // back, so its offset is the most negative.
    for (let i = 0; i < u.length; i++) {
      rows.push({ offset: -(u.length - i), label: u[i]._label || 'Edit', ts: u[i]._ts, kind: 'past' });
    }
    // Current document position.
    rows.push({ offset: 0, label: 'Current', ts: Date.now(), kind: 'current' });
    // Future states (redo): redoStack is LIFO (top of stack = next redo), so the
    // closest future state is at the END of the array → render it nearest to
    // Current and the farthest-future at the bottom.
    for (let i = r.length - 1; i >= 0; i--) {
      rows.push({ offset: r.length - i, label: r[i]._label || 'Edit', ts: r[i]._ts, kind: 'future' });
    }
    return rows;
  }

  function rowHTML(row) {
    const cls = 'ge-history-row'
      + (row.kind === 'current' ? ' current' : '')
      + (row.kind === 'future' ? ' future' : '');
    // aria-current marks the live state for assistive tech; rows are real
    // <button>s so they're focusable / Enter-activatable for free.
    const ariaCurrent = row.kind === 'current' ? ' aria-current="true"' : '';
    const time = relTime(row.ts);
    return `<button type="button" class="${cls}" role="option" data-offset="${row.offset}"${ariaCurrent}>`
      + `<span class="ge-history-row-dot" aria-hidden="true"></span>`
      + `<span class="ge-history-row-label">${esc(row.label)}</span>`
      + `<span class="ge-history-row-time">${esc(time)}</span>`
      + `</button>`;
  }

  /**
   * Re-render the list from the current undoStack/redoStack. Cheap full rebuild
   * of the inner list HTML (the editor's history is bounded by MAX_HISTORY, so
   * this stays small); the delegated click/key handlers live on the container so
   * they survive the rebuild. Scrolls the Current marker into view.
   */
  function refresh() {
    if (disposed || suppressRefresh || !listEl) return;
    const rows = buildRows();
    listEl.innerHTML = rows.map(rowHTML).join('');
    const cur = listEl.querySelector('.ge-history-row.current');
    if (cur) {
      // Avoid yanking the whole page; only scroll within the list.
      try { cur.scrollIntoView({ block: 'nearest' }); } catch { cur.scrollIntoView(); }
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    listEl.removeEventListener('click', onListClick);
    listEl.removeEventListener('keydown', onListKey);
    rootEl.innerHTML = '';
  }

  // Initial paint.
  refresh();

  return { refresh, jump, dispose };
}

export default createHistoryPanelView;
