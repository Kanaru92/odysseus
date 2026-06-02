/**
 * Pixel filter library — pure functions over an ImageData-like
 * `{ data: Uint8ClampedArray, width, height }`. Standard, textbook algorithms
 * implemented from scratch (no copied code). The filter set is a standard
 * complement (blur, sharpen, levels, etc.); see internal parity notes.
 *
 * `applyFilter(img, type, amount)` mutates `img.data` in place. `amount` is the
 * UI slider 0..100 (default 50 = neutral for bidirectional filters).
 */
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

export const FILTERS = [
  { id: 'grayscale', name: 'Grayscale', amount: false },
  { id: 'invert', name: 'Invert', amount: false },
  { id: 'sepia', name: 'Sepia', amount: false },
  { id: 'brightness', name: 'Brightness', amount: true, bidir: true },
  { id: 'contrast', name: 'Contrast', amount: true, bidir: true },
  { id: 'saturation', name: 'Saturation', amount: true, bidir: true },
  { id: 'vibrance', name: 'Vibrance', amount: true },
  { id: 'blur', name: 'Box Blur', amount: true },
  { id: 'gaussian', name: 'Gaussian Blur', amount: true },
  { id: 'vignette', name: 'Vignette', amount: true },
  { id: 'sharpen', name: 'Sharpen', amount: true },
  { id: 'noise', name: 'Add Noise', amount: true },
  { id: 'posterize', name: 'Posterize', amount: true },
  { id: 'threshold', name: 'Threshold', amount: true },
  { id: 'gradient-map', name: 'Gradient Map (BG→FG)', amount: false },
  { id: 'motion-blur', name: 'Motion Blur', amount: true },
  { id: 'high-pass', name: 'High Pass', amount: true },
  { id: 'emboss', name: 'Emboss', amount: false },
  { id: 'find-edges', name: 'Find Edges', amount: false },
];

function hexToRgb(h) {
  let s = String(h || '#000000').replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// Remap luminance through a two-colour ramp: shadows → `shadow`, highlights →
// `highlight` (duotone / colour grade). Colours come from the editor BG/FG.
function gradientMap(d, opts) {
  const sh = hexToRgb(opts && opts.shadow);
  const hi = hexToRgb((opts && opts.highlight) || '#ffffff');
  for (let i = 0; i < d.length; i += 4) {
    const l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
    d[i] = clamp(sh[0] + (hi[0] - sh[0]) * l);
    d[i + 1] = clamp(sh[1] + (hi[1] - sh[1]) * l);
    d[i + 2] = clamp(sh[2] + (hi[2] - sh[2]) * l);
  }
}

function grayscale(d) {
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = g;
  }
}
function invert(d) {
  for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; }
}
function sepia(d) {
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    d[i] = clamp(0.393 * r + 0.769 * g + 0.189 * b);
    d[i + 1] = clamp(0.349 * r + 0.686 * g + 0.168 * b);
    d[i + 2] = clamp(0.272 * r + 0.534 * g + 0.131 * b);
  }
}
function brightness(d, amt) { // amt -100..100
  const a = amt * 2.55;
  for (let i = 0; i < d.length; i += 4) { d[i] = clamp(d[i] + a); d[i + 1] = clamp(d[i + 1] + a); d[i + 2] = clamp(d[i + 2] + a); }
}
function contrast(d, amt) { // amt -100..100
  const c = amt / 100 + 1, k = 128 * (1 - c);
  for (let i = 0; i < d.length; i += 4) { d[i] = clamp(d[i] * c + k); d[i + 1] = clamp(d[i + 1] * c + k); d[i + 2] = clamp(d[i + 2] * c + k); }
}
function saturation(d, amt) { // amt -100..100 → factor (1 + amt/100)
  const f = 1 + amt / 100;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    d[i] = clamp(gray + (r - gray) * f); d[i + 1] = clamp(gray + (g - gray) * f); d[i + 2] = clamp(gray + (b - gray) * f);
  }
}
function vibrance(d, amt) { // amt 0..100 → boost weighted toward less-saturated pixels
  const a = amt / 100;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const boost = a * (1 - (mx - mn) / 255);
    const gray = 0.299 * r + 0.587 * g + 0.114 * b, f = 1 + boost;
    d[i] = clamp(gray + (r - gray) * f); d[i + 1] = clamp(gray + (g - gray) * f); d[i + 2] = clamp(gray + (b - gray) * f);
  }
}
// Separable box blur over RGBA (alpha blurred too). radius in pixels.
function boxBlur(d, w, h, radius) {
  if (radius < 1) return;
  const tmp = new Uint8ClampedArray(d.length);
  const pass = (src, dst, w, h, r) => {
    for (let y = 0; y < h; y++) {
      const row = y * w * 4;
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let x = -r; x <= r; x++) { const xi = Math.max(0, Math.min(w - 1, x)); sum += src[row + xi * 4 + c]; }
        const win = 2 * r + 1;
        for (let x = 0; x < w; x++) {
          dst[row + x * 4 + c] = sum / win;
          const xOut = Math.max(0, Math.min(w - 1, x - r));
          const xIn = Math.max(0, Math.min(w - 1, x + r + 1));
          sum += src[row + xIn * 4 + c] - src[row + xOut * 4 + c];
        }
      }
    }
  };
  // horizontal (d→tmp), then vertical by transposed indexing (tmp→d)
  pass(d, tmp, w, h, radius);
  // vertical pass: walk columns
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) { const yi = Math.max(0, Math.min(h - 1, y)); sum += tmp[(yi * w + x) * 4 + c]; }
      const win = 2 * radius + 1;
      for (let y = 0; y < h; y++) {
        d[(y * w + x) * 4 + c] = sum / win;
        const yOut = Math.max(0, Math.min(h - 1, y - radius));
        const yIn = Math.max(0, Math.min(h - 1, y + radius + 1));
        sum += tmp[(yIn * w + x) * 4 + c] - tmp[(yOut * w + x) * 4 + c];
      }
    }
  }
}
function vignette(d, w, h, strength) { // strength 0..1
  const cx = w / 2, cy = h / 2, maxD = Math.hypot(cx, cy);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dn = Math.hypot(x - cx, y - cy) / maxD;
      const f = 1 - strength * dn * dn;
      const i = (y * w + x) * 4;
      d[i] = clamp(d[i] * f); d[i + 1] = clamp(d[i + 1] * f); d[i + 2] = clamp(d[i + 2] * f);
    }
  }
}

// Unsharp mask: subtract a blurred copy to boost local contrast. amt 0..100 →
// strength 0..2 (50 = neutral-ish moderate sharpen).
function sharpen(d, w, h, amt) {
  const k = amt / 50;
  if (k <= 0) return;
  const blur = d.slice();
  boxBlur(blur, w, h, 2);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = clamp(d[i] + k * (d[i] - blur[i]));
    d[i + 1] = clamp(d[i + 1] + k * (d[i + 1] - blur[i + 1]));
    d[i + 2] = clamp(d[i + 2] + k * (d[i + 2] - blur[i + 2]));
  }
}
// Monochromatic additive noise. amt 0..100 → ± range.
function noise(d, amt) {
  const range = (amt / 100) * 120;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 2 * range;
    d[i] = clamp(d[i] + n); d[i + 1] = clamp(d[i + 1] + n); d[i + 2] = clamp(d[i + 2] + n);
  }
}
// Posterize: quantise each channel to N levels. Higher amt = stronger (fewer levels).
function posterize(d, amt) {
  const levels = Math.max(2, Math.round(34 - (amt / 100) * 32));
  const step = 255 / (levels - 1);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = clamp(Math.round(d[i] / step) * step);
    d[i + 1] = clamp(Math.round(d[i + 1] / step) * step);
    d[i + 2] = clamp(Math.round(d[i + 2] / step) * step);
  }
}
// Threshold: luma below the cut → black, at/above → white. amt 0..100 → cut 0..255.
function threshold(d, amt) {
  const t = amt * 2.55;
  for (let i = 0; i < d.length; i += 4) {
    const luma = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = luma >= t ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
}

// Horizontal motion blur — average a run of pixels along X (amt → length).
function motionBlur(d, w, h, amt) {
  const len = Math.max(1, Math.round((amt / 100) * 30));
  const src = d.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let k = -len; k <= len; k++) {
        let xx = x + k; if (xx < 0) xx = 0; else if (xx >= w) xx = w - 1;
        const j = (y * w + xx) * 4; r += src[j]; g += src[j + 1]; b += src[j + 2]; a += src[j + 3]; n++;
      }
      const i = (y * w + x) * 4; d[i] = r / n; d[i + 1] = g / n; d[i + 2] = b / n; d[i + 3] = a / n;
    }
  }
}
// Emboss — 3×3 directional gradient kernel, biased to mid-grey.
function emboss(d, w, h) {
  const src = d.slice();
  const K = [-2, -1, 0, -1, 0, 1, 0, 1, 2]; // sum 0 → flat areas flatten to mid-grey relief
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, ki = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          let xx = x + dx, yy = y + dy;
          if (xx < 0) xx = 0; else if (xx >= w) xx = w - 1;
          if (yy < 0) yy = 0; else if (yy >= h) yy = h - 1;
          const j = (yy * w + xx) * 4; const wt = K[ki++];
          r += src[j] * wt; g += src[j + 1] * wt; b += src[j + 2] * wt;
        }
      }
      const i = (y * w + x) * 4; d[i] = clamp(r + 128); d[i + 1] = clamp(g + 128); d[i + 2] = clamp(b + 128);
    }
  }
}
// Find Edges — Sobel gradient magnitude of luma; flat = white, edges = dark.
function findEdges(d, w, h) {
  const src = d.slice();
  const lum = (x, y) => { let xx = x, yy = y; if (xx < 0) xx = 0; else if (xx >= w) xx = w - 1; if (yy < 0) yy = 0; else if (yy >= h) yy = h - 1; const j = (yy * w + xx) * 4; return 0.299 * src[j] + 0.587 * src[j + 1] + 0.114 * src[j + 2]; };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = (lum(x + 1, y - 1) + 2 * lum(x + 1, y) + lum(x + 1, y + 1)) - (lum(x - 1, y - 1) + 2 * lum(x - 1, y) + lum(x - 1, y + 1));
      const gy = (lum(x - 1, y + 1) + 2 * lum(x, y + 1) + lum(x + 1, y + 1)) - (lum(x - 1, y - 1) + 2 * lum(x, y - 1) + lum(x + 1, y - 1));
      const v = clamp(255 - Math.sqrt(gx * gx + gy * gy));
      const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
}
// High Pass — keep only fine detail (original − blur, biased to grey). amt → radius.
function highPass(d, w, h, amt) {
  const radius = Math.max(1, Math.round((amt / 100) * 10));
  const blur = d.slice();
  boxBlur(blur, w, h, radius);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = clamp(128 + d[i] - blur[i]);
    d[i + 1] = clamp(128 + d[i + 1] - blur[i + 1]);
    d[i + 2] = clamp(128 + d[i + 2] - blur[i + 2]);
  }
}

export function applyFilter(img, type, amount = 50, opts) {
  const d = img.data, w = img.width, h = img.height;
  const bidir = (amount - 50) * 2; // 0..100 → -100..100 (50 = neutral)
  switch (type) {
    case 'grayscale': grayscale(d); break;
    case 'invert': invert(d); break;
    case 'sepia': sepia(d); break;
    case 'brightness': brightness(d, bidir); break;
    case 'contrast': contrast(d, bidir); break;
    case 'saturation': saturation(d, bidir); break;
    case 'vibrance': vibrance(d, amount); break;
    case 'blur': boxBlur(d, w, h, Math.max(1, Math.round(amount / 8))); break;
    case 'gaussian': for (let k = 0; k < 3; k++) boxBlur(d, w, h, Math.max(1, Math.round(amount / 12))); break;
    case 'vignette': vignette(d, w, h, amount / 100); break;
    case 'sharpen': sharpen(d, w, h, amount); break;
    case 'noise': noise(d, amount); break;
    case 'posterize': posterize(d, amount); break;
    case 'threshold': threshold(d, amount); break;
    case 'gradient-map': gradientMap(d, opts); break;
    case 'motion-blur': motionBlur(d, w, h, amount); break;
    case 'high-pass': highPass(d, w, h, amount); break;
    case 'emboss': emboss(d, w, h); break;
    case 'find-edges': findEdges(d, w, h); break;
  }
  return img;
}
