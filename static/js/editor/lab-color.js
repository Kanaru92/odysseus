/**
 * CIELAB (L*a*b*) ⇄ sRGB — the industry-standard perceptual color space, for the
 * "Lab" tab of the color picker. L* tracks perceived lightness; a* runs
 * green→red and b* runs blue→yellow, so equal numeric moves read as roughly
 * equal perceived changes (far more uniform than RGB/HSV).
 *
 * Pipeline: sRGB companding (gamma) → linear RGB → CIE XYZ (D65) → CIELAB, with
 * the exact inverse. Pure math — no DOM, no module state. Inputs r,g,b in
 * [0..255]; outputs L in [0..100], a/b roughly in [-128..127].
 *
 * Self-check (round to ~1 decimal):
 *   rgbToLab(255,255,255) -> { L: 100,  a: 0,    b: 0    }  (reference white)
 *   rgbToLab(0,0,0)       -> { L: 0,    a: 0,    b: 0    }
 *   rgbToLab(128,128,128) -> { L: ~53.6, a: 0,   b: 0    }  (gray stays neutral)
 *   rgbToLab(255,0,0)     -> { L: ~53.2, a: ~80.1, b: ~67.2 }
 *   labToRgb(rgbToLab(r,g,b)) round-trips back to the source RGB (±1).
 */

// D65 reference white (2° observer), the sRGB standard illuminant, scaled so Y=1.
const Xn = 0.95047;
const Yn = 1.0;
const Zn = 1.08883;

// CIELAB transfer constants (CIE definition): (6/29)^3 and the linear-segment terms.
const EPSILON = 216 / 24389; // ~0.008856 — (6/29)^3
const KAPPA = 24389 / 27; // ~903.3 — the linear-region slope factor

/** sRGB gamma decode: one nonlinear channel [0..1] → linear-light [0..1]. */
const linearFromSrgb = (a) => (a > 0.04045 ? Math.pow((a + 0.055) / 1.055, 2.4) : a / 12.92);
/** sRGB gamma encode: one linear-light channel [0..1] → nonlinear [0..1]. */
const srgbFromLinear = (a) => (a > 0.0031308 ? 1.055 * Math.pow(a, 1 / 2.4) - 0.055 : 12.92 * a);

// CIELAB nonlinearity and its inverse, operating on XYZ ratios (X/Xn etc.).
const labF = (t) => (t > EPSILON ? Math.cbrt(t) : (KAPPA * t + 16) / 116);
const labFInv = (t) => { const t3 = t * t * t; return t3 > EPSILON ? t3 : (116 * t - 16) / KAPPA; };

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp255 = (v) => clamp(Math.round(v * 255), 0, 255);
const hx = (n) => n.toString(16).padStart(2, '0');

/**
 * sRGB → CIELAB.
 * @param {number} r red, 0..255
 * @param {number} g green, 0..255
 * @param {number} b blue, 0..255
 * @returns {{L:number, a:number, b:number}} L 0..100, a/b roughly -128..127
 */
export function rgbToLab(r, g, b) {
  // Companding: normalize and remove the sRGB gamma to get linear-light RGB.
  const rl = linearFromSrgb(clamp(r, 0, 255) / 255);
  const gl = linearFromSrgb(clamp(g, 0, 255) / 255);
  const bl = linearFromSrgb(clamp(b, 0, 255) / 255);

  // Linear sRGB → CIE XYZ (D65), then normalize against the reference white.
  const x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / Xn;
  const y = (0.2126729 * rl + 0.7151522 * gl + 0.0721750 * bl) / Yn;
  const z = (0.0193339 * rl + 0.1191920 * gl + 0.9503041 * bl) / Zn;

  const fx = labF(x), fy = labF(y), fz = labF(z);
  return {
    L: clamp(116 * fy - 16, 0, 100),
    a: clamp(500 * (fx - fy), -128, 127),
    b: clamp(200 * (fy - fz), -128, 127),
  };
}

/**
 * CIELAB → sRGB (exact inverse of {@link rgbToLab}; out-of-gamut values clamp).
 * @param {number} L lightness, 0..100
 * @param {number} a green→red axis, roughly -128..127
 * @param {number} b blue→yellow axis, roughly -128..127
 * @returns {{r:number, g:number, b:number}} r,g,b 0..255 (integers)
 */
export function labToRgb(L, a, b) {
  const fy = (clamp(L, 0, 100) + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;

  // CIELAB → XYZ (re-applying the reference white), then XYZ → linear sRGB.
  const x = labFInv(fx) * Xn;
  const y = labFInv(fy) * Yn;
  const z = labFInv(fz) * Zn;

  const rl = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const gl = -0.9692660 * x + 1.8760108 * y + 0.0415560 * z;
  const bl = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;

  // Re-apply the sRGB gamma, then clamp to the displayable 8-bit range.
  return {
    r: clamp255(srgbFromLinear(rl)),
    g: clamp255(srgbFromLinear(gl)),
    b: clamp255(srgbFromLinear(bl)),
  };
}

/** "#rrggbb" (or "#rgb") → {L,a,b}. Invalid input falls back to black. */
export function hexToLab(hex) {
  let m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) {
    const s = /^#?([0-9a-f]{3})$/i.exec(String(hex).trim());
    if (!s) return { L: 0, a: 0, b: 0 };
    const c = s[1];
    m = [null, c[0] + c[0] + c[1] + c[1] + c[2] + c[2]];
  }
  const n = parseInt(m[1], 16);
  return rgbToLab((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

/** {L,a,b} → "#rrggbb". */
export function labToHex(L, a, b) {
  const c = labToRgb(L, a, b);
  return '#' + hx(c.r) + hx(c.g) + hx(c.b);
}
