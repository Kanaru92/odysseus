/**
 * Pure helpers + constants for layers and adjustment sub-layers.
 *
 * Everything in this module is stateless — feed in a layer object and
 * get back a value. The legacy gallery editor's module-level helpers
 * re-export from here so existing call sites keep working unchanged.
 */

/** True if the layer has at least one FX/adjustment sub-layer. */
export function layerHasAdjustments(layer) {
  return !!(layer && layer.adjLayers && layer.adjLayers.length > 0);
}


/**
 * True if the layer carries a non-identity Levels OR Color-Balance
 * adjustment that needs the per-pixel pass (vs the cheap CSS-filter
 * path for plain B/C/H/S).
 */
export function layerNeedsPixelPass(layer) {
  if (!layer || !layer.adjustments) return false;
  const a = layer.adjustments;
  if (a.levels && (a.levels.inBlack !== 0 || a.levels.inWhite !== 255 ||
                   a.levels.gamma !== 1 ||
                   a.levels.outBlack !== 0 || a.levels.outWhite !== 255)) return true;
  if (a.colorBalance) {
    for (const tone of ['shadows', 'midtones', 'highlights']) {
      const v = a.colorBalance[tone];
      if (v && (v.r || v.g || v.b)) return true;
    }
  }
  return false;
}


/**
 * Compact hash of a layer's Levels + Color-Balance values. Used to
 * key the per-pixel adjustment cache so we can skip recomputing when
 * nothing changed.
 */
export function adjustmentsKey(adj) {
  const l = adj.levels || {};
  const cb = adj.colorBalance || {};
  const s = cb.shadows || {}, m = cb.midtones || {}, h = cb.highlights || {};
  return [
    l.inBlack|0, l.inWhite|0, l.gamma || 1, l.outBlack|0, l.outWhite|0,
    s.r|0, s.g|0, s.b|0, m.r|0, m.g|0, m.b|0, h.r|0, h.g|0, h.b|0,
  ].join('|');
}


/** Identity params for each adjustment type. */
export function defaultAdjParams(type) {
  switch (type) {
    case 'brightness-contrast': return { brightness: 1, contrast: 1 };
    case 'hue-saturation':      return { hue: 0, saturation: 1 };
    case 'levels':              return { inBlack: 0, inWhite: 255, gamma: 1.0, outBlack: 0, outWhite: 255 };
    case 'curves':              return {
      channel: 'rgb',
      rgb: [[0, 0], [255, 255]],
      r:   [[0, 0], [255, 255]],
      g:   [[0, 0], [255, 255]],
      b:   [[0, 0], [255, 255]],
    };
    case 'color-balance':       return {
      shadows:    { r: 0, g: 0, b: 0 },
      midtones:   { r: 0, g: 0, b: 0 },
      highlights: { r: 0, g: 0, b: 0 },
    };
    case 'vibrance':     return { amount: 0 };
    case 'exposure':     return { exposure: 0 };
    case 'posterize':    return { levels: 4 };
    case 'threshold':    return { level: 128 };
    case 'photo-filter': return { color: '#ec8a00', density: 25 };
    case 'gradient-map': return { lo: '#1a0033', hi: '#ffd9a0' };
    case 'channel-mixer': return {
      mono: false,
      r: { r: 100, g: 0, b: 0 }, g: { r: 0, g: 100, b: 0 }, b: { r: 0, g: 0, b: 100 },
      gray: { r: 40, g: 40, b: 20 },
    };
    case 'grain': return { amount: 25 };
    case 'selective-color': {
      const z = () => ({ c: 0, m: 0, y: 0, k: 0 });
      return { reds: z(), yellows: z(), greens: z(), cyans: z(), blues: z(), magentas: z(), whites: z(), neutrals: z(), blacks: z(), relative: true };
    }
  }
  return {};
}


/** Human-readable name for an adjustment type. */
export function adjLayerLabel(type) {
  return {
    'brightness-contrast': 'Brightness/Contrast',
    'hue-saturation': 'Hue/Saturation',
    'levels': 'Levels',
    'curves': 'Curves',
    'color-balance': 'Color Balance',
    'invert': 'Invert',
    'black-white': 'Black & White',
    'desaturate': 'Desaturate',
    'vibrance': 'Vibrance',
    'exposure': 'Exposure',
    'posterize': 'Posterize',
    'threshold': 'Threshold',
    'photo-filter': 'Photo Filter',
    'gradient-map': 'Gradient Map',
    'channel-mixer': 'Channel Mixer',
    'selective-color': 'Selective Color',
    'grain': 'Grain',
  }[type] || type;
}


/**
 * Per-type SVG icon strings. Used in popup title bars, the minimised
 * FX-dock chips, and the layer-panel sub-row name so the same glyph
 * shows up everywhere a given adjustment type appears.
 */
export const ADJ_ICONS = {
  'brightness-contrast': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none"/></svg>',
  'hue-saturation': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="12" r="4"/><circle cx="15" cy="9.5" r="4"/><circle cx="15" cy="14.5" r="4"/></svg>',
  'levels': '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="14" width="3" height="6" rx="0.5"/><rect x="8" y="9" width="3" height="11" rx="0.5"/><rect x="13" y="11" width="3" height="9" rx="0.5"/><rect x="18" y="6" width="3" height="14" rx="0.5"/></svg>',
  'curves': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21C8 21 8.5 4 21 4"/></svg>',
  'color-balance': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12a9 9 0 0 1 9-9v18a9 9 0 0 1-9-9z" fill="currentColor" stroke="none"/></svg>',
  'vibrance': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v18M3 12h18" opacity="0.5"/><circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/></svg>',
  'exposure': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></svg>',
  'posterize': '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="15" width="5" height="5"/><rect x="9.5" y="10" width="5" height="10" opacity="0.7"/><rect x="16" y="5" width="5" height="15" opacity="0.45"/></svg>',
  'threshold': '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3a9 9 0 0 0 0 18z"/><path d="M12 3a9 9 0 0 1 0 18z" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  'photo-filter': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></svg>',
  'gradient-map': '<svg width="14" height="14" viewBox="0 0 24 24"><defs><linearGradient id="gmI" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="currentColor" stop-opacity="0.2"/><stop offset="1" stop-color="currentColor"/></linearGradient></defs><rect x="3" y="7" width="18" height="10" rx="2" fill="url(#gmI)"/></svg>',
  'channel-mixer': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 4v16M12 4v16M19 4v16"/><circle cx="5" cy="9" r="1.6" fill="currentColor"/><circle cx="12" cy="14" r="1.6" fill="currentColor"/><circle cx="19" cy="7" r="1.6" fill="currentColor"/></svg>',
  'grain': '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="6" r="1"/><circle cx="11" cy="5" r="1"/><circle cx="18" cy="8" r="1"/><circle cx="7" cy="12" r="1"/><circle cx="14" cy="11" r="1"/><circle cx="20" cy="14" r="1"/><circle cx="5" cy="18" r="1"/><circle cx="12" cy="18" r="1"/><circle cx="18" cy="19" r="1"/></svg>',
};


/** SVG used in the topbar/history button glyphs. */
export const HISTORY_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/><polyline points="12 7 12 12 16 14"/></svg>';


/** Quick downsampled-alpha check: are there any opaque pixels on this canvas? */
export function isMaskCanvasEmpty(canvas) {
  if (!canvas) return true;
  try {
    const w = canvas.width, h = canvas.height;
    if (!w || !h) return true;
    const sw = Math.min(200, w), sh = Math.min(200, h);
    const tmp = document.createElement('canvas');
    tmp.width = sw; tmp.height = sh;
    tmp.getContext('2d').drawImage(canvas, 0, 0, sw, sh);
    const d = tmp.getContext('2d').getImageData(0, 0, sw, sh).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return false;
    return true;
  } catch { return false; }
}


/** Same as `isMaskCanvasEmpty` but accepts a layer wrapper. */
export function isLayerEmpty(layer) {
  if (!layer || !layer.canvas) return true;
  return isMaskCanvasEmpty(layer.canvas);
}


/**
 * Compact "now / 30s / 12m / 4h" relative-time string. Used in the
 * editor's history panel labels.
 */
export function relTime(ts) {
  if (!ts) return '';
  const dt = (Date.now() - ts) / 1000;
  if (dt < 5) return 'now';
  if (dt < 60) return Math.round(dt) + 's';
  if (dt < 3600) return Math.round(dt / 60) + 'm';
  return Math.round(dt / 3600) + 'h';
}
