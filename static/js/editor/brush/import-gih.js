/**
 * `.gih` (image-hose / animated brush pipe) parser. The file is a 2-line text
 * header followed by N concatenated `.gbr` brushes:
 *   line 1: brush name
 *   line 2: params (e.g. "ncells:4 dim:1 ranks:4 placement:constant …")
 *   then:   <GBR frame 0><GBR frame 1>…
 * Each GBR frame's length is `header_size + width*height*bpp`, so we slice each
 * frame and reuse the GBR parser. Returns an array of { canvas, name, spacing }
 * (one per frame) or null. Original code.
 */
import { parseGBR } from './import-gbr.js';

export function parseGIH(arrayBuffer) {
  try {
    const bytes = new Uint8Array(arrayBuffer);
    const nl1 = bytes.indexOf(10);            // end of name line
    if (nl1 < 0) return null;
    const nl2 = bytes.indexOf(10, nl1 + 1);   // end of params line
    if (nl2 < 0) return null;
    const name = new TextDecoder().decode(bytes.subarray(0, nl1)).trim();
    const params = new TextDecoder().decode(bytes.subarray(nl1 + 1, nl2));
    let ncells = 0;
    const m = params.match(/ncells:(\d+)/);
    if (m) ncells = parseInt(m[1], 10);
    else ncells = parseInt(params.trim().split(/\s+/)[0], 10) || 0;
    if (!ncells || ncells > 4096) ncells = 4096; // safety; the EOF check stops us anyway

    const dv = new DataView(arrayBuffer);
    let off = nl2 + 1;
    const brushes = [];
    for (let i = 0; i < ncells && off + 20 <= dv.byteLength; i++) {
      const headerSize = dv.getUint32(off);
      const width = dv.getUint32(off + 8);
      const height = dv.getUint32(off + 12);
      const bpp = dv.getUint32(off + 16);
      if (!width || !height || (bpp !== 1 && bpp !== 4)) break;
      const frameLen = headerSize + width * height * bpp;
      if (off + frameLen > dv.byteLength) break;
      const parsed = parseGBR(arrayBuffer.slice(off, off + frameLen));
      if (parsed) brushes.push({ canvas: parsed.canvas, name: parsed.name || `${name} ${i + 1}`, spacing: parsed.spacing });
      off += frameLen;
    }
    return brushes.length ? brushes : null;
  } catch {
    return null;
  }
}
