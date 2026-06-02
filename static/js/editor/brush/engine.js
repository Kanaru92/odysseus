/**
 * Brush engine — stamps dabs along a stroke at fixed SPACING (a fraction of
 * the dab diameter), interpolating between input samples. This is the
 * primitive the current editor lacks: today `stroke-pipeline.js` draws one
 * `lineTo` per mousemove, so size/opacity can't vary mid-segment and fast
 * strokes gap. The engine stamps cached dabs at spacing; this is the browser
 * equivalent of a dab cache.
 *
 * Runtime values (size/opacity/flow/color/hardness/blendMode) are passed in
 * per stroke from editor state, and the preset's dynamics MODULATE them via
 * pressure/speed/tilt/random. So the existing brush sliders keep working and
 * pressure just shapes them.
 *
 *   const eng = createBrushEngine(preset);
 *   eng.begin(info0);
 *   eng.segment(ctx, fromInfo, toInfo, runtime);   // per mousemove/pointermove
 *   eng.end();
 */
import { makeTip } from './tips.js';
import { compileParam, lerpInfo } from './dynamics.js';
import { jitterHue } from './color-jitter.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));

function normalizePreset(p = {}) {
  return {
    id: p.id || 'custom',
    name: p.name || 'Custom',
    tipType: p.tipType || 'round',          // round | soft | gaussian | image
    tipImage: p.tipImage || null,           // Image/canvas source when tipType === 'image'
    spacing: p.spacing != null ? p.spacing : 0.1, // fraction of diameter
    ratio: p.ratio != null ? p.ratio : 1,    // aspect (height = size*ratio)
    scatter: p.scatter != null ? p.scatter : 0,
    blendMode: p.blendMode || null,          // null = inherit ctx
    grain: p.grain || null,                  // texture image; multiplies stroke alpha
    grainDepth: p.grainDepth != null ? p.grainDepth : 1, // 0..1 grain strength
    dynamics: {
      size: p.dynamics?.size || { sensor: 'pressure', curve: undefined, min: 0.15, max: 1 },
      opacity: p.dynamics?.opacity || { sensor: 'none' },
      flow: p.dynamics?.flow || { sensor: 'none' },
      rotation: p.dynamics?.rotation || { sensor: 'none', base: 0 },
    },
  };
}

export function createBrushEngine(preset) {
  const p = normalizePreset(preset);
  const sizeFn = compileParam(p.dynamics.size);
  const flowFn = compileParam(p.dynamics.flow);
  const rotationFn = compileParam(p.dynamics.rotation);

  // Tip cache keyed by rounded size + hardness + color so repeated dabs reuse
  // one offscreen canvas (the per-dab hot path stays drawImage-only).
  const cache = new Map();
  let residual = 0; // leftover spacing distance carried across segments
  let lastAngle = 0; // most recent stroke-direction angle (for tip-follows-direction)

  // ── Opacity / flow model ──
  // Dabs accumulate on an offscreen STROKE buffer at FLOW (overlapping dabs
  // build up within a single stroke). That buffer is composited onto the
  // layer at OPACITY — the cap the whole stroke can reach no matter how many
  // dabs overlap. Each segment recomposes `base + buffer@opacity` into the
  // layer for live feedback; it's baked in when the stroke ends.
  let strokeBuf = null, strokeCtx = null; // accumulating stroke (flow build-up)
  let baseSnap = null, baseCtx = null;    // layer pixels captured at stroke start
  let targetCtx = null;                   // the layer ctx being painted
  let strokeOpacity = 1;                  // stroke-level cap (Opacity slider)
  let eraseMode = false;                  // true → buffer erases base (eraser)
  let strokeBlend = 'source-over';        // brush blend mode (stroke → layer composite)
  let lockAlpha = false;                  // preserve layer transparency (paint existing pixels only)
  let painting = false;
  let grainMask = null, grainedBuf = null, grainedCtx = null; // texture/grain pass

  function tipFor(size, hardness, color) {
    const key = `${Math.max(1, Math.round(size))}|${Math.round(hardness * 100)}|${color}|${p.tipType}${p.tipImage ? '|img' : ''}`;
    let t = cache.get(key);
    if (!t) {
      t = makeTip({ type: p.tipType, size, hardness, color, image: p.tipImage });
      cache.set(key, t);
      if (cache.size > 96) cache.clear();
    }
    return t;
  }

  function ensureBuffers(w, h) {
    if (!strokeBuf) { strokeBuf = document.createElement('canvas'); strokeCtx = strokeBuf.getContext('2d'); }
    if (strokeBuf.width !== w || strokeBuf.height !== h) { strokeBuf.width = w; strokeBuf.height = h; }
    if (!baseSnap) { baseSnap = document.createElement('canvas'); baseCtx = baseSnap.getContext('2d'); }
    if (baseSnap.width !== w || baseSnap.height !== h) { baseSnap.width = w; baseSnap.height = h; }
  }

  // Build a canvas-sized alpha mask by tiling the grain texture (luminance →
  // alpha, scaled by grainDepth). Canvas-fixed (paper-texture feel).
  function ensureGrain(w, h) {
    if (!grainedBuf) { grainedBuf = document.createElement('canvas'); grainedCtx = grainedBuf.getContext('2d'); }
    if (grainedBuf.width !== w || grainedBuf.height !== h) { grainedBuf.width = w; grainedBuf.height = h; }
    if (grainMask && grainMask.width === w && grainMask.height === h) return;
    const gw = p.grain.width || p.grain.naturalWidth || 1;
    const gh = p.grain.height || p.grain.naturalHeight || 1;
    const tile = document.createElement('canvas');
    tile.width = w; tile.height = h;
    const tctx = tile.getContext('2d');
    for (let y = 0; y < h; y += gh) for (let x = 0; x < w; x += gw) tctx.drawImage(p.grain, x, y);
    const id = tctx.getImageData(0, 0, w, h);
    const d = id.data;
    const depth = Math.max(0, Math.min(1, p.grainDepth));
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = 255; d[i + 1] = 255; d[i + 2] = 255;
      d[i + 3] = 255 * (1 - depth) + lum * depth;
    }
    tctx.putImageData(id, 0, 0);
    grainMask = tile;
  }

  function doBegin(ctx, rt) {
    residual = 0;
    targetCtx = ctx || null;
    strokeOpacity = clamp01(rt && rt.opacity != null ? rt.opacity : 1);
    eraseMode = !!(rt && rt.erase);
    strokeBlend = (rt && rt.brushBlend) || 'source-over';
    lockAlpha = !!(rt && rt.lockAlpha) && !eraseMode;
    if (!targetCtx) { painting = false; return; }
    const w = targetCtx.canvas.width, h = targetCtx.canvas.height;
    ensureBuffers(w, h);
    if (p.grain) ensureGrain(w, h);
    strokeCtx.clearRect(0, 0, w, h);
    baseCtx.clearRect(0, 0, w, h);
    baseCtx.drawImage(targetCtx.canvas, 0, 0); // snapshot pre-stroke pixels
    painting = true;
  }

  // Deposit one dab onto the stroke buffer at FLOW. Size/rotation/scatter come
  // from per-dab dynamics; opacity is applied later, once, per stroke. With
  // symmetry, the dab is mirrored across the buffer's center axis/axes.
  function stampToBuffer(x, y, info, rt, baseAngle) {
    if (!strokeCtx) return;
    let size = Math.max(0.5, sizeFn(info, rt.size));
    // Per-dab size/flow jitter (Shape/Transfer Dynamics) — randomly reduces the
    // dab size/flow up to the jitter amount, for natural-media variation.
    if (rt.sizeJitter > 0) size = Math.max(0.5, size * (1 - rt.sizeJitter * Math.random()));
    let flow = clamp01(flowFn(info, rt.flow != null ? rt.flow : 1));
    if (rt.flowJitter > 0) flow *= (1 - rt.flowJitter * Math.random());
    // Pen pressure → opacity: scale per-dab deposit by the (interpolated)
    // pressure so a light touch lays down a lighter, more transparent mark.
    if (rt.flowPressure) flow *= (info.pressure != null ? info.pressure : 1);
    if (flow <= 0) return;
    // Tip rotation = stroke direction (if "follows direction") + the preset's
    // own rotation dynamic. Lets calligraphic / image tips orient along the path.
    const rot = (rt && rt.angleFollow ? (baseAngle || 0) : 0)
      + (rt && rt.tiltAngle ? (rt.tiltAz || 0) : 0)
      + (rotationFn(info, 0) || 0) * Math.PI / 180;
    // Per-dab colour jitter (Color Dynamics) — one jittered hue per dab (shared
    // across its symmetry mirrors below).
    let dabColor = rt.color || '#000';
    if (rt.colorJitter > 0) dabColor = jitterHue(dabColor, rt.colorJitter, Math.random());
    const tip = tipFor(size, rt.hardness != null ? rt.hardness : 1, dabColor);
    const w = size, h = size * p.ratio;
    // Symmetry positions across the canvas center. x/y/xy = axis mirrors;
    // radial = N rotational copies; mandala = radial + mirrored (kaleidoscope).
    // Each entry carries an optional rot (so tips orient radially) + mirror flag.
    const cw = strokeBuf.width, ch = strokeBuf.height;
    const sym = rt.symmetry || 'none';
    const positions = [{ x, y, rot: 0 }];
    if (sym === 'x' || sym === 'xy') positions.push({ x: cw - x, y, rot: 0 });
    if (sym === 'y' || sym === 'xy') positions.push({ x, y: ch - y, rot: 0 });
    if (sym === 'xy') positions.push({ x: cw - x, y: ch - y, rot: 0 });
    if (sym === 'radial' || sym === 'mandala') {
      const cx = cw / 2, cy = ch / 2;
      const N = Math.max(2, Math.round(rt.symN || 6));
      const dx = x - cx, dy = y - cy;
      for (let k = 1; k < N; k++) { // k=0 is the base dab already in `positions`
        const a = (k * 2 * Math.PI) / N, ca = Math.cos(a), sa = Math.sin(a);
        positions.push({ x: cx + dx * ca - dy * sa, y: cy + dx * sa + dy * ca, rot: a });
      }
      if (sym === 'mandala') {
        const mdx = -dx; // reflect the source across the centre's vertical axis
        for (let k = 0; k < N; k++) {
          const a = (k * 2 * Math.PI) / N, ca = Math.cos(a), sa = Math.sin(a);
          positions.push({ x: cx + mdx * ca - dy * sa, y: cy + mdx * sa + dy * ca, rot: a, mirror: true });
        }
      }
    }
    for (const pos of positions) {
      let ox = pos.x, oy = pos.y;
      if (p.scatter) {
        ox += (Math.random() * 2 - 1) * p.scatter * size;
        oy += (Math.random() * 2 - 1) * p.scatter * size;
      }
      strokeCtx.save();
      strokeCtx.globalAlpha = flow;
      strokeCtx.globalCompositeOperation = 'source-over';
      strokeCtx.translate(ox, oy);
      const r = rot + (pos.rot || 0);
      if (pos.mirror) strokeCtx.scale(-1, 1); // true reflection for mandala
      if (r) strokeCtx.rotate(r);
      strokeCtx.drawImage(tip, -w / 2, -h / 2, w, h);
      strokeCtx.restore();
    }
  }

  // Rebuild the layer = base + (stroke buffer at stroke opacity).
  function recompose() {
    if (!targetCtx) return;
    const w = targetCtx.canvas.width, h = targetCtx.canvas.height;
    targetCtx.save();
    targetCtx.globalCompositeOperation = 'source-over';
    targetCtx.globalAlpha = 1;
    targetCtx.clearRect(0, 0, w, h);
    targetCtx.drawImage(baseSnap, 0, 0);
    targetCtx.globalAlpha = strokeOpacity;
    // Eraser: the accumulated buffer carves alpha out of the base instead of
    // painting onto it (opacity still caps how much a single stroke removes).
    targetCtx.globalCompositeOperation = eraseMode ? 'destination-out' : strokeBlend;
    // Grain/texture: multiply the stroke's alpha by the canvas-fixed grain mask
    // before compositing — textured brushes.
    let strokeSrc = strokeBuf;
    if (grainMask && grainedCtx) {
      grainedCtx.globalCompositeOperation = 'source-over';
      grainedCtx.globalAlpha = 1;
      grainedCtx.clearRect(0, 0, w, h);
      grainedCtx.drawImage(strokeBuf, 0, 0);
      grainedCtx.globalCompositeOperation = 'destination-in';
      grainedCtx.drawImage(grainMask, 0, 0);
      grainedCtx.globalCompositeOperation = 'source-over';
      strokeSrc = grainedBuf;
    }
    targetCtx.drawImage(strokeSrc, 0, 0);
    // Lock transparency: re-apply the pre-stroke alpha so paint only lands on
    // pixels that were already opaque (recolour/shade without spilling out).
    if (lockAlpha) {
      targetCtx.globalAlpha = 1;
      targetCtx.globalCompositeOperation = 'destination-in';
      targetCtx.drawImage(baseSnap, 0, 0);
    }
    targetCtx.restore();
  }

  return {
    preset: p,
    /** Begin a stroke: snapshot the layer + reset the flow buffer. Pass the
     *  layer ctx and runtime values (size/opacity/flow/color/hardness). */
    begin(ctx, rt) { doBegin(ctx, rt); },
    /** Stamp `from` → `to` at spacing onto the flow buffer, then recompose. */
    segment(ctx, from, to, rt) {
      if (!painting || targetCtx !== ctx) doBegin(ctx, rt); // safety net
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dist = Math.hypot(dx, dy);
      const size = Math.max(0.5, sizeFn(to, rt.size));
      const spacingPx = Math.max(0.5, p.spacing * size);
      if (dist === 0) {
        if (residual <= 0) { stampToBuffer(to.x, to.y, { ...to, random: Math.random() }, rt, lastAngle); residual = spacingPx; }
      } else {
        lastAngle = Math.atan2(dy, dx);
        let d = residual;
        while (d <= dist) {
          const t = d / dist;
          stampToBuffer(from.x + dx * t, from.y + dy * t, lerpInfo(from, to, t), rt, lastAngle);
          d += spacingPx;
        }
        residual = d - dist;
      }
      recompose();
    },
    /** Finish — the layer already holds base + stroke@opacity, so just reset. */
    end() { residual = 0; painting = false; },
  };
}
