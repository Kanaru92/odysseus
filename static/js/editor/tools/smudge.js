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
 */
import { state } from '../state.js';
import { canvasCoords } from '../canvas-coords.js';

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
  let ctx = null, carried = null, cr = 0, bw = 0, radius = 0, layerRef = null;

  function strengthVal() {
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
  // Brush softness (0 hard … 300 soft) → falloff exponent (hard = tight core).
  function falloffPow() {
    const soft = Math.min(1, Math.max(0, (state.brushSoftness || 0) / 300));
    return 0.6 + (1 - soft) * 1.6; // soft≈0.6 (wide) … hard≈2.2 (tight)
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
      carried = new Float32Array(bw * bw * 4);
      // Finger Painting: load the carried buffer with the foreground colour so
      // the stroke drags fresh paint in. Otherwise seed from the pixels under
      // the brush (clamped to the canvas edge).
      const finger = !!state.smudgeFingerPaint;
      if (finger) {
        const m = /^#?([0-9a-fA-F]{6})$/.exec(state.color || '#000000');
        const h = m ? m[1] : '000000';
        const fr = parseInt(h.slice(0, 2), 16), fg = parseInt(h.slice(2, 4), 16), fb = parseInt(h.slice(4, 6), 16);
        for (let i = 0; i < bw * bw; i++) { const di = i * 4; carried[di] = fr; carried[di + 1] = fg; carried[di + 2] = fb; carried[di + 3] = 255; }
      } else {
        const full = ctx.getImageData(0, 0, W, H).data;
        for (let ly = 0; ly < bw; ly++) {
          for (let lx = 0; lx < bw; lx++) {
            let px = Math.round(sx0 - cr + lx), py = Math.round(sy0 - cr + ly);
            if (px < 0) px = 0; else if (px > W - 1) px = W - 1;
            if (py < 0) py = 0; else if (py > H - 1) py = H - 1;
            const si = (py * W + px) * 4, di = (ly * bw + lx) * 4;
            carried[di] = full[si]; carried[di + 1] = full[si + 1];
            carried[di + 2] = full[si + 2]; carried[di + 3] = full[si + 3];
          }
        }
      }
      saveState('Smudge');
      state.smudgeActive = true;
      state.smudgeLast = { x: sx0, y: sy0 };
    },
    move(e) {
      if (!state.smudgeActive || !layerRef || !carried) return;
      const off = state.layerOffsets.get(layerRef.id) || { x: 0, y: 0 };
      const c = canvasCoords(e, state.mainCanvas);
      const cur = { x: c.x - off.x, y: c.y - off.y };
      const last = state.smudgeLast || cur;
      const W = layerRef.canvas.width, H = layerRef.canvas.height;
      const minX = Math.max(0, Math.floor(Math.min(last.x, cur.x) - radius));
      const minY = Math.max(0, Math.floor(Math.min(last.y, cur.y) - radius));
      const maxX = Math.min(W, Math.ceil(Math.max(last.x, cur.x) + radius));
      const maxY = Math.min(H, Math.ceil(Math.max(last.y, cur.y) + radius));
      const rw = maxX - minX, rh = maxY - minY;
      if (rw <= 0 || rh <= 0) { state.smudgeLast = cur; return; }
      const region = ctx.getImageData(minX, minY, rw, rh);
      const s = effStrength(strengthVal());
      const pow = falloffPow();
      const segLen = Math.hypot(cur.x - last.x, cur.y - last.y);
      const stepLen = Math.max(0.75, radius * 0.15); // dense steps → smooth trail
      const steps = Math.max(1, Math.ceil(segLen / stepLen));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        smudgeDab(region.data, rw, rh, minX, minY, carried, bw, cr,
          last.x + (cur.x - last.x) * t, last.y + (cur.y - last.y) * t, radius, s, pow);
      }
      ctx.putImageData(region, minX, minY);
      state.smudgeLast = cur;
      composite();
    },
    end() {
      state.smudgeActive = false;
      state.smudgeLast = null;
      carried = null;
      layerRef = null;
    },
  };
}
