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
 *
 * SYMMETRY (deliberately better than the reference editors, which disable it for
 * heal-type tools): when brush symmetry is active each dab is replayed at every
 * mirrored / rotated copy. Heal carries a SOURCE-SAMPLE OFFSET vector (write
 * point → clean source); to mirror correctly we transform the WRITE point AND
 * map that offset vector by the SAME transform. Mirror/rotation about the canvas
 * centre are affine, so the mapped offset = T(point+offset) − T(point) — which
 * works uniformly for x/y/xy/radial/mandala. Source coords are clamped to the
 * canvas in `healDab`, so a mirrored source that lands near an edge is handled
 * gracefully rather than wrongly. Mirror math matches `brush/engine.js`.
 */
import { state } from '../state.js';
import { canvasCoords } from '../canvas-coords.js';

/**
 * Active symmetry point-transforms for a layer of size cw×ch, from the live
 * brush-symmetry state (`state.brushSymmetry`, `state.brushSymmetryN`). Returns
 * fns mapping a layer-local point (x,y) → {x,y}; index 0 = identity. Mirrors
 * `brush/engine.js` stampToBuffer.
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
  // Snapshot the source region we read so we don't read already-healed pixels.
  // The write region overlaps the source patch (offset ~1.6r < 2r), so reading
  // live `data` would feed just-written pixels back in, smearing the patch.
  // Cover the full clamped extent the read loop can touch (sx/sy are edge-clamped
  // into [0,w-1]×[0,h-1], so the snapshot uses the same clamp).
  const sxMin = Math.max(0, Math.min(w - 1, x0 + srcDx));
  const sxMax = Math.max(0, Math.min(w - 1, (x1 - 1) + srcDx));
  const syMin = Math.max(0, Math.min(h - 1, y0 + srcDy));
  const syMax = Math.max(0, Math.min(h - 1, (y1 - 1) + srcDy));
  const sw = sxMax - sxMin + 1, sh = syMax - syMin + 1;
  const snap = new Uint8ClampedArray(sw * sh * 4);
  for (let y = 0; y < sh; y++) {
    const rowSrc = ((syMin + y) * w + sxMin) * 4;
    snap.set(data.subarray(rowSrc, rowSrc + sw * 4), y * sw * 4);
  }
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = x - px, dy = y - py;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= r) continue;
      let f = 1 - dist / r; f = f * f; // soft edge
      let sx = x + srcDx, sy = y + srcDy;
      if (sx < 0) sx = 0; else if (sx >= w) sx = w - 1;
      if (sy < 0) sy = 0; else if (sy >= h) sy = h - 1;
      const si = ((sy - syMin) * sw + (sx - sxMin)) * 4, di = (y * w + x) * 4;
      const hr = clamp8(snap[si] + tr), hg = clamp8(snap[si + 1] + tg), hb = clamp8(snap[si + 2] + tb);
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
  let ctx = null, layerRef = null, buf = null, W = 0, H = 0, radius = 0, syms = null;

  // Pick a clean source offset (the first in-bounds direction at ~1.6×radius).
  function pickOffset(px, py) {
    const d = Math.round(radius * 1.6) || 8;
    const cands = [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d]];
    for (const [ox, oy] of cands) {
      if (px + ox >= radius && px + ox < W - radius && py + oy >= radius && py + oy < H - radius) return [ox, oy];
    }
    return [d, 0];
  }
  // Heal one dab — replayed at every active symmetry copy — and write back each
  // copy's rect. The base copy picks a clean source offset; each mirror maps the
  // WRITE point AND that offset vector by the same transform (offset' =
  // T(p+offset) − T(p), exact for the affine mirror/rotation). Returns the
  // unioned layer-local rect {x0,y0,x1,y1} for a dirty-rect composite.
  function dabAt(lx, ly) {
    const [ox, oy] = pickOffset(lx, ly);
    let u = null;
    for (const fn of syms) {
      const p = fn(lx, ly);                 // mirrored write point
      const so = fn(lx + ox, ly + oy);      // where the source point maps to
      const mox = so.x - p.x, moy = so.y - p.y; // mirrored source offset (vector)
      healDab(buf.data, W, H, p.x, p.y, radius, mox, moy);
      const x0 = Math.max(0, Math.floor(p.x - radius)), y0 = Math.max(0, Math.floor(p.y - radius));
      const x1 = Math.min(W, Math.ceil(p.x + radius)), y1 = Math.min(H, Math.ceil(p.y + radius));
      if (x1 - x0 > 0 && y1 - y0 > 0) ctx.putImageData(buf, 0, 0, x0, y0, x1 - x0, y1 - y0); // write only this copy's rect
      const d = { x0, y0, x1, y1 };
      if (!u) u = d;
      else {
        if (d.x0 < u.x0) u.x0 = d.x0; if (d.y0 < u.y0) u.y0 = d.y0;
        if (d.x1 > u.x1) u.x1 = d.x1; if (d.y1 > u.y1) u.y1 = d.y1;
      }
    }
    return u;
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
      // Lock in the active symmetry copies for the whole stroke (index 0 = the
      // real dab). Same canvas-centre axes the brush engine uses.
      syms = symmetryPointTransforms(W, H);
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
      state.healActive = false; state.healLast = null; buf = null; layerRef = null; syms = null;
    },
  };
}
