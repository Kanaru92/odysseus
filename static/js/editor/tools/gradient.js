/**
 * Gradient tool — drag on the canvas to fill the active layer with a linear or
 * radial gradient between the foreground and background colors (or FG →
 * transparent). Original implementation using the canvas 2D gradient API.
 *
 * Drag defines the gradient axis (start → end). Released → fill the whole
 * active layer. (Clipping to an active selection is a future refinement.)
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
  const typeBtn = document.querySelector('.ge-grad-type.active');
  const modeBtn = document.querySelector('.ge-grad-mode.active');
  const op = document.getElementById('ge-grad-opacity');
  return {
    type: (typeBtn && typeBtn.dataset.gradType) || 'linear',
    mode: (modeBtn && modeBtn.dataset.gradMode) || 'fg-bg',
    opacity: Math.max(0, Math.min(1, (parseInt(op && op.value) || 100) / 100)),
  };
}

  // Shared stop logic so the live preview and the committed fill match exactly.
  // When the multi-stop editor is engaged (state.gradUseCustom), build from its
  // per-stop colour+alpha; otherwise use the FG→BG / FG→Transparent mode.
  function addStops(grad, mode, fg, bg) {
    if (state.gradUseCustom && Array.isArray(state.gradStops) && state.gradStops.length >= 2) {
      const s = [...state.gradStops].sort((a, b) => a.pos - b.pos);
      for (const st of s) {
        const p = Math.max(0, Math.min(1, st.pos));
        grad.addColorStop(p, hexToRgba(st.color, st.alpha == null ? 1 : st.alpha));
      }
      return;
    }
    if (mode === 'fg-transparent') {
      grad.addColorStop(0, hexToRgba(fg, 1));
      grad.addColorStop(1, hexToRgba(fg, 0));
    } else {
      grad.addColorStop(0, fg);
      grad.addColorStop(1, bg);
    }
  }

export function createGradientTool({ activeLayer, saveState, composite }) {
  // Draw the about-to-be-applied gradient over the live composite + a dashed
  // axis line (start→end with endpoint dots), so the user sees direction AND
  // colours while dragging — committed only on release (PS/Procreate parity).
  function drawPreview() {
    const ctx = state.mainCtx;
    const s = state.gradStart, en = state.gradEnd;
    if (!ctx || !s || !en) return;
    composite(); // repaint base, then overlay the preview in doc space
    const { type, mode, opacity } = readOpts();
    const fg = state.color || '#000000';
    const bg = state.bgColor || '#ffffff';
    let grad;
    if (type === 'radial') {
      const r = Math.max(1, Math.hypot(en.x - s.x, en.y - s.y));
      grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
    } else {
      grad = ctx.createLinearGradient(s.x, s.y, en.x, en.y);
    }
    addStops(grad, mode, fg, bg);
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, state.mainCanvas.width, state.mainCanvas.height);
    ctx.restore();
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
      drawPreview();
    },
    end() {
      if (!state.gradActive) return;
      state.gradActive = false;
      const layer = activeLayer();
      const s = state.gradStart;
      const en = state.gradEnd;
      state.gradStart = null;
      state.gradEnd = null;
      if (!layer || !s || !en) return;

      const { type, mode, opacity } = readOpts();
      const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
      const ctx = layer.ctx;
      const sx = s.x - off.x, sy = s.y - off.y;
      const ex = en.x - off.x, ey = en.y - off.y;

      saveState('Gradient');
      let grad;
      if (type === 'radial') {
        const r = Math.max(1, Math.hypot(ex - sx, ey - sy));
        grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      } else {
        grad = ctx.createLinearGradient(sx, sy, ex, ey);
      }
      const fg = state.color || '#000000';
      const bg = state.bgColor || '#ffffff';
      addStops(grad, mode, fg, bg);
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, layer.canvas.width, layer.canvas.height);
      ctx.restore();
      composite();
    },
  };
}
