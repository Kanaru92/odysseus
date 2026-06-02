/**
 * Per-dab colour jitter (Color Dynamics) — shifts the brush hue randomly within
 * a range each dab, for natural-media variation (foliage, texture, painterly
 * strokes). Pure colour math (hex → HSL → shift hue → hex), no DOM, so it's
 * unit-testable. Greys (saturation 0) are unaffected — there's no hue to jitter.
 *
 * @param {string} hex     Base colour (#rgb or #rrggbb).
 * @param {number} amount  0..1 — at 1, hue can swing up to ±180°.
 * @param {number} [rnd]   Optional [0,1) sample (defaults to Math.random()).
 * @returns {string} jittered #rrggbb
 */
const hexToRgb = (h) => {
  let s = String(h || '#000000').replace('#', '');
  // Expand 3/4-char shorthand (#rgb / #rgba) to full per-channel hex.
  if (s.length === 3 || s.length === 4) s = s.split('').map((c) => c + c).join('');
  // Only the leading RGB bytes matter; drop any alpha (#rrggbbaa) and reject
  // lengths that can't supply 6 hex digits.
  if (s.length < 6) return [0, 0, 0];
  const n = parseInt(s.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex2 = (v) => ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2);
const rgbToHex = (r, g, b) => '#' + toHex2(r) + toHex2(g) + toHex2(b);

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hslToRgb(h, s, l) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255];
}

export function jitterHue(hex, amount, rnd) {
  if (!(amount > 0)) return hex;
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  const shift = (((rnd == null ? Math.random() : rnd) * 2) - 1) * amount * 0.5; // ±0.5 turn @1
  const nh = ((h + shift) % 1 + 1) % 1;
  const [nr, ng, nb] = hslToRgb(nh, s, l);
  return rgbToHex(nr, ng, nb);
}
