/**
 * Animation data model — cel-based (reusable drawings). Pure and
 * DOM-free so it's unit-testable. SCAFFOLD ONLY: not yet wired into the editor;
 * see documentation/painting-suite/ANIMATION.md for the full plan + build phases.
 *
 * Core idea: cels are reusable drawings; the timeline maps
 * `frame → celId`, and an unassigned frame HOLDS the previous cel ("no redraw"),
 * which is what makes 2D animation efficient. A cel's pixels live in a normal
 * editor layer (`cel.layerId`), so every paint tool works on it for free.
 */

export function createAnimationDoc({ fps = 12, frameCount = 24 } = {}) {
  return { fps, frameCount, tracks: [], camera: null, currentFrame: 0, _nextId: 1 };
}

function nextId(doc, prefix) { return `${prefix}-${doc._nextId++}`; }

export function addTrack(doc, name = 'Animation') {
  const track = { id: nextId(doc, 'trk'), name, visible: true, cels: [], frameMap: {}, holdLast: true };
  doc.tracks.push(track);
  return track;
}

export function addCel(doc, track, layerId, name) {
  const cel = { id: nextId(doc, 'cel'), name: name || `Cel ${track.cels.length + 1}`, layerId };
  track.cels.push(cel);
  return cel;
}

export function setFrameCel(track, frame, celId) {
  if (celId == null) delete track.frameMap[frame];
  else track.frameMap[frame] = celId;
}

/**
 * Resolve which cel is shown at `frame`. With holdLast (default), an unassigned
 * frame holds the most recent cel assigned at or before it ("no redraw" hold).
 */
export function celAtFrame(track, frame) {
  if (track.frameMap[frame] != null) return track.frameMap[frame];
  if (!track.holdLast) return null;
  let best = null, bestF = -1;
  for (const k of Object.keys(track.frameMap)) {
    const f = parseInt(k, 10);
    if (f <= frame && f > bestF) { bestF = f; best = track.frameMap[k]; }
  }
  return best;
}

export function defaultOnionSkin() {
  return { enabled: false, before: 2, after: 2, beforeTint: '#ff5555', afterTint: '#55aaff', opacity: 0.3 };
}

/** Neighbour frames to draw as onion skin, with tint + linear falloff. */
export function onionFrames(frame, onion) {
  if (!onion || !onion.enabled) return [];
  const out = [];
  const op = onion.opacity != null ? onion.opacity : 0.3;
  for (let i = 1; i <= (onion.before || 0); i++) {
    const f = frame - i;
    if (f >= 0) out.push({ frame: f, tint: onion.beforeTint || '#ff5555', alpha: op * (1 - (i - 1) / Math.max(1, onion.before)) });
  }
  for (let i = 1; i <= (onion.after || 0); i++) {
    out.push({ frame: frame + i, tint: onion.afterTint || '#55aaff', alpha: op * (1 - (i - 1) / Math.max(1, onion.after)) });
  }
  return out;
}

function pick(k) { return { x: k.x || 0, y: k.y || 0, zoom: k.zoom != null ? k.zoom : 1, rot: k.rot || 0 }; }
function lerp(a, b, t) { return a + (b - a) * t; }

/** Interpolated 2D camera transform at `frame` (linear / smooth / hold). */
export function cameraAt(camera, frame) {
  if (!camera || !camera.keys || !camera.keys.length) return { x: 0, y: 0, zoom: 1, rot: 0 };
  const keys = camera.keys.slice().sort((a, b) => a.frame - b.frame);
  if (frame <= keys[0].frame) return pick(keys[0]);
  if (frame >= keys[keys.length - 1].frame) return pick(keys[keys.length - 1]);
  let a = keys[0], b = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (frame >= keys[i].frame && frame <= keys[i + 1].frame) { a = keys[i]; b = keys[i + 1]; break; }
  }
  if (camera.interpolation === 'hold') return pick(a);
  let t = (frame - a.frame) / Math.max(1, b.frame - a.frame);
  if (camera.interpolation === 'smooth') t = t * t * (3 - 2 * t); // smoothstep
  return {
    x: lerp(a.x || 0, b.x || 0, t),
    y: lerp(a.y || 0, b.y || 0, t),
    zoom: lerp(a.zoom != null ? a.zoom : 1, b.zoom != null ? b.zoom : 1, t),
    rot: lerp(a.rot || 0, b.rot || 0, t),
  };
}
