/**
 * Classic HSV "Color" pane (the third Color-panel tab) — a saturation/value
 * square + a hue strip, dragged to pick a colour, driving the canonical
 * foreground input so all existing wiring updates. Self-contained; complements
 * the perceptual OK Color Picker tab.
 */

const SQ = 200, HUE_W = 16; // SV-square draw buffer; vertical hue bar buffer width

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
  // Compact numeric block (R/G/B 0–255, H 0–360, S/V 0–100, hex). Styling lives in
  // CSS (.ge-hsv-* / .ge-field) per the design guide — no inline styles. The SV
  // square + a VERTICAL hue bar sit side-by-side (PS layout); fields below align to
  // a fixed letter column. HSV's third channel is labelled V (not a second "B").
  const fld = (lbl, cls, max) =>
    `<label class="ge-hsv-f"><span>${lbl}</span>`
    + `<input type="text" inputmode="numeric" class="ge-field ${cls}" data-max="${max}" spellcheck="false" autocomplete="off"></label>`;
  host.innerHTML = `
    <div class="ge-hsv-top">
      <div class="ge-hsv-sqwrap"><canvas class="ge-hsv-sq" width="${SQ}" height="${SQ}"></canvas><span class="ge-hsv-sv-handle"></span></div>
      <div class="ge-hsv-huewrap"><canvas class="ge-hsv-hue" width="${HUE_W}" height="${SQ}"></canvas><span class="ge-hsv-hue-handle"></span></div>
    </div>
    <div class="ge-hsv-fields">
      <div class="ge-hsv-frow">${fld('R', 'ge-hsv-r', 255)}${fld('G', 'ge-hsv-g', 255)}${fld('B', 'ge-hsv-b', 255)}</div>
      <div class="ge-hsv-frow">${fld('H', 'ge-hsv-h', 360)}${fld('S', 'ge-hsv-s', 100)}${fld('V', 'ge-hsv-bv', 100)}</div>
      <label class="ge-hsv-f ge-hsv-hexrow"><span>#</span>
        <input type="text" class="ge-field ge-hsv-hex" maxlength="7" spellcheck="false" autocomplete="off"></label>
    </div>`;
  const sq = host.querySelector('.ge-hsv-sq'), sctx = sq.getContext('2d');
  const hue = host.querySelector('.ge-hsv-hue'), hctx = hue.getContext('2d');
  const svH = host.querySelector('.ge-hsv-sv-handle'), hueH = host.querySelector('.ge-hsv-hue-handle');
  const fR = host.querySelector('.ge-hsv-r'), fG = host.querySelector('.ge-hsv-g'), fB = host.querySelector('.ge-hsv-b');
  const fH = host.querySelector('.ge-hsv-h'), fS = host.querySelector('.ge-hsv-s'), fV = host.querySelector('.ge-hsv-bv');
  const fHex = host.querySelector('.ge-hsv-hex');
  let h = 0, s = 0, v = 0, suppress = false;

  // Static hue rainbow — vertical (red at top → red at bottom).
  (() => { for (let y = 0; y < SQ; y++) { hctx.fillStyle = `hsl(${(y / SQ) * 360},100%,50%)`; hctx.fillRect(0, y, HUE_W, 1); } })();

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
  // Percentage-based so handles track the responsively-sized square/bar (the
  // draw buffers are fixed-res but the elements scale to the panel width).
  function placeHandles() {
    svH.style.left = (s * 100) + '%';
    svH.style.top = ((1 - v) * 100) + '%';
    hueH.style.top = ((h / 360) * 100) + '%';
  }
  // Push current h/s/v out to the numeric + hex fields (skips whichever input
  // is focused so live typing isn't clobbered mid-entry).
  function syncFields() {
    const [r, g, b] = hsvToRgb(h, s, v);
    const set = (el, val) => { if (el && document.activeElement !== el) el.value = String(val); };
    set(fR, r); set(fG, g); set(fB, b);
    set(fH, Math.round(h)); set(fS, Math.round(s * 100)); set(fV, Math.round(v * 100));
    set(fHex, hsvToHex(h, s, v));
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
    drawSquare(); placeHandles(); syncFields();
    if (push) emit();
  }

  const rel = (el, e) => { const r = el.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  const clamp = (x) => Math.max(0, Math.min(1, x));
  function dragSquare(e) { const [x, y] = rel(sq, e); setHsv(h, clamp(x), clamp(1 - y), true); }
  function dragHue(e) { const [, y] = rel(hue, e); setHsv(clamp(y) * 360, s, v, true); }

  const bind = (el, fn) => {
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); fn(e); const mv = (ev) => fn(ev); const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); }; el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); });
  };
  bind(sq, dragSquare);
  bind(hue, dragHue);

  // ── Numeric field editing ──────────────────────────────────────────────
  // A partial/blank/invalid entry is ignored (no throw, no state change) so
  // mid-typing never snaps the color; a complete value commits to the fg.
  const intIn = (el) => { const t = el.value.trim(); if (!/^\d{1,3}$/.test(t)) return null; const n = +t; const max = +el.dataset.max; return n < 0 || n > max ? null : n; };
  function applyRgb() {
    const r = intIn(fR), g = intIn(fG), b = intIn(fB);
    if (r == null || g == null || b == null) return;
    setHsv(...rgbToHsv(r, g, b), true);
  }
  function applyHsv() {
    const nh = intIn(fH), ns = intIn(fS), nv = intIn(fV);
    if (nh == null || ns == null || nv == null) return;
    setHsv(nh, ns / 100, nv / 100, true);
  }
  function applyHex() {
    let t = fHex.value.trim(); if (!t.startsWith('#')) t = '#' + t;
    if (!/^#[0-9a-f]{6}$/i.test(t)) return;
    setHsv(...hexToHsv(t), true);
  }
  [fR, fG, fB].forEach((el) => el.addEventListener('input', applyRgb));
  [fH, fS, fV].forEach((el) => el.addEventListener('input', applyHsv));
  fHex.addEventListener('input', applyHex);
  // On blur / Enter, re-sync the field text to the canonical value so a
  // cleared or clamped-out entry snaps back to a valid display.
  const reflowAll = () => syncFields();
  [fR, fG, fB, fH, fS, fV, fHex].forEach((el) => {
    el.addEventListener('blur', reflowAll);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') reflowAll(); });
  });

  function syncFromFg() { if (suppress) return; const [nh, ns, nv] = hexToHsv(fg.value || '#000000'); setHsv(nh, ns, nv, false); }
  fg.addEventListener('input', syncFromFg);
  syncFromFg();
}
