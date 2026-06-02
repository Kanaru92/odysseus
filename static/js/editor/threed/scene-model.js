/**
 * 3D scene model — the single source of truth for a 3D layer.
 *
 * Pure, serializable, and renderer-agnostic: NO three.js (or any renderer) types
 * leak in here. The viewer reflects this model; persistence stores it; the
 * animation timeline keyframes it via the channel API below. Keeping it pure is
 * what makes the 3D system testable, swappable (WebGL2→WebGPU), and animatable.
 *
 * See documentation/painting-suite/3D-INTEGRATION-DESIGN.md.
 */

export const SCENE_VERSION = 1;

let _uid = 0;
const uid = (p) => `${p}-${(++_uid).toString(36)}`;
const v3 = (x = 0, y = 0, z = 0) => [x, y, z];

/** A neutral default 3-point lighting rig (key / fill / rim) + ambient. */
export function defaultLights() {
  return [
    { id: uid('light'), type: 'ambient', color: '#ffffff', intensity: 0.35, position: v3(), target: v3() },
    { id: uid('light'), type: 'directional', color: '#fff4e6', intensity: 1.0, position: v3(4, 6, 6), target: v3() },   // key
    { id: uid('light'), type: 'directional', color: '#dfeaff', intensity: 0.45, position: v3(-6, 3, 2), target: v3() }, // fill
    { id: uid('light'), type: 'directional', color: '#ffffff', intensity: 0.6, position: v3(0, 4, -7), target: v3() },  // rim
  ];
}

/** Create an empty scene with a sensible default camera + lighting rig. */
export function createSceneModel() {
  return {
    version: SCENE_VERSION,
    models: [],
    camera: { position: v3(0, 1.4, 5), target: v3(0, 1, 0), fov: 45, ortho: false },
    lights: defaultLights(),
    environment: { background: null, exposure: 1.0 },
    poses: {},        // { [modelId]: { [boneName]: [rx,ry,rz] } } — filled by rig.js
    selection: { kind: null, id: null, bone: null },
  };
}

// ── Models ──────────────────────────────────────────────────────────────────
export function addModel(scene, { url, name, format }) {
  const model = {
    id: uid('model'),
    name: name || 'Model',
    url: url || null,
    format: format || 'gltf',
    visible: true,
    transform: { position: v3(), rotation: v3(), scale: v3(1, 1, 1) },
  };
  scene.models.push(model);
  scene.selection = { kind: 'model', id: model.id, bone: null };
  return model;
}
export function removeModel(scene, id) {
  scene.models = scene.models.filter((m) => m.id !== id);
  delete scene.poses[id];
  if (scene.selection.id === id) scene.selection = { kind: null, id: null, bone: null };
}
export function getModel(scene, id) { return scene.models.find((m) => m.id === id) || null; }
export function setModelTransform(scene, id, partial) {
  const m = getModel(scene, id); if (!m) return;
  m.transform = { ...m.transform, ...partial };
}

// ── Camera / environment ─────────────────────────────────────────────────────
export function setCamera(scene, partial) { scene.camera = { ...scene.camera, ...partial }; }
export function setEnvironment(scene, partial) { scene.environment = { ...scene.environment, ...partial }; }

// ── Lights (CRUD; new types plug in via registry.registerLightType) ──────────
export function addLight(scene, light) {
  const l = { id: uid('light'), type: 'point', color: '#ffffff', intensity: 1, position: v3(2, 3, 2), target: v3(), ...light };
  scene.lights.push(l);
  return l;
}
export function removeLight(scene, id) { scene.lights = scene.lights.filter((l) => l.id !== id); }
export function setLight(scene, id, partial) {
  const l = scene.lights.find((x) => x.id === id); if (l) Object.assign(l, partial);
}

// ── Posing (rig.js fills bone rotations; stored per model) ────────────────────
export function setPose(scene, modelId, boneName, rotation) {
  if (!scene.poses[modelId]) scene.poses[modelId] = {};
  scene.poses[modelId][boneName] = rotation.slice(0, 3);
}
export function clearPose(scene, modelId) { delete scene.poses[modelId]; }

export function select(scene, sel) {
  scene.selection = { kind: null, id: null, bone: null, ...sel };
}

// ── Serialization (round-trips through the draft payload) ─────────────────────
export function serializeScene(scene) { return JSON.parse(JSON.stringify(scene)); }
export function deserializeScene(obj) {
  const base = createSceneModel();
  if (!obj || typeof obj !== 'object') return base;
  // Shallow-merge known fields; tolerate version drift / missing keys.
  return {
    version: SCENE_VERSION,
    models: Array.isArray(obj.models) ? obj.models.map((m) => ({
      id: m.id || uid('model'), name: m.name || 'Model', url: m.url || null,
      format: m.format || 'gltf', visible: m.visible !== false,
      transform: {
        position: (m.transform && m.transform.position) || v3(),
        rotation: (m.transform && m.transform.rotation) || v3(),
        scale: (m.transform && m.transform.scale) || v3(1, 1, 1),
      },
    })) : [],
    camera: { ...base.camera, ...(obj.camera || {}) },
    lights: Array.isArray(obj.lights) && obj.lights.length ? obj.lights.map((l) => ({ ...l })) : base.lights,
    environment: { ...base.environment, ...(obj.environment || {}) },
    poses: obj.poses && typeof obj.poses === 'object' ? JSON.parse(JSON.stringify(obj.poses)) : {},
    selection: { kind: null, id: null, bone: null },
  };
}

// ── Animation channels (generic keyframing seam for the timeline) ─────────────
// Channels are addressable paths whose values are numbers or number-arrays, so a
// single keyframe engine can drive camera moves, model transforms, and posing.
export function getAnimatableChannels(scene) {
  const ch = [
    { path: 'camera.position', type: 'vec3', value: scene.camera.position.slice() },
    { path: 'camera.target', type: 'vec3', value: scene.camera.target.slice() },
    { path: 'camera.fov', type: 'number', value: scene.camera.fov },
  ];
  for (const m of scene.models) {
    ch.push({ path: `models.${m.id}.transform.position`, type: 'vec3', value: m.transform.position.slice() });
    ch.push({ path: `models.${m.id}.transform.rotation`, type: 'vec3', value: m.transform.rotation.slice() });
    ch.push({ path: `models.${m.id}.transform.scale`, type: 'vec3', value: m.transform.scale.slice() });
  }
  for (const modelId of Object.keys(scene.poses)) {
    for (const bone of Object.keys(scene.poses[modelId])) {
      ch.push({ path: `poses.${modelId}.${bone}`, type: 'vec3', value: scene.poses[modelId][bone].slice() });
    }
  }
  return ch;
}

/** Resolve/assign a channel path like "models.<id>.transform.position". */
function _resolve(scene, path) {
  const parts = path.split('.');
  let obj = scene;
  for (let i = 0; i < parts.length - 1; i++) {
    let key = parts[i];
    if (key === 'models') { const id = parts[++i]; obj = (obj.models || []).find((m) => m.id === id); }
    else if (key === 'poses') { const id = parts[++i]; obj = (obj.poses[id] = obj.poses[id] || {}); }
    else obj = obj[key];
    if (obj == null) return null;
  }
  return { obj, key: parts[parts.length - 1] };
}
export function getChannel(scene, path) {
  const r = _resolve(scene, path); if (!r) return undefined;
  const v = r.obj[r.key]; return Array.isArray(v) ? v.slice() : v;
}
export function setChannel(scene, path, value) {
  const r = _resolve(scene, path); if (!r) return false;
  r.obj[r.key] = Array.isArray(value) ? value.slice() : value;
  return true;
}
