/**
 * Actions — record a sequence of editor commands and replay it (PS Actions).
 * Built directly on the command registry: recording = subscribing to
 * onCommandRun(); playback = re-running the captured (id, args) stream. So any
 * op that goes through runCommand() (scripted, clicked, or menu) is recordable
 * with zero per-op work. Saved actions persist to localStorage.
 *
 * Continuous strokes aren't commands (they're in undo already), so — like PS —
 * Actions capture discrete ops (adjustments, fills, flips, layer ops, …).
 *
 * @param {{ saveState: (label?:string)=>void, composite?: ()=>void }} deps
 */
import { onCommandRun, runCommand, getCommand } from './commands.js';

const LS_KEY = 'ge-actions-v1';

export function wireActions({ saveState, composite }) {
  if (document.getElementById('ge-actions-panel')) return;
  const host = document.getElementById('gallery-editor-container') || document.body;

  const panel = document.createElement('div');
  panel.id = 'ge-actions-panel';
  panel.style.display = 'none';
  panel.innerHTML = `
    <div class="ge-actions-head"><span>Actions</span><button type="button" class="ge-actions-close" title="Close">×</button></div>
    <div class="ge-actions-bar">
      <button type="button" class="ge-btn ge-btn-sm" id="ge-actions-record">● Record</button>
      <button type="button" class="ge-btn ge-btn-sm" id="ge-actions-save">Save…</button>
      <button type="button" class="ge-btn ge-btn-sm" id="ge-actions-clear">Clear</button>
    </div>
    <div class="ge-actions-steps" id="ge-actions-steps"></div>
    <div class="ge-actions-saved-title">Saved actions</div>
    <div class="ge-actions-saved" id="ge-actions-saved"></div>`;
  host.appendChild(panel);

  const toggle = document.createElement('button');
  toggle.id = 'ge-actions-toggle';
  toggle.style.display = 'none';
  toggle.addEventListener('click', () => { panel.style.display = panel.style.display === 'none' ? '' : 'none'; });
  host.appendChild(toggle);

  let recording = false;
  let unsub = null;
  let steps = [];                 // [{ id, args, label }]
  let saved = load();             // [{ name, steps }]

  const recordBtn = panel.querySelector('#ge-actions-record');
  const stepsEl = panel.querySelector('#ge-actions-steps');
  const savedEl = panel.querySelector('#ge-actions-saved');

  function load() { try { const v = JSON.parse(localStorage.getItem(LS_KEY)); return Array.isArray(v) ? v : []; } catch { return []; } }
  function persist() { try { localStorage.setItem(LS_KEY, JSON.stringify(saved)); } catch {} }

  // Snapshot args by value. runCommand hands recorders the SAME args object it
  // passed to run(), and the caller may mutate/reuse it after the call — keeping
  // the reference would let later mutations corrupt an already-recorded step.
  // A JSON round-trip matches the persistence contract (steps are serialized to
  // localStorage anyway); non-JSON values are dropped, same as on save.
  function cloneArgs(args) {
    if (args == null) return args;
    try { return JSON.parse(JSON.stringify(args)); } catch { return {}; }
  }

  const EMPTY_STEPS_HTML = '<div class="ge-actions-empty">No steps. Click ● Record, then run adjustments / fills / flips / layer ops.</div>';
  function stepHTML(s) { return `<div class="ge-actions-step">${(s.label || s.id).replace(/[<>&]/g, '')}</div>`; }
  function renderSteps() {
    stepsEl.innerHTML = steps.length ? steps.map(stepHTML).join('') : EMPTY_STEPS_HTML;
  }
  // Append a single step row instead of rebuilding the whole list. The recorder
  // callback fires once per recorded command, so a full innerHTML regeneration
  // there is O(n) per op (quadratic over a recording session).
  function appendStepEl(s) {
    const empty = stepsEl.querySelector('.ge-actions-empty');
    if (empty) empty.remove();
    stepsEl.insertAdjacentHTML('beforeend', stepHTML(s));
  }
  function renderSaved() {
    savedEl.innerHTML = '';
    saved.forEach((a, i) => {
      const row = document.createElement('div');
      row.className = 'ge-actions-saved-row';
      const name = document.createElement('span');
      name.className = 'ge-actions-saved-name';
      name.textContent = `${a.name} (${a.steps.length})`;
      const play = document.createElement('button');
      play.className = 'ge-btn ge-btn-sm'; play.textContent = '▶'; play.title = 'Play';
      play.addEventListener('click', () => playAction(a));
      const del = document.createElement('button');
      del.className = 'ge-btn ge-btn-sm'; del.textContent = '×'; del.title = 'Delete';
      del.addEventListener('click', () => { saved.splice(i, 1); persist(); renderSaved(); });
      row.append(name, play, del);
      savedEl.appendChild(row);
    });
  }

  function setRecording(on) {
    recording = on;
    recordBtn.classList.toggle('recording', on);
    recordBtn.textContent = on ? '■ Stop' : '● Record';
    if (on) {
      steps = []; renderSteps();
      unsub = onCommandRun((step) => {
        const c = getCommand(step.id);
        const entry = { id: step.id, args: cloneArgs(step.args), label: c ? c.label : step.id };
        steps.push(entry);
        appendStepEl(entry);
      });
    } else if (unsub) { unsub(); unsub = null; }
  }

  // Replay as ONE undo step: snapshot once, then run each command without its
  // own history snapshot and without re-recording.
  function playSteps(list) {
    if (!list || !list.length) return;
    // Skip if no step maps to a known command (e.g. a saved action whose ops no
    // longer exist) — otherwise saveState() would push a spurious empty undo
    // entry for a play that does nothing.
    const runnable = list.filter((s) => getCommand(s.id));
    if (!runnable.length) return;
    saveState('Play action');
    for (const s of runnable) {
      try { runCommand(s.id, s.args, { history: false, record: false, composite: false }); } catch (e) { console.error('[actions] step failed', s.id, e); }
    }
    if (composite) composite();
  }
  function playAction(a) { playSteps(a.steps); }

  recordBtn.addEventListener('click', () => setRecording(!recording));
  panel.querySelector('#ge-actions-clear').addEventListener('click', () => { steps = []; renderSteps(); });
  panel.querySelector('#ge-actions-save').addEventListener('click', () => {
    if (!steps.length) return;
    const name = window.prompt('Action name', 'Action ' + (saved.length + 1));
    if (name == null) return;
    saved.push({ name: name.trim() || ('Action ' + (saved.length + 1)), steps: steps.map((s) => ({ id: s.id, args: cloneArgs(s.args) })) });
    persist(); renderSaved();
  });
  panel.querySelector('.ge-actions-close').addEventListener('click', () => { panel.style.display = 'none'; });

  renderSteps();
  renderSaved();

  // wireActions runs per editor open; the recorder subscription (onCommandRun)
  // outlives the panel if the editor is torn down mid-recording, leaking the
  // closure (and silently capturing commands into a detached panel). Watch for
  // the panel being detached and stop recording — setRecording(false) calls
  // unsub() — then stop observing. Mirrors wire-menu-bar.js's lifecycle teardown.
  if (typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(() => {
      if (!panel.isConnected) {
        if (recording) setRecording(false);
        else if (unsub) { unsub(); unsub = null; }
        observer.disconnect();
      }
    });
    observer.observe(document, { childList: true, subtree: true });
  }
}
