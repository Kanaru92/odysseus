/**
 * Build the editor's left-side tool palette.
 *
 * Pure DOM construction — no module state. The big tool-switch logic
 * (cursor swap, control-section toggle, transform entry, inpaint
 * mask plumbing, etc.) stays in the caller and arrives here as the
 * `onSelectTool` callback.
 *
 * @param {{
 *   currentTool: string,
 *   onSelectTool: (toolId: string, btn: HTMLButtonElement, toolbar: HTMLDivElement) => void,
 *   onClearSelection: (which: 'lasso'|'wand') => void,
 * }} ctx
 * @returns {{ toolbar: HTMLDivElement, toolKeyMap: Record<string,string> }}
 */
import { TOOL_KEYS } from '../keymap.js';

export function buildToolbar({ currentTool, onSelectTool, onClearSelection }) {
  const toolbar = document.createElement('div');
  toolbar.className = 'ge-toolbar';
  const tools = [
    { id: 'move', label: 'Move', icon: '✥', key: 'V' },
    { id: 'crop', label: 'Crop', icon: '✂', key: 'C' },
    { id: 'transform', label: 'Transform', icon: '⤢', key: 'T' },
    { id: 'distort', label: 'Distort', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7 L20 4 L19 20 L6 18 Z"/><circle cx="4" cy="7" r="1.6" fill="currentColor"/><circle cx="20" cy="4" r="1.6" fill="currentColor"/><circle cx="19" cy="20" r="1.6" fill="currentColor"/><circle cx="6" cy="18" r="1.6" fill="currentColor"/></svg>' },
    { id: 'pcrop', label: 'Perspective Crop', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4 L20 6 L18 19 L4 17 Z"/><path d="M2 2l3 3M22 2l-3 3" opacity="0.5"/></svg>' },
    { id: 'liquify', label: 'Liquify', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12c3-4 6 4 9 0s6-4 9 0"/><path d="M3 17c3-4 6 4 9 0s6-4 9 0"/></svg>' },
    { sep: true },
    { id: 'brush', label: 'Brush', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/></svg>', key: 'B' },
    { id: 'eraser', label: 'Eraser', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19.4 14.6 14.6 19.4a2 2 0 0 1-2.83 0L4.6 12.23a2 2 0 0 1 0-2.83l7.17-7.17a2 2 0 0 1 2.83 0l4.8 4.8a2 2 0 0 1 0 2.83Z"/><line x1="22" y1="21" x2="7" y2="21"/><line x1="14" y1="3" x2="9" y2="8"/></svg>', key: 'E' },
    { id: 'smudge', label: 'Smudge', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c3 4 6 6.5 6 10a6 6 0 0 1-12 0c0-3.5 3-6 6-10z"/><path d="M9 14c0 1.7 1.3 3 3 3" opacity="0.5"/></svg>' },
    { id: 'mixer', label: 'Mixer Brush', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 11.5l7.5-7.5a2.1 2.1 0 0 1 3 3l-7.5 7.5"/><path d="M7 14c-1.5 0-2.7 1.2-2.7 2.7 0 1.2-2 1.4-1.8 1.8 1 1 2.2 1.8 3.6 1.8 2 0 3.6-1.6 3.6-3.6 0-1.5-1.2-2.7-2.7-2.7z"/><circle cx="17" cy="15" r="2.4" opacity="0.55"/></svg>' },
    { id: 'dodgeburn', label: 'Dodge / Burn', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/></svg>' },
    { id: 'heal', label: 'Spot Healing', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="8" rx="4" transform="rotate(-45 12 12)"/><path d="M9 12h6M12 9v6" opacity="0.6"/></svg>', key: 'J' },
    { id: 'redeye', label: 'Red Eye', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/><path d="M3 7l2-2M21 7l-2-2M3 17l2 2M21 17l-2 2" opacity="0.6"/></svg>' },
    { id: 'ruler', label: 'Ruler', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="10" rx="1"/><path d="M6 7v3M10 7v4M14 7v3M18 7v4"/></svg>' },
    { sep: true },
    { id: 'clone', label: 'Clone', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="3"/><path d="M9 12l-3 4h12l-3-4"/><path d="M4 20h16"/></svg>', key: 'K' },
    { id: 'marquee', label: 'Marquee', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="3 2"><rect x="3" y="3" width="18" height="18" rx="1"/></svg>' },
    { id: 'lasso', label: 'Lasso', icon: '⟡', key: 'L' },
    { id: 'polylasso', label: 'Polygonal Lasso', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 8 9 3 20 7 17 19 6 17" stroke-dasharray="3 2"/><circle cx="3" cy="8" r="1.6" fill="currentColor" stroke="none"/></svg>' },
    { id: 'maglasso', label: 'Magnetic Lasso', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v6a8 8 0 0 0 16 0V4" stroke-dasharray="3 2"/><circle cx="4" cy="4" r="1.6" fill="currentColor" stroke="none"/><circle cx="20" cy="4" r="1.6" fill="currentColor" stroke="none"/></svg>' },
    { id: 'wand', label: 'Wand', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/><path d="M17.8 11.8L19 13"/><path d="M15 9h0"/><path d="M17.8 6.2L19 5"/><path d="M3 21l9-9"/><path d="M12.2 6.2L11 5"/></svg>', key: 'W' },
    { id: 'quickselect', label: 'Quick Select', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="11" r="6" stroke-dasharray="3 2.5"/><path d="M18 4l1.4 3.1L22 8.5l-2.6 1.4L18 13l-1.4-3.1L14 8.5l2.6-1.4z" fill="currentColor" stroke="none"/></svg>' },
    { id: 'eyedropper', label: 'Eyedropper', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 3a2.83 2.83 0 0 0-4 0l-2 2-1-1-2 2 1 1L3 18v3h3l9-9 1 1 2-2-1-1 2-2a2.83 2.83 0 0 0 0-4z"/></svg>' },
    { id: 'gradient', label: 'Gradient', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M21 3 3 21" opacity="0.5"/></svg>' },
    { id: 'shapes', label: 'Shape', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="9" height="9" rx="1"/><circle cx="16.5" cy="15.5" r="4.5"/></svg>' },
    { id: 'bucket', label: 'Paint Bucket', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.5 11.5 9 2 2 9l8 8a2 2 0 0 0 2.8 0z"/><path d="M4 7h12"/><path d="M20.5 14s2 2.6 2 4.2a2 2 0 1 1-4 0c0-1.6 2-4.2 2-4.2z"/></svg>' },
    { id: 'text', label: 'Type', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5h14"/><path d="M12 5v14"/><path d="M9 19h6"/></svg>', key: 'T' },
    { sep: true },
    { id: 'inpaint', label: 'Inpaint', ai: true, icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/></svg>', key: 'M' },
    { id: 'rembg', ai: true, label: 'Bg Remove', icon: '✄' },
    { id: 'sharpen', ai: true, label: 'Sharpen', icon: '◈', key: 'S' },
    { id: 'filter', label: 'Filters', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><circle cx="9" cy="7" r="2.2" fill="currentColor"/><line x1="4" y1="14" x2="20" y2="14"/><circle cx="15" cy="14" r="2.2" fill="currentColor"/></svg>' },
  ];
  // Tool shortcut letters come from the central keymap (keymap.js) so the
  // toolbar and keyboard handler stay in sync on the industry-standard layout.
  // A tool in the map with '' is intentionally unbound (AI tools, or standard
  // tools not built yet so their letter stays reserved). Tools absent from the
  // map keep their inline key. This is what de-collides M/S/K/T from other uses.
  for (const t of tools) {
    if (t.id && Object.prototype.hasOwnProperty.call(TOOL_KEYS, t.id)) {
      t.key = TOOL_KEYS[t.id] || undefined;
    }
  }
  const toolKeyMap = {};
  for (const t of tools) {
    if (t.sep) {
      const sep = document.createElement('div');
      sep.className = 'ge-tool-sep';
      sep.textContent = t.label;
      toolbar.appendChild(sep);
      continue;
    }
    if (t.key) toolKeyMap[t.key.toLowerCase()] = t.id;
    const btn = document.createElement('button');
    btn.className = 'ge-tool-btn' + (t.id === currentTool ? ' active' : '');
    btn.dataset.tool = t.id;
    btn.title = t.label + (t.key ? ` (${t.key})` : '');
    // Heavy 4-point AI star marker for AI-backed tools — sits just to
    // the left of the icon so the user can spot AI vs local tools at a
    // glance now that the "AI Tools" separator is gone.
    const aiStar = t.ai ? '<span class="ge-tool-ai" title="AI">✦</span>' : '';
    btn.classList.toggle('is-ai', !!t.ai);
    // Selection-clear badge — rendered only for tools that can hold a
    // selection (lasso, wand). Inpaint masks are first-class sub-layers
    // now so they get their own delete-X in the layer panel.
    const clearBadge = (t.id === 'lasso' || t.id === 'polylasso' || t.id === 'maglasso' || t.id === 'wand')
      ? '<span class="ge-tool-clear" title="Clear selection" data-clear-tool="' + t.id + '">' +
          '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>' +
        '</span>'
      : '';
    btn.innerHTML = `${aiStar}<span class="ge-tool-icon"${t.small ? ' style="font-size:14px"' : ''}>${t.icon}</span><span class="ge-tool-label">${t.label}</span>${clearBadge}`;
    // Clear-badge click stops propagation so the tool itself doesn't
    // toggle; the actual clear is handled by the caller.
    btn.querySelector('.ge-tool-clear')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      onClearSelection(ev.currentTarget.dataset.clearTool);
    });
    btn.addEventListener('click', () => onSelectTool(t.id, btn, toolbar));
    toolbar.appendChild(btn);
  }
  return { toolbar, toolKeyMap };
}
