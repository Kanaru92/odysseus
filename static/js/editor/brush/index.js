/**
 * Brush engine public surface. Import from here:
 *   import { createBrushEngine, getPreset } from './brush/index.js';
 */
export { createBrushEngine } from './engine.js';
export { BRUSH_PRESETS, DEFAULT_PRESET_ID, getPreset } from './presets.js';
export { makeCurve, CURVES } from './curve.js';
export { makeTip, imageTip } from './tips.js';
export { compileParam, lerpInfo } from './dynamics.js';
