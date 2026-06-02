/**
 * Static markup for misc floating popups that live above the canvas.
 *
 * All pure DOM. Caller wires every ID via document.getElementById /
 * el.querySelector after appending.
 */

/** Keyboard-shortcuts popover. */
export function shortcutsPopupHTML() {
  return `
      <div id="ge-shortcuts-handle" style="display:flex;align-items:center;gap:6px;margin:-4px -6px 4px;padding:4px 6px;cursor:grab;user-select:none;touch-action:none;">
        <span style="display:inline-flex;flex-direction:column;gap:2px;margin-right:2px;opacity:0.35;">
          <span style="display:block;width:18px;height:2px;border-radius:1px;background:currentColor;"></span>
          <span style="display:block;width:18px;height:2px;border-radius:1px;background:currentColor;"></span>
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.8"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/></svg>
        <strong style="font-size:12px;letter-spacing:0.3px;">Editor Shortcuts</strong>
        <span style="flex:1"></span>
        <button id="ge-shortcuts-close" class="ge-btn ge-btn-sm" style="padding:0 6px;height:20px;line-height:1;background:none;border:none;opacity:0.55;cursor:pointer;color:var(--fg);">✖</button>
      </div>
      <div class="ge-shortcuts-grid">
        <div class="ge-shortcuts-col">
          <h5>Tools</h5>
          <div><kbd>V</kbd> Move</div>
          <div><kbd>M</kbd> Marquee</div>
          <div><kbd>L</kbd> Lasso</div>
          <div><kbd>W</kbd> Wand</div>
          <div><kbd>C</kbd> Crop</div>
          <div><kbd>B</kbd> Brush</div>
          <div><kbd>E</kbd> Eraser</div>
          <div><kbd>S</kbd> Clone <span style="opacity:0.5">(Alt-click source)</span></div>
          <div><kbd>I</kbd> Eyedropper <span style="opacity:0.5">(Alt while painting)</span></div>
          <div><kbd>G</kbd> Gradient</div>
          <div><kbd>O</kbd> Dodge / Burn</div>
          <div><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd> Liquify</div>
        </div>
        <div class="ge-shortcuts-col">
          <h5>Edit / Layer</h5>
          <div><kbd>Ctrl</kbd>+<kbd>Z</kbd> Undo</div>
          <div><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> Redo</div>
          <div><kbd>Ctrl</kbd>+<kbd>S</kbd> Save</div>
          <div><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> Save a copy</div>
          <div><kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>J</kbd> New layer</div>
          <div><kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> Stamp visible</div>
          <div><kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>G</kbd> Clip to below</div>
          <div><kbd>Ctrl</kbd>+<kbd>G</kbd> Group layer</div>
          <div><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> Ungroup</div>
          <div><kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>T</kbd> Free Transform</div>
          <div><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd> Canvas size…</div>
        </div>
        <div class="ge-shortcuts-col">
          <h5>Selection / Fill</h5>
          <div><kbd>Ctrl</kbd>+<kbd>A</kbd> Select all</div>
          <div><kbd>Ctrl</kbd>+<kbd>D</kbd> Deselect</div>
          <div><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd> Invert</div>
          <div><kbd>Q</kbd> Quick mask</div>
          <div><kbd>Alt</kbd>+<kbd>⌫</kbd> Fill foreground</div>
          <div><kbd>Ctrl</kbd>+<kbd>⌫</kbd> Fill background</div>
          <div><kbd>Enter</kbd> Apply transform / crop</div>
          <div><kbd>Esc</kbd> Cancel</div>
        </div>
        <div class="ge-shortcuts-col">
          <h5>Brush / View</h5>
          <div><kbd>[</kbd> <kbd>]</kbd> Brush size</div>
          <div><kbd>{</kbd> <kbd>}</kbd> Hardness</div>
          <div><kbd>1</kbd>–<kbd>0</kbd> Opacity</div>
          <div><kbd>X</kbd> Swap colors</div>
          <div><kbd>D</kbd> Default colors</div>
          <div><kbd>/</kbd> Lock transparency</div>
          <div><kbd>Space</kbd> Pan · <kbd>Tab</kbd> Hide panels</div>
          <div><kbd>Ctrl</kbd>+<kbd>Y</kbd> Proof colors (CMYK)</div>
          <div><kbd>F</kbd> Fullscreen</div>
        </div>
      </div>
      <div style="margin-top:8px;font-size:10px;opacity:0.5;text-align:center;">Press <kbd>?</kbd> or click the keyboard icon to toggle.</div>
    `;
}


/**
 * History panel — sidebar listing all undo entries.
 * @param {string} historyIcon  Inline SVG markup for the title icon.
 */
export function historyPanelHTML(historyIcon) {
  return `
    <div class="ge-history-head" data-history-drag>
      <span class="ge-adj-icon">${historyIcon}</span>
      <span class="ge-history-title">History</span>
      <span class="ge-head-btns">
        <button class="ge-adj-min" type="button" title="Minimise">&minus;</button>
      </span>
    </div>
    <div class="ge-history-list" id="ge-history-list"></div>
  `;
}


/**
 * Empty-canvas size-prompt modal — body markup (caller controls show /
 * hide and wires the Cancel / Create buttons).
 */
export function canvasSizePromptHTML() {
  const presets = [
    ['Square', 2048, 2048], ['1080p', 1920, 1080], ['4K UHD', 3840, 2160],
    ['HD 720', 1280, 720], ['Portrait', 1080, 1920], ['Insta', 1080, 1080],
    ['A4 300dpi', 2480, 3508], ['Web', 1280, 800],
  ];
  const ratios = [
    ['Free', 'free'], ['1:1', '1:1'], ['16:9', '16:9'], ['9:16', '9:16'],
    ['4:3', '4:3'], ['3:2', '3:2'], ['2:3', '2:3'], ['A4', '210:297'],
  ];
  const presetBtns = presets.map(([n, w, h]) =>
    `<button type="button" class="ge-cp-preset" data-w="${w}" data-h="${h}">${n}<small>${w}×${h}</small></button>`).join('');
  const ratioBtns = ratios.map(([n, r], i) =>
    `<button type="button" class="ge-cp-ratio${i === 0 ? ' active' : ''}" data-ratio="${r}">${n}</button>`).join('');
  return `
        <div class="modal-content ge-canvas-prompt">
          <div class="modal-header"><h4 id="ge-canvas-prompt-title">New canvas</h4></div>
          <div class="modal-body">
            <div class="ge-cp-presets">${presetBtns}</div>
            <div class="ge-cp-ratios"><span class="ge-cp-ratios-lbl">Ratio</span>${ratioBtns}</div>
            <div class="ge-canvas-prompt-row">
              <label class="ge-canvas-prompt-field">
                <span>Width</span>
                <input type="text" id="ge-canvas-prompt-w" inputmode="numeric" value="1920">
              </label>
              <span class="ge-canvas-prompt-x">×</span>
              <label class="ge-canvas-prompt-field">
                <span>Height</span>
                <input type="text" id="ge-canvas-prompt-h" inputmode="numeric" value="1080">
              </label>
            </div>
            <p class="ge-canvas-prompt-hint">Pick a ratio to constrain W×H (type one, the other follows). "Free" = independent.</p>
          </div>
          <div class="modal-footer">
            <button class="confirm-btn confirm-btn-secondary" id="ge-canvas-prompt-cancel">Cancel</button>
            <button class="confirm-btn confirm-btn-primary" id="ge-canvas-prompt-ok">Create</button>
          </div>
        </div>`;
}
