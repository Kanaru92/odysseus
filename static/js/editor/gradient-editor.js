/**
 * Multi-stop gradient editor. Renders a gradient bar with draggable
 * colour stops; each stop has its own colour + alpha (so transparency→colour
 * ramps are first-class). Edits live in `state.gradStops` (sorted [{pos 0..1,
 * color '#rrggbb', alpha 0..1}]) — the Gradient tool builds its fill/preview
 * from these when present, otherwise it falls back to the FG→BG / FG→Transparent
 * mode buttons.
 *
 *   double-click the bar  → add a stop (colour interpolated at that point)
 *   drag a stop           → move it
 *   click a stop          → select (colour + alpha controls below act on it)
 *   ×  / Delete           → remove the selected stop (min 2)
 *   preset buttons        → FG→BG, FG→Transparent, Black→White, Rainbow
 *
 * @returns {{ mount: (host: HTMLElement) => void, refresh: () => void }}
 */
import { state } from './state.js';

function clamp01(n) { return Math.max(0, Math.min(1, n)); }
function hex(c) { return /^#?[0-9a-fA-F]{6}$/.test(String(c || '')) ? (c[0] === '#' ? c : '#' + c) : '#000000'; }
function rgbaOf(stop) {
  const h = hex(stop.color).slice(1);
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${clamp01(stop.alpha == null ? 1 : stop.alpha)})`;
}

export function ensureGradStops() {
  if (!Array.isArray(state.gradStops) || state.gradStops.length < 2) {
    state.gradStops = [
      { pos: 0, color: state.color || '#000000', alpha: 1 },
      { pos: 1, color: state.bgColor || '#ffffff', alpha: 1 },
    ];
  }
  return state.gradStops;
}

// Sample the current stop list at position p (0..1) → {color, alpha} via linear
// interpolation. Used to colour a freshly-added stop.
function sampleAt(stops, p) {
  const s = [...stops].sort((a, b) => a.pos - b.pos);
  if (p <= s[0].pos) return { color: s[0].color, alpha: s[0].alpha };
  if (p >= s[s.length - 1].pos) return { color: s[s.length - 1].color, alpha: s[s.length - 1].alpha };
  for (let i = 0; i < s.length - 1; i++) {
    if (p >= s[i].pos && p <= s[i + 1].pos) {
      const t = (p - s[i].pos) / (s[i + 1].pos - s[i].pos || 1);
      const ca = hex(s[i].color).slice(1), cb = hex(s[i + 1].color).slice(1);
      const mix = (j) => Math.round(parseInt(ca.slice(j, j + 2), 16) * (1 - t) + parseInt(cb.slice(j, j + 2), 16) * t);
      const col = '#' + [0, 2, 4].map((j) => mix(j).toString(16).padStart(2, '0')).join('');
      return { color: col, alpha: (s[i].alpha ?? 1) * (1 - t) + (s[i + 1].alpha ?? 1) * t };
    }
  }
  return { color: s[0].color, alpha: 1 };
}

export function createGradientEditor() {
  let host = null;
  let selected = 0;

  function cssGradient() {
    const s = [...ensureGradStops()].sort((a, b) => a.pos - b.pos);
    return 'linear-gradient(90deg,' + s.map((st) => `${rgbaOf(st)} ${Math.round(st.pos * 100)}%`).join(',') + ')';
  }

  function render() {
    if (!host) return;
    const stops = ensureGradStops();
    selected = Math.max(0, Math.min(selected, stops.length - 1));
    host.innerHTML = '';
    host.style.cssText = 'display:block;margin-top:4px;';

    // Presets.
    const presets = document.createElement('div');
    presets.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;margin-bottom:5px;';
    const mkPreset = (label, build) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ge-btn ge-btn-sm'; b.textContent = label;
      b.addEventListener('click', () => { state.gradStops = build(); state.gradUseCustom = true; selected = 0; render(); });
      return b;
    };
    presets.appendChild(mkPreset('FG→BG', () => [{ pos: 0, color: hex(state.color || '#000000'), alpha: 1 }, { pos: 1, color: hex(state.bgColor || '#ffffff'), alpha: 1 }]));
    presets.appendChild(mkPreset('FG→Transp.', () => [{ pos: 0, color: hex(state.color || '#000000'), alpha: 1 }, { pos: 1, color: hex(state.color || '#000000'), alpha: 0 }]));
    presets.appendChild(mkPreset('B→W', () => [{ pos: 0, color: '#000000', alpha: 1 }, { pos: 1, color: '#ffffff', alpha: 1 }]));
    presets.appendChild(mkPreset('Rainbow', () => [
      { pos: 0, color: '#ff0000', alpha: 1 }, { pos: 0.17, color: '#ffff00', alpha: 1 },
      { pos: 0.34, color: '#00ff00', alpha: 1 }, { pos: 0.5, color: '#00ffff', alpha: 1 },
      { pos: 0.67, color: '#0000ff', alpha: 1 }, { pos: 0.84, color: '#ff00ff', alpha: 1 },
      { pos: 1, color: '#ff0000', alpha: 1 },
    ]));
    host.appendChild(presets);

    // Gradient bar (over a checkerboard so alpha reads) + stop handles.
    const barWrap = document.createElement('div');
    barWrap.style.cssText = 'position:relative;height:34px;margin-bottom:6px;';
    const bar = document.createElement('div');
    bar.className = 'ge-grad-bar';
    bar.style.cssText =
      'position:absolute;left:0;right:0;top:0;height:20px;border:1px solid rgba(255,255,255,0.25);border-radius:3px;cursor:copy;' +
      'background-image:' + cssGradient() + ',' +
      'repeating-conic-gradient(#888 0% 25%, #bbb 0% 50%);background-size:auto, 10px 10px;';
    bar.addEventListener('dblclick', (e) => {
      const r = bar.getBoundingClientRect();
      const p = clamp01((e.clientX - r.left) / (r.width || 1));
      const samp = sampleAt(stops, p);
      stops.push({ pos: p, color: samp.color, alpha: samp.alpha });
      state.gradUseCustom = true;
      selected = stops.length - 1;
      render();
    });
    barWrap.appendChild(bar);

    stops.forEach((st, i) => {
      const handle = document.createElement('div');
      handle.dataset.stopIdx = String(i);
      const isSel = i === selected;
      handle.style.cssText =
        `position:absolute;top:20px;left:${st.pos * 100}%;transform:translateX(-50%);width:12px;height:12px;` +
        `border:2px solid ${isSel ? '#7aa8ff' : '#fff'};border-radius:50%;background:${hex(st.color)};cursor:grab;box-shadow:0 1px 3px rgba(0,0,0,0.6);`;
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        selected = i; render();
        const startX = e.clientX; const startPos = st.pos; const w = bar.getBoundingClientRect().width || 1;
        const onMove = (ev) => { st.pos = clamp01(startPos + (ev.clientX - startX) / w); paintBarOnly(); };
        const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); state.gradUseCustom = true; render(); };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
      barWrap.appendChild(handle);
    });
    host.appendChild(barWrap);

    // Repaint only the bar background during a drag (cheap; full render on drop).
    function paintBarOnly() {
      bar.style.backgroundImage = cssGradient() + ',repeating-conic-gradient(#888 0% 25%, #bbb 0% 50%)';
      stops.forEach((s2, j) => { const h = barWrap.querySelector(`[data-stop-idx="${j}"]`); if (h) h.style.left = (s2.pos * 100) + '%'; });
    }

    // Selected-stop controls: colour + alpha + delete.
    const sel = stops[selected];
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:11px;';
    const color = document.createElement('input');
    color.type = 'color'; color.value = hex(sel.color);
    color.title = 'Stop colour';
    color.style.cssText = 'width:28px;height:22px;padding:0;border:1px solid rgba(255,255,255,0.2);border-radius:3px;background:none;cursor:pointer;';
    color.addEventListener('input', () => { sel.color = color.value; state.gradUseCustom = true; render(); });
    const aLbl = document.createElement('span'); aLbl.textContent = 'Alpha'; aLbl.style.opacity = '0.65';
    const alpha = document.createElement('input');
    alpha.type = 'range'; alpha.min = '0'; alpha.max = '100'; alpha.value = String(Math.round((sel.alpha ?? 1) * 100));
    alpha.style.cssText = 'flex:1;min-width:60px;';
    alpha.addEventListener('input', () => { sel.alpha = clamp01(parseInt(alpha.value, 10) / 100); state.gradUseCustom = true; render(); });
    const aVal = document.createElement('span'); aVal.textContent = alpha.value + '%'; aVal.style.cssText = 'min-width:34px;opacity:0.85;';
    alpha.addEventListener('input', () => { aVal.textContent = alpha.value + '%'; });
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'ge-btn ge-btn-sm'; del.textContent = '✕'; del.title = 'Delete stop';
    del.disabled = stops.length <= 2;
    del.addEventListener('click', () => { if (stops.length > 2) { stops.splice(selected, 1); selected = Math.max(0, selected - 1); state.gradUseCustom = true; render(); } });
    row.appendChild(color); row.appendChild(aLbl); row.appendChild(alpha); row.appendChild(aVal); row.appendChild(del);
    host.appendChild(row);
  }

  return {
    mount(hostEl) { host = hostEl; render(); },
    refresh() { render(); },
  };
}
