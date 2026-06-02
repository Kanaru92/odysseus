/**
 * Bake — render the live 3D scene to a detached 2D canvas the editor can wrap into
 * a new raster layer (or replace the 3D layer's pixels). Renderer-agnostic: it only
 * needs a Viewer with renderToCanvas().
 */

/** Render at (width,height) and return a fresh 2D canvas with the result. */
export function bakeToCanvas(viewer, width, height) {
  if (!viewer || !viewer.available) return null;
  const src = viewer.renderToCanvas(width, height);
  if (!src) return null;
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  out.getContext('2d').drawImage(src, 0, 0, width, height);
  return out; // detached from the GL context — safe to keep as layer pixels
}
