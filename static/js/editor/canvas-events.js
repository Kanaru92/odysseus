/**
 * Canvas event wiring — mouse, touch (including pinch-zoom on two
 * fingers), and the canvas-area pan handler.
 *
 *   Mouse:
 *     mousedown on canvas    → beginDraw
 *     mousemove on window    → continueDraw (window so a drag can
 *                              continue past the canvas edge)
 *     mouseup on window      → endDraw
 *     mouseenter/mouseleave  → show/hide the brush-cursor overlay
 *     mousedown on canvas-area (NOT on the canvas itself, lasso only)
 *                            → beginDraw (lasso starts outside canvas)
 *
 *   Touch:
 *     touchstart 1 finger    → beginDraw
 *     touchmove  1 finger    → continueDraw
 *     touchend / touchcancel → endDraw
 *     touchstart 2 fingers   → pinch-zoom + 2-finger pan
 *
 *   Pan (any free space around the canvas):
 *     pointerdown / pointermove / pointerup on canvas-area, skipping
 *     the canvas + transform overlay + UI elements above them. Sets
 *     canvasArea.dataset.panX/Y + CSS transform on both canvases.
 *
 *   Exposes `canvasArea._resetPan()` so the zoom/fit reset can clear
 *   the pan offset.
 *
 * @param {{
 *   canvasArea:        HTMLDivElement,
 *   beginDraw:         (e: Event) => void,
 *   continueDraw:      (e: Event) => void,
 *   endDraw:           (e?: Event) => void,
 *   updateBrushCursor: (e: Event) => void,
 *   syncZoomControls?: () => void,
 * }} ctx
 */
import { state } from './state.js';

export function wireCanvasEvents({ canvasArea, beginDraw, continueDraw, endDraw: rawEndDraw, updateBrushCursor, syncZoomControls }) {
  // "Catch-up on Stroke End": before finalizing a stroke, drain the smoothing
  // tail so a smoothed stroke reaches the point where the pointer lifted instead
  // of stopping short of it. The stroke pipeline publishes `state.drainSmoothing`
  // (a no-op when catch-up is off / smoothing is 0 / not a brush stroke), so the
  // drain runs here on every lift path (mouse / touch) ahead of the real endDraw.
  // It moves state.lastX/Y onto the raw release point, so any legacy catch-up in
  // endDraw then has nothing left to do.
  const endDraw = (e) => {
    if (state.drawing && typeof state.drainSmoothing === 'function') {
      try { state.drainSmoothing(); } catch {}
    }
    return rawEndDraw(e);
  };
  // Listeners attached to window/document outlive the canvas DOM (which is
  // wiped by container.innerHTML='' on every openEditor). Collect their
  // removers here and return a disposer so closeEditor can tear them down;
  // otherwise a fresh set leaks per open and stale copies keep firing
  // continueDraw/endDraw on the hot move path after the editor is closed.
  const disposers = [];
  const on = (target, type, handler, opts) => {
    target.addEventListener(type, handler, opts);
    disposers.push(() => { try { target.removeEventListener(type, handler, opts); } catch {} });
  };

  // Mouse — mousedown stays on the canvas; mousemove/up are bound to
  // the WINDOW so a drag can continue (and end) past the canvas edge.
  // Critical for the Resize tool where users overshoot.
  state.mainCanvas.addEventListener('mousedown', beginDraw);
  // Mouse drives the stroke here; a pen drives it from pointermove's coalesced
  // sub-frame samples instead (below), so the paired compat mousemove is skipped
  // (state._penDroveFrame) to avoid painting the same point twice.
  on(window, 'mousemove', (e) => {
    if (state._penDroveFrame) { state._penDroveFrame = false; return; }
    if (typeof e.timeStamp === 'number') state._evtTime = e.timeStamp;
    continueDraw(e);
  });
  on(window, 'mouseup', endDraw);
  // Lasso can start OUTSIDE the canvas — fallback mousedown on the
  // surrounding canvas-area so the user can begin a lasso path in
  // the empty space around the image. Other tools stay canvas-only.
  canvasArea.addEventListener('mousedown', (e) => {
    if (state.tool !== 'lasso') return;
    if (e.target === state.mainCanvas) return; // already handled
    beginDraw(e);
  });
  state.mainCanvas.addEventListener('mouseenter', (e) => {
    if (['brush', 'eraser', 'inpaint', 'lasso', 'clone'].includes(state.tool)) updateBrushCursor(e);
  });
  state.mainCanvas.addEventListener('mouseleave', () => {
    // Only hide the brush-cursor overlay on leave — DO NOT end the
    // drag, so the user can drag a resize handle past the canvas edge.
    if (state.cursorEl) state.cursorEl.style.display = 'none';
  });

  // Pen pressure / tilt capture (Pointer Events). Additive — the mouse
  // handlers above still DRIVE drawing (browsers fire compat mouse events
  // for the primary pointer, including pens), so this only RECORDS the
  // stylus readings the brush engine reads for dynamics. Mouse/touch report
  // pressure 0 or 0.5, so only trust a real pen; everything else paints at
  // full pressure. Pointer events fire before their compat mouse events, so
  // state.pressure is fresh when continueDraw → strokeTo runs.
  const capturePen = (e) => {
    // Record the event's own timestamp so the velocity-taper sensor measures real
    // per-sample time. Replayed coalesced sub-frame samples run microseconds apart
    // on the wall clock, so performance.now() would collapse dt toward zero and
    // wildly inflate speed; the events themselves carry true sub-frame timestamps.
    if (e && typeof e.timeStamp === 'number') state._evtTime = e.timeStamp;
    if (e.pointerType === 'pen') {
      state.isPen = true;
      // Pressure: a graphics tablet + Windows Ink can fire a brief 1.0 on light contact
      // (full-pressure spike). Seed LOW on pointerdown (no carryover from the
      // last stroke), floor so a 0 reading doesn't give a zero-size dab, then
      // EMA-smooth + cap upward jumps so a momentary spike can't punch through.
      const raw = (typeof e.pressure === 'number' && e.pressure > 0) ? e.pressure : 0;
      if (e.type === 'pointerdown') {
        // Pen-down often reports a brief FULL-pressure spike on first contact
        // (Windows Ink / S-Pen), which made strokes start with a full-pressure
        // blob. Never trust the down reading: seed LOW and let the EMA below
        // ramp toward the real pressure over the next few samples.
        state.pressure = Math.min(0.12, Math.max(0.04, raw));
      } else {
        const prev = state.pressure != null ? state.pressure : (raw || 0.5);
        let p = Math.max(0.04, raw || prev);
        if (p > prev + 0.4) p = prev + 0.4;     // clamp sudden upward spikes
        state.pressure = prev * 0.4 + p * 0.6;  // light smoothing
      }
      // Tilt is reported two ways across platforms: tiltX/tiltY (degrees, the
      // older fields — Windows/Chromium) OR altitudeAngle/azimuthAngle (radians,
      // the newer spec — common on Linux/other stacks). Prefer tilt*, fall back
      // to altitude/azimuth, normalizing to tiltX/tiltY degrees so the brush
      // dynamics (tilt→size, tilt→angle) work the same everywhere.
      if (e.tiltX || e.tiltY) {
        state.tiltX = e.tiltX || 0;
        state.tiltY = e.tiltY || 0;
      } else if (typeof e.altitudeAngle === 'number' && e.altitudeAngle < Math.PI / 2 - 1e-3) {
        // altitudeAngle: 0 = pen flat on the surface, π/2 = perfectly upright.
        const fromVertical = (Math.PI / 2 - e.altitudeAngle) * 180 / Math.PI; // degrees
        const az = e.azimuthAngle || 0;
        state.tiltX = fromVertical * Math.cos(az);
        state.tiltY = fromVertical * Math.sin(az);
      } else {
        state.tiltX = e.tiltX || 0;
        state.tiltY = e.tiltY || 0;
      }
    } else {
      state.isPen = false;
      state.pressure = 1;
    }
  };
  state.mainCanvas.addEventListener('pointerdown', capturePen);
  // High-rate pen: drive the in-progress stroke from the pointer's COALESCED
  // sub-frame samples so fast strokes don't drop points (the "angular / skipped
  // section" lines). Safe now that compositing is rAF-coalesced — replaying many
  // points per frame renders dabs cheaply and composites once. Each sample
  // updates pressure/tilt (capturePen) then paints (continueDraw). The paired
  // compat mousemove is suppressed via state._penDroveFrame. Mouse is unaffected
  // (it has no useful sub-frame samples and keeps the mousemove path).
  state.mainCanvas.addEventListener('pointermove', (e) => {
    // Drive the stroke from the pointer's COALESCED sub-frame samples for both
    // pen AND mouse, so fast direction reversals (zig-zag apexes that occur
    // between animation frames) are recorded instead of being skipped — the
    // single compat mousemove only ever reports one position per frame. The
    // paired compat mousemove is then suppressed (_penDroveFrame) so the same
    // points aren't painted twice. Touch keeps its own handler below.
    if (state.drawing && (e.pointerType === 'pen' || e.pointerType === 'mouse')) {
      const evs = (typeof e.getCoalescedEvents === 'function') ? e.getCoalescedEvents() : null;
      const list = (evs && evs.length) ? evs : [e];
      for (const ce of list) { capturePen(ce); continueDraw(ce); }
      state._penDroveFrame = true;
    } else {
      capturePen(e);
    }
  });

  // Touch — single finger draws; two fingers pan + pinch-zoom.
  let multiActive = false;
  let multiStartDist = 0;
  let multiStartZoom = 1;
  let multiStartCenter = { x: 0, y: 0 };
  let multiStartPan = { x: 0, y: 0 };
  const touchInfo = (e) => {
    const t1 = e.touches[0], t2 = e.touches[1];
    const cx = (t1.clientX + t2.clientX) / 2;
    const cy = (t1.clientY + t2.clientY) / 2;
    const dx = t2.clientX - t1.clientX;
    const dy = t2.clientY - t1.clientY;
    return { cx, cy, dist: Math.hypot(dx, dy) };
  };
  const applyCanvasOffset = (x, y) => {
    canvasArea.dataset.panX = String(x);
    canvasArea.dataset.panY = String(y);
    const rot = state.viewRotation || 0;
    const t = `translate3d(${x}px, ${y}px, 0)` + (rot ? ` rotate(${rot}deg)` : '');
    state.mainCanvas.style.transformOrigin = 'center center';
    state.mainCanvas.style.transform = t;
    if (state.transformOverlay) { state.transformOverlay.style.transformOrigin = 'center center'; state.transformOverlay.style.transform = t; }
    // Pan is a CSS transform that fires no composite — notify view-tracking
    // overlays (navigator viewport, symmetry gizmo, distort/pcrop handles) so they
    // follow the canvas instead of detaching.
    try { window.dispatchEvent(new Event('ge:composited')); } catch {}
  };
  state.mainCanvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (e.touches.length >= 2) {
      // End any in-progress single-finger draw before switching modes.
      if (!multiActive) endDraw();
      multiActive = true;
      const info = touchInfo(e);
      multiStartDist = info.dist;
      multiStartZoom = state.zoom;
      multiStartCenter = { x: info.cx, y: info.cy };
      multiStartPan = {
        x: parseFloat(canvasArea.dataset.panX || '0') || 0,
        y: parseFloat(canvasArea.dataset.panY || '0') || 0,
      };
      return;
    }
    if (multiActive) return;
    beginDraw(e);
  }, { passive: false });
  state.mainCanvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (multiActive && e.touches.length >= 2) {
      const info = touchInfo(e);
      const ratio = info.dist / Math.max(1, multiStartDist);
      const newZoom = Math.max(0.1, Math.min(5, multiStartZoom * ratio));
      if (Math.abs(newZoom - state.zoom) > 0.001) {
        state.zoom = newZoom;
        state.mainCanvas.style.width = (state.imgWidth * state.zoom) + 'px';
        state.mainCanvas.style.height = (state.imgHeight * state.zoom) + 'px';
        const label = state.container.querySelector('.ge-zoom-label');
        if (label) label.textContent = Math.round(state.zoom * 100) + '%';
        syncZoomControls?.();
      }
      const dx = info.cx - multiStartCenter.x;
      const dy = info.cy - multiStartCenter.y;
      applyCanvasOffset(multiStartPan.x + dx, multiStartPan.y + dy);
      return;
    }
    if (multiActive) return;
    continueDraw(e);
  }, { passive: false });
  state.mainCanvas.addEventListener('touchend', (e) => {
    if (multiActive) {
      if (e.touches.length < 2) multiActive = false;
      return;
    }
    endDraw(e);
  });
  state.mainCanvas.addEventListener('touchcancel', () => {
    multiActive = false;
    endDraw();
  });

  // Press-and-drag in the empty space AROUND the canvas pans the
  // canvas + overlay via CSS transform. Works even when the image
  // fits the viewport (no scroll needed). Skips presses on the canvas
  // itself (the canvas owns its own drawing input) or on UI elements
  // above it.
  let panning = false;
  let pid = null;
  let startX = 0, startY = 0;
  const getOffset = () => {
    const v = canvasArea.dataset.panX || '0';
    const u = canvasArea.dataset.panY || '0';
    return { x: parseFloat(v) || 0, y: parseFloat(u) || 0 };
  };
  const applyOffset = (x, y) => {
    canvasArea.dataset.panX = String(x);
    canvasArea.dataset.panY = String(y);
    const rot = state.viewRotation || 0;
    const t = `translate3d(${x}px, ${y}px, 0)` + (rot ? ` rotate(${rot}deg)` : '');
    state.mainCanvas.style.transformOrigin = 'center center';
    state.mainCanvas.style.transform = t;
    if (state.transformOverlay) { state.transformOverlay.style.transformOrigin = 'center center'; state.transformOverlay.style.transform = t; }
    try { window.dispatchEvent(new Event('ge:composited')); } catch {} // keep overlays/navigator tracking the pan
  };
  canvasArea.addEventListener('pointerdown', (e) => {
    if (state.tool === 'lasso') return;
    if (e.target === state.mainCanvas || e.target === state.transformOverlay) return;
    if (e.target.closest('button, input, .ge-adj-popup, .ge-transform-popup, .ge-fx-popup, .ge-inpaint-popup, .ge-controls, .ge-right-panel, .ge-fx-menu')) return;
    // During an active transform the corner/rotation handles render
    // OUTSIDE the canvas (over the surrounding area), and the overlay is
    // pointer-events:none — so a grab on an outside handle lands here.
    // Route it to the transform tool (getHandleAt works in image space,
    // even for points beyond the canvas) instead of panning the canvas.
    if (state.transformActive) {
      beginDraw(e);
      // Only swallow the event (skip pan) if a handle was grabbed OR the
      // layer-move fallback engaged; otherwise let the pan logic below
      // run so empty space still pans while the transform tool is open.
      if (state.transformHandle || state.moving) return;
    }
    const off = getOffset();
    panning = true;
    pid = e.pointerId;
    startX = e.clientX - off.x;
    startY = e.clientY - off.y;
    try { canvasArea.setPointerCapture(pid); } catch {}
    canvasArea.style.cursor = 'grabbing';
    e.preventDefault();
  });
  canvasArea.addEventListener('pointermove', (e) => {
    if (!panning || e.pointerId !== pid) return;
    applyOffset(e.clientX - startX, e.clientY - startY);
  });
  const endPan = () => {
    if (!panning) return;
    panning = false;
    try { canvasArea.releasePointerCapture(pid); } catch {}
    pid = null;
    canvasArea.style.cursor = '';
  };
  canvasArea.addEventListener('pointerup', endPan);
  canvasArea.addEventListener('pointercancel', endPan);

  // ── Space-to-pan (hand tool) ─────────────────────────────────────────
  // Hold Space and drag the CANVAS itself to pan. Reuses the same translate
  // offset as the around-canvas pan, and since that offset is never clamped the
  // canvas can be pushed fully offscreen (overscan) — so you can zoom into and
  // paint an edge comfortably. A capture-phase mousedown pre-empts beginDraw.
  let spacePanning = false, spStartX = 0, spStartY = 0;
  state.mainCanvas.addEventListener('mousedown', (e) => {
    if (!state.spaceDown) return;
    const off = getOffset();
    spacePanning = true;
    spStartX = e.clientX - off.x;
    spStartY = e.clientY - off.y;
    canvasArea.style.cursor = 'grabbing';
    e.preventDefault();
    e.stopPropagation(); // don't let beginDraw fire
  }, true);
  // Middle-mouse drag pans too (industry-standard navigation) — reuses the same
  // spacePanning offset path. Capture-phase so it pre-empts beginDraw on the canvas.
  state.mainCanvas.addEventListener('mousedown', (e) => {
    if (e.button !== 1) return; // middle button only
    const off = getOffset();
    spacePanning = true;
    spStartX = e.clientX - off.x;
    spStartY = e.clientY - off.y;
    canvasArea.style.cursor = 'grabbing';
    e.preventDefault();
    e.stopPropagation(); // don't let beginDraw fire
  }, true);
  on(window, 'mousemove', (e) => { if (spacePanning) { e.preventDefault(); applyOffset(e.clientX - spStartX, e.clientY - spStartY); } });
  on(window, 'mouseup', () => { if (spacePanning) { spacePanning = false; canvasArea.style.cursor = state.spaceDown ? 'grab' : ''; } });
  on(document, 'keydown', (e) => {
    if (e.code !== 'Space' || !state.editorOpen) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (!state.spaceDown) {
      state.spaceDown = true;
      canvasArea.style.cursor = 'grab';
      if (state.cursorEl) state.cursorEl.style.display = 'none';
    }
    e.preventDefault(); // suppress page scroll while panning
  });
  on(document, 'keyup', (e) => {
    if (e.code !== 'Space') return;
    state.spaceDown = false;
    if (!spacePanning) canvasArea.style.cursor = '';
  });

  // ── Wheel zoom-to-cursor ───────────────────────────────────────────────
  // Wheel / trackpad-pinch zooms TOWARD the pointer: the image point under the
  // cursor stays fixed (industry-standard navigation). Kept on the canvas-area and
  // preventDefault'd so it doesn't scroll the page. Pan offset is adjusted
  // rather than reset, so you can zoom into any corner.
  canvasArea.addEventListener('wheel', (e) => {
    const canvas = state.mainCanvas;
    if (!canvas || !state.imgWidth) return;
    e.preventDefault();
    const before = canvas.getBoundingClientRect();
    const fx = (e.clientX - before.left) / (before.width || 1);
    const fy = (e.clientY - before.top) / (before.height || 1);
    const cur = getOffset();
    // Normalize delta across deltaMode (pixels / lines / pages); ctrl|⌘ = finer.
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 300 : 1;
    const factor = Math.exp(-e.deltaY * unit * ((e.ctrlKey || e.metaKey) ? 0.0014 : 0.0022));
    const newZoom = Math.max(0.05, Math.min(32, state.zoom * factor));
    if (Math.abs(newZoom - state.zoom) < 1e-4) return;
    state.zoom = newZoom;
    canvas.style.width = (state.imgWidth * newZoom) + 'px';
    canvas.style.height = (state.imgHeight * newZoom) + 'px';
    // Crisp pixels when zoomed in; smooth (browser default) when zoomed out so
    // downscaled previews aren't nearest-neighbour aliased.
    canvas.style.imageRendering = newZoom >= 4 ? 'pixelated' : 'auto';
    const after = canvas.getBoundingClientRect();
    applyOffset(cur.x + (e.clientX - (after.left + fx * after.width)),
                cur.y + (e.clientY - (after.top + fy * after.height)));
    const label = state.container && state.container.querySelector('.ge-zoom-label');
    if (label) label.textContent = Math.round(newZoom * 100) + '%';
    syncZoomControls?.();
  }, { passive: false });

  // Reset offset whenever zoom/fit changes the canvas size.
  canvasArea._resetPan = () => applyOffset(0, 0);
  canvasArea._applyOffset = (x, y) => applyOffset(x, y); // absolute set, for the Navigator mini-map
  // Re-apply the current pan + view rotation (called when viewRotation changes).
  canvasArea._reapplyView = () => { const o = getOffset(); applyOffset(o.x, o.y); };

  // Teardown for the window/document listeners (they outlive the canvas DOM).
  // A prior call's listeners are removed first so re-wiring (next openEditor)
  // never stacks two generations, then closeEditor calls this to clean up.
  const dispose = () => { while (disposers.length) disposers.pop()(); };
  try { if (typeof state.canvasEventsDispose === 'function') state.canvasEventsDispose(); } catch {}
  state.canvasEventsDispose = dispose;
  return dispose;
}
