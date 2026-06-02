// Off-main-thread filter execution. Runs the SAME pure pixel kernels as the main
// thread (editor/filters/filters.js → editor/fx/*) on a transferred ArrayBuffer,
// so heavy filters (blur, median, distortions) don't freeze the UI. Output is
// bit-identical to the synchronous path (same code), so no golden-diff risk.
//
// Module worker: filters.js + its fx imports are pure pixel math (no DOM), so they
// import and run unchanged here. Protocol: main posts {id,type,amount,opts,buf,w,h}
// (buf transferred); worker replies {id,buf} (transferred) or {id,error}.
import { applyFilter } from '../filters/filters.js';
import { floodFillVisited } from '../tools/flood-fill.js';

self.onmessage = (e) => {
  const d = e.data || {};
  try {
    if (d.op === 'flood') {
      // Magic-wand / quick-select flood — the BFS is the heavy part; run it here and
      // ship back the visited grid + bbox (the caller builds the mask canvas).
      const src = new Uint8ClampedArray(d.buf);
      const v = floodFillVisited(src, d.w, d.h, d.sx, d.sy, d.tol);
      if (!v) { self.postMessage({ id: d.id, empty: true }); return; }
      self.postMessage({ id: d.id, visited: v.visited.buffer, minX: v.minX, minY: v.minY, maxX: v.maxX, maxY: v.maxY }, [v.visited.buffer]);
      return;
    }
    const data = new Uint8ClampedArray(d.buf);
    applyFilter({ data, width: d.w, height: d.h }, d.type, d.amount, d.opts);
    self.postMessage({ id: d.id, buf: data.buffer }, [data.buffer]);
  } catch (err) {
    self.postMessage({ id: d.id, error: String((err && err.message) || err) });
  }
};
