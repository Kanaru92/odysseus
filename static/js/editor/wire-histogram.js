/**
 * Histogram panel — a read-only luminance histogram of the active layer in the
 * right panel (a pro tonal-feedback docker). Reuses fx/histogram.js. Redraws on
 * the `ge:composited` frame hook (rAF-coalesced, and only while the section is
 * open) so it stays live during edits without per-stroke cost when collapsed.
 * Display-only — touches no canvas/layer/composite state.
 */
import { drawHistogram } from './fx/histogram.js';

export function wireHistogram({ activeLayer }) {
  const details = document.getElementById('ge-histogram-section');
  const canvas = document.getElementById('ge-histogram-canvas');
  if (!details || !canvas) return;
  let raf = 0;
  const redraw = () => {
    if (!details.open) return;
    const layer = activeLayer && activeLayer();
    if (layer && layer.canvas) { try { drawHistogram(canvas, layer); } catch {} }
  };
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; redraw(); });
  };
  details.addEventListener('toggle', redraw);
  window.addEventListener('ge:composited', schedule);
}
