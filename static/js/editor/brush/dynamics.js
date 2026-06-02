/**
 * Brush dynamics — a sensor→curve→parameter model, distilled to what a
 * browser stroke needs.
 *
 * A param definition binds a runtime `base` value (e.g. the brush-size slider)
 * to a SENSOR through a response CURVE, scaled into [min,max]·base:
 *
 *   { sensor:'pressure', curve:CURVES.soft, min:0.1, max:1 }
 *
 * `compileParam` returns fn(paintInfo, base) → number, called once per dab.
 * paintInfo carries the live sensor readings: { pressure, speed, tilt, random }.
 */
import { makeCurve, CURVES } from './curve.js';

function sensorValue(sensor, info) {
  switch (sensor) {
    case 'pressure': return info.pressure != null ? info.pressure : 1;
    case 'speed':    return info.speed != null ? info.speed : 0;     // pre-normalized 0..1
    case 'tilt':     return info.tilt != null ? info.tilt : 0;       // 0..1 (elevation)
    case 'random':   return info.random != null ? info.random : Math.random();
    case 'none':
    default:         return 1;
  }
}

export function compileParam(def = {}) {
  const sensor = def.sensor || 'none';
  const curve = makeCurve(def.curve || CURVES.linear);
  const min = def.min != null ? def.min : (sensor === 'none' ? 1 : 0);
  const max = def.max != null ? def.max : 1;
  const presetBase = def.base != null ? def.base : 1;
  return (info, base) => {
    const b = base != null ? base : presetBase;
    if (sensor === 'none') return b;
    const t = curve.sample(sensorValue(sensor, info));
    return (min + (max - min) * t) * b;
  };
}

/** Fresh per-dab paintInfo by interpolating two stroke samples (random is
 *  re-rolled each dab so fuzzy/scatter dynamics vary along the line). */
export function lerpInfo(from, to, t) {
  const lerp = (a, b) => a + (b - a) * t;
  return {
    pressure: lerp(from.pressure != null ? from.pressure : 1, to.pressure != null ? to.pressure : 1),
    speed: lerp(from.speed != null ? from.speed : 0, to.speed != null ? to.speed : 0),
    tilt: lerp(from.tilt != null ? from.tilt : 0, to.tilt != null ? to.tilt : 0),
    random: Math.random(),
  };
}
