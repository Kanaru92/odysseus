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
  // Presets carry a neutral category label so the grid reads as
  // Screen / Photo / Print / Mobile groups without naming any product.
  const presets = [
    ['Square', 2048, 2048, 'Screen'], ['1080p', 1920, 1080, 'Screen'],
    ['4K UHD', 3840, 2160, 'Screen'], ['HD 720', 1280, 720, 'Screen'],
    ['Portrait', 1080, 1920, 'Mobile'], ['Photo', 1080, 1080, 'Mobile'],
    ['A4 300dpi', 2480, 3508, 'Print'], ['Web', 1280, 800, 'Screen'],
  ];
  const ratios = [
    ['Free', 'free'], ['1:1', '1:1'], ['16:9', '16:9'], ['9:16', '9:16'],
    ['4:3', '4:3'], ['3:2', '3:2'], ['2:3', '2:3'], ['A4', '210:297'],
  ];
  const presetBtns = presets.map(([n, w, h, cat]) =>
    `<button type="button" class="ge-cp-preset" data-w="${w}" data-h="${h}" title="${cat} · ${w}×${h}">${n}<small>${w}×${h}</small></button>`).join('');
  // First ratio (Free) gets an explicit "(Freeform)" sub-label so the user
  // realises it means "type both dimensions yourself".
  const ratioBtns = ratios.map(([n, r], i) =>
    `<button type="button" class="ge-cp-ratio${i === 0 ? ' active' : ''}" data-ratio="${r}">${n}${r === 'free' ? '<span class="ge-cp-ratio-sub">Freeform</span>' : ''}</button>`).join('');
  // Scoped styles for the elements that don't already exist in style.css
  // (name field, prominent ratio band + helper line, background-contents
  // segmented control). Kept inline here on purpose — style.css is owned
  // elsewhere. Existing .ge-cp-preset / .ge-cp-ratio rules still apply.
  const scopedCss = `
    <style>
      .ge-canvas-prompt .ge-cp-namefield { margin-bottom: 12px; }
      .ge-canvas-prompt .ge-cp-namefield > span { display:block; font-size:11px; opacity:0.65; margin-bottom:4px; }
      .ge-canvas-prompt #ge-canvas-prompt-name {
        width:100%; box-sizing:border-box; padding:8px 10px;
        background:var(--bg); color:var(--fg); border:1px solid var(--border);
        border-radius:6px; font:inherit; font-size:14px;
      }
      .ge-canvas-prompt #ge-canvas-prompt-name:focus { outline:none; border-color:var(--red); }
      .ge-canvas-prompt .ge-cp-section-lbl {
        display:block; font-size:10px; letter-spacing:0.4px; text-transform:uppercase;
        opacity:0.5; margin:0 0 5px;
      }
      /* Make the ratio band stand out — the user kept missing it. */
      .ge-canvas-prompt .ge-cp-ratio-band {
        border:1px solid var(--border); border-radius:8px; padding:9px 10px;
        background:color-mix(in srgb, var(--fg) 3%, transparent); margin-bottom:12px;
      }
      .ge-canvas-prompt .ge-cp-ratio-band .ge-cp-ratios { margin-bottom:0; }
      .ge-canvas-prompt .ge-cp-ratio-hint { margin:7px 0 0; font-size:11px; opacity:0.6; line-height:1.35; }
      .ge-canvas-prompt .ge-cp-ratio-sub { display:block; font-size:8px; line-height:1; opacity:0.6; margin-top:1px; }
      .ge-canvas-prompt .ge-cp-bgs { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
      .ge-canvas-prompt .ge-cp-bg {
        flex:1; min-width:64px; padding:6px 8px; font-size:11px; cursor:pointer;
        background:color-mix(in srgb, var(--fg) 5%, transparent);
        color:var(--fg); border:1px solid var(--border); border-radius:6px; opacity:0.8;
      }
      .ge-canvas-prompt .ge-cp-bg:hover { opacity:1; }
      .ge-canvas-prompt .ge-cp-bg.active { opacity:1; background:color-mix(in srgb, var(--red) 18%, transparent); border-color:var(--red); }
      .ge-canvas-prompt #ge-canvas-prompt-bgcolor {
        width:34px; height:30px; padding:0; border:1px solid var(--border);
        border-radius:6px; background:var(--bg); cursor:pointer; flex:0 0 auto;
      }
      .ge-canvas-prompt .ge-cp-bgrow { margin-bottom:12px; }
    </style>`;
  return `
        <div class="modal-content ge-canvas-prompt">
          ${scopedCss}
          <div class="modal-header"><h4 id="ge-canvas-prompt-title">New canvas</h4></div>
          <div class="modal-body">
            <label class="ge-cp-namefield">
              <span>Name</span>
              <input type="text" id="ge-canvas-prompt-name" maxlength="80" placeholder="Untitled" value="Untitled">
            </label>
            <span class="ge-cp-section-lbl">Presets</span>
            <div class="ge-cp-presets">${presetBtns}</div>
            <span class="ge-cp-section-lbl">Aspect ratio</span>
            <div class="ge-cp-ratio-band">
              <div class="ge-cp-ratios"><span class="ge-cp-ratios-lbl">Ratio</span>${ratioBtns}</div>
              <p class="ge-cp-ratio-hint">Pick a ratio, type one dimension — the other follows. Choose Free to enter both.</p>
            </div>
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
            <div class="ge-cp-bgrow">
              <span class="ge-cp-section-lbl">Background contents</span>
              <div class="ge-cp-bgs">
                <button type="button" class="ge-cp-bg active" data-bg="white">White</button>
                <button type="button" class="ge-cp-bg" data-bg="transparent">Transparent</button>
                <button type="button" class="ge-cp-bg" data-bg="color">Color</button>
                <input type="color" id="ge-canvas-prompt-bgcolor" value="#ffffff" style="display:none;">
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="confirm-btn confirm-btn-secondary" id="ge-canvas-prompt-cancel">Cancel</button>
            <button class="confirm-btn confirm-btn-primary" id="ge-canvas-prompt-ok">Create</button>
          </div>
        </div>`;
}
