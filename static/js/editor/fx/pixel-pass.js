/**
 * Apply a Brightness/Contrast, Hue/Saturation, Levels, or Color Balance
 * adjustment to a source canvas and return a fresh canvas with the
 * result. Pure pixel math — no DOM, no module state.
 *
 * Used by the editor's per-layer FX stack: each `adjLayer` calls
 * `applyAdjustment(prevCanvas, adjLayer)` and the result feeds the
 * next layer in the stack.
 *
 * Adjustment shape:
 *   { type: 'brightness-contrast', params: { brightness, contrast } }
 *   { type: 'hue-saturation',      params: { hue, saturation } }
 *   { type: 'levels',              params: { inBlack, inWhite, gamma, outBlack, outWhite } }
 *   { type: 'curves',              params: { channel, rgb, r, g, b } }   // each = [[in,out],…]
 *   { type: 'color-balance',       params: { shadows, midtones, highlights } }
 */
import { buildCurvesLUTs } from './curves.js';

function _hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function applyAdjustment(srcCanvas, adj) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');

  // B/C and H/S can use the fast browser-native CSS filter pipeline.
  if (adj.type === 'brightness-contrast') {
    const p = adj.params;
    octx.filter = `brightness(${p.brightness}) contrast(${p.contrast})`;
    octx.drawImage(srcCanvas, 0, 0);
    octx.filter = 'none';
    return out;
  }
  if (adj.type === 'hue-saturation') {
    const p = adj.params;
    octx.filter = `saturate(${p.saturation}) hue-rotate(${p.hue}deg)`;
    octx.drawImage(srcCanvas, 0, 0);
    octx.filter = 'none';
    return out;
  }

  // Levels + Color Balance need per-pixel math.
  octx.drawImage(srcCanvas, 0, 0);
  const img = octx.getImageData(0, 0, w, h);
  const d = img.data;

  if (adj.type === 'levels') {
    const l = adj.params;
    const inLow  = Math.max(0, Math.min(254, l.inBlack));
    const inHigh = Math.max(inLow + 1, Math.min(255, l.inWhite));
    const gamma  = Math.max(0.1, l.gamma || 1);
    const outLow  = Math.max(0, Math.min(255, l.outBlack));
    const outHigh = Math.max(outLow, Math.min(255, l.outWhite));
    const inv = 1.0 / gamma;
    const span = (outHigh - outLow);
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
      let t = (v - inLow) / (inHigh - inLow);
      if (t < 0) t = 0; else if (t > 1) t = 1;
      t = Math.pow(t, inv);
      lut[v] = Math.round(t * span + outLow);
    }
    for (let i = 0; i < d.length; i += 4) {
      d[i] = lut[d[i]]; d[i+1] = lut[d[i+1]]; d[i+2] = lut[d[i+2]];
    }
    octx.putImageData(img, 0, 0);
    return out;
  }

  if (adj.type === 'curves') {
    const { r: lr, g: lg, b: lb } = buildCurvesLUTs(adj.params);
    for (let i = 0; i < d.length; i += 4) {
      d[i] = lr[d[i]]; d[i + 1] = lg[d[i + 1]]; d[i + 2] = lb[d[i + 2]];
    }
    octx.putImageData(img, 0, 0);
    return out;
  }

  if (adj.type === 'color-balance') {
    const cb = adj.params;
    const scale = 0.6;
    const s = cb.shadows, m = cb.midtones, hi = cb.highlights;
    const sR = s.r*scale, sG = s.g*scale, sB = s.b*scale;
    const mR = m.r*scale, mG = m.g*scale, mB = m.b*scale;
    const hR = hi.r*scale, hG = hi.g*scale, hB = hi.b*scale;
    // Bell-curve tone weights so each pixel's shift is proportional to
    // how "shadow", "midtone", or "highlight" its luminance is.
    const wS = new Float32Array(256), wM = new Float32Array(256), wH = new Float32Array(256);
    const sig = 0.25;
    for (let v = 0; v < 256; v++) {
      const t = v / 255;
      wS[v] = Math.exp(-(t*t) / (2*sig*sig));
      wM[v] = Math.exp(-((t-0.5)*(t-0.5)) / (2*sig*sig));
      wH[v] = Math.exp(-((1-t)*(1-t)) / (2*sig*sig));
    }
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i+1], b = d[i+2];
      const Y = (0.2126*r + 0.7152*g + 0.0722*b) | 0;
      const ws = wS[Y], wm = wM[Y], wh = wH[Y];
      r += sR*ws + mR*wm + hR*wh;
      g += sG*ws + mG*wm + hG*wh;
      b += sB*ws + mB*wm + hB*wh;
      d[i]   = r < 0 ? 0 : r > 255 ? 255 : r;
      d[i+1] = g < 0 ? 0 : g > 255 ? 255 : g;
      d[i+2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
    octx.putImageData(img, 0, 0);
    return out;
  }

  if (adj.type === 'invert') {
    for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; }
    octx.putImageData(img, 0, 0);
    return out;
  }

  if (adj.type === 'black-white') {
    for (let i = 0; i < d.length; i += 4) {
      const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = y;
    }
    octx.putImageData(img, 0, 0);
    return out;
  }

  if (adj.type === 'desaturate') {
    // PS "Desaturate" = HSL lightness ((max+min)/2), distinct from the luma-based
    // Black & White above.
    for (let i = 0; i < d.length; i += 4) {
      const v = (Math.max(d[i], d[i + 1], d[i + 2]) + Math.min(d[i], d[i + 1], d[i + 2])) / 2;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    octx.putImageData(img, 0, 0);
    return out;
  }

  if (adj.type === 'selective-color') {
    // Per-colour-family CMYK push (PS Selective Color). For each pixel pick its
    // dominant family (6 hue sextants for chromatic pixels; whites/neutrals/
    // blacks for low-chroma) and shift it by that family's C/M/Y/K deltas
    // (cyan↓red, magenta↓green, yellow↓blue, black↓all), weighted by chroma.
    // Relative scales the push by each channel's room; Absolute is a flat push.
    const rel = adj.params.relative !== false;
    const famDelta = (fam) => adj.params[fam] || { c: 0, m: 0, y: 0, k: 0 };
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), ch = mx - mn, L = (mx + mn) / 2;
      let fam, w;
      if (ch < 0.10) { fam = L < 0.25 ? 'blacks' : (L > 0.75 ? 'whites' : 'neutrals'); w = 1; }
      else {
        let h; if (mx === r) h = ((g - b) / ch) % 6; else if (mx === g) h = (b - r) / ch + 2; else h = (r - g) / ch + 4;
        h *= 60; if (h < 0) h += 360;
        fam = (h < 30 || h >= 330) ? 'reds' : h < 90 ? 'yellows' : h < 150 ? 'greens' : h < 210 ? 'cyans' : h < 270 ? 'blues' : 'magentas';
        w = ch; // more saturated → stronger effect
      }
      const dl = famDelta(fam);
      const dr = (dl.c + dl.k), dg = (dl.m + dl.k), db2 = (dl.y + dl.k); // cyan/magenta/yellow + black
      const push = (v, dd) => rel ? v - w * dd * v : v - w * dd; // relative scales by channel value
      d[i] = Math.round(Math.min(1, Math.max(0, push(r, dr))) * 255);
      d[i + 1] = Math.round(Math.min(1, Math.max(0, push(g, dg))) * 255);
      d[i + 2] = Math.round(Math.min(1, Math.max(0, push(b, db2))) * 255);
    }
    octx.putImageData(img, 0, 0);
    return out;
  }

  if (adj.type === 'vibrance') {
    // Boost saturation more for less-saturated pixels (protects already-vivid
    // colours / skin), unlike a flat Saturation. d is Uint8ClampedArray → auto-clamps.
    const amt = (adj.params.amount || 0) / 100;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = (mx - mn) / 255;
      const avg = (r + g + b) / 3;
      const k = 1 + amt * (1 - sat);
      d[i] = avg + (r - avg) * k; d[i + 1] = avg + (g - avg) * k; d[i + 2] = avg + (b - avg) * k;
    }
    octx.putImageData(img, 0, 0);
    return out;
  }

  if (adj.type === 'exposure') {
    const m = Math.pow(2, (adj.params.exposure || 0) / 50); // ±100 ≈ ±2 stops
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = v * m;
    for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
    octx.putImageData(img, 0, 0);
    return out;
  }

  if (adj.type === 'posterize') {
    const n = Math.max(2, Math.min(255, Math.round(adj.params.levels || 4)));
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = Math.round(Math.round((v / 255) * (n - 1)) / (n - 1) * 255);
    for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
    octx.putImageData(img, 0, 0);
    return out;
  }

  if (adj.type === 'threshold') {
    const t = Math.max(1, Math.min(255, Math.round(adj.params.level || 128)));
    for (let i = 0; i < d.length; i += 4) {
      const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const v = y >= t ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    octx.putImageData(img, 0, 0);
    return out;
  }

  if (adj.type === 'photo-filter') {
    const c = _hexRgb(adj.params.color || '#ec8a00');
    const k = Math.max(0, Math.min(1, (adj.params.density || 0) / 100));
    const tr = c.r / 255, tg = c.g / 255, tb = c.b / 255;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = d[i] * (1 - k) + d[i] * tr * k;
      d[i + 1] = d[i + 1] * (1 - k) + d[i + 1] * tg * k;
      d[i + 2] = d[i + 2] * (1 - k) + d[i + 2] * tb * k;
    }
    octx.putImageData(img, 0, 0);
    return out;
  }

  if (adj.type === 'channel-mixer') {
    const p = adj.params, mono = !!p.mono;
    const mix = (o, R, G, B) => (R * o.r + G * o.g + B * o.b) / 100;
    for (let i = 0; i < d.length; i += 4) {
      const R = d[i], G = d[i + 1], B = d[i + 2];
      if (mono) { const y = mix(p.gray, R, G, B); d[i] = d[i + 1] = d[i + 2] = y; }
      else { d[i] = mix(p.r, R, G, B); d[i + 1] = mix(p.g, R, G, B); d[i + 2] = mix(p.b, R, G, B); }
    }
    octx.putImageData(img, 0, 0);
    return out;
  }

  if (adj.type === 'grain') {
    const a = (Math.max(0, Math.min(100, adj.params.amount || 0)) / 100) * 128;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() * 2 - 1) * a; // monochrome grain
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    octx.putImageData(img, 0, 0);
    return out;
  }

  if (adj.type === 'gradient-map') {
    const lo = _hexRgb(adj.params.lo || '#000000'), hi = _hexRgb(adj.params.hi || '#ffffff');
    const lr = new Uint8ClampedArray(256), lg = new Uint8ClampedArray(256), lb = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) { const t = v / 255; lr[v] = lo.r + (hi.r - lo.r) * t; lg[v] = lo.g + (hi.g - lo.g) * t; lb[v] = lo.b + (hi.b - lo.b) * t; }
    for (let i = 0; i < d.length; i += 4) {
      const y = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
      d[i] = lr[y]; d[i + 1] = lg[y]; d[i + 2] = lb[y];
    }
    octx.putImageData(img, 0, 0);
    return out;
  }

  return out;
}


/**
 * Apply a combined Levels + Color Balance pass to a layer in-place via
 * its `layer.adjustments` field. Cached on `layer._adjCache` keyed by
 * `cacheKey` so repeated composite passes don't re-run the math.
 *
 * Returns the cached output canvas.
 *
 * @param {{
 *   canvas: HTMLCanvasElement,
 *   adjustments: object,
 *   _adjCache?: HTMLCanvasElement,
 *   _adjCacheKey?: string,
 * }} layer
 * @param {string} cacheKey  Stable signature of `layer.adjustments`.
 */
export function renderLayerPixelAdjustments(layer, cacheKey) {
  const adj = layer.adjustments;
  if (layer._adjCache && layer._adjCacheKey === cacheKey) return layer._adjCache;
  if (!layer._adjCache) {
    layer._adjCache = document.createElement('canvas');
  }
  const out = layer._adjCache;
  out.width = layer.canvas.width;
  out.height = layer.canvas.height;
  const octx = out.getContext('2d');
  octx.clearRect(0, 0, out.width, out.height);
  octx.drawImage(layer.canvas, 0, 0);
  const img = octx.getImageData(0, 0, out.width, out.height);
  const d = img.data;

  // Single 256-entry LUT for the Levels portion (applied per R/G/B
  // channel identically — luma-style isn't right when colour balance
  // follows, per-channel is fine here).
  const l = adj.levels || { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };
  const inLow  = Math.max(0, Math.min(254, l.inBlack));
  const inHigh = Math.max(inLow + 1, Math.min(255, l.inWhite));
  const gamma  = Math.max(0.1, l.gamma || 1);
  const outLow  = Math.max(0, Math.min(255, l.outBlack));
  const outHigh = Math.max(outLow, Math.min(255, l.outWhite));
  const inv = 1.0 / gamma;
  const span = (outHigh - outLow);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    let t = (v - inLow) / (inHigh - inLow);
    if (t < 0) t = 0; else if (t > 1) t = 1;
    t = Math.pow(t, inv);
    lut[v] = Math.round(t * span + outLow);
  }

  // Color Balance bell-curve weights (see applyAdjustment).
  const cb = adj.colorBalance || { shadows: {r:0,g:0,b:0}, midtones: {r:0,g:0,b:0}, highlights: {r:0,g:0,b:0} };
  const s = cb.shadows || {r:0,g:0,b:0};
  const m = cb.midtones || {r:0,g:0,b:0};
  const h = cb.highlights || {r:0,g:0,b:0};
  const scale = 0.6;
  const sR = s.r * scale, sG = s.g * scale, sB = s.b * scale;
  const mR = m.r * scale, mG = m.g * scale, mB = m.b * scale;
  const hR = h.r * scale, hG = h.g * scale, hB = h.b * scale;

  const wS = new Float32Array(256);
  const wM = new Float32Array(256);
  const wH = new Float32Array(256);
  for (let v = 0; v < 256; v++) {
    const t = v / 255;
    const dS = t, wsig = 0.25;
    const dM = t - 0.5;
    const dH = 1 - t;
    wS[v] = Math.exp(-(dS * dS) / (2 * wsig * wsig));
    wM[v] = Math.exp(-(dM * dM) / (2 * wsig * wsig));
    wH[v] = Math.exp(-(dH * dH) / (2 * wsig * wsig));
  }

  for (let i = 0; i < d.length; i += 4) {
    let r = lut[d[i]];
    let g = lut[d[i + 1]];
    let b = lut[d[i + 2]];
    const Y = (0.2126 * r + 0.7152 * g + 0.0722 * b) | 0;
    const ws = wS[Y], wm = wM[Y], wh = wH[Y];
    r += sR * ws + mR * wm + hR * wh;
    g += sG * ws + mG * wm + hG * wh;
    b += sB * ws + mB * wm + hB * wh;
    d[i]     = r < 0 ? 0 : r > 255 ? 255 : r;
    d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
  octx.putImageData(img, 0, 0);
  layer._adjCacheKey = cacheKey;
  return out;
}


/**
 * Walk the layer's `adjLayers` stack (skipping the one currently being
 * edited, if any) plus an optional staged preview adjustment, producing
 * a final canvas the composite step can paint. The result is memoised
 * on `layer._adjFinal` keyed by a signature of all adjLayer params +
 * staged + editing id, so repeated composite passes are O(1) when
 * nothing has changed.
 *
 * If the stack is empty AND nothing is staged, returns the layer's own
 * canvas unchanged (no allocation).
 *
 * @param {{
 *   canvas: HTMLCanvasElement,
 *   adjLayers?: Array<{id: string, type: string, params: object, visible: boolean, opacity: number}>,
 *   _stagedAdj?: {type: string, params: object} | null,
 *   _editingAdjId?: string | null,
 *   _adjFinal?: HTMLCanvasElement,
 *   _adjFinalKey?: string,
 * }} layer
 * @returns {HTMLCanvasElement}
 */
export function renderLayerWithAdjLayers(layer) {
  const editingId = layer._editingAdjId || null;
  const stack = (layer.adjLayers || []).filter(a => a.visible && a.id !== editingId);
  const staged = layer._stagedAdj;
  if (stack.length === 0 && !staged) {
    layer._adjFinalKey = '';
    return layer.canvas;
  }
  const sig = stack.map(a => `${a.id}:${a.visible?1:0}:${a.opacity}:${a.type}:${JSON.stringify(a.params)}`).join('|') +
    (staged ? `|S:${staged.type}:${JSON.stringify(staged.params)}` : '') +
    (editingId ? `|E:${editingId}` : '');
  if (layer._adjFinal && layer._adjFinalKey === sig) return layer._adjFinal;
  let cur = layer.canvas;
  const w = layer.canvas.width, h = layer.canvas.height;
  for (const adj of stack) {
    const adjOut = applyAdjustment(cur, adj);
    if (adj.opacity >= 0.999) {
      cur = adjOut;
    } else {
      const blend = document.createElement('canvas');
      blend.width = w; blend.height = h;
      const bctx = blend.getContext('2d');
      bctx.drawImage(cur, 0, 0);
      bctx.globalAlpha = adj.opacity;
      bctx.drawImage(adjOut, 0, 0);
      bctx.globalAlpha = 1;
      cur = blend;
    }
  }
  if (staged) {
    cur = applyAdjustment(cur, staged);
  }
  layer._adjFinal = cur;
  layer._adjFinalKey = sig;
  return cur;
}
