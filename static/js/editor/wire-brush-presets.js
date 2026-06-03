/**
 * Brush preset picker — populates the #ge-brush-preset dropdown from the
 * data-driven preset list and binds it to state.brushPresetId, which the
 * brush engine (editor/brush/) reads to pick tip + dynamics. Single-sourced
 * from presets.js so adding a brush is just data.
 */
import { state } from './state.js';
import { BRUSH_PRESETS } from './brush/presets.js';
import { CURVES } from './brush/curve.js';
import { parseGBR } from './brush/import-gbr.js';
import { parseABR } from './brush/import-abr.js';
import { parseBrushBundle } from './brush/import-brush-bundle.js';
import { parseGIH } from './brush/import-gih.js';
import { BLEND_MODES } from './blend-modes.js';
import { armSymmetryGizmo, dismissSymmetryGizmo } from './symmetry-gizmo.js';

export function wireBrushPresets() {
  const sel = document.getElementById('ge-brush-preset');
  if (!sel) return;
  sel.innerHTML = BRUSH_PRESETS.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
  if (state.brushPresetId && BRUSH_PRESETS.some((p) => p.id === state.brushPresetId)) {
    sel.value = state.brushPresetId;
  } else if (BRUSH_PRESETS.length) {
    state.brushPresetId = BRUSH_PRESETS[0].id;
    sel.value = state.brushPresetId;
  }
  sel.addEventListener('change', () => { state.brushPresetId = sel.value; syncDynamicsFromPreset(sel.value); });

  // Brush dynamics (scatter / spacing / roundness) — live overrides of the
  // active preset. Initialised from the preset on selection, then editable; the
  // stroke pipeline merges them onto the preset when it (re)builds the engine.
  function syncDynamicsFromPreset(id) {
    const p = BRUSH_PRESETS.find((x) => x.id === id) || {};
    state.brushScatter = p.scatter != null ? p.scatter : 0;
    state.brushSpacing = p.spacing != null ? p.spacing : 0.1;
    state.brushRoundness = p.ratio != null ? p.ratio : 1;
    state.brushAngleFollow = !!p.angleFollow;
    reflectDynamics();
  }
  function reflectDynamics() {
    const put = (elId, sliderVal, labelId) => {
      const el = document.getElementById(elId);
      if (el) el.value = String(sliderVal);
      const l = document.getElementById(labelId);
      if (l) l.textContent = sliderVal + '%';
    };
    put('ge-brush-scatter', Math.round((state.brushScatter || 0) * 100), 'ge-brush-scatter-label');
    put('ge-brush-spacing', Math.round((state.brushSpacing != null ? state.brushSpacing : 0.1) * 100), 'ge-brush-spacing-label');
    put('ge-brush-roundness', Math.round((state.brushRoundness != null ? state.brushRoundness : 1) * 100), 'ge-brush-roundness-label');
    const af = document.getElementById('ge-brush-angle-follow');
    if (af) af.checked = !!state.brushAngleFollow;
  }
  const _sc = document.getElementById('ge-brush-scatter');
  _sc?.addEventListener('input', () => { state.brushScatter = (parseInt(_sc.value, 10) || 0) / 100; const l = document.getElementById('ge-brush-scatter-label'); if (l) l.textContent = _sc.value + '%'; });
  const _sp = document.getElementById('ge-brush-spacing');
  _sp?.addEventListener('input', () => { state.brushSpacing = Math.max(0.01, (parseInt(_sp.value, 10) || 10) / 100); const l = document.getElementById('ge-brush-spacing-label'); if (l) l.textContent = _sp.value + '%'; });
  const _rd = document.getElementById('ge-brush-roundness');
  _rd?.addEventListener('input', () => { state.brushRoundness = Math.max(0.05, (parseInt(_rd.value, 10) || 100) / 100); const l = document.getElementById('ge-brush-roundness-label'); if (l) l.textContent = _rd.value + '%'; });
  const _af = document.getElementById('ge-brush-angle-follow');
  if (_af) { _af.checked = !!state.brushAngleFollow; _af.addEventListener('change', () => { state.brushAngleFollow = !!_af.checked; }); }
  const _ta = document.getElementById('ge-brush-tilt-angle');
  if (_ta) { _ta.checked = !!state.brushTiltAngle; _ta.addEventListener('change', () => { state.brushTiltAngle = !!_ta.checked; }); }
  const _ts = document.getElementById('ge-brush-tilt-size');
  if (_ts) { _ts.checked = !!state.brushTiltSize; _ts.addEventListener('change', () => { state.brushTiltSize = !!_ts.checked; }); }
  const _po = document.getElementById('ge-brush-pressure-opacity');
  if (_po) { _po.checked = state.brushPressureOpacity !== false; _po.addEventListener('change', () => { state.brushPressureOpacity = !!_po.checked; }); }
  const _cj = document.getElementById('ge-brush-colorjitter');
  _cj?.addEventListener('input', () => { state.brushColorJitter = (parseInt(_cj.value, 10) || 0) / 100; const l = document.getElementById('ge-brush-colorjitter-label'); if (l) l.textContent = _cj.value + '%'; });
  const _sj = document.getElementById('ge-brush-sizejitter');
  _sj?.addEventListener('input', () => { state.brushSizeJitter = (parseInt(_sj.value, 10) || 0) / 100; const l = document.getElementById('ge-brush-sizejitter-label'); if (l) l.textContent = _sj.value + '%'; });
  const _fj = document.getElementById('ge-brush-flowjitter');
  _fj?.addEventListener('input', () => { state.brushFlowJitter = (parseInt(_fj.value, 10) || 0) / 100; const l = document.getElementById('ge-brush-flowjitter-label'); if (l) l.textContent = _fj.value + '%'; });
  // Dual brush — secondary texturing tip per dab.
  const _dual = document.getElementById('ge-brush-dual');
  const _dualOpts = document.getElementById('ge-brush-dual-opts');
  const _syncDualVis = () => { if (_dualOpts) _dualOpts.style.display = state.brushDualEnabled ? 'flex' : 'none'; };
  if (_dual) { _dual.checked = !!state.brushDualEnabled; _dual.addEventListener('change', () => { state.brushDualEnabled = !!_dual.checked; _syncDualVis(); }); }
  const _dtip = document.getElementById('ge-brush-dual-tip');
  if (_dtip) { _dtip.value = state.brushDualTipType || 'round'; _dtip.addEventListener('change', () => { state.brushDualTipType = _dtip.value || 'round'; }); }
  const _dscale = document.getElementById('ge-brush-dual-scale');
  _dscale?.addEventListener('input', () => { state.brushDualScale = Math.max(0.05, (parseInt(_dscale.value, 10) || 35) / 100); const l = document.getElementById('ge-brush-dual-scale-label'); if (l) l.textContent = _dscale.value + '%'; });
  const _dcount = document.getElementById('ge-brush-dual-count');
  _dcount?.addEventListener('input', () => { state.brushDualCount = parseInt(_dcount.value, 10) || 6; const l = document.getElementById('ge-brush-dual-count-label'); if (l) l.textContent = _dcount.value; });
  const _dscatter = document.getElementById('ge-brush-dual-scatter');
  _dscatter?.addEventListener('input', () => { state.brushDualScatter = (parseInt(_dscatter.value, 10) || 80) / 100; const l = document.getElementById('ge-brush-dual-scatter-label'); if (l) l.textContent = _dscatter.value + '%'; });
  _syncDualVis();
  // Brush blend mode — only the canvas-native modes (valid for the stroke→layer
  // composite); custom per-pixel modes don't apply to the live stroke buffer.
  const _bb = document.getElementById('ge-brush-blend');
  if (_bb) {
    _bb.innerHTML = BLEND_MODES.filter((m) => !m.custom).map((m) => `<option value="${m.id}">${m.name}</option>`).join('');
    _bb.value = state.brushBlendMode || 'source-over';
    _bb.addEventListener('change', () => { state.brushBlendMode = _bb.value || 'source-over'; });
  }
  syncDynamicsFromPreset(state.brushPresetId);

  // Symmetry / mirror / radial / mandala painting.
  const sym = document.getElementById('ge-brush-symmetry');
  const symnRow = document.getElementById('ge-symn-row');
  const symn = document.getElementById('ge-brush-symn');
  const symnLabel = document.getElementById('ge-brush-symn-label');
  const updateSymnVisibility = () => {
    const radial = state.brushSymmetry === 'radial' || state.brushSymmetry === 'mandala';
    if (symnRow) symnRow.style.display = radial ? '' : 'none';
  };
  if (sym) {
    sym.value = state.brushSymmetry || 'none';
    sym.addEventListener('change', () => {
      state.brushSymmetry = sym.value;
      updateSymnVisibility();
      // Symmetry is placed via an on-canvas gizmo + accepted before it applies.
      if (sym.value && sym.value !== 'none') { try { armSymmetryGizmo(); } catch {} }
      else { state.symActive = false; try { dismissSymmetryGizmo(); } catch {} }
    });
  }
  if (symn) {
    symn.value = String(state.brushSymmetryN || 6);
    symn.addEventListener('input', () => {
      state.brushSymmetryN = parseInt(symn.value, 10) || 6;
      if (symnLabel) symnLabel.textContent = symn.value;
    });
  }
  updateSymnVisibility();

  // Stroke stabilizer (smoothing).
  const sm = document.getElementById('ge-brush-smoothing');
  if (sm) {
    sm.value = String(state.brushSmoothing || 0);
    sm.addEventListener('input', () => {
      state.brushSmoothing = parseInt(sm.value, 10) || 0;
      const lbl = document.getElementById('ge-brush-smoothing-label');
      if (lbl) lbl.textContent = sm.value + '%';
    });
  }
  // Smoothing-options gear popup (Pulled String / Catch-up on Stroke End /
  // Adjust for Zoom).
  const gear = document.getElementById('ge-smoothing-gear');
  const opts = document.getElementById('ge-smoothing-opts');
  if (gear && opts) gear.addEventListener('click', () => { opts.style.display = opts.style.display === 'none' ? 'flex' : 'none'; });
  const bindChk = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = !!state[key];
    el.addEventListener('change', () => { state[key] = !!el.checked; });
  };
  bindChk('ge-sm-pull', 'brushSmoothPull');
  bindChk('ge-sm-catchup-end', 'brushSmoothCatchupEnd');
  bindChk('ge-sm-adjust-zoom', 'brushSmoothAdjustZoom');

  // Import a brush tip → new image-stamp preset. PNG/image via <img>; binary
  // brush formats exported from other paint programs (.gbr / .abr / .brush) via
  // their parsers in editor/brush/. See BRUSH-IMPORT.md.
  function addImportedPreset(tipImage, rawName, spacing, grain) {
    const name = String(rawName || 'Imported').replace(/\.[^.]+$/, '');
    const id = 'imported-' + BRUSH_PRESETS.length + '-' + Math.floor((typeof performance !== 'undefined' ? performance.now() : 0));
    BRUSH_PRESETS.push({
      id, name: 'Imported: ' + name, tipType: 'image', tipImage, grain: grain || null, grainDepth: 1, spacing: spacing || 0.1,
      dynamics: { size: { sensor: 'pressure', curve: CURVES.linear, min: 0.2, max: 1 }, flow: { sensor: 'none' } },
    });
    if (sel) {
      const o = document.createElement('option');
      o.value = id; o.textContent = 'Imported: ' + name;
      sel.appendChild(o); sel.value = id;
    }
    state.brushPresetId = id;
    syncDynamicsFromPreset(id);
  }
  const imp = document.getElementById('ge-brush-import');
  const impFile = document.getElementById('ge-brush-import-file');
  if (imp && impFile) {
    imp.addEventListener('click', () => impFile.click());
    impFile.addEventListener('change', () => {
      const f = impFile.files && impFile.files[0];
      if (!f) return;
      const isGbr = /\.gbr$/i.test(f.name || '');
      const isAbr = /\.abr$/i.test(f.name || '');
      const isBrush = /\.brush$/i.test(f.name || '');
      const isGih = /\.gih$/i.test(f.name || '');
      const reader = new FileReader();
      reader.onload = () => {
        if (isAbr) {
          const list = parseABR(reader.result);
          if (list) list.forEach((br, i) => addImportedPreset(br.canvas, br.name || (String(f.name).replace(/\.abr$/i, '') + ' ' + (i + 1)), br.spacing));
        } else if (isGih) {
          const list = parseGIH(reader.result);
          if (list) list.forEach((br, i) => addImportedPreset(br.canvas, br.name || (String(f.name).replace(/\.gih$/i, '') + ' ' + (i + 1)), br.spacing));
        } else if (isBrush) {
          parseBrushBundle(reader.result).then((res) => { if (res) addImportedPreset(res.shape, f.name, 0.1, res.grain); }).catch(() => {});
        } else if (isGbr) {
          const parsed = parseGBR(reader.result);
          if (parsed) addImportedPreset(parsed.canvas, parsed.name || f.name, parsed.spacing);
        } else {
          const img = new Image();
          img.onload = () => addImportedPreset(img, f.name, 0.1);
          img.onerror = () => {};
          img.src = reader.result;
        }
      };
      if (isGbr || isAbr || isBrush || isGih) reader.readAsArrayBuffer(f); else reader.readAsDataURL(f);
      impFile.value = ''; // allow re-importing the same file
    });
  }
}
