/**
 * 3D LUT (colour lookup) engine — parse a 3D-LUT text file and apply it to
 * a canvas via trilinear interpolation. Pure colour math; the only DOM touch
 * is `applyLut`, which takes a source canvas and returns a fresh one (mirrors
 * the `applyAdjustment` contract in pixel-pass.js).
 *
 * A 3D LUT maps an input RGB cube to an output RGB cube. The standard
 * interchange text format declares a per-axis grid `LUT_3D_SIZE N`, then
 * `N*N*N` rows of `r g b` triples in `[0,1]` (after the optional domain
 * remap), ordered with the RED axis varying fastest, then green, then blue.
 *
 * Internal LUT shape (what `parseCube` returns and `sampleLut`/`applyLut`
 * consume):
 *
 *   {
 *     size:    number,        // grid resolution N per axis
 *     data:    Float32Array,  // length N*N*N*3, values 0..1, R-fastest order
 *     domainMin: [r,g,b],     // input domain low  (default [0,0,0])
 *     domainMax: [r,g,b],     // input domain high (default [1,1,1])
 *     title?:  string,
 *   }
 *
 * The LUT object is deliberately serialisation-cheap to *omit*: it can carry
 * megabytes of grid data, so it is stored in a module-level Map keyed by a
 * short id (see `registerLut`) and the adjustment params only hold that id —
 * keeping the adjustment memo-key in pixel-pass small.
 */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Parse a `.cube`-style 3D LUT text file.
 *
 * Supported directives: `LUT_3D_SIZE N`, `TITLE "..."`, `DOMAIN_MIN r g b`,
 * `DOMAIN_MAX r g b`. Blank lines and `#` comments are ignored. 1D LUTs
 * (`LUT_1D_SIZE`) are explicitly rejected — this engine is 3D only.
 *
 * @param {string} text  Raw file contents.
 * @returns {{size:number, data:Float32Array, domainMin:number[], domainMax:number[], title?:string}}
 * @throws {Error} on a missing/invalid size or a wrong table-row count.
 */
export function parseCube(text) {
  if (typeof text !== 'string') throw new Error('parseCube: expected text');
  let size = 0;
  let title;
  let domainMin = [0, 0, 0];
  let domainMax = [1, 1, 1];
  const rows = [];

  const lines = text.split(/\r?\n/);
  for (let li = 0; li < lines.length; li++) {
    let line = lines[li];
    const hash = line.indexOf('#');
    if (hash !== -1) line = line.slice(0, hash);
    line = line.trim();
    if (!line) continue;

    // Directive lines start with a known keyword; everything else is a data row.
    const upper = line.toUpperCase();
    if (upper.startsWith('LUT_3D_SIZE')) {
      size = parseInt(line.split(/\s+/)[1], 10);
      continue;
    }
    if (upper.startsWith('LUT_1D_SIZE')) {
      throw new Error('parseCube: 1D LUTs are not supported (need LUT_3D_SIZE)');
    }
    if (upper.startsWith('TITLE')) {
      const m = /TITLE\s+"?([^"]*)"?/i.exec(line);
      if (m) title = m[1].trim();
      continue;
    }
    if (upper.startsWith('DOMAIN_MIN')) {
      const p = line.split(/\s+/).slice(1).map(Number);
      if (p.length >= 3 && p.every((n) => Number.isFinite(n))) domainMin = [p[0], p[1], p[2]];
      continue;
    }
    if (upper.startsWith('DOMAIN_MAX')) {
      const p = line.split(/\s+/).slice(1).map(Number);
      if (p.length >= 3 && p.every((n) => Number.isFinite(n))) domainMax = [p[0], p[1], p[2]];
      continue;
    }

    // Data row: three floats. Anything else is a parse error.
    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;
    const r = Number(parts[0]);
    const g = Number(parts[1]);
    const b = Number(parts[2]);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
      throw new Error(`parseCube: non-numeric data on line ${li + 1}`);
    }
    rows.push(r, g, b);
  }

  if (!Number.isFinite(size) || size < 2) {
    throw new Error('parseCube: missing or invalid LUT_3D_SIZE');
  }
  const expected = size * size * size;
  if (rows.length / 3 !== expected) {
    throw new Error(`parseCube: expected ${expected} entries for size ${size}, got ${rows.length / 3}`);
  }

  return { size, data: Float32Array.from(rows), domainMin, domainMax, title };
}


/**
 * Index into the flat LUT grid. The interchange order is RED-fastest:
 * idx = (b*size + g)*size + r, each entry being 3 floats.
 */
function gridOffset(size, r, g, b) {
  return ((b * size + g) * size + r) * 3;
}


/**
 * Sample the LUT at a normalised input colour using trilinear interpolation.
 * Pure: no canvas, no allocation beyond the returned 3-tuple. Inputs and
 * outputs are in `[0,1]`.
 *
 * @param {{size:number, data:Float32Array, domainMin?:number[], domainMax?:number[]}} lut
 * @param {number} r 0..1
 * @param {number} g 0..1
 * @param {number} b 0..1
 * @param {number[]} [out] optional 3-element target to write into (avoids GC).
 * @returns {number[]} [r,g,b] in 0..1
 */
export function sampleLut(lut, r, g, b, out) {
  const size = lut.size;
  const data = lut.data;
  const dmin = lut.domainMin || [0, 0, 0];
  const dmax = lut.domainMax || [1, 1, 1];
  const res = out || [0, 0, 0];

  // Map the input through the domain into [0, size-1] grid coordinates.
  const last = size - 1;
  const norm = (v, lo, hi) => {
    const span = hi - lo;
    const t = span === 0 ? 0 : (v - lo) / span;
    return clamp01(t) * last;
  };
  const fr = norm(r, dmin[0], dmax[0]);
  const fg = norm(g, dmin[1], dmax[1]);
  const fb = norm(b, dmin[2], dmax[2]);

  const r0 = Math.floor(fr), g0 = Math.floor(fg), b0 = Math.floor(fb);
  const r1 = r0 < last ? r0 + 1 : r0;
  const g1 = g0 < last ? g0 + 1 : g0;
  const b1 = b0 < last ? b0 + 1 : b0;
  const dr = fr - r0, dg = fg - g0, db = fb - b0;

  // Eight corner offsets of the enclosing cell.
  const c000 = gridOffset(size, r0, g0, b0);
  const c100 = gridOffset(size, r1, g0, b0);
  const c010 = gridOffset(size, r0, g1, b0);
  const c110 = gridOffset(size, r1, g1, b0);
  const c001 = gridOffset(size, r0, g0, b1);
  const c101 = gridOffset(size, r1, g0, b1);
  const c011 = gridOffset(size, r0, g1, b1);
  const c111 = gridOffset(size, r1, g1, b1);

  for (let ch = 0; ch < 3; ch++) {
    // Interpolate along R, then G, then B (standard trilinear).
    const x00 = data[c000 + ch] * (1 - dr) + data[c100 + ch] * dr;
    const x10 = data[c010 + ch] * (1 - dr) + data[c110 + ch] * dr;
    const x01 = data[c001 + ch] * (1 - dr) + data[c101 + ch] * dr;
    const x11 = data[c011 + ch] * (1 - dr) + data[c111 + ch] * dr;
    const y0 = x00 * (1 - dg) + x10 * dg;
    const y1 = x01 * (1 - dg) + x11 * dg;
    res[ch] = y0 * (1 - db) + y1 * db;
  }
  return res;
}


/**
 * Build an identity LUT of the given grid size (input === output). Handy as
 * a default / for tests; also useful as a "no-op" placeholder.
 *
 * @param {number} size grid resolution per axis (>= 2)
 * @returns {{size:number, data:Float32Array, domainMin:number[], domainMax:number[]}}
 */
export function identityLut(size = 2) {
  const n = Math.max(2, size | 0);
  const last = n - 1;
  const data = new Float32Array(n * n * n * 3);
  for (let b = 0; b < n; b++) {
    for (let g = 0; g < n; g++) {
      for (let r = 0; r < n; r++) {
        const o = gridOffset(n, r, g, b);
        data[o] = r / last;
        data[o + 1] = g / last;
        data[o + 2] = b / last;
      }
    }
  }
  return { size: n, data, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
}


/**
 * Apply a 3D LUT to a source canvas and return a NEW canvas of the same
 * dimensions. Alpha is preserved unchanged. An optional `amount` (0..1)
 * blends the graded result back toward the source for partial strength.
 *
 * Matches the `applyAdjustment(srcCanvas, adj) -> canvas` contract so the
 * pixel-pass FX stack can drop it in directly.
 *
 * @param {HTMLCanvasElement|OffscreenCanvas} srcCanvas
 * @param {{size:number, data:Float32Array, domainMin?:number[], domainMax?:number[]}} lut
 * @param {{amount?:number}} [opts] amount 0..1 (default 1 = full strength)
 * @returns {HTMLCanvasElement} graded canvas
 */
export function applyLut(srcCanvas, lut, opts) {
  const amount = opts && opts.amount != null ? clamp01(opts.amount) : 1;
  const w = srcCanvas.width, h = srcCanvas.height;
  const out = (typeof document !== 'undefined')
    ? document.createElement('canvas')
    : new OffscreenCanvas(w, h);
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  octx.drawImage(srcCanvas, 0, 0);

  if (!lut || !lut.size || amount === 0) return out; // nothing to do

  const img = octx.getImageData(0, 0, w, h);
  const d = img.data;
  const inv = 1 / 255;
  const tmp = [0, 0, 0];
  const blend = amount < 1;
  for (let i = 0; i < d.length; i += 4) {
    sampleLut(lut, d[i] * inv, d[i + 1] * inv, d[i + 2] * inv, tmp);
    let nr = tmp[0] * 255, ng = tmp[1] * 255, nb = tmp[2] * 255;
    if (blend) {
      nr = d[i] + (nr - d[i]) * amount;
      ng = d[i + 1] + (ng - d[i + 1]) * amount;
      nb = d[i + 2] + (nb - d[i + 2]) * amount;
    }
    // Uint8ClampedArray clamps + rounds on assignment.
    d[i] = nr; d[i + 1] = ng; d[i + 2] = nb;
    // d[i+3] (alpha) left untouched.
  }
  octx.putImageData(img, 0, 0);
  return out;
}


/* ------------------------------------------------------------------ *
 * LUT store — keep heavy grid data OUT of serialised adjustment params.
 *
 * An adjustment's params hold only a short `lutId` (plus display name and
 * amount). The Float32Array grid lives here, keyed by that id, so the
 * adjustment memo-key (a JSON.stringify of params in pixel-pass) stays tiny
 * and a single imported LUT is shared by every layer that references it.
 * ------------------------------------------------------------------ */

const lutStore = new Map();
let _lutSeq = 0;

/**
 * Register a parsed LUT and return its id. Pass an explicit id to overwrite
 * (e.g. when re-importing the same slot); otherwise a fresh id is minted.
 *
 * @param {object} lut a parseCube/identityLut result
 * @param {{id?:string, name?:string}} [meta]
 * @returns {string} the id to store in adjustment params
 */
export function registerLut(lut, meta) {
  const id = (meta && meta.id) || `lut-${(++_lutSeq).toString(36)}-${Date.now().toString(36)}`;
  lutStore.set(id, { lut, name: (meta && meta.name) || lut.title || 'Color Lookup' });
  return id;
}

/** Retrieve a registered LUT object by id, or undefined. */
export function getLut(id) {
  const e = lutStore.get(id);
  return e ? e.lut : undefined;
}

/** Retrieve the display name registered for a LUT id, or undefined. */
export function getLutName(id) {
  const e = lutStore.get(id);
  return e ? e.name : undefined;
}

/** True if a LUT is registered under this id. */
export function hasLut(id) {
  return lutStore.has(id);
}

/** Forget a registered LUT (frees its grid data). Returns true if removed. */
export function removeLut(id) {
  return lutStore.delete(id);
}

/** Convenience: parse + register in one step. Returns the id. */
export function registerCube(text, meta) {
  const lut = parseCube(text);
  return registerLut(lut, { name: (meta && meta.name) || lut.title, id: meta && meta.id });
}
