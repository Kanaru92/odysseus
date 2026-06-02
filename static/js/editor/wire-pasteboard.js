/**
 * Pasteboard (canvas background) colour — the area shown BEHIND/around the
 * image. Right-click the canvas area for a small menu: Black / Dark gray /
 * Medium gray / Light gray / Custom…, matching the choices pro editors offer.
 *
 * Display-only: it sets the canvas-area element's CSS background and never
 * touches the document, layers, or exports. The choice persists in
 * localStorage so it survives reloads.
 *
 * @param {HTMLElement} area  the `.ge-canvas-area` element
 * @param {object} state      editor state (stores the chosen colour for reference)
 */
const KEY = 'ge-pasteboard-color';
const SWATCHES = [
  ['Black', '#000000'],
  ['Dark gray', '#232323'],
  ['Medium gray', '#4d4d4d'],
  ['Light gray', '#b8b8b8'],
];

export function wirePasteboard(area, state) {
  if (!area) return;
  let menu = null;

  const apply = (c) => { area.style.background = c; if (state) state.pasteboardColor = c; };
  const save = (c) => { try { localStorage.setItem(KEY, c); } catch {} };

  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch {}
  apply(saved || (state && state.pasteboardColor) || '#232323');

  const close = () => { if (menu) { menu.remove(); menu = null; } };

  area.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    close();
    menu = document.createElement('div');
    menu.className = 'ge-pasteboard-menu';
    menu.style.cssText = 'position:fixed;z-index:200;background:#2a2a2e;border:1px solid rgba(255,255,255,0.16);border-radius:6px;padding:4px;box-shadow:0 10px 26px rgba(0,0,0,0.5);font-size:12px;min-width:160px;color:#eee;';
    menu.style.left = Math.min(e.clientX, window.innerWidth - 180) + 'px';
    menu.style.top = Math.min(e.clientY, window.innerHeight - 200) + 'px';
    const title = document.createElement('div');
    title.textContent = 'Canvas background';
    title.style.cssText = 'opacity:0.55;padding:3px 8px 4px;';
    menu.appendChild(title);

    const mkRow = (label, col, swatchBg) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ge-pasteboard-opt'; b.dataset.color = col || '';
      b.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;text-align:left;background:none;border:none;color:inherit;padding:5px 8px;border-radius:4px;cursor:pointer;font:inherit;';
      b.innerHTML = `<span style="width:14px;height:14px;border-radius:3px;border:1px solid rgba(255,255,255,0.3);background:${swatchBg};display:inline-block;"></span><span>${label}</span>`;
      b.addEventListener('mouseenter', () => { b.style.background = 'rgba(120,150,255,0.25)'; });
      b.addEventListener('mouseleave', () => { b.style.background = 'none'; });
      return b;
    };

    for (const [label, col] of SWATCHES) {
      const b = mkRow(label, col, col);
      b.addEventListener('click', () => { apply(col); save(col); close(); });
      menu.appendChild(b);
    }
    // Custom — opens a native colour input.
    const cust = mkRow('Custom…', '', 'linear-gradient(45deg,#f33,#3f3,#39f)');
    const inp = document.createElement('input');
    inp.type = 'color'; inp.className = 'ge-pasteboard-custom';
    inp.value = (state && /^#[0-9a-f]{6}$/i.test(state.pasteboardColor || '')) ? state.pasteboardColor : '#232323';
    inp.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none;';
    inp.addEventListener('input', () => { apply(inp.value); save(inp.value); });
    cust.appendChild(inp);
    cust.addEventListener('click', (ev) => { if (ev.target !== inp) inp.click(); });
    menu.appendChild(cust);

    document.body.appendChild(menu);
    const away = (ev) => { if (menu && !menu.contains(ev.target)) { close(); document.removeEventListener('pointerdown', away, true); } };
    const esc = (ev) => { if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', esc, true); } };
    setTimeout(() => { document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', esc, true); }, 0);
  });
}
