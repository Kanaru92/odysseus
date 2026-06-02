/**
 * Extension registries for the 3D system. New model formats, light types, and
 * (future) rig/IK solvers register here so adding capability never edits core.
 *
 * Pure data + functions — no three.js. Registered factories receive the lazily
 * loaded three module at call time, so registration itself stays renderer-light.
 */

const loaders = new Map();   // format -> async (THREE, url, opts) -> Object3D
const lightTypes = new Map(); // type   -> (THREE, lightDef) -> THREE.Light
const rigSolvers = new Map(); // name   -> solver instance/factory (IK etc.)

// ── Model loaders ─────────────────────────────────────────────────────────────
export function registerLoader(format, loaderFn) { loaders.set(String(format).toLowerCase(), loaderFn); }
export function getLoader(format) { return loaders.get(String(format).toLowerCase()) || null; }
export function supportedFormats() { return [...loaders.keys()]; }
/** Map a filename/extension to a registered format (or null). */
export function formatForFile(name) {
  const ext = String(name || '').toLowerCase().split('.').pop();
  const alias = { glb: 'gltf', gltf: 'gltf', obj: 'obj', fbx: 'fbx', stl: 'stl' };
  const fmt = alias[ext] || ext;
  return loaders.has(fmt) ? fmt : null;
}

// ── Light types ───────────────────────────────────────────────────────────────
export function registerLightType(type, factory) { lightTypes.set(type, factory); }
export function getLightFactory(type) { return lightTypes.get(type) || null; }

// ── Rig / IK solvers (future posing) ─────────────────────────────────────────
export function registerRigSolver(name, solver) { rigSolvers.set(name, solver); }
export function getRigSolver(name) { return rigSolvers.get(name) || null; }
export function rigSolvers_list() { return [...rigSolvers.keys()]; }
