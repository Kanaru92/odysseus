/**
 * Ruler / Measure tool — drag on the canvas to define a measure line; the tool
 * reports its length and angle without ever writing to a layer.
 *
 * Drag defines the measurement axis (start → end). While dragging, the live
 * composite is repainted and the line + small end caps + a midpoint text label
 * are overlaid in document space (1/zoom line widths so they stay crisp at any
 * zoom). On release the measurement persists (state.rulerStart/End/rulerInfo
 * stay populated) and is re-overlaid after every composite() via the
 * 'ge:composited' hook, so zoom/pan/redraws keep the line visible until the
 * user switches tools (which drops it on the next composite). Purely
 * non-destructive — the overlay lives on state.mainCtx and no layer pixels are
 * ever touched.
 *
 * Angle convention follows the conventional measure read-out: right = 0°, up =
 * +90°, normalized to (-180, 180] via atan2(-dy, dx) (canvas y grows downward,
 * so dy is negated to make "up" positive).
 */
import { state } from '../state.js';
import { canvasCoords } from '../canvas-coords.js';

// Recompute dx/dy/length/angle from the current start→end and stash on state.
function updateInfo() {
  const s = state.rulerStart, en = state.rulerEnd;
  if (!s || !en) { state.rulerInfo = null; return; }
  const dx = en.x - s.x;
  const dy = en.y - s.y;
  const length = Math.hypot(dx, dy);
  // atan2(-dy, dx): right=0°, up=+90°. Range is already (-180, 180].
  const angle = Math.atan2(-dy, dx) * 180 / Math.PI;
  state.rulerInfo = { length, angle, dx, dy };
}

export function createRulerTool({ composite }) {
  // Paint the measure line + caps + label in document coords onto the live
  // composite (state.mainCtx). Mirrors the gradient tool's preview approach
  // (1/zoom widths). This does NOT repaint the base — callers either composite()
  // first (drawOverlay) or run from the post-composite 'ge:composited' hook.
  function paintOverlay() {
    const ctx = state.mainCtx;
    const s = state.rulerStart, en = state.rulerEnd;
    if (!ctx || !s || !en) return;
    const z = state.zoom || 1;
    ctx.save();
    ctx.lineWidth = 1 / z;
    ctx.strokeStyle = '#fff';
    // Main line.
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(en.x, en.y);
    ctx.stroke();
    // Small end caps perpendicular to the line at each endpoint.
    const dx = en.x - s.x, dy = en.y - s.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len; // unit normal
    const cap = 6 / z;
    for (const p of [s, en]) {
      ctx.beginPath();
      ctx.moveTo(p.x - nx * cap, p.y - ny * cap);
      ctx.lineTo(p.x + nx * cap, p.y + ny * cap);
      ctx.stroke();
    }
    // Text label near the midpoint.
    const info = state.rulerInfo;
    if (info) {
      const mx = (s.x + en.x) / 2;
      const my = (s.y + en.y) / 2;
      const label = `L: ${info.length.toFixed(1)}  A: ${info.angle.toFixed(1)}°`;
      ctx.font = `${12 / z}px sans-serif`;
      ctx.textBaseline = 'bottom';
      const pad = 3 / z;
      const tw = ctx.measureText(label).width;
      const th = 12 / z;
      const tx = mx + pad;
      const ty = my - pad;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(tx - pad, ty - th - pad, tw + pad * 2, th + pad * 2);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, tx, ty);
    }
    ctx.restore();
  }

  // Repaint the base composite, then overlay. Used during the live drag.
  // Guarded so the 'ge:composited' hook (below) doesn't re-enter while our own
  // composite() call is in flight.
  let painting = false;
  function drawOverlay() {
    painting = true;
    try {
      composite(); // repaint base, then overlay in doc space
      paintOverlay();
    } finally {
      painting = false;
    }
  }

  // Persistence: composite() (zoom, pan, mask toggle, any other tool action)
  // wipes mainCtx with no ruler pass, so without this the line/label vanish on
  // the next redraw. Re-overlay after every composite while a measurement is
  // present. Skip the self-triggered composite from drawOverlay (already
  // painted) to avoid double work / re-entrancy.
  window.addEventListener('ge:composited', () => {
    if (painting) return;
    if (!state.rulerStart || !state.rulerEnd) return;
    // Switching away from the ruler tool drops the measurement so a stale line
    // doesn't linger over an unrelated tool. The composite that already ran has
    // wiped the overlay, so just clear state — no extra repaint needed.
    if (state.tool !== 'ruler') {
      state.rulerStart = null;
      state.rulerEnd = null;
      state.rulerInfo = null;
      return;
    }
    paintOverlay();
  });

  return {
    begin(e) {
      // No layer requirement — the ruler is a non-destructive measurement.
      const c = canvasCoords(e, state.mainCanvas);
      state.rulerActive = true;
      state.rulerStart = { x: c.x, y: c.y };
      state.rulerEnd = { x: c.x, y: c.y };
      updateInfo();
    },
    move(e) {
      if (!state.rulerActive) return;
      const c = canvasCoords(e, state.mainCanvas);
      state.rulerEnd = { x: c.x, y: c.y };
      updateInfo();
      drawOverlay();
    },
    end() {
      if (!state.rulerActive) return;
      // Keep rulerStart / rulerEnd / rulerInfo so the measurement stays
      // readable after release; only clear the active flag.
      state.rulerActive = false;
    },
  };
}
