/**
 * three.js-backed Viewer — the ONLY renderer file. Lazy: three loads on first
 * create; if unavailable it returns { available:false } so the editor degrades.
 * Reflects the pure scene model (camera / lights / environment-IBL / models),
 * provides Orbit + Transform controls, and renders to a canvas for baking.
 *
 * Swap this implementation (e.g. a WebGPU viewer, or a server-Cycles proxy) behind
 * the same shape without touching feature code.
 */
import { loadThree, loadAddon } from './three-loader.js';
import { buildLights, applyEnvironment } from './lighting.js';
import { getLoader, formatForFile } from './registry.js';
import './loaders.js'; // register default loaders

export async function createViewer({ width = 512, height = 512, alpha = true } = {}) {
  const THREE = await loadThree();
  if (!THREE) return { available: false };

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha, preserveDrawingBuffer: true });
  renderer.setSize(width, height, false);
  if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
  if ('ACESFilmicToneMapping' in THREE) renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 2000);
  const modelRoots = new Map();       // modelId -> Object3D
  let lightsGroup = null, envMap = null, controls = null, gizmo = null;

  const api = {
    available: true, THREE, renderer, scene, camera,
    get domElement() { return renderer.domElement; },

    async setupControls(hostEl) {
      const el = hostEl || renderer.domElement;
      const oc = await loadAddon('controls/OrbitControls.js');
      if (oc && oc.OrbitControls) { controls = new oc.OrbitControls(camera, el); controls.enableDamping = true; }
      const tc = await loadAddon('controls/TransformControls.js');
      if (tc && tc.TransformControls) { gizmo = new tc.TransformControls(camera, el); scene.add(gizmo); }
      return { controls, gizmo };
    },

    /** Reflect the pure scene model into the three scene. opts.canvas → canvas-IBL. */
    async syncFromModel(sceneModel, opts = {}) {
      camera.position.set(...sceneModel.camera.position);
      camera.fov = sceneModel.camera.fov;
      camera.updateProjectionMatrix();
      camera.lookAt(...sceneModel.camera.target);
      if (controls) { controls.target.set(...sceneModel.camera.target); controls.update(); }

      if (lightsGroup) scene.remove(lightsGroup);
      lightsGroup = buildLights(THREE, sceneModel);
      scene.add(lightsGroup);

      if (envMap && envMap.dispose) envMap.dispose();
      envMap = applyEnvironment(THREE, renderer, scene, sceneModel, { canvas: opts.canvas });

      const wanted = new Set();
      for (const m of sceneModel.models) {
        wanted.add(m.id);
        let root = modelRoots.get(m.id);
        if (!root && m.url) {
          const loader = getLoader(m.format) || getLoader(formatForFile(m.url) || '');
          if (loader) {
            try { root = await loader(THREE, m.url, {}); modelRoots.set(m.id, root); scene.add(root); }
            catch (e) { console.warn('[3d] model load failed:', e && e.message); }
          }
        }
        if (root) {
          root.visible = m.visible !== false;
          root.position.set(...m.transform.position);
          root.rotation.set(...m.transform.rotation);
          root.scale.set(...m.transform.scale);
        }
      }
      for (const [id, root] of [...modelRoots]) {
        if (!wanted.has(id)) { scene.remove(root); modelRoots.delete(id); }
      }
    },

    render() { renderer.render(scene, camera); },

    /** Render at a target size and return the renderer canvas (caller copies pixels). */
    renderToCanvas(w, h) {
      if (w && h) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
      renderer.render(scene, camera);
      return renderer.domElement;
    },

    getModelRoot(id) { return modelRoots.get(id) || null; },
    controls: () => controls,
    gizmo: () => gizmo,

    dispose() {
      try { controls && controls.dispose && controls.dispose(); } catch {}
      try { gizmo && gizmo.dispose && gizmo.dispose(); } catch {}
      try { envMap && envMap.dispose && envMap.dispose(); } catch {}
      try { renderer.dispose(); } catch {}
      modelRoots.clear();
    },
  };
  return api;
}
