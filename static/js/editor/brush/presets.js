/**
 * Default brush presets — data-driven so new brushes are just data, and so
 * imported brushes (PNG/GBR/ABR later) drop into the same shape. Each preset
 * defines a tip, spacing, and dynamics (sensor→curve bindings). Runtime values
 * (size/opacity/flow/color) come from editor state and are modulated here.
 */
import { CURVES } from './curve.js';

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

export const DEFAULT_PRESET_ID = 'hard-round';

export function getPreset(id) {
  return BRUSH_PRESETS.find((p) => p.id === id) || BRUSH_PRESETS[0];
}
