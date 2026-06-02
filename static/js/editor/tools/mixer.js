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
 *
 * SYMMETRY (deliberately better than the reference editors, which disable it for
 * blend-type tools): when brush symmetry is active the stroke is replayed at
 * every mirrored / rotated copy. A mixer stroke has a DIRECTION (the reservoir
 * absorbs colour ALONG the drag), so we map BOTH endpoints of each segment
 * through the same symmetry point-transform — the transformed direction comes
 * out correct for free. Each copy gets its OWN reservoir so the copies blend
 * consistently and independently. Mirror math matches `brush/engine.js`.
 */
import { state } from '../state.js';
import { canvasCoords } from '../canvas-coords.js';

/**
 * Build the active symmetry point-transforms for a layer of size cw×ch from the
 * live brush-symmetry state (`state.brushSymmetry`, `state.brushSymmetryN`).
 * Returns fns mapping a layer-local point (x,y) → {x,y}; index 0 = identity.
 * Mirroring both endpoints of a segment through one fn also maps the stroke
 * DIRECTION. Mirrors `brush/engine.js` stampToBuffer.
 */
function symmetryPointTransforms(cw, ch) {
  const sym = state.brushSymmetry || 'none';
  const fns = [(x, y) => ({ x, y })];
  if (sym === 'x' || sym === 'xy') fns.push((x, y) => ({ x: cw - x, y }));
  if (sym === 'y' || sym === 'xy') fns.push((x, y) => ({ x, y: ch - y }));
  if (sym === 'xy') fns.push((x, y) => ({ x: cw - x, y: ch - y }));
  if (sym === 'radial' || sym === 'mandala') {
    const cx = cw / 2, cy = ch / 2;
    const N = Math.max(2, Math.round(state.brushSymmetryN || 6));
    for (let k = 1; k < N; k++) {
      const a = (k * 2 * Math.PI) / N, ca = Math.cos(a), sa = Math.sin(a);
      fns.push((x, y) => { const dx = x - cx, dy = y - cy; return { x: cx + dx * ca - dy * sa, y: cy + dx * sa + dy * ca }; });
    }
    if (sym === 'mandala') {
      for (let k = 0; k < N; k++) {
        const a = (k * 2 * Math.PI) / N, ca = Math.cos(a), sa = Math.sin(a);
        fns.push((x, y) => { const dx = -(x - cx), dy = y - cy; return { x: cx + dx * ca - dy * sa, y: cy + dx * sa + dy * ca }; });
      }
    }
  }
  return fns;
}

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
  // One reservoir per active symmetry copy (index 0 = the real stroke), each
  // loaded with the foreground colour, so every copy mixes independently.
  let ctx = null, radius = 0, layerRef = null, reservoirs = null, syms = null;

  const pct = (id, dflt) => {
    const el = document.getElementById(id);
    const v = parseInt(el && el.value, 10);
    return Math.max(0, Math.min(1, (Number.isFinite(v) ? v : dflt) / 100));
  };
  function loadColor() {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(state.color || '#000000');
    const h = m ? m[1] : '000000';
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  return {
    begin(e) {
      const layer = activeLayer();
      if (!layer || layer.locked) return;
      const c = canvasCoords(e, state.mainCanvas);
      const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
      const W = layer.canvas.width, H = layer.canvas.height;
      radius = Math.max(2, state.brushSize / 2);
      ctx = layer.ctx;
      layerRef = layer;
      // Lock in the active symmetry copies + a fresh reservoir per copy.
      syms = symmetryPointTransforms(W, H);
      reservoirs = syms.map(() => loadColor());
      saveState('Mixer brush');
      state.mixerActive = true;
      state.mixerLast = { x: c.x - off.x, y: c.y - off.y };
    },
    move(e) {
      if (!state.mixerActive || !layerRef || !reservoirs) return;
      const off = state.layerOffsets.get(layerRef.id) || { x: 0, y: 0 };
      const c = canvasCoords(e, state.mainCanvas);
      const cur = { x: c.x - off.x, y: c.y - off.y };
      const last = state.mixerLast || cur;
      const W = layerRef.canvas.width, H = layerRef.canvas.height;
      // Per-copy transformed segments. Mirroring BOTH endpoints maps the stroke
      // direction for free. Union all copies' footprints into one read/write
      // region so a single getImageData/putImageData + composite covers them all.
      const segs = syms.map((fn) => ({ a: fn(last.x, last.y), b: fn(cur.x, cur.y) }));
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const sg of segs) {
        minX = Math.min(minX, sg.a.x, sg.b.x); minY = Math.min(minY, sg.a.y, sg.b.y);
        maxX = Math.max(maxX, sg.a.x, sg.b.x); maxY = Math.max(maxY, sg.a.y, sg.b.y);
      }
      minX = Math.max(0, Math.floor(minX - radius));
      minY = Math.max(0, Math.floor(minY - radius));
      maxX = Math.min(W, Math.ceil(maxX + radius));
      maxY = Math.min(H, Math.ceil(maxY + radius));
      const rw = maxX - minX, rh = maxY - minY;
      if (rw <= 0 || rh <= 0) { state.mixerLast = cur; return; }
      const region = ctx.getImageData(minX, minY, rw, rh);
      const wet = pct('ge-mixer-wet', 50), mix = pct('ge-mixer-mix', 50), flow = pct('ge-mixer-flow', 80);
      const stepLen = Math.max(0.75, radius * 0.15);
      for (let m = 0; m < segs.length; m++) {
        const a = segs[m].a, b = segs[m].b, reservoir = reservoirs[m];
        const segLen = Math.hypot(b.x - a.x, b.y - a.y);
        const steps = Math.max(1, Math.ceil(segLen / stepLen));
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          mixerDab(region.data, rw, rh, minX, minY,
            a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, radius, reservoir, wet, mix, flow);
        }
      }
      ctx.putImageData(region, minX, minY);
      state.mixerLast = cur;
      // Dirty-rect composite: the union of all symmetry copies' footprints (one
      // region, computed above). Convert the layer-local rect to document space
      // (layer is drawn at its offset); the compositor clamps to canvas bounds
      // and falls back to a full redraw when unsafe (fx/mask/selection/overlays).
      composite({ x: minX + off.x, y: minY + off.y, w: rw, h: rh });
    },
    end() {
      state.mixerActive = false;
      state.mixerLast = null;
      reservoirs = null;
      syms = null;
      layerRef = null;
    },
  };
}
