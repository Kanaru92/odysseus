/**
 * Public API for the 3D model integration. The editor talks to THIS module only
 * (not the internals), so the renderer/loaders/rig can evolve underneath.
 *
 * Default experience needs ZERO external tools: three.js is vendored + bundled by
 * us and a glTF/GLB is just a file the viewer reads — users never need Blender or
 * any 3D app. See documentation/painting-suite/3D-INTEGRATION-DESIGN.md.
 */
import {
  createSceneModel, serializeScene, deserializeScene,
  addModel, removeModel, getModel, setModelTransform,
  setCamera, addLight, removeLight, setLight, setEnvironment,
  setPose, clearPose, select,
  getAnimatableChannels, getChannel, setChannel,
} from './scene-model.js';
import { createViewer } from './viewer.js';
import { bakeToCanvas } from './bake.js';
import { formatForFile, supportedFormats, registerLoader, registerLightType, registerRigSolver } from './registry.js';
import { loadThree } from './three-loader.js';
import { discoverBones, applyPose, readPose, hasArmature, PoseController } from './rig.js';
import './loaders.js'; // register default loaders (gltf/glb/obj/fbx/stl)

// Scene model (pure SSOT)
export {
  createSceneModel, serializeScene, deserializeScene,
  addModel, removeModel, getModel, setModelTransform,
  setCamera, addLight, removeLight, setLight, setEnvironment,
  setPose, clearPose, select,
  getAnimatableChannels, getChannel, setChannel,
};
// Renderer + bake
export { createViewer, bakeToCanvas };
// Registries (extension points)
export { registerLoader, registerLightType, registerRigSolver, supportedFormats, formatForFile };
// Rig / posing
export { discoverBones, applyPose, readPose, hasArmature, PoseController };

/** Is the 3D renderer usable right now? (lazy-probes three.js). */
export async function is3DAvailable() { return !!(await loadThree()); }

/**
 * Turn a dropped/opened File into an addModel() argument: an object URL + the
 * detected format. Returns null for unsupported types. Caller revokes the URL on
 * layer disposal.
 */
export function modelSourceFromFile(file) {
  if (!file || !file.name) return null;
  const format = formatForFile(file.name);
  if (!format) return null;
  return { url: URL.createObjectURL(file), name: file.name.replace(/\.[^.]+$/, ''), format };
}

/**
 * Convenience: build a scene with one model from a File. The editor wraps the
 * returned sceneModel in a layer { kind:'3d', scene } and mounts a viewer.
 */
export function sceneFromFile(file) {
  const src = modelSourceFromFile(file);
  if (!src) return null;
  const scene = createSceneModel();
  addModel(scene, src);
  return scene;
}
