/**
 * Lab (CIELAB) Color Picker UI — L / a / b sliders + hex field + current-color
 * chip. Like the OK Color picker, it drives the canonical foreground colour input
 * so every existing wiring (state, swatch, recent strip, brush) updates unchanged.
 * Reuses the .ge-ok-* styles for a consistent look.
 *
 * L: 0..100 (lightness) · a: -128..127 (green↔red) · b: -128..127 (blue↔yellow).
 */
import { labToHex, hexToLab } from './lab-color.js';

export function wireLabPicker() {
  const host = document.getElementById('ge-labpicker');
  const fg = document.querySelector('.ge-fg-color') || document.querySelector('.ge-color-picker');
  if (!host || !fg) return;

  host.innerHTML = `
    <div class="ge-ok-top">
      <span class="ge-ok-chip" id="ge-lab-chip"></span>
      <input type="text" class="ge-ok-hex" id="ge-lab-hex" spellcheck="false" maxlength="7" />
    </div>
    <div class="ge-ok-row"><span class="ge-ok-lbl">L</span><div class="ge-ok-track"><input type="range" class="ge-ok-slider" id="ge-lab-l" min="0" max="100" step="1"></div><span class="ge-ok-val" id="ge-lab-lv">0</span></div>
    <div class="ge-ok-row"><span class="ge-ok-lbl">a</span><div class="ge-ok-track"><input type="range" class="ge-ok-slider" id="ge-lab-a" min="-128" max="127" step="1"></div><span class="ge-ok-val" id="ge-lab-av">0</span></div>
    <div class="ge-ok-row"><span class="ge-ok-lbl">b</span><div class="ge-ok-track"><input type="range" class="ge-ok-slider" id="ge-lab-b" min="-128" max="127" step="1"></div><span class="ge-ok-val" id="ge-lab-bv">0</span></div>`;

  const $ = (id) => document.getElementById(id);
  const lS = $('ge-lab-l'), aS = $('ge-lab-a'), bS = $('ge-lab-b');
  const lv = $('ge-lab-lv'), av = $('ge-lab-av'), bv = $('ge-lab-bv');
  const chip = $('ge-lab-chip'), hex = $('ge-lab-hex');
  let suppress = false; // guard the fg<->slider feedback loop

  function setFromLab(L, a, b, pushToFg) {
    lS.value = String(Math.round(L)); aS.value = String(Math.round(a)); bS.value = String(Math.round(b));
    lv.textContent = String(Math.round(L)); av.textContent = String(Math.round(a)); bv.textContent = String(Math.round(b));
    const hexv = labToHex(L, a, b);
    chip.style.background = hexv;
    if (document.activeElement !== hex) hex.value = hexv;
    if (pushToFg) {
      suppress = true;
      fg.value = hexv;
      fg.dispatchEvent(new Event('input', { bubbles: true }));
      suppress = false;
    }
  }

  const onSlide = () => setFromLab(+lS.value, +aS.value, +bS.value, true);
  lS.addEventListener('input', onSlide);
  aS.addEventListener('input', onSlide);
  bS.addEventListener('input', onSlide);

  hex.addEventListener('change', () => {
    const v = hex.value.trim();
    if (!/^#?[0-9a-f]{6}$/i.test(v)) { syncFromFg(); return; }
    const { L, a, b } = hexToLab(v);
    setFromLab(L, a, b, true);
    hex.value = labToHex(L, a, b); // normalize the just-committed value
  });

  function syncFromFg() {
    if (suppress) return;
    const { L, a, b } = hexToLab(fg.value || '#000000');
    setFromLab(L, a, b, false);
  }
  fg.addEventListener('input', syncFromFg);
  syncFromFg(); // initial
}
