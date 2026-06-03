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
}
