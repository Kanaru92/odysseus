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
  const shapeBytes = findBy(/(^|\/)shape\.png$/i) || findBy(/shape.*\.png$/i) || findBy(/\.png$/i);
  if (!shapeBytes) return null;
  const grainBytes = findBy(/(^|\/)grain\.png$/i) || findBy(/grain.*\.png$/i);
  const shape = await toBitmap(shapeBytes);
  if (!shape) return null;
  const grain = grainBytes ? await toBitmap(grainBytes) : null;
  return { shape, grain, name: 'Imported Brush' };
}
