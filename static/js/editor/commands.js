/**
 * Command / operation registry — the single spine that makes every discrete
 * editor operation uniformly:
 *   • UNDOABLE   — runCommand() snapshots history (saveState) before an
 *                  undoable op, so nothing has to remember to do it itself.
 *   • SCRIPTABLE — the Script Console exposes ge.run(id, args) / ge.commands().
 *   • RECORDABLE — Actions subscribes via onCommandRun() and replays the
 *                  captured command stream.
 *   • DISCOVERABLE — menus / panels can be generated from the registry.
 *
 * A command is { id, label, undoable, run(args)->any }. `run` does the actual
 * work (usually delegating to existing editor logic); it must NOT call
 * saveState itself — runCommand owns history so a command behaves identically
 * whether fired by a click, a script, or an Action replay.
 *
 * Pure + dependency-light: the editor injects saveState/composite once via
 * initCommands(); everything else is data.
 */

const _registry = new Map();      // id -> { id, label, undoable, run }
const _listeners = new Set();     // fn({ id, args }) — recorders (Actions)
const _hooks = {};                // { saveState, composite }

/** Inject editor hooks once (saveState for history, composite for redraw). */
export function initCommands(hooks) {
  _hooks.saveState = hooks && hooks.saveState;
  _hooks.composite = hooks && hooks.composite;
}

/** Register an operation. def: { label?, undoable?, run(args) }. */
export function registerCommand(id, def) {
  if (!id || !def || typeof def.run !== 'function') throw new Error('registerCommand needs id + run()');
  _registry.set(id, { id, label: def.label || id, undoable: def.undoable !== false, run: def.run });
}

export function getCommand(id) { return _registry.get(id) || null; }
export function hasCommand(id) { return _registry.has(id); }
export function listCommands() {
  return [..._registry.values()].map((c) => ({ id: c.id, label: c.label, undoable: c.undoable }));
}

/** Subscribe to command runs (for Actions recording). Returns an unsubscribe fn. */
export function onCommandRun(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }

/**
 * Run a command by id.
 * @param {string} id
 * @param {object} [args]
 * @param {{ record?: boolean, history?: boolean, composite?: boolean }} [opts]
 *   record=false  → don't notify recorders (used during Action replay so a
 *                   replay doesn't re-record itself).
 *   history=false → skip the undo snapshot (e.g. inside a batch that already
 *                   snapshotted once).
 */
export function runCommand(id, args, opts) {
  const c = _registry.get(id);
  if (!c) throw new Error('Unknown command: ' + id);
  args = args || {};
  opts = opts || {};
  if (c.undoable && opts.history !== false && _hooks.saveState) {
    try { _hooks.saveState(c.label); } catch (e) { console.error('[commands] saveState failed for ' + id, e); }
  }
  let result;
  try { result = c.run(args); }
  catch (e) { console.error('[commands] ' + id + ' failed:', e); throw e; }
  if (opts.composite !== false && _hooks.composite) { try { _hooks.composite(); } catch {} }
  if (opts.record !== false) {
    for (const fn of _listeners) { try { fn({ id, args }); } catch (e) { console.error('[commands] recorder threw', e); } }
  }
  return result;
}
