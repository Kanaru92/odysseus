// Off-main-thread filter execution. Runs the SAME pure pixel kernels as the main
// thread (editor/filters/filters.js → editor/fx/*) on a transferred ArrayBuffer,
// so heavy filters (blur, median, distortions) don't freeze the UI. Output is
// bit-identical to the synchronous path (same code), so no golden-diff risk.
//
// Module worker: filters.js + its fx imports are pure pixel math (no DOM), so they
// import and run unchanged here. Protocol: main posts {id,type,amount,opts,buf,w,h}
// (buf transferred); worker replies {id,buf} (transferred) or {id,error}.
import { applyFilter } from '../filters/filters.js';

self.onmessage = (e) => {
  const { id, type, amount, opts, buf, w, h } = e.data || {};
  try {
    const data = new Uint8ClampedArray(buf);
    applyFilter({ data, width: w, height: h }, type, amount, opts);
    self.postMessage({ id, buf: data.buffer }, [data.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
