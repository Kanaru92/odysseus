/**
 * Multi-format image export. PNG / WebP / TGA preserve the alpha channel;
 * JPEG has no alpha so the image is flattened onto white first (the common
 * expectation). PNG/JPEG/WebP use the canvas's native encoder; TGA is encoded
 * here (uncompressed 32-bit BGRA, top-left origin) since browsers don't ship a
 * TGA encoder.
 *
 * `exportBlob(canvas, format, quality)` → Promise<Blob>; `downloadImage(...)`
 * wraps it in a download. Pure DOM/canvas — no deps.
 */

// Uncompressed 32-bit true-colour TGA with an 8-bit alpha channel.
export function encodeTGA(canvas) {
  const w = canvas.width, h = canvas.height;
  // TGA stores width/height as 16-bit little-endian — anything past 65535
  // would silently wrap and produce a corrupt file, so reject it up front.
  if (w > 0xffff || h > 0xffff) {
    throw new Error('TGA export supports dimensions up to 65535px');
  }
  // getContext('2d') returns null if the canvas was already bound to another
  // context type (e.g. webgl); bail with a clear error instead of throwing on
  // a null deref.
  const sctx = canvas.getContext('2d');
  if (!sctx) throw new Error('TGA export requires a 2D canvas');
  const data = sctx.getImageData(0, 0, w, h).data;
  const HEADER = 18;
  const buf = new Uint8Array(HEADER + w * h * 4);
  buf[2] = 2;                         // image type: uncompressed true-color
  buf[12] = w & 0xff; buf[13] = (w >> 8) & 0xff;
  buf[14] = h & 0xff; buf[15] = (h >> 8) & 0xff;
  buf[16] = 32;                       // bits per pixel
  buf[17] = 0x28;                     // top-left origin (0x20) + 8 alpha bits (0x08)
  let o = HEADER;
  for (let i = 0; i < data.length; i += 4) {
    buf[o++] = data[i + 2]; // B
    buf[o++] = data[i + 1]; // G
    buf[o++] = data[i];     // R
    buf[o++] = data[i + 3]; // A
  }
  return new Blob([buf], { type: 'image/x-tga' });
}

// JPEG has no alpha — composite onto white so transparency doesn't read black.
function flattenOnWhite(canvas) {
  const c = document.createElement('canvas');
  c.width = canvas.width; c.height = canvas.height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(canvas, 0, 0);
  return c;
}

const EXT = { png: 'png', jpeg: 'jpg', jpg: 'jpg', webp: 'webp', tga: 'tga' };
// Map an actual blob MIME back to a file extension. The canvas encoder silently
// falls back to PNG for unsupported types (e.g. WebP on engines without an
// encoder), so the produced bytes can differ from the requested format — the
// extension must follow the real bytes, not the request.
const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/x-tga': 'tga',
};
export const EXPORT_FORMATS = [
  { id: 'png', label: 'PNG (lossless, alpha)', alpha: true, lossy: false },
  { id: 'jpeg', label: 'JPEG (no alpha)', alpha: false, lossy: true },
  { id: 'webp', label: 'WebP (alpha, smaller)', alpha: true, lossy: true },
  { id: 'tga', label: 'TGA (lossless, alpha)', alpha: true, lossy: false },
];

export function exportBlob(canvas, format, quality) {
  return new Promise((resolve, reject) => {
    const q = Math.max(0, Math.min(1, quality == null ? 0.92 : quality));
    const fail = () => reject(new Error('Canvas encode failed'));
    if (format === 'tga') { resolve(encodeTGA(canvas)); return; }
    if (format === 'jpeg' || format === 'jpg') {
      flattenOnWhite(canvas).toBlob((b) => (b ? resolve(b) : fail()), 'image/jpeg', q);
      return;
    }
    if (format === 'webp') {
      canvas.toBlob((b) => (b ? resolve(b) : fail()), 'image/webp', q);
      return;
    }
    canvas.toBlob((b) => (b ? resolve(b) : fail()), 'image/png');
  });
}

export async function downloadImage(canvas, format, quality, baseName) {
  const blob = await exportBlob(canvas, format, quality);
  // Prefer the extension implied by the actual blob bytes; fall back to the
  // requested format only when the blob carries no recognised MIME type.
  const ext = MIME_EXT[blob.type] || EXT[format] || 'png';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (baseName || 'image') + '.' + ext;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} }, 2000);
  return blob;
}
