/**
 * Wire the tool options bar (build/options-bar.js). On every tool change the
 * bar relabels itself and rebuilds a compact set of REMOTE controls for the
 * active tool. Each remote proxies a canonical right-panel input: changing the
 * remote sets the real input's value and re-dispatches its `input` event, so
 * all existing wiring (state, labels, cursor) runs unchanged. A one-time
 * listener on each canonical input mirrors edits back into the remote, keeping
 * the top bar and side panel in sync without duplicating any state logic.
 */
import { toolKey } from './keymap.js';
import { state } from './state.js';
import { SMUDGE_PRESETS, applySmudgePreset } from './smudge-presets.js';

const TOOL_NAMES = {
  move: 'Move', marquee: 'Marquee', lasso: 'Lasso', polylasso: 'Polygonal Lasso', maglasso: 'Magnetic Lasso', wand: 'Magic Wand', quickselect: 'Quick Selection',
  redeye: 'Red Eye', ruler: 'Ruler',
  crop: 'Crop', transform: 'Transform', distort: 'Distort', pcrop: 'Perspective Crop', brush: 'Brush', eraser: 'Eraser', bucket: 'Paint Bucket', shapes: 'Shape',
  clone: 'Clone Stamp', eyedropper: 'Eyedropper', gradient: 'Gradient', text: 'Type',
  inpaint: 'Inpaint', rembg: 'Remove Background', sharpen: 'Sharpen',
  liquify: 'Liquify', smudge: 'Smudge', mixer: 'Mixer Brush', heal: 'Spot Healing', dodgeburn: 'Dodge / Burn',
  import: 'Import', harmonize: 'Harmonize',
};

// Which canonical controls each tool surfaces on the options bar. `sel` (a
// class selector) or `id` locates the real input; `kind:'size'` reads the
// shared log-scale size slider's own px label rather than the raw position.
const PROXIES = {
  brush: [
    { label: 'Size', sel: '.ge-size-slider', kind: 'size' },
    { label: 'Hardness', id: 'ge-brush-softness', suffix: '%' },
    { label: 'Mode', id: 'ge-brush-blend', control: 'select' },
    { label: 'Opacity', id: 'ge-brush-opacity', suffix: '%' },
    { label: 'Flow', id: 'ge-brush-flow', suffix: '%' },
    { label: 'Smoothing', id: 'ge-brush-smoothing', suffix: '%' },
    { label: 'Symmetry', id: 'ge-brush-symmetry', control: 'select' },
    { label: 'Pressure', id: 'ge-brush-pressure-opacity', control: 'checkbox' },
    { label: 'Airbrush', id: 'ge-brush-airbrush', control: 'checkbox' },
  ],
  eraser: [
    { label: 'Size', sel: '.ge-size-slider', kind: 'size' },
    { label: 'Opacity', id: 'ge-eraser-opacity', suffix: '%' },
    { label: 'Flow', id: 'ge-eraser-flow', suffix: '%' },
    { label: 'Hardness', id: 'ge-eraser-softness', suffix: '%' },
  ],
  clone: [
    { label: 'Size', sel: '.ge-size-slider', kind: 'size' },
    { label: 'Opacity', id: 'ge-clone-opacity', suffix: '%' },
    { label: 'Flow', id: 'ge-clone-flow', suffix: '%' },
    { label: 'Hardness', id: 'ge-clone-softness', suffix: '%' },
  ],
  wand: [
    { label: 'Mode', kind: 'buttons', sel: '.ge-wand-mode-btn', attr: 'data-wand-mode' },
    { label: 'Tolerance', id: 'ge-wand-tolerance' },
    { label: 'Feather', id: 'ge-wand-feather' },
  ],
  quickselect: [
    { label: 'Tolerance', id: 'ge-wand-tolerance' },
  ],
  lasso: [
    { label: 'Feather', id: 'ge-lasso-feather' },
  ],
  polylasso: [
    { label: 'Feather', id: 'ge-lasso-feather' },
  ],
  maglasso: [
    { label: 'Feather', id: 'ge-lasso-feather' },
  ],
  redeye: [
    { label: 'Size', sel: '.ge-size-slider', kind: 'size' },
  ],
  text: [
    { label: 'Size', id: 'ge-text-size' },
    { label: 'Font', id: 'ge-text-font', control: 'select' },
    { label: 'Color', sel: '.ge-fg-color', kind: 'color' },
  ],
  bucket: [
    { label: 'Tolerance', id: 'ge-bucket-tolerance' },
  ],
  smudge: [
    { label: 'Preset', kind: 'smudge-presets' },
    { label: 'Size', sel: '.ge-size-slider', kind: 'size' },
    { label: 'Strength', id: 'ge-smudge-strength', suffix: '%' },
    { label: 'Finger', id: 'ge-smudge-finger', control: 'checkbox' },
  ],
  mixer: [
    { label: 'Size', sel: '.ge-size-slider', kind: 'size' },
    { label: 'Wet', id: 'ge-mixer-wet', suffix: '%' },
    { label: 'Mix', id: 'ge-mixer-mix', suffix: '%' },
    { label: 'Flow', id: 'ge-mixer-flow', suffix: '%' },
  ],
  liquify: [
    { label: 'Size', sel: '.ge-size-slider', kind: 'size' },
    { label: 'Strength', id: 'ge-liquify-strength' },
  ],
  dodgeburn: [
    { label: 'Size', sel: '.ge-size-slider', kind: 'size' },
    { label: 'Mode', id: 'ge-dodgeburn-mode', control: 'select' },
    { label: 'Strength', id: 'ge-dodgeburn-strength', suffix: '%' },
  ],
  gradient: [
    { label: 'Type', kind: 'grad-type' },
    { label: 'Fill', kind: 'buttons', sel: '.ge-grad-mode', attr: 'data-grad-mode' },
    { label: 'Opacity', id: 'ge-grad-opacity', suffix: '%' },
  ],
  marquee: [
    { label: 'Shape', kind: 'buttons', sel: '.ge-marquee-mode', attr: 'data-marquee-mode' },
  ],
  shapes: [
    { label: 'Shape', kind: 'buttons', sel: '.ge-shape-mode', attr: 'data-shape-mode' },
  ],
  eyedropper: [
    { label: 'Sample', id: 'ge-eyedropper-sample', control: 'select' },
  ],
  sharpen: [
    { label: 'Size', sel: '.ge-size-slider', kind: 'size' },
    { label: 'Amount', id: 'ge-sharpen-amount', suffix: '%' },
  ],
  crop: [
    { label: 'Delete cropped', id: 'ge-crop-delete', control: 'checkbox' },
  ],
};

const sizeLabelText = () => {
  const el = document.querySelector('.ge-size-label');
  return el ? el.textContent : '';
};

// Gradient types. Linear/Radial keep the original canvas-API behaviour; Angle
// (sweep), Reflected (mirrored linear) and Diamond (square-distance isolines)
// are rasterised by editor/tools/gradient.js. Default 'linear' = prior behaviour.
const GRADIENT_TYPES = [
  ['linear', 'Linear'], ['radial', 'Radial'], ['angle', 'Angle'],
  ['reflected', 'Reflected'], ['diamond', 'Diamond'],
];

export function createOptionsBar() {
  const mirrored = new WeakSet();
  // Inversion (DESIGN-GUIDE §11): controls the options bar HOSTS are hidden in the
  // right panel so they aren't shown twice. One-time stylesheet; rows get the
  // marker class in refresh(). `!important` overrides the rows' inline display.
  if (typeof document !== 'undefined' && !document.getElementById('ge-ob-hosted-style')) {
    const st = document.createElement('style');
    st.id = 'ge-ob-hosted-style';
    st.textContent = '.ge-control-row.ge-ob-hosted{display:none!important;}';
    (document.head || document.documentElement).appendChild(st);
  }
  const canonicalOf = (spec) => (spec.id ? document.getElementById(spec.id) : document.querySelector(spec.sel));
  const matchKey = (spec) => spec.id || spec.sel;
  // Button-group proxy: the canonical control is a set of toggle buttons
  // (e.g. .ge-grad-type[data-grad-type]); the "active" one is the value.
  const activeBtn = (sel) => { const els = document.querySelectorAll(sel); for (const el of els) if (el.classList.contains('active')) return el; return els[0] || null; };

  // Attach (once per element) a listener that pushes canonical edits back into
  // whatever remote is currently on the bar for that control.
  function ensureMirror(canon, key) {
    if (!canon || mirrored.has(canon)) return;
    mirrored.add(canon);
    const handler = () => {
      const bar = document.querySelector('.ge-options-bar');
      const inp = bar && bar.querySelector(`[data-canon="${CSS.escape(key)}"]`);
      if (!inp) return;
      const control = inp.dataset.control || 'range';
      if (control === 'checkbox') { inp.checked = canon.checked; return; }
      inp.value = canon.value;
      if (control === 'range') {
        const field = inp.closest('.ge-ob-field');
        const val = field && field.querySelector('.ge-ob-val');
        if (val) val.textContent = inp.dataset.kind === 'size' ? sizeLabelText() : canon.value + (inp.dataset.suffix || '');
      }
    };
    // `input` fires for ranges; `change` for selects/checkboxes (and ranges on commit).
    canon.addEventListener('input', handler);
    canon.addEventListener('change', handler);
  }

  function refresh(toolId) {
    const bar = document.querySelector('.ge-options-bar');
    if (!bar) return;
    const nameEl = bar.querySelector('.ge-ob-tool-name');
    if (nameEl) {
      const k = toolKey(toolId);
      nameEl.textContent = (TOOL_NAMES[toolId] || toolId) + (k ? `  ·  ${k}` : '');
    }
    const host = bar.querySelector('.ge-ob-controls');
    if (!host) return;
    host.innerHTML = '';
    const specs = PROXIES[toolId] || [];
    for (const spec of specs) {
      // Gradient type picker — a self-contained <select> that owns
      // `state.gradientType` directly (the side panel only exposes linear/radial,
      // so the extra types live only on the options bar). Default 'linear'.
      if (spec.kind === 'grad-type') {
        const field = document.createElement('label');
        field.className = 'ge-ob-field';
        field.style.cssText = 'display:inline-flex;align-items:center;gap:6px;white-space:nowrap;';
        const lbl = document.createElement('span');
        lbl.className = 'ge-ob-label';
        lbl.style.cssText = 'opacity:0.6;';
        lbl.textContent = spec.label;
        const sel = document.createElement('select');
        sel.className = 'ge-grad-type-select';
        sel.style.cssText = 'max-width:120px;';
        for (const [val, name] of GRADIENT_TYPES) {
          const o = document.createElement('option');
          o.value = val; o.textContent = name;
          sel.appendChild(o);
        }
        // Seed state only when unset so a rebuild can't clobber a value the
        // side-panel buttons (below) may have set. state.gradientType is the
        // single source of truth read by tools/gradient.js.
        state.gradientType ??= 'linear';
        sel.value = state.gradientType;
        // Reflect the matching side-panel Linear/Radial button as active so the
        // two surfaces stay coherent (the panel only exposes those two types).
        const syncPanelButtons = (v) => {
          document.querySelectorAll('.ge-grad-type').forEach((b) => {
            b.classList.toggle('active', b.dataset.gradType === v);
          });
        };
        sel.addEventListener('change', () => {
          state.gradientType = sel.value;
          syncPanelButtons(sel.value);
        });
        // Side-panel Linear/Radial buttons must drive the same state (they only
        // toggle .active on their own, which gradient.js ignores once state wins).
        // Wire each canonical button once to write state + mirror into this select.
        document.querySelectorAll('.ge-grad-type').forEach((cb) => {
          if (mirrored.has(cb)) return;
          mirrored.add(cb);
          cb.addEventListener('click', () => {
            const v = cb.dataset.gradType;
            if (!v) return;
            state.gradientType = v;
            const liveSel = document.querySelector('.ge-grad-type-select');
            if (liveSel) liveSel.value = v;
          });
        });
        syncPanelButtons(sel.value);
        field.appendChild(lbl); field.appendChild(sel);
        host.appendChild(field);
        continue;
      }

      // Smudge preset picker — a self-contained <select> with no canonical
      // right-panel input. Selecting a preset applies its config to the smudge
      // state fields (and mirrors Strength/Finger into their inputs).
      if (spec.kind === 'smudge-presets') {
        const field = document.createElement('label');
        field.className = 'ge-ob-field';
        field.style.cssText = 'display:inline-flex;align-items:center;gap:6px;white-space:nowrap;';
        const lbl = document.createElement('span');
        lbl.className = 'ge-ob-label';
        lbl.style.cssText = 'opacity:0.6;';
        lbl.textContent = spec.label;
        const sel = document.createElement('select');
        sel.className = 'ge-smudge-preset';
        sel.style.cssText = 'max-width:170px;';
        const ph = document.createElement('option');
        ph.value = ''; ph.textContent = 'Presets…'; ph.disabled = true; ph.selected = true;
        sel.appendChild(ph);
        SMUDGE_PRESETS.forEach((p, i) => {
          const o = document.createElement('option');
          o.value = String(i); o.textContent = p.name;
          sel.appendChild(o);
        });
        sel.addEventListener('change', () => {
          const i = parseInt(sel.value, 10);
          const p = SMUDGE_PRESETS[i];
          if (p) applySmudgePreset(state, p.config);
        });
        field.appendChild(lbl); field.appendChild(sel);
        host.appendChild(field);
        continue;
      }

      const canon = canonicalOf(spec);
      if (!canon) continue;
      const key = matchKey(spec);
      const control = spec.control || 'range';

      const field = document.createElement('label');
      field.className = 'ge-ob-field';
      field.style.cssText = 'display:inline-flex;align-items:center;gap:6px;white-space:nowrap;';
      const lbl = document.createElement('span');
      lbl.className = 'ge-ob-label';
      lbl.style.cssText = 'opacity:0.6;';
      lbl.textContent = spec.label;

      // Button-group proxy (e.g. gradient Type / Fill, Marquee shape). Mirrors
      // a set of canonical toggle buttons as a compact segmented control; each
      // remote segment clicks its canonical button, and a one-time listener on
      // each canonical button reflects external changes back into the bar.
      if (spec.kind === 'buttons') {
        const seg = document.createElement('span');
        seg.style.cssText = 'display:inline-flex;border:1px solid rgba(255,255,255,0.15);border-radius:4px;overflow:hidden;';
        const canonBtns = Array.from(document.querySelectorAll(spec.sel));
        const sync = () => {
          const act = activeBtn(spec.sel);
          const v = act ? act.getAttribute(spec.attr) : null;
          seg.querySelectorAll('button').forEach((b) => {
            b.style.background = b.dataset.val === v ? 'rgba(120,170,255,0.35)' : 'transparent';
          });
        };
        canonBtns.forEach((cb) => {
          const val = cb.getAttribute(spec.attr);
          const seic = document.createElement('button');
          seic.type = 'button';
          seic.dataset.val = val;
          seic.textContent = cb.textContent.trim();
          seic.style.cssText = 'background:transparent;border:none;color:inherit;font:inherit;padding:2px 8px;cursor:pointer;';
          // Clicking the canonical button (below) runs its `sync()` mirror, so
          // the segment only needs to forward the click — no second sync() here.
          seic.addEventListener('click', () => { cb.click(); });
          seg.appendChild(seic);
          if (!mirrored.has(cb)) { mirrored.add(cb); cb.addEventListener('click', () => { const b = document.querySelector('.ge-options-bar'); if (b) sync(); }); }
        });
        field.appendChild(lbl); field.appendChild(seg);
        host.appendChild(field);
        sync();
        continue;
      }

      // Colour proxy — a native <input type=color> mirroring the FG/BG swatch.
      if (spec.kind === 'color') {
        ensureMirror(canon, key);
        const input = document.createElement('input');
        input.type = 'color';
        input.value = canon.value;
        input.dataset.canon = key; input.dataset.control = 'color';
        input.style.cssText = 'width:28px;height:20px;padding:0;border:1px solid rgba(255,255,255,0.2);border-radius:3px;background:none;cursor:pointer;';
        input.addEventListener('input', () => {
          canon.value = input.value;
          canon.dispatchEvent(new Event('input', { bubbles: true }));
          canon.dispatchEvent(new Event('change', { bubbles: true }));
        });
        field.appendChild(lbl); field.appendChild(input);
        host.appendChild(field);
        continue;
      }

      ensureMirror(canon, key);
      if (control === 'checkbox') {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!canon.checked;
        input.dataset.canon = key; input.dataset.control = 'checkbox';
        input.addEventListener('change', () => {
          canon.checked = input.checked;
          canon.dispatchEvent(new Event('change', { bubbles: true }));
        });
        field.appendChild(input); field.appendChild(lbl); // [box] [label]
        host.appendChild(field);
        continue;
      }
      if (control === 'select') {
        const input = document.createElement('select');
        input.innerHTML = canon.innerHTML; // clone the option list
        input.value = canon.value;
        input.dataset.canon = key; input.dataset.control = 'select';
        input.style.cssText = 'max-width:150px;';
        input.addEventListener('change', () => {
          canon.value = input.value;
          canon.dispatchEvent(new Event('change', { bubbles: true }));
        });
        field.appendChild(lbl); field.appendChild(input);
        host.appendChild(field);
        continue;
      }

      // range (default)
      const input = document.createElement('input');
      input.type = 'range';
      input.min = canon.min; input.max = canon.max; input.step = canon.step || 1;
      input.value = canon.value;
      input.dataset.canon = key; input.dataset.control = 'range';
      if (spec.kind) input.dataset.kind = spec.kind;
      if (spec.suffix) input.dataset.suffix = spec.suffix;
      input.style.cssText = 'width:96px;';
      const val = document.createElement('span');
      val.className = 'ge-ob-val';
      val.style.cssText = 'min-width:36px;opacity:0.85;';
      const setVal = () => { val.textContent = spec.kind === 'size' ? sizeLabelText() : canon.value + (spec.suffix || ''); };
      input.addEventListener('input', () => {
        canon.value = input.value;
        canon.dispatchEvent(new Event('input', { bubbles: true }));
        setVal();
      });
      field.appendChild(lbl); field.appendChild(input); field.appendChild(val);
      host.appendChild(field);
      setVal();
    }

    // Inversion: the bar now hosts this tool's primary controls, so hide their
    // duplicate rows in the right panel (same PROXIES schema drives both). The
    // canonical inputs stay in the DOM (hidden), so the proxies + all existing
    // handlers keep working; the panel is left with only the tool's long tail +
    // action rows (its "Tool Details"). Skip self-contained pickers (no panel
    // twin) and the document-level FG colour swatch (a shared doc control).
    // Un-hide rows the PREVIOUS tool hosted before re-hiding for this one, so a
    // shared control (e.g. the size slider) isn't left hidden after switching to
    // a tool that doesn't host it.
    document.querySelectorAll('.ge-control-row.ge-ob-hosted').forEach((r) => r.classList.remove('ge-ob-hosted'));
    for (const spec of specs) {
      if (spec.kind === 'grad-type' || spec.kind === 'smudge-presets' || spec.kind === 'color') continue;
      const canon = canonicalOf(spec);
      const row = canon && canon.closest('.ge-control-row');
      if (row) row.classList.add('ge-ob-hosted');
    }
  }

  return { refresh };
}
