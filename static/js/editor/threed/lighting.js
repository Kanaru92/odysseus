/**
 * Lighting rig for the 3D viewer. Builds three.js lights from the (pure) scene
 * model's `lights[]`, and applies the scene `environment` — including the
 * image-based-lighting seam that can turn the painted canvas into an environment
 * map so the mesh integrates into the scene's light/colour (UE5 SkyLight-style).
 *
 * three.js is passed in (THREE) by the viewer after the lazy load, so this module
 * never imports three directly. New light types register via registry.
 */
import { registerLightType, getLightFactory } from './registry.js';

// Built-in light factories (THREE, def) -> THREE.Light.
function buildBuiltin(THREE, def) {
  const col = new THREE.Color(def.color || '#ffffff');
  let light;
  switch (def.type) {
    case 'ambient': light = new THREE.AmbientLight(col, def.intensity ?? 0.4); break;
    case 'point': light = new THREE.PointLight(col, def.intensity ?? 1, def.distance || 0, def.decay ?? 2); break;
    case 'spot': light = new THREE.SpotLight(col, def.intensity ?? 1, def.distance || 0, def.angle ?? Math.PI / 6, def.penumbra ?? 0.2); break;
    case 'directional':
    default: light = new THREE.DirectionalLight(col, def.intensity ?? 1); break;
  }
  if (light.position && def.position) light.position.set(...def.position);
  if (light.target && def.target && light.target.position) light.target.position.set(...def.target);
  light.userData.geId = def.id;
  return light;
}
// Register built-ins so they're discoverable + overridable like any extension.
['ambient', 'directional', 'point', 'spot'].forEach((t) => registerLightType(t, buildBuiltin));

/** Build all lights for a scene model into a fresh group. */
export function buildLights(THREE, sceneModel) {
  const group = new THREE.Group();
  group.name = 'ge-lights';
  for (const def of sceneModel.lights || []) {
    const factory = getLightFactory(def.type) || buildBuiltin;
    const light = factory(THREE, def);
    if (light) { group.add(light); if (light.target) group.add(light.target); }
  }
  return group;
}

/**
 * Apply scene environment + image-based lighting.
 *
 * If `sceneModel.environment.ibl?.source === 'canvas'` and a `canvas` is provided,
 * build an environment map FROM THE PAINTED IMAGE and use it for IBL so the mesh
 * picks up the scene's ambient colour/light — the "live HDRI from your image"
 * feature. Basic equirect→PMREM version now; upgrade to true latlong/HDR later.
 */
export function applyEnvironment(THREE, renderer, threeScene, sceneModel, opts = {}) {
  const env = sceneModel.environment || {};
  threeScene.background = env.background ? new THREE.Color(env.background) : null;
  if (renderer && 'toneMappingExposure' in renderer) renderer.toneMappingExposure = env.exposure ?? 1;

  const ibl = env.ibl;
  if (ibl && ibl.source === 'canvas' && opts.canvas && renderer) {
    try {
      const tex = new THREE.CanvasTexture(opts.canvas);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envMap = pmrem.fromEquirectangular(tex).texture;
      threeScene.environment = envMap;
      tex.dispose(); pmrem.dispose();
      return envMap; // caller disposes on rebuild
    } catch (e) {
      console.warn('[3d] canvas IBL failed; falling back to rig lights', e && e.message);
    }
  } else if (ibl && ibl.url) {
    // TODO: load an .hdr/.exr equirect via RGBELoader/EXRLoader (addon) → PMREM.
  }
  threeScene.environment = null;
  return null;
}
