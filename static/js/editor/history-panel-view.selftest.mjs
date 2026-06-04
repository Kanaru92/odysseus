/**
 * Self-test for history-panel-view.js — runs under plain `node` with a tiny
 * hand-rolled DOM stub (no jsdom dep). It models the REAL galleryEditor stack
 * semantics (saveState pushes + clears redo; undo/redo move the implicit current
 * between the two stacks) and asserts the view enumerates + jumps correctly.
 *
 *   node static/js/editor/history-panel-view.selftest.mjs
 */
import { createHistoryPanelView } from './history-panel-view.js';

// ── Minimal DOM stub ────────────────────────────────────────────────────────
let _activeElement = null;
class El {
  constructor(tag = 'div') {
    this.tagName = (tag || 'div').toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attrs = {};
    this._listeners = {};
    this._html = '';
    this.className = '';
  }
  set innerHTML(v) {
    this._html = v;
    // Parse just enough: each <button ... data-offset="N" ...> becomes a child.
    this.children = [];
    const re = /<button\b[^>]*class="([^"]*)"[^>]*data-offset="(-?\d+)"[^>]*>/g;
    let m;
    while ((m = re.exec(v))) {
      const b = new El('button');
      b.className = m[1];
      b.dataset.offset = m[2];
      b.parentList = this;
      this.children.push(b);
    }
  }
  get innerHTML() { return this._html; }
  querySelector(sel) {
    if (sel.startsWith('#')) return this._byId(sel.slice(1));
    return this.querySelectorAll(sel)[0] || null;
  }
  querySelectorAll(sel) {
    // Supports '.ge-history-row', '.ge-history-row.current'.
    const classes = sel.split('.').filter(Boolean);
    const out = [];
    const walk = (n) => {
      for (const c of n.children) {
        const cl = c.className.split(/\s+/);
        if (classes.every((k) => cl.includes(k))) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  _byId(id) {
    if (this.attrs.id === id) return this;
    for (const c of this.children) { const r = c._byId && c._byId(id); if (r) return r; }
    // The view sets id via the literal string in innerHTML; emulate the one id
    // it queries ('ge-history-view-list') by returning a synthesised list node.
    return null;
  }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  removeEventListener(t, fn) {
    if (this._listeners[t]) this._listeners[t] = this._listeners[t].filter((f) => f !== fn);
  }
  contains(n) {
    if (n === this) return true;
    return this.children.some((c) => c.contains(c) && (c === n || c.contains(n)));
  }
  closest(sel) {
    const k = sel.replace('.', '');
    let n = this;
    while (n) { if ((n.className || '').split(/\s+/).includes(k)) return n; n = n.parentList || null; }
    return null;
  }
  scrollIntoView() {}
  focus() { _activeElement = this; }
  dispatchClick() {
    const ls = (this.parentList && this.parentList._listeners.click) || [];
    for (const fn of ls) fn({ target: this });
  }
}

// The view does rootEl.innerHTML = '...' then rootEl.querySelector('#ge-history-view-list').
// Our El.innerHTML parser only extracts buttons; give querySelector a hook so
// '#ge-history-view-list' returns a dedicated list element that the view then
// writes rows into.
const listNode = new El('div');
listNode.attrs.id = 'ge-history-view-list';
class Root extends El {
  querySelector(sel) {
    if (sel === '#ge-history-view-list') return listNode;
    return super.querySelector(sel);
  }
}
global.document = { activeElement: null };
Object.defineProperty(global.document, 'activeElement', { get: () => _activeElement });

// ── Faithful stack model (mirrors galleryEditor _saveState/undo/redo) ─────────
const state = { undoStack: [], redoStack: [] };
let docVersion = 'v0'; // stand-in for the restored snapshot identity

function saveState(label) {
  state.undoStack.push({ _label: label || 'Edit', _ts: Date.now(), _v: docVersion });
  state.redoStack = []; // PS truncation
}
function undo() {
  if (!state.undoStack.length) return;
  state.redoStack.push({ _label: 'Current', _ts: Date.now(), _v: docVersion });
  const s = state.undoStack.pop();
  docVersion = s._v;
}
function redo() {
  if (!state.redoStack.length) return;
  state.undoStack.push({ _label: 'Current', _ts: Date.now(), _v: docVersion });
  const s = state.redoStack.pop();
  docVersion = s._v;
}

// ── Assertions ────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function eq(a, b, msg) {
  if (a === b) { pass++; }
  else { fail++; console.error(`FAIL: ${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
}

// Build a 3-edit history. Each save bumps docVersion so we can verify the jump
// lands on the right snapshot.
docVersion = 'A'; saveState('Brush');
docVersion = 'B'; saveState('Fill');
docVersion = 'C'; saveState('Crop');
docVersion = 'D'; // current doc state after the 3 edits

const root = new Root('div');
let lastJump = null;
const view = createHistoryPanelView({
  rootEl: root, undo, redo, state,
  onJump: (off) => { lastJump = off; },
});

// Rows = 3 past + 1 current = 4. Current is the last row.
let rows = listNode.querySelectorAll('.ge-history-row');
eq(rows.length, 4, 'row count = 3 past + current');
eq(listNode.querySelectorAll('.ge-history-row.current').length, 1, 'exactly one current row');
eq(rows[0].dataset.offset, '-3', 'oldest row offset = -3');
eq(rows[3].dataset.offset, '0', 'current row offset = 0');

// Jump back to the FIRST edit (offset -3 → undo x3). Lands on snapshot 'A'.
view.jump(-3);
eq(docVersion, 'A', 'jump(-3) restores oldest snapshot A');
eq(state.undoStack.length, 0, 'undoStack drained after jump(-3)');
eq(state.redoStack.length, 3, 'redoStack filled after jump(-3)');
eq(lastJump, -3, 'onJump fired with offset -3');

// After that jump the view re-rendered: now 0 past + current + 3 future = 4.
rows = listNode.querySelectorAll('.ge-history-row');
eq(rows.length, 4, 'row count after back-jump still 4 (now 3 future)');
eq(listNode.querySelectorAll('.ge-history-row.future').length, 3, '3 future rows');
eq(rows[0].dataset.offset, '0', 'current is now the top row');
eq(rows[3].dataset.offset, '3', 'farthest future offset = +3');

// Jump forward 2 (redo x2) → snapshot 'C'.
view.jump(2);
eq(docVersion, 'C', 'jump(+2) redoes to snapshot C');
eq(state.undoStack.length, 2, 'undoStack=2 after forward jump');
eq(state.redoStack.length, 1, 'redoStack=1 after forward jump');

// PS truncation: a NEW edit here drops the single forward state.
docVersion = 'E'; saveState('Paint');
eq(state.redoStack.length, 0, 'new edit truncates forward states');
view.refresh();
eq(listNode.querySelectorAll('.ge-history-row.future').length, 0, 'no future rows after new edit');

// Clicking a row drives jump() via the delegated handler.
rows = listNode.querySelectorAll('.ge-history-row');
const backOne = rows.find((r) => r.dataset.offset === '-1');
backOne.parentList = listNode;
lastJump = null;
backOne.dispatchClick();
eq(lastJump, -1, 'row click triggers jump(-1)');

// Over-step clamp: ask to go back further than available — must not throw and
// must drain to exactly the available depth.
const depth = state.undoStack.length;
view.jump(-999);
eq(state.undoStack.length, 0, 'jump(-999) clamps to available depth (no underflow)');
eq(depth >= 0, true, 'pre-jump depth was non-negative');

// dispose() clears the host and detaches handlers.
view.dispose();
eq(root.innerHTML, '', 'dispose clears rootEl');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
