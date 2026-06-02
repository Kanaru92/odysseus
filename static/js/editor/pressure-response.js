/**
 * User pressure-response curve (Clip-Studio-style calibration). Remaps raw
 * stylus pressure [0,1] → effective pressure [0,1] BEFORE it reaches the brush
 * dynamics, so the whole pipeline (size/opacity/flow that key off pressure)
 * follows the user's curve. Default is linear (identity) → zero behaviour change
 * for anyone who never touches it.
 *
 * The curve points are baked to a LUT via the brush engine's curve.js so the
 * per-dab hot path stays O(1). Shared by pressure-curve.js (the editor UI) and
 * stroke-pipeline.js (the sampler).
 */
import { makeCurve, CURVES } from './brush/curve.js';

export const PRESSURE_PRESETS = {
  linear: CURVES.linear, // [[0,0],[1,1]]
  soft: CURVES.soft,     // light pressure already lays paint
  hard: CURVES.hard,     // only firm pressure registers (inking)
};

let _points = [[0, 0], [1, 1]];
let _lut = makeCurve(_points);

export function setPressureCurve(points) {
  if (Array.isArray(points) && points.length >= 2) {
    _points = points.map((p) => [Math.max(0, Math.min(1, p[0])), Math.max(0, Math.min(1, p[1]))]);
    _lut = makeCurve(_points);
  }
}
export function getPressureCurve() {
  return _points.map((p) => p.slice());
}
/** Remap a raw pressure value through the active curve. */
export function samplePressure(x) {
  return _lut.sample(x);
}
