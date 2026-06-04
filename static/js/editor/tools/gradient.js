/**
 * Gradient tool — drag on the canvas to fill the active layer with a gradient
 * between the foreground and background colors (or FG → transparent), or a
 * custom multi-stop ramp (see editor/gradient-editor.js).
 *
 * Five gradient TYPES are supported:
 *   - linear    — colour ramps along the drag axis (start → end).
 *   - radial    — concentric rings from the start; the drag length is the radius.
 *   - angle     — conic / sweep: colour follows the angle around the start point.
 *   - reflected — linear mirrored about the start, symmetric both directions.
 *   - diamond   — square-distance (chebyshev) isolines from the start point.
 *
 * linear + radial use the canvas 2D gradient API (unchanged from the original).
 * angle / reflected / diamond are rasterised per-pixel from the same stop list,
 * so the multi-stop / FG→BG / FG→Transparent handling is identical across types.
 *
 * Drag defines the gradient axis (start → end). Released → fill the active
 * layer. When an active selection exists (wand/marquee/lasso) the fill is
 * clipped to it; otherwise the whole layer is filled (as before).
 */
import { state } from '../state.js';
import { canvasCoords } from '../canvas-coords.js';

function hexToRgba(hex, a) {
  const h = String(hex || '#000000').replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${a})`;
}

function readOpts() {
  // Type is owned by `state.gradientType` (set by the options-bar selector).
  // Fall back to the legacy side-panel toggle, then default to 'linear' so the
  // original linear/radial behaviour is preserved when nothing has set it.
  const typeBtn = document.querySelector('.ge-grad-type.active');
  const modeBtn = document.querySelector('.ge-grad-mode.active');
  const op = document.getElementById('ge-grad-opacity');
  const type = state.gradientType || (typeBtn && typeBtn.dataset.gradType) || 'linear';
  return {
    type,
    mode: (modeBtn && modeBtn.dataset.gradMode) || 'fg-bg',
    // NB: don't use `|| 100` — that swallows a legitimate 0 (slider min). Coerce
    // explicitly so opacity 0 paints transparent, not 100%.
    opacity: (() => { const v = op ? parseInt(op.value, 10) : 100; return Math.max(0, Math.min(1, (Number.isFinite(v) ? v : 100) / 100)); })(),
  };
}

// Resolve the normalised stop list (position 0..1 → {color, alpha}) shared by
// the native (linear/radial) and the rasterised (angle/reflected/diamond) paths.
// When the multi-stop editor is engaged (state.gradUseCustom) use its stops;
// otherwise use the FG→BG / FG→Transparent mode.
function resolveStops(mode, fg, bg) {
  if (state.gradUseCustom && Array.isArray(state.gradStops) && state.gradStops.length >= 2) {
    return [...state.gradStops]
      .map((st) => ({ pos: Math.max(0, Math.min(1, st.pos)), color: st.color, alpha: st.alpha == null ? 1 : st.alpha, mid: st.mid }))
      .sort((a, b) => a.pos - b.pos);
  }
  if (mode === 'fg-transparent') {
    return [{ pos: 0, color: fg, alpha: 1 }, { pos: 1, color: fg, alpha: 0 }];
  }
  return [{ pos: 0, color: fg, alpha: 1 }, { pos: 1, color: bg, alpha: 1 }];
}

// Apply the resolved stops onto a canvas-API gradient object (linear / radial).
function addStops(grad, mode, fg, bg) {
  for (const st of resolveStops(mode, fg, bg)) grad.addColorStop(st.pos, hexToRgba(st.color, st.alpha));
}

function parseHex(hex) {
  const h = String(hex || '#000000').replace('#', '');
  return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
}

// Sample the stop list at t∈[0,1] → [r,g,b,a(0..1)] via linear interpolation,
// matching the canvas gradient API's behaviour (clamp + flat ends).
function sampleStops(stops, t) {
  t = Math.max(0, Math.min(1, t));
  if (t <= stops[0].pos) { const s = stops[0]; const c = parseHex(s.color); return [c[0], c[1], c[2], s.alpha]; }
  const last = stops[stops.length - 1];
  if (t >= last.pos) { const c = parseHex(last.color); return [c[0], c[1], c[2], last.alpha]; }
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i].pos) {
      const a = stops[i - 1], b = stops[i];
      const span = b.pos - a.pos;
      let f = span <= 0 ? 0 : (t - a.pos) / span;
      // Per-stop midpoint (a.mid, 0..1, default 0.5): the position within this
      // segment where the blend reaches 50%. Power-skew f so f==mid → 0.5 (the
      // standard gradient midpoint). 0.5 leaves it linear (no change).
      const mid = (a.mid != null && a.mid > 0.001 && a.mid < 0.999) ? a.mid : 0.5;
      if (mid !== 0.5) f = Math.pow(f, Math.log(0.5) / Math.log(mid));
      const ca = parseHex(a.color), cb = parseHex(b.color);
      return [
        Math.round(ca[0] + (cb[0] - ca[0]) * f),
        Math.round(ca[1] + (cb[1] - ca[1]) * f),
        Math.round(ca[2] + (cb[2] - ca[2]) * f),
        a.alpha + (b.alpha - a.alpha) * f,
      ];
    }
  }
  const c = parseHex(last.color); return [c[0], c[1], c[2], last.alpha];
}

// Parametric position t∈[0,1] for a pixel (px,py) given the drag axis sx,sy→ex,ey,
// for the rasterised types. dx/dy = axis vector, len2 = |axis|².
function paramFor(type, px, py, sx, sy, dx, dy, len2) {
  if (type === 'angle') {
    // Sweep: angle of the pixel relative to the start, measured from the drag
    // direction, normalised to a full turn → 0..1.
    const ang = Math.atan2(py - sy, px - sx) - Math.atan2(dy, dx);
    let t = ang / (Math.PI * 2);
    t = t - Math.floor(t); // wrap into [0,1)
    return t;
  }
  if (type === 'reflected') {
    // Linear projection onto the axis, mirrored about the start: |proj|, so the
    // ramp is symmetric in both directions from the start line.
    const proj = ((px - sx) * dx + (py - sy) * dy) / (len2 || 1);
    return Math.min(1, Math.abs(proj));
  }
  if (type === 'radial') {
    // Distance from the start (centre) over the drag length → 0..1.
    const r = Math.sqrt(len2) || 1;
    return Math.min(1, Math.hypot(px - sx, py - sy) / r);
  }
  if (type === 'diamond') {
    // Chebyshev / square-distance isolines, scaled by the drag length so the
    // end point sits at t=1. Rotate into the axis frame so the diamond aligns
    // with the drag direction.
    const len = Math.sqrt(len2) || 1;
    const ux = dx / len, uy = dy / len; // unit axis
    const rx = (px - sx) * ux + (py - sy) * uy;       // along-axis
    const ry = -(px - sx) * uy + (py - sy) * ux;      // perpendicular
    return Math.min(1, Math.max(Math.abs(rx), Math.abs(ry)) / len);
  }
  // default linear (kept for completeness; native path handles linear/radial)
  const proj = ((px - sx) * dx + (py - sy) * dy) / (len2 || 1);
  return Math.max(0, Math.min(1, proj));
}

// Rasterise an angle/reflected/diamond gradient into a fresh canvas of size w×h
// (in the target coordinate space). The axis is given in that same space.
// Ordered (Bayer 4×4) dither offsets in ~[-0.5, 0.5) of one LUT step — breaks up
// 8-bit gradient banding without visible noise (the standard "Dither").
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);

function rasterGradient(type, w, h, sx, sy, ex, ey, stops, dither) {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, w | 0); cv.height = Math.max(1, h | 0);
  const ictx = cv.getContext('2d');
  const img = ictx.createImageData(cv.width, cv.height);
  const data = img.data;
  const dx = ex - sx, dy = ey - sy;
  const len2 = dx * dx + dy * dy;
  // Pre-sample the ramp into a 256-entry LUT for speed (per-pixel sampling of a
  // multi-stop list would be O(pixels × stops)).
  const LUT = new Float32Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const c = sampleStops(stops, i / 255);
    LUT[i * 4] = c[0]; LUT[i * 4 + 1] = c[1]; LUT[i * 4 + 2] = c[2]; LUT[i * 4 + 3] = c[3];
  }
  let o = 0;
  for (let y = 0; y < cv.height; y++) {
    for (let x = 0; x < cv.width; x++) {
      const t = paramFor(type, x + 0.5, y + 0.5, sx, sy, dx, dy, len2);
      const dth = dither ? BAYER4[((y & 3) << 2) | (x & 3)] : 0;
      const li = (Math.max(0, Math.min(255, Math.round(t * 255 + dth)))) * 4;
      data[o] = LUT[li]; data[o + 1] = LUT[li + 1]; data[o + 2] = LUT[li + 2];
      data[o + 3] = Math.round(LUT[li + 3] * 255);
      o += 4;
    }
  }
  ictx.putImageData(img, 0, 0);
  return cv;
}

// Build a document-space selection mask (white = inside) + tight bounds, mirroring
// clipboard-ops._resolveSelection. Sources, in priority order:
//   1. state.wandMask (a canvas; composited at its source layer's offset)
//   2. state.lassoPoints (3+ pts in doc/canvas coords — also written by marquee)
// Returns null when there's no selection (→ fill the whole layer, as before).
function resolveSelectionMask(docW, docH) {
  if (state.wandMask && state.wandMask.width && state.wandMask.height) {
    const srcLayer = state.layers.find((l) => l.id === state.wandLayerId);
    const off = srcLayer ? (state.layerOffsets.get(srcLayer.id) || { x: 0, y: 0 }) : { x: 0, y: 0 };
    const mask = document.createElement('canvas');
    mask.width = docW; mask.height = docH;
    mask.getContext('2d').drawImage(state.wandMask, off.x, off.y);
    return mask;
  }
  if (state.lassoPoints && state.lassoPoints.length >= 3) {
    const pts = state.lassoPoints;
    const mask = document.createElement('canvas');
    mask.width = docW; mask.height = docH;
    const mctx = mask.getContext('2d');
    mctx.fillStyle = '#fff';
    mctx.beginPath();
    mctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) mctx.lineTo(pts[i].x, pts[i].y);
    mctx.closePath();
    mctx.fill();
    return mask;
  }
  return null;
}

export function createGradientTool({ activeLayer, saveState, composite }) {
  // Paint the gradient (any type) into `ctx`, filling `w×h`, clipped to `selMask`
  // (a doc-space white-where-selected canvas, already offset into the target's
  // coord space) when present. sx,sy→ex,ey is the drag axis in the target space.
  function paintGradient(ctx, w, h, sx, sy, ex, ey, opts, fg, bg, selMask) {
    const stops = resolveStops(opts.mode, fg, bg);
    // Native canvas gradients can't skew per-segment midpoints — when any stop has
    // a non-default midpoint, render linear/radial through the raster sampler
    // (which honours mid) instead of the native addColorStop path.
    const hasMid = stops.some((s) => s.mid != null && Math.abs(s.mid - 0.5) > 0.001 && s.mid > 0.001 && s.mid < 0.999);
    const dither = !!state.gradDither;
    ctx.save();
    ctx.globalAlpha = opts.opacity;
    ctx.globalCompositeOperation = 'source-over';
    if ((opts.type === 'linear' || opts.type === 'radial') && !hasMid && !dither) {
      let grad;
      if (opts.type === 'radial') {
        const r = Math.max(1, Math.hypot(ex - sx, ey - sy));
        grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      } else {
        grad = ctx.createLinearGradient(sx, sy, ex, ey);
      }
      addStops(grad, opts.mode, fg, bg);
      ctx.fillStyle = grad;
      if (selMask) {
        // Render the ramp to a scratch canvas, then keep only the selected pixels.
        const sc = document.createElement('canvas');
        sc.width = Math.max(1, w | 0); sc.height = Math.max(1, h | 0);
        const sx2 = sc.getContext('2d');
        sx2.fillStyle = grad;
        sx2.fillRect(0, 0, sc.width, sc.height);
        sx2.globalCompositeOperation = 'destination-in';
        sx2.drawImage(selMask, 0, 0);
        ctx.drawImage(sc, 0, 0);
      } else {
        ctx.fillRect(0, 0, w, h);
      }
    } else {
      // angle / reflected / diamond — rasterised.
      const raster = rasterGradient(opts.type, w, h, sx, sy, ex, ey, stops, dither);
      if (selMask) {
        const rctx = raster.getContext('2d');
        rctx.globalCompositeOperation = 'destination-in';
        rctx.drawImage(selMask, 0, 0);
      }
      ctx.drawImage(raster, 0, 0);
    }
    ctx.restore();
  }

  // Draw the about-to-be-applied gradient over the live composite + a dashed axis
  // line (start→end with endpoint dots), so the user sees direction AND colours
  // while dragging — committed only on release (matching standard tools).
  function drawPreview() {
    const ctx = state.mainCtx;
    const s = state.gradStart, en = state.gradEnd;
    if (!ctx || !s || !en) return;
    composite(); // repaint base, then overlay the preview in doc space
    const opts = readOpts();
    const fg = state.color || '#000000';
    const bg = state.bgColor || '#ffffff';
    const W = state.mainCanvas.width, H = state.mainCanvas.height;
    // Preview is in document/canvas space, so the selection mask is used directly.
    const selMask = resolveSelectionMask(W, H);
    paintGradient(ctx, W, H, s.x, s.y, en.x, en.y, opts, fg, bg, selMask);
    // Axis line.
    ctx.save();
    const z = state.zoom || 1;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1 / z;
    ctx.setLineDash([5 / z, 4 / z]);
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(en.x, en.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#fff';
    for (const p of [s, en]) { ctx.beginPath(); ctx.arc(p.x, p.y, 3 / z, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  // Coalesce preview repaints behind a single requestAnimationFrame so a burst
  // of pointermove events produces at most one (full-document) raster per frame
  // instead of one per event — see brush-preview.js for the same pattern.
  let previewRaf = 0;
  function schedulePreview() {
    if (previewRaf) return;
    previewRaf = requestAnimationFrame(() => {
      previewRaf = 0;
      if (state.gradActive) drawPreview();
    });
  }
  function cancelPreview() {
    if (previewRaf) { cancelAnimationFrame(previewRaf); previewRaf = 0; }
  }
  return {
    begin(e) {
      const layer = activeLayer();
      if (!layer || layer.locked) return;
      const c = canvasCoords(e, state.mainCanvas);
      state.gradActive = true;
      state.gradStart = { x: c.x, y: c.y };
      state.gradEnd = { x: c.x, y: c.y };
    },
    move(e) {
      if (!state.gradActive) return;
      const c = canvasCoords(e, state.mainCanvas);
      state.gradEnd = { x: c.x, y: c.y };
      schedulePreview();
    },
    end() {
      cancelPreview();
      if (!state.gradActive) return;
      state.gradActive = false;
      const layer = activeLayer();
      const s = state.gradStart;
      const en = state.gradEnd;
      state.gradStart = null;
      state.gradEnd = null;
      if (!layer || !s || !en) return;

      const opts = readOpts();
      const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
      const ctx = layer.ctx;
      const sx = s.x - off.x, sy = s.y - off.y;
      const ex = en.x - off.x, ey = en.y - off.y;
      const fg = state.color || '#000000';
      const bg = state.bgColor || '#ffffff';

      // Selection mask is in document space; shift it into the layer's pixel
      // space (subtract the layer offset) so it lines up with the layer canvas.
      const W = state.mainCanvas.width, H = state.mainCanvas.height;
      const docMask = resolveSelectionMask(W, H);
      let layerMask = null;
      if (docMask) {
        layerMask = document.createElement('canvas');
        layerMask.width = layer.canvas.width; layerMask.height = layer.canvas.height;
        layerMask.getContext('2d').drawImage(docMask, -off.x, -off.y);
      }

      saveState('Gradient');
      paintGradient(ctx, layer.canvas.width, layer.canvas.height, sx, sy, ex, ey, opts, fg, bg, layerMask);
      composite();
    },
  };
}
