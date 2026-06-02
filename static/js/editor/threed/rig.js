/**
 * Skeleton / posing scaffold. Discovers an armature in a loaded model, applies
 * and reads bone poses, and exposes a PoseController seam for on-canvas posing
 * handles + IK (which plug in later via registry.registerRigSolver).
 *
 * Interface-first: the discovery + get/set-pose path is real; on-canvas handles
 * and IK are future work behind this stable API. three.js objects are passed in.
 */
import { getRigSolver } from './registry.js';

/** Find all SkinnedMesh skeletons under an object; return a flat bone list. */
export function discoverBones(object3D) {
  const bones = [];
  const seen = new Set();
  object3D && object3D.traverse && object3D.traverse((o) => {
    if (o.isSkinnedMesh && o.skeleton) {
      for (const b of o.skeleton.bones) {
        if (!seen.has(b.uuid)) { seen.add(b.uuid); bones.push({ name: b.name, uuid: b.uuid, bone: b }); }
      }
    }
  });
  return bones;
}

export function hasArmature(object3D) { return discoverBones(object3D).length > 0; }

/** Apply a pose { boneName: [rx,ry,rz] } (Euler radians) to the model's bones. */
export function applyPose(object3D, pose) {
  if (!pose) return;
  const byName = new Map(discoverBones(object3D).map((b) => [b.name, b.bone]));
  for (const [name, rot] of Object.entries(pose)) {
    const b = byName.get(name);
    if (b && b.rotation && Array.isArray(rot)) b.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
  }
}

/** Read the current bone rotations as a serializable pose object. */
export function readPose(object3D) {
  const pose = {};
  for (const { name, bone } of discoverBones(object3D)) {
    if (bone.rotation) pose[name] = [bone.rotation.x, bone.rotation.y, bone.rotation.z];
  }
  return pose;
}

/**
 * PoseController — the seam the posing UI will drive. Today it wraps discovery +
 * apply/read; future: spawn draggable bone handles in the viewer and run an IK
 * solver (from the rig-solver registry) when a handle is dragged.
 */
export class PoseController {
  constructor(object3D, { solver = 'fabrik' } = {}) {
    this.root = object3D;
    this.bones = discoverBones(object3D);
    this.solver = getRigSolver(solver) || null; // null until an IK solver is registered
  }
  list() { return this.bones.map((b) => b.name); }
  setBone(name, rotation) {
    const b = this.bones.find((x) => x.name === name);
    if (b && b.bone.rotation) b.bone.rotation.set(rotation[0] || 0, rotation[1] || 0, rotation[2] || 0);
  }
  pose() { return readPose(this.root); }
  /** Future: drag an effector to a target; IK solver adjusts the chain. */
  solveIK(effectorName, target) {
    if (!this.solver) return false; // no solver registered yet
    return this.solver.solve(this.bones, effectorName, target);
  }
}
