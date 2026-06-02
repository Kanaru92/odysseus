/**
 * Smudge tool — drag to smear paint, like dragging a finger through wet media.
 * A brush-local "carried" buffer holds the picked-up colour; along the stroke
 * it gradually mixes with the underlying pixels and is deposited back with a
 * soft, hardness-shaped falloff. Operates on the active layer's pixels.
 *
 * Quality model (tuned to feel like a high-end tablet smudge):
 *  - DISTANCE-WEIGHTED dual-rate mix: the deposit and the carried-buffer update
 *    are both weighted by the radial falloff, so the centre drags strongly and
 *    the edges trail off — no hard "stamp" ring.
 *  - PRESSURE → strength: a harder press smears further (pen pressure; mouse
 *    falls back to full).
 *  - HARDNESS-aware falloff: the brush softness shapes the falloff exponent
 *    (hard = tight core, soft = wide gradient).
 *  - FINGER PAINTING: optionally start each stroke loaded with the foreground
 *    colour (drags fg paint into the image).
 *
 * `smudgeDab` is a pure per-dab kernel (no DOM) so the smear math is unit-
 * testable; the tool object handles sampling, segment stepping, and compositing.
 *
 * SYMMETRY (deliberately better than the reference editors, which disable
 * symmetry for smear-type tools): when brush symmetry is active the same smear
 * is replayed at every mirrored / rotated copy. A smudge has a DIRECTION, so we
 * map BOTH endpoints of each segment through the symmetry point-transform — the
 * transformed direction (transformedCur − transformedLast) then comes out
 * correct for free (x-mirror flips dx, y-mirror flips dy, rotation rotates the
 * vector). The mirror math mirrors `brush/engine.js` `stampToBuffer` and uses
 * the same canvas-centre axes; coords here are layer-local (matching the engine,
 * which subtracts the layer offset before mirroring about the buffer centre).
 */
import { state } from '../state.js';
import { canvasCoords } from '../canvas-coords.js';

/**
 * Build the active symmetry point-transforms for a layer of size cw×ch, reading
 * the live brush-symmetry state (`state.brushSymmetry` ∈ 'none'|'x'|'y'|'xy'|
 * 'radial'|'mandala', `state.brushSymmetryN` = radial/mandala segment count).
 * Returns an array of fns mapping a layer-local point (x,y) → {x,y}; index 0 is
 * always identity. Mirroring both endpoints of a segment through the SAME fn
 * also maps the smear DIRECTION correctly (see file header). Mirrors the math in
 * `brush/engine.js` stampToBuffer.
 */
export function symmetryPointTransforms(cw, ch) {
  const sym = state.brushSymmetry || 'none';
  const fns = [(x, y) => ({ x, y })]; // identity (the original stroke)
  if (sym === 'x' || sym === 'xy') fns.push((x, y) => ({ x: cw - x, y }));
  if (sym === 'y' || sym === 'xy') fns.push((x, y) => ({ x, y: ch - y }));
  if (sym === 'xy') fns.push((x, y) => ({ x: cw - x, y: ch - y }));
  if (sym === 'radial' || sym === 'mandala') {
    const cx = cw / 2, cy = ch / 2;
    const N = Math.max(2, Math.round(state.brushSymmetryN || 6));
    for (let k = 1; k < N; k++) { // k=0 is the identity already present
      const a = (k * 2 * Math.PI) / N, ca = Math.cos(a), sa = Math.sin(a);
      fns.push((x, y) => { const dx = x - cx, dy = y - cy; return { x: cx + dx * ca - dy * sa, y: cy + dx * sa + dy * ca }; });
    }
    if (sym === 'mandala') {
      for (let k = 0; k < N; k++) { // reflected (kaleidoscope) set
        const a = (k * 2 * Math.PI) / N, ca = Math.cos(a), sa = Math.sin(a);
        fns.push((x, y) => { const dx = -(x - cx), dy = y - cy; return { x: cx + dx * ca - dy * sa, y: cy + dx * sa + dy * ca }; });
      }
    }
  }
  return fns;
}

/**
 * Apply one smudge dab IN PLACE on `region` (RGBA, regionW×regionH, whose
 * top-left is canvas pixel originX/originY). `carried` is the brush-local paint
 * buffer (bw×bw, centred on the dab; cr = (bw−1)/2). `strength` ∈ [0,1] sets how
 * long colour is dragged; `falloffPow` shapes the radial profile (higher = tighter).
 */
export function smudgeDab(region, regionW, regionH, originX, originY, carried, bw, cr, px, py, radius, strength, falloffPow) {
  const s = strength < 0 ? 0 : strength > 0.98 ? 0.98 : strength;
  const r = radius <= 0 ? 1 : radius;
  const pow = falloffPow > 0 ? falloffPow : 1.5;
  const x0 = Math.max(0, Math.floor(px - r) - originX);
  const y0 = Math.max(0, Math.floor(py - r) - originY);
  const x1 = Math.min(regionW, Math.ceil(px + r) - originX);
  const y1 = Math.min(regionH, Math.ceil(py + r) - originY);
  for (let ry = y0; ry < y1; ry++) {
    const cy = originY + ry;
    for (let rx = x0; rx < x1; rx++) {
      const cx = originX + rx;
      const dx = cx - px, dy = cy - py;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= r) continue;
      const base = 1 - dist / r;
      const f = Math.pow(base, pow);          // radial falloff (hardness-shaped)
      const lx = Math.round(cx - px + cr), ly = Math.round(cy - py + cr);
      if (lx < 0 || ly < 0 || lx >= bw || ly >= bw) continue;
      const ci = (ly * bw + lx) * 4;
      const ri = (ry * regionW + rx) * 4;
      const deposit = f * s;                  // carried → canvas (distance-weighted)
      const pickup = (1 - s) * f;             // canvas → carried (distance-weighted)
      for (let c = 0; c < 4; c++) {
        const canv = region[ri + c];
        const car = carried[ci + c];
        region[ri + c] = canv + (car - canv) * deposit; // smear carried in
        carried[ci + c] = car + (canv - car) * pickup;  // pick the area up gradually
      }
    }
  }
}

export function createSmudgeTool({ activeLayer, saveState, composite }) {
  // One carried buffer PER active symmetry copy (index 0 = the real stroke),
  // each seeded from the pixels under its own mirrored start so every copy
  // smears consistently and independently. `syms` holds the matching transforms.
  let ctx = null, carriedSet = null, syms = null, cr = 0, bw = 0, radius = 0, layerRef = null;

  // Resolve the base strength. A preset (or any caller) can pin it via
  // `state.smudgeStrength` (0..1); otherwise we read the live slider. Default
  // behaviour is unchanged when `smudgeStrength` is unset.
  function strengthVal() {
    const ov = state.smudgeStrength;
    if (typeof ov === 'number' && Number.isFinite(ov)) return Math.max(0, Math.min(1, ov));
    const el = document.getElementById('ge-smudge-strength');
    const v = parseInt(el && el.value, 10);
    return Math.max(0, Math.min(1, (Number.isFinite(v) ? v : 60) / 100));
  }
  // Pressure-scaled strength: hard press smears further; mouse (no/zero
  // pressure) falls back to full so it still feels strong.
  function effStrength(base) {
    const raw = state.pressure;
    const pr = (raw && raw > 0.01) ? raw : 1;
    return Math.max(0, Math.min(0.98, base * (0.55 + 0.45 * pr)));
  }
  // Falloff exponent (hard = tight core). A preset can pin tip hardness via
  // `state.smudgeHardness` (0 soft … 100 hard); otherwise it derives from the
  // shared brush softness (0 hard … 300 soft) so default behaviour is unchanged.
  function falloffPow() {
    const hov = state.smudgeHardness;
    if (typeof hov === 'number' && Number.isFinite(hov)) {
      const hard = Math.min(1, Math.max(0, hov / 100));
      return 0.6 + hard * 1.6; // soft≈0.6 (wide) … hard≈2.2 (tight)
    }
    const soft = Math.min(1, Math.max(0, (state.brushSoftness || 0) / 300));
    return 0.6 + (1 - soft) * 1.6; // soft≈0.6 (wide) … hard≈2.2 (tight)
  }
  // Dab spacing as a fraction of radius (default 0.15 = current dense trail).
  // Larger values space dabs apart for a textured / dappled / pebbled feel.
  function spacingFrac() {
    const v = state.smudgeSpacing;
    return (typeof v === 'number' && Number.isFinite(v) && v > 0) ? Math.min(2, v) : 0.15;
  }
  // Scatter (0..1): random radial offset of each dab as a fraction of radius.
  function scatterAmt() {
    const v = state.smudgeScatter;
    return (typeof v === 'number' && Number.isFinite(v)) ? Math.max(0, Math.min(1, v)) : 0;
  }
  // Jitter (0..1): per-dab random strength variation (down to (1-jitter)×s).
  function jitterAmt() {
    const v = state.smudgeJitter;
    return (typeof v === 'number' && Number.isFinite(v)) ? Math.max(0, Math.min(1, v)) : 0;
  }

  return {
    begin(e) {
      const layer = activeLayer();
      if (!layer || layer.locked) return;
      const c = canvasCoords(e, state.mainCanvas);
      const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
      const W = layer.canvas.width, H = layer.canvas.height;
      radius = Math.max(2, state.brushSize / 2);
      cr = Math.ceil(radius);
      bw = cr * 2 + 1;
      ctx = layer.ctx;
      layerRef = layer;
      const sx0 = c.x - off.x, sy0 = c.y - off.y;
      // Active symmetry copies (index 0 = identity / the real stroke). Locked in
      // at stroke start so the copy count can't change mid-drag.
      syms = symmetryPointTransforms(W, H);
      const finger = !!state.smudgeFingerPaint;
      let fr = 0, fg = 0, fb = 0;
      if (finger) {
        const m = /^#?([0-9a-fA-F]{6})$/.exec(state.color || '#000000');
        const h = m ? m[1] : '000000';
        fr = parseInt(h.slice(0, 2), 16); fg = parseInt(h.slice(2, 4), 16); fb = parseInt(h.slice(4, 6), 16);
      }
      // Sample-all-layers: seed the carried buffer from the FLATTENED composite
      // (every visible layer) instead of just the active layer, so the smear
      // picks up colour it can see on screen. Default off → unchanged behaviour.
      // Smears are still DEPOSITED only onto the active layer.
      let sampleCtx = ctx;
      if (state.smudgeSampleAll) {
        try {
          const comp = state.mainCanvas;
          if (comp && comp.width === W && comp.height === H) {
            // mainCanvas matches the doc size → its (x,y) maps to layer-local
            // after subtracting the layer offset, same as the per-layer read.
            const flat = document.createElement('canvas');
            flat.width = W; flat.height = H;
            const fctx = flat.getContext('2d', { willReadFrequently: true });
            fctx.drawImage(comp, 0, 0);
            sampleCtx = fctx;
          }
        } catch (_) { sampleCtx = ctx; } // any failure → fall back to active layer
      }
      // Seed one carried buffer per symmetry copy from the pixels under THAT
      // copy's start point (or the foreground colour in Finger-Painting mode).
      const seedCarried = (sx, sy) => {
        const carried = new Float32Array(bw * bw * 4);
        if (finger) {
          for (let i = 0; i < bw * bw; i++) { const di = i * 4; carried[di] = fr; carried[di + 1] = fg; carried[di + 2] = fb; carried[di + 3] = 255; }
          return carried;
        }
        // Read ONLY the brush-sized neighbourhood, not the whole document. The
        // sampled coords (after edge-clamping to [0,W-1]×[0,H-1]) all fall in
        // this window, so the seed pixels are identical to a full-document read.
        const rx0 = Math.max(0, Math.floor(sx - cr));
        const ry0 = Math.max(0, Math.floor(sy - cr));
        const rx1 = Math.min(W, Math.ceil(sx + cr) + 1);
        const ry1 = Math.min(H, Math.ceil(sy + cr) + 1);
        const nw = Math.max(1, rx1 - rx0), nh = Math.max(1, ry1 - ry0);
        const nb = sampleCtx.getImageData(rx0, ry0, nw, nh).data;
        for (let ly = 0; ly < bw; ly++) {
          for (let lx = 0; lx < bw; lx++) {
            let px = Math.round(sx - cr + lx), py = Math.round(sy - cr + ly);
            if (px < 0) px = 0; else if (px > W - 1) px = W - 1;
            if (py < 0) py = 0; else if (py > H - 1) py = H - 1;
            // Index into the smaller neighbourhood buffer; clamp into its
            // bounds so any edge-clamped coord still maps to a valid pixel.
            let bx = px - rx0; if (bx < 0) bx = 0; else if (bx > nw - 1) bx = nw - 1;
            let by = py - ry0; if (by < 0) by = 0; else if (by > nh - 1) by = nh - 1;
            const si = (by * nw + bx) * 4, di = (ly * bw + lx) * 4;
            carried[di] = nb[si]; carried[di + 1] = nb[si + 1];
            carried[di + 2] = nb[si + 2]; carried[di + 3] = nb[si + 3];
          }
        }
        return carried;
      };
      carriedSet = syms.map((fn) => { const p = fn(sx0, sy0); return seedCarried(p.x, p.y); });
      saveState('Smudge');
      state.smudgeActive = true;
      state.smudgeLast = { x: sx0, y: sy0 };
    },
    move(e) {
      if (!state.smudgeActive || !layerRef || !carriedSet) return;
      const off = state.layerOffsets.get(layerRef.id) || { x: 0, y: 0 };
      const c = canvasCoords(e, state.mainCanvas);
      const cur = { x: c.x - off.x, y: c.y - off.y };
      const last = state.smudgeLast || cur;
      const W = layerRef.canvas.width, H = layerRef.canvas.height;
      // Per-copy transformed segments. Mirroring BOTH endpoints maps the smear
      // direction for free. Union all copies' footprints into one read/write
      // region so a single getImageData/putImageData + composite covers them all.
      const segs = syms.map((fn) => ({ a: fn(last.x, last.y), b: fn(cur.x, cur.y) }));
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const sg of segs) {
        minX = Math.min(minX, sg.a.x, sg.b.x); minY = Math.min(minY, sg.a.y, sg.b.y);
        maxX = Math.max(maxX, sg.a.x, sg.b.x); maxY = Math.max(maxY, sg.a.y, sg.b.y);
      }
      const scatter = scatterAmt();   // random per-dab positional jitter
      // Pad by the post-scatter footprint: a scattered dab centre can move up to
      // scatter*radius from the segment, so its falloff reaches radius*(1+scatter).
      const pad = radius * (1 + scatter);
      minX = Math.max(0, Math.floor(minX - pad));
      minY = Math.max(0, Math.floor(minY - pad));
      maxX = Math.min(W, Math.ceil(maxX + pad));
      maxY = Math.min(H, Math.ceil(maxY + pad));
      const rw = maxX - minX, rh = maxY - minY;
      if (rw <= 0 || rh <= 0) { state.smudgeLast = cur; return; }
      const region = ctx.getImageData(minX, minY, rw, rh);
      const s = effStrength(strengthVal());
      const pow = falloffPow();
      const jitter = jitterAmt();     // random per-dab strength variation
      const stepLen = Math.max(0.75, radius * spacingFrac()); // step ↔ spacing
      for (let m = 0; m < segs.length; m++) {
        const a = segs[m].a, b = segs[m].b, carried = carriedSet[m];
        const segLen = Math.hypot(b.x - a.x, b.y - a.y);
        const steps = Math.max(1, Math.ceil(segLen / stepLen));
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          let dx = a.x + (b.x - a.x) * t, dy = a.y + (b.y - a.y) * t;
          if (scatter > 0) { // offset the dab centre in a random direction
            const ang = Math.random() * Math.PI * 2, rad = Math.random() * scatter * radius;
            dx += Math.cos(ang) * rad; dy += Math.sin(ang) * rad;
          }
          // Jitter drops the per-dab strength toward (1-jitter)×s for a broken,
          // scratchy deposit; jitter=0 leaves the dab strength at s (unchanged).
          const ds = jitter > 0 ? s * (1 - jitter * Math.random()) : s;
          smudgeDab(region.data, rw, rh, minX, minY, carried, bw, cr,
            dx, dy, radius, ds, pow);
        }
      }
      ctx.putImageData(region, minX, minY);
      state.smudgeLast = cur;
      // Dirty-rect composite: the union of all symmetry copies' footprints (one
      // region, computed above). Convert the layer-local rect to document space
      // (layer is drawn at its offset); the compositor clamps to canvas bounds
      // and falls back to a full redraw when unsafe (fx/mask/selection/overlays).
      composite({ x: minX + off.x, y: minY + off.y, w: rw, h: rh });
    },
    end() {
      state.smudgeActive = false;
      state.smudgeLast = null;
      carriedSet = null;
      syms = null;
      layerRef = null;
    },
  };
}
