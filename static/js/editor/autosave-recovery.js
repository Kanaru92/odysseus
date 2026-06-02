/**
 * Autosave recovery — a client-side resilience layer for the editor.
 *
 * Problem: the editor persists drafts to the server on a debounced timer.
 * If the tab crashes, is force-closed, goes offline, or the server save
 * itself fails, the work between the last successful server commit and the
 * crash is gone. This module adds a *local* safety net so nothing is lost.
 *
 * Three responsibilities:
 *
 *   1. Local mirror — on every draft save the caller hands us the same
 *      payload it's about to PUT to the server; we stamp it `{ts, synced}`
 *      and write it to IndexedDB (a per-draft single-record store). When
 *      the server commit lands, the caller calls `markSynced(key, ts)` and
 *      we flip the flag. So at any instant the mirror records whether the
 *      latest local edit has reached the server.
 *
 *   2. Flush guards — `visibilitychange` (when the page becomes hidden) and
 *      `pagehide` are the last reliable hooks a browser gives before a tab
 *      is suspended/closed/backgrounded (mobile especially). On those we
 *      synchronously trigger one more save + local mirror so the in-memory
 *      delta is captured. (`beforeunload` is deliberately NOT relied on —
 *      it's unreliable on mobile and async work there is killed.)
 *
 *   3. Recovery API — on open, after the server draft loads, the caller
 *      asks `checkRecovery(key, serverDraft)`. If a local mirror exists that
 *      is (a) unsynced and (b) strictly newer than the server draft, we
 *      return it so the UI can offer "recover unsaved changes". Otherwise
 *      the server copy is authoritative and we say nothing.
 *
 * The IndexedDB seam is fully injectable so this is unit-testable in Node
 * (or any environment without a real IndexedDB) by passing a mock factory.
 * The DOM/event seam (`addFlushGuards`) takes its target + the save fn as
 * arguments, so it too can be exercised with a fake EventTarget.
 *
 * No framework, no third-party code. ES module.
 */

const DB_NAME = 'ge-autosave';
const DB_VERSION = 1;
const STORE = 'mirrors';

/**
 * Resolve an IndexedDB factory. Callers may inject one (tests / SSR);
 * otherwise we use the global `indexedDB`. Returns null when none exists
 * so every method can degrade to a no-op rather than throw — a missing
 * IndexedDB must never break editing.
 *
 * @param {IDBFactory|null|undefined} injected
 * @returns {IDBFactory|null}
 */
function resolveIdb(injected) {
  if (injected) return injected;
  if (typeof indexedDB !== 'undefined' && indexedDB) return indexedDB;
  if (typeof globalThis !== 'undefined' && globalThis.indexedDB) return globalThis.indexedDB;
  return null;
}

/**
 * A mirror record as stored in IndexedDB.
 * @typedef {Object} MirrorRecord
 * @property {string} key      Draft key (the server draftId, or a synthetic
 *                             key for not-yet-saved blank canvases).
 * @property {number} ts       ms timestamp the payload was captured locally.
 * @property {boolean} synced  true once the matching server commit succeeded.
 * @property {*} payload       The draft payload (same shape the server stores).
 * @property {string} [name]   Optional human label for the recovery prompt.
 */

/**
 * Create an autosave-recovery controller.
 *
 * @param {Object} [opts]
 * @param {IDBFactory} [opts.idb]   Injected IndexedDB factory (tests).
 * @param {string} [opts.dbName]    Override DB name (test isolation).
 * @param {Console} [opts.logger]   Logger (defaults to console; pass a stub to silence).
 * @returns {{
 *   isAvailable: () => boolean,
 *   writeMirror: (key: string, payload: *, meta?: {ts?: number, name?: string}) => Promise<number|null>,
 *   markSynced: (key: string, ts?: number) => Promise<boolean>,
 *   readMirror: (key: string) => Promise<MirrorRecord|null>,
 *   checkRecovery: (key: string, serverDraft: *|null) => Promise<MirrorRecord|null>,
 *   clearMirror: (key: string) => Promise<void>,
 *   listMirrors: () => Promise<MirrorRecord[]>,
 *   addFlushGuards: (target: EventTarget, flushFn: () => void) => (() => void),
 *   close: () => void,
 * }}
 */
export function createAutosaveRecovery(opts = {}) {
  const factory = resolveIdb(opts.idb);
  const dbName = opts.dbName || DB_NAME;
  const logger = opts.logger || (typeof console !== 'undefined' ? console : { warn() {}, error() {} });
  /** @type {Promise<IDBDatabase>|null} cached open handle */
  let dbPromise = null;

  function available() {
    return !!factory;
  }

  /** Open (and upgrade) the database, cached. */
  function openDb() {
    if (!factory) return Promise.reject(new Error('IndexedDB unavailable'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      let openReq;
      try {
        openReq = factory.open(dbName, DB_VERSION);
      } catch (e) {
        reject(e);
        return;
      }
      openReq.onupgradeneeded = () => {
        const db = openReq.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'key' });
        }
      };
      openReq.onsuccess = () => resolve(openReq.result);
      openReq.onerror = () => reject(openReq.error || new Error('open failed'));
      // A blocked open (another tab holds an older version) shouldn't hang
      // forever; treat it as a failure so callers fall back to server-only.
      openReq.onblocked = () => reject(new Error('IndexedDB open blocked'));
    }).catch((e) => {
      // Reset the cache so a later call can retry rather than reusing a
      // rejected promise forever.
      dbPromise = null;
      throw e;
    });
    return dbPromise;
  }

  /**
   * Run a transaction and resolve when both the request AND the transaction
   * complete (the request firing `onsuccess` does NOT guarantee the write is
   * durable — only `transaction.oncomplete` does).
   *
   * @param {IDBTransactionMode} mode
   * @param {(store: IDBObjectStore) => IDBRequest} fn
   * @returns {Promise<any>}
   */
  async function withStore(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = db.transaction(STORE, mode);
      } catch (e) {
        reject(e);
        return;
      }
      const store = tx.objectStore(STORE);
      let result;
      let req;
      try {
        req = fn(store);
      } catch (e) {
        reject(e);
        return;
      }
      if (req) {
        // The caller's `fn` may have already wired `req.onsuccess` to do a
        // read-modify-write (markSynced reads then puts). Don't clobber it —
        // chain after it and still capture the result for the resolve.
        const prior = req.onsuccess;
        req.onsuccess = (ev) => {
          if (typeof prior === 'function') prior.call(req, ev);
          result = req.result;
        };
        req.onerror = () => { /* surfaced via tx.onerror/onabort */ };
      }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('transaction error'));
      tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
    });
  }

  /**
   * Mirror the latest draft payload locally, flagged unsynced. Call this
   * BEFORE issuing the server request, so a crash between the mirror and a
   * failed/never-completing server save still leaves a recoverable copy.
   *
   * @param {string} key
   * @param {*} payload
   * @param {{ts?: number, name?: string}} [meta]
   * @returns {Promise<number|null>} the timestamp written, or null if no IDB.
   */
  async function writeMirror(key, payload, meta = {}) {
    if (!available() || !key) return null;
    const ts = typeof meta.ts === 'number' ? meta.ts : Date.now();
    const record = { key, ts, synced: false, payload };
    if (meta.name != null) record.name = meta.name;
    try {
      await withStore('readwrite', (s) => s.put(record));
      return ts;
    } catch (e) {
      logger.warn && logger.warn('[autosave] writeMirror failed', e);
      return null;
    }
  }

  /**
   * Mark a mirror synced once the server commit succeeded. Only flips the
   * flag if the stored ts matches the one we synced (an edit that happened
   * after the request was issued bumps ts, and that newer record must stay
   * unsynced). With no ts, marks the current record synced unconditionally.
   *
   * @param {string} key
   * @param {number} [ts] timestamp returned by the matching writeMirror.
   * @returns {Promise<boolean>} true if a record was flipped to synced.
   */
  async function markSynced(key, ts) {
    if (!available() || !key) return false;
    try {
      let flipped = false;
      await withStore('readwrite', (s) => {
        const getReq = s.get(key);
        getReq.onsuccess = () => {
          const rec = getReq.result;
          if (!rec) return;
          // Don't clobber a newer unsynced edit captured after this save began.
          if (typeof ts === 'number' && rec.ts !== ts) return;
          rec.synced = true;
          s.put(rec);
          flipped = true;
        };
        return getReq;
      });
      return flipped;
    } catch (e) {
      logger.warn && logger.warn('[autosave] markSynced failed', e);
      return false;
    }
  }

  /**
   * Read the mirror for a key.
   * @param {string} key
   * @returns {Promise<MirrorRecord|null>}
   */
  async function readMirror(key) {
    if (!available() || !key) return null;
    try {
      const rec = await withStore('readonly', (s) => s.get(key));
      return rec || null;
    } catch (e) {
      logger.warn && logger.warn('[autosave] readMirror failed', e);
      return null;
    }
  }

  /**
   * Delete the mirror for a key (e.g. after the user discards or after the
   * draft itself is deleted on the server).
   * @param {string} key
   * @returns {Promise<void>}
   */
  async function clearMirror(key) {
    if (!available() || !key) return;
    try {
      await withStore('readwrite', (s) => s.delete(key));
    } catch (e) {
      logger.warn && logger.warn('[autosave] clearMirror failed', e);
    }
  }

  /**
   * List every mirror (diagnostics / a future "all recoverable drafts" view).
   * @returns {Promise<MirrorRecord[]>}
   */
  async function listMirrors() {
    if (!available()) return [];
    try {
      const all = await withStore('readonly', (s) => s.getAll());
      return Array.isArray(all) ? all : [];
    } catch (e) {
      logger.warn && logger.warn('[autosave] listMirrors failed', e);
      return [];
    }
  }

  /**
   * Decide whether unsaved local work should be offered for recovery.
   *
   * Returns the local mirror only when it is BOTH unsynced AND strictly
   * newer than what the server has. The server timestamp is read from the
   * draft's `updated_at` / `updatedAt` / `ts` (whichever is present); a
   * missing/zero server time means "server has nothing here", so any
   * unsynced mirror wins.
   *
   * @param {string} key
   * @param {*|null} serverDraft the draft just loaded from the server (or null).
   * @returns {Promise<MirrorRecord|null>} mirror to recover, or null.
   */
  async function checkRecovery(key, serverDraft) {
    const mirror = await readMirror(key);
    if (!mirror) return null;
    if (mirror.synced) return null; // already on the server — nothing newer locally
    const serverTs = serverDraftTimestamp(serverDraft);
    // Strictly newer: an equal timestamp means the server already has this
    // exact capture (markSynced may simply have raced), so don't nag.
    if (serverTs && mirror.ts <= serverTs) return null;
    return mirror;
  }

  /**
   * Install flush guards on a target (normally `window`/`document`). On
   * `visibilitychange` → hidden and on `pagehide`, calls `flushFn` so the
   * caller can fire a final save + local mirror before the tab is suspended.
   *
   * `flushFn` MUST be synchronous-effecting (kick off the write, don't await)
   * — once the page is hidden/unloading, async continuations may never run.
   *
   * @param {EventTarget} target
   * @param {() => void} flushFn
   * @returns {() => void} an uninstall function (idempotent).
   */
  function addFlushGuards(target, flushFn) {
    if (!target || typeof target.addEventListener !== 'function' || typeof flushFn !== 'function') {
      return () => {};
    }
    const onVisibility = () => {
      // `document.visibilityState` is the source of truth; fall back to the
      // event target's own state for non-document targets / tests.
      const state =
        (typeof document !== 'undefined' && document.visibilityState) ||
        target.visibilityState;
      if (state === 'hidden') {
        try { flushFn(); } catch (e) { logger.warn && logger.warn('[autosave] flush on hide failed', e); }
      }
    };
    const onPageHide = () => {
      try { flushFn(); } catch (e) { logger.warn && logger.warn('[autosave] flush on pagehide failed', e); }
    };
    target.addEventListener('visibilitychange', onVisibility);
    target.addEventListener('pagehide', onPageHide);
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      try { target.removeEventListener('visibilitychange', onVisibility); } catch (_) {}
      try { target.removeEventListener('pagehide', onPageHide); } catch (_) {}
    };
  }

  /** Drop the cached DB handle (next call reopens). */
  function close() {
    if (dbPromise) {
      dbPromise.then((db) => { try { db.close(); } catch (_) {} }).catch(() => {});
      dbPromise = null;
    }
  }

  return {
    isAvailable: available,
    writeMirror,
    markSynced,
    readMirror,
    checkRecovery,
    clearMirror,
    listMirrors,
    addFlushGuards,
    close,
  };
}

/**
 * Extract a comparable ms timestamp from a server draft, tolerating the
 * various field names a draft row may carry. Accepts numbers (ms or s) and
 * ISO date strings. Returns 0 when nothing usable is present.
 *
 * Exported for unit testing and so callers can normalise consistently.
 *
 * @param {*} serverDraft
 * @returns {number}
 */
export function serverDraftTimestamp(serverDraft) {
  if (!serverDraft || typeof serverDraft !== 'object') return 0;
  const raw =
    serverDraft.updated_at != null ? serverDraft.updated_at :
    serverDraft.updatedAt != null ? serverDraft.updatedAt :
    serverDraft.ts != null ? serverDraft.ts :
    serverDraft.modified != null ? serverDraft.modified :
    null;
  if (raw == null) return 0;
  if (typeof raw === 'number') {
    if (!isFinite(raw) || raw <= 0) return 0;
    // Heuristic: a value below ~1e12 is seconds (Unix epoch in seconds tops
    // out ~1e10 for current dates), so promote to ms.
    return raw < 1e12 ? Math.round(raw * 1000) : Math.round(raw);
  }
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

/**
 * Build the local mirror key for an editor session. Saved drafts use their
 * server uuid; a brand-new blank canvas that hasn't been POSTed yet has no
 * id, so we fall back to a stable per-image key (or a session sentinel) so
 * its work is still mirrored and recoverable.
 *
 * @param {{draftId?: string|null, imageId?: string|null}} session
 * @returns {string}
 */
export function mirrorKeyFor(session) {
  if (!session || typeof session !== 'object') return 'draft:unsaved';
  if (session.draftId) return `draft:${session.draftId}`;
  if (session.imageId) return `image:${session.imageId}`;
  return 'draft:unsaved';
}

export default createAutosaveRecovery;
