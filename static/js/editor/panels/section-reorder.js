/**
 * Drag-to-reorder for the right-panel document sections (the `.ge-dock-section`
 * disclosures — Histogram / Navigator / Reference). A small grip in each
 * section header drags the section up/down past its siblings; the order is
 * persisted to localStorage and restored on the next build. Part of the panel
 * docking track (reorder); pointer-based (works for mouse + pen + touch) and
 * self-contained — no change to the sections' own wiring (nodes are MOVED, not
 * rebuilt, so their listeners + canvases survive).
 */
const LS_KEY = 'ge-section-order';
const SEL = '.ge-dock-section';

export function wireSectionReorder(root) {
  if (!root) return;
  let secs = Array.from(root.querySelectorAll(SEL));
  if (secs.length < 2) return;
  const parent = secs[0].parentNode;
  if (!parent) return;
  const byId = new Map(secs.map((s) => [s.id, s]));

  // Restore the saved order: reinsert the sections contiguously, right after the
  // node that currently precedes the block, in the saved id order (unknown ids
  // skipped; any section missing from the saved list keeps its relative tail).
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    if (Array.isArray(saved) && saved.length) {
      const order = saved.filter((id) => byId.has(id));
      for (const s of secs) if (!order.includes(s.id)) order.push(s.id); // append un-saved
      const anchor = secs[0].previousSibling;
      let ref = anchor;
      for (const id of order) {
        const el = byId.get(id);
        if (ref && ref.parentNode === parent) parent.insertBefore(el, ref.nextSibling);
        else parent.insertBefore(el, parent.firstChild);
        ref = el;
      }
      secs = order.map((id) => byId.get(id));
    }
  } catch {}

  const persist = () => {
    try {
      const ids = Array.from(root.querySelectorAll(SEL)).map((s) => s.id);
      localStorage.setItem(LS_KEY, JSON.stringify(ids));
    } catch {}
  };
  // Persist which panels are floated + their window positions (restored on build).
  const FLOAT_KEY = 'ge-section-floats';
  const persistFloats = () => {
    try {
      const floats = [];
      document.querySelectorAll(SEL).forEach((s) => {
        if (s._floatWin) floats.push({ id: s.id, left: s._floatWin.style.left, top: s._floatWin.style.top });
      });
      localStorage.setItem(FLOAT_KEY, JSON.stringify(floats));
    } catch {}
  };

  // Drag a floating window by its title bar (document-level move/up so the drag
  // doesn't drop when the cursor leaves the small bar).
  const dragFloat = (win, handle) => {
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      e.preventDefault();
      const r = win.getBoundingClientRect(), ox = r.left, oy = r.top, sx = e.clientX, sy = e.clientY;
      handle.style.cursor = 'grabbing';
      const mv = (ev) => {
        win.style.left = Math.max(0, Math.min(window.innerWidth - 60, ox + ev.clientX - sx)) + 'px';
        win.style.top = Math.max(0, Math.min(window.innerHeight - 30, oy + ev.clientY - sy)) + 'px';
      };
      const up = () => {
        handle.style.cursor = 'grab';
        document.removeEventListener('pointermove', mv);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
        persistFloats(); // remember the new float position
      };
      document.addEventListener('pointermove', mv);
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);
    });
  };

  // Undock a section into a floating window; "Dock" returns it to its prior slot.
  // The live section node is MOVED (listeners/canvas preserved). The float is
  // appended to the editor container so closeEditor's teardown disposes it.
  let cascade = 0;
  const popOut = (sec, pos) => {
    if (sec._floatWin) return;
    const home = sec.parentNode, anchor = sec.previousSibling;
    const title = (sec.querySelector('summary')?.textContent || 'Panel').replace(/[∷⤢]/g, '').trim();
    const win = document.createElement('div');
    win.className = 'ge-float-panel';
    win.style.cssText = 'position:fixed;z-index:300;width:240px;background:#26262b;border:1px solid rgba(255,255,255,0.16);border-radius:8px;box-shadow:0 14px 40px rgba(0,0,0,0.55);color:#eee;';
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 8px;cursor:grab;background:rgba(255,255,255,0.06);border-radius:8px 8px 0 0;font-size:11px;font-weight:600;';
    bar.innerHTML = `<span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${title}</span>`;
    const dockBtn = document.createElement('button');
    dockBtn.type = 'button'; dockBtn.className = 'ge-btn ge-btn-sm'; dockBtn.textContent = 'Dock'; dockBtn.title = 'Dock back into the panel';
    bar.appendChild(dockBtn);
    win.appendChild(bar);
    const body = document.createElement('div');
    body.style.cssText = 'padding:8px;max-height:60vh;overflow:auto;';
    win.appendChild(body);
    sec.open = true;
    body.appendChild(sec); // move the live section into the float
    (document.getElementById('gallery-editor-container') || document.body).appendChild(win);
    const c = (cascade++ % 6) * 22;
    win.style.left = Math.round(window.innerWidth * 0.45 + c) + 'px';
    win.style.top = (84 + c) + 'px';
    if (pos) { if (pos.left) win.style.left = pos.left; if (pos.top) win.style.top = pos.top; }
    sec._floatWin = win;
    dragFloat(win, bar);
    persistFloats();
    dockBtn.addEventListener('click', () => {
      if (anchor && anchor.parentNode === home) home.insertBefore(sec, anchor.nextSibling);
      else if (home) home.appendChild(sec);
      win.remove(); sec._floatWin = null;
      persistFloats();
    });
  };

  for (const sec of secs) {
    const sum = sec.querySelector('summary');
    if (!sum || sum.querySelector('.ge-dock-grip')) continue;
    const grip = document.createElement('span');
    grip.className = 'ge-dock-grip';
    grip.textContent = '∷'; // ∷ drag dots
    grip.title = 'Drag to reorder this panel';
    grip.style.cssText = 'cursor:grab;opacity:0.45;margin-right:6px;font-size:11px;user-select:none;';
    sum.insertBefore(grip, sum.firstChild);
    // The grip lives inside <summary>, which toggles the <details> on click —
    // swallow the grip's own click so dragging/grabbing it never toggles.
    grip.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
    // Float (undock) button — pops the section into a draggable window.
    const pop = document.createElement('span');
    pop.className = 'ge-dock-pop';
    pop.textContent = '⤢';
    pop.title = 'Float this panel (undock)';
    pop.style.cssText = 'cursor:pointer;opacity:0.45;margin-left:6px;font-size:11px;user-select:none;';
    sum.appendChild(pop);
    pop.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); popOut(sec); });
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      grip.style.cursor = 'grabbing';
      sec.style.opacity = '0.55';
      // Track the drag on DOCUMENT (not the grip) so moves fire regardless of
      // where the cursor is — relying on pointer capture on a tiny grip is
      // unreliable. Listeners live only for the duration of the drag.
      const onMove = (ev) => {
        for (const other of root.querySelectorAll(SEL)) {
          if (other === sec) continue;
          const r = other.getBoundingClientRect();
          if (ev.clientY >= r.top && ev.clientY <= r.bottom) {
            const mid = r.top + r.height / 2;
            if (ev.clientY < mid) other.parentNode.insertBefore(sec, other);
            else other.parentNode.insertBefore(sec, other.nextSibling);
            break;
          }
        }
      };
      const onUp = () => {
        sec.style.opacity = '';
        grip.style.cursor = 'grab';
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        persist();
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    });
  }

  // Restore any panels that were floating in a previous session (+ position).
  try {
    const savedF = JSON.parse(localStorage.getItem(FLOAT_KEY) || '[]');
    if (Array.isArray(savedF)) for (const f of savedF) {
      const el = byId.get(f.id);
      if (el && !el._floatWin) popOut(el, f);
    }
  } catch {}
}
