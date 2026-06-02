/**
 * Brush Settings live preview — a small strip that renders a sample stroke with
 * the CURRENT brush settings (size / opacity / flow / softness / dynamics /
 * blend / pressure-curve) and re-renders whenever a brush control changes, so
 * the painter sees the brush before committing. Bonus: drag inside the strip to
 * TEST-paint without switching tools or touching the document.
 *
 * Uses the real brush engine + preset (same path as the canvas) so the preview
 * is faithful. Renders onto its own canvas; never touches the document.
 */
import { state } from './state.js';
import { createBrushEngine } from './brush/index.js';
import { getPreset } from './brush/presets.js';
import { makeNoiseGrain } from './brush/grain-textures.js';
import { samplePressure } from './pressure-response.js';

const W = 240, H = 64;

// Document-level delegation handlers from the previous mount. _buildEditor
// regenerates the controls HTML (and thus the preview host) on every editor
// open, so mountBrushPreview re-runs against a fresh element each time; without
// removing the prior pair, the old handlers (closing over a detached canvas)
// accumulate one set per open. Track them at module scope so a re-mount can
// detach the previous listeners first.
let _prevInputHandler = null, _prevChangeHandler = null;

function buildRuntime() {
  return {
    size: state.brushSize,
    opacity: (state.brushOpacity != null ? state.brushOpacity : 100) / 100,
    flow: (state.brushFlow != null ? state.brushFlow : 100) / 100,
    color: state.color || '#000000',
    hardness: Math.max(0, Math.min(1, 1 - (state.brushSoftness || 0) / 300)),
    symmetry: 'none',
    angleFollow: !!state.brushAngleFollow,
    tiltAngle: false, tiltAz: 0,
    brushBlend: state.brushBlendMode || 'source-over',
    colorJitter: state.brushColorJitter || 0,
    sizeJitter: state.brushSizeJitter || 0,
    flowJitter: state.brushFlowJitter || 0,
    lockAlpha: false, erase: false, symN: 6,
  };
}

function makeEngine() {
  const preset = getPreset(state.brushPresetId);
  if (preset.grainKind === 'noise' && !preset._grainCanvas) preset._grainCanvas = makeNoiseGrain(128, 128);
  return createBrushEngine({
    ...preset,
    grain: preset.grain || preset._grainCanvas || null,
    grainDepth: preset.grainDepth != null ? preset.grainDepth : 1,
    scatter: state.brushScatter != null ? state.brushScatter : preset.scatter,
    spacing: state.brushSpacing != null ? state.brushSpacing : preset.spacing,
    ratio: state.brushRoundness != null ? state.brushRoundness : preset.ratio,
  });
}

export function mountBrushPreview() {
  const host = document.getElementById('ge-brush-preview-host');
  if (!host || host.dataset.mounted) return;
  host.dataset.mounted = '1';
  const cv = document.createElement('canvas');
  cv.className = 'ge-brush-preview';
  cv.width = W; cv.height = H;
  host.appendChild(cv);
  const ctx = cv.getContext('2d');

  // Auto-rendered sample stroke: an S-curve with a pressure hump (thin→thick→
  // thin) so size/opacity dynamics read at a glance.
  function renderSample() {
    ctx.clearRect(0, 0, W, H);
    let eng;
    try { eng = makeEngine(); } catch { return; }
    const rt = buildRuntime();
    const pts = [];
    const N = 40;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const x = 14 + t * (W - 28);
      const y = H / 2 + Math.sin(t * Math.PI * 2) * (H / 2 - 12);
      pts.push({ x, y, pressure: samplePressure(0.12 + 0.88 * Math.sin(t * Math.PI)) });
    }
    try {
      eng.begin(ctx, rt);
      for (let i = 1; i < pts.length; i++) eng.segment(ctx, pts[i - 1], pts[i], rt);
      eng.end();
    } catch {}
  }

  // Test-paint: drag inside the strip to try the brush (does not touch the doc).
  let testEng = null, last = null;
  const local = (e) => {
    const r = cv.getBoundingClientRect();
    // r.width/height can be 0 when the panel is collapsed (display:none) while a
    // pointer is still captured — avoid Infinity/NaN coords reaching the engine.
    const sx = r.width ? W / r.width : 0, sy = r.height ? H / r.height : 0;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  };
  cv.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch {}
    ctx.clearRect(0, 0, W, H);
    try { testEng = makeEngine(); } catch { testEng = null; }
    last = local(e);
    if (!Number.isFinite(last.x) || !Number.isFinite(last.y)) { last = null; return; }
    if (testEng) { const rt = buildRuntime(); const p = { ...last, pressure: 1 }; testEng.begin(ctx, rt); testEng.segment(ctx, p, p, rt); }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!testEng || !last) return;
    const p = local(e);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    const rt = buildRuntime();
    testEng.segment(ctx, { ...last, pressure: 1 }, { ...p, pressure: 1 }, rt);
    last = p;
  });
  const stop = () => { if (testEng) { try { testEng.end(); } catch {} } testEng = null; last = null; };
  cv.addEventListener('pointerup', stop);
  cv.addEventListener('pointercancel', stop);

  // Re-render on any brush-control change (delegated, debounced).
  let raf = 0;
  const schedule = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; if (!testEng) renderSample(); }); };
  // Detach any handlers left by a prior mount before wiring the new ones, so
  // the document listeners don't accumulate across editor re-opens.
  if (_prevInputHandler) document.removeEventListener('input', _prevInputHandler);
  if (_prevChangeHandler) document.removeEventListener('change', _prevChangeHandler);
  const onInput = (e) => {
    const id = e.target && e.target.id;
    if (id && (id.startsWith('ge-brush-') || id.startsWith('ge-ok-') || id === 'ge-active-blend')) schedule();
  };
  const onChange = (e) => {
    const id = e.target && e.target.id;
    if (id && (id.startsWith('ge-brush-') || id.startsWith('ge-sm-'))) schedule();
  };
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  _prevInputHandler = onInput;
  _prevChangeHandler = onChange;
  // Initial paint (defer so fonts/layout settle).
  requestAnimationFrame(renderSample);

  // Expose a manual refresh for callers that change brush state programmatically.
  window.__geBrushPreviewRefresh = renderSample;
}
