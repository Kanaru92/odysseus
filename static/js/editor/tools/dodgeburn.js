/**
 * Dodge / Burn / Sponge — tonal & saturation brushes. Drag to lighten (Dodge),
 * darken (Burn), or shift saturation (Sponge) the active layer's pixels, with a
 * soft radial falloff that builds up as you scrub. Operates only on RGB and
 * leaves alpha untouched, so it affects existing paint without adding opacity.
 * Original code.
 *
 * `toneDab` is a pure per-dab kernel (no DOM) so the tonal math is unit-testable.
 */
import { state } from '../state.js';
import { canvasCoords } from '../canvas-coords.js';

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * Apply one tonal dab IN PLACE on `region` (RGBA, regionW×regionH at canvas
 * origin originX/originY). `mode` ∈ dodge|burn|desaturate|saturate. `amount`
 * 0..1 is the centre strength; each pixel scales it by a squared radial falloff.
 */
export function toneDab(region, regionW, regionH, originX, originY, px, py, radius, mode, amount) {
  const r = radius <= 0 ? 1 : radius;
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
      let f = 1 - dist / r; f = f * f;
      const a = amount * f;
      if (a <= 0) continue;
      const i = (ry * regionW + rx) * 4;
      const rr = region[i], gg = region[i + 1], bb = region[i + 2];
      if (mode === 'dodge') {
        region[i] = clamp(rr + (255 - rr) * a);
        region[i + 1] = clamp(gg + (255 - gg) * a);
        region[i + 2] = clamp(bb + (255 - bb) * a);
      } else if (mode === 'burn') {
        region[i] = clamp(rr * (1 - a));
        region[i + 1] = clamp(gg * (1 - a));
        region[i + 2] = clamp(bb * (1 - a));
      } else {
        const luma = 0.299 * rr + 0.587 * gg + 0.114 * bb;
        if (mode === 'desaturate') {
          region[i] = clamp(rr + (luma - rr) * a);
          region[i + 1] = clamp(gg + (luma - gg) * a);
          region[i + 2] = clamp(bb + (luma - bb) * a);
        } else { // saturate
          region[i] = clamp(rr + (rr - luma) * a);
          region[i + 1] = clamp(gg + (gg - luma) * a);
          region[i + 2] = clamp(bb + (bb - luma) * a);
        }
      }
    }
  }
}

export function createDodgeBurnTool({ activeLayer, saveState, composite }) {
  let ctx = null, radius = 0, layerRef = null;

  function modeVal() {
    const el = document.getElementById('ge-dodgeburn-mode');
    return (el && el.value) || 'dodge';
  }
  function amountVal() {
    const el = document.getElementById('ge-dodgeburn-strength');
    const v = parseInt(el && el.value, 10);
    return Math.max(0, Math.min(1, (Number.isFinite(v) ? v : 50) / 100)) * 0.5;
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
      saveState('Dodge/Burn');
      state.dodgeBurnActive = true;
      state.dodgeBurnLast = { x: c.x - off.x, y: c.y - off.y };
      // Apply an initial dab so a single click registers.
      this.stamp(state.dodgeBurnLast, state.dodgeBurnLast);
      composite();
    },
    move(e) {
      if (!state.dodgeBurnActive || !layerRef) return;
      const off = state.layerOffsets.get(layerRef.id) || { x: 0, y: 0 };
      const c = canvasCoords(e, state.mainCanvas);
      const cur = { x: c.x - off.x, y: c.y - off.y };
      this.stamp(state.dodgeBurnLast || cur, cur);
      state.dodgeBurnLast = cur;
      composite();
    },
    stamp(last, cur) {
      const W = layerRef.canvas.width, H = layerRef.canvas.height;
      const minX = Math.max(0, Math.floor(Math.min(last.x, cur.x) - radius));
      const minY = Math.max(0, Math.floor(Math.min(last.y, cur.y) - radius));
      const maxX = Math.min(W, Math.ceil(Math.max(last.x, cur.x) + radius));
      const maxY = Math.min(H, Math.ceil(Math.max(last.y, cur.y) + radius));
      const rw = maxX - minX, rh = maxY - minY;
      if (rw <= 0 || rh <= 0) return;
      const region = ctx.getImageData(minX, minY, rw, rh);
      const mode = modeVal(), amount = amountVal();
      const segLen = Math.hypot(cur.x - last.x, cur.y - last.y);
      const steps = Math.max(1, Math.ceil(segLen / Math.max(1, radius * 0.25)));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        toneDab(region.data, rw, rh, minX, minY,
          last.x + (cur.x - last.x) * t, last.y + (cur.y - last.y) * t, radius, mode, amount);
      }
      ctx.putImageData(region, minX, minY);
    },
    end() {
      state.dodgeBurnActive = false;
      state.dodgeBurnLast = null;
      layerRef = null;
    },
  };
}
