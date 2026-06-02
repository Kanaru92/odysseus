/**
 * Mixer Brush — wet-paint blending, like a loaded brush dragged through paint.
 * The brush carries a single "reservoir" colour (loaded from the foreground at
 * stroke start). As it moves it samples the canvas colour under the tip and:
 *   - DEPOSITS a colour that is a blend of the reservoir and the canvas (Mix:
 *     100% = all canvas → pure smear; 0% = all reservoir → pure paint),
 *   - lets the reservoir ABSORB the canvas colour (Wet: how fast the loaded
 *     colour picks up what it's dragged over), so hues blend along the stroke,
 *   - lays it down with Flow (per-dab strength).
 * Canvas sampling is alpha-weighted, so over transparent areas the brush paints
 * its reservoir cleanly instead of muddying toward black.
 *
 * `mixerDab` is a pure per-dab kernel (mutates the pixel region + the reservoir
 * array in place) so the blend math is unit-testable; the tool handles sampling,
 * segment stepping, and compositing. Operates on the active layer's pixels.
 */
import { state } from '../state.js';
import { canvasCoords } from '../canvas-coords.js';

/**
 * One mixer dab IN PLACE on `region` (RGBA, rw×rh, top-left at ox,oy).
 * `reservoir` is a mutable [r,g,b] (0..255). wet/mix/flow ∈ [0,1].
 */
export function mixerDab(region, rw, rh, ox, oy, px, py, radius, reservoir, wet, mix, flow) {
  const r = radius <= 0 ? 1 : radius;
  const x0 = Math.max(0, Math.floor(px - r) - ox);
  const y0 = Math.max(0, Math.floor(py - r) - oy);
  const x1 = Math.min(rw, Math.ceil(px + r) - ox);
  const y1 = Math.min(rh, Math.ceil(py + r) - oy);
  // 1) Alpha-weighted average canvas colour under the dab.
  let ar = 0, ag = 0, ab = 0, aw = 0, fsum = 0;
  for (let ry = y0; ry < y1; ry++) {
    for (let rx = x0; rx < x1; rx++) {
      const dx = (ox + rx) - px, dy = (oy + ry) - py;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= r) continue;
      const f = 1 - d / r;
      const i = (ry * rw + rx) * 4;
      const al = region[i + 3] / 255;
      ar += region[i] * f * al; ag += region[i + 1] * f * al; ab += region[i + 2] * f * al;
      aw += f * al; fsum += f;
    }
  }
  const hasCanvas = aw > fsum * 0.04 && fsum > 0;
  const cr = hasCanvas ? ar / aw : reservoir[0];
  const cg = hasCanvas ? ag / aw : reservoir[1];
  const cb = hasCanvas ? ab / aw : reservoir[2];
  // 2) Deposit colour = blend of reservoir and canvas by Mix.
  const dr = reservoir[0] + (cr - reservoir[0]) * mix;
  const dg = reservoir[1] + (cg - reservoir[1]) * mix;
  const db = reservoir[2] + (cb - reservoir[2]) * mix;
  // 3) Lay it down (Flow × squared falloff), building opacity on transparent areas.
  for (let ry = y0; ry < y1; ry++) {
    for (let rx = x0; rx < x1; rx++) {
      const dx = (ox + rx) - px, dy = (oy + ry) - py;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= r) continue;
      const f = 1 - d / r;
      const a = flow * f * f;
      const i = (ry * rw + rx) * 4;
      // Straight-alpha "over": lay the deposit colour at coverage `a` over the
      // existing pixel. On transparent areas (alpha≈0) the result is the deposit
      // colour itself — NOT colour×a, which read as dark/near-black over a light
      // background (the "adds black underneath" bug).
      const ea = region[i + 3] / 255;
      const oa = a + ea * (1 - a);
      if (oa > 0) {
        region[i]     = (dr * a + region[i]     * ea * (1 - a)) / oa;
        region[i + 1] = (dg * a + region[i + 1] * ea * (1 - a)) / oa;
        region[i + 2] = (db * a + region[i + 2] * ea * (1 - a)) / oa;
      }
      region[i + 3] = oa * 255;
    }
  }
  // 4) Reservoir absorbs the canvas colour (Wet) so hues blend along the stroke.
  if (hasCanvas) {
    reservoir[0] += (cr - reservoir[0]) * wet;
    reservoir[1] += (cg - reservoir[1]) * wet;
    reservoir[2] += (cb - reservoir[2]) * wet;
  }
}

export function createMixerTool({ activeLayer, saveState, composite }) {
  let ctx = null, radius = 0, layerRef = null, reservoir = null;

  const pct = (id, dflt) => {
    const el = document.getElementById(id);
    const v = parseInt(el && el.value, 10);
    return Math.max(0, Math.min(1, (Number.isFinite(v) ? v : dflt) / 100));
  };
  function loadReservoir() {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(state.color || '#000000');
    const h = m ? m[1] : '000000';
    reservoir = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  return {
    begin(e) {
      const layer = activeLayer();
      if (!layer || layer.locked) return;
      const c = canvasCoords(e, state.mainCanvas);
      const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
      radius = Math.max(2, state.brushSize / 2);
      ctx = layer.ctx;
      layerRef = layer;
      loadReservoir(); // load the foreground colour each stroke
      saveState('Mixer brush');
      state.mixerActive = true;
      state.mixerLast = { x: c.x - off.x, y: c.y - off.y };
    },
    move(e) {
      if (!state.mixerActive || !layerRef || !reservoir) return;
      const off = state.layerOffsets.get(layerRef.id) || { x: 0, y: 0 };
      const c = canvasCoords(e, state.mainCanvas);
      const cur = { x: c.x - off.x, y: c.y - off.y };
      const last = state.mixerLast || cur;
      const W = layerRef.canvas.width, H = layerRef.canvas.height;
      const minX = Math.max(0, Math.floor(Math.min(last.x, cur.x) - radius));
      const minY = Math.max(0, Math.floor(Math.min(last.y, cur.y) - radius));
      const maxX = Math.min(W, Math.ceil(Math.max(last.x, cur.x) + radius));
      const maxY = Math.min(H, Math.ceil(Math.max(last.y, cur.y) + radius));
      const rw = maxX - minX, rh = maxY - minY;
      if (rw <= 0 || rh <= 0) { state.mixerLast = cur; return; }
      const region = ctx.getImageData(minX, minY, rw, rh);
      const wet = pct('ge-mixer-wet', 50), mix = pct('ge-mixer-mix', 50), flow = pct('ge-mixer-flow', 80);
      const segLen = Math.hypot(cur.x - last.x, cur.y - last.y);
      const stepLen = Math.max(0.75, radius * 0.15);
      const steps = Math.max(1, Math.ceil(segLen / stepLen));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        mixerDab(region.data, rw, rh, minX, minY,
          last.x + (cur.x - last.x) * t, last.y + (cur.y - last.y) * t, radius, reservoir, wet, mix, flow);
      }
      ctx.putImageData(region, minX, minY);
      state.mixerLast = cur;
      // Dirty-rect composite: only the region we just wrote changed. Convert the
      // layer-local rect to document space (layer is drawn at its offset); the
      // compositor clamps to canvas bounds and falls back to a full redraw when
      // unsafe (fx/mask/selection/overlays).
      composite({ x: minX + off.x, y: minY + off.y, w: rw, h: rh });
    },
    end() {
      state.mixerActive = false;
      state.mixerLast = null;
      reservoir = null;
      layerRef = null;
    },
  };
}
