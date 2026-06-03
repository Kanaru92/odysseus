// Client for the off-main-thread filter worker. Runs filter kernels in a module
// Worker so heavy filters don't freeze the UI; transparently falls back to the
// synchronous main-thread path (the identical applyFilter) when Workers are
// unavailable or error. Output is bit-identical either way.
import { applyFilter } from './filters/filters.js';
import { floodFillMask, visitedToMask } from './tools/flood-fill.js';
import { gpuFilterAsync, gpuSupportsFilter } from './render/webgpu-backend.js';

let _worker = null;
let _failed = false;
let _seq = 0;
const _pending = new Map();

function _ensure() {
  if (_worker || _failed) return _worker;
  try {
    _worker = new Worker(new URL('./workers/filter-worker.js', import.meta.url), { type: 'module' });
    _worker.onmessage = (e) => {
      const msg = e.data || {};
      const p = _pending.get(msg.id);
      if (!p) return;
      _pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error)); else p.resolve(msg);
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
  // GPU compute fast path for eligible kernels (blur/gaussian). Self-gating:
  // returns null when WebGPU is unavailable or its self-test fails, so we fall
  // back to the worker/CPU path below — identical output, no correctness risk.
  if (gpuSupportsFilter(type)) {
    return gpuFilterAsync(img, type, amount, opts)
      .then((out) => out || _runFilterCpuOrWorker(img, type, amount, opts))
      .catch(() => _runFilterCpuOrWorker(img, type, amount, opts));
  }
  return _runFilterCpuOrWorker(img, type, amount, opts);
}

function _runFilterCpuOrWorker(img, type, amount, opts) {
  const w = _ensure();
  if (!w) { applyFilter(img, type, amount, opts); return Promise.resolve(img); }
  return new Promise((resolve) => {
    const id = ++_seq;
    const fallback = () => { try { applyFilter(img, type, amount, opts); } catch {} resolve(img); };
    _pending.set(id, {
      resolve: (msg) => { try { resolve(new ImageData(new Uint8ClampedArray(msg.buf), img.width, img.height)); } catch { fallback(); } },
      reject: fallback,
    });
    // Copy the buffer before transferring so the caller's ImageData isn't detached.
    let buf;
    try { buf = img.data.buffer.slice(0); } catch { fallback(); _pending.delete(id); return; }
    try { w.postMessage({ id, type, amount, opts, buf, w: img.width, h: img.height }, [buf]); }
    catch { _pending.delete(id); fallback(); }
  });
}

/**
 * Magic-wand / quick-select flood fill, off the main thread. Resolves with a mask
 * canvas (white where the fill landed), null if the seed is out of bounds, or the
 * synchronous floodFillMask result when the worker is unavailable.
 * @param {Uint8ClampedArray} srcData RGBA source pixels
 * @returns {Promise<HTMLCanvasElement|null>}
 */
export function runFloodAsync(srcData, w, h, sx, sy, tol) {
  const wk = _ensure();
  if (!wk) return Promise.resolve(floodFillMask(srcData, w, h, sx, sy, tol));
  return new Promise((resolve) => {
    const id = ++_seq;
    const fallback = () => resolve(floodFillMask(srcData, w, h, sx, sy, tol));
    _pending.set(id, {
      resolve: (msg) => { try { resolve(msg && msg.empty ? null : visitedToMask(new Uint8Array(msg.visited), w, h, msg.minX, msg.minY, msg.maxX, msg.maxY)); } catch { fallback(); } },
      reject: fallback,
    });
    let buf;
    try { buf = srcData.buffer.slice(0); } catch { _pending.delete(id); return fallback(); }
    try { wk.postMessage({ op: 'flood', id, buf, w, h, sx, sy, tol }, [buf]); }
    catch { _pending.delete(id); fallback(); }
  });
}
