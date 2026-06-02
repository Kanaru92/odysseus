/**
 * Pressure-response curve editor (Clip-Studio-style). A small draggable graph:
 * X = raw stylus pressure, Y = effective pressure. Drag points to reshape, click
 * empty space to add a point, double-click a point to remove it (endpoints are
 * x-locked at 0 and 1). Presets: Linear / Soft / Hard. Feeds pressure-response.js
 * which the stroke pipeline samples per dab.
 */
import { setPressureCurve, getPressureCurve, PRESSURE_PRESETS } from './pressure-response.js';

const SIZE = 132, PAD = 8;

export function mountPressureCurve() {
  const host = document.getElementById('ge-pressure-curve-host');
  if (!host || host.dataset.mounted) return;
  host.dataset.mounted = '1';
  host.innerHTML = `
    <canvas class="ge-pcurve" width="${SIZE}" height="${SIZE}"></canvas>
    <div class="ge-pcurve-btns">
      <button type="button" class="ge-btn ge-btn-sm" data-pc="linear">Linear</button>
      <button type="button" class="ge-btn ge-btn-sm" data-pc="soft">Soft</button>
      <button type="button" class="ge-btn ge-btn-sm" data-pc="hard">Hard</button>
    </div>`;
  const cv = host.querySelector('.ge-pcurve');
  const ctx = cv.getContext('2d');
  let pts = getPressureCurve();

  const W = SIZE - PAD * 2;
  const toPx = (p) => ({ x: PAD + p[0] * W, y: PAD + (1 - p[1]) * W });
  const toNorm = (px, py) => [
    Math.max(0, Math.min(1, (px - PAD) / W)),
    Math.max(0, Math.min(1, 1 - (py - PAD) / W)),
  ];
  // A newly added point clamped exactly to x=0 or x=1 would be treated as an
  // endpoint: x-locked while dragging and undeletable. Keep added points strictly
  // interior so they stay movable/removable.
  const EPS = 1e-4;
  const interiorX = (x) => Math.max(EPS, Math.min(1 - EPS, x));

  function draw() {
    ctx.clearRect(0, 0, SIZE, SIZE);
    // frame + grid
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const g = PAD + (i / 4) * W;
      ctx.beginPath(); ctx.moveTo(g, PAD); ctx.lineTo(g, PAD + W); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(PAD, g); ctx.lineTo(PAD + W, g); ctx.stroke();
    }
    // curve (sampled through the same LUT shape — straight segments between pts).
    // pts is kept sorted by commit() before every draw(), so no re-sort here.
    const sorted = pts;
    ctx.strokeStyle = '#e06c75';
    ctx.lineWidth = 2;
    ctx.beginPath();
    sorted.forEach((p, i) => { const q = toPx(p); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
    ctx.stroke();
    // points
    for (const p of sorted) {
      const q = toPx(p);
      ctx.beginPath(); ctx.arc(q.x, q.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.stroke();
    }
  }

  function commit() {
    pts.sort((a, b) => a[0] - b[0]);
    setPressureCurve(pts);
    draw();
  }

  // Track the point being dragged by object reference, not by index: commit()
  // sorts pts in place, so an interior point dragged past a neighbor's x would
  // reorder the array and a numeric index would silently jump to a different point.
  let dragPt = null;
  const localXY = (e) => {
    const r = cv.getBoundingClientRect();
    return [(e.clientX - r.left) * (SIZE / r.width), (e.clientY - r.top) * (SIZE / r.height)];
  };
  const nearest = (px, py) => {
    let best = -1, bd = 12 * 12;
    pts.forEach((p, i) => { const q = toPx(p); const d = (q.x - px) ** 2 + (q.y - py) ** 2; if (d < bd) { bd = d; best = i; } });
    return best;
  };

  cv.addEventListener('pointerdown', (e) => {
    const [px, py] = localXY(e);
    const i = nearest(px, py);
    if (i >= 0) {
      dragPt = pts[i];
    } else { // add a new point (kept strictly interior so it stays movable/removable)
      const [nx, ny] = toNorm(px, py);
      dragPt = [interiorX(nx), ny];
      pts.push(dragPt); commit();
    }
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!dragPt) return;
    const [px, py] = localXY(e);
    const [nx, ny] = toNorm(px, py);
    const isEnd = dragPt[0] === 0 || dragPt[0] === 1;
    // Mutate the tracked point in place so its identity survives commit()'s sort;
    // endpoints keep their x.
    if (!isEnd) dragPt[0] = nx;
    dragPt[1] = ny;
    commit();
  });
  const endDrag = () => { dragPt = null; };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('dblclick', (e) => {
    const [px, py] = localXY(e);
    const i = nearest(px, py);
    if (i >= 0 && pts[i][0] !== 0 && pts[i][0] !== 1) { pts.splice(i, 1); commit(); }
  });

  host.querySelectorAll('[data-pc]').forEach((b) => b.addEventListener('click', () => {
    pts = PRESSURE_PRESETS[b.dataset.pc].map((p) => p.slice());
    commit();
  }));

  commit();
}
