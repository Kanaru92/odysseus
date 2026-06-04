/**
 * Tool options bar — a slim horizontal strip under the top bar that shows the
 * ACTIVE tool's name (+ its shortcut) on the left and that tool's primary
 * controls inline, matching the layout pro image editors put at the top.
 *
 * Pure DOM only. The controls it hosts are thin REMOTES of the canonical
 * right-panel inputs (wired in wire-options-bar.js) — they relay value changes
 * to the real control and never own state, so the two surfaces stay in sync
 * with zero duplicated logic. Inline styles keep it self-contained (no global
 * CSS dependency) and theme-neutral against the dark editor chrome.
 *
 * @returns {HTMLDivElement}
 */
export function buildOptionsBar() {
  const bar = document.createElement('div');
  bar.className = 'ge-options-bar';
  // FIXED height (not min-height): the bar must not grow/shrink with the active
  // tool's controls, or the canvas + all panels jump up/down on every tool
  // switch. Pinned to comfortably fit the tallest tool's controls (sliders +
  // a native select); shorter tools just centre in the same height.
  bar.style.cssText =
    'display:flex;align-items:center;gap:10px;padding:0 12px;font-size:11px;box-sizing:border-box;' +
    'border-bottom:1px solid rgba(255,255,255,0.07);background:rgba(255,255,255,0.02);' +
    'height:44px;min-height:44px;flex:0 0 auto;overflow-x:auto;overflow-y:hidden;white-space:nowrap;scrollbar-width:thin;';
  bar.innerHTML = `
    <span class="ge-ob-tool-name" style="font-weight:600;opacity:0.92;white-space:nowrap;flex:0 0 auto;">Move</span>
    <span class="ge-ob-sep" style="width:1px;height:16px;background:rgba(255,255,255,0.12);flex:0 0 auto;"></span>
    <div class="ge-ob-controls" style="display:flex;align-items:center;gap:11px;flex:0 0 auto;"></div>
  `;
  return bar;
}
