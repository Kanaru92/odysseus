/**
 * Layer/brush blend modes — the full standard professional set.
 *
 * Most are natively supported by the canvas 2D `globalCompositeOperation`
 * (fast, GPU-backed). The rest (`custom: true`) have no canvas equivalent and
 * are composited per-pixel by `blendInto()` below. `id` is either a valid
 * globalCompositeOperation value (native) or our own token (custom); `name` is
 * the display label. Order follows the conventional grouping (darken / lighten
 * / contrast / inversion / component) so the dropdown reads familiarly.
 *
 * The per-pixel path assumes an OPAQUE backdrop (the composite always paints a
 * checkerboard base first), which reduces the Porter-Duff source-over-with-
 * blend to `out = a·B(b,s) + (1−a)·b` per channel, where `a` = source alpha ×
 * layer opacity. This matches what the native modes already do against the
 * same backdrop, so native and custom layers stay visually consistent.
 */
export const BLEND_MODES = [
  { id: 'source-over', name: 'Normal' },
  { id: 'dissolve', name: 'Dissolve', custom: true },
  // — Darken —
  { id: 'darken', name: 'Darken' },
  { id: 'multiply', name: 'Multiply' },
  { id: 'color-burn', name: 'Color Burn' },
  { id: 'linear-burn', name: 'Linear Burn', custom: true },
  { id: 'darker-color', name: 'Darker Color', custom: true },
  // — Lighten —
  { id: 'lighten', name: 'Lighten' },
  { id: 'screen', name: 'Screen' },
  { id: 'color-dodge', name: 'Color Dodge' },
  { id: 'linear-dodge', name: 'Linear Dodge (Add)', custom: true },
  { id: 'lighter-color', name: 'Lighter Color', custom: true },
  // — Contrast —
  { id: 'overlay', name: 'Overlay' },
  { id: 'soft-light', name: 'Soft Light' },
  { id: 'hard-light', name: 'Hard Light' },
  { id: 'vivid-light', name: 'Vivid Light', custom: true },
  { id: 'linear-light', name: 'Linear Light', custom: true },
  { id: 'pin-light', name: 'Pin Light', custom: true },
  { id: 'hard-mix', name: 'Hard Mix', custom: true },
  // — Inversion —
  { id: 'difference', name: 'Difference' },
  { id: 'exclusion', name: 'Exclusion' },
  { id: 'subtract', name: 'Subtract', custom: true },
  { id: 'divide', name: 'Divide', custom: true },
  // — Component —
  { id: 'hue', name: 'Hue' },
  { id: 'saturation', name: 'Saturation' },
  { id: 'color', name: 'Color' },
  { id: 'luminosity', name: 'Luminosity' },
];

export const DEFAULT_BLEND = 'source-over';

const CUSTOM_BLEND_IDS = new Set(BLEND_MODES.filter((m) => m.custom).map((m) => m.id));

/** True if `id` needs the per-pixel path (no canvas globalCompositeOperation). */
export function isCustomBlend(id) {
  return CUSTOM_BLEND_IDS.has(id);
}

// Channel blend helpers — all operate on normalized [0,1] values.
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const cbDodge = (b, s) => (s >= 1 ? 1 : Math.min(1, b / (1 - s)));
const cbBurn = (b, s) => (s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s));

/** Separable per-channel blend `B(b, s)` for the custom modes. */
function sep(mode, b, s) {
  switch (mode) {
    case 'linear-burn':  return clamp01(b + s - 1);
    case 'linear-dodge': return clamp01(b + s);
    case 'subtract':     return Math.max(0, b - s);
    case 'divide':       return s <= 0 ? 1 : Math.min(1, b / s);
    case 'linear-light': return clamp01(b + 2 * s - 1);
    case 'vivid-light':  return s <= 0.5 ? cbBurn(b, 2 * s) : cbDodge(b, 2 * (s - 0.5));
    case 'pin-light':    return s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1);
    case 'hard-mix': {
      const vl = s <= 0.5 ? cbBurn(b, 2 * s) : cbDodge(b, 2 * (s - 0.5));
      return vl < 0.5 ? 0 : 1;
    }
  }
  return s;
}

/**
 * Composite `src` over `back` (both RGBA Uint8ClampedArray, same length) using
 * a custom blend `mode`, mutating `back` into the result. `opacity` 0..1 scales
 * the source alpha. Backdrop is assumed opaque (αb = 1); output stays opaque.
 *
 * Darker/Lighter Color are non-separable (whole-pixel luminance compare); the
 * rest are separable per channel.
 */
// Stable per-pixel pseudo-random in [0,1) from a pixel index — gives Dissolve a
// FIXED dither pattern (depends only on position), so it doesn't shimmer when
// the canvas recomposites on every brush dab (true Math.random would).
function hash01(n) {
  n = (n ^ 61) ^ (n >>> 16);
  n = (n + (n << 3)) | 0;
  n = n ^ (n >>> 4);
  n = Math.imul(n, 0x27d4eb2d);
  n = n ^ (n >>> 15);
  return (n >>> 0) / 4294967295;
}

export function blendInto(mode, back, src, opacity = 1) {
  // Dissolve — stochastic, not a colour blend: draw each source pixel FULLY with
  // probability = its effective alpha, using a stable dither so it's flicker-free.
  if (mode === 'dissolve') {
    for (let i = 0; i < src.length; i += 4) {
      const a = (src[i + 3] / 255) * opacity;
      if (a <= 0) continue;
      if (hash01(i >> 2) < a) {
        back[i] = src[i]; back[i + 1] = src[i + 1]; back[i + 2] = src[i + 2]; back[i + 3] = 255;
      }
    }
    return back;
  }
  const lum = mode === 'darker-color' || mode === 'lighter-color';
  for (let i = 0; i < src.length; i += 4) {
    const as = (src[i + 3] / 255) * opacity; // source alpha
    if (as <= 0) continue; // fully transparent source → backdrop unchanged
    const ab = back[i + 3] / 255;            // backdrop alpha
    const br = back[i] / 255, bg = back[i + 1] / 255, bb = back[i + 2] / 255;
    const sr = src[i] / 255, sg = src[i + 1] / 255, sb = src[i + 2] / 255;
    let Br, Bg, Bb; // per-channel blend B(b, s)
    if (lum) {
      const lb = 0.299 * br + 0.587 * bg + 0.114 * bb;
      const ls = 0.299 * sr + 0.587 * sg + 0.114 * sb;
      const pick = mode === 'darker-color' ? ls < lb : ls > lb;
      Br = pick ? sr : br; Bg = pick ? sg : bg; Bb = pick ? sb : bb;
    } else {
      Br = sep(mode, br, sr); Bg = sep(mode, bg, sg); Bb = sep(mode, bb, sb);
    }
    // W3C compositing + blending (source-over), STRAIGHT alpha — matches the GLSL
    // compositor exactly. Over an opaque backdrop (ab=1) this equals the old
    // a·B+(1−a)·b; over a transparent backdrop it yields the correct source
    // instead of forcing opaque black.
    const ao = as + ab * (1 - as);
    if (ao <= 0) { back[i] = back[i + 1] = back[i + 2] = back[i + 3] = 0; continue; }
    const Csr = (1 - ab) * sr + ab * Br;
    const Csg = (1 - ab) * sg + ab * Bg;
    const Csbl = (1 - ab) * sb + ab * Bb;
    back[i]     = Math.round(((as * Csr + ab * (1 - as) * br) / ao) * 255);
    back[i + 1] = Math.round(((as * Csg + ab * (1 - as) * bg) / ao) * 255);
    back[i + 2] = Math.round(((as * Csbl + ab * (1 - as) * bb) / ao) * 255);
    back[i + 3] = Math.round(ao * 255);
  }
  return back;
}
