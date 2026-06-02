/**
 * Swatches / colour palette — default palette + user-saved swatches (named,
 * persisted to localStorage) + an auto-tracked Recent strip. Clicking a swatch
 * applies it to the foreground colour via the canonical FG input (so all
 * existing wiring updates). Saved swatches can be renamed (double-click),
 * removed (right-click), and the whole set exported / imported as a .json
 * palette for sharing or backup.
 *
 * Storage is forward/backward compatible: legacy entries were bare hex strings;
 * they load as { hex, name:hex }.
 */
const DEFAULT_PALETTE = [
  '#000000', '#404040', '#808080', '#c0c0c0', '#ffffff', '#7f3300', '#a0522d', '#ffc0cb',
  '#ff0000', '#ff8000', '#ffff00', '#00ff00', '#00ffff', '#0080ff', '#0000ff', '#8000ff', '#ff00ff',
];
const LS_KEY = 'ge-swatches-v1';

export function wireSwatches() {
  const grid = document.getElementById('ge-swatches');
  const recentWrap = document.getElementById('ge-swatch-recent-wrap');
  const recentGrid = document.getElementById('ge-swatch-recent');
  const addBtn = document.getElementById('ge-swatch-add');
  const exportBtn = document.getElementById('ge-swatch-export');
  const importBtn = document.getElementById('ge-swatch-import');
  const fg = document.querySelector('.ge-fg-color') || document.querySelector('.ge-color-picker');
  if (!grid || !fg) return;

  let saved = load();      // [{ hex, name }]
  const recent = [];       // hex strings

  const apply = (hex) => { fg.value = hex; fg.dispatchEvent(new Event('input', { bubbles: true })); };
  const cell = (entry, removable) => {
    const hex = typeof entry === 'string' ? entry : entry.hex;
    const name = typeof entry === 'string' ? entry : (entry.name || entry.hex);
    const b = document.createElement('button');
    b.type = 'button';
    b.title = name + (name !== hex ? ` (${hex})` : '') + (removable ? ' — double-click to rename, right-click to remove' : '');
    b.style.cssText = `width:16px;height:16px;border-radius:3px;border:1px solid rgba(255,255,255,0.25);background:${hex};cursor:pointer;padding:0;`;
    b.addEventListener('click', () => apply(hex));
    if (removable) {
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); saved = saved.filter((c) => c.hex !== hex); persist(); render(); });
      b.addEventListener('dblclick', (e) => {
        e.preventDefault();
        const cur = saved.find((c) => c.hex === hex);
        if (!cur) return;
        const nm = window.prompt('Swatch name', cur.name || cur.hex); // simple inline rename
        if (nm != null) { cur.name = nm.trim() || cur.hex; persist(); render(); }
      });
    }
    return b;
  };
  function render() {
    grid.innerHTML = '';
    DEFAULT_PALETTE.forEach((h) => grid.appendChild(cell(h, false)));
    saved.forEach((e) => grid.appendChild(cell(e, true)));
    recentGrid.innerHTML = '';
    recent.forEach((h) => recentGrid.appendChild(cell(h, false)));
    if (recentWrap) recentWrap.style.display = recent.length ? '' : 'none';
  }
  function persist() { try { localStorage.setItem(LS_KEY, JSON.stringify(saved)); } catch {} }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(LS_KEY));
      if (!Array.isArray(v)) return [];
      return v.map((x) => typeof x === 'string'
        ? { hex: x.toLowerCase(), name: x.toLowerCase() }
        : (x && x.hex ? { hex: String(x.hex).toLowerCase(), name: x.name || String(x.hex).toLowerCase() } : null)).filter(Boolean);
    } catch { return []; }
  }

  addBtn?.addEventListener('click', () => {
    const hex = (fg.value || '').toLowerCase();
    if (hex && !saved.some((c) => c.hex === hex)) { saved.push({ hex, name: hex }); persist(); render(); }
  });

  exportBtn?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ type: 'ge-swatches', v: 1, swatches: saved }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'palette.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  importBtn?.addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'application/json,.json';
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        const arr = Array.isArray(data) ? data : (data && Array.isArray(data.swatches) ? data.swatches : []);
        for (const x of arr) {
          const hex = (typeof x === 'string' ? x : (x && x.hex) || '').toLowerCase();
          if (!/^#[0-9a-f]{6}$/.test(hex)) continue;
          if (!saved.some((c) => c.hex === hex)) saved.push({ hex, name: (x && x.name) ? x.name : hex });
        }
        persist(); render();
      } catch {}
    });
    inp.click();
  });

  // Track recent from FG colour changes (manual picks + eyedropper).
  fg.addEventListener('input', () => {
    const hex = (fg.value || '').toLowerCase();
    if (!hex) return;
    const i = recent.indexOf(hex);
    if (i >= 0) recent.splice(i, 1);
    recent.unshift(hex);
    if (recent.length > 14) recent.pop();
    render();
  });

  render();
}
