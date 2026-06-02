/**
 * Color Range selection — select every pixel whose colour is within `fuzziness`
 * of a target colour, anywhere on the layer (global, unlike the contiguous magic
 * wand). Returns a white-where-selected mask canvas, the same format the wand
 * produces, so it drops straight into the shared selection (`state.wandMask`)
 * and reuses its overlay / delete / invert / feather plumbing.
 *
 * Pure: takes a pixel buffer + target + fuzziness, returns a new canvas.
 *
 * @param {Uint8ClampedArray} data   RGBA source pixels (w×h).
 * @param {number} w
 * @param {number} h
 * @param {[number,number,number]} target  Target RGB.
 * @param {number} fuzziness  0..100 (0 = exact colour, 100 = everything).
 * @returns {HTMLCanvasElement}
 */
export function colorRangeMask(data, w, h, target, fuzziness) {
  const tol = (Math.max(0, Math.min(100, fuzziness)) / 100) * 441.673; // max RGB distance ≈ √(3·255²)
  const tol2 = tol * tol;
  const tr = target[0], tg = target[1], tb = target[2];
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);
  const d = img.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] <= 10) continue; // skip (near-)transparent pixels
    const dr = data[i] - tr, dg = data[i + 1] - tg, db = data[i + 2] - tb;
    if (dr * dr + dg * dg + db * db <= tol2) {
      d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}
