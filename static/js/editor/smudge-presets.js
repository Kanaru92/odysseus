/**
 * Default Smudge tool presets.
 *
 * Each preset is a plain config object of the smudge state fields the kernel
 * (tools/smudge.js) honours. Applying a preset writes these onto `state`; the
 * kernel reads them with safe defaults, so an unset field = current behaviour.
 *
 * Honoured fields (see tools/smudge.js):
 *   strength    0..1   base smear length (pins the slider; unset = use slider)
 *   hardness    0..100 tip falloff (high = tight core; unset = derive from brush softness)
 *   spacing     >0     dab spacing as a fraction of radius (default 0.15 = dense)
 *   scatter     0..1   random radial offset of each dab (fraction of radius)
 *   jitter      0..1   per-dab random strength drop (broken / scratchy deposit)
 *   fingerPaint bool   seed each stroke with the foreground colour (smears fg paint)
 *   sampleAll   bool   seed from the flattened composite (all visible layers)
 *
 * Names are brand-neutral, descriptive labels. They are tuned to FEEL distinct:
 * "Just Add Water" = strong, soft, dense, no finger-paint (pure dilution);
 * "Scratchy" / "Spatter Blend" = high scatter+jitter (broken, speckled);
 * "Hard Dapple" / "Pebbled Blend" = wide spacing + hard tip (textured dabs);
 * "Directional Blend" = very strong, dense, soft (long unbroken smear).
 */

/** @type {{name:string, config:Object}[]} */
export const SMUDGE_PRESETS = [
  {
    name: 'Bristle Blend Straight',
    // Medium strength, slightly hard tip, modest spacing → streaky bristle drag.
    config: { strength: 0.55, hardness: 60, spacing: 0.22, scatter: 0.05, jitter: 0.1, fingerPaint: false, sampleAll: false },
  },
  {
    name: 'Directional Blend',
    // Very strong, dense, soft → long unbroken directional smear.
    config: { strength: 0.92, hardness: 25, spacing: 0.1, scatter: 0, jitter: 0, fingerPaint: false, sampleAll: false },
  },
  {
    name: 'Hard Dapple',
    // Hard tip + wide spacing → distinct dappled stamps rather than a smooth trail.
    config: { strength: 0.7, hardness: 95, spacing: 0.65, scatter: 0.15, jitter: 0.15, fingerPaint: false, sampleAll: false },
  },
  {
    name: 'Impressionist Blender',
    // Soft, finger-painting on, light scatter → smears fg paint in loose dabs.
    config: { strength: 0.6, hardness: 35, spacing: 0.3, scatter: 0.25, jitter: 0.2, fingerPaint: true, sampleAll: false },
  },
  {
    name: 'Just Add Water',
    // High strength, no finger-paint, soft tip, dense → pure dilution / blend.
    config: { strength: 0.9, hardness: 20, spacing: 0.12, scatter: 0, jitter: 0, fingerPaint: false, sampleAll: false },
  },
  {
    name: 'Noisy Smudge',
    // Mid strength with heavy jitter and some scatter → grainy, noisy smear.
    config: { strength: 0.6, hardness: 50, spacing: 0.25, scatter: 0.3, jitter: 0.6, fingerPaint: false, sampleAll: false },
  },
  {
    name: 'Painterly Blend',
    // Soft, sample-all-layers, dense → smooth multi-layer painterly blending.
    config: { strength: 0.75, hardness: 30, spacing: 0.15, scatter: 0.05, jitter: 0.05, fingerPaint: false, sampleAll: true },
  },
  {
    name: 'Pebbled Blend',
    // Hard-ish tip, wide spacing, moderate scatter → pebbled / textured blend.
    config: { strength: 0.65, hardness: 80, spacing: 0.85, scatter: 0.35, jitter: 0.25, fingerPaint: false, sampleAll: false },
  },
  {
    name: 'Scratchy',
    // High scatter + high jitter, hard tip → broken, scratchy strokes.
    config: { strength: 0.55, hardness: 85, spacing: 0.4, scatter: 0.6, jitter: 0.7, fingerPaint: false, sampleAll: false },
  },
  {
    name: 'Smudge Nice',
    // The balanced default-feeling smudge — medium everything.
    config: { strength: 0.6, hardness: 50, spacing: 0.15, scatter: 0, jitter: 0, fingerPaint: false, sampleAll: false },
  },
  {
    name: 'Spatter Blend',
    // Maximum scatter + jitter, wider spacing → spattered, flecked smear.
    config: { strength: 0.6, hardness: 70, spacing: 0.55, scatter: 0.85, jitter: 0.55, fingerPaint: false, sampleAll: false },
  },
];

/**
 * Apply a preset's config onto the smudge `state` fields and keep the live
 * Strength slider (if present) in sync. Safe to call with a partial config.
 * @param {Object} state  the editor state object
 * @param {Object} config a preset.config (or any subset of honoured fields)
 */
export function applySmudgePreset(state, config) {
  if (!state || !config) return;
  if (typeof config.strength === 'number') {
    state.smudgeStrength = config.strength;
    // Mirror into the canonical Strength slider so the options bar reflects it.
    const el = typeof document !== 'undefined' && document.getElementById('ge-smudge-strength');
    if (el) {
      el.value = String(Math.round(config.strength * 100));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  if (typeof config.hardness === 'number') state.smudgeHardness = config.hardness;
  if (typeof config.spacing === 'number') state.smudgeSpacing = config.spacing;
  if (typeof config.scatter === 'number') state.smudgeScatter = config.scatter;
  if (typeof config.jitter === 'number') state.smudgeJitter = config.jitter;
  if (typeof config.fingerPaint === 'boolean') {
    state.smudgeFingerPaint = config.fingerPaint;
    const el = typeof document !== 'undefined' && document.getElementById('ge-smudge-finger');
    if (el) { el.checked = config.fingerPaint; el.dispatchEvent(new Event('change', { bubbles: true })); }
  }
  if (typeof config.sampleAll === 'boolean') state.smudgeSampleAll = config.sampleAll;
}
