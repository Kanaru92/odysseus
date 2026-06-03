/**
 * Pattern resource store for the editor.
 *
 * A small library of tileable patterns usable by pattern fill layers (and,
 * later, pattern overlay layer-style / pattern stamp / dual brush). Ships a set
 * of procedurally-generated built-ins (deterministic, so they're identical every
 * session) and lets the user define a pattern from a canvas (e.g. the active
 * layer). Built-ins are synchronous, so `getPattern()` is safe to call from the
 * fill-layer render path.
 *
 * Neutral, generic names only — no third-party brand names (see project rule).
 *
 * Increment 1 ships built-ins + in-session user patterns (define-from-layer).
 * Cross-reload persistence of user patterns is a follow-up (needs async image
 * decode, which the synchronous render path can't wait on).
 */

let _builtins = null;     // [{ id, name, canvas }]
const _user = [];          // [{ id, name, canvas }] — defined this session
let _userSeq = 0;

function mk(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}

// Deterministic PRNG (mulberry32) so the noise tile is stable across sessions.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildBuiltins() {
  const out = [];
  out.push({ id: 'b-checker', name: 'Checkerboard', canvas: mk(32, 32, (x) => {
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 32, 32);
    x.fillStyle = '#c8c8c8'; x.fillRect(0, 0, 16, 16); x.fillRect(16, 16, 16, 16);
  }) });
  out.push({ id: 'b-dots', name: 'Dots', canvas: mk(24, 24, (x) => {
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 24, 24);
    x.fillStyle = '#808080'; x.beginPath(); x.arc(12, 12, 4, 0, Math.PI * 2); x.fill();
  }) });
  out.push({ id: 'b-diag', name: 'Diagonal Lines', canvas: mk(16, 16, (x) => {
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 16, 16);
    x.strokeStyle = '#999999'; x.lineWidth = 3; x.beginPath();
    x.moveTo(-4, 12); x.lineTo(12, -4); x.moveTo(4, 20); x.lineTo(20, 4); x.stroke();
  }) });
  out.push({ id: 'b-grid', name: 'Grid', canvas: mk(24, 24, (x) => {
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 24, 24);
    x.strokeStyle = '#b0b0b0'; x.lineWidth = 1; x.strokeRect(0.5, 0.5, 23, 23);
  }) });
  out.push({ id: 'b-cross', name: 'Crosshatch', canvas: mk(16, 16, (x) => {
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 16, 16);
    x.strokeStyle = '#9a9a9a'; x.lineWidth = 1.5; x.beginPath();
    x.moveTo(-4, 12); x.lineTo(12, -4); x.moveTo(4, 20); x.lineTo(20, 4);
    x.moveTo(-4, 4); x.lineTo(12, 20); x.moveTo(4, -4); x.lineTo(20, 12); x.stroke();
  }) });
  out.push({ id: 'b-bricks', name: 'Bricks', canvas: mk(32, 16, (x) => {
    x.fillStyle = '#d9d2c7'; x.fillRect(0, 0, 32, 16);
    x.strokeStyle = '#9c8f7d'; x.lineWidth = 1.5;
    x.strokeRect(0, 0.75, 32, 7.5); x.strokeRect(0, 8.25, 32, 7.5);
    x.beginPath(); x.moveTo(16, 0); x.lineTo(16, 8); x.moveTo(0, 8); x.lineTo(0, 16); x.moveTo(32, 8); x.lineTo(32, 16); x.moveTo(8, 8); x.lineTo(8, 16); x.moveTo(24, 8); x.lineTo(24, 16); x.stroke();
  }) });
  out.push({ id: 'b-noise', name: 'Noise', canvas: mk(64, 64, (x, w, h) => {
    const rnd = seeded(0x9e3779b9);
    const img = x.createImageData(w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const v = (rnd() * 256) | 0; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    x.putImageData(img, 0, 0);
  }) });
  return out;
}

/** All patterns (built-ins first, then user-defined). */
export function getPatterns() {
  if (!_builtins) _builtins = buildBuiltins();
  return _builtins.concat(_user);
}

/** Look up one pattern by id, or null. */
export function getPattern(id) {
  return getPatterns().find((p) => p.id === id) || null;
}

/** Default pattern id (first built-in). */
export function defaultPatternId() {
  return getPatterns()[0]?.id || null;
}

/**
 * Define a new user pattern from a canvas (cloned so later edits to the source
 * don't mutate the stored tile). Returns the new pattern's id. In-session only
 * for now (not persisted across reloads).
 */
export function definePattern(name, srcCanvas) {
  if (!srcCanvas || !srcCanvas.width || !srcCanvas.height) return null;
  const c = document.createElement('canvas');
  c.width = srcCanvas.width; c.height = srcCanvas.height;
  c.getContext('2d').drawImage(srcCanvas, 0, 0);
  const id = 'u-' + (++_userSeq);
  _user.push({ id, name: name || ('Pattern ' + _userSeq), canvas: c });
  return id;
}
