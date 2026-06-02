/**
 * OKhsl ⇄ sRGB — a perceptually-uniform HSL built on the OKLab colorspace, for
 * the "OK Color Picker". Lightness/saturation/hue stay perceptually consistent
 * (equal slider moves = equal perceived change), unlike classic HSV.
 *
 * Faithful port of Björn Ottosson's public-domain reference
 * (bottosson.github.io/posts/colorpicker, bottosson.github.io/posts/gamutclipping).
 * Pure math — no app/state deps. h in [0,360), s/l in [0,1]; sRGB in [0,1].
 */

const srgbFromLinear = (a) => (a <= 0.0031308 ? 12.92 * a : 1.055 * Math.pow(a, 1 / 2.4) - 0.055);
const linearFromSrgb = (a) => (a >= 0.04045 ? Math.pow((a + 0.055) / 1.055, 2.4) : a / 12.92);

function linearSrgbToOklab(r, g, b) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ];
}
function oklabToLinearSrgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

// Max chroma for a given hue direction (a_,b_ = unit) that stays in sRGB gamut.
function computeMaxSaturation(a, b) {
  let k0, k1, k2, k3, k4, wl, wm, ws;
  if (-1.88170328 * a - 0.80936493 * b > 1) {
    k0 = 1.19086277; k1 = 1.76576728; k2 = 0.59662641; k3 = 0.75515197; k4 = 0.56771245;
    wl = 4.0767416621; wm = -3.3077115913; ws = 0.2309699292;
  } else if (1.81444104 * a - 1.19445276 * b > 1) {
    k0 = 0.73956515; k1 = -0.45954404; k2 = 0.08285427; k3 = 0.12541070; k4 = 0.14503204;
    wl = -1.2684380046; wm = 2.6097574011; ws = -0.3413193965;
  } else {
    k0 = 1.35733652; k1 = -0.00915799; k2 = -1.15130210; k3 = -0.50559606; k4 = 0.00692167;
    wl = -0.0041960863; wm = -0.7034186147; ws = 1.7076147010;
  }
  let S = k0 + k1 * a + k2 * b + k3 * a * a + k4 * a * b;
  const kl = 0.3963377774 * a + 0.2158037573 * b;
  const km = -0.1055613458 * a - 0.0638541728 * b;
  const ks = -0.0894841775 * a - 1.2914855480 * b;
  {
    const l_ = 1 + S * kl, m_ = 1 + S * km, s_ = 1 + S * ks;
    const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    const ld = 3 * kl * l_ * l_, md = 3 * km * m_ * m_, sd = 3 * ks * s_ * s_;
    const ld2 = 6 * kl * kl * l_, md2 = 6 * km * km * m_, sd2 = 6 * ks * ks * s_;
    const f = wl * l + wm * m + ws * s;
    const f1 = wl * ld + wm * md + ws * sd;
    const f2 = wl * ld2 + wm * md2 + ws * sd2;
    S = S - f * f1 / (f1 * f1 - 0.5 * f * f2);
  }
  return S;
}

// L,C of the gamut "cusp" (most saturated point) for a hue.
function findCusp(a, b) {
  const sCusp = computeMaxSaturation(a, b);
  const rgb = oklabToLinearSrgb(1, sCusp * a, sCusp * b);
  const lCusp = Math.cbrt(1 / Math.max(rgb[0], rgb[1], rgb[2]));
  return [lCusp, lCusp * sCusp];
}

// t in [0,1] along the line from (L0,0) to (L1,C1) where it leaves the gamut.
function findGamutIntersection(a, b, L1, C1, L0, cusp) {
  const [cuspL, cuspC] = cusp;
  let t;
  if ((L1 - L0) * cuspC - (cuspL - L0) * C1 <= 0) {
    t = cuspC * L0 / (C1 * cuspL + cuspC * (L0 - L1));
  } else {
    t = cuspC * (L0 - 1) / (C1 * (cuspL - 1) + cuspC * (L0 - L1));
    {
      const dL = L1 - L0, dC = C1;
      const kl = 0.3963377774 * a + 0.2158037573 * b;
      const km = -0.1055613458 * a - 0.0638541728 * b;
      const ks = -0.0894841775 * a - 1.2914855480 * b;
      const ldt = dL + dC * kl, mdt = dL + dC * km, sdt = dL + dC * ks;
      const L = L0 * (1 - t) + t * L1, C = t * C1;
      const l_ = L + C * kl, m_ = L + C * km, s_ = L + C * ks;
      const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
      const ldt2 = 3 * ldt * l_ * l_, mdt2 = 3 * mdt * m_ * m_, sdt2 = 3 * sdt * s_ * s_;
      const ldt3 = 6 * ldt * ldt * l_, mdt3 = 6 * mdt * mdt * m_, sdt3 = 6 * sdt * sdt * s_;
      const terms = [
        [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s - 1, 4.0767416621 * ldt2 - 3.3077115913 * mdt2 + 0.2309699292 * sdt2, 4.0767416621 * ldt3 - 3.3077115913 * mdt3 + 0.2309699292 * sdt3],
        [-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s - 1, -1.2684380046 * ldt2 + 2.6097574011 * mdt2 - 0.3413193965 * sdt2, -1.2684380046 * ldt3 + 2.6097574011 * mdt3 - 0.3413193965 * sdt3],
        [-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s - 1, -0.0041960863 * ldt2 - 0.7034186147 * mdt2 + 1.7076147010 * sdt2, -0.0041960863 * ldt3 - 0.7034186147 * mdt3 + 1.7076147010 * sdt3],
      ];
      let uMin = Infinity, tMin = t;
      for (const [f, f1, f2] of terms) {
        const u = -f1 / (f1 * f1 - 0.5 * f * f2);
        if (u >= 0) { const tr = -f * u; if (tr < tMin && u < uMin) { /* pick smallest positive */ } }
      }
      // Newton step (single, matches reference precision needs here).
      for (const [f, f1, f2] of terms) {
        const u = -f1 / (f1 * f1 - 0.5 * f * f2);
        if (u >= 0) { const tr = -f * u; if (tr < tMin) tMin = tr; }
      }
      t += Math.min(0, tMin);
      void uMin;
    }
  }
  return t;
}

const toe = (x) => { const k1 = 0.206, k2 = 0.03, k3 = (1 + k1) / (1 + k2); return 0.5 * (k3 * x - k1 + Math.sqrt((k3 * x - k1) * (k3 * x - k1) + 4 * k2 * k3 * x)); };
const toeInv = (x) => { const k1 = 0.206, k2 = 0.03, k3 = (1 + k1) / (1 + k2); return (x * x + k1 * x) / (k3 * (x + k2)); };

function toST(cusp) { const [L, C] = cusp; return [C / L, C / (1 - L)]; }

function getCs(L, a_, b_) {
  const cusp = findCusp(a_, b_);
  const cMax = findGamutIntersection(a_, b_, L, 1, L, cusp);
  const [sMax, tMax] = toST(cusp);
  const k = cMax / Math.min(L * sMax, (1 - L) * tMax);
  let cMid;
  {
    const aMid = -0.4998739472 * a_ + 0.8662844763 * b_; // unused but mirrors ref groupings
    void aMid;
    const sMid = 0.11516993 + 1 / (7.44778970 + 4.15901240 * b_ + a_ * (-2.19557347 + 1.75198401 * b_ + a_ * (-2.13704948 - 10.02301043 * b_ + a_ * (-4.24894561 + 5.38770819 * b_ + 4.69891013 * a_))));
    const tMid = 0.11239642 + 1 / (1.61320320 - 0.68124379 * b_ + a_ * (0.40370612 + 0.90148123 * b_ + a_ * (-0.27087943 + 0.61223990 * b_ + a_ * (0.00299215 - 0.45399568 * b_ - 0.14661872 * a_))));
    const ca = L * sMid, cb = (1 - L) * tMid;
    cMid = 0.9 * k * Math.sqrt(Math.sqrt(1 / (1 / (ca * ca * ca * ca) + 1 / (cb * cb * cb * cb))));
  }
  let cZero;
  {
    const ca = L * 0.4, cb = (1 - L) * 0.8;
    cZero = Math.sqrt(1 / (1 / (ca * ca) + 1 / (cb * cb)));
  }
  return [cZero, cMid, cMax];
}

/** OKhsl (h°, s, l) → sRGB [0..1] triplet. */
export function okhslToSrgb(h, s, l) {
  if (l >= 1) return [1, 1, 1];
  if (l <= 0) return [0, 0, 0];
  const hr = h / 360 * 2 * Math.PI;
  const a_ = Math.cos(hr), b_ = Math.sin(hr);
  const L = toeInv(l);
  const [c0, cMid, cMax] = getCs(L, a_, b_);
  let C;
  const mid = 0.8, midInv = 1.25;
  if (s < mid) {
    const t = midInv * s;
    const k1 = mid * c0, k2 = 1 - k1 / cMid;
    C = t * k1 / (1 - k2 * t);
  } else {
    const t = 5 * (s - mid);
    const k0 = cMid, k1 = (1 - mid) * cMid * cMid * midInv * midInv / c0, k2 = 1 - k1 / (cMax - cMid);
    C = k0 + t * k1 / (1 - k2 * t);
  }
  const rgb = oklabToLinearSrgb(L, C * a_, C * b_);
  return [srgbFromLinear(rgb[0]), srgbFromLinear(rgb[1]), srgbFromLinear(rgb[2])];
}

/** sRGB [0..1] → OKhsl {h°, s, l}. */
export function srgbToOkhsl(r, g, b) {
  const lab = linearSrgbToOklab(linearFromSrgb(r), linearFromSrgb(g), linearFromSrgb(b));
  const [L, A, B] = lab;
  const C = Math.sqrt(A * A + B * B);
  const a_ = C ? A / C : 1, b_ = C ? B / C : 0;
  let h = 0.5 + 0.5 * Math.atan2(-B, -A) / Math.PI; // 0..1
  const [c0, cMid, cMax] = getCs(L, a_, b_);
  const mid = 0.8, midInv = 1.25;
  let s;
  if (C < cMid) {
    const k1 = mid * c0, k2 = 1 - k1 / cMid;
    const t = C / (k1 + k2 * C);
    s = t * mid;
  } else {
    const k0 = cMid, k1 = (1 - mid) * cMid * cMid * midInv * midInv / c0, k2 = 1 - k1 / (cMax - cMid);
    const t = (C - k0) / (k1 + k2 * (C - k0));
    s = mid + 0.2 * t;
  }
  const l = toe(L);
  return { h: (h * 360 + 360) % 360, s: Math.max(0, Math.min(1, s)), l: Math.max(0, Math.min(1, l)) };
}

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
const hx = (n) => n.toString(16).padStart(2, '0');

/** OKhsl → "#rrggbb". */
export function okhslToHex(h, s, l) {
  const [r, g, b] = okhslToSrgb(h, s, l);
  return '#' + hx(clamp255(r)) + hx(clamp255(g)) + hx(clamp255(b));
}

/** "#rrggbb" → {h,s,l} (OKhsl). */
export function hexToOkhsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return { h: 0, s: 0, l: 0 };
  const n = parseInt(m[1], 16);
  return srgbToOkhsl(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
