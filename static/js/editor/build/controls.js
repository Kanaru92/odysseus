/**
 * Build the editor's right-panel controls innerHTML.
 *
 * Returns the string — caller creates the wrapper element, attaches its
 * own touch / swipe-to-dismiss listeners, then sets innerHTML. Per-tool
 * sections are all toggled `display:none` here; the tool-switch handler
 * in galleryEditor.js shows the section matching the active tool.
 *
 * @param {{ color: string, brushSize: number, wandTolerance: number }} ctx
 * @returns {string}
 */
export function controlsHTML({ color, brushSize, wandTolerance }) {
  const brushSliderValue = Math.round(Math.log(Math.max(1, brushSize)) / Math.log(5000) * 1000);
  return `
    <div class="ge-color-panel" id="ge-color-panel">
      <div class="ge-color-tabs" role="tablist">
        <button type="button" class="ge-color-tab active" data-ctab="color">Color</button>
        <button type="button" class="ge-color-tab" data-ctab="ok">OK Color</button>
        <button type="button" class="ge-color-tab" data-ctab="lab">Lab</button>
        <button type="button" class="ge-color-tab" data-ctab="swatches">Swatches</button>
      </div>
      <div class="ge-color-pane" data-cpane="color" id="ge-color-hsv"></div>
      <div class="ge-color-pane" data-cpane="ok" id="ge-okpicker" style="display:none;"></div>
      <div class="ge-color-pane" data-cpane="lab" id="ge-labpicker" style="display:none;"></div>
      <div class="ge-color-pane ge-swatches-section" id="ge-swatches-section" data-cpane="swatches" style="display:none;">
        <div class="ge-section-title" style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
          <span>Swatches</span>
          <span style="display:flex;gap:4px;">
            <button type="button" class="ge-btn ge-btn-sm" id="ge-swatch-import" title="Import a palette (.json)" style="padding:1px 7px;">↥</button>
            <button type="button" class="ge-btn ge-btn-sm" id="ge-swatch-export" title="Export your saved swatches (.json)" style="padding:1px 7px;">↧</button>
            <button type="button" class="ge-btn ge-btn-sm" id="ge-swatch-add" title="Save the current foreground colour" style="padding:1px 8px;">+</button>
          </span>
        </div>
        <div id="ge-swatches" style="display:flex;flex-wrap:wrap;gap:3px;"></div>
        <div id="ge-swatch-recent-wrap" style="margin-top:5px;display:none;">
          <div style="font-size:10px;opacity:0.5;margin-bottom:2px;">Recent</div>
          <div id="ge-swatch-recent" style="display:flex;flex-wrap:wrap;gap:3px;"></div>
        </div>
      </div>
    </div>
    <!-- Rotate & Flip lives on the top bar (ge-tb-fliph/flipv/rotccw/rotcw) + the
         Image menu; the duplicate side-panel section was removed (felt out of place). -->
    <div class="ge-eraser-section" id="ge-crop-section" style="display:none;">
      <div class="ge-section-title">Crop</div>
      <div class="ge-control-row" style="display:flex;flex-wrap:wrap;gap:4px;">
        <button type="button" class="ge-btn ge-btn-sm ge-crop-ratio active" data-crop-ratio="0">Free</button>
        <button type="button" class="ge-btn ge-btn-sm ge-crop-ratio" data-crop-ratio="1">1:1</button>
        <button type="button" class="ge-btn ge-btn-sm ge-crop-ratio" data-crop-ratio="1.7778">16:9</button>
        <button type="button" class="ge-btn ge-btn-sm ge-crop-ratio" data-crop-ratio="1.3333">4:3</button>
        <button type="button" class="ge-btn ge-btn-sm ge-crop-ratio" data-crop-ratio="1.5">3:2</button>
      </div>
      <label class="ge-control-row" style="display:flex;align-items:center;gap:6px;font-size:11px;margin-top:6px;cursor:pointer;">
        <input type="checkbox" id="ge-crop-delete" checked>
        <span>Delete cropped pixels</span>
      </label>
      <p style="font-size:10px;opacity:0.5;margin:2px 0 0;">Drag to crop — drag past an edge to extend the canvas. Pick a ratio to constrain it (or hold Shift to lock the current one). Uncheck to keep cropped-out pixels hidden instead of deleting them.</p>
    </div>
    <div class="ge-eraser-section" id="ge-distort-section" style="display:none;">
      <div class="ge-section-title">Distort</div>
      <div class="ge-control-row ge-tool-model-row">
        <label>Mode</label>
        <select id="ge-distort-mode" class="ge-tool-select" style="flex:1;min-width:0;" title="Free = drag each corner; Skew = the edge shears; Perspective = symmetric trapezoid.">
          <option value="free">Free</option>
          <option value="skew">Skew</option>
          <option value="perspective">Perspective</option>
        </select>
      </div>
      <div class="ge-control-row ge-actions" style="gap:4px;">
        <button class="ge-btn ge-btn-sm ge-btn-primary" id="ge-distort-apply">Apply</button>
        <button class="ge-btn ge-btn-sm" id="ge-distort-cancel">Cancel</button>
      </div>
    </div>
    <div class="ge-eraser-section" id="ge-pcrop-section" style="display:none;">
      <div class="ge-section-title">Perspective Crop</div>
      <p style="font-size:10px;opacity:0.5;margin:0 0 4px;">Drag the 4 corners over a skewed subject, then Apply to straighten it to a rectangle.</p>
      <div class="ge-control-row ge-actions" style="gap:4px;">
        <button class="ge-btn ge-btn-sm ge-btn-primary" id="ge-pcrop-apply">Apply</button>
        <button class="ge-btn ge-btn-sm" id="ge-pcrop-cancel">Cancel</button>
      </div>
      <p style="font-size:10px;opacity:0.5;margin:2px 0 0;">Drag the corner handles to free-distort the layer. Enter applies · Esc cancels.</p>
    </div>
    <div class="ge-eraser-section" id="ge-eyedropper-section" style="display:none;">
      <div class="ge-section-title">Eyedropper</div>
      <div class="ge-control-row ge-tool-model-row">
        <label>Sample</label>
        <select id="ge-eyedropper-sample" class="ge-tool-select" style="flex:1;min-width:0;" title="Average a region instead of a single pixel — steadier picks off noisy / textured areas.">
          <option value="1">Point</option>
          <option value="3">3 × 3 average</option>
          <option value="5">5 × 5 average</option>
        </select>
      </div>
      <div class="ge-control-row ge-tool-model-row">
        <label>Source</label>
        <select id="ge-eyedropper-source" class="ge-tool-select" style="flex:1;min-width:0;" title="Which layers the eyedropper samples from.">
          <option value="all">All Layers</option>
          <option value="current">Current Layer</option>
          <option value="below">Current &amp; Below</option>
        </select>
      </div>
    </div>
    <div id="ge-brush-controls">
      <div class="ge-control-row" id="ge-color-row">
        <label>Color</label>
        <span class="ge-fgbg" style="display:inline-flex;align-items:center;gap:4px;">
          <input type="color" class="ge-color-picker ge-fg-color" value="${color}" title="Foreground color — what the brush paints" />
          <input type="color" class="ge-color-picker ge-bg-color" value="#ffffff" title="Background color" />
          <button type="button" class="ge-btn ge-btn-sm" id="ge-swap-colors" title="Swap foreground/background (X)" aria-label="Swap colors" style="padding:2px 6px;">⇄</button>
          <button type="button" class="ge-btn ge-btn-sm" id="ge-default-colors" title="Default colors — black/white (D)" aria-label="Default colors" style="padding:2px 6px;">◫</button>
        </span>
      </div>
      <div class="ge-control-row">
        <label>Size <span class="ge-size-label">${brushSize}px</span></label>
      <input type="range" class="ge-size-slider" min="0" max="1000" value="${brushSliderValue}" />
    </div>
    </div>
    <div class="ge-marquee-section" id="ge-marquee-section" style="display:none;">
      <div class="ge-section-title">Marquee</div>
      <div class="ge-control-row" style="display:flex;gap:4px;flex-wrap:wrap;">
        <button type="button" class="ge-btn ge-btn-sm ge-marquee-mode active" data-marquee-mode="rect">Rectangle</button>
        <button type="button" class="ge-btn ge-btn-sm ge-marquee-mode" data-marquee-mode="ellipse">Ellipse</button>
        <button type="button" class="ge-btn ge-btn-sm ge-marquee-mode" data-marquee-mode="row" title="Single Row (1px tall, full width)">Row</button>
        <button type="button" class="ge-btn ge-btn-sm ge-marquee-mode" data-marquee-mode="col" title="Single Column (1px wide, full height)">Column</button>
      </div>
      <p style="font-size:10px;opacity:0.5;margin:2px 0 0;">Drag to select. Then Del clears pixels, Ctrl+C copies, M makes a mask, Ctrl+Alt+I inverts.</p>
    </div>
    <div class="ge-shape-section" id="ge-shape-section" style="display:none;">
      <div class="ge-section-title">Shape</div>
      <div class="ge-control-row" style="display:flex;gap:4px;flex-wrap:wrap;">
        <button type="button" class="ge-btn ge-btn-sm ge-shape-mode active" data-shape-mode="rect">Rectangle</button>
        <button type="button" class="ge-btn ge-btn-sm ge-shape-mode" data-shape-mode="ellipse">Ellipse</button>
        <button type="button" class="ge-btn ge-btn-sm ge-shape-mode" data-shape-mode="line">Line</button>
      </div>
      <p style="font-size:10px;opacity:0.5;margin:2px 0 0;">Drag to draw with the foreground colour. Hold Shift for a square / circle / 45° line. Line width uses the brush size.</p>
    </div>
    <div class="ge-lasso-section" id="ge-lasso-section" style="display:none;">
      <div class="ge-control-row ge-eraser-row ge-sel-refine" id="ge-lasso-refine-feather" style="display:none;">
        <span class="ge-eraser-preview" id="ge-lasso-feather-preview" aria-hidden="true"></span>
        <label>Feather <span id="ge-lasso-feather-label">0px</span></label>
        <input type="range" id="ge-lasso-feather" min="0" max="200" value="0" title="Soften the selection edge — feathers the mask alpha." />
      </div>
      <div class="ge-control-row ge-eraser-row ge-sel-refine ge-moved-to-refine" id="ge-lasso-refine-grow" style="display:none;">
        <span class="ge-eraser-preview" id="ge-lasso-grow-preview" aria-hidden="true"></span>
        <label>Edge stroke <span id="ge-lasso-grow-label">0px</span></label>
        <input type="range" id="ge-lasso-grow" min="-40" max="40" value="0" title="Expand (+) or contract (−) the selection before baking." />
      </div>
      <div class="ge-control-row ge-actions" style="margin-top:4px;flex-wrap:wrap;">
        <button class="ge-btn ge-btn-sm ge-btn-iconlabel" id="ge-lasso-invert" title="Invert selection (Ctrl+Alt+I)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
          Invert
        </button>
        <button class="ge-btn ge-btn-sm ge-btn-iconlabel" id="ge-lasso-delete" title="Delete selected pixels from the layer">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
          Delete
        </button>
        <button class="ge-btn ge-btn-sm ge-btn-iconlabel" id="ge-lasso-copy" title="Copy selection to new layer">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Copy Layer
        </button>
        <button class="ge-btn ge-btn-sm ge-btn-iconlabel" id="ge-lasso-mask" title="Convert selection to inpaint mask">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/></svg>
          To Mask
        </button>
      </div>
      <p style="font-size:9px;opacity:0.4;margin:4px 0 0;">Draw a freehand selection. Esc to cancel.</p>
    </div>
    <div class="ge-wand-section" id="ge-wand-section" style="display:none;">
      <div class="ge-control-row" style="display:flex;gap:4px;margin-bottom:4px;" title="How the next click combines with the current selection. Shift / Alt held during a click override this for one click.">
        <button type="button" class="ge-btn ge-btn-sm ge-wand-mode-btn active" data-wand-mode="replace" title="Replace selection on each click">New</button>
        <button type="button" class="ge-btn ge-btn-sm ge-wand-mode-btn" data-wand-mode="add" title="Add to selection (Shift)">+ Add</button>
        <button type="button" class="ge-btn ge-btn-sm ge-wand-mode-btn" data-wand-mode="subtract" title="Subtract from selection (Alt)">− Subtract</button>
      </div>
      <div class="ge-control-row ge-eraser-row">
        <span class="ge-eraser-preview" id="ge-wand-tol-preview" aria-hidden="true"></span>
        <label>Tolerance <span id="ge-wand-tol-label">${wandTolerance}</span></label>
        <button type="button" class="ge-btn ge-btn-sm ge-wand-live-btn" id="ge-wand-live" title="Retune selection while dragging tolerance" aria-pressed="false">Live</button>
        <input type="range" id="ge-wand-tolerance" min="0" max="100" value="${wandTolerance}" />
      </div>
      <div class="ge-control-row ge-eraser-row ge-sel-refine" id="ge-wand-refine-feather" style="display:none;">
        <span class="ge-eraser-preview" id="ge-wand-feather-preview" aria-hidden="true"></span>
        <label>Feather <span id="ge-wand-feather-label">0px</span></label>
        <input type="range" id="ge-wand-feather" min="0" max="200" value="0" title="Soften the selection edge — feathers the mask alpha." />
      </div>
      <div class="ge-control-row ge-eraser-row ge-sel-refine ge-moved-to-refine" id="ge-wand-refine-grow" style="display:none;">
        <span class="ge-eraser-preview" id="ge-wand-grow-preview" aria-hidden="true"></span>
        <label>Edge stroke <span id="ge-wand-grow-label">0px</span></label>
        <input type="range" id="ge-wand-grow" min="-40" max="40" value="0" title="Expand (+) or contract (−) the selection before baking." />
      </div>
      <div class="ge-control-row ge-actions ge-moved-to-refine" id="ge-wand-refine-ops" style="margin-top:2px;flex-wrap:wrap;gap:var(--ge-s2,4px);" title="Refine the active selection — now in Select ▸ Refine Selection.">
        <button type="button" class="ge-btn ge-btn-sm" id="ge-wand-smooth" title="Smooth — round off jagged/staircased selection edges">Smooth</button>
        <button type="button" class="ge-btn ge-btn-sm" id="ge-wand-contrast" title="Contrast — harden the selection edge">Contrast</button>
        <button type="button" class="ge-btn ge-btn-sm" id="ge-wand-shift-in" title="Shift the selection edge inward (contract 2px)">Shift −</button>
        <button type="button" class="ge-btn ge-btn-sm" id="ge-wand-shift-out" title="Shift the selection edge outward (expand 2px)">Shift +</button>
      </div>
      <div class="ge-control-row ge-actions" style="margin-top:4px;flex-wrap:wrap;">
        <button class="ge-btn ge-btn-sm ge-mask-vis-btn visible" id="ge-wand-vis" title="Hide selection overlay" aria-label="Toggle selection overlay">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
        <button class="ge-btn ge-btn-sm ge-btn-iconlabel" id="ge-wand-clear" title="Clear the selection">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
          Clear
        </button>
        <button class="ge-btn ge-btn-sm ge-btn-iconlabel" id="ge-wand-invert" title="Invert selection (Ctrl+Alt+I)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
          Invert
        </button>
        <button class="ge-btn ge-btn-sm ge-btn-iconlabel" id="ge-wand-delete" title="Delete selected pixels from the layer">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
          Erase
        </button>
        <button class="ge-btn ge-btn-sm ge-btn-iconlabel" id="ge-wand-copy" title="Copy selection to a new layer">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Copy Layer
        </button>
        <button class="ge-btn ge-btn-sm ge-btn-iconlabel" id="ge-wand-mask" title="Add selection to the inpaint mask">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/></svg>
          To Mask
        </button>
      </div>
      <div class="ge-control-row ge-actions ge-moved-to-refine" style="margin-top:4px;gap:4px;align-items:center;">
        <select id="ge-sel-channel" title="Saved selections" style="flex:1;min-width:0;font-size:11px;background:#1c1c1f;color:#eee;border:1px solid #444;border-radius:4px;padding:2px;"><option value="">(no saved selections)</option></select>
        <button class="ge-btn ge-btn-sm" id="ge-sel-save" title="Save the current selection to a channel">Save Sel</button>
        <button class="ge-btn ge-btn-sm" id="ge-sel-load" title="Load the chosen saved selection">Load Sel</button>
      </div>
      <p style="font-size:9px;opacity:0.4;margin:4px 0 0;">Click a region to select similar pixels. Shift+click to add, Alt+click to subtract. Esc to clear.</p>
    </div>
    <div class="ge-inpaint-section" id="ge-inpaint-section" style="display:none;">
      <div class="ge-inpaint-popover-head" data-inpaint-drag>
        <div class="ge-section-title ge-section-title-with-help ge-inpaint-popover-title"><span>INPAINT</span><span class="ge-section-help" tabindex="0" role="img" aria-label="How inpaint works" title="Brush the area you want the AI to redraw — the red preview marks the mask region. Use Paint to add, Erase to subtract (or hold Ctrl+Alt to flip for one stroke). Generate fills with what your prompt describes; Remove fills with the surrounding background.">?</span></div>
        <button class="ge-inpaint-popover-close" id="ge-inpaint-popover-close" type="button" title="Close inpaint panel" aria-label="Close inpaint panel">&times;</button>
      </div>
      <div class="ge-section-title ge-section-title-with-help"><span>INPAINT</span><span class="ge-section-help" tabindex="0" role="img" aria-label="How inpaint works" title="Brush the area you want the AI to redraw — the red preview marks the mask region. Use Paint to add, Erase to subtract (or hold Ctrl+Alt to flip for one stroke). Generate fills with what your prompt describes; Remove fills with the surrounding background.">?</span></div>
      <p class="ge-section-hint" style="margin-top:0;">
        Generates or removes from the mask you have selected. Set <strong>Strength</strong> before and adjust <strong>Edge feather / stroke</strong> after.
      </p>
      <div class="ge-section-title" style="margin-top:8px;display:flex;align-items:center;gap:6px;">
        <span>Mask Brush</span>
        <input type="color" class="ge-color-picker ge-inpaint-mask-color" value="#ff6e6e" title="Mask overlay color — purely visual, the model still sees a hard mask either way." />
      </div>
      <div class="ge-control-row" style="display:flex;gap:4px;margin-bottom:4px;" title="Hold Ctrl+Alt to flip temporarily for a single stroke.">
        <button type="button" class="ge-btn ge-btn-sm ge-inpaint-mode-btn active" id="ge-inpaint-mode-paint" style="flex:1 1 0;display:inline-flex;align-items:center;justify-content:center;gap:4px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/></svg>
          Paint
        </button>
        <button type="button" class="ge-btn ge-btn-sm ge-inpaint-mode-btn" id="ge-inpaint-mode-erase" style="flex:1 1 0;display:inline-flex;align-items:center;justify-content:center;gap:4px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19.4 14.6 14.6 19.4a2 2 0 0 1-2.83 0L4.6 12.23a2 2 0 0 1 0-2.83l7.17-7.17a2 2 0 0 1 2.83 0l4.8 4.8a2 2 0 0 1 0 2.83Z"/><line x1="22" y1="21" x2="7" y2="21"/><line x1="14" y1="3" x2="9" y2="8"/></svg>
          Erase
        </button>
      </div>
      <div class="ge-control-row ge-eraser-row">
        <span class="ge-eraser-preview" id="ge-inpaint-brush-preview" aria-hidden="true"></span>
        <label>Mask Brush Size <span id="ge-inpaint-brush-label">${brushSize}px</span></label>
        <input type="range" id="ge-inpaint-brush-slider" min="0" max="1000" value="${brushSliderValue}" title="Brush diameter (log scale 1→5000px). Use [ and ] for ±10%." />
      </div>
      <div class="ge-control-row ge-actions ge-inpaint-mask-row" style="margin-top:4px;">
        <button class="ge-btn ge-btn-sm ge-btn-iconlabel ge-mask-vis-btn visible" id="ge-mask-vis" title="Hide mask">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          <span id="ge-mask-vis-label">Hide</span>
        </button>
        <button class="ge-btn ge-btn-sm ge-btn-iconlabel" id="ge-inpaint-invert" title="Invert mask">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
          Invert
        </button>
        <button class="ge-btn ge-btn-sm ge-btn-iconlabel" id="ge-inpaint-clear" title="Clear mask">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
          Clear
        </button>
      </div>
      <hr class="ge-section-divider" />
      <div class="ge-section-title" style="margin-top:8px;"><span>PROMPT</span></div>
      <input type="text" class="ge-inpaint-prompt" id="ge-inpaint-prompt" placeholder="What to fill the masked area with..." />
      <div class="ge-control-row ge-inpaint-model-row" style="margin-top:6px;">
        <label for="ge-ai-inpaint">Model</label>
        <select id="ge-ai-inpaint" class="ge-ai-model" title="Model for inpainting">
          <option value="">Auto</option>
          <option value="" disabled>──────────</option>
          <option value="__serve_cookbook__">+ Serve a model in Cookbook…</option>
        </select>
      </div>
      <div class="ge-control-row ge-eraser-row" style="margin-top:6px;">
        <span class="ge-eraser-preview" id="ge-strength-preview" aria-hidden="true"></span>
        <label>Strength <span id="ge-strength-label">0.75</span><span class="ge-section-help" tabindex="0" role="img" aria-label="Strength help" title="How much the AI redraws inside the mask. 0 = no change · 1 = full re-generation from your prompt. Recommended: 0.9–1.0 to add/replace an object, 0.6–0.8 to change material or color, 0.3–0.5 for subtle touch-ups. Default 0.75 works for most edits.">?</span></label>
        <input type="range" id="ge-strength-slider" min="10" max="100" value="75" title="How much the AI redraws inside the mask (0 = no change, 1 = full diffusion)." />
      </div>
      <div class="ge-control-row ge-actions" style="margin-top:6px;display:flex;gap:6px;align-items:center;min-width:0;">
        <button class="ge-btn ge-btn-primary ge-btn-ai" id="ge-inpaint-run" style="flex:1 1 0;display:inline-flex;align-items:center;justify-content:center;gap:6px;" title="Fill the masked area with what your prompt describes.">
          <span class="ge-btn-ai-mark" aria-hidden="true">✦</span>
          <span id="ge-inpaint-run-label">Generate</span>
        </button>
        <button class="ge-btn ge-btn-ai" id="ge-inpaint-remove" style="flex:1 1 0;display:inline-flex;align-items:center;justify-content:center;gap:6px;" title="Erase the masked content and fill with the surrounding background. Ignores your prompt.">
          <span class="ge-btn-ai-mark" aria-hidden="true">✦</span>
          <span id="ge-inpaint-remove-label">Remove</span>
        </button>
        <button class="ge-btn ge-btn-ai" id="ge-inpaint-outpaint" style="flex:1 1 0;display:inline-flex;align-items:center;justify-content:center;gap:6px;" title="Fill the empty (transparent) areas of the canvas with AI-generated content that blends with the existing image. Ignores your brush mask.">
          <span class="ge-btn-ai-mark" aria-hidden="true">✦</span>
          <span id="ge-inpaint-outpaint-label">Outpaint</span>
        </button>
      </div>
      <hr class="ge-section-divider" id="ge-inpaint-postedge-divider" style="margin-top:14px;" />
      <div class="ge-section-title ge-section-title-with-help" id="ge-inpaint-postedge-title"><span>POSTPROCESS</span><span class="ge-section-help" tabindex="0" role="img" aria-label="What this does" title="Live edge trimming for the last Inpaint Result layer. Edge feather softens the alpha boundary; Edge stroke expands (+) or contracts (−) the visible edge into the AI buffer that was generated around your brush.">?</span></div>
      <p class="ge-section-hint" id="ge-inpaint-postedge-hint" style="margin-top:0;opacity:0.45;">
        Available after Generate.
      </p>
      <div class="ge-control-row ge-eraser-row" id="ge-inpaint-postfeather-row" style="display:none;">
        <span class="ge-eraser-preview" id="ge-feather-preview" aria-hidden="true"></span>
        <label>Edge feather <span id="ge-feather-label">0px</span></label>
        <input type="range" id="ge-feather-slider" min="0" max="200" value="0" title="Blurs the inpaint result's alpha edge — drag to blend the AI fill into the surrounding image. Updates live." />
      </div>
      <div class="ge-control-row ge-eraser-row" id="ge-inpaint-edgestroke-row" style="display:none;">
        <span class="ge-eraser-preview" id="ge-edgestroke-preview" aria-hidden="true"></span>
        <label>Edge stroke <span id="ge-edgestroke-label">0px</span></label>
        <input type="range" id="ge-edgestroke-slider" min="-80" max="80" value="0" title="Expand (+) or contract (−) the inpaint layer's edge before feathering. Uses the AI buffer generated around your brush." />
      </div>
    </div>
    <div class="ge-eraser-section" id="ge-clone-section" style="display:none;">
      <div class="ge-section-title ge-section-title-with-help"><span>Clone</span><span class="ge-section-help" tabindex="0" role="img" aria-label="How clone works" title="Alt-click (desktop) or double-tap (mobile) somewhere on the canvas to set the sample source. Then drag elsewhere to clone those pixels onto the active layer. The source point moves with your brush so the offset stays constant. Size / Opacity / Flow / Softness come from the Brush panel.">?</span></div>
      <p class="ge-section-hint" style="margin-top:0;">
        <strong class="ge-clone-hint-desktop">Alt-click</strong><strong class="ge-clone-hint-mobile">Double-tap</strong> to set source · drag to paint
      </p>
      <div class="ge-control-row ge-tool-model-row">
        <label>Source</label>
        <select id="ge-clone-source" class="ge-tool-select" style="flex:1;min-width:0;" title="Clone from another part of the image, or stamp a tiled pattern.">
          <option value="layer">Layer (clone)</option>
          <option value="pattern">Pattern (stamp)</option>
        </select>
        <button type="button" class="ge-btn ge-btn-sm" id="ge-clone-pattern-btn" title="Choose the stamp pattern" style="display:none;">Pattern…</button>
      </div>
      <div class="ge-control-row ge-eraser-row">
        <span class="ge-eraser-preview" id="ge-clone-preview-opacity" aria-hidden="true"></span>
        <label>Opacity <span id="ge-clone-opacity-label">100%</span></label>
        <input type="range" id="ge-clone-opacity" min="10" max="100" value="100" />
      </div>
      <div class="ge-control-row ge-eraser-row">
        <span class="ge-eraser-preview" id="ge-clone-preview-flow" aria-hidden="true"></span>
        <label>Flow <span id="ge-clone-flow-label">100%</span></label>
        <input type="range" id="ge-clone-flow" min="5" max="100" value="100" />
      </div>
      <div class="ge-control-row ge-eraser-row">
        <span class="ge-eraser-preview" id="ge-clone-preview-softness" aria-hidden="true"></span>
        <label>Softness <span id="ge-clone-softness-label">100%</span></label>
        <input type="range" id="ge-clone-softness" min="0" max="300" value="100" title="Soft brush edge — blurs each stamp for a feathered fade." />
      </div>
    </div>
    <div class="ge-eraser-section" id="ge-brush-section" style="display:none;">
      <div class="ge-section-title">Brush</div>
      <div class="ge-control-row ge-tool-model-row">
        <label>Blend</label>
        <select id="ge-brush-blend" class="ge-tool-select" style="flex:1;min-width:0;" title="Brush blend mode — how the stroke combines with the layer (Multiply/Screen/Overlay for shading & glazing)."></select>
      </div>
      <div class="ge-control-row ge-tool-model-row">
        <label>Preset</label>
        <select id="ge-brush-preset" class="ge-tool-select" style="flex:1;min-width:0;" title="Brush preset — tip shape + pressure dynamics (pen pressure shapes size/flow)."></select>
      </div>
      <div class="ge-control-row ge-actions" style="margin-top:2px;">
        <button class="ge-btn ge-btn-sm" id="ge-brush-import" title="Import brushes exported from other paint programs (.abr, .gbr, .gih, .brush) — or any image as a brush tip">Import brush…</button>
        <input type="file" id="ge-brush-import-file" accept="image/*,.gbr,.abr,.gih,.brush" style="display:none" />
      </div>
      <div class="ge-control-row ge-tool-model-row">
        <label>Symmetry</label>
        <select id="ge-brush-symmetry" class="ge-tool-select" style="flex:1;min-width:0;" title="Mirror / radial / mandala symmetry around the canvas center">
          <option value="none">None</option>
          <option value="x">Mirror X (Vertical)</option>
          <option value="y">Mirror Y (Horizontal)</option>
          <option value="xy">Dual Axis</option>
          <option value="radial">Radial</option>
          <option value="mandala">Mandala</option>
        </select>
      </div>
      <div class="ge-control-row ge-eraser-row" id="ge-symn-row" style="display:none;">
        <label>Segments <span id="ge-brush-symn-label">6</span></label>
        <input type="range" id="ge-brush-symn" min="2" max="24" value="6" title="Number of radial/mandala segments" />
      </div>
      <div class="ge-control-row ge-eraser-row">
        <span class="ge-eraser-preview" id="ge-brush-preview-opacity" aria-hidden="true"></span>
        <label>Opacity <span id="ge-brush-opacity-label">100%</span></label>
        <input type="range" id="ge-brush-opacity" min="10" max="100" value="100" />
      </div>
      <div class="ge-control-row ge-eraser-row">
        <span class="ge-eraser-preview" id="ge-brush-preview-flow" aria-hidden="true"></span>
        <label>Flow <span id="ge-brush-flow-label">100%</span></label>
        <input type="range" id="ge-brush-flow" min="5" max="100" value="100" />
      </div>
      <div class="ge-control-row ge-eraser-row">
        <span class="ge-eraser-preview" id="ge-brush-preview-softness" aria-hidden="true"></span>
        <label>Softness <span id="ge-brush-softness-label">100%</span></label>
        <input type="range" id="ge-brush-softness" min="0" max="300" value="100" title="Soft brush edge — blurs the stroke's alpha for a feathered fade at the perimeter." />
      </div>
      <div class="ge-control-row ge-eraser-row">
        <label style="display:flex;align-items:center;gap:6px;">Smoothing <span id="ge-brush-smoothing-label">0%</span>
          <button type="button" id="ge-smoothing-gear" title="Smoothing options" style="margin-left:auto;background:none;border:none;color:inherit;cursor:pointer;opacity:0.7;padding:0;">⚙</button>
        </label>
        <input type="range" id="ge-brush-smoothing" min="0" max="95" value="0" title="Stroke stabilizer — smooths shaky lines by lagging the brush toward the cursor." />
      </div>
      <div class="ge-control-row ge-eraser-row" id="ge-smoothing-opts" style="display:none;flex-direction:column;align-items:stretch;gap:3px;font-size:11px;">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" id="ge-sm-pull"> Pulled String Mode</label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" id="ge-sm-catchup-end" checked> Catch-up on Stroke End</label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" id="ge-sm-adjust-zoom" checked> Adjust for Zoom</label>
      </div>
      <div class="ge-control-row ge-eraser-row">
        <label>Scatter <span id="ge-brush-scatter-label">0%</span></label>
        <input type="range" id="ge-brush-scatter" min="0" max="100" value="0" title="Random per-dab position jitter — scatters the brush for texture / spray." />
      </div>
      <div class="ge-control-row ge-eraser-row">
        <label>Spacing <span id="ge-brush-spacing-label">10%</span></label>
        <input type="range" id="ge-brush-spacing" min="1" max="200" value="10" title="Gap between stamped dabs as a % of brush size — low = smooth, high = dotted." />
      </div>
      <div class="ge-control-row ge-eraser-row">
        <label>Roundness <span id="ge-brush-roundness-label">100%</span></label>
        <input type="range" id="ge-brush-roundness" min="5" max="100" value="100" title="Tip roundness — lower squashes the tip into an ellipse for calligraphic strokes." />
      </div>
      <div class="ge-control-row ge-eraser-row">
        <label>Color jitter <span id="ge-brush-colorjitter-label">0%</span></label>
        <input type="range" id="ge-brush-colorjitter" min="0" max="100" value="0" title="Randomises the hue per dab for natural-media variation (foliage, texture). Greys are unaffected." />
      </div>
      <div class="ge-control-row ge-eraser-row">
        <label>Size jitter <span id="ge-brush-sizejitter-label">0%</span></label>
        <input type="range" id="ge-brush-sizejitter" min="0" max="100" value="0" title="Randomises the dab size per stamp for organic, varied strokes." />
      </div>
      <div class="ge-control-row ge-eraser-row">
        <label>Flow jitter <span id="ge-brush-flowjitter-label">0%</span></label>
        <input type="range" id="ge-brush-flowjitter" min="0" max="100" value="0" title="Randomises the per-dab flow (opacity build-up) for textured, broken strokes." />
      </div>
      <div class="ge-control-row ge-eraser-row" style="gap:6px;">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;" title="Dual brush: texture each dab with a scattered secondary tip (grainy / natural-media strokes)."><input type="checkbox" id="ge-brush-dual" /> Dual brush (texture tip)</label>
      </div>
      <div id="ge-brush-dual-opts" class="ge-eraser-row" style="display:none;flex-direction:column;align-items:stretch;gap:4px;padding-left:8px;border-left:2px solid rgba(255,255,255,0.08);">
        <div class="ge-control-row" style="gap:6px;">
          <label style="min-width:64px;">Tip</label>
          <select id="ge-brush-dual-tip" title="Shape of the secondary (texturing) tip.">
            <option value="round">Round</option>
            <option value="soft">Soft</option>
            <option value="gaussian">Gaussian</option>
          </select>
        </div>
        <div class="ge-control-row">
          <label>Size <span id="ge-brush-dual-scale-label">35%</span></label>
          <input type="range" id="ge-brush-dual-scale" min="5" max="100" value="35" title="Secondary tip size as a fraction of the brush dab." />
        </div>
        <div class="ge-control-row">
          <label>Count <span id="ge-brush-dual-count-label">6</span></label>
          <input type="range" id="ge-brush-dual-count" min="1" max="24" value="6" title="How many secondary stamps texture each dab — higher = denser grain." />
        </div>
        <div class="ge-control-row">
          <label>Scatter <span id="ge-brush-dual-scatter-label">80%</span></label>
          <input type="range" id="ge-brush-dual-scatter" min="0" max="100" value="80" title="How far the secondary stamps spread across the dab." />
        </div>
      </div>
      <div class="ge-control-row ge-eraser-row" style="gap:6px;">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" id="ge-brush-angle-follow" /> Tip follows stroke direction</label>
      </div>
      <div class="ge-control-row ge-eraser-row" style="gap:6px;">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;" title="Rotate the tip toward the pen's tilt direction (needs a tilt-capable stylus)."><input type="checkbox" id="ge-brush-tilt-angle" /> Tip follows pen tilt</label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;" title="Pen tilt grows the brush — a flatter pen lays a broader stroke (needs a tilt-capable stylus)."><input type="checkbox" id="ge-brush-tilt-size" /> Tilt affects size</label>
      </div>
      <div class="ge-control-row ge-eraser-row" style="gap:6px;">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;" title="Pen pressure controls opacity — a light touch paints more transparent (needs a pressure pen)."><input type="checkbox" id="ge-brush-pressure-opacity" checked /> Pressure → Opacity</label>
      </div>
      <div class="ge-control-row ge-eraser-row" style="gap:6px;">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;" title="Airbrush / build-up: paint keeps accumulating while you hold the cursor still (Alt+Shift+P)."><input type="checkbox" id="ge-brush-airbrush" /> Airbrush (build up while held)</label>
      </div>
      <div class="ge-control-row ge-eraser-row">
        <label>Velocity taper <span id="ge-brush-velocity-label">0%</span></label>
        <input type="range" id="ge-brush-velocity" min="0" max="100" value="0" title="Fast strokes paint thinner (speed sensor). 0 = off." />
      </div>
      <div class="ge-control-row ge-eraser-row" style="flex-direction:column;align-items:stretch;gap:4px;">
        <label>Pressure response</label>
        <div id="ge-pressure-curve-host"></div>
      </div>
      <div class="ge-control-row ge-eraser-row" style="flex-direction:column;align-items:stretch;gap:4px;">
        <label>Preview <span style="opacity:0.5;font-weight:normal;">— drag to test</span></label>
        <div id="ge-brush-preview-host"></div>
      </div>
    </div>
    <div class="ge-eraser-section" id="ge-eraser-section" style="display:none;">
      <div class="ge-section-title">Eraser</div>
      <div class="ge-control-row ge-eraser-row">
        <span class="ge-eraser-preview" id="ge-eraser-preview-opacity" aria-hidden="true"></span>
        <label>Opacity <span id="ge-eraser-opacity-label">100%</span></label>
        <input type="range" id="ge-eraser-opacity" min="10" max="100" value="100" />
      </div>
      <div class="ge-control-row ge-eraser-row">
        <span class="ge-eraser-preview" id="ge-eraser-preview-flow" aria-hidden="true"></span>
        <label>Flow <span id="ge-eraser-flow-label">100%</span></label>
        <input type="range" id="ge-eraser-flow" min="5" max="100" value="100" />
      </div>
      <div class="ge-control-row ge-eraser-row">
        <span class="ge-eraser-preview" id="ge-eraser-preview-softness" aria-hidden="true"></span>
        <label>Softness <span id="ge-eraser-softness-label">100%</span></label>
        <input type="range" id="ge-eraser-softness" min="0" max="300" value="100" title="Soft brush edge — blurs the stroke's alpha so the eraser fades out at the perimeter." />
      </div>
    </div>
    <div class="ge-sharpen-section" id="ge-sharpen-section" style="display:none;">
      <div class="ge-control-row ge-eraser-row">
        <span class="ge-eraser-preview" id="ge-sharpen-preview" aria-hidden="true"></span>
        <label>Amount <span id="ge-sharpen-label">50%</span></label>
        <input type="range" id="ge-sharpen-amount" min="10" max="100" value="50" />
      </div>
      <div class="ge-control-row ge-actions" style="margin-top:4px;">
        <button class="ge-btn ge-btn-primary" id="ge-sharpen-run">Sharpen</button>
      </div>
    </div>
    <div class="ge-rembg-section" id="ge-rembg-section" style="display:none;">
      <div class="ge-section-title ge-section-title-with-help"><span>Background Remove</span><span class="ge-section-help" tabindex="0" role="img" aria-label="What this does" title="Runs an ML model that keeps whatever it learned to call the foreground (usually a person, product, or animal). If you have a Lasso or Wand selection active, it's used as a hint — the model only looks inside that region and anything outside is forced transparent.">?</span></div>
      <div class="ge-dep-notice" id="ge-rembg-dep-missing" style="display:none;">
        <div class="ge-dep-notice-text">
          <strong>rembg not installed.</strong>
          Background Remove needs the <code>rembg</code> package on this
          server. Click to install it from Cookbook → Dependencies.
        </div>
        <button type="button" class="ge-btn ge-btn-sm" id="ge-rembg-install-link">Install rembg</button>
      </div>
      <div class="ge-control-row ge-actions" id="ge-rembg-run-row">
        <button class="ge-btn ge-btn-primary ge-btn-ai" id="ge-rembg-run">
          <span class="ge-btn-ai-mark" aria-hidden="true">✦</span>
          Bg Remove
        </button>
      </div>
      <hr class="ge-section-divider" />
      <div class="ge-section-title ge-section-title-with-help"><span>Edge cleanup</span><span class="ge-section-help" tabindex="0" role="img" aria-label="What this does" title="Live-applied to the last Bg Removed layer. Feather softens the edge; Edge nudges it inward (−) or outward (+).">?</span></div>
      <div class="ge-control-row ge-eraser-row">
        <span class="ge-eraser-preview" id="ge-rembg-feather-preview" aria-hidden="true"></span>
        <label>Feather <span id="ge-rembg-feather-label">0px</span></label>
        <input type="range" id="ge-rembg-feather" min="0" max="20" value="0" />
      </div>
      <div class="ge-control-row ge-eraser-row">
        <span class="ge-eraser-preview" id="ge-rembg-grow-preview" aria-hidden="true"></span>
        <label>Edge <span id="ge-rembg-grow-label">0px</span></label>
        <input type="range" id="ge-rembg-grow" min="-10" max="10" value="0" />
      </div>
    </div>
    <div class="ge-import-section" id="ge-import-section" style="display:none;">
      <p style="font-size:10px;opacity:0.5;margin:0 0 6px;">Import an image as a new layer. Drag to position it.</p>
      <div class="ge-control-row ge-actions">
        <button class="ge-btn" id="ge-import-file">File</button>
        <button class="ge-btn" id="ge-import-paste">Clipboard</button>
        <button class="ge-btn" id="ge-import-gallery">Gallery</button>
      </div>
    </div>
    <div class="ge-harmonize-section" id="ge-harmonize-section" style="display:none;">
      <div class="ge-section-title">Harmonize <span class="ge-section-help" tabindex="0" role="img" title="Blends pasted layers into the base photo. Color match shifts the layer's lighting/tone to match its surroundings (no pixel redraw). Seam fix uses inpaint to clean jagged cutout edges (needs a self-hosted img2img/inpaint model).">?</span></div>
      <div class="ge-control-row ge-tool-model-row">
        <label>Model</label>
        <select class="ge-tool-model" data-ge-tool-model="harmonize" title="Model for harmonize">
          <option value="">Auto</option>
        </select>
      </div>
      <div class="ge-control-row">
        <label style="font-size:11px;opacity:0.6;">Prompt (only used if Seam fix &gt; 0)</label>
      </div>
      <input type="text" class="ge-inpaint-prompt" id="ge-harmonize-prompt" placeholder="photorealistic, natural lighting, seamless blend..." />
      <div class="ge-control-row ge-eraser-row">
        <span class="ge-eraser-preview" id="ge-harmonize-color-preview" aria-hidden="true"></span>
        <label>Color match <span id="ge-harmonize-color-label">0.65</span></label>
        <input type="range" id="ge-harmonize-color" min="0" max="100" value="65" title="How much of the Reinhard color/luminance shift to apply. 0 = no shift, 1 = fully match surroundings." />
      </div>
      <div class="ge-control-row ge-eraser-row">
        <span class="ge-eraser-preview" id="ge-harmonize-seam-preview" aria-hidden="true"></span>
        <label>Seam fix <span id="ge-harmonize-seam-label">0.00</span></label>
        <input type="range" id="ge-harmonize-seam" min="0" max="100" value="0" title="Strength of the narrow inpaint pass on the alpha edge band. 0 = off, 1 = max blend at boundary." />
      </div>
      <div class="ge-control-row ge-actions" style="margin-top:4px;">
        <button class="ge-btn ge-btn-primary" id="ge-harmonize-run">Harmonize</button>
      </div>
    </div>
    <div class="ge-style-section" id="ge-style-section" style="display:none;">
      <p style="font-size:10px;opacity:0.5;margin:0 0 6px;">Apply an art style to the image using img2img. Requires a running diffusion model.</p>
      <div class="ge-control-row ge-tool-model-row">
        <label>Model</label>
        <select class="ge-tool-model" data-ge-tool-model="style" title="Model for Style transfer">
          <option value="">Auto</option>
        </select>
      </div>
      <div class="ge-control-row">
        <label style="font-size:11px;opacity:0.6;">Style prompt</label>
      </div>
      <input type="text" class="ge-inpaint-prompt" id="ge-style-prompt" placeholder="oil painting, impressionist, Van Gogh..." />
      <div class="ge-control-row">
        <label style="font-size:11px;opacity:0.6;">Strength <span id="ge-style-strength-label">0.55</span></label>
        <input type="range" id="ge-style-strength" min="10" max="90" value="55" style="flex:1;" />
      </div>
      <div class="ge-control-row ge-actions" style="margin-top:4px;">
        <button class="ge-btn ge-btn-primary" id="ge-style-run">Apply Style</button>
      </div>
    </div>
    <div class="ge-filter-section" id="ge-filter-section" style="display:none;">
      <div class="ge-section-title">Filters</div>
      <div class="ge-control-row ge-tool-model-row">
        <label>Filter</label>
        <select id="ge-filter-type" class="ge-tool-select" style="flex:1;min-width:0;" title="Filter to apply to the active layer"></select>
      </div>
      <div class="ge-control-row ge-eraser-row" id="ge-filter-amount-row">
        <label>Amount <span id="ge-filter-amount-label">50</span></label>
        <input type="range" id="ge-filter-amount" min="0" max="100" value="50" />
      </div>
      <div class="ge-control-row ge-actions" style="margin-top:4px;">
        <button class="ge-btn ge-btn-primary" id="ge-filter-apply">Apply</button>
        <button class="ge-btn ge-btn-sm" id="ge-filter-reset">Reset</button>
      </div>
      <p style="font-size:10px;opacity:0.5;margin:2px 0 0;">Live preview on the active layer — Apply to bake, Reset to revert.</p>
    </div>
    <div class="ge-liquify-section" id="ge-liquify-section" style="display:none;">
      <div class="ge-section-title">Liquify</div>
      <div class="ge-control-row ge-eraser-row">
        <label>Strength <span id="ge-liquify-strength-label">50%</span></label>
        <input type="range" id="ge-liquify-strength" min="1" max="100" value="50" title="How hard the drag pushes pixels." />
      </div>
      <p style="font-size:10px;opacity:0.5;margin:2px 0 0;">Drag to push/warp pixels (Brush Size = radius). Great for nudging poses.</p>
    </div>
    <div class="ge-smudge-section" id="ge-smudge-section" style="display:none;">
      <div class="ge-section-title">Smudge</div>
      <div class="ge-control-row ge-eraser-row">
        <label>Strength <span id="ge-smudge-strength-label">60%</span></label>
        <input type="range" id="ge-smudge-strength" min="1" max="100" value="60" title="How far paint smears — higher carries colour longer along the stroke." />
      </div>
      <label class="ge-control-row" style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer;">
        <input type="checkbox" id="ge-smudge-finger">
        <span>Finger painting (drag foreground colour)</span>
      </label>
      <p style="font-size:10px;opacity:0.5;margin:2px 0 0;">Drag to smear paint like a finger (Brush Size = radius; pen pressure smears further, brush softness shapes the edge). Blends colours and edges.</p>
    </div>
    <div class="ge-mixer-section" id="ge-mixer-section" style="display:none;">
      <div class="ge-section-title">Mixer Brush</div>
      <div class="ge-control-row ge-eraser-row">
        <label>Wet <span id="ge-mixer-wet-label">50%</span></label>
        <input type="range" id="ge-mixer-wet" min="0" max="100" value="50" title="How fast the loaded colour picks up the canvas it's dragged over — higher = more blending along the stroke." />
      </div>
      <div class="ge-control-row ge-eraser-row">
        <label>Mix <span id="ge-mixer-mix-label">50%</span></label>
        <input type="range" id="ge-mixer-mix" min="0" max="100" value="50" title="Deposited colour: 100% = all canvas (pure smear), 0% = all loaded paint." />
      </div>
      <div class="ge-control-row ge-eraser-row">
        <label>Flow <span id="ge-mixer-flow-label">80%</span></label>
        <input type="range" id="ge-mixer-flow" min="1" max="100" value="80" title="How much paint each dab lays down." />
      </div>
      <p style="font-size:10px;opacity:0.5;margin:2px 0 0;">Wet-paint blending: loads the foreground colour and mixes it into the canvas as you drag (Brush Size = radius). Try Wet+Mix ~50% for natural-media mixing.</p>
    </div>
    <div class="ge-text-section" id="ge-text-section" style="display:none;">
      <div class="ge-section-title">Type</div>
      <div class="ge-control-row ge-eraser-row">
        <label>Size <span id="ge-text-size-label">48</span></label>
        <input type="range" id="ge-text-size" min="8" max="200" value="48" title="Text size in pixels." />
      </div>
      <div class="ge-control-row ge-eraser-row">
        <label>Leading <span id="ge-text-leading-label">1.25</span></label>
        <input type="range" id="ge-text-leading" min="0.8" max="3" step="0.05" value="1.25" title="Line height (leading)." />
      </div>
      <div class="ge-control-row ge-eraser-row">
        <label>Tracking <span id="ge-text-tracking-label">0</span></label>
        <input type="range" id="ge-text-tracking" min="-5" max="40" step="1" value="0" title="Letter spacing (tracking), in pixels." />
      </div>
      <div class="ge-control-row ge-tool-model-row">
        <label>Font</label>
        <select id="ge-text-font" class="ge-tool-select" style="flex:1;min-width:0;">
          <option value="sans-serif">Sans</option>
          <option value="serif">Serif</option>
          <option value="monospace">Mono</option>
          <option value="Arial, sans-serif">Arial</option>
          <option value="Helvetica, Arial, sans-serif">Helvetica</option>
          <option value="'Times New Roman', serif">Times</option>
          <option value="Georgia, serif">Georgia</option>
          <option value="'Courier New', monospace">Courier</option>
          <option value="Verdana, sans-serif">Verdana</option>
          <option value="'Trebuchet MS', sans-serif">Trebuchet</option>
          <option value="Tahoma, sans-serif">Tahoma</option>
          <option value="Impact, sans-serif">Impact</option>
        </select>
      </div>
      <div class="ge-control-row" style="gap:4px;align-items:center;">
        <button id="ge-text-bold" class="ge-text-style-btn" title="Bold" style="font-weight:bold;">B</button>
        <button id="ge-text-italic" class="ge-text-style-btn" title="Italic" style="font-style:italic;">I</button>
        <span style="flex:1;"></span>
        <button id="ge-text-align-left" class="ge-text-style-btn active" title="Align left">&#8676;</button>
        <button id="ge-text-align-center" class="ge-text-style-btn" title="Align center">&#8596;</button>
        <button id="ge-text-align-right" class="ge-text-style-btn" title="Align right">&#8677;</button>
      </div>
      <p style="font-size:10px;opacity:0.5;margin:2px 0 0;">Click to add text; double-click a text layer to re-edit. Ctrl+Enter or click away to commit.</p>
    </div>
    <div class="ge-dodgeburn-section" id="ge-dodgeburn-section" style="display:none;">
      <div class="ge-section-title">Dodge / Burn</div>
      <div class="ge-control-row ge-tool-model-row">
        <label>Mode</label>
        <select id="ge-dodgeburn-mode" class="ge-tool-select" style="flex:1;min-width:0;" title="What the brush does as you paint">
          <option value="dodge">Dodge (lighten)</option>
          <option value="burn">Burn (darken)</option>
          <option value="desaturate">Sponge — Desaturate</option>
          <option value="saturate">Sponge — Saturate</option>
        </select>
      </div>
      <div class="ge-control-row ge-eraser-row">
        <label>Strength <span id="ge-dodgeburn-strength-label">50%</span></label>
        <input type="range" id="ge-dodgeburn-strength" min="1" max="100" value="50" title="How strongly each pass lightens/darkens/shifts saturation." />
      </div>
      <p style="font-size:10px;opacity:0.5;margin:2px 0 0;">Drag to paint tone (Brush Size = radius). Builds up as you scrub — affects existing pixels only.</p>
    </div>
    <div class="ge-bucket-section" id="ge-bucket-section" style="display:none;">
      <div class="ge-section-title">Paint Bucket</div>
      <div class="ge-control-row ge-eraser-row">
        <label>Tolerance <span id="ge-bucket-tolerance-label">30</span></label>
        <input type="range" id="ge-bucket-tolerance" min="0" max="100" value="30" title="How similar neighbouring pixels must be to get filled — higher fills across more colour variation." />
      </div>
      <p style="font-size:10px;opacity:0.5;margin:2px 0 0;">Click to flood-fill the area under the cursor with the foreground colour.</p>
    </div>
    <div class="ge-gradient-section" id="ge-gradient-section" style="display:none;">
      <div class="ge-section-title">Gradient</div>
      <div class="ge-control-row" style="display:flex;gap:4px;">
        <button type="button" class="ge-btn ge-btn-sm ge-grad-type active" data-grad-type="linear">Linear</button>
        <button type="button" class="ge-btn ge-btn-sm ge-grad-type" data-grad-type="radial">Radial</button>
      </div>
      <div class="ge-control-row" style="display:flex;gap:4px;">
        <button type="button" class="ge-btn ge-btn-sm ge-grad-mode active" data-grad-mode="fg-bg">FG → BG</button>
        <button type="button" class="ge-btn ge-btn-sm ge-grad-mode" data-grad-mode="fg-transparent">FG → Transp.</button>
      </div>
      <div class="ge-control-row ge-eraser-row">
        <label>Opacity <span id="ge-grad-opacity-label">100%</span></label>
        <input type="range" id="ge-grad-opacity" min="0" max="100" value="100" />
      </div>
      <div class="ge-control-row" style="flex-direction:column;align-items:stretch;gap:2px;">
        <label style="opacity:0.7;">Gradient — double-click bar to add a stop</label>
        <div id="ge-gradient-editor-host"></div>
      </div>
      <p style="font-size:10px;opacity:0.5;margin:2px 0 0;">Drag on the canvas to draw the gradient. The editor's stops/colours/alpha override FG→BG once used.</p>
    </div>
    <details class="ge-histogram-section ge-dock-section" id="ge-histogram-section">
      <summary class="ge-section-title" style="cursor:pointer;list-style:revert;">Histogram</summary>
      <canvas id="ge-histogram-canvas" width="256" height="80" style="display:block;width:100%;height:64px;border-radius:4px;background:rgba(0,0,0,0.25);margin-top:4px;"></canvas>
      <p style="font-size:10px;opacity:0.5;margin:4px 0 0;">Luminance distribution of the active layer (live).</p>
    </details>
    <details class="ge-navigator-section ge-dock-section" id="ge-navigator-section">
      <summary class="ge-section-title" style="cursor:pointer;list-style:revert;">Navigator</summary>
      <div id="ge-navigator-host" style="margin-top:4px;"></div>
    </details>
    <details class="ge-reference-section ge-dock-section" id="ge-reference-section">
      <summary class="ge-section-title" style="cursor:pointer;list-style:revert;">Reference image</summary>
      <div class="ge-control-row ge-actions" style="margin-top:4px;gap:4px;">
        <button class="ge-btn ge-btn-sm" id="ge-ref-load">Load…</button>
        <button class="ge-btn ge-btn-sm" id="ge-ref-flip" title="Flip horizontally">⇄ Flip</button>
        <button class="ge-btn ge-btn-sm" id="ge-ref-clear" title="Remove reference">Clear</button>
        <input type="file" id="ge-ref-file" accept="image/*" style="display:none" />
      </div>
      <div class="ge-control-row ge-eraser-row">
        <label>Opacity <span id="ge-ref-opacity-label">100%</span></label>
        <input type="range" id="ge-ref-opacity" min="10" max="100" value="100" />
      </div>
      <div id="ge-ref-wrap" style="display:none;margin-top:4px;">
        <img id="ge-ref-img" alt="reference" style="max-width:100%;display:block;border-radius:4px;transform-origin:center;" />
      </div>
      <p style="font-size:10px;opacity:0.5;margin:4px 0 0;">A reference to paint from — display only, never part of the artwork.</p>
    </details>
  `;
}


/**
 * Layer-panel header markup. Static; static IDs are wired by the caller.
 * @returns {string}
 */
export function layerPanelHTML() {
  // Single uniform action bar acting on the ACTIVE layer, on its own row UNDER
  // the title (PS layers-panel footer parity). One consistent icon size (24px
  // button / 14px glyph); wraps to a second line rather than clipping at 280px.
  // IDs are preserved where existing wiring depends on them
  // (ge-add-layer / ge-layer-mask / ge-layer-fx / ge-group-layer / ge-del-layer /
  // ge-merge-down / ge-merge-all / ge-flatten); duplicate/clip/lock-alpha get
  // new IDs wired in layer-panel.js (wireHeaderProps) onto the active layer.
  const ICON = (id, title, danger, svg) =>
    `<button type="button" class="ge-action-btn${danger ? ' danger' : ''}" id="${id}" title="${title}" aria-label="${title}">${svg}</button>`;
  return `<div class="ge-layers-header">
      <span class="ge-layers-grab"></span>
      <span class="ge-layers-title">Layers</span>
    </div>
    <div class="ge-layers-actions-row" role="toolbar" aria-label="Layer actions" title="Actions on the active layer">
      ${ICON('ge-add-layer', 'New layer (Ctrl+Alt+J)', false, '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>')}
      ${ICON('ge-dup-layer', 'Duplicate layer', false, '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>')}
      ${ICON('ge-group-layer', 'Group into folder (Ctrl+G)', false, '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>')}
      <span class="ge-actions-divider" aria-hidden="true"></span>
      ${ICON('ge-layer-mask', 'Add / edit layer mask (paint to reveal, erase to hide)', false, '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/></svg>')}
      ${ICON('ge-layer-fx', 'Blending Options — layer effects (stroke / drop shadow / glow / overlay)', false, '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></svg>')}
      ${ICON('ge-clip-layer', 'Clip to layer below (Ctrl+Alt+G)', false, '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v11a3 3 0 0 0 3 3h7"/><path d="M4 7h11a3 3 0 0 1 3 3v7"/></svg>')}
      ${ICON('ge-lockalpha-layer', 'Lock transparency — paint existing pixels only (/)', false, '<svg width="14" height="14" viewBox="0 0 12 12"><rect x="0.5" y="0.5" width="11" height="11" rx="1" fill="none" stroke="currentColor"/><rect x="1" y="1" width="5" height="5" fill="currentColor"/><rect x="6" y="6" width="5" height="5" fill="currentColor"/></svg>')}
      ${ICON('ge-lock-layer', 'Lock layer — block all edits (pixels, position, properties)', false, '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>')}
      <span class="ge-actions-divider" aria-hidden="true"></span>
      ${ICON('ge-merge-down', 'Merge down', false, '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="6 13 12 19 18 13"/></svg>')}
      ${ICON('ge-merge-all', 'Merge all', false, '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v6M9 6l3-3 3 3M3 14h18M12 14v7M9 18l3 3 3-3"/></svg>')}
      ${ICON('ge-flatten', 'Flatten copy (keeps originals)', false, '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 L4 6 L4 18 L12 22 L20 18 L20 6 Z"/><path d="M12 2 L12 22"/><path d="M4 6 L20 6"/><path d="M4 18 L20 18"/></svg>')}
      <span class="ge-actions-spacer" aria-hidden="true"></span>
      ${ICON('ge-del-layer', 'Delete layer', true, '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>')}
    </div>
    <div class="ge-layers-props" title="Blend mode + opacity of the active layer">
      <select id="ge-active-blend" class="ge-active-blend" title="Blend mode"></select>
      <button type="button" id="ge-active-opacity-chip" class="ge-opacity-chip" aria-haspopup="true" aria-expanded="false" title="Layer opacity — click for a wide slider">
        <span class="ge-active-op-label">Opacity</span>
        <span id="ge-active-opacity-val" class="ge-active-op-val">100%</span>
        <svg class="ge-opacity-caret" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div id="ge-opacity-pop" class="ge-opacity-pop" hidden>
        <input id="ge-active-opacity" class="ge-layer-opacity ge-active-opacity" type="range" min="0" max="100" value="100" title="Opacity" aria-label="Layer opacity">
      </div>
    </div>
    <div class="ge-layers-list" id="ge-layers-list"></div>`;
}
