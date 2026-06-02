/**
 * Spot Healing brush — paint over a blemish and it's replaced with texture
 * sampled from a nearby clean area, tone-shifted to match the surrounding
 * pixels so the patch blends seamlessly (a simple healing, not a hard clone).
 *
 * Per dab: pick a source offset (a clean in-bounds neighbour), copy that patch
 * over the dab, and add (surrounding-ring mean − source mean) so the copied
 * texture takes on the target area's tone; feather the dab edge so it merges.
 *
 * `healDab` is a pure kernel over an RGBA buffer (no DOM) so the math is unit-
 * testable; the tool reads the layer once per stroke and writes back dirty rects.
 */
import { state } from '../state.js';
import { canvasCoords } from '../canvas-coords.js';

const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

// Mean RGB of opaque pixels in [x0,x1)×[y0,y1) of an RGBA buffer.
function meanRGB(data, w, h, x0, y0, x1, y1) {
  let r = 0, g = 0, b = 0, n = 0;
  // Floor/ceil to integers — fractional loop indices would read garbage (NaN).
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(w, Math.ceil(x1)); y1 = Math.min(h, Math.ceil(y1));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] < 16) continue;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
  }
  return n ? [r / n, g / n, b / n, n] : [0, 0, 0, 0];
}

/**
 * Heal one dab IN PLACE on `data` (RGBA, w×h). Samples a source patch offset by
 * (srcDx,srcDy), tone-matches it to the ring around the dab, and feathers it in.
 */
export function healDab(data, w, h, px, py, radius, srcDx, srcDy) {
  const r = radius <= 0 ? 1 : radius;
  // Surrounding ring (just outside the dab) and the source patch means.
  const ring = meanRGB(data, w, h, px - r * 1.4, py - r * 1.4, px + r * 1.4, py + r * 1.4);
  const src = meanRGB(data, w, h, px + srcDx - r, py + srcDy - r, px + srcDx + r, py + srcDy + r);
  if (!ring[3] || !src[3]) return;
  const tr = ring[0] - src[0], tg = ring[1] - src[1], tb = ring[2] - src[2]; // tone shift
  const x0 = Math.max(0, Math.floor(px - r)), y0 = Math.max(0, Math.floor(py - r));
  const x1 = Math.min(w, Math.ceil(px + r)), y1 = Math.min(h, Math.ceil(py + r));
  // Snapshot the source rows we read so we don't read already-healed pixels.
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = x - px, dy = y - py;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= r) continue;
      let f = 1 - dist / r; f = f * f; // soft edge
      let sx = x + srcDx, sy = y + srcDy;
      if (sx < 0) sx = 0; else if (sx >= w) sx = w - 1;
      if (sy < 0) sy = 0; else if (sy >= h) sy = h - 1;
      const si = (sy * w + sx) * 4, di = (y * w + x) * 4;
      const hr = clamp8(data[si] + tr), hg = clamp8(data[si + 1] + tg), hb = clamp8(data[si + 2] + tb);
      // Straight-alpha "over": deposit the healed colour at coverage f over the
      // existing pixel. Critically, where the target is transparent (alpha≈0)
      // the result is the healed colour itself — NOT colour×f (which read as a
      // darkened/near-black pixel over a light background).
      const ea = data[di + 3] / 255;
      const oa = f + ea * (1 - f);
      if (oa > 0) {
        data[di]     = (hr * f + data[di]     * ea * (1 - f)) / oa;
        data[di + 1] = (hg * f + data[di + 1] * ea * (1 - f)) / oa;
        data[di + 2] = (hb * f + data[di + 2] * ea * (1 - f)) / oa;
      }
      data[di + 3] = oa * 255;
    }
  }
}

export function createHealTool({ activeLayer, saveState, composite }) {
  let ctx = null, layerRef = null, buf = null, W = 0, H = 0, radius = 0;

  // Pick a clean source offset (the first in-bounds direction at ~1.6×radius).
  function pickOffset(px, py) {
    const d = Math.round(radius * 1.6) || 8;
    const cands = [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d]];
    for (const [ox, oy] of cands) {
      if (px + ox >= radius && px + ox < W - radius && py + oy >= radius && py + oy < H - radius) return [ox, oy];
    }
    return [d, 0];
  }
  // Heal one dab and write back only its rect. Returns the layer-local dab rect
  // {x0,y0,x1,y1} so callers can union it for a dirty-rect composite.
  function dabAt(lx, ly) {
    const [ox, oy] = pickOffset(lx, ly);
    healDab(buf.data, W, H, lx, ly, radius, ox, oy);
    const x0 = Math.max(0, Math.floor(lx - radius)), y0 = Math.max(0, Math.floor(ly - radius));
    const x1 = Math.min(W, Math.ceil(lx + radius)), y1 = Math.min(H, Math.ceil(ly + radius));
    ctx.putImageData(buf, 0, 0, x0, y0, x1 - x0, y1 - y0); // write only the dab rect
    return { x0, y0, x1, y1 };
  }
  // Composite only the union of the dab rects just written, in document space.
  // The compositor clamps to canvas bounds and falls back to a full redraw when
  // unsafe (fx/mask/selection/overlays).
  function compositeRect(u, off) {
    if (!u) { composite(); return; }
    composite({ x: u.x0 + off.x, y: u.y0 + off.y, w: u.x1 - u.x0, h: u.y1 - u.y0 });
  }

  return {
    begin(e) {
      const layer = activeLayer();
      if (!layer || layer.locked) return;
      const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
      const c = canvasCoords(e, state.mainCanvas);
      ctx = layer.ctx; layerRef = layer;
      W = layer.canvas.width; H = layer.canvas.height;
      radius = Math.max(2, state.brushSize / 2);
      buf = ctx.getImageData(0, 0, W, H);
      saveState('Heal');
      state.healActive = true;
      state.healLast = { x: c.x - off.x, y: c.y - off.y };
      const u = dabAt(state.healLast.x, state.healLast.y);
      compositeRect(u, off);
    },
    move(e) {
      if (!state.healActive || !layerRef || !buf) return;
      const off = state.layerOffsets.get(layerRef.id) || { x: 0, y: 0 };
      const c = canvasCoords(e, state.mainCanvas);
      const cur = { x: c.x - off.x, y: c.y - off.y };
      const last = state.healLast || cur;
      const seg = Math.hypot(cur.x - last.x, cur.y - last.y);
      const steps = Math.max(1, Math.ceil(seg / Math.max(1, radius * 0.5)));
      let u = null;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const d = dabAt(last.x + (cur.x - last.x) * t, last.y + (cur.y - last.y) * t);
        if (!u) u = d;
        else {
          if (d.x0 < u.x0) u.x0 = d.x0; if (d.y0 < u.y0) u.y0 = d.y0;
          if (d.x1 > u.x1) u.x1 = d.x1; if (d.y1 > u.y1) u.y1 = d.y1;
        }
      }
      state.healLast = cur;
      compositeRect(u, off);
    },
    end() {
      state.healActive = false; state.healLast = null; buf = null; layerRef = null;
    },
  };
}
