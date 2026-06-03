/**
 * Brush quick-pick popup — right-click the canvas with the Brush or
 * Eraser to get a floating panel with Size + Hardness sliders, a brush search
 * box, and a grid of preset thumbnails. Picking a preset relays to the canonical
 * #ge-brush-preset select (so all existing preset wiring runs); the sliders are
 * remotes of the canonical Size (.ge-size-slider) + Hardness (#ge-brush-softness)
 * inputs, so state stays in one place.
 *
 * Thumbnails are rendered from each preset's tip type (round / soft / gaussian /
 * textured) as a small tapering stroke — no stored bitmaps needed.
 *
 * @returns {{ open: (x:number,y:number)=>void, close: ()=>void, isOpen: ()=>boolean }}
 */
import { state } from './state.js';
import { BRUSH_PRESETS } from './brush/presets.js';
import { createBrushEngine } from './brush/index.js';
import { getPreset } from './brush/presets.js';
import { makeNoiseGrain } from './brush/grain-textures.js';

export function createBrushQuickPick() {
  let panel = null;
  let onDocDown = null;
  let armTimer = null;

  const sizeLabel = () => {
    const el = document.querySelector('.ge-size-label');
    return el ? el.textContent : '';
  };

  // Faithful per-preset thumbnail: render a tapering sample stroke with the REAL
  // brush engine so each preset's tip + grain/texture + scatter + spacing + shape
  // shows (previously every thumb only varied by tipType, so grainy/scattered
  // brushes looked identical). Falls back to a simple tapering stroke on any error.
  function renderThumb(cv, preset) {
    const w = cv.width, h = cv.height;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    const cy = h / 2;
    try {
      const p = getPreset(preset.id) || preset;
      if (p.grainKind === 'noise' && !p._grainCanvas) p._grainCanvas = makeNoiseGrain(128, 128);
      const eng = createBrushEngine({
        ...p,
        grain: p.grain || p._grainCanvas || null,
        grainDepth: p.grainDepth != null ? p.grainDepth : 1,
        scatter: p.scatter, spacing: p.spacing, ratio: p.ratio,
      });
      const tip = p.tipType || 'round';
      const rt = {
        size: Math.max(5, Math.min(h * 0.85, 16)),
        opacity: 1, flow: 1, color: '#ebebeb',
        hardness: tip === 'gaussian' ? 0.3 : tip === 'soft' ? 0.55 : 0.9,
        symmetry: 'none', symN: 6, angleFollow: !!p.angleFollow, tiltAngle: false, tiltAz: 0,
        brushBlend: 'source-over', colorJitter: 0, sizeJitter: p.sizeJitter || 0, flowJitter: 0,
        lockAlpha: false, erase: false,
      };
      const pts = [], n = 30;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        pts.push({ x: 5 + t * (w - 10), y: cy + Math.sin(t * Math.PI) * 2, pressure: 0.12 + 0.88 * Math.sin(t * Math.PI) });
      }
      eng.begin(ctx, rt);
      for (let i = 1; i < pts.length; i++) eng.segment(ctx, pts[i - 1], pts[i], rt);
      eng.end();
      return;
    } catch { ctx.clearRect(0, 0, w, h); }
    // Fallback — simple tapering falloff stroke.
    const n = 26, rMax = h * 0.34, tip = preset.tipType || 'round';
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), taper = Math.sin(t * Math.PI);
      const x = 4 + t * (w - 8), r = Math.max(0.6, rMax * (0.35 + 0.65 * taper));
      const alpha = (tip === 'soft' || tip === 'gaussian') ? 0.5 + 0.4 * taper : 0.9;
      const g = ctx.createRadialGradient(x, cy, 0, x, cy, r);
      g.addColorStop(0, `rgba(235,235,235,${alpha})`);
      g.addColorStop(tip === 'gaussian' ? 0.5 : tip === 'soft' ? 0.7 : 0.85, `rgba(235,235,235,${alpha * (tip === 'round' ? 1 : 0.5)})`);
      g.addColorStop(1, 'rgba(235,235,235,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, cy, r, 0, Math.PI * 2); ctx.fill();
    }
  }

  function mkSlider(labelText, getCanon, opts = {}) {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:11px;margin:2px 0;';
    const lab = document.createElement('span');
    lab.style.cssText = 'opacity:0.65;min-width:54px;';
    lab.textContent = labelText;
    const canon = getCanon();
    const inp = document.createElement('input');
    inp.type = 'range';
    inp.style.cssText = 'flex:1;min-width:90px;';
    if (canon) { inp.min = canon.min; inp.max = canon.max; inp.step = canon.step || 1; inp.value = canon.value; }
    const val = document.createElement('span');
    val.style.cssText = 'min-width:40px;text-align:right;opacity:0.85;';
    const setVal = () => { val.textContent = opts.size ? sizeLabel() : (canon ? canon.value + (opts.suffix || '') : ''); };
    setVal();
    inp.addEventListener('input', () => {
      const c = getCanon();
      if (!c) return;
      c.value = inp.value;
      c.dispatchEvent(new Event('input', { bubbles: true }));
      setVal();
    });
    row.appendChild(lab); row.appendChild(inp); row.appendChild(val);
    return row;
  }

  function build(x, y) {
    close();
    panel = document.createElement('div');
    panel.className = 'ge-brush-quickpick';
    panel.style.cssText =
      'position:fixed;z-index:240;background:#2b2b30;border:1px solid rgba(255,255,255,0.16);' +
      'border-radius:8px;padding:10px;box-shadow:0 14px 34px rgba(0,0,0,0.55);width:300px;color:#eee;font-size:12px;';
    panel.style.left = Math.max(6, Math.min(x, window.innerWidth - 312)) + 'px';
    panel.style.top = Math.max(6, Math.min(y, window.innerHeight - 420)) + 'px';

    // Size + Hardness sliders (remotes of the canonical inputs).
    panel.appendChild(mkSlider('Size', () => document.querySelector('.ge-size-slider'), { size: true }));
    panel.appendChild(mkSlider('Hardness', () => document.getElementById('ge-brush-softness'), { suffix: '%' }));

    // Search box.
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Search brushes';
    search.style.cssText = 'width:100%;box-sizing:border-box;margin:6px 0;padding:5px 8px;background:#1f1f24;border:1px solid rgba(255,255,255,0.14);border-radius:5px;color:#eee;font:inherit;';
    panel.appendChild(search);

    // Preset grid.
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;max-height:280px;overflow-y:auto;';
    panel.appendChild(grid);

    const canonSel = document.getElementById('ge-brush-preset');
    const activeId = (canonSel && canonSel.value) || state.brushPresetId;

    const cells = [];
    for (const p of BRUSH_PRESETS) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.dataset.presetId = p.id;
      cell.dataset.name = (p.name || '').toLowerCase();
      const isActive = p.id === activeId;
      cell.style.cssText =
        'display:flex;flex-direction:column;gap:3px;align-items:stretch;padding:5px;cursor:pointer;font:inherit;color:inherit;text-align:left;' +
        'background:' + (isActive ? 'rgba(120,170,255,0.28)' : 'rgba(255,255,255,0.04)') + ';' +
        'border:1px solid ' + (isActive ? 'rgba(120,170,255,0.7)' : 'rgba(255,255,255,0.1)') + ';border-radius:5px;';
      const thumb = document.createElement('canvas');
      thumb.width = 124; thumb.height = 30;
      thumb.style.cssText = 'width:100%;height:30px;display:block;';
      renderThumb(thumb, p);
      const name = document.createElement('span');
      name.textContent = p.name || p.id;
      name.style.cssText = 'font-size:10px;opacity:0.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      cell.appendChild(thumb); cell.appendChild(name);
      cell.addEventListener('click', () => {
        const sel = document.getElementById('ge-brush-preset');
        if (sel) { sel.value = p.id; sel.dispatchEvent(new Event('change', { bubbles: true })); }
        else { state.brushPresetId = p.id; }
        // Reflect active highlight without rebuilding.
        cells.forEach((c) => {
          const on = c.dataset.presetId === p.id;
          c.style.background = on ? 'rgba(120,170,255,0.28)' : 'rgba(255,255,255,0.04)';
          c.style.borderColor = on ? 'rgba(120,170,255,0.7)' : 'rgba(255,255,255,0.1)';
        });
      });
      cells.push(cell);
      grid.appendChild(cell);
    }

    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      for (const c of cells) c.style.display = (!q || c.dataset.name.includes(q)) ? '' : 'none';
    });

    (state.container || document.body).appendChild(panel);
    // Close on outside pointer-down or Escape.
    onDocDown = (ev) => { if (panel && !panel.contains(ev.target)) close(); };
    armTimer = setTimeout(() => {
      armTimer = null;
      document.addEventListener('pointerdown', onDocDown, true);
      document.addEventListener('keydown', onEsc, true);
    }, 0);
    search.focus();
  }

  function onEsc(ev) { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); } }

  function close() {
    if (armTimer != null) { clearTimeout(armTimer); armTimer = null; }
    if (onDocDown) { document.removeEventListener('pointerdown', onDocDown, true); onDocDown = null; }
    document.removeEventListener('keydown', onEsc, true);
    if (panel) { try { panel.remove(); } catch {} panel = null; }
  }

  return { open: (x, y) => build(x, y), close, isOpen: () => !!panel };
}
