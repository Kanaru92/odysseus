/**
 * Editor state store — a single mutable object that the gallery editor
 * and its tool modules read and write directly.
 *
 * Migration: galleryEditor.js used to own ~110 module-scope `let`
 * declarations and capture them via closure. Tool modules can't import
 * a `let` binding's mutations across module boundaries, so we move the
 * state into a single exported OBJECT whose properties are freely
 * mutated by anyone holding a reference. Read/write `state.transformW`
 * exactly the way the old code wrote `_transformW`.
 *
 * Slices land here one tool at a time; this file grows as more state
 * migrates out of galleryEditor.js. Defaults match the legacy
 * module-scope initializers verbatim — every `state.foo = …` reset
 * site in galleryEditor.js still works unchanged.
 */
export const state = {
  // ── Transform tool ──
  // Drag-resize / rotate session state. While `transformActive` is
  // false every field below should be considered stale.
  transformActive: false,
  transformLayer: null,
  transformOrigW: 0,
  transformOrigH: 0,
  // Which corner/edge handle the user is currently dragging. One of
  // 'tl' | 'tr' | 'bl' | 'br' | 'rot' | null.
  transformHandle: null,
  // Which handle is currently under the cursor (no drag). Drives the
  // hover cursor lookup; lives next to `transformHandle` because both
  // come from `_getTransformHandle`.
  hoveredHandle: null,
  // Snapshot of the layer canvas + offset at transform start so Cancel
  // can restore exactly without re-fetching from the layer.
  transformOrigCanvas: null,
  transformOrigOffset: null,
  // In-progress dimensions / rotation / flips committed on Apply.
  transformPendingW: 0,
  transformPendingH: 0,
  transformPendingRot: 0,
  transformPendingFlipH: false,
  transformPendingFlipV: false,
  transformAspectLock: true,
  // Floating Transform popup element + drag-start offsets.
  transformPopup: null,
  transformStartX: 0,
  transformStartY: 0,
  transformStartOffX: 0,
  transformStartOffY: 0,
  // Transform overlay canvas — separate canvas positioned over the
  // main canvas with extra slack for handle rendering. Created by
  // _buildEditor; the move/transform tools draw their handle layer
  // onto its 2D context.
  transformOverlay: null,
  transformOverlayCtx: null,

  // ── Magic Wand tool ──
  // Binary selection mask + the layer it was sampled from. `wandMask`
  // is a canvas the size of `wandLayer`'s pixels, white where selected,
  // transparent elsewhere. `wandLastSeed` remembers the last click so
  // tolerance retunes can re-run the flood-fill without re-prompting.
  wandMask: null,
  wandLayerId: null,
  wandTolerance: 24,
  wandMaskVisible: true,
  wandMode: 'replace',
  wandLiveRetune: false,
  wandLastSeed: null,
  // Cached layer pixel data (getImageData is O(pixels) — expensive for
  // 4K layers; invalidated when the active layer changes).
  wandSrcCache: null,

  // ── Brush / Eraser / Clone tools ──
  // Shared paint color (brush picks up the swatch; eraser and clone
  // ignore color but reuse the same picker control).
  color: '#e06c75',
  // Background color (FG/BG model). `color` is the foreground (what
  // the brush paints). X swaps the two; D resets to black/white.
  bgColor: '#ffffff',
  eyedropperSampleSize: 1, // 1 = point, 3 = 3×3 avg, 5 = 5×5 avg
  cmykProof: false, // soft-proof: simulate CMYK print appearance on-screen (view-only, Ctrl+Y)
  pasteboardColor: '#232323', // colour of the area behind the image (display-only; right-click the canvas)
  // ── Guides / grid (layout aids; display-only, feed the snap targets) ──
  viewRotation: 0, // non-destructive canvas VIEW rotation in degrees (R / Shift+R), display-only
  showGrid: false,
  gridSize: 50,
  guidesVisible: true,
  guides: [], // user guides: { axis: 'v'|'h', pos } in canvas pixels
  // Brush diameter in canvas pixels. Persisted across tool switches;
  // bumped to a mask-friendly default on first inpaint entry.
  brushSize: 8,
  // Per-tool stroke modifiers — opacity + flow + softness. Each tool
  // owns its own row so users can dial them in independently.
  brushOpacity: 100,
  brushFlow: 100,
  brushSoftness: 100,
  eraserOpacity: 100,
  eraserFlow: 100,
  eraserSoftness: 100,
  cloneOpacity: 100,
  cloneFlow: 100,
  cloneSoftness: 100,
  // Clone-stamp source point (set via Alt-click or double-tap). Null
  // means no source picked yet — clicking with the clone tool no-ops
  // until a source is set.
  cloneSourceX: null,
  cloneSourceY: null,
  // Stroke-start offsets so the source moves WITH the brush, keeping
  // the source→destination offset constant across the stroke.
  cloneStrokeStartX: null,
  cloneStrokeStartY: null,
  // Frozen snapshot of the source layer's pixels at stroke start so
  // moving the source over previously-painted pixels samples the
  // original, not the in-progress stamp ring.
  cloneSourceSnapshot: null,
  cloneSourceLayerId: null,
  // Mobile: double-tap detection for "set source" since Alt-click
  // isn't an option without a keyboard.
  cloneLastTapTime: 0,
  cloneLastTapX: 0,
  cloneLastTapY: 0,

  // ── Inpaint + mask ──
  // Active mask canvas + its 2D context. Re-pointed to the active
  // mask sub-layer whenever the user picks a different mask in the
  // layer panel.
  maskCanvas: null,
  maskCtx: null,
  maskVisible: true,
  layerMaskEdit: false, // when true, brush/eraser paint the active layer's PS visibility mask (layer.layerMask): brush reveals, eraser hides
  // Reused canvas for the union-of-masks tint pass (saves repeated
  // allocation on every composite).
  compositeMaskUnion: null,
  // Visual tint applied to mask pixels in the composite — purely
  // cosmetic; the AI model still sees a hard binary mask.
  maskTintColor: 'rgba(255, 110, 110, 1)',
  maskTintOpacity: 0.28,
  // Inpaint-tool paint vs erase modes (Ctrl+Alt flips for a single
  // stroke; UI buttons toggle the persistent setting).
  inpaintEraseMode: false,
  inpaintEraseStroke: false,
  // First-entry guard: bump brush size to the mask-friendly default
  // the first time the user opens inpaint per session.
  inpaintBrushInitialised: false,
  // Last successful inpaint result layer — drives the live edge
  // feather / stroke sliders (those only apply to the most recent
  // result).
  lastInpaintLayerId: null,
  // Captured handlers so we can detach them on close without leaking.
  inpaintDismissHandlers: null,
  // Background-remove tool state — pristine snapshot so the edge
  // cleanup sliders can live-rebuild alpha without re-running rembg.
  rembgLiveLayer: null,
  rembgLiveSnap: null,
  // Memoised "is rembg installed on the server?" probe.
  rembgInstalledCache: null,

  // ── Stroke drag state ──
  // Generic in-progress-stroke flags shared by brush/eraser/clone/
  // inpaint. `lastX/Y` are the last mouse position used to interpolate
  // a continuous line through fast-moving cursor samples.
  drawing: false,
  lastX: 0,
  lastY: 0,

  // ── Move tool ──
  moving: false,
  moveStartX: 0,
  moveStartY: 0,
  // Layer offset at drag start so we can compute the new offset by
  // (mouse - startMouse) + startOffset rather than accumulating delta.
  moveLayerOffsetX: 0,
  moveLayerOffsetY: 0,
  // Snap guides drawn during a move-tool drag (Ctrl held). Each entry
  // is a vertical / horizontal line in canvas space.
  activeSnapGuides: null,

  // ── Crop tool ──
  cropping: false,
  cropStart: null,
  cropEnd: null,
  cropRect: null,
  cropAspectLock: null,
  cropAspectPreset: null, // fixed crop ratio (w/h) from the preset buttons; null = free
  cropDeletePixels: true, // true = discard cropped-out pixels; false = keep them hidden (shift layer offsets)
  // True while the user drags the inside of an already-finished crop
  // rect to reposition it.
  cropMoving: false,
  cropMoveStart: null,

  // ── Lasso tool ──
  // Freehand selection polygon in canvas pixels. Empty when no lasso
  // is in progress or staged.
  lassoPoints: [],
  lassoActive: false,

  // In-editor copy/paste — separate from the OS clipboard so we can
  // round-trip layer alpha and metadata losslessly.
  internalClipboard: null,

  // ── Editor DOM refs ──
  // Root container that openEditor mounts into.
  container: null,
  // Main image canvas + its 2D context. Re-created on every openEditor
  // so the editor can reopen with fresh dimensions.
  mainCanvas: null,
  mainCtx: null,

  // ── Document + layers ──
  layers: [],
  activeLayerId: null,
  // Active tool ID — one of move/crop/transform/brush/eraser/clone/
  // lasso/wand/inpaint/rembg/harmonize/sharpen/upscale/style.
  tool: 'move',
  // Display zoom (1 = 100%). pan{X,Y} translate the canvas inside the
  // viewport.
  zoom: 1,
  panX: 0,
  panY: 0,
  // Document dimensions in canvas pixels.
  imgWidth: 0,
  imgHeight: 0,
  // Gallery image id this editor session is editing, or null for
  // blank-canvas drafts.
  imageId: null,
  // Original file extension so save-over-original re-encodes in the
  // same format (JPEG vs PNG matters: JPEG cuts upload size 5-10× for
  // camera photos over remote tunnels).
  originalExt: 'png',
  // True between openEditor / closeEditor — guards async callbacks
  // that fire after the user closes the editor (don't draw onto a
  // dead canvas, don't re-mount the spinner).
  editorOpen: false,
  // Document-level click-away handlers registered for the current
  // session. Tracked so closeEditor can detach them all cleanly.
  // Mutated in place (push / length = 0); the reference never changes.
  editorDocClickHandlers: [],

  // ── Undo / redo ──
  undoStack: [],
  redoStack: [],

  // ── Layer offsets + id allocation ──
  // Map<layerId, {x, y}> — kept in a Map so we can serialise it
  // separately from the layer's own canvas. Mutated in place.
  layerOffsets: new Map(),
  nextLayerId: 1,

  // ── Popup / panel handles ──
  fxPopupEl: null,
  fxPopupLayerId: null,
  fxMenuEl: null,
  adjPopupEl: null,
  // rAF-throttled live preview while sliders are dragged in adj popups.
  adjRafPending: false,
  historyPanelEl: null,
  // Custom brush-cursor overlay element (circle following the mouse).
  cursorEl: null,
  // Hover-preview thumbnail floating element (singleton, repositioned).
  layerThumbEl: null,
  // Loading-overlay element (whirlpool + label).
  editorLoadingEl: null,

  // ── Draft persistence ──
  draftId: null,
  draftName: '',
  persistTimer: null,
  // Current PUT/POST promise so concurrent saves can chain.
  persistInFlight: null,
  // True when an edit happened during an in-flight save — triggers a
  // follow-up persist after the current one finishes.
  persistDirty: false,


  // ── Brush engine (M1) ──
  // Routes the paint brush through the dab/spacing/pressure engine
  // (editor/brush/). Legacy lineTo stroke remains as an automatic fallback
  // on any engine error. Toggle off to force the legacy brush.
  useBrushEngine: true,
  brushPresetId: 'hard-round',
  // Symmetry/mirror painting: 'none' | 'x' | 'y' | 'xy' (mirror across the
  // canvas center axis/axes).
  brushSymmetry: 'none',
  brushSymmetryN: 6, // radial/mandala segment count
  // Stroke stabilizer (0..95) — lags the brush toward the cursor for smooth,
  // shake-free lines. smoothX/Y hold the lagged position during a stroke.
  brushSmoothing: 0,
  smoothX: 0,
  smoothY: 0,
  rawX: null, rawY: null,            // true cursor during a smoothed stroke
  brushSmoothPull: false,            // "Pulled String" — brush trails by a radius
  brushSmoothCatchupEnd: true,       // finish the lagged tail to the cursor on lift
  brushSmoothAdjustZoom: true,       // keep smoothing feel consistent across zoom
  // Brush dynamics (live overrides of the active preset; initialised from the
  // preset on selection, then editable). scatter 0..1 jitter, spacing fraction
  // of diameter, roundness = tip aspect ratio (1 = circular).
  brushScatter: 0,
  brushSpacing: 0.1,
  brushRoundness: 1,
  brushAngleFollow: false, // rotate the tip to follow the stroke direction
  brushTiltAngle: false,   // rotate the tip toward the pen's tilt azimuth (tablet)
  brushTiltSize: false,    // pen tilt ELEVATION grows the dab (flat pen = broader stroke, tablet)
  brushPressureOpacity: true, // pen pressure scales per-dab opacity/flow (default on)
  brushBlendMode: 'source-over', // brush blend mode (Normal/Multiply/Screen/…) for shading & glazing
  brushColorJitter: 0, // per-dab hue jitter 0..1 (Color Dynamics, natural-media variation)
  brushSizeJitter: 0,  // per-dab size jitter 0..1 (Shape Dynamics)
  brushFlowJitter: 0,  // per-dab flow jitter 0..1 (Transfer Dynamics)

  // Tab toggles tool + side panels for a full-canvas view.
  panelsHidden: false,
  // Hold Space → temporary hand tool (drag the canvas to pan / overscan).
  spaceDown: false,
  // Live pointer readings captured from Pointer Events (pen pressure/tilt).
  // Default pressure 1 so mouse input paints at full strength.
  pressure: 1,
  lastPressure: 1, // previous sample's pressure → smooth per-segment pressure taper
  lastStrokeT: 0,  // timestamp of the previous stroke sample (for the speed sensor)
  brushVelocityTaper: 0, // 0..100 — fast strokes paint thinner (the speed sensor)
  lineAnchor: null, // last stroke end-point → Shift-click draws a straight line from here
  airbrush: false, // build-up: paint keeps accumulating while the brush is held (Alt+Shift+P)
  brushHudActive: false, // Alt+right-drag on-canvas brush HUD in progress
  brushHudStart: null,   // { x, y, size, soft } captured when the HUD drag began
  quickSelecting: false, // Quick Selection drag in progress (drag-flood selection)
  // ── Text / Type tool ──
  textSize: 48,
  textFont: 'sans-serif',
  textEditingLayerId: null,
  tiltX: 0,
  tiltY: 0,

  // ── Gradient tool ──
  gradActive: false,
  gradStart: null,  // { x, y } in canvas/image coords
  gradEnd: null,

  // ── Marquee selection tool ──
  // Writes state.lassoPoints (rect/ellipse) so it reuses the lasso selection
  // machinery (overlay, delete/copy/mask, feather/grow, invert).
  marqueeActive: false,
  marqueeStart: null,
  // Boolean combine mode for the next marquee commit (Shift/Alt → add/subtract/
  // intersect into the shared wandMask selection). See editor/selection/mask-ops.js.
  selCombineMode: 'replace',
  // Quick Mask (Q): brush/eraser paint the selection mask (wandMask) instead of
  // the layer — white = selected. Toggle back to a normal selection with Q.
  quickMask: false,

  // ── Liquify (forward-warp) tool ──
  liquifyActive: false,
  liquifyLast: null,
  // ── Smudge (smear) tool ──
  smudgeActive: false,
  smudgeLast: null,
  smudgeFingerPaint: false, // start each smudge stroke loaded with the foreground colour
  // ── Mixer brush (wet-paint blending) ──
  mixerActive: false,
  mixerLast: null,
  // ── Dodge / Burn / Sponge tool ──
  dodgeBurnActive: false,
  dodgeBurnLast: null,
  // ── Distort transform (free 4-corner warp) ──
  distortMode: 'free', // 'free' | 'skew' | 'perspective' — constrains corner dragging
  distortActive: false,
  distortLayer: null,
  distortSnapshot: null,
  distortCorners: null,
  // ── Perspective crop (mark a quad → de-skew to a rectangle) ──
  pcropActive: false,
  pcropCorners: null,
};
