/**
 * Multi-touch gesture recognizer (Pointer Events) — MOBILE-DESIGN §4.
 *
 * Attaches to the drawing surface and emits NEUTRAL gesture events for the
 * high-frequency canvas actions that live "on the fingers":
 *
 *   twoFingerTap   → undo            (quick tap with exactly 2 pointers)
 *   threeFingerTap → redo            (quick tap with exactly 3 pointers)
 *   pinch          → zoom + rotate   ({ scale, rotation, center, ... })
 *   pinchStart / pinchEnd            (bracket the live pinch stream)
 *   tapHold        → context menu / eyedropper trigger (single pointer held still)
 *
 * Design rules it honours (see MOBILE-DESIGN.md):
 *   - MUST NOT interfere with single-pointer drawing. Every MULTI-pointer
 *     classification is gated behind `>= 2` simultaneous active pointers, and
 *     this recognizer NEVER calls preventDefault / never claims a single
 *     pointer. The host stroke pipeline keeps full control of the lone pointer.
 *   - tapHold is the ONE single-pointer gesture, and it is opt-in: it only
 *     fires after a hold delay with no movement and is reported as a passive
 *     hint — the host decides whether to act (it can ignore it while a stroke
 *     is mid-flight). It self-cancels the instant a second pointer arrives or
 *     the pointer moves past the slop radius, so it can't fight a drag.
 *   - Neutral terms only; no third-party brand names. Finger-count→action
 *     meaning is the HOST's choice — this layer only reports what happened.
 *   - Configurable thresholds (timings, slop, finger spread, rotation/scale
 *     deadzones) via the constructor.
 *
 * The recognizer is intentionally framework-free and DOM-light: it talks to
 * the target through `addEventListener`/`removeEventListener` and to a clock
 * through `now()`, both injectable, so it runs headless under `node:test`
 * with synthetic pointer sequences (see _pw/test-mobile-gestures.mjs).
 *
 * @module editor/mobile/gestures
 */

/**
 * Default thresholds. All times in ms, all distances in CSS px.
 * @type {Readonly<Required<GestureThresholds>>}
 */
export const DEFAULT_THRESHOLDS = Object.freeze({
  // A multi-finger "tap" must lift within this window to count as a tap
  // (vs. the start of a pinch/pan). Generous — fingers rarely land/lift in sync.
  tapMaxMs: 320,
  // ...and no pointer in the group may travel more than this from its down point.
  tapMaxMoveSlop: 16,
  // Single-pointer hold: still for at least this long → tapHold.
  holdMs: 480,
  // Movement past this radius cancels a pending tapHold (it's a drag, not a hold).
  holdMoveSlop: 10,
  // Below this two-pointer distance delta (px) we don't start emitting pinch —
  // avoids jitter from two fingers resting still.
  pinchMinStartDelta: 8,
  // Per-frame scale change must clear this (|s-1|) before it counts, so a steady
  // hold doesn't dribble zoom.
  pinchScaleDeadzone: 0.0,
  // Per-frame rotation (radians) must clear this before it's reported, so a pure
  // zoom doesn't accidentally rotate. ~0.5°.
  pinchRotationDeadzone: 0.0087,
  // Max pointers we track in one gesture group. 4-finger taps are in the design;
  // keep a little headroom so a stray 5th contact doesn't poison the count.
  maxPointers: 5,
});

/**
 * @typedef {object} GestureThresholds
 * @property {number} [tapMaxMs]
 * @property {number} [tapMaxMoveSlop]
 * @property {number} [holdMs]
 * @property {number} [holdMoveSlop]
 * @property {number} [pinchMinStartDelta]
 * @property {number} [pinchScaleDeadzone]
 * @property {number} [pinchRotationDeadzone]
 * @property {number} [maxPointers]
 */

/**
 * Minimal shape this recognizer needs from a pointer event. Real
 * PointerEvents satisfy it; tests supply plain objects.
 * @typedef {object} PointerLike
 * @property {number} pointerId
 * @property {string} [pointerType]   'touch' | 'pen' | 'mouse'
 * @property {number} clientX
 * @property {number} clientY
 * @property {boolean} [isPrimary]
 */

const TWO_FINGER = 2;
const THREE_FINGER = 3;
const FOUR_FINGER = 4;

/** Geometry helper: distance + angle (radians) + midpoint of two points. */
function pairGeometry(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return {
    dist: Math.hypot(dx, dy),
    angle: Math.atan2(dy, dx),
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
  };
}

/** Shortest signed angular difference (radians) in (-π, π]. */
function angleDelta(curr, prev) {
  let d = curr - prev;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * Pointer-Events multi-touch gesture recognizer.
 *
 * Usage:
 *   const rec = new GestureRecognizer(canvasEl, { holdMs: 400 });
 *   const off = rec.on('twoFingerTap', () => undo());
 *   rec.on('pinch', ({ scale, rotation, center }) => applyZoomRotate(...));
 *   // later: off(); rec.destroy();
 */
export class GestureRecognizer {
  /**
   * @param {EventTarget|null} target  element the pointers fire on (canvas).
   *   May be null in pure unit tests that drive `handleEvent` directly.
   * @param {GestureThresholds} [thresholds]
   * @param {{ now?: () => number, pointerTypes?: string[] }} [opts]
   *   `now` overrides the clock (test seam). `pointerTypes` filters which
   *   pointerTypes participate (default: touch + pen; mouse is ignored so a
   *   desktop mouse never trips multi-finger gestures).
   */
  constructor(target, thresholds = {}, opts = {}) {
    /** @private */ this._target = target || null;
    /** @type {Required<GestureThresholds>} */
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
    /** @private */ this._now = opts.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    /** @private */ this._allowedTypes = new Set(opts.pointerTypes || ['touch', 'pen']);

    /** @private active pointers keyed by pointerId */
    this._pointers = new Map();
    /** @private listeners keyed by event name */
    this._listeners = new Map();

    // ── per-gesture state ─────────────────────────────────────────────
    /** @private peak simultaneous pointer count this gesture (for tap classify) */
    this._peakCount = 0;
    /** @private whether any pointer in this gesture exceeded the tap move slop */
    this._movedTooFar = false;
    /** @private timestamp the FIRST pointer of this gesture went down */
    this._gestureStart = 0;
    /** @private live pinch session, or null */
    this._pinch = null;
    /** @private latched true once a pinch went live this gesture (suppresses tap) */
    this._pinchHappened = false;
    /** @private pending single-pointer hold timer handle */
    this._holdTimer = null;
    /** @private the single pointer being watched for hold, or null */
    this._holdPointerId = null;
    /** @private enabled flag (host can pause us, e.g. strict pen-only mode) */
    this._enabled = true;

    this._bound = (e) => this.handleEvent(e);
    if (this._target && typeof this._target.addEventListener === 'function') {
      this._target.addEventListener('pointerdown', this._bound);
      this._target.addEventListener('pointermove', this._bound);
      this._target.addEventListener('pointerup', this._bound);
      this._target.addEventListener('pointercancel', this._bound);
      this._target.addEventListener('pointerleave', this._bound);
    }
  }

  /** Pause/resume gesture recognition without tearing down listeners. */
  setEnabled(on) {
    this._enabled = !!on;
    if (!on) this._reset();
  }

  /** True while two or more tracked pointers are down — host gate for "is a gesture happening". */
  get isMultiPointer() { return this._pointers.size >= 2; }

  /** Current count of tracked (allowed-type) active pointers. */
  get activePointerCount() { return this._pointers.size; }

  /**
   * Subscribe to a gesture event. Returns an unsubscribe function.
   * @param {'twoFingerTap'|'threeFingerTap'|'fourFingerTap'|'pinchStart'|'pinch'|'pinchEnd'|'tapHold'} name
   * @param {(detail: any) => void} fn
   * @returns {() => void}
   */
  on(name, fn) {
    if (!this._listeners.has(name)) this._listeners.set(name, new Set());
    this._listeners.get(name).add(fn);
    return () => { const s = this._listeners.get(name); if (s) s.delete(fn); };
  }

  /** @private dispatch to subscribers, swallowing handler errors so one bad listener can't break the stream. */
  _emit(name, detail) {
    const s = this._listeners.get(name);
    if (!s) return;
    for (const fn of s) { try { fn(detail); } catch (err) { /* host listener threw */ console && console.error && console.error('[gestures]', name, err); } }
  }

  /** Tear down all listeners and internal state. */
  destroy() {
    if (this._target && typeof this._target.removeEventListener === 'function') {
      this._target.removeEventListener('pointerdown', this._bound);
      this._target.removeEventListener('pointermove', this._bound);
      this._target.removeEventListener('pointerup', this._bound);
      this._target.removeEventListener('pointercancel', this._bound);
      this._target.removeEventListener('pointerleave', this._bound);
    }
    this._reset();
    this._listeners.clear();
  }

  /** @private hard-reset per-gesture state (between gestures / on cancel). */
  _reset() {
    this._pointers.clear();
    this._peakCount = 0;
    this._movedTooFar = false;
    this._gestureStart = 0;
    this._pinch = null;
    this._pinchHappened = false;
    this._clearHold();
  }

  /** @private */
  _clearHold() {
    if (this._holdTimer != null) { clearTimeout(this._holdTimer); this._holdTimer = null; }
    this._holdPointerId = null;
  }

  /**
   * Core dispatcher. Public so tests can drive it directly with PointerLike
   * objects (and so a host can forward events from a different element).
   * @param {PointerLike & { type: string }} e
   */
  handleEvent(e) {
    if (!this._enabled) return;
    switch (e.type) {
      case 'pointerdown':   return this._onDown(e);
      case 'pointermove':   return this._onMove(e);
      case 'pointerup':     return this._onUp(e);
      case 'pointercancel':
      case 'pointerleave':  return this._onCancel(e);
      default: return;
    }
  }

  /** @private */
  _onDown(e) {
    if (!this._allowedTypes.has(e.pointerType || 'touch')) return;
    // Cap the group — ignore extra contacts beyond maxPointers so a palm
    // resting alongside a 4-finger tap can't poison the count classification.
    if (this._pointers.size >= this.thresholds.maxPointers) return;

    const t = this._now();
    if (this._pointers.size === 0) {
      this._gestureStart = t;
      this._movedTooFar = false;
      this._peakCount = 0;
    }
    this._pointers.set(e.pointerId, {
      id: e.pointerId,
      type: e.pointerType || 'touch',
      startX: e.clientX, startY: e.clientY,
      x: e.clientX, y: e.clientY,
      downAt: t,
    });
    this._peakCount = Math.max(this._peakCount, this._pointers.size);

    // A second pointer arriving means this is NOT a single-pointer hold —
    // cancel any pending hold so multi-finger gestures win cleanly.
    if (this._pointers.size >= 2) this._clearHold();

    // Exactly one pointer down → arm the single-pointer hold watch.
    // (Gated so it never competes with multi-touch; self-cancels on move/2nd.)
    if (this._pointers.size === 1) this._armHold(e.pointerId);

    // Two pointers → prime a pinch session (becomes "live" once it moves
    // past pinchMinStartDelta). We DON'T emit on down; pinch is movement-driven.
    if (this._pointers.size === 2) this._primePinch();
  }

  /** @private */
  _onMove(e) {
    const p = this._pointers.get(e.pointerId);
    if (!p) return; // not a tracked pointer (e.g. an ignored mouse) — leave it alone
    p.x = e.clientX; p.y = e.clientY;

    const movedFromDown = Math.hypot(p.x - p.startX, p.y - p.startY);
    if (movedFromDown > this.thresholds.tapMaxMoveSlop) this._movedTooFar = true;

    // Single-pointer hold cancels the moment it drifts past the hold slop.
    if (this._holdPointerId === e.pointerId && movedFromDown > this.thresholds.holdMoveSlop) {
      this._clearHold();
    }

    // Live pinch update (needs exactly the two primed pointers present).
    if (this._pinch) this._updatePinch();
  }

  /** @private */
  _onUp(e) {
    const p = this._pointers.get(e.pointerId);
    if (!p) return;

    // If a pinch is live and we drop below two pointers, close it out.
    if (this._pinch && this._pointers.size <= 2) this._endPinch();

    this._pointers.delete(e.pointerId);
    if (this._holdPointerId === e.pointerId) this._clearHold();

    // When the LAST pointer of the gesture lifts, decide if the whole thing
    // was a multi-finger tap. A tap requires: never moved too far, lifted
    // within tapMaxMs, and a peak of >= 2 simultaneous fingers (so a single
    // tap — i.e. a drawing dot — is NEVER reported here).
    if (this._pointers.size === 0) {
      const elapsed = this._now() - this._gestureStart;
      const wasTap = !this._movedTooFar && elapsed <= this.thresholds.tapMaxMs && !this._pinchHappened;
      if (wasTap) this._classifyTap(this._peakCount);
      // gesture group finished — clear the per-gesture latches
      this._pinchHappened = false;
      this._peakCount = 0;
      this._movedTooFar = false;
      this._gestureStart = 0;
    }
  }

  /** @private */
  _onCancel(e) {
    // pointerleave fires for hover-capable pens even mid-stroke; only treat a
    // leave as a cancel if that pointer is actually one we're tracking.
    if (e && e.pointerId != null && !this._pointers.has(e.pointerId)) return;
    if (this._pinch) this._endPinch();
    if (e && e.pointerId != null) {
      this._pointers.delete(e.pointerId);
      if (this._holdPointerId === e.pointerId) this._clearHold();
    } else {
      this._reset();
    }
    if (this._pointers.size === 0) {
      this._pinchHappened = false;
      this._peakCount = 0;
      this._movedTooFar = false;
    }
  }

  /** @private classify a completed multi-finger tap by peak finger count. */
  _classifyTap(count) {
    if (count === TWO_FINGER) this._emit('twoFingerTap', { pointers: count, at: this._now() });
    else if (count === THREE_FINGER) this._emit('threeFingerTap', { pointers: count, at: this._now() });
    else if (count === FOUR_FINGER) this._emit('fourFingerTap', { pointers: count, at: this._now() });
    // counts > 4 (or 1) intentionally do nothing — single tap belongs to drawing.
  }

  /** @private set up a single-pointer hold timer. */
  _armHold(pointerId) {
    this._clearHold();
    this._holdPointerId = pointerId;
    this._holdTimer = setTimeout(() => {
      // Still exactly one pointer, still the same one, and it never drifted.
      const p = this._pointers.get(pointerId);
      if (!p) return;
      if (this._pointers.size !== 1) return;
      const moved = Math.hypot(p.x - p.startX, p.y - p.startY);
      if (moved > this.thresholds.holdMoveSlop) return;
      this._emit('tapHold', {
        pointerId,
        x: p.x, y: p.y,
        pointerType: p.type,
        at: this._now(),
      });
      // One-shot per hold — clear so we don't repeat.
      this._holdTimer = null;
      this._holdPointerId = null;
    }, this.thresholds.holdMs);
  }

  /** @private prime (but don't start) a two-pointer pinch session. */
  _primePinch() {
    const [a, b] = [...this._pointers.values()];
    const g = pairGeometry({ x: a.x, y: a.y }, { x: b.x, y: b.y });
    this._pinch = {
      idA: a.id, idB: b.id,
      // `baseDist` is the ORIGINAL touchdown spread and is never re-baselined,
      // so `scale = currentDist / baseDist` is jump-free for zoom (scale has no
      // deadzone — the live gate handles the "two fingers resting" case).
      baseDist: g.dist || 1,
      startAngle: g.angle,    // angle at touchdown (for the live-gate test)
      lastAngle: g.angle,     // running per-frame rotation reference
      live: false,            // becomes true once movement clears the start gate
      accumRotation: 0,       // total rotation accumulated past the deadzone (radians)
    };
    this._pinchHappened = this._pinchHappened || false;
  }

  /** @private update a live/priming pinch from current pointer positions. */
  _updatePinch() {
    const a = this._pointers.get(this._pinch.idA);
    const b = this._pointers.get(this._pinch.idB);
    if (!a || !b) return; // one of the pinch pointers lifted — wait for _onUp to close it

    const g = pairGeometry({ x: a.x, y: a.y }, { x: b.x, y: b.y });

    // Go "live" only after the spread changes enough OR the fingers rotate
    // enough — keeps two resting fingers from emitting zoom. Crucially we do
    // NOT re-baseline `baseDist`/rotation here: scale and rotation are measured
    // from the original touchdown so a fast first frame still reports its full
    // magnitude (only the sub-deadzone rotation jitter is filtered, below).
    if (!this._pinch.live) {
      const spreadDelta = Math.abs(g.dist - this._pinch.baseDist);
      const rotDelta = Math.abs(angleDelta(g.angle, this._pinch.startAngle));
      if (spreadDelta < this.thresholds.pinchMinStartDelta && rotDelta < this.thresholds.pinchRotationDeadzone) {
        this._pinch.lastAngle = g.angle;
        return;
      }
      this._pinch.live = true;
      this._pinchHappened = true;
      this._emit('pinchStart', {
        center: { x: g.cx, y: g.cy },
        scale: g.dist / this._pinch.baseDist,
        rotation: 0,
        distance: g.dist,
        at: this._now(),
      });
      // fall through and emit the first live `pinch` from the same frame
    }

    // Accumulate rotation per-frame, ignoring sub-deadzone jitter so a pure
    // zoom doesn't slowly drift the canvas angle.
    const frameRot = angleDelta(g.angle, this._pinch.lastAngle);
    if (Math.abs(frameRot) >= this.thresholds.pinchRotationDeadzone) {
      this._pinch.accumRotation += frameRot;
      this._pinch.lastAngle = g.angle;
    }

    const scale = g.dist / this._pinch.baseDist;   // relative to touchdown spread
    if (Math.abs(scale - 1) < this.thresholds.pinchScaleDeadzone) return;

    this._emit('pinch', {
      center: { x: g.cx, y: g.cy },
      scale,                                 // multiplicative vs. touchdown spread
      rotation: this._pinch.accumRotation,   // radians, accumulated past deadzone
      rotationDeg: this._pinch.accumRotation * 180 / Math.PI,
      distance: g.dist,
      at: this._now(),
    });
  }

  /** @private close out a pinch session and notify. */
  _endPinch() {
    if (this._pinch && this._pinch.live) {
      this._emit('pinchEnd', {
        scale: 1,
        rotation: this._pinch.accumRotation,
        rotationDeg: this._pinch.accumRotation * 180 / Math.PI,
        at: this._now(),
      });
    }
    this._pinch = null;
  }
}

export default GestureRecognizer;
