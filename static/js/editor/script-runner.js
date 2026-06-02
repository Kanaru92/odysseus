/**
 * Script Console — a power-user scripting surface (like PS's scripting), letting
 * the artist automate/extend the editor with small JS snippets. Exposes a
 * curated `ge` API (layers, active layer + ctx, colour, adjustments, composite)
 * plus `state` and `log`. Runs the user's OWN code in the page context (this is
 * a local creative tool, not a sandbox for untrusted input).
 *
 * Toggled by a hidden #ge-script-toggle button (wired to a menu item).
 */
import { state } from './state.js';
import { runCommand, listCommands } from './commands.js';

export function wireScriptRunner({ composite, createLayer, renderLayerPanel, saveState, activeLayer }) {
  if (document.getElementById('ge-script-panel')) return;
  const host = document.getElementById('gallery-editor-container') || document.body;

  const panel = document.createElement('div');
  panel.id = 'ge-script-panel';
  panel.style.display = 'none';
  panel.innerHTML = `
    <div class="ge-script-head"><span>Script Console</span><button type="button" class="ge-script-close" title="Close">×</button></div>
    <textarea id="ge-script-code" spellcheck="false" placeholder="// ge: layers(), active(), ctx(), width()/height(), color(hex), addLayer(name), fill(style), adjust(type, params), composite(), save(label), log(...)
const l = ge.addLayer('Script');
ge.fill('#3a7bd5');
ge.log('layers:', ge.layers().length);"></textarea>
    <div class="ge-script-btns">
      <button type="button" class="ge-btn ge-btn-sm" id="ge-script-run">Run ▶</button>
      <button type="button" class="ge-btn ge-btn-sm" id="ge-script-clear">Clear</button>
    </div>
    <pre id="ge-script-out" class="ge-script-out"></pre>`;
  host.appendChild(panel);

  const toggle = document.createElement('button');
  toggle.id = 'ge-script-toggle';
  toggle.style.display = 'none';
  toggle.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'none' ? '' : 'none';
    if (panel.style.display !== 'none') document.getElementById('ge-script-code')?.focus();
  });
  host.appendChild(toggle);

  const out = panel.querySelector('#ge-script-out');
  const log = (...a) => {
    out.textContent += a.map((x) => {
      if (typeof x === 'object') { try { return JSON.stringify(x); } catch { return String(x); } }
      return String(x);
    }).join(' ') + '\n';
    out.scrollTop = out.scrollHeight;
  };

  // Curated API surface.
  const ge = {
    state,
    layers: () => state.layers,
    active: () => activeLayer(),
    ctx: () => { const l = activeLayer(); return l ? l.ctx : null; },
    width: () => state.imgWidth,
    height: () => state.imgHeight,
    color: (hex) => { if (hex != null) state.color = hex; return state.color; },
    // Layer/pixel ops route through the command registry — so a script edit is
    // undoable + recordable exactly like a click (one path for everything).
    addLayer: (name) => { const id = runCommand('add-layer', { name }); return state.layers.find((l) => l.id === id) || null; },
    fill: (style) => runCommand('fill', { color: style }),
    adjust: (type, params) => runCommand('adjust', { type, params }),
    // Generic command access (any registered op) + discovery.
    run: (id, args) => runCommand(id, args),
    commands: () => listCommands(),
    composite: () => composite(),
    save: (label) => saveState(label || 'Script'),
    log,
  };

  function run() {
    out.textContent = '';
    const code = document.getElementById('ge-script-code').value;
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function('ge', 'state', 'log', code);
      const r = fn(ge, state, log);
      if (r !== undefined) log('→', r);
    } catch (e) { log('Error: ' + (e && e.message ? e.message : e)); }
  }
  panel.querySelector('#ge-script-run').addEventListener('click', run);
  panel.querySelector('#ge-script-clear').addEventListener('click', () => { document.getElementById('ge-script-code').value = ''; out.textContent = ''; });
  panel.querySelector('.ge-script-close').addEventListener('click', () => { panel.style.display = 'none'; });
  // Ctrl/Cmd+Enter in the editor runs.
  panel.querySelector('#ge-script-code').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
  });
}
