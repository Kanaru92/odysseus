/**
 * Lazy, single-seam loader for three.js (MIT) + addons. Keeps three out of the
 * main editor bundle until the user actually uses 3D, and degrades gracefully if
 * three isn't vendored yet (returns null → the editor shows a placeholder rather
 * than throwing).
 *
 * Vendor target (CSP-safe, no CDN): /static/vendor/three/three.module.js and
 * addon modules under /static/vendor/three/addons/. Override the base via
 * window.__GE_THREE_BASE for testing.
 */

let _threePromise = null;
const BASE = () => (typeof window !== 'undefined' && window.__GE_THREE_BASE) || '/static/vendor/three';

/** Returns the three module, or null if unavailable. Cached after first call. */
export async function loadThree() {
  if (_threePromise) return _threePromise;
  _threePromise = (async () => {
    try {
      const mod = await import(/* @vite-ignore */ `${BASE()}/three.module.js`);
      return mod;
    } catch (e) {
      console.warn('[3d] three.js not available (vendor it at ' + BASE() + '/three.module.js):', e && e.message);
      return null;
    }
  })();
  return _threePromise;
}

/** Load a three addon module (e.g. 'controls/OrbitControls.js'). Null on failure. */
export async function loadAddon(relPath) {
  try { return await import(/* @vite-ignore */ `${BASE()}/addons/${relPath}`); }
  catch (e) { console.warn('[3d] addon missing: ' + relPath, e && e.message); return null; }
}

/** Cheap availability probe for UI gating (does not import three). */
export function threeMaybeAvailable() {
  // Optimistic: assume vendored unless a prior load failed.
  return _threePromise === null || _threePromise.then ? true : false;
}
