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
    // `code` is physical-key based and only meaningful for letters/digits.
    // Several downstream handlers match on e.code (e.g. 'KeyI') so Alt/Shift-
    // modified key values don't break them, so emit it for a–z; for non-letter
    // keys (e.g. "'", ";") a "Key<x>" code is invalid, so omit code and let the
    // handler match on e.key instead.
    const init = {
      bubbles: true,
      key: k,
      ctrlKey: parts.includes('ctrl'),
      shiftKey: parts.includes('shift'),
      altKey: parts.includes('alt'),
      metaKey: false,
    };
    if (/^[a-z]$/.test(k)) init.code = 'Key' + k.toUpperCase();
    document.dispatchEvent(new KeyboardEvent('keydown', init));
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

  // Click-away + Esc close. These are document-level capture listeners, so they
  // must be torn down when this menu bar is removed from the DOM — wireMenuBar
  // runs on every editor (re)open with a fresh `bar`, and untracked document
  // listeners otherwise accumulate one set per reopen (each pinning the stale
  // `bar`). Self-remove via a MutationObserver tied to the bar's lifecycle.
  const onDocDown = (e) => { if (!bar.contains(e.target)) closeAll(); };
  const onDocKey = (e) => { if (e.key === 'Escape' && anyOpen()) closeAll(); };
  document.addEventListener('pointerdown', onDocDown, true);
  document.addEventListener('keydown', onDocKey, true);

  const teardown = () => {
    document.removeEventListener('pointerdown', onDocDown, true);
    document.removeEventListener('keydown', onDocKey, true);
  };
  // Watch for `bar` (or an ancestor) being detached; when it is, remove the
  // document listeners and stop observing.
  if (typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(() => {
      if (!bar.isConnected) { teardown(); observer.disconnect(); }
    });
    observer.observe(document, { childList: true, subtree: true });
  }
}
