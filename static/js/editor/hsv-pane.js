/**
 * Classic HSV "Color" pane (the third Color-panel tab) — a saturation/value
 * square + a hue strip, dragged to pick a colour, driving the canonical
 * foreground input so all existing wiring updates. Self-contained; complements
 * the perceptual OK Color Picker tab.
 */

const SQ = 150, HUE_H = 14;

function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}
const hx = (n) => n.toString(16).padStart(2, '0');
const hsvToHex = (h, s, v) => { const [r, g, b] = hsvToRgb(h, s, v); return '#' + hx(r) + hx(g) + hx(b); };
function hexToHsv(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return rgbToHsv((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

export function wireHsvPane() {
  const host = document.getElementById('ge-color-hsv');
  const fg = document.querySelector('.ge-fg-color') || document.querySelector('.ge-color-picker');
  if (!host || !fg || host.dataset.mounted) return;
  host.dataset.mounted = '1';
  host.innerHTML = `
    <div class="ge-hsv-sqwrap"><canvas class="ge-hsv-sq" width="${SQ}" height="${SQ}"></canvas><span class="ge-hsv-sv-handle"></span></div>
    <div class="ge-hsv-huewrap"><canvas class="ge-hsv-hue" width="${SQ}" height="${HUE_H}"></canvas><span class="ge-hsv-hue-handle"></span></div>`;
  const sq = host.querySelector('.ge-hsv-sq'), sctx = sq.getContext('2d');
  const hue = host.querySelector('.ge-hsv-hue'), hctx = hue.getContext('2d');
  const svH = host.querySelector('.ge-hsv-sv-handle'), hueH = host.querySelector('.ge-hsv-hue-handle');
  let h = 0, s = 0, v = 0, suppress = false;

  // Static hue rainbow.
  (() => { for (let x = 0; x < SQ; x++) { hctx.fillStyle = `hsl(${(x / SQ) * 360},100%,50%)`; hctx.fillRect(x, 0, 1, HUE_H); } })();

  function drawSquare() {
    const [r0, g0, b0] = hsvToRgb(h, 1, 1);
    // base hue, then white→hue horizontally, black→transparent vertically
    sctx.fillStyle = `rgb(${r0},${g0},${b0})`; sctx.fillRect(0, 0, SQ, SQ);
    let g = sctx.createLinearGradient(0, 0, SQ, 0);
    g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)');
    sctx.fillStyle = g; sctx.fillRect(0, 0, SQ, SQ);
    g = sctx.createLinearGradient(0, 0, 0, SQ);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, '#000');
    sctx.fillStyle = g; sctx.fillRect(0, 0, SQ, SQ);
  }
  function placeHandles() {
    svH.style.left = (s * SQ) + 'px';
    svH.style.top = ((1 - v) * SQ) + 'px';
    hueH.style.left = ((h / 360) * SQ) + 'px';
  }
  function emit() {
    const hex = hsvToHex(h, s, v);
    suppress = true;
    fg.value = hex;
    fg.dispatchEvent(new Event('input', { bubbles: true }));
    suppress = false;
  }
  function setHsv(nh, ns, nv, push) {
    h = nh; s = ns; v = nv;
    drawSquare(); placeHandles();
    if (push) emit();
  }

  const rel = (el, e) => { const r = el.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  const clamp = (x) => Math.max(0, Math.min(1, x));
  function dragSquare(e) { const [x, y] = rel(sq, e); setHsv(h, clamp(x), clamp(1 - y), true); }
  function dragHue(e) { const [x] = rel(hue, e); setHsv(clamp(x) * 360, s, v, true); }

  const bind = (el, fn) => {
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); fn(e); const mv = (ev) => fn(ev); const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); }; el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); });
  };
  bind(sq, dragSquare);
  bind(hue, dragHue);

  function syncFromFg() { if (suppress) return; const [nh, ns, nv] = hexToHsv(fg.value || '#000000'); setHsv(nh, ns, nv, false); }
  fg.addEventListener('input', syncFromFg);
  syncFromFg();
}
