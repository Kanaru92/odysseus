/**
 * Self-contained animated GIF89a encoder — pure JS, no dependencies, CSP-safe
 * (no eval / no Function). Reads frame pixels via 2D canvas, builds a shared
 * 256-colour palette with a median-cut quantizer (sampled for speed), maps each
 * pixel to the nearest palette entry (with a coarse RGB->index cache), then
 * writes a standard GIF89a stream: header, logical screen descriptor + global
 * colour table, an optional NETSCAPE2.0 looping extension, and per frame a
 * Graphic Control Extension + Image Descriptor + variable-width LZW data.
 *
 * If any frame contains pixels with alpha < ALPHA_CUTOFF, one palette slot is
 * reserved as the transparent index and the GCE transparent flag is set, so
 * cleared regions stay see-through instead of turning black.
 *
 * @param {HTMLCanvasElement[]} frames  all the same size
 * @param {{ fps?:number, loop?:boolean }} [opts]
 * @returns {Blob} image/gif
 */
export function encodeGIF(frames, opts = {}) {
  const fps = Math.max(1, Math.min(100, (opts.fps ?? 12)));
  const loop = opts.loop !== false;
  if (!frames || !frames.length) throw new Error('encodeGIF: no frames');

  const W = frames[0].width, H = frames[0].height;
  if (!W || !H) throw new Error('encodeGIF: zero-size frame');

  const ALPHA_CUTOFF = 128;

  // ---- pull pixel data for every frame --------------------------------------
  const framePixels = frames.map((cv) => {
    if (cv.width !== W || cv.height !== H) throw new Error('encodeGIF: frame size mismatch');
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    return ctx.getImageData(0, 0, W, H).data; // Uint8ClampedArray RGBA
  });

  // ---- does anything need transparency? -------------------------------------
  let hasTransparency = false;
  for (const data of framePixels) {
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < ALPHA_CUTOFF) { hasTransparency = true; break; }
    }
    if (hasTransparency) break;
  }

  // Reserve a slot for transparency if needed; the colour palette gets the rest.
  const maxColors = hasTransparency ? 255 : 256;

  // ---- collect representative opaque samples for quantization ---------------
  // Sample (cap total samples) so a 60-frame few-hundred-px doc stays fast.
  const MAX_SAMPLES = 24000;
  const totalOpaqueEstimate = framePixels.length * W * H;
  const sampleStride = Math.max(1, Math.floor(totalOpaqueEstimate / MAX_SAMPLES));
  const samples = []; // flat [r,g,b, r,g,b, ...]
  {
    let counter = 0;
    for (const data of framePixels) {
      for (let p = 0; p < data.length; p += 4) {
        if (data[p + 3] < ALPHA_CUTOFF) continue; // skip transparent
        if ((counter++ % sampleStride) !== 0) continue;
        samples.push(data[p], data[p + 1], data[p + 2]);
      }
    }
  }
  // Degenerate fully-transparent doc: seed one colour so we still emit a GCT.
  if (samples.length === 0) samples.push(0, 0, 0);

  // ---- median-cut quantization ---------------------------------------------
  const palette = medianCut(samples, maxColors); // [[r,g,b], ...] length <= maxColors

  // Lay out the final colour table. Transparent index = last entry (if used).
  // colorTableSize must be a power of two >= 2.
  const colorCount = palette.length + (hasTransparency ? 1 : 0);
  let tableSize = 2;
  while (tableSize < colorCount) tableSize <<= 1;
  if (tableSize > 256) tableSize = 256;
  const gctBits = Math.log2(tableSize) | 0; // 1..8 -> stored as bits-1

  const transparentIndex = hasTransparency ? palette.length : -1;

  // Build flat colour table bytes (tableSize * 3), zero-padded.
  const colorTable = new Uint8Array(tableSize * 3);
  for (let i = 0; i < palette.length; i++) {
    colorTable[i * 3] = palette[i][0];
    colorTable[i * 3 + 1] = palette[i][1];
    colorTable[i * 3 + 2] = palette[i][2];
  }
  // transparent slot stays 0,0,0 (its colour is irrelevant)

  // ---- nearest-colour lookup with a coarse 5-bit-per-channel cache ----------
  // Cache key = (r>>3)<<10 | (g>>3)<<5 | (b>>3)  -> 32768 buckets.
  const nearestCache = new Int16Array(32768).fill(-1);
  function nearest(r, g, b) {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const cached = nearestCache[key];
    if (cached !== -1) return cached;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const pr = palette[i][0], pg = palette[i][1], pb = palette[i][2];
      const dr = r - pr, dg = g - pg, db = b - pb;
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) { bestD = d; best = i; if (d === 0) break; }
    }
    nearestCache[key] = best;
    return best;
  }

  // ---- assemble the byte stream ---------------------------------------------
  const out = new ByteWriter();

  // Header
  out.writeString('GIF89a');

  // Logical Screen Descriptor
  out.writeU16(W);
  out.writeU16(H);
  // packed: global colour table flag (1) | colour resolution (gctBits-1)<<4 |
  // sort flag 0 | gct size (gctBits-1)
  const packed = 0x80 | (((gctBits - 1) & 0x07) << 4) | ((gctBits - 1) & 0x07);
  out.writeByte(packed);
  out.writeByte(transparentIndex >= 0 ? 0 : 0); // background colour index
  out.writeByte(0); // pixel aspect ratio

  // Global Colour Table
  out.writeBytes(colorTable);

  // NETSCAPE2.0 looping extension (loop count 0 = infinite)
  if (loop) {
    out.writeByte(0x21); // extension introducer
    out.writeByte(0xFF); // application extension label
    out.writeByte(0x0B); // block size (11)
    out.writeString('NETSCAPE2.0');
    out.writeByte(0x03); // sub-block size
    out.writeByte(0x01); // sub-block id
    out.writeU16(0);     // loop count, 0 = forever
    out.writeByte(0x00); // block terminator
  }

  const delay = Math.max(1, Math.round(100 / fps)); // centiseconds

  for (let f = 0; f < framePixels.length; f++) {
    const data = framePixels[f];

    // Graphic Control Extension
    out.writeByte(0x21); // extension introducer
    out.writeByte(0xF9); // graphic control label
    out.writeByte(0x04); // block size
    // packed: reserved<<5 | disposal(2 = restore to bg)<<2 | userInput 0 |
    // transparentColorFlag
    const tFlag = transparentIndex >= 0 ? 1 : 0;
    out.writeByte((2 << 2) | tFlag);
    out.writeU16(delay);
    out.writeByte(transparentIndex >= 0 ? transparentIndex : 0);
    out.writeByte(0x00); // block terminator

    // Image Descriptor
    out.writeByte(0x2C); // image separator
    out.writeU16(0); // left
    out.writeU16(0); // top
    out.writeU16(W);
    out.writeU16(H);
    out.writeByte(0x00); // no local colour table, not interlaced

    // Build the index buffer for this frame.
    const indices = new Uint8Array(W * H);
    for (let p = 0, q = 0; p < data.length; p += 4, q++) {
      if (transparentIndex >= 0 && data[p + 3] < ALPHA_CUTOFF) {
        indices[q] = transparentIndex;
      } else {
        indices[q] = nearest(data[p], data[p + 1], data[p + 2]);
      }
    }

    // LZW minimum code size: at least 2 bits per the GIF spec.
    const minCodeSize = Math.max(2, gctBits);
    out.writeByte(minCodeSize);
    lzwEncode(indices, minCodeSize, out);
  }

  out.writeByte(0x3B); // trailer
  return new Blob([out.toUint8Array()], { type: 'image/gif' });
}

// ===========================================================================
// Median-cut quantizer. Operates on a flat [r,g,b,...] sample array, returns
// up to `maxColors` palette entries as [r,g,b] triples.
// ===========================================================================
function medianCut(samples, maxColors) {
  const count = samples.length / 3;
  if (count === 0) return [[0, 0, 0]];

  // index list into the samples array (one entry per pixel)
  const idx = new Uint32Array(count);
  for (let i = 0; i < count; i++) idx[i] = i;

  function boxFor(lo, hi) {
    let rMin = 255, gMin = 255, bMin = 255, rMax = 0, gMax = 0, bMax = 0;
    for (let i = lo; i < hi; i++) {
      const o = idx[i] * 3;
      const r = samples[o], g = samples[o + 1], b = samples[o + 2];
      if (r < rMin) rMin = r; if (r > rMax) rMax = r;
      if (g < gMin) gMin = g; if (g > gMax) gMax = g;
      if (b < bMin) bMin = b; if (b > bMax) bMax = b;
    }
    return { lo, hi, rMin, gMin, bMin, rMax, gMax, bMax };
  }

  const boxes = [boxFor(0, count)];

  function pickBox() {
    // Split the box with the largest single-channel range and >1 pixel.
    let best = -1, bestRange = -1;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.hi - b.lo < 2) continue;
      const range = Math.max(b.rMax - b.rMin, b.gMax - b.gMin, b.bMax - b.bMin);
      if (range > bestRange) { bestRange = range; best = i; }
    }
    return best;
  }

  while (boxes.length < maxColors) {
    const bi = pickBox();
    if (bi < 0) break;
    const box = boxes[bi];
    // longest axis
    const rR = box.rMax - box.rMin, gR = box.gMax - box.gMin, bR = box.bMax - box.bMin;
    const axis = rR >= gR && rR >= bR ? 0 : (gR >= bR ? 1 : 2);

    // sort this box's slice of idx by the chosen channel, then split at median
    const slice = Array.prototype.slice.call(idx.subarray(box.lo, box.hi));
    slice.sort((a, b2) => samples[a * 3 + axis] - samples[b2 * 3 + axis]);
    for (let i = 0; i < slice.length; i++) idx[box.lo + i] = slice[i];

    const mid = box.lo + (slice.length >> 1);
    boxes.splice(bi, 1, boxFor(box.lo, mid), boxFor(mid, box.hi));
  }

  // average colour of each box = palette entry
  const palette = [];
  for (const box of boxes) {
    let r = 0, g = 0, b = 0; const n = box.hi - box.lo;
    if (n === 0) { palette.push([0, 0, 0]); continue; }
    for (let i = box.lo; i < box.hi; i++) {
      const o = idx[i] * 3;
      r += samples[o]; g += samples[o + 1]; b += samples[o + 2];
    }
    palette.push([Math.round(r / n), Math.round(g / n), Math.round(b / n)]);
  }
  return palette;
}

// ===========================================================================
// Standard GIF variable-width LZW encoder. Emits clear & EOI codes, grows the
// code width as the table fills, and writes the compressed stream as GIF
// sub-blocks (each <= 255 bytes, terminated by a 0x00 length byte).
// ===========================================================================
function lzwEncode(indices, minCodeSize, out) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;

  // dictionary: maps "prefixCode,k" -> code. Use a plain object keyed by number
  // (prefix * 256 + k) which is unique because k is a single index byte.
  let dict = Object.create(null);
  function resetDict() {
    dict = Object.create(null);
    codeSize = minCodeSize + 1;
    nextCode = eoiCode + 1;
  }

  // bit-packer (LSB-first) feeding GIF sub-blocks
  const sub = new SubBlockWriter(out);
  let bitBuf = 0, bitCount = 0;
  function emit(code) {
    bitBuf |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      sub.writeByte(bitBuf & 0xFF);
      bitBuf >>= 8;
      bitCount -= 8;
    }
  }

  emit(clearCode);

  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 256 + k;
    const found = dict[key];
    if (found !== undefined) {
      prefix = found;
    } else {
      emit(prefix);
      dict[key] = nextCode++;
      if (nextCode > (1 << codeSize) && codeSize < 12) {
        codeSize++;
      }
      if (nextCode > 4095) {
        emit(clearCode);
        resetDict();
      }
      prefix = k;
    }
  }
  emit(prefix);
  emit(eoiCode);

  // flush remaining bits
  if (bitCount > 0) sub.writeByte(bitBuf & 0xFF);
  sub.flush();
}

// ===========================================================================
// Helpers
// ===========================================================================

// Growable little-endian byte writer.
class ByteWriter {
  constructor() { this.buf = new Uint8Array(1 << 16); this.len = 0; }
  _ensure(n) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.len + n) cap <<= 1;
    const nb = new Uint8Array(cap); nb.set(this.buf.subarray(0, this.len)); this.buf = nb;
  }
  writeByte(b) { this._ensure(1); this.buf[this.len++] = b & 0xFF; }
  writeU16(v) { this._ensure(2); this.buf[this.len++] = v & 0xFF; this.buf[this.len++] = (v >> 8) & 0xFF; }
  writeBytes(arr) { this._ensure(arr.length); this.buf.set(arr, this.len); this.len += arr.length; }
  writeString(s) { this._ensure(s.length); for (let i = 0; i < s.length; i++) this.buf[this.len++] = s.charCodeAt(i) & 0xFF; }
  toUint8Array() { return this.buf.subarray(0, this.len); }
}

// Accumulates LZW output bytes into GIF sub-blocks (max 255 bytes each, each
// prefixed by its length; the chain ends with a 0x00 length byte).
class SubBlockWriter {
  constructor(out) { this.out = out; this.chunk = new Uint8Array(255); this.n = 0; }
  writeByte(b) {
    this.chunk[this.n++] = b & 0xFF;
    if (this.n === 255) this._flushChunk();
  }
  _flushChunk() {
    if (this.n === 0) return;
    this.out.writeByte(this.n);
    this.out.writeBytes(this.chunk.subarray(0, this.n));
    this.n = 0;
  }
  flush() {
    this._flushChunk();
    this.out.writeByte(0x00); // block terminator
  }
}
