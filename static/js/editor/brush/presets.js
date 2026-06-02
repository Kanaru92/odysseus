/**
 * Default brush presets — data-driven so new brushes are just data, and so
 * imported brushes (PNG/GBR/ABR later) drop into the same shape. Each preset
 * defines a tip, spacing, and dynamics (sensor→curve bindings). Runtime values
 * (size/opacity/flow/color) come from editor state and are modulated here.
 */
import { CURVES } from './curve.js';
import { DEFAULT_TIP_DATA } from './default-tips.js';

// Pressure drives SIZE and/or FLOW (per-dab build-up). Opacity is the
// stroke-level cap from the Opacity slider, applied once per stroke by the
// engine, so it isn't a per-dab dynamic here.
export const BRUSH_PRESETS = [
  {
    id: 'hard-round',
    name: 'Hard Round (Pressure)',
    tipType: 'round',
    spacing: 0.08,
    dynamics: {
      size: { sensor: 'pressure', curve: CURVES.linear, min: 0.15, max: 1 },
      flow: { sensor: 'none' },
    },
  },
  {
    id: 'soft-round',
    name: 'Soft Round (Pressure)',
    tipType: 'soft',
    spacing: 0.06,
    dynamics: {
      size: { sensor: 'pressure', curve: CURVES.soft, min: 0.2, max: 1 },
      flow: { sensor: 'pressure', curve: CURVES.soft, min: 0.3, max: 1 },
    },
  },
  {
    id: 'pencil',
    name: 'Pencil (Flow by Pressure)',
    tipType: 'round',
    spacing: 0.05,
    dynamics: {
      size: { sensor: 'none' },
      flow: { sensor: 'pressure', curve: CURVES.hard, min: 0.05, max: 1 },
    },
  },
  {
    id: 'airbrush-soft',
    name: 'Airbrush (Soft Build-up)',
    tipType: 'gaussian',
    spacing: 0.03,
    dynamics: {
      size: { sensor: 'pressure', curve: CURVES.soft, min: 0.4, max: 1 },
      flow: { sensor: 'pressure', curve: CURVES.soft, min: 0.05, max: 0.4 },
    },
  },
  {
    id: 'inker',
    name: 'Inker (Firm)',
    tipType: 'round',
    spacing: 0.05,
    dynamics: {
      size: { sensor: 'pressure', curve: CURVES.hard, min: 0.05, max: 1 },
      flow: { sensor: 'none' },
    },
  },
  {
    id: 'marker',
    name: 'Marker',
    tipType: 'round',
    spacing: 0.02,
    dynamics: { size: { sensor: 'none' }, flow: { sensor: 'none' } },
  },
  {
    id: 'chalk',
    name: 'Chalk (Textured)',
    tipType: 'soft',
    spacing: 0.14,
    scatter: 0.35,
    dynamics: {
      size: { sensor: 'pressure', curve: CURVES.soft, min: 0.4, max: 1 },
      flow: { sensor: 'pressure', curve: CURVES.soft, min: 0.4, max: 1 },
    },
  },
  {
    id: 'detailer',
    name: 'Detailer (Fine)',
    tipType: 'round',
    spacing: 0.04,
    dynamics: {
      size: { sensor: 'pressure', curve: CURVES.hard, min: 0.1, max: 0.6 },
      flow: { sensor: 'none' },
    },
  },
  {
    id: 'calligraphy',
    name: 'Calligraphy (Flat Nib)',
    tipType: 'round',
    spacing: 0.04,
    ratio: 0.28,          // squashed nib
    angleFollow: true,    // nib rotates along the stroke
    dynamics: {
      size: { sensor: 'pressure', curve: CURVES.hard, min: 0.4, max: 1 },
      flow: { sensor: 'none' },
    },
  },
  {
    id: 'flat-marker',
    name: 'Flat Marker',
    tipType: 'round',
    spacing: 0.03,
    ratio: 0.5,
    angleFollow: true,
    dynamics: { size: { sensor: 'none' }, flow: { sensor: 'none' } },
  },
  {
    id: 'spray',
    name: 'Spray (Scatter)',
    tipType: 'gaussian',
    spacing: 0.12,
    scatter: 0.85,
    dynamics: {
      size: { sensor: 'pressure', curve: CURVES.soft, min: 0.5, max: 1 },
      flow: { sensor: 'pressure', curve: CURVES.soft, min: 0.1, max: 0.5 },
    },
  },
  {
    id: 'stipple',
    name: 'Stipple (Dotted)',
    tipType: 'round',
    spacing: 0.55,        // large gap → discrete dabs
    scatter: 0.4,
    dynamics: {
      size: { sensor: 'pressure', curve: CURVES.linear, min: 0.4, max: 1 },
      flow: { sensor: 'none' },
    },
  },
  {
    id: 'soft-shader',
    name: 'Soft Shader (Blend)',
    tipType: 'gaussian',
    spacing: 0.04,
    dynamics: {
      size: { sensor: 'pressure', curve: CURVES.soft, min: 0.3, max: 1 },
      flow: { sensor: 'pressure', curve: CURVES.soft, min: 0.03, max: 0.25 },
    },
  },
  {
    id: 'charcoal',
    name: 'Charcoal (Grain)',
    tipType: 'soft',
    spacing: 0.05,
    grainKind: 'noise',   // procedural grain materialised in stroke-pipeline
    grainDepth: 0.6,
    dynamics: {
      size: { sensor: 'pressure', curve: CURVES.linear, min: 0.3, max: 1 },
      flow: { sensor: 'pressure', curve: CURVES.soft, min: 0.3, max: 1 },
    },
  },
];

// ── Sampled (bitmap-tip) default presets ──
// These use baked grayscale coverage maps from default-tips.js as image tips —
// the SAME tipType:'image' path the .abr/.gbr import uses, so they render
// identically to an imported sampled brush. The bitmap is the brush shape; the
// engine tints it with the active colour via makeTip's luminance mask. `tipKey`
// names the entry in DEFAULT_TIP_DATA; `tipImage` is filled in at load below.
const SAMPLED_PRESETS = [
  {
    id: 'sketch-tangle', name: 'Sketch Tangle', tipKey: 'sketch-tangle',
    tipType: 'image', spacing: 0.12,
    dynamics: { size: { sensor: 'pressure', curve: CURVES.linear, min: 0.4, max: 1 }, flow: { sensor: 'pressure', curve: CURVES.soft, min: 0.4, max: 1 } },
  },
  {
    id: 'rough-cloud', name: 'Rough Cloud', tipKey: 'rough-cloud',
    tipType: 'image', spacing: 0.18, scatter: 0.15,
    dynamics: { size: { sensor: 'pressure', curve: CURVES.soft, min: 0.5, max: 1 }, flow: { sensor: 'pressure', curve: CURVES.soft, min: 0.3, max: 1 } },
  },
  {
    id: 'soft-cloud', name: 'Soft Cloud', tipKey: 'soft-cloud',
    tipType: 'image', spacing: 0.14,
    dynamics: { size: { sensor: 'pressure', curve: CURVES.soft, min: 0.5, max: 1 }, flow: { sensor: 'pressure', curve: CURVES.soft, min: 0.25, max: 0.9 } },
  },
  {
    id: 'splatter-burst', name: 'Splatter Burst', tipKey: 'splatter-burst',
    tipType: 'image', spacing: 0.45, scatter: 0.5,
    dynamics: { size: { sensor: 'pressure', curve: CURVES.linear, min: 0.5, max: 1 }, flow: { sensor: 'none' }, rotation: { sensor: 'random', base: 180, min: -1, max: 1 } },
  },
  {
    id: 'fine-specks', name: 'Fine Specks', tipKey: 'fine-specks',
    tipType: 'image', spacing: 0.08,
    dynamics: { size: { sensor: 'pressure', curve: CURVES.soft, min: 0.4, max: 1 }, flow: { sensor: 'pressure', curve: CURVES.soft, min: 0.4, max: 1 } },
  },
  {
    id: 'coarse-grain', name: 'Coarse Grain', tipKey: 'coarse-grain',
    tipType: 'image', spacing: 0.1,
    dynamics: { size: { sensor: 'pressure', curve: CURVES.linear, min: 0.4, max: 1 }, flow: { sensor: 'pressure', curve: CURVES.soft, min: 0.4, max: 1 } },
  },
  {
    id: 'stone-texture', name: 'Stone Texture', tipKey: 'stone-texture',
    tipType: 'image', spacing: 0.08,
    dynamics: { size: { sensor: 'pressure', curve: CURVES.linear, min: 0.5, max: 1 }, flow: { sensor: 'pressure', curve: CURVES.soft, min: 0.5, max: 1 } },
  },
  {
    id: 'wood-grain', name: 'Wood Grain', tipKey: 'wood-grain',
    tipType: 'image', spacing: 0.06,
    dynamics: { size: { sensor: 'pressure', curve: CURVES.linear, min: 0.5, max: 1 }, flow: { sensor: 'pressure', curve: CURVES.soft, min: 0.4, max: 1 } },
  },
  {
    id: 'rocky-ridge', name: 'Rocky Ridge', tipKey: 'rocky-ridge',
    tipType: 'image', spacing: 0.1, angleFollow: true,
    dynamics: { size: { sensor: 'pressure', curve: CURVES.linear, min: 0.5, max: 1 }, flow: { sensor: 'pressure', curve: CURVES.soft, min: 0.4, max: 1 } },
  },
  {
    id: 'soft-oval-fade', name: 'Soft Oval Fade', tipKey: 'soft-oval-fade',
    tipType: 'image', spacing: 0.07, angleFollow: true,
    dynamics: { size: { sensor: 'pressure', curve: CURVES.soft, min: 0.4, max: 1 }, flow: { sensor: 'pressure', curve: CURVES.soft, min: 0.2, max: 0.9 } },
  },
  {
    id: 'star-field', name: 'Star Field', tipKey: 'star-field',
    tipType: 'image', spacing: 0.4, scatter: 0.4,
    dynamics: { size: { sensor: 'pressure', curve: CURVES.linear, min: 0.5, max: 1 }, flow: { sensor: 'none' } },
  },
  {
    id: 'bokeh-dots', name: 'Bokeh Dots', tipKey: 'bokeh-dots',
    tipType: 'image', spacing: 0.3, scatter: 0.45,
    dynamics: { size: { sensor: 'pressure', curve: CURVES.soft, min: 0.4, max: 1 }, flow: { sensor: 'pressure', curve: CURVES.soft, min: 0.3, max: 0.9 } },
  },
  {
    id: 'vertical-scratch', name: 'Vertical Scratch', tipKey: 'vertical-scratch',
    tipType: 'image', spacing: 0.1, angleFollow: true,
    dynamics: { size: { sensor: 'pressure', curve: CURVES.linear, min: 0.4, max: 1 }, flow: { sensor: 'pressure', curve: CURVES.soft, min: 0.4, max: 1 } },
  },
  {
    id: 'debris-scatter', name: 'Debris Scatter', tipKey: 'debris-scatter',
    tipType: 'image', spacing: 0.35, scatter: 0.55,
    dynamics: { size: { sensor: 'pressure', curve: CURVES.linear, min: 0.5, max: 1 }, flow: { sensor: 'none' }, rotation: { sensor: 'random', base: 180, min: -1, max: 1 } },
  },
  {
    id: 'flecks-field', name: 'Flecks Field', tipKey: 'flecks-field',
    tipType: 'image', spacing: 0.12, scatter: 0.2,
    dynamics: { size: { sensor: 'pressure', curve: CURVES.soft, min: 0.5, max: 1 }, flow: { sensor: 'pressure', curve: CURVES.soft, min: 0.4, max: 1 } },
  },
  {
    id: 'rough-sphere', name: 'Rough Sphere', tipKey: 'rough-sphere',
    tipType: 'image', spacing: 0.1,
    dynamics: { size: { sensor: 'pressure', curve: CURVES.soft, min: 0.5, max: 1 }, flow: { sensor: 'pressure', curve: CURVES.soft, min: 0.4, max: 1 } },
  },
  {
    id: 'textured-leaf', name: 'Textured Leaf', tipKey: 'textured-leaf',
    tipType: 'image', spacing: 0.16, scatter: 0.2, angleFollow: true,
    dynamics: { size: { sensor: 'pressure', curve: CURVES.linear, min: 0.5, max: 1 }, flow: { sensor: 'pressure', curve: CURVES.soft, min: 0.4, max: 1 }, rotation: { sensor: 'random', base: 180, min: -1, max: 1 } },
  },
  {
    id: 'floral-splatter', name: 'Floral Splatter', tipKey: 'floral-splatter',
    tipType: 'image', spacing: 0.4, scatter: 0.45,
    dynamics: { size: { sensor: 'pressure', curve: CURVES.linear, min: 0.5, max: 1 }, flow: { sensor: 'none' }, rotation: { sensor: 'random', base: 180, min: -1, max: 1 } },
  },
];

// Build an Image per baked tip and attach it as `tipImage` (the engine/makeTip
// image path consumes an Image/canvas, exactly like the import flow). Guarded
// for non-browser contexts (static module-graph checks) where Image is absent;
// there the presets still load with tipImage null and simply render as a plain
// round dab until a browser builds the tips.
//
// The bitmaps are large data: URIs that still take an async decode tick, so a
// dab stamped before decode would draw a blank mask — and makeTip's image path
// would then cache that blank tip with no invalidation. To avoid that race we
// (a) force decode eagerly via img.decode() so the bitmaps are ready as soon as
// possible, (b) expose a `tipsReady` promise + `whenTipsReady()` so consumers
// can gate the first stamp, and (c) once all tips finish decoding, fire a
// 'ge:brush-tips-ready' event so any tip cache built during the decode window
// can be invalidated and rebuilt against the now-decoded bitmaps.
let tipsReady = Promise.resolve();
if (typeof Image !== 'undefined') {
  const decodes = [];
  for (const p of SAMPLED_PRESETS) {
    const url = DEFAULT_TIP_DATA[p.tipKey];
    if (!url) continue;
    const img = new Image();
    img.src = url;
    p.tipImage = img;
    // decode() resolves when the bitmap is paintable; fall back to onload for
    // engines without decode(). Swallow rejection so one bad tip can't reject
    // the whole readiness promise.
    const done = typeof img.decode === 'function'
      ? img.decode().catch(() => {})
      : new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; });
    decodes.push(done);
  }
  tipsReady = Promise.all(decodes).then(() => {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event('ge:brush-tips-ready'));
    }
  });
}
BRUSH_PRESETS.push(...SAMPLED_PRESETS);

/** Resolves once every baked sampled-tip bitmap has decoded (immediately in
 *  non-browser contexts). Use to gate the first stamp of a sampled brush. */
export function whenTipsReady() {
  return tipsReady;
}

export const DEFAULT_PRESET_ID = 'hard-round';

export function getPreset(id) {
  return BRUSH_PRESETS.find((p) => p.id === id) || BRUSH_PRESETS[0];
}
