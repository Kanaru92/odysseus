// Client for the off-main-thread filter worker. Runs filter kernels in a module
// Worker so heavy filters don't freeze the UI; transparently falls back to the
// synchronous main-thread path (the identical applyFilter) when Workers are
// unavailable or error. Output is bit-identical either way.
import { applyFilter } from './filters/filters.js';

let _worker = null;
let _failed = false;
let _seq = 0;
const _pending = new Map();

function _ensure() {
  if (_worker || _failed) return _worker;
  try {
    _worker = new Worker(new URL('./workers/filter-worker.js', import.meta.url), { type: 'module' });
    _worker.onmessage = (e) => {
      const { id, buf, error } = e.data || {};
      const p = _pending.get(id);
      if (!p) return;
      _pending.delete(id);
      if (error) p.reject(new Error(error)); else p.resolve(buf);
    };
    _worker.onerror = () => {
      _failed = true;
      for (const [, p] of _pending) p.reject(new Error('filter worker error'));
      _pending.clear();
      try { _worker.terminate(); } catch {}
      _worker = null;
    };
  } catch {
    _failed = true;
    _worker = null;
  }
  return _worker;
}

/** True if the worker is (or can be) created — i.e. filters can run off-thread. */
export function filterWorkerAvailable() { return !!_ensure(); }

/**
 * Run a filter on an ImageData, off the main thread when possible. Resolves with
 * an ImageData holding the result (a fresh one from the worker, or the same
 * `img` mutated in place on the synchronous fallback). Never rejects in normal
 * use — any worker failure degrades to the synchronous kernel.
 *
 * @param {ImageData} img
 * @param {string} type   filter id (see FILTERS in filters/filters.js)
 * @param {number} amount 0..100 UI value
 * @param {object} [opts] extra params (e.g. gradient-map shadow/highlight)
 * @returns {Promise<ImageData>}
 */
export function runFilterAsync(img, type, amount, opts) {
  const w = _ensure();
  if (!w) { applyFilter(img, type, amount, opts); return Promise.resolve(img); }
  return new Promise((resolve) => {
    const id = ++_seq;
    const fallback = () => { try { applyFilter(img, type, amount, opts); } catch {} resolve(img); };
    _pending.set(id, {
      resolve: (buf) => { try { resolve(new ImageData(new Uint8ClampedArray(buf), img.width, img.height)); } catch { fallback(); } },
      reject: fallback,
    });
    // Copy the buffer before transferring so the caller's ImageData isn't detached.
    let buf;
    try { buf = img.data.buffer.slice(0); } catch { fallback(); _pending.delete(id); return; }
    try { w.postMessage({ id, type, amount, opts, buf, w: img.width, h: img.height }, [buf]); }
    catch { _pending.delete(id); fallback(); }
  });
}
