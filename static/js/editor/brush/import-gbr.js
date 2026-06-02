/**
 * `.gbr` brush parser → a tip canvas for the brush engine's image tip.
 * Original code from the public GBR format spec (big-endian):
 *   u32 header_size · u32 version · u32 width · u32 height · u32 bytes_per_pixel
 *   [v2+: u32 magic · u32 spacing] · name (header_size − fixed, NUL-terminated)
 *   pixel data: width·height·bpp
 *
 * bpp 1 = grayscale: darker = stronger, so alpha = 255 − value
 * (black ink → opaque). bpp 4 = RGBA: used as-is. Returns
 * { canvas, name, spacing } (spacing as a 0..2 fraction of diameter), or null.
 */
export function parseGBR(arrayBuffer) {
  try {
    const dv = new DataView(arrayBuffer);
    if (dv.byteLength < 20) return null;
    const headerSize = dv.getUint32(0);
    const version = dv.getUint32(4);
    const width = dv.getUint32(8);
    const height = dv.getUint32(12);
    const bpp = dv.getUint32(16);
    if (!width || !height || width > 4096 || height > 4096) return null;
    if (bpp !== 1 && bpp !== 4) return null;
    const spacingPct = version >= 2 && dv.byteLength >= 28 ? dv.getUint32(24) : 0;
    const need = width * height * bpp;
    if (headerSize + need > dv.byteLength) return null;
    const src = new Uint8Array(arrayBuffer, headerSize, need);

    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    const out = ctx.createImageData(width, height);
    const o = out.data;
    if (bpp === 1) {
      const px = width * height;
      for (let i = 0, j = 0; i < px; i++, j += 4) {
        o[j] = 255; o[j + 1] = 255; o[j + 2] = 255; o[j + 3] = 255 - src[i];
      }
    } else {
      o.set(src.subarray(0, need));
    }
    ctx.putImageData(out, 0, 0);

    let name = '';
    try {
      const nameOff = version >= 2 ? 28 : 20;
      const len = Math.max(0, headerSize - nameOff);
      if (len > 0) name = new TextDecoder().decode(new Uint8Array(arrayBuffer, nameOff, len)).replace(/\0+$/, '').trim();
    } catch { /* name optional */ }

    const spacing = spacingPct > 0 ? Math.max(0.01, Math.min(2, spacingPct / 100)) : 0.1;
    return { canvas, name, spacing };
  } catch {
    return null;
  }
}
