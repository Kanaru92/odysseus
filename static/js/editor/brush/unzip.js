/**
 * Minimal ZIP reader (async) — enough to pull named entries out of `.brush`
 * and `.kpp`/`.bundle` brush archives. Reads the End-Of-Central-
 * Directory, walks the central directory, and decompresses STORED (0) or
 * DEFLATE (8, via the platform DecompressionStream). Original code; ZIP fields
 * are little-endian. Returns Map<name, Uint8Array> or null.
 */
async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function unzip(arrayBuffer) {
  try {
    const dv = new DataView(arrayBuffer);
    const u8 = new Uint8Array(arrayBuffer);
    const len = dv.byteLength;
    // Find EOCD signature (0x06054b50), scanning back from the end.
    let eocd = -1;
    const minScan = Math.max(0, len - 22 - 65536);
    for (let i = len - 22; i >= minScan; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return null;
    const cdCount = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true); // central directory offset
    const out = new Map();
    for (let n = 0; n < cdCount; n++) {
      if (p + 46 > len || dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const localOff = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
      // Local header: data starts after its own (possibly different) name/extra.
      if (dv.getUint32(localOff, true) === 0x04034b50) {
        const lhNameLen = dv.getUint16(localOff + 26, true);
        const lhExtraLen = dv.getUint16(localOff + 28, true);
        const dataOff = localOff + 30 + lhNameLen + lhExtraLen;
        const comp = u8.subarray(dataOff, dataOff + compSize);
        let data = null;
        if (method === 0) data = comp.slice();
        else if (method === 8) { try { data = await inflateRaw(comp); } catch { data = null; } }
        if (data) out.set(name, data);
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out.size ? out : null;
  } catch {
    return null;
  }
}
