/**
 * Stroke pipeline — paints one segment (last-position → current
 * position) onto the active layer (or its active mask sub-layer).
 *
 * `strokeTo` dispatches by tool:
 *   - clone  → cloneStrokeTo (custom stamp-based paint loop)
 *   - brush  → source-over with opacity × flow + softness blur
 *   - eraser → destination-out with opacity × flow + softness blur
 *   - inpaint → source-over (paint) or destination-out (erase) with
 *               full alpha on the mask canvas
 *
 * If the active parent has an active mask sub-layer, brush / eraser /
 * inpaint target the mask canvas instead of the layer's pixel canvas.
 *
 * @param {{
 *   activeLayer:          () => object | null,
 *   getActiveMaskLayer:   () => object | null,
 *   composite:            () => void,
 * }} deps
 */
import { state } from './state.js';
import { samplePressure } from './pressure-response.js';
import { createBrushEngine } from './brush/index.js';
import { getPreset } from './brush/presets.js';
import { makeNoiseGrain } from './brush/grain-textures.js';

// 1×1 scratch canvas to resolve any CSS colour the fast paths below can't parse
// (named colours like 'white', hsl()/hsla(), #rgba / #rrggbbaa). Built lazily and
// reused so the fallback doesn't allocate per stroke segment.
let _lumaProbe = null, _lumaProbeCtx = null;
function _cssToRgb(css) {
  if (!_lumaProbe) {
    _lumaProbe = document.createElement('canvas');
    _lumaProbe.width = 1; _lumaProbe.height = 1;
    _lumaProbeCtx = _lumaProbe.getContext('2d', { willReadFrequently: true });
  }
  _lumaProbeCtx.clearRect(0, 0, 1, 1);
  // An invalid colour leaves fillStyle unchanged; clear to a known sentinel first
  // so an unparseable string resolves to black (0) rather than a stale value.
  _lumaProbeCtx.fillStyle = '#000000';
  _lumaProbeCtx.fillStyle = css;
  _lumaProbeCtx.fillRect(0, 0, 1, 1);
  const d = _lumaProbeCtx.getImageData(0, 0, 1, 1).data;
  return { r: d[0], g: d[1], b: d[2] };
}

// Rec.601 luminance (0..255) of any CSS colour string — converts the foreground
// colour to a grayscale tone when painting a layer mask (black hides, white
// reveals, gray = partial). Fast-parses #rgb / #rrggbb and rgb()/rgba(); falls
// back to a canvas probe for named colours / hsl() / #rgba so an unparseable
// value no longer silently resolves to black (which would hide instead of reveal).
function _lumaOf(css) {
  let r = 0, g = 0, b = 0, parsed = false;
  if (typeof css === 'string' && css[0] === '#') {
    let h = css.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length === 6) {
      const n = parseInt(h, 16);
      if (!Number.isNaN(n)) { r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255; parsed = true; }
    }
  } else {
    const m = /rgba?\(([^)]+)\)/i.exec(css || '');
    if (m) { const p = m[1].split(',').map((s) => parseFloat(s)); r = p[0] || 0; g = p[1] || 0; b = p[2] || 0; parsed = true; }
  }
  if (!parsed && typeof css === 'string' && css) {
    try { ({ r, g, b } = _cssToRgb(css)); } catch { r = g = b = 0; }
  }
  return r * 0.299 + g * 0.587 + b * 0.114;
}

// Lazily-built brush engine, rebuilt when the active preset OR a live dynamics
// override (scatter / spacing / roundness) changes. Module singleton so the
// dab-spacing residual + tip cache persist across strokes. The dynamics
// overrides are merged onto the preset here, so the engine itself stays
// unaware of editor state.
let _brushEngine = null;
let _brushEngineKey = null;
function getBrushEngine() {
  const sc = state.brushScatter, sp = state.brushSpacing, rd = state.brushRoundness;
  const key = `${state.brushPresetId}|${sc}|${sp}|${rd}`;
  if (!_brushEngine || _brushEngineKey !== key) {
    const preset = getPreset(state.brushPresetId);
    // Materialise procedural grain (built-in textured presets) once, cached.
    if (preset.grainKind === 'noise' && !preset._grainCanvas) {
      preset._grainCanvas = makeNoiseGrain(128, 128);
    }
    _brushEngine = createBrushEngine({
      ...preset,
      grain: preset.grain || preset._grainCanvas || null,
      grainDepth: preset.grainDepth != null ? preset.grainDepth : 1,
      scatter: sc != null ? sc : preset.scatter,
      spacing: sp != null ? sp : preset.spacing,
      ratio: rd != null ? rd : preset.ratio,
    });
    _brushEngineKey = key;
  }
  return _brushEngine;
}

export function createStrokePipeline({ activeLayer, getActiveMaskLayer, composite, scheduleComposite }) {
  // In-stroke renders coalesce to one composite per animation frame (set by the
  // editor); fall back to synchronous composite if a scheduler wasn't provided.
  const paint = scheduleComposite || composite;
  // Resolve which canvas/offset a brush-engine stroke targets for the CURRENT
  // active layer + tool, mirroring the routing in strokeTo. Returns null when
  // the brush-engine path doesn't apply (mask paint / inpaint / no layer), so
  // callers (strokeTo's fast-path and the stroke-end drain) stay in agreement.
  function resolveBrushTarget() {
    const layer = activeLayer();
    if (!layer) return null;
    if (!(state.tool === 'brush' || state.tool === 'eraser')) return null;
    const activeMask = getActiveMaskLayer();
    const editingLayerMask = !!(state.layerMaskEdit && layer.layerMask);
    const paintingMask = editingLayerMask || !!activeMask;
    if (paintingMask) return null; // mask paint uses the legacy line stroke
    const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
    return { layer, ctx: layer.ctx, off };
  }

  // Build the per-stroke brush-engine runtime object (size/opacity/flow/color/
  // dynamics flags) from editor state, at a given effective size. Pulled out of
  // strokeTo so the stroke-end drain can re-emit dabs with the same look.
  function buildBrushRuntime(layer, effSize, tiltMag) {
    const isEraser = state.tool === 'eraser';
    return {
      size: effSize,
      opacity: (isEraser ? state.eraserOpacity : state.brushOpacity) / 100,
      flow: (isEraser ? state.eraserFlow : state.brushFlow) / 100,
      color: isEraser ? '#000000' : state.color,
      hardness: Math.max(0, Math.min(1, 1 - (isEraser ? state.eraserSoftness : state.brushSoftness) / 300)),
      symmetry: state.symActive ? (state.brushSymmetry || 'none') : 'none',
      symN: state.brushSymmetryN || 6,
      symCx: state.symCx, symCy: state.symCy, symAngle: state.symAngle || 0,
      flowPressure: !isEraser && !!state.brushPressureOpacity,
      angleFollow: !isEraser && !!state.brushAngleFollow,
      tiltAngle: !isEraser && !!state.brushTiltAngle,
      tiltAz: Math.atan2(state.tiltY || 0, state.tiltX || 0),
      brushBlend: isEraser ? 'source-over' : (state.brushBlendMode || 'source-over'),
      colorJitter: isEraser ? 0 : (state.brushColorJitter || 0),
      sizeJitter: isEraser ? 0 : (state.brushSizeJitter || 0),
      flowJitter: isEraser ? 0 : (state.brushFlowJitter || 0),
      dualEnabled: !isEraser && !!state.brushDualEnabled,
      dualTipType: state.brushDualTipType || 'round',
      dualScale: state.brushDualScale != null ? state.brushDualScale : 0.35,
      dualCount: state.brushDualCount != null ? state.brushDualCount : 6,
      dualScatter: state.brushDualScatter != null ? state.brushDualScatter : 0.8,
      dualHardness: state.brushDualHardness != null ? state.brushDualHardness : 1,
      airbrushPulse: !isEraser && !!state.airbrush, // held-airbrush build-up: keep stamping at a stationary point
      lockAlpha: !isEraser && !!(layer && layer.lockAlpha),
      erase: isEraser,
    };
  }

  // Centripetal Catmull-Rom: paint the curve segment from P1 to P2 using its
  // neighbours P0 and P3, so the path curves smoothly THROUGH every captured
  // sample (apexes are hit, not cut) instead of joining samples with straight
  // chords. Centripetal parameterisation (alpha 0.5) avoids the loops/overshoot
  // uniform Catmull-Rom produces on sharp turns. Pressure is interpolated P1->P2.
  // Each point is {x,y,pr} in IMAGE space; emitted dabs are in layer-local space.
  // Reused endpoint scratch for eng.segment — it reads both endpoints
  // synchronously and never retains them, so mutating two objects avoids
  // allocating a fresh pair per sub-segment (up to ~64 per input sample → heavy
  // GC churn → the periodic frame stalls that dropped samples mid-stroke).
  const _segA = { x: 0, y: 0, pressure: 1, tilt: 0 };
  const _segB = { x: 0, y: 0, pressure: 1, tilt: 0 };
  function drawCRSegment(eng, ctx, rt, off, tiltMag, P0, P1, P2, P3, acc) {
    const d = Math.hypot(P2.x - P1.x, P2.y - P1.y);
    // Sub-sample the curve about every 6 image px (the dab spacing fills the rest);
    // each sub-segment is an eng.segment + recompose call, so keeping this modest
    // limits per-input-sample work and keeps the frame rate up.
    const N = Math.max(2, Math.min(32, Math.round(d / 6)));
    const knot = (ti, A, B) => ti + (Math.pow((B.x - A.x) * (B.x - A.x) + (B.y - A.y) * (B.y - A.y), 0.25) || 1e-4);
    const t0 = 0, t1 = knot(t0, P0, P1), t2 = knot(t1, P1, P2), t3 = knot(t2, P2, P3);
    const d10 = (t1 - t0) || 1e-4, d21 = (t2 - t1) || 1e-4, d32 = (t3 - t2) || 1e-4, d20 = (t2 - t0) || 1e-4, d31 = (t3 - t1) || 1e-4;
    let pvx = P1.x, pvy = P1.y, pvp = P1.pr;
    for (let i = 1; i <= N; i++) {
      const tt = i / N, t = t1 + (t2 - t1) * tt;
      const A1x = ((t1 - t) * P0.x + (t - t0) * P1.x) / d10, A1y = ((t1 - t) * P0.y + (t - t0) * P1.y) / d10;
      const A2x = ((t2 - t) * P1.x + (t - t1) * P2.x) / d21, A2y = ((t2 - t) * P1.y + (t - t1) * P2.y) / d21;
      const A3x = ((t3 - t) * P2.x + (t - t2) * P3.x) / d32, A3y = ((t3 - t) * P2.y + (t - t2) * P3.y) / d32;
      const B1x = ((t2 - t) * A1x + (t - t0) * A2x) / d20, B1y = ((t2 - t) * A1y + (t - t0) * A2y) / d20;
      const B2x = ((t3 - t) * A2x + (t - t1) * A3x) / d31, B2y = ((t3 - t) * A2y + (t - t1) * A3y) / d31;
      const cxv = ((t2 - t) * B1x + (t - t1) * B2x) / d21, cyv = ((t2 - t) * B1y + (t - t1) * B2y) / d21;
      const cp = P1.pr + (P2.pr - P1.pr) * tt;
      _segA.x = pvx - off.x; _segA.y = pvy - off.y; _segA.pressure = pvp; _segA.tilt = tiltMag;
      _segB.x = cxv - off.x; _segB.y = cyv - off.y; _segB.pressure = cp; _segB.tilt = tiltMag;
      eng.segment(ctx, _segA, _segB, rt);
      if (acc) { acc(pvx, pvy); acc(cxv, cyv); }
      pvx = cxv; pvy = cyv; pvp = cp;
    }
  }

  // Flush the final pending Catmull-Rom segment at stroke end. The live path lags
  // by one sample (a segment can't be smoothed until its FORWARD neighbour
  // arrives), so on lift we draw the last buffered segment with the end point
  // duplicated as its own forward neighbour, landing the stroke exactly where the
  // pen lifted. A single-point buffer (a tap) stamps one dab. No-op for the
  // legacy / mask path, where the buffer is never populated.
  function flushCurve() {
    const buf = state._crBuf;
    if (!buf || !buf.length) return;
    const rt = state._crRt, ctx = state._crCtx;
    const off = state._crOff || { x: 0, y: 0 }, tiltMag = state._crTilt || 0;
    if (rt && ctx) {
      let _minX = null, _minY = null, _maxX = 0, _maxY = 0;
      const acc = (px, py) => {
        if (_minX === null) { _minX = _maxX = px; _minY = _maxY = py; }
        else { if (px < _minX) _minX = px; else if (px > _maxX) _maxX = px; if (py < _minY) _minY = py; else if (py > _maxY) _maxY = py; }
      };
      const eng = getBrushEngine();
      const n = buf.length;
      if (n >= 3) drawCRSegment(eng, ctx, rt, off, tiltMag, buf[n - 3], buf[n - 2], buf[n - 1], buf[n - 1], acc);
      else if (n === 2) drawCRSegment(eng, ctx, rt, off, tiltMag, buf[0], buf[0], buf[1], buf[1], acc);
      else { const P = buf[0]; eng.segment(ctx, { x: P.x - off.x, y: P.y - off.y, pressure: P.pr, tilt: tiltMag }, { x: P.x - off.x, y: P.y - off.y, pressure: P.pr, tilt: tiltMag }, rt); acc(P.x, P.y); }
      if (_minX !== null) { const m = (rt.size || state.brushSize) * 1.2 + 6; paint({ x: _minX - m, y: _minY - m, w: (_maxX - _minX) + 2 * m, h: (_maxY - _minY) + 2 * m }); }
      else paint();
    }
    buf.length = 0;
  }

  // "Catch-up on Stroke End" — with the stabilizer on, the painted brush
  // (state.lastX/Y, the smoothed position) trails the true cursor. On lift we
  // drain that remaining tail: step the smoothing EMA from the current smoothed
  // position to the captured raw release point (state.rawX/Y), emitting brush
  // segments along the natural decelerating curve so the stroke actually
  // reaches where the pen lifted instead of falling short.
  //
  // The engine's per-segment dab spacing (its `residual`) is preserved across
  // these calls, so dabs stay correctly spaced and the final dab is NOT
  // double-painted. Bounded by a hard iteration cap so a pathological gap can't
  // spin forever; the last step snaps exactly to the raw point.
  //
  // No-op (and behaviour unchanged) unless catch-up is enabled, smoothing is
  // active, the brush engine is in use, the tool is brush/eraser on a pixel
  // layer, Pulled-String mode is off, and a real gap exists. Returns the number
  // of drain segments emitted (0 = nothing drained).
  function drainSmoothing() {
    if (!state.brushSmoothCatchupEnd) return 0;       // disabled → leave the tail short
    if (state.brushSmoothPull) return 0;              // Pulled-String trails by design
    if (!state.useBrushEngine) return 0;
    if (!(state.brushSmoothing > 0)) return 0;        // no smoothing → already at the cursor
    if (state.rawX == null || state.rawY == null) return 0;
    const tgt = resolveBrushTarget();
    if (!tgt) return 0;
    const { layer, ctx, off } = tgt;

    const rawX = state.rawX, rawY = state.rawY;
    // Gap between the smoothed/painted position and the true release point.
    if (Math.abs(rawX - state.smoothX) <= 0.5 && Math.abs(rawY - state.smoothY) <= 0.5) return 0;

    let eng;
    try { eng = getBrushEngine(); } catch { return 0; }
    // If no stroke is in progress in the engine, there's nothing to extend.
    // (strokeTo's first call does eng.begin(); the drain only ADDS to it.)

    // Same smoothing alpha strokeTo uses, so the drained tail decelerates the
    // same way the live stroke did. Floor it so the EMA can't asymptote forever.
    const sm = Math.max(0, Math.min(95, state.brushSmoothing || 0)) / 100;
    let sa = 1 - sm * 0.92;
    if (state.brushSmoothAdjustZoom && (state.zoom || 1) > 1) sa = 1 - (1 - sa) / Math.sqrt(state.zoom);
    sa = Math.max(0.12, Math.min(1, sa)); // guarantee forward progress per step

    // state.lastPressure is ALREADY curve-mapped (strokeTo stores the sampled
    // value), so use it directly — re-running samplePressure would apply the
    // response curve twice and step the width/density at the pen-up seam for
    // non-linear presets.
    const pr = state.lastPressure != null ? state.lastPressure : samplePressure(state.pressure != null ? state.pressure : 1);
    const tiltMag = Math.min(1, Math.hypot(state.tiltX || 0, state.tiltY || 0) / 90);
    // Reuse the width the live stroke ended on (includes velocity taper) so the
    // drained lift-tail doesn't pop back to full brush size at the seam.
    let effSize = state._lastEffSize != null ? state._lastEffSize : state.brushSize;
    if (state._lastEffSize == null && state.brushTiltSize && tiltMag > 0) effSize *= (1 + tiltMag);
    const rt = buildBrushRuntime(layer, effSize, tiltMag);

    const SNAP = 0.5;          // close enough → snap to raw and stop
    const MAX_ITERS = 256;     // hard cap so a huge gap can't loop forever
    let emitted = 0;
    for (let i = 0; i < MAX_ITERS; i++) {
      const fromX = state.smoothX, fromY = state.smoothY;
      const remX = rawX - fromX, remY = rawY - fromY;
      const rem = Math.hypot(remX, remY);
      if (rem <= SNAP) break;
      // Step the EMA toward raw; on the final approach snap exactly so the
      // stroke lands on the lift point (no perpetual fractional shortfall).
      let nx = fromX + remX * sa;
      let ny = fromY + remY * sa;
      const stepped = Math.hypot(nx - fromX, ny - fromY);
      if (rem - stepped <= SNAP) { nx = rawX; ny = rawY; }
      state.smoothX = nx; state.smoothY = ny;
      eng.segment(
        ctx,
        { x: state.lastX - off.x, y: state.lastY - off.y, pressure: pr, tilt: tiltMag },
        { x: nx - off.x, y: ny - off.y, pressure: pr, tilt: tiltMag },
        rt,
      );
      state.lastX = nx;
      state.lastY = ny;
      emitted++;
      if (nx === rawX && ny === rawY) break;
    }
    if (emitted) paint();
    return emitted;
  }

  function cloneStrokeTo(x, y, layer) {
    if (!state.cloneSourceSnapshot) return;
    const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
    const dx = x - state.cloneStrokeStartX;
    const dy = y - state.cloneStrokeStartY;
    const srcX = state.cloneSourceX + dx;
    const srcY = state.cloneSourceY + dy;
    const ctx = layer.ctx;
    const radius = Math.max(1, state.brushSize / 2);
    // Walk last → current in roughly half-brush steps so stamps
    // overlap into a continuous brush trail.
    const lastSrcX = state.cloneSourceX + (state.lastX - state.cloneStrokeStartX);
    const lastSrcY = state.cloneSourceY + (state.lastY - state.cloneStrokeStartY);
    const dist = Math.hypot(x - state.lastX, y - state.lastY);
    const step = Math.max(1, radius * 0.5);
    const steps = Math.max(1, Math.ceil(dist / step));
    const stampSize = Math.max(2, Math.ceil(radius * 2));
    const stampRadius = stampSize / 2;
    const stamp = document.createElement('canvas');
    stamp.width = stampSize;
    stamp.height = stampSize;
    const stampCtx = stamp.getContext('2d');
    const softness = Math.max(0, Math.min(1, state.cloneSoftness / 300));
    // Inner (opaque) radius for the feather gradient. Clamp strictly below the
    // outer radius: a radial gradient whose two circles are identical (r0===r1,
    // which happens at softness 0 → hardStop===stampRadius) renders nothing per
    // spec, so destination-in would erase the whole stamp (hard brush = invisible).
    const hardStop = Math.min(stampRadius * (1 - softness), stampRadius - 0.5);
    ctx.save();
    ctx.globalAlpha = (state.cloneOpacity / 100) * (state.cloneFlow / 100);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const px = state.lastX + (x - state.lastX) * t - off.x;
      const py = state.lastY + (y - state.lastY) * t - off.y;
      const sx = lastSrcX + (srcX - lastSrcX) * t;
      const sy = lastSrcY + (srcY - lastSrcY) * t;
      stampCtx.clearRect(0, 0, stampSize, stampSize);
      stampCtx.globalCompositeOperation = 'source-over';
      stampCtx.drawImage(
        state.cloneSourceSnapshot,
        sx - stampRadius, sy - stampRadius, stampSize, stampSize,
        0, 0, stampSize, stampSize,
      );
      stampCtx.globalCompositeOperation = 'destination-in';
      const mask = stampCtx.createRadialGradient(stampRadius, stampRadius, hardStop, stampRadius, stampRadius, stampRadius);
      mask.addColorStop(0, 'rgba(0,0,0,1)');
      mask.addColorStop(1, 'rgba(0,0,0,0)');
      stampCtx.fillStyle = mask;
      stampCtx.fillRect(0, 0, stampSize, stampSize);
      ctx.drawImage(stamp, px - stampRadius, py - stampRadius);
    }
    ctx.restore();
    state.lastX = x;
    state.lastY = y;
    paint();
  }

  function strokeTo(x, y) {
    // Quick Mask — brush/eraser paint the selection mask (wandMask) rather than
    // a layer. Paint adds to the selection, eraser removes. White = selected.
    if (state.quickMask && (state.tool === 'brush' || state.tool === 'eraser')) {
      if (!state.wandMask && state.imgWidth) {
        const m = document.createElement('canvas');
        m.width = state.imgWidth; m.height = state.imgHeight;
        state.wandMask = m; state.wandLayerId = state.activeLayerId; state.wandMaskVisible = true;
      }
      if (state.wandMask) {
        const mctx = state.wandMask.getContext('2d');
        mctx.save();
        mctx.lineWidth = state.brushSize;
        mctx.lineCap = 'round';
        mctx.lineJoin = 'round';
        if (state.tool === 'eraser') { mctx.globalCompositeOperation = 'destination-out'; mctx.strokeStyle = 'rgba(0,0,0,1)'; }
        else { mctx.globalCompositeOperation = 'source-over'; mctx.strokeStyle = 'rgba(255,255,255,1)'; }
        mctx.beginPath();
        mctx.moveTo(state.lastX, state.lastY);
        mctx.lineTo(x, y);
        mctx.stroke();
        mctx.restore();
      }
      state.lastX = x;
      state.lastY = y;
      paint();
      return;
    }
    const layer = activeLayer();
    if (!layer) return;
    // Clone uses a stamp-based paint loop, not the line-stroke
    // pipeline below.
    if (state.tool === 'clone') return cloneStrokeTo(x, y, layer);

    // If the active parent has an active mask sub-layer, brush /
    // eraser / inpaint paint the mask canvas instead of the layer's
    // pixel canvas. Brush adds to the mask, Eraser carves it away,
    // Inpaint still works (its mask plumbing was already pointed at
    // the same canvas).
    const activeMask = getActiveMaskLayer();
    // Raster layer mask: when editing the active layer's visibility mask,
    // route paint onto it (brush reveals = adds coverage, eraser hides = carves)
    // exactly like the inpaint-region mask path, but onto `layer.layerMask`.
    const editingLayerMask = !!(state.layerMaskEdit && layer.layerMask) &&
      (state.tool === 'brush' || state.tool === 'eraser');
    const paintingMask = editingLayerMask || (!!activeMask &&
      (state.tool === 'brush' || state.tool === 'eraser' || state.tool === 'inpaint'));
    const ctx = editingLayerMask
      ? layer.layerMask.getContext('2d')
      : paintingMask
        ? activeMask.ctx
        : (state.tool === 'inpaint' ? state.maskCtx : layer.ctx);
    const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };

    // Brush engine path (M1) — dab stamping with pressure dynamics. Only the
    // paint brush on a pixel layer (not masks / inpaint / eraser / clone),
    // and only when enabled. Any engine error falls through to the legacy
    // line stroke below so painting never hard-fails.
    if (state.useBrushEngine && (state.tool === 'brush' || state.tool === 'eraser') && !paintingMask) {
      try {
        const eng = getBrushEngine();
        // First dab of THIS stroke. Use an explicit per-stroke flag, not
        // coordinate equality: the airbrush timer re-emits strokeTo at the same
        // point, which would otherwise read as "start" every tick → eng.begin()
        // re-snapshots the layer and resets the opacity cap, letting a held
        // airbrush build past the Opacity slider. The flag is set false at
        // pointerdown (tools/stroke.js) so each real stroke begins exactly once.
        const isStart = !state._engStrokeStarted;
        // Stroke stabilizer — lag the painted target toward the cursor for
        // smoother lines. brushSmoothing 0 → alpha 1 → no change (no
        // regression). Reset to the cursor at stroke start.
        if (isStart) { state.smoothX = x; state.smoothY = y; }
        state.rawX = x; state.rawY = y; // true cursor (for Catch-up on Stroke End)
        const sm = Math.max(0, Math.min(95, state.brushSmoothing || 0)) / 100;
        let sa = 1 - sm * 0.92;
        // "Adjust for Zoom" — ease the catch-up more when zoomed in so the
        // smoothing feels consistent regardless of magnification.
        if (state.brushSmoothAdjustZoom && (state.zoom || 1) > 1) sa = 1 - (1 - sa) / Math.sqrt(state.zoom);
        // Adaptive de-noise (a 1-euro-style filter): smooth SLOW strokes to remove
        // the input wobble — the digitizer reports integer device pixels, and when
        // zoomed out each maps to 1/zoom image px, so a slow deliberate line traces
        // a visible staircase. Leave FAST strokes untouched so corners/peaks stay
        // sharp (fast = widely-spaced samples, negligible relative noise). Speed is
        // measured in SCREEN px/ms so it behaves the same at any zoom. Never weaker
        // than the user's own smoothing.
        const _nowSa = (state._evtTime != null) ? state._evtTime
          : ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
        if (!isStart && state.lastStrokeT != null) {
          const _dtSa = Math.max(1, _nowSa - state.lastStrokeT);
          const _spdScreen = (Math.hypot(x - state.lastX, y - state.lastY) * (state.zoom || 1)) / _dtSa;
          // at rest → 0.35 (smooth); ramps to 1 (no smoothing) by ~1.6 screen px/ms,
          // so slow AND moderate "deliberate line" speeds get cleaned while quick
          // strokes (> ~1.6 px/ms) stay perfectly sharp.
          sa = Math.min(sa, Math.max(0.35, Math.min(1, 0.35 + _spdScreen * 0.4)));
        }
        if (state.brushSmoothPull && sm > 0 && !isStart) {
          // "Pulled String" — the brush trails the cursor by a fixed radius and
          // only moves once the cursor pulls past it (lasso-like control).
          const dx = x - state.smoothX, dy = y - state.smoothY, d = Math.hypot(dx, dy);
          const R = 6 / (state.zoom || 1) + state.brushSize * 0.15;
          if (d <= R) return; // inside the slack — brush stays put, nothing painted
          state.smoothX = x - (dx / d) * R;
          state.smoothY = y - (dy / d) * R;
        } else {
          state.smoothX += (x - state.smoothX) * sa;
          state.smoothY += (y - state.smoothY) * sa;
        }
        const tx = state.smoothX, ty = state.smoothY;
        const fromX = state.lastX - off.x;
        const fromY = state.lastY - off.y;
        const toX = tx - off.x;
        const toY = ty - off.y;
        // Remap raw stylus pressure through the user's response curve (the standard
        // calibration). Identity for the default linear curve, so mouse/no-curve
        // users are unaffected.
        const pr = samplePressure(state.pressure != null ? state.pressure : 1);
        // Interpolate pressure ACROSS the segment: use the previous sample's
        // pressure as the segment start so a press/release tapers smoothly
        // along the dabs, instead of stepping once per frame (flat per segment).
        if (isStart || state.lastPressure == null) state.lastPressure = pr;
        const fromPr = state.lastPressure;
        // Velocity taper (the "speed" sensor): fast strokes paint thinner. The
        // segment speed is dist/dt; brushVelocityTaper 0 = off (no change).
        // Use the input EVENT's timestamp (state._evtTime, set by the event
        // handlers) rather than performance.now(): replayed coalesced sub-frame
        // samples execute microseconds apart on the wall clock, which would
        // collapse dt to the floor and massively over-inflate speed. The event
        // timestamps carry the true per-sample deltas. Falls back to the clock
        // for programmatic / airbrush ticks that have no event.
        const nowT = (state._evtTime != null)
          ? state._evtTime
          : ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
        if (isStart || state.lastStrokeT == null) state.lastStrokeT = nowT;
        const dt = Math.max(0.1, nowT - state.lastStrokeT);
        const segDist = Math.hypot(tx - state.lastX, ty - state.lastY);
        state.lastStrokeT = nowT;
        let effSize = state.brushSize;
        const vt = (state.brushVelocityTaper || 0) / 100;
        if (vt > 0 && !isStart) {
          const speed = segDist / dt; // px per ms
          effSize = Math.max(1, state.brushSize * (1 - Math.min(1, speed / 4) * vt));
        }
        // Pen tilt ELEVATION (the "tilt" sensor): a flatter pen lays down a
        // broader dab, like a real brush held at an angle. tiltX/tiltY are
        // degrees from vertical; magnitude 0 (upright) = no change, ~90° (flat)
        // ≈ +100% size. Composes multiplicatively with pressure/velocity. The
        // azimuth (direction) already drives tip rotation via rt.tiltAz.
        const tiltMag = Math.min(1, Math.hypot(state.tiltX || 0, state.tiltY || 0) / 90);
        if (state.brushTiltSize && tiltMag > 0) effSize *= (1 + tiltMag);
        state._lastEffSize = effSize; // so the stroke-end catch-up drain matches this width
        const isEraser = state.tool === 'eraser';
        // Build the runtime ONCE per stroke and reuse it, mutating only the
        // per-sample fields (size, tilt azimuth). Allocating a ~30-field object
        // every sample was the remaining GC pressure behind the occasional frame
        // dip; brush settings are fixed for the duration of a stroke, so the rest
        // is cached at stroke start.
        let rt = state._rt;
        if (isStart || !rt) {
          rt = {
            size: effSize,
            opacity: (isEraser ? state.eraserOpacity : state.brushOpacity) / 100,  // stroke-level cap
            flow: (isEraser ? state.eraserFlow : state.brushFlow) / 100,           // per-dab build-up
            color: isEraser ? '#000000' : state.color,  // color is irrelevant when erasing
            hardness: Math.max(0, Math.min(1, 1 - (isEraser ? state.eraserSoftness : state.brushSoftness) / 300)),
            symmetry: state.symActive ? (state.brushSymmetry || 'none') : 'none',
            symN: state.brushSymmetryN || 6,
            symCx: state.symCx, symCy: state.symCy, symAngle: state.symAngle || 0,
            flowPressure: !isEraser && !!state.brushPressureOpacity, // pen pressure → opacity
            angleFollow: !isEraser && !!state.brushAngleFollow,
            tiltAngle: !isEraser && !!state.brushTiltAngle,
            tiltAz: Math.atan2(state.tiltY || 0, state.tiltX || 0), // pen tilt azimuth (rad)
            brushBlend: isEraser ? 'source-over' : (state.brushBlendMode || 'source-over'),
            colorJitter: isEraser ? 0 : (state.brushColorJitter || 0),
            sizeJitter: isEraser ? 0 : (state.brushSizeJitter || 0),
            flowJitter: isEraser ? 0 : (state.brushFlowJitter || 0),
            dualEnabled: !isEraser && !!state.brushDualEnabled,
            dualTipType: state.brushDualTipType || 'round',
            dualScale: state.brushDualScale != null ? state.brushDualScale : 0.35,
            dualCount: state.brushDualCount != null ? state.brushDualCount : 6,
            dualScatter: state.brushDualScatter != null ? state.brushDualScatter : 0.8,
            dualHardness: state.brushDualHardness != null ? state.brushDualHardness : 1,
            airbrushPulse: !isEraser && !!state.airbrush, // held-airbrush build-up at a stationary point
            lockAlpha: !isEraser && !!(layer && layer.lockAlpha),
            erase: isEraser,
          };
          state._rt = rt;
        } else {
          rt.size = effSize;
          rt.tiltAz = Math.atan2(state.tiltY || 0, state.tiltX || 0);
        }
        // tryBegin seeds lastX/lastY to the start point, so a dist-0 first
        // call marks the stroke start → snapshot the layer + reset the buffer.
        if (isStart) { eng.begin(ctx, rt); state._crBuf = []; }
        state._engStrokeStarted = true; // subsequent dabs (incl. airbrush ticks) add to the buffer
        // Curve smoothing — a centripetal Catmull-Rom spline through the captured
        // samples. A straight chord per sample looks polygonal when samples are
        // sparse (fast strokes, low device input rates) and a one-sided quadratic
        // barely bows; Catmull-Rom curves smoothly THROUGH every sample using
        // neighbours on both sides, so even a coarse 7-point loop renders as a
        // smooth spiral while captured apexes are still hit. Because a segment
        // needs its FORWARD neighbour to be shaped, drawing lags one sample;
        // flushCurve() (stroke end) emits the final segment. A stationary
        // (airbrush) tick stamps a straight build-up dab without touching the buffer.
        const segMove = Math.hypot(tx - state.lastX, ty - state.lastY);
        let _minX = null, _minY = null, _maxX = 0, _maxY = 0;
        const _acc = (px, py) => {
          if (_minX === null) { _minX = _maxX = px; _minY = _maxY = py; }
          else { if (px < _minX) _minX = px; else if (px > _maxX) _maxX = px; if (py < _minY) _minY = py; else if (py > _maxY) _maxY = py; }
        };
        // Stash routing so the stroke-end flush emits onto the same target/look.
        state._crCtx = ctx; state._crRt = rt; state._crOff = off; state._crTilt = tiltMag;
        if (!state._crBuf) state._crBuf = [];
        const buf = state._crBuf;
        if (segMove <= 0.6 && !isStart) {
          // Stationary / airbrush tick → straight build-up dab; leave the buffer.
          eng.segment(
            ctx,
            { x: fromX, y: fromY, pressure: fromPr, tilt: tiltMag },
            { x: toX, y: toY, pressure: pr, tilt: tiltMag },
            rt,
          );
          _acc(state.lastX, state.lastY); _acc(tx, ty);
        } else {
          buf.push({ x: tx, y: ty, pr: pr });
          const n = buf.length;
          // Draw the lagged segment (its forward neighbour is now known).
          if (n >= 4) drawCRSegment(eng, ctx, rt, off, tiltMag, buf[n - 4], buf[n - 3], buf[n - 2], buf[n - 1], _acc);
          else if (n === 3) drawCRSegment(eng, ctx, rt, off, tiltMag, buf[0], buf[0], buf[1], buf[2], _acc);
          // n < 3: defer — the segment needs a forward neighbour; flushCurve()
          // emits the start/tail at stroke end.
          while (buf.length > 4) buf.shift();
        }
        state.lastX = tx; state.lastY = ty;       // newest captured sample
        // Dirty rect = the bounding box of the painted curve grown by the dab
        // footprint (diameter + a margin for soft edges). In IMAGE space —
        // composite() renders 1:1 (view zoom/pan is CSS). composite() ignores it
        // when a global redraw is needed (overlays / custom blends / fx), so the
        // result is always correct; this just skips a full repaint per dab.
        const _m = effSize * 1.2 + 6;
        const dirty = { x: _minX - _m, y: _minY - _m, w: (_maxX - _minX) + 2 * _m, h: (_maxY - _minY) + 2 * _m };
        state.lastPressure = pr;
        // Symmetry mirrors dabs across the canvas centre and large scatter throws
        // them up to scatter×size away — both land OUTSIDE this endpoint-derived
        // rect. The engine paints them onto the layer correctly, but a dirty-rect
        // composite() would only blit this local bbox, leaving the mirrored /
        // far-scattered paint invisible until an unrelated full redraw. Force a
        // full composite for those cases so the screen matches the layer.
        const _scatter = (eng.preset && eng.preset.scatter) || 0;
        if ((rt.symmetry && rt.symmetry !== 'none') || _scatter > 1.2) paint();
        else paint(dirty);
        return;
      } catch (err) {
        if (typeof console !== 'undefined') console.warn('[brush-engine] fell back to legacy stroke:', err);
      }
    }

    ctx.save();
    ctx.lineWidth = state.brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (state.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      // Effective alpha = opacity × flow. Opacity = max strength a
      // stroke can reach; flow = how much erases per pass.
      ctx.globalAlpha = (state.eraserOpacity / 100) * (state.eraserFlow / 100);
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      if (state.eraserSoftness > 0) {
        const blurPx = (state.eraserSoftness / 100) * (state.brushSize / 2);
        ctx.filter = `blur(${blurPx.toFixed(2)}px)`;
      }
    } else if (state.tool === 'brush') {
      ctx.globalCompositeOperation = 'source-over';
      if (editingLayerMask) {
        // Layer mask: paint a GRAYSCALE tone from the foreground colour —
        // black hides, white reveals, gray = partial. Respect opacity/flow so
        // partial coverage builds up, and honour softness. (D/X give the
        // canonical black<->white mask pair.)
        const L = Math.round(_lumaOf(state.color));
        ctx.strokeStyle = `rgb(${L},${L},${L})`;
        ctx.globalAlpha = (state.brushOpacity / 100) * (state.brushFlow / 100);
        if (state.brushSoftness > 0) {
          const blurPx = (state.brushSoftness / 100) * (state.brushSize / 2);
          ctx.filter = `blur(${blurPx.toFixed(2)}px)`;
        }
      } else if (paintingMask) {
        // Inpaint-region mask sub-layer — binary white at full alpha (the
        // diffusion server expects white = region; partial pixels would muddy it).
        ctx.strokeStyle = 'rgba(255,255,255,1)';
        ctx.globalAlpha = 1;
      } else {
        // Brush — state.color onto the layer pixels.
        ctx.strokeStyle = state.color;
        ctx.globalAlpha = (state.brushOpacity / 100) * (state.brushFlow / 100);
        if (state.brushSoftness > 0) {
          const blurPx = (state.brushSoftness / 100) * (state.brushSize / 2);
          ctx.filter = `blur(${blurPx.toFixed(2)}px)`;
        }
      }
    } else if (state.tool === 'inpaint') {
      if (state.inpaintEraseStroke) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        // Diffusion server expects white = inpaint area. The red
        // overlay is rendered separately in composite() for the user.
        ctx.strokeStyle = 'rgba(255,255,255,1)';
      }
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = state.color;
    }

    // Inpaint / region masks are full-image (no per-layer offset). But the
    // layer mask (editingLayerMask) is LAYER-LOCAL — its offset is applied at
    // composite — so painting it must subtract the layer offset like pixel paint,
    // else strokes land shifted on any moved/pasted/cropped layer.
    const onFullImageMask = (paintingMask && !editingLayerMask) || state.tool === 'inpaint';
    const drawX = onFullImageMask ? 0 : off.x;
    const drawY = onFullImageMask ? 0 : off.y;

    ctx.beginPath();
    ctx.moveTo(state.lastX - drawX, state.lastY - drawY);
    ctx.lineTo(x - drawX, y - drawY);
    ctx.stroke();
    ctx.restore();

    state.lastX = x;
    state.lastY = y;
    paint();
  }

  // Publish the stroke-end drain on shared state so the canvas event layer
  // (which only receives the endDraw callback) can run it on lift WITHOUT a new
  // dependency wired through the editor. Idempotent across repeated pipelines.
  state.drainSmoothing = drainSmoothing;
  // Same idea for the Catmull-Rom stroke-end flush (the path lags one sample).
  state.flushCurve = flushCurve;

  return { strokeTo, cloneStrokeTo, drainSmoothing, flushCurve };
}
