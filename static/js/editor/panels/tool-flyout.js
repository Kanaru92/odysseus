/**
 * PS-style tool flyout / sub-tool grouping for the left tool palette.
 *
 * Related sub-tools (e.g. the three lassos) collapse into a single visible
 * slot bearing a small corner triangle; the other members hide. Right-click
 * or press-and-hold the slot opens a flyout listing every member — picking one
 * makes it the slot's visible tool. Whichever member is the ACTIVE tool is
 * always the one shown, so keyboard shortcuts (which select hidden members
 * directly) still light up the right slot.
 *
 * Zero-touch on the critical tool-switch path: every member button stays in
 * the DOM (just hidden when not the slot's shown member), so the existing
 * click handler, the keyboard `.click()` relay, and the active-class toggle
 * all keep working unchanged. A MutationObserver watches the active class and
 * promotes whichever member just became active to be the visible slot.
 */

// Sub-tool groups (industry-standard layout). First id = default shown member.
// A group activates only when 2+ of its members are actually present.
const GROUPS = [
  { id: 'crop', members: ['crop', 'pcrop'] },
  { id: 'lasso', members: ['lasso', 'polylasso', 'maglasso'] },
  { id: 'wand', members: ['wand', 'quickselect'] },
  { id: 'heal', members: ['heal', 'redeye'] },
  { id: 'brush', members: ['brush', 'mixer'] },
];

let _stylesInjected = false;
function injectStyles() {
  if (_stylesInjected || document.getElementById('ge-tool-flyout-styles')) { _stylesInjected = true; return; }
  _stylesInjected = true;
  const el = document.createElement('style');
  el.id = 'ge-tool-flyout-styles';
  el.textContent = `
.ge-tool-grouped-hidden { display: none !important; }
.ge-tool-tri { position: absolute; right: 2px; bottom: 2px; width: 0; height: 0;
  border-left: 5px solid transparent; border-bottom: 5px solid currentColor;
  opacity: 0.5; pointer-events: none; z-index: 2; }
.ge-tool-btn.active .ge-tool-tri { opacity: 0.9; }
.ge-tool-flyout { position: fixed; z-index: 340; min-width: 172px;
  background: #26262b; border: 1px solid rgba(255,255,255,0.18); border-radius: 8px;
  box-shadow: 0 14px 40px rgba(0,0,0,0.55); color: #eee; padding: 4px;
  display: flex; flex-direction: column; gap: 2px; }
.ge-tool-flyout button { display: flex; align-items: center; gap: 9px; width: 100%;
  background: none; border: none; color: #eee; padding: 6px 9px; border-radius: 5px;
  cursor: pointer; font: inherit; font-size: 12px; text-align: left; }
.ge-tool-flyout button:hover { background: rgba(255,255,255,0.08); }
.ge-tool-flyout button.active { background: color-mix(in srgb, var(--red) 26%, transparent); }
.ge-tool-flyout .ge-fly-ico { width: 20px; height: 18px; display: inline-flex;
  align-items: center; justify-content: center; flex: 0 0 auto; }
.ge-tool-flyout .ge-fly-ico svg { width: 17px; height: 17px; }
.ge-tool-flyout .ge-fly-label { flex: 1 1 auto; min-width: 0; }
.ge-tool-flyout .ge-fly-key { margin-left: auto; opacity: 0.5; font-size: 11px; padding-left: 10px; }`;
  (document.head || document.documentElement).appendChild(el);
}

function setShown(rec, btn) {
  if (!btn || !rec.btns.includes(btn)) return;
  rec.shown = btn;
  for (const b of rec.btns) b.classList.toggle('ge-tool-grouped-hidden', b !== btn);
}

export function wireToolFlyouts(toolbar) {
  if (!toolbar || toolbar._flyoutsWired) return;
  injectStyles();
  const byId = (id) => toolbar.querySelector('.ge-tool-btn[data-tool="' + id + '"]');

  const groups = [];
  for (const g of GROUPS) {
    const btns = g.members.map(byId).filter(Boolean);
    if (btns.length < 2) continue;
    const rec = { id: g.id, btns, shown: null };
    groups.push(rec);
    for (const b of btns) {
      b.dataset.flyoutGroup = g.id;
      if (!b.querySelector('.ge-tool-tri')) {
        const tri = document.createElement('span');
        tri.className = 'ge-tool-tri';
        b.appendChild(tri);
      }
    }
    setShown(rec, btns.find((b) => b.classList.contains('active')) || btns[0]);
  }
  toolbar._flyoutsWired = true;
  if (!groups.length) return;

  // --- Flyout popover (transient; outside-click / selection closes it) ---
  let openFly = null;
  const onOutside = (e) => { if (openFly && !openFly.contains(e.target)) closeFly(); };
  const closeFly = () => {
    if (!openFly) return;
    openFly.remove();
    openFly = null;
    document.removeEventListener('pointerdown', onOutside, true);
  };
  const openFlyout = (rec, anchorBtn) => {
    closeFly();
    const win = document.createElement('div');
    win.className = 'ge-tool-flyout';
    for (const b of rec.btns) {
      const id = b.dataset.tool;
      const row = document.createElement('button');
      row.type = 'button';
      if (b.classList.contains('active')) row.classList.add('active');
      const ico = b.querySelector('.ge-tool-icon')?.innerHTML || '';
      const label = b.querySelector('.ge-tool-label')?.textContent || (b.title || id).replace(/\s*\([^)]*\)\s*$/, '');
      const key = (b.title && b.title.match(/\(([^)]+)\)\s*$/) || [])[1] || '';
      row.innerHTML = '<span class="ge-fly-ico">' + ico + '</span><span class="ge-fly-label"></span>' +
        (key ? '<span class="ge-fly-key"></span>' : '');
      row.querySelector('.ge-fly-label').textContent = label;
      if (key) row.querySelector('.ge-fly-key').textContent = key;
      row.addEventListener('click', () => { closeFly(); b.click(); }); // real onSelectTool; observer promotes
      win.appendChild(row);
    }
    (document.getElementById('gallery-editor-container') || document.body).appendChild(win);
    const r = anchorBtn.getBoundingClientRect();
    win.style.left = Math.round(r.right + 6) + 'px';
    win.style.top = Math.min(window.innerHeight - win.offsetHeight - 8, Math.max(8, r.top)) + 'px';
    openFly = win;
    setTimeout(() => document.addEventListener('pointerdown', onOutside, true), 0);
  };

  // --- Open triggers: right-click + press-and-hold ---
  let longFired = false, pressTimer = null, pressX = 0, pressY = 0;
  const cancelPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
  for (const rec of groups) {
    for (const b of rec.btns) {
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); openFlyout(rec, rec.shown || b); });
      b.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        longFired = false; pressX = e.clientX; pressY = e.clientY;
        cancelPress();
        pressTimer = setTimeout(() => { longFired = true; openFlyout(rec, rec.shown || b); }, 450);
      });
      b.addEventListener('pointermove', (e) => {
        if (pressTimer && (Math.abs(e.clientX - pressX) > 6 || Math.abs(e.clientY - pressY) > 6)) cancelPress();
      });
      b.addEventListener('pointerup', cancelPress);
      b.addEventListener('pointercancel', cancelPress);
      b.addEventListener('pointerleave', cancelPress);
    }
  }
  // Swallow the click that follows a press-and-hold so it doesn't also select
  // the tool. Capture phase on the toolbar (an ancestor) runs before the
  // button's own bubble-phase select handler, so stopImmediatePropagation here
  // prevents the tool switch without touching that handler.
  toolbar.addEventListener('click', (e) => {
    if (longFired) { longFired = false; e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);

  // --- Promote the active member to the visible slot (keyboard/menu selects
  //     hidden members directly; the active class lands on the hidden button). ---
  const obs = new MutationObserver(() => {
    for (const rec of groups) {
      const act = rec.btns.find((b) => b.classList.contains('active'));
      if (act && act !== rec.shown) setShown(rec, act);
    }
  });
  obs.observe(toolbar, { attributes: true, attributeFilter: ['class'], subtree: true });
  toolbar._flyoutObserver = obs;
}
