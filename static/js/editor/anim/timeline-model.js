/**
 * Timeline data model — the PURE, serializable structure for a cel-based,
 * timeline-driven 2D animation document (industry-standard hand-drawn workflow).
 * NO rendering, NO DOM: this module only owns structure + timing so it can be
 * unit-tested headlessly and round-tripped to/from a draft payload.
 *
 * It complements the existing `model.js` scaffold (cel resolution / onion /
 * camera helpers) with the document-level concerns the animation spec calls for:
 * an explicit playback sub-range, frame<->time conversion, range-aware playback
 * stepping, and a versioned serialize/deserialize. Pixel data is NOT stored
 * here — a cel references an editor layer by `layerId`, so every paint tool,
 * mask and blend works on a cel for free, and the layer's pixels are persisted
 * as part of the normal layer save (the cel only needs its `layerId` to survive).
 *
 * Shape (all plain JSON-serializable values):
 *
 *   TimelineDoc {
 *     schemaVersion: int        // for forward migration
 *     fps:           int        // frames per second (1..120)
 *     durationFrames:int        // total document length in frames (>=1)
 *     currentFrame:  int        // 0-based playhead, clamped to [0, durationFrames-1]
 *     playRange:     [a,b]      // inclusive in/out sub-range; clamped to the doc
 *     loop:          'once' | 'loop' | 'pingpong'
 *     tracks:        Track[]    // cel tracks, each mapping layer ids to frame spans
 *     _nextId:       int        // monotonic id allocator
 *   }
 *
 *   Track {
 *     id:        str            // "trk-N"
 *     name:      str
 *     visible:   bool
 *     locked:    bool
 *     holdLast:  bool           // unassigned frame holds the most recent cel
 *     cels:      Cel[]          // reusable drawings on this track
 *     frameMap:  { [frame]: celId }  // sparse: which cel is PLACED at a frame
 *   }
 *
 *   Cel { id: str, name: str, layerId: str|null }
 *
 * `playRange` is intentionally distinct from `durationFrames`: a user can scrub /
 * preview / export a sub-section without truncating the document. It is stored as
 * a 2-tuple [in, out] (both inclusive, in <= out) and is always re-clamped after
 * any mutation that could shrink the document.
 */

export const TIMELINE_SCHEMA_VERSION = 1;

export const FPS_MIN = 1;
export const FPS_MAX = 120;

export const LOOP_MODES = ['once', 'loop', 'pingpong'];

/* ------------------------------------------------------------------ helpers */

function clampInt(v, lo, hi) {
  v = Math.round(Number(v));
  if (!Number.isFinite(v)) v = lo;
  if (v < lo) v = lo;
  if (v > hi) v = hi;
  return v;
}

function nextId(doc, prefix) {
  return `${prefix}-${doc._nextId++}`;
}

/** Re-clamp the playhead + play range so they stay valid for the current length. */
function reconcile(doc) {
  const last = Math.max(0, (doc.durationFrames | 0) - 1);
  doc.currentFrame = clampInt(doc.currentFrame, 0, last);
  let [a, b] = doc.playRange;
  a = clampInt(a, 0, last);
  b = clampInt(b, 0, last);
  if (a > b) { const t = a; a = b; b = t; }
  doc.playRange = [a, b];
  return doc;
}

/* ------------------------------------------------------------------ factory */

export function createTimelineDoc({ fps = 24, durationFrames = 24 } = {}) {
  const doc = {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    fps: clampInt(fps, FPS_MIN, FPS_MAX),
    durationFrames: Math.max(1, clampInt(durationFrames, 1, 1e7)),
    currentFrame: 0,
    playRange: [0, 0],
    loop: 'loop',
    tracks: [],
    _nextId: 1,
  };
  doc.playRange = [0, doc.durationFrames - 1];
  return doc;
}

/* ------------------------------------------------------------------ tracks  */

export function addTrack(doc, name) {
  const track = {
    id: nextId(doc, 'trk'),
    name: name || `Track ${doc.tracks.length + 1}`,
    visible: true,
    locked: false,
    holdLast: true,
    cels: [],
    frameMap: {},
  };
  doc.tracks.push(track);
  return track;
}

export function removeTrack(doc, trackId) {
  const i = doc.tracks.findIndex((t) => t.id === trackId);
  if (i < 0) return false;
  doc.tracks.splice(i, 1);
  return true;
}

export function getTrack(doc, trackId) {
  return doc.tracks.find((t) => t.id === trackId) || null;
}

/* ------------------------------------------------------------------ cels    */

/**
 * Create a reusable cel on a track. If `frame` is given, the cel is also placed
 * at that frame (and the document is grown to include it).
 */
export function addCel(doc, track, { layerId = null, name, frame = null } = {}) {
  if (typeof track === 'string') track = getTrack(doc, track);
  if (!track) throw new Error('addCel: unknown track');
  const cel = {
    id: nextId(doc, 'cel'),
    name: name || String(track.cels.length + 1),
    layerId,
  };
  track.cels.push(cel);
  if (frame != null) placeCel(doc, track, clampInt(frame, 0, 1e7), cel.id);
  return cel;
}

export function getCel(track, celId) {
  return track.cels.find((c) => c.id === celId) || null;
}

/**
 * Place an existing cel at a frame ("assign"). Passing `celId == null` clears the
 * frame so it HOLDS the previous cel (the "no redraw" hold). Grows the document
 * if the frame is beyond the current end.
 */
export function placeCel(doc, track, frame, celId) {
  if (typeof track === 'string') track = getTrack(doc, track);
  if (!track) throw new Error('placeCel: unknown track');
  frame = clampInt(frame, 0, 1e7);
  if (celId == null) {
    delete track.frameMap[frame];
  } else {
    if (!getCel(track, celId)) throw new Error('placeCel: unknown cel ' + celId);
    track.frameMap[frame] = celId;
    if (frame + 1 > doc.durationFrames) setDuration(doc, frame + 1);
  }
  return track;
}

/** Clear the placement at `frame` (the frame then holds the previous cel). */
export function clearCel(doc, track, frame) {
  return placeCel(doc, track, frame, null);
}

/**
 * Move a placed cel from `fromFrame` to `toFrame` (drag-to-retime). With
 * `copy:true` the source placement is kept (Alt+drag duplicate). O(1) map edits;
 * never touches pixels. Returns true if a placement was moved/copied.
 */
export function moveCel(doc, track, fromFrame, toFrame, { copy = false } = {}) {
  if (typeof track === 'string') track = getTrack(doc, track);
  if (!track) throw new Error('moveCel: unknown track');
  fromFrame = clampInt(fromFrame, 0, 1e7);
  toFrame = clampInt(toFrame, 0, 1e7);
  const celId = track.frameMap[fromFrame];
  if (celId == null) return false;
  if (!copy) delete track.frameMap[fromFrame];
  track.frameMap[toFrame] = celId;
  if (toFrame + 1 > doc.durationFrames) setDuration(doc, toFrame + 1);
  return true;
}

/**
 * Resolve which cel id is shown on a track at `frame`. With `holdLast` (default)
 * an unassigned frame holds the most recent cel placed at or before it. Returns
 * null when nothing is visible (no prior placement, or hold disabled).
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

/* ------------------------------------------------------------------ mutators */

export function setFps(doc, fps) {
  // fps only changes playback speed; cel assignments are absolute frame indices
  // and are left untouched (spec §2.6).
  doc.fps = clampInt(fps, FPS_MIN, FPS_MAX);
  return doc;
}

export function setDuration(doc, durationFrames) {
  doc.durationFrames = Math.max(1, clampInt(durationFrames, 1, 1e7));
  return reconcile(doc);
}

export function setFrame(doc, frame) {
  doc.currentFrame = clampInt(frame, 0, Math.max(0, doc.durationFrames - 1));
  return doc.currentFrame;
}

export function setLoopMode(doc, mode) {
  if (LOOP_MODES.indexOf(mode) >= 0) doc.loop = mode;
  return doc.loop;
}

/**
 * Set the playback/export sub-range (inclusive). Accepts (doc, a, b). Values are
 * clamped to the document and ordered so in <= out. Passing null/undefined for a
 * bound resets that bound to the document edge.
 */
export function setPlayRange(doc, a, b) {
  const last = Math.max(0, doc.durationFrames - 1);
  let inF = a == null ? 0 : clampInt(a, 0, last);
  let outF = b == null ? last : clampInt(b, 0, last);
  if (inF > outF) { const t = inF; inF = outF; outF = t; }
  doc.playRange = [inF, outF];
  return doc.playRange;
}

/* ------------------------------------------------------------ playback math */

/** Length of the active play range in frames (inclusive bounds). */
export function rangeLength(doc) {
  const [a, b] = doc.playRange;
  return (b - a) + 1;
}

/** Total document duration in seconds (durationFrames / fps). */
export function durationSeconds(doc) {
  return doc.durationFrames / Math.max(1, doc.fps);
}

/**
 * The frame that should be shown at wall-clock time `seconds` from the start of
 * the play range, honouring the loop mode. Deterministic and side-effect free —
 * playback drivers (rAF loops) call this with elapsed time; tests call it with
 * fixed inputs. Frames are clamped to the play range, NOT the whole document.
 */
export function frameAtTime(doc, seconds) {
  const [a, b] = doc.playRange;
  const len = (b - a) + 1;
  if (len <= 1 || seconds <= 0) return a;
  const fps = Math.max(1, doc.fps);
  let idx = Math.floor(seconds * fps); // frames elapsed since range start
  if (doc.loop === 'once') {
    return a + Math.min(idx, len - 1);
  }
  if (doc.loop === 'pingpong') {
    // bounce over a period of (len-1)*2 frames: 0..len-1..1
    const period = (len - 1) * 2;
    idx %= period;
    if (idx >= len) idx = period - idx;
    return a + idx;
  }
  // 'loop'
  return a + (idx % len);
}

/**
 * Advance the playhead by `delta` frames within the play range, honouring the
 * loop mode. Returns { frame, dir, stopped } where `dir` is the next ping-pong
 * direction (so a stateful driver can persist it) and `stopped` is true when a
 * 'once' run reaches the end. Pure: it does not mutate the doc — callers apply
 * the returned frame via setFrame() if they want to commit it.
 *
 * @param {number} delta  signed frames to step (usually +1 or -1)
 * @param {1|-1}   dir    current ping-pong direction (default +1)
 */
export function advance(doc, delta = 1, dir = 1) {
  const [a, b] = doc.playRange;
  const len = (b - a) + 1;
  if (len <= 1) return { frame: a, dir, stopped: doc.loop === 'once' };

  // Start from the playhead, but if it's outside the range, snap it in first.
  let f = clampInt(doc.currentFrame, a, b);
  const step = delta * dir;
  let nf = f + step;
  let stopped = false;

  if (doc.loop === 'pingpong') {
    if (nf > b) { nf = b - 1; dir = -1; }
    else if (nf < a) { nf = a + 1; dir = 1; }
  } else if (doc.loop === 'once') {
    if (nf > b) { nf = b; stopped = true; }
    else if (nf < a) { nf = a; stopped = true; }
  } else { // loop: wrap
    if (nf > b) nf = a + ((nf - a) % len + len) % len;
    else if (nf < a) nf = a + ((nf - a) % len + len) % len;
  }
  return { frame: clampInt(nf, a, b), dir, stopped };
}

/* ------------------------------------------------------- serialize / load   */

/**
 * Produce a plain, JSON-safe snapshot of the document structure (no pixels — the
 * cel `layerId`s reference layers that are saved separately). Deep-copies the
 * tracks/cels/frameMap so the snapshot can't be mutated through live references.
 */
export function serialize(doc) {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    fps: doc.fps,
    durationFrames: doc.durationFrames,
    currentFrame: doc.currentFrame,
    playRange: [doc.playRange[0], doc.playRange[1]],
    loop: doc.loop,
    _nextId: doc._nextId,
    tracks: doc.tracks.map((t) => ({
      id: t.id,
      name: t.name,
      visible: !!t.visible,
      locked: !!t.locked,
      holdLast: t.holdLast !== false,
      cels: t.cels.map((c) => ({ id: c.id, name: c.name, layerId: c.layerId ?? null })),
      // frameMap keys are stringified ints in JSON; keep them numeric on the way out
      frameMap: Object.fromEntries(
        Object.keys(t.frameMap).map((k) => [String(parseInt(k, 10)), t.frameMap[k]]),
      ),
    })),
  };
}

/**
 * Rebuild a live document from a serialized snapshot. Tolerant of partial / older
 * payloads (missing fields fall back to defaults). Re-clamps the playhead and
 * play range so a corrupt or out-of-date snapshot can't produce an invalid doc.
 *
 * `relinkLayerId(oldId) -> newId` is an optional callback used during load when
 * the editor's layer loader remaps layer ids: it lets each cel's `layerId` be
 * rewritten to the restored layer. If it returns undefined the original id is
 * kept.
 */
export function deserialize(data, { relinkLayerId } = {}) {
  const src = data || {};
  const doc = createTimelineDoc({
    fps: src.fps != null ? src.fps : 24,
    durationFrames: src.durationFrames != null ? src.durationFrames : 1,
  });
  doc.schemaVersion = TIMELINE_SCHEMA_VERSION;
  doc.loop = LOOP_MODES.indexOf(src.loop) >= 0 ? src.loop : 'loop';

  let maxNum = 0;
  const bumpFromId = (id) => {
    const m = /-(\d+)$/.exec(String(id || ''));
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  };

  doc.tracks = (Array.isArray(src.tracks) ? src.tracks : []).map((t) => {
    bumpFromId(t.id);
    const cels = (Array.isArray(t.cels) ? t.cels : []).map((c) => {
      bumpFromId(c.id);
      let layerId = c.layerId ?? null;
      if (relinkLayerId && layerId != null) {
        const mapped = relinkLayerId(layerId);
        if (mapped !== undefined) layerId = mapped;
      }
      return { id: c.id, name: c.name != null ? c.name : '', layerId };
    });
    const celIds = new Set(cels.map((c) => c.id));
    const frameMap = {};
    const rawMap = t.frameMap && typeof t.frameMap === 'object' ? t.frameMap : {};
    for (const k of Object.keys(rawMap)) {
      const f = parseInt(k, 10);
      const celId = rawMap[k];
      // drop dangling placements that reference a cel that no longer exists
      if (Number.isFinite(f) && f >= 0 && celIds.has(celId)) frameMap[f] = celId;
    }
    return {
      id: t.id || 'trk',
      name: t.name != null ? t.name : 'Track',
      visible: t.visible !== false,
      locked: !!t.locked,
      holdLast: t.holdLast !== false,
      cels,
      frameMap,
    };
  });

  // id allocator must stay ahead of every restored id (and any persisted value)
  doc._nextId = Math.max(src._nextId | 0, maxNum + 1, 1);

  doc.currentFrame = src.currentFrame != null ? src.currentFrame : 0;
  if (Array.isArray(src.playRange) && src.playRange.length === 2) {
    doc.playRange = [src.playRange[0], src.playRange[1]];
  } else {
    doc.playRange = [0, doc.durationFrames - 1];
  }
  return reconcile(doc);
}

export default {
  TIMELINE_SCHEMA_VERSION, FPS_MIN, FPS_MAX, LOOP_MODES,
  createTimelineDoc, addTrack, removeTrack, getTrack,
  addCel, getCel, placeCel, clearCel, moveCel, celAtFrame,
  setFps, setDuration, setFrame, setLoopMode, setPlayRange,
  rangeLength, durationSeconds, frameAtTime, advance,
  serialize, deserialize,
};
