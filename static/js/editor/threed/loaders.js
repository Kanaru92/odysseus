/**
 * Default model loaders, registered into the registry. glTF/GLB is the primary
 * interchange (carries PBR materials + armatures/skinning + animations — the clean
 * bridge from Blender et al.); OBJ + FBX are secondary. three addons load lazily.
 *
 * A loader is async (THREE, url, opts) -> Object3D (the scene root). Animations,
 * if any, are stashed on root.userData.animations for the timeline to pick up.
 */
import { registerLoader } from './registry.js';
import { loadAddon } from './three-loader.js';

registerLoader('gltf', async (THREE, url) => {
  const mod = await loadAddon('loaders/GLTFLoader.js');
  if (!mod || !mod.GLTFLoader) throw new Error('GLTFLoader unavailable');
  const gltf = await new mod.GLTFLoader().loadAsync(url);
  gltf.scene.userData.animations = gltf.animations || [];
  return gltf.scene;
});

registerLoader('obj', async (THREE, url) => {
  const mod = await loadAddon('loaders/OBJLoader.js');
  if (!mod || !mod.OBJLoader) throw new Error('OBJLoader unavailable');
  return new mod.OBJLoader().loadAsync(url);
});

registerLoader('fbx', async (THREE, url) => {
  const mod = await loadAddon('loaders/FBXLoader.js');
  if (!mod || !mod.FBXLoader) throw new Error('FBXLoader unavailable');
  const root = await new mod.FBXLoader().loadAsync(url);
  root.userData.animations = root.animations || [];
  return root;
});

registerLoader('stl', async (THREE, url) => {
  const mod = await loadAddon('loaders/STLLoader.js');
  if (!mod || !mod.STLLoader) throw new Error('STLLoader unavailable');
  const geo = await new mod.STLLoader().loadAsync(url);
  const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.1, roughness: 0.8 });
  return new THREE.Mesh(geo, mat);
});
