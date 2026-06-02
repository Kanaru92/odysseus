/**
 * Pure composite helper — merge a layer list's mask sub-layers into a
 * single canvas for merged-mask use.
 *
 * Stateless: the caller passes everything they need (layer list, canvas
 * dimensions). The legacy gallery editor's module-level functions wrap
 * this with their own state.
 */

/**
 * Union of every visible mask sub-layer across `layers`, rendered as a
 * binary white canvas the size of the document.
 *
 * `lighter` composite = additive — overlapping pixels stay clamped at
 * 255, so wherever any mask painted, the result is solid white.
 * Returns null when no mask layer contributed any pixels (so the caller
 * can early-out cleanly).
 *
 * @param {Array<{masks?: Array<{visible: boolean, canvas: HTMLCanvasElement}>}>} layers
 * @param {number} imgW
 * @param {number} imgH
 * @returns {HTMLCanvasElement|null}
 */
export function buildMergedMaskCanvas(layers, imgW, imgH) {
  if (!imgW || !imgH) return null;
  const out = document.createElement('canvas');
  out.width = imgW;
  out.height = imgH;
  const ctx = out.getContext('2d');
  ctx.globalCompositeOperation = 'lighter';
  let anyMask = false;
  for (const ly of layers) {
    if (!ly.masks || !ly.masks.length) continue;
    for (const mk of ly.masks) {
      if (!mk.visible) continue;
      if (!mk.canvas || !mk.canvas.width || !mk.canvas.height) continue;
      ctx.drawImage(mk.canvas, 0, 0);
      anyMask = true;
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  return anyMask ? out : null;
}
