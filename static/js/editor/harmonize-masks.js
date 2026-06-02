/**
 * Mask builders used by the AI Harmonize pipeline.
 *
 *  - `layerUnionAlpha`  — union of every non-base layer's alpha, as a
 *                         binary (0/255) mask. Used as the substrate
 *                         for both seam and body masks.
 *  - `seamMask`         — feathered band along the alpha edges of all
 *                         non-base layers. White = "blend here",
 *                         black = "leave alone". Returned as base64
 *                         PNG (so it can be POST'd to the diffusion
 *                         endpoint as JSON).
 *  - `layerBodyMask`    — feathered FULL shape of every non-base layer.
 *                         White = "AI may redraw this pixel using the
 *                         existing pixels as a starting point";
 *                         black = "preserve exactly". Returned as base64.
 *
 *  - `harmonizeMasks`   — convenience builder that computes the binary
 *                         union once and derives BOTH the seam and body
 *                         masks from it (avoids rebuilding the union
 *                         twice when both masks are needed).
 *
 * Each helper takes the visible layer list + the doc dimensions; no
 * module state.
 *
 * @typedef {{ visible: boolean, id: string, canvas: HTMLCanvasElement, offset: {x: number, y: number} }} HarmLayer
 */

/**
 * Build a binary alpha mask = the UNION of every non-base visible
 * layer's pixels. Returns null when fewer than 2 visible layers exist
 * or when the non-base layers are entirely transparent.
 *
 * @param {number} w / h          Canvas dimensions in pixels.
 * @param {HarmLayer[]} layers    All layers in stack order; the
 *                                first VISIBLE layer is treated as
 *                                the base / background.
 * @returns {HTMLCanvasElement|null}
 */
export function layerUnionAlpha(w, h, layers) {
  const visible = layers.filter(l => l.visible);
  if (visible.length < 2) return null;
  // The base/background is the FIRST visible layer positionally. Skip it by
  // reference (index 0), not by id-equality: layer ids can collide after a
  // restore/duplicate, and id-matching would then drop every layer sharing the
  // base id from the union.
  const base = visible[0];
  const alphaCanvas = document.createElement('canvas');
  alphaCanvas.width = w; alphaCanvas.height = h;
  const actx = alphaCanvas.getContext('2d', { willReadFrequently: true });
  let hasFg = false;
  for (const layer of visible) {
    if (layer === base) continue;
    const off = layer.offset || { x: 0, y: 0 };
    actx.drawImage(layer.canvas, off.x, off.y);
    hasFg = true;
  }
  if (!hasFg) return null;
  const src = actx.getImageData(0, 0, w, h);
  const bin = document.createElement('canvas');
  bin.width = w; bin.height = h;
  const bctx = bin.getContext('2d');
  const binImg = bctx.createImageData(w, h);
  let any = false;
  for (let i = 0; i < src.data.length; i += 4) {
    const v = src.data[i + 3] > 0 ? 255 : 0;
    if (v) any = true;
    binImg.data[i] = binImg.data[i + 1] = binImg.data[i + 2] = v;
    binImg.data[i + 3] = 255;
  }
  if (!any) return null;
  bctx.putImageData(binImg, 0, 0);
  return bin;
}


/**
 * Build a feathered seam mask along the alpha edges of all non-base
 * visible layers. Returns base64-encoded PNG (no `data:` prefix), or
 * null if there's nothing to harmonize.
 */
export function seamMask(w, h, layers, featherPx = 12, precomputedBin = null) {
  const bin = precomputedBin || layerUnionAlpha(w, h, layers);
  if (!bin) return null;
  // Floor the band blur: the triangular weight below peaks at mid-grey, so it
  // only picks out a real seam band where the binary edge has been softened.
  // With featherPx ~0 the blur leaves a hard 0/255 edge, every weight collapses
  // to 0, and the mask comes out all-black. Keep a minimum so the band exists.
  const bandFeather = Math.max(2, featherPx);
  const blur = document.createElement('canvas');
  blur.width = w; blur.height = h;
  const blctx = blur.getContext('2d', { willReadFrequently: true });
  blctx.filter = `blur(${bandFeather}px)`;
  blctx.drawImage(bin, 0, 0);
  blctx.filter = 'none';
  const blurred = blctx.getImageData(0, 0, w, h);
  const mask = blctx.createImageData(w, h);
  // Triangular weight peaked at mid-grey — picks out the alpha-edge band.
  for (let i = 0; i < blurred.data.length; i += 4) {
    const v = blurred.data[i];
    const dist = Math.abs(v - 128);
    const wt = Math.max(0, 255 - dist * 2);
    mask.data[i] = mask.data[i + 1] = mask.data[i + 2] = wt;
    mask.data[i + 3] = 255;
  }
  blctx.putImageData(mask, 0, 0);
  const soft = document.createElement('canvas');
  soft.width = w; soft.height = h;
  const sctx = soft.getContext('2d');
  sctx.filter = `blur(${Math.max(2, Math.floor(bandFeather / 4))}px)`;
  sctx.drawImage(blur, 0, 0);
  sctx.filter = 'none';
  return soft.toDataURL('image/png').split(',')[1];
}


/**
 * Build a feathered FULL-shape mask of every non-base visible layer.
 * Returns base64-encoded PNG, or null if there are no non-base layers.
 */
export function layerBodyMask(w, h, layers, featherPx = 12, precomputedBin = null) {
  const bin = precomputedBin || layerUnionAlpha(w, h, layers);
  if (!bin) return null;
  const soft = document.createElement('canvas');
  soft.width = w; soft.height = h;
  const sctx = soft.getContext('2d');
  sctx.filter = `blur(${featherPx}px)`;
  sctx.drawImage(bin, 0, 0);
  sctx.filter = 'none';
  return soft.toDataURL('image/png').split(',')[1];
}


/**
 * Build BOTH the seam and body masks for the harmonize pipeline, computing the
 * binary union exactly once and deriving both from it. Preferred over calling
 * `seamMask` + `layerBodyMask` separately, which each rebuild the identical
 * full-document union (two drawImage passes, two getImageData readbacks, two
 * O(w*h) loops). Pass `wantSeam = false` to skip the seam mask.
 *
 * @returns {{ seam: string|null, body: string|null }} base64 PNGs (no `data:`
 *          prefix), each null when there is nothing to harmonize.
 */
export function harmonizeMasks(w, h, layers, { bodyFeather = 12, seamFeather = 12, wantSeam = true } = {}) {
  const bin = layerUnionAlpha(w, h, layers);
  if (!bin) return { seam: null, body: null };
  return {
    seam: wantSeam ? seamMask(w, h, layers, seamFeather, bin) : null,
    body: layerBodyMask(w, h, layers, bodyFeather, bin),
  };
}
