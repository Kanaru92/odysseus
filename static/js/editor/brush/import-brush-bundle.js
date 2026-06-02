/**
 * `.brush` bundle parser — the bundle is a ZIP containing `Shape.png` (tip)
 * and (optionally) `Grain.png` (texture), plus a binary-plist params archive.
 * This pulls Shape + Grain (the look-defining halves) and feeds them to the
 * engine's image tip + grain option. Plist params (spacing/dynamics) are a
 * later refinement — defaults are used for now. Original code.
 *
 * Returns { shape: ImageBitmap, grain: ImageBitmap|null, name } or null (async).
 */
import { unzip } from './unzip.js';

async function toBitmap(bytes) {
  try { return await createImageBitmap(new Blob([bytes], { type: 'image/png' })); }
  catch { return null; }
}

export async function parseBrushBundle(arrayBuffer) {
  const files = await unzip(arrayBuffer);
  if (!files) return null;
  const findBy = (re) => { for (const k of files.keys()) if (re.test(k)) return files.get(k); return null; };
  const grainBytes = findBy(/(^|\/)grain\.png$/i) || findBy(/grain.*\.png$/i);
  // Generic `.png` fallback must not pick up the grain texture as the tip.
  const findShape = (re) => { for (const k of files.keys()) if (re.test(k) && files.get(k) !== grainBytes) return files.get(k); return null; };
  const shapeBytes = findShape(/(^|\/)shape\.png$/i) || findShape(/shape.*\.png$/i) || findShape(/\.png$/i);
  if (!shapeBytes) return null;
  const [shape, grain] = await Promise.all([
    toBitmap(shapeBytes),
    grainBytes ? toBitmap(grainBytes) : Promise.resolve(null),
  ]);
  if (!shape) return null;
  return { shape, grain, name: 'Imported Brush' };
}
