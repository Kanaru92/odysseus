/**
 * Wire the application menu bar (build/menu-bar.js). Handles open/close
 * behaviour (click a title to open; once open, hovering siblings switches;
 * click-away or Esc closes) and relays each item to its already-wired action
 * via the data-relay-* attribute it carries. The menu owns no app logic.
 */
export function wireMenuBar(bar) {
  if (!bar) return;
  const menus = Array.from(bar.querySelectorAll('.ge-menu'));

  const closeAll = () => menus.forEach((m) => {
    m.classList.remove('open');
    const d = m.querySelector('.ge-menu-drop');
    if (d) d.hidden = true;
  });
  const open = (m) => {
    closeAll();
    m.classList.add('open');
    const d = m.querySelector('.ge-menu-drop');
    if (d) d.hidden = false;
  };
  const anyOpen = () => menus.some((m) => m.classList.contains('open'));

  // Dispatch a "Ctrl+Alt+I"-style combo as a real keydown on document so the
  // existing keyboard-shortcuts handler runs it.
  const dispatchKey = (combo) => {
    const parts = combo.toLowerCase().split('+');
    const k = parts[parts.length - 1];
    document.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      key: k,
      code: 'Key' + k.toUpperCase(),
      ctrlKey: parts.includes('ctrl'),
      shiftKey: parts.includes('shift'),
      altKey: parts.includes('alt'),
      metaKey: false,
    }));
  };

  const runItem = (item) => {
    const d = item.dataset;
    if (d.relayClick) document.querySelector(d.relayClick)?.click();
    else if (d.relayImage) document.querySelector(`[data-image-action="${d.relayImage}"]`)?.click();
    else if (d.relayFilter) document.querySelector(`[data-filter-action="${d.relayFilter}"]`)?.click();
    else if (d.relayTool) document.querySelector(`.ge-tool-btn[data-tool="${d.relayTool}"]`)?.click();
    else if (d.relayKey) dispatchKey(d.relayKey);
    // data-relay-panel items (the Window menu's panel toggles) are owned by
    // wire-window-menu.js, which attaches its own click handler — skip here.
  };

  menus.forEach((m) => {
    const title = m.querySelector('.ge-menu-title');
    title?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (m.classList.contains('open')) closeAll();
      // Let panels refresh their checkmarks from live visibility before the
      // drop is revealed (wire-window-menu.js listens for this event).
      else { m.dispatchEvent(new CustomEvent('ge:menu-open', { bubbles: true })); open(m); }
    });
    // Once a menu is open, hovering another title switches to it.
    title?.addEventListener('mouseenter', () => { if (anyOpen() && !m.classList.contains('open')) { m.dispatchEvent(new CustomEvent('ge:menu-open', { bubbles: true })); open(m); } });
    m.querySelectorAll('.ge-menu-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAll();
        runItem(item);
      });
    });
  });

  // Click-away + Esc close.
  document.addEventListener('pointerdown', (e) => { if (!bar.contains(e.target)) closeAll(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && anyOpen()) closeAll(); }, true);
}
