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

export function createStrokePipeline({ activeLayer, getActiveMaskLayer, composite }) {
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
      symmetry: state.brushSymmetry || 'none',
      symN: state.brushSymmetryN || 6,
      flowPressure: !isEraser && !!state.brushPressureOpacity,
      angleFollow: !isEraser && !!state.brushAngleFollow,
      tiltAngle: !isEraser && !!state.brushTiltAngle,
      tiltAz: Math.atan2(state.tiltY || 0, state.tiltX || 0),
      brushBlend: isEraser ? 'source-over' : (state.brushBlendMode || 'source-over'),
      colorJitter: isEraser ? 0 : (state.brushColorJitter || 0),
      sizeJitter: isEraser ? 0 : (state.brushSizeJitter || 0),
      flowJitter: isEraser ? 0 : (state.brushFlowJitter || 0),
      lockAlpha: !isEraser && !!(layer && layer.lockAlpha),
      erase: isEraser,
    };
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

    const pr = samplePressure(state.lastPressure != null ? state.lastPressure : (state.pressure != null ? state.pressure : 1));
    const tiltMag = Math.min(1, Math.hypot(state.tiltX || 0, state.tiltY || 0) / 90);
    let effSize = state.brushSize;
    if (state.brushTiltSize && tiltMag > 0) effSize *= (1 + tiltMag);
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
    if (emitted) composite();
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
    const hardStop = stampRadius * (1 - softness);
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
    composite();
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
      composite();
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
    // PS raster layer mask: when editing the active layer's visibility mask,
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
        const isStart = state.lastX === x && state.lastY === y;
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
        // Remap raw stylus pressure through the user's response curve (CSP-style
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
        const nowT = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        if (isStart || state.lastStrokeT == null) state.lastStrokeT = nowT;
        const dt = Math.max(1, nowT - state.lastStrokeT);
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
        const isEraser = state.tool === 'eraser';
        const rt = {
          size: effSize,
          opacity: (isEraser ? state.eraserOpacity : state.brushOpacity) / 100,  // stroke-level cap
          flow: (isEraser ? state.eraserFlow : state.brushFlow) / 100,           // per-dab build-up
          color: isEraser ? '#000000' : state.color,  // color is irrelevant when erasing
          hardness: Math.max(0, Math.min(1, 1 - (isEraser ? state.eraserSoftness : state.brushSoftness) / 300)),
          symmetry: state.brushSymmetry || 'none',
          symN: state.brushSymmetryN || 6,
          flowPressure: !isEraser && !!state.brushPressureOpacity, // pen pressure → opacity

          angleFollow: !isEraser && !!state.brushAngleFollow,
          tiltAngle: !isEraser && !!state.brushTiltAngle,
          tiltAz: Math.atan2(state.tiltY || 0, state.tiltX || 0), // pen tilt azimuth (rad)
          brushBlend: isEraser ? 'source-over' : (state.brushBlendMode || 'source-over'),
          colorJitter: isEraser ? 0 : (state.brushColorJitter || 0),
          sizeJitter: isEraser ? 0 : (state.brushSizeJitter || 0),
          flowJitter: isEraser ? 0 : (state.brushFlowJitter || 0),
          lockAlpha: !isEraser && !!(layer && layer.lockAlpha),
          erase: isEraser,
        };
        // tryBegin seeds lastX/lastY to the start point, so a dist-0 first
        // call marks the stroke start → snapshot the layer + reset the buffer.
        if (isStart) eng.begin(ctx, rt);
        eng.segment(
          ctx,
          { x: fromX, y: fromY, pressure: fromPr, tilt: tiltMag },
          { x: toX, y: toY, pressure: pr, tilt: tiltMag },
          rt,
        );
        // Dirty rect = the segment's bounding box grown by the dab footprint
        // (diameter + a margin for soft edges). In IMAGE space — composite()
        // renders 1:1 (view zoom/pan is CSS). composite() ignores it when a
        // global redraw is needed (overlays / custom blends / fx), so the
        // result is always correct; this just skips a full repaint per dab.
        const _m = effSize * 1.2 + 6;
        const dirty = {
          x: Math.min(state.lastX, tx) - _m,
          y: Math.min(state.lastY, ty) - _m,
          w: Math.abs(tx - state.lastX) + 2 * _m,
          h: Math.abs(ty - state.lastY) + 2 * _m,
        };
        state.lastX = tx;
        state.lastY = ty;
        state.lastPressure = pr;
        // Symmetry mirrors dabs across the canvas centre and large scatter throws
        // them up to scatter×size away — both land OUTSIDE this endpoint-derived
        // rect. The engine paints them onto the layer correctly, but a dirty-rect
        // composite() would only blit this local bbox, leaving the mirrored /
        // far-scattered paint invisible until an unrelated full redraw. Force a
        // full composite for those cases so the screen matches the layer.
        const _scatter = (eng.preset && eng.preset.scatter) || 0;
        if ((rt.symmetry && rt.symmetry !== 'none') || _scatter > 1.2) composite();
        else composite(dirty);
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
        // PS layer mask: paint a GRAYSCALE tone from the foreground colour —
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

    // Inpaint / region masks are full-image (no per-layer offset). But the PS
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
    composite();
  }

  // Publish the stroke-end drain on shared state so the canvas event layer
  // (which only receives the endDraw callback) can run it on lift WITHOUT a new
  // dependency wired through the editor. Idempotent across repeated pipelines.
  state.drainSmoothing = drainSmoothing;

  return { strokeTo, cloneStrokeTo, drainSmoothing };
}
