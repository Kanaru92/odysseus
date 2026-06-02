/**
 * Magnetic Lasso — like the polygonal lasso (click to drop anchors, with a live
 * segment to the cursor between clicks) but the open path between the last
 * committed anchor and the cursor SNAPS onto high-contrast edges. As the cursor
 * moves we sample points along the straight anchor→cursor segment and nudge each
 * sample sideways toward the strongest local luma gradient within a small
 * perpendicular search window, producing a polyline that hugs the edge.
 *
 * Reuses the freehand lasso's selection machinery: on close it leaves the polygon
 * in `state.lassoPoints` (and clears `lassoActive`), so every existing lasso
 * action — feather, grow, invert, delete, copy-to-layer, to-mask — works
 * unchanged. While tracing, `state.magLassoActive` is true,
 * `state.magLassoAnchors` holds the committed anchor points (each click appends),
 * and `state.magLassoPreview` holds the live cursor point for the live segment.
 *
 * `state.lassoPoints` always = committed anchors + the live snapped tail; click()
 * promotes the current snapped tail into committed anchors, so the finished path
 * is the concatenation of every snapped segment.
 *
 * @param {{
 *   composite:               () => void,
 *   drawLassoOverlay:        () => void,
 *   syncToolClearIndicators: () => void,
 * }} deps
 */
import { state } from '../state.js';
import { canvasCoords } from '../canvas-coords.js';

export function createMagneticLassoTool({ composite, drawLassoOverlay, syncToolClearIndicators }) {
  const z = () => state.zoom || 1;
  // Close when a click lands within this many IMAGE px of the start anchor.
  const closeDist = () => 8 / z();
  // Edge-search tuning (all in image pixels).
  const PERP = 6;          // perpendicular half-window searched for the edge
  const STEP = 4;          // spacing between samples along the segment
  const MAX_SAMPLES = 200; // cap so a long drag can't blow up the polyline

  // Resolve a pixel source for the edge search: the active layer's own canvas
  // (snap to the layer being selected on), else the composited main canvas.
  // We also record the layer's OFFSET so document-space lasso points are mapped
  // to layer-local pixels — without this, snapping misregisters whenever the
  // layer is offset (its canvas is layer-local, the points are document-space).
  // Captured once at the start of a trace, before any overlay is drawn.
  let _src = null;        // { data, w, h, offX, offY }
  function refreshSource() {
    _src = null;
    const layer = state.layers && state.layers.find(l => l.id === state.activeLayerId);
    try {
      if (layer && layer.canvas && layer.canvas.width && layer.canvas.height) {
        const ctx = layer.ctx || layer.canvas.getContext('2d');
        const off = (state.layerOffsets && state.layerOffsets.get(layer.id)) || { x: 0, y: 0 };
        _src = { data: ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height), w: layer.canvas.width, h: layer.canvas.height, offX: off.x || 0, offY: off.y || 0 };
        return;
      }
    } catch { _src = null; }
    try {
      const c = state.mainCanvas; // composite fallback is document-space (offset 0)
      if (c && state.mainCtx && c.width && c.height) {
        _src = { data: state.mainCtx.getImageData(0, 0, c.width, c.height), w: c.width, h: c.height, offX: 0, offY: 0 };
      }
    } catch { _src = null; }
  }

  // Luma of a single texel at layer-local integer (ix, iy), edge-clamped.
  // Folds alpha in so a hard transparent/opaque boundary also reads as an edge.
  function lumaTexel(ix, iy) {
    const cx = ix < 0 ? 0 : (ix > _src.w - 1 ? _src.w - 1 : ix);
    const cy = iy < 0 ? 0 : (iy > _src.h - 1 ? _src.h - 1 : iy);
    const d = _src.data.data;
    const o = (cy * _src.w + cx) * 4;
    const a = d[o + 3] / 255;
    return (0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]) * a;
  }

  // Luma at DOCUMENT (x, y) — mapped to layer-local via the recorded offset.
  // Bilinearly interpolated so sub-pixel offsets (snapPoint's central difference
  // steps by the unit perpendicular nx,ny, magnitude ≤ 1px) resolve real
  // gradients instead of collapsing to the same truncated texel. 0 when no source.
  function luma(x, y) {
    if (!_src) return 0;
    const fx = (x - _src.offX), fy = (y - _src.offY);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const l00 = lumaTexel(x0, y0), l10 = lumaTexel(x0 + 1, y0);
    const l01 = lumaTexel(x0, y0 + 1), l11 = lumaTexel(x0 + 1, y0 + 1);
    const top = l00 + (l10 - l00) * tx;
    const bot = l01 + (l11 - l01) * tx;
    return top + (bot - top) * ty;
  }

  // Snap one sample point to the local luma-gradient maximum along the segment's
  // perpendicular. `nx,ny` is the unit perpendicular of the anchor→cursor line.
  function snapPoint(px, py, nx, ny) {
    let bestT = 0, bestG = -1;
    for (let t = -PERP; t <= PERP; t++) {
      const sx = px + nx * t, sy = py + ny * t;
      // Central-difference gradient magnitude across the perpendicular axis.
      const g = Math.abs(luma(sx + nx, sy + ny) - luma(sx - nx, sy - ny));
      if (g > bestG) { bestG = g; bestT = t; }
    }
    // No contrast in the window → leave the sample on the straight line.
    if (bestG <= 0) return { x: px, y: py };
    return { x: px + nx * bestT, y: py + ny * bestT };
  }

  // Build the snapped polyline from `from` to `to` (both image-space points).
  function snapSegment(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return [{ x: to.x, y: to.y }];
    const ux = dx / len, uy = dy / len; // unit direction
    const nx = -uy, ny = ux;            // unit perpendicular
    const n = Math.min(MAX_SAMPLES, Math.max(1, Math.round(len / STEP)));
    const out = [];
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      out.push(snapPoint(from.x + dx * f, from.y + dy * f, nx, ny));
    }
    return out;
  }

  // Recompute state.lassoPoints = committed anchors + snapped live tail.
  function rebuild() {
    const anchors = state.magLassoAnchors || [];
    if (anchors.length === 0) { state.lassoPoints = []; return; }
    let pts = anchors.slice();
    if (state.magLassoPreview) {
      const tail = snapSegment(anchors[anchors.length - 1], state.magLassoPreview);
      pts = pts.concat(tail);
    }
    state.lassoPoints = pts;
  }

  // Coalesce the move hot path: a raw pointermove can fire many times per frame
  // and each redraw runs a full composite() + a full re-snap of the live tail
  // (up to MAX_SAMPLES points). Schedule at most one rebuild+redraw per animation
  // frame, dropping intermediate events; the latest magLassoPreview wins.
  let _raf = 0;
  function scheduleRedraw() {
    if (_raf) return;
    _raf = requestAnimationFrame(() => {
      _raf = 0;
      if (!state.magLassoActive) return;
      rebuild();
      redraw();
    });
  }
  function cancelScheduledRedraw() {
    if (_raf) { cancelAnimationFrame(_raf); _raf = 0; }
  }

  function redraw() {
    composite();
    const pts = state.lassoPoints;
    if (!pts || pts.length === 0) return;
    const ctx = state.mainCtx;
    if (!ctx) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1 / z();
    ctx.setLineDash([4 / z(), 4 / z()]);
    ctx.stroke();
    ctx.setLineDash([]);
    // Anchor dots (committed clicks) + a start-vertex marker to aim the close.
    ctx.fillStyle = '#fff';
    const anchors = state.magLassoAnchors || [];
    for (let i = 0; i < anchors.length; i++) {
      ctx.beginPath();
      ctx.arc(anchors[i].x, anchors[i].y, (i === 0 ? 3 : 2) / z(), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  return {
    // pointerdown — start the trace, commit the current snapped tail as anchors,
    // or close if the click lands on the start anchor.
    click(e) {
      // A click commits + renders synchronously; drop any move frame still
      // queued so it can't fire a redundant redraw over the committed state.
      cancelScheduledRedraw();
      const c = canvasCoords(e, state.mainCanvas);
      if (!state.magLassoActive) {
        refreshSource();
        state.magLassoAnchors = [c];
        state.magLassoActive = true;
        state.magLassoPreview = c;
        rebuild();
        redraw();
        return;
      }
      // Anchor the live tail to the actual click position before deciding to
      // close. On touch/pen taps no hover-move precedes the click, so without
      // this the closing segment would snap to a stale preview point (the last
      // pointermove) instead of where the user tapped. rebuild() refreshes
      // state.lassoPoints so the length-check + close use the true geometry.
      state.magLassoPreview = c;
      rebuild();
      const start = state.magLassoAnchors[0];
      const near = start && Math.hypot(c.x - start.x, c.y - start.y) <= closeDist();
      if (near && state.lassoPoints.length >= 3) { this.close(); return; }
      // Commit the snapped tail from the last anchor to this click as anchors,
      // then continue tracing from the click.
      const last = state.magLassoAnchors[state.magLassoAnchors.length - 1];
      const tail = snapSegment(last, c);
      // Append only points that actually advance from the running last anchor, so
      // a zero-length click can't accumulate degenerate (duplicate) segments.
      for (const p of tail) {
        const prev = state.magLassoAnchors[state.magLassoAnchors.length - 1];
        if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) >= 0.5) state.magLassoAnchors.push(p);
      }
      state.magLassoPreview = c;
      rebuild();
      redraw();
    },

    // free pointermove (button up) — snap the open edge to the cursor.
    move(e) {
      if (!state.magLassoActive) return;
      // Re-capture the pixel source only if it's missing (e.g. the layer didn't
      // exist yet when the trace began). The source is otherwise snapshotted
      // once at trace start (refreshSource on the first click) and reused for the
      // whole trace — a trace is short-lived and the user isn't painting during it.
      if (!_src) refreshSource();
      state.magLassoPreview = canvasCoords(e, state.mainCanvas);
      scheduleRedraw();
    },

    close() {
      cancelScheduledRedraw();
      const finalize = state.lassoPoints && state.lassoPoints.length >= 3;
      const pts = finalize ? state.lassoPoints.slice() : [];
      state.magLassoActive = false;
      state.magLassoPreview = null;
      state.magLassoAnchors = [];
      _src = null;
      if (!finalize) {
        state.lassoPoints = [];
        composite();
        syncToolClearIndicators();
        return;
      }
      state.lassoPoints = pts;
      composite();
      drawLassoOverlay();
      syncToolClearIndicators();
    },

    cancel() {
      cancelScheduledRedraw();
      state.magLassoActive = false;
      state.magLassoPreview = null;
      state.magLassoAnchors = [];
      state.lassoPoints = [];
      _src = null;
      composite();
      syncToolClearIndicators();
    },

    get active() { return !!state.magLassoActive; },
  };
}
