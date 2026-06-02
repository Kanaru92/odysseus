# Brush engine (`editor/brush/`)

The painting core (Milestone M1). Decoupled, data-driven, and testable in
isolation — the hot path is `engine.segment()` stamping cached tips.

## Modules
- `curve.js` — response curve → LUT (`makeCurve`, `CURVES`). Sensor→curve→param.
- `tips.js` — tip stamp generation (`makeTip`: round/soft/gaussian; `imageTip`
  for predefined/PNG/GBR tips later). White mask tinted via `source-in`.
- `dynamics.js` — `compileParam` (sensor + curve + min/max·base) and `lerpInfo`
  (per-dab interpolation; re-rolls `random`). Sensors: pressure, speed, tilt, random.
- `engine.js` — `createBrushEngine(preset)` → `{ begin, segment, end }`. Stamps
  dabs at spacing (fraction of diameter) with interpolation + a tip cache.
- `presets.js` — data-driven default brushes (hard/soft round, pencil, airbrush,
  inker). Imported brushes will be the same shape.
- `index.js` — barrel.

Runtime values (size/opacity/flow/color/hardness/blendMode) come from editor
state per stroke; the preset's dynamics modulate them. So the existing brush
sliders keep working and pressure simply shapes them.

## Integration (NEXT — do behind the `state.useBrushEngine` flag, then verify in-app)
1. **Pointer Events**: in `editor/canvas-events.js`, add `pointerdown/move`
   listeners that write `state.pressure / tiltX / tiltY` (additive — leave the
   mouse handlers driving draw, so no double-fire/regression). Prefer
   `getCoalescedEvents()` for fast strokes.
2. **Route the stroke**: in `editor/stroke-pipeline.js:strokeTo`, when
   `state.useBrushEngine` and tool is `brush` (not mask/eraser/clone/inpaint),
   call `engine.segment(ctx, from, to, rt)` with
   `rt = { size: state.brushSize, opacity: state.brushOpacity/100,
   flow: state.brushFlow/100, color: state.color,
   hardness: 1 - state.brushSoftness/300 }` and
   `from/to = { x, y, pressure: state.pressure, tilt, speed }`. Else keep the
   legacy `lineTo`. Build the engine lazily from `getPreset(state.brushPresetId)`.
3. **Brushes panel + presets dropdown** in the right dock.
4. Flip `state.useBrushEngine` default to true once verified on a real stylus.

## Later (parity, see ../KRITA-PARITY.md §1)
Smudge, dual/masked brush, texture option, more sensors (drawing-angle,
fade, distance, tilt-direction), stabilizer smoothing, brush import (PNG/GBR/ABR).
