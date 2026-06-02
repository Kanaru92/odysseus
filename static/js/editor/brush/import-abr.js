/**
 * `.abr` brush parser — versions 1 & 2 (legacy) AND version 6 (modern 8BIM
 * format, what current editors export). Original code from the public ABR
 * layout (big-endian). Sampled brushes are 8-bit grayscale; the tip is stored
 * as coverage (white = full), so we build an opaque grayscale canvas and let
 * the engine's image-tip use luminance as the mask. Returns an array of
 * { canvas, name, spacing } (a .abr can hold many brushes), or null.
 */
export function unpackBits(src, expected) {
  const out = new Uint8Array(expected);
  let o = 0, i = 0;
  while (o < expected && i < src.length) {
    let n = src[i++];
    if (n < 128) { n += 1; for (let k = 0; k < n && o < expected && i < src.length; k++) out[o++] = src[i++]; }
    else if (n > 128) { n = 257 - n; const v = src[i++]; for (let k = 0; k < n && o < expected; k++) out[o++] = v; }
    // n === 128 → no-op
  }
  return out;
}

// Build an opaque grayscale tip canvas from raw coverage bytes.
function grayCanvas(pix, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(width, height);
  const o = out.data;
  for (let i = 0, j = 0; i < width * height; i++, j += 4) { const g = pix[i]; o[j] = g; o[j + 1] = g; o[j + 2] = g; o[j + 3] = 255; }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

function reader(dv) {
  let p = 0;
  return {
    u8: () => dv.getUint8(p++),
    u16: () => { const v = dv.getUint16(p); p += 2; return v; },
    i16: () => { const v = dv.getInt16(p); p += 2; return v; },
    u32: () => { const v = dv.getUint32(p); p += 4; return v; },
    i32: () => { const v = dv.getInt32(p); p += 4; return v; },
    bytes: (n) => { const a = new Uint8Array(dv.buffer, dv.byteOffset + p, n); p += n; return a; },
    seek: (n) => { p = n; },
    pos: () => p,
    left: () => dv.byteLength - p,
  };
}

// ── Version 1 / 2 (legacy sampled brushes) ──
function parseV12(dv, version) {
  const r = reader(dv);
  r.seek(2); // version already read
  const count = r.u16();
  const brushes = [];
  for (let b = 0; b < count; b++) {
    if (r.left() < 6) break;
    const type = r.u16();
    const size = r.u32();
    const next = r.pos() + size;
    if (type === 2) {
      r.u32(); // misc
      const spacing = r.u16();
      let name = '';
      if (version === 2) {
        const nlen = r.u32();
        if (nlen > 0 && nlen < 1024) {
          try { name = new TextDecoder('utf-16be').decode(r.bytes(nlen * 2)).replace(/\0+$/, '').trim(); }
          catch { r.seek(r.pos()); }
        }
      }
      r.u8(); // antialiasing
      r.i16(); r.i16(); r.i16(); r.i16(); // short bounds (unused)
      const top = r.i32(), left = r.i32(), bottom = r.i32(), right = r.i32();
      const depth = r.u16();
      const compression = r.u8();
      const width = right - left, height = bottom - top;
      if (width > 0 && height > 0 && width <= 4096 && height <= 4096 && depth === 8) {
        let pix;
        if (compression === 0) {
          pix = r.bytes(width * height);
        } else {
          const rowLens = [];
          for (let y = 0; y < height; y++) rowLens.push(r.u16());
          pix = new Uint8Array(width * height);
          for (let y = 0; y < height; y++) pix.set(unpackBits(r.bytes(rowLens[y]), width), y * width);
        }
        brushes.push({ canvas: grayCanvas(pix, width, height), name, spacing: spacing > 0 ? Math.max(0.01, Math.min(2, spacing / 100)) : 0.1 });
      }
    }
    if (next > r.pos() && next <= dv.byteLength) r.seek(next);
  }
  return brushes;
}

// ── Version 6 (8BIM container; sampled brushes in the 'samp' section) ──
// Layout per brush record: u32 brushLen · 301-byte fixed header · i32 top/left/
// bottom/right · u16 depth · u8 compression · pixel data (RLE: h×u16 row byte-
// counts then PackBits rows; or raw width*height bytes). Verified against a
// real 51-brush export.
function parseV6(dv) {
  const u16 = (o) => dv.getUint16(o, false);
  const u32 = (o) => dv.getUint32(o, false);
  const i32 = (o) => dv.getInt32(o, false);
  const tag = (o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  const len = dv.byteLength;
  const brushes = [];

  // Walk 8BIM blocks to find the 'samp' section.
  let bp = 4; // after version(2) + subversion(2)
  while (bp + 12 <= len) {
    if (tag(bp) !== '8BIM') break;
    const key = tag(bp + 4);
    const blockLen = u32(bp + 8);
    const dataStart = bp + 12;
    if (dataStart + blockLen > len) break;
    if (key === 'samp') {
      const end = dataStart + blockLen;
      let pos = dataStart;
      while (pos + 4 <= end) {
        const brushLen = u32(pos);
        if (brushLen <= 0 || pos + 4 + brushLen > end + 4) break;
        const recEnd = pos + 4 + brushLen;
        const rectOff = pos + 4 + 301; // fixed v6 header
        if (rectOff + 19 <= recEnd) {
          const top = i32(rectOff), left = i32(rectOff + 4), bottom = i32(rectOff + 8), right = i32(rectOff + 12);
          const depth = u16(rectOff + 16), comp = dv.getUint8(rectOff + 18);
          const width = right - left, height = bottom - top;
          if (width > 0 && height > 0 && width <= 8192 && height <= 8192 && depth === 8 && comp <= 1) {
            const pix = new Uint8Array(width * height);
            const ds = rectOff + 19;
            if (comp === 0) {
              for (let i = 0; i < width * height && ds + i < recEnd; i++) pix[i] = dv.getUint8(ds + i);
            } else {
              const rowLens = [];
              for (let y = 0; y < height; y++) rowLens.push(u16(ds + y * 2));
              let rowSrc = ds + height * 2;
              for (let y = 0; y < height; y++) {
                const n = rowLens[y];
                if (rowSrc + n > len) break;
                pix.set(unpackBits(new Uint8Array(dv.buffer, dv.byteOffset + rowSrc, n), width), y * width);
                rowSrc += n;
              }
            }
            brushes.push({ canvas: grayCanvas(pix, width, height), name: '', spacing: 0.1 });
          }
        }
        let nextRec = recEnd; while (nextRec % 4) nextRec++;
        if (nextRec <= pos) break;
        pos = nextRec;
      }
    }
    let nb = dataStart + blockLen; if (nb % 2) nb++; // 8BIM blocks pad to even
    if (nb <= bp) break;
    bp = nb;
  }
  return brushes;
}

export function parseABR(arrayBuffer) {
  try {
    const dv = new DataView(arrayBuffer);
    const version = dv.getUint16(0, false);
    let brushes = null;
    if (version === 1 || version === 2) brushes = parseV12(dv, version);
    else if (version === 6) brushes = parseV6(dv);
    else return null;
    return brushes && brushes.length ? brushes : null;
  } catch {
    return null;
  }
}
