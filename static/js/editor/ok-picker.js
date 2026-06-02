/**
 * OK Color Picker UI — perceptually-uniform color selection (OKhsl). Hue /
 * Saturation / Lightness sliders whose TRACK is the live gradient of that
 * channel (sleek — the gradient IS the control), plus a hex field and a
 * current-color chip. Drives the canonical foreground colour input so every
 * existing wiring (state, picker swatch, recent strip) updates unchanged.
 *
 * Also wires the Color-panel tab bar (OK Color / Swatches).
 */
import { okhslToHex, hexToOkhsl } from './ok-color.js';

export function wireOkPicker() {
  const host = document.getElementById('ge-okpicker');
  const fg = document.querySelector('.ge-fg-color') || document.querySelector('.ge-color-picker');
  if (!host || !fg) return;

  host.innerHTML = `
    <div class="ge-ok-top">
      <span class="ge-ok-chip" id="ge-ok-chip"></span>
      <input type="text" class="ge-ok-hex" id="ge-ok-hex" spellcheck="false" maxlength="7" />
    </div>
    <div class="ge-ok-row"><span class="ge-ok-lbl">H</span><div class="ge-ok-track" id="ge-ok-htrack"><input type="range" class="ge-ok-slider" id="ge-ok-h" min="0" max="360" step="1"></div><span class="ge-ok-val" id="ge-ok-hv">0°</span></div>
    <div class="ge-ok-row"><span class="ge-ok-lbl">S</span><div class="ge-ok-track" id="ge-ok-strack"><input type="range" class="ge-ok-slider" id="ge-ok-s" min="0" max="100" step="1"></div><span class="ge-ok-val" id="ge-ok-sv">0%</span></div>
    <div class="ge-ok-row"><span class="ge-ok-lbl">L</span><div class="ge-ok-track" id="ge-ok-ltrack"><input type="range" class="ge-ok-slider" id="ge-ok-l" min="0" max="100" step="1"></div><span class="ge-ok-val" id="ge-ok-lv">0%</span></div>`;

  const $ = (id) => document.getElementById(id);
  const hS = $('ge-ok-h'), sS = $('ge-ok-s'), lS = $('ge-ok-l');
  const hv = $('ge-ok-hv'), sv = $('ge-ok-sv'), lv = $('ge-ok-lv');
  const chip = $('ge-ok-chip'), hex = $('ge-ok-hex');
  let suppress = false; // guard the fg<->slider feedback loop

  const grad = (stops) => `linear-gradient(90deg, ${stops.join(',')})`;
  function paintTracks(h, s, l) {
    const hue = []; for (let i = 0; i <= 12; i++) hue.push(okhslToHex((i / 12) * 360, Math.max(0.4, s), l));
    $('ge-ok-htrack').style.background = grad(hue);
    const sat = []; for (let i = 0; i <= 8; i++) sat.push(okhslToHex(h, i / 8, l));
    $('ge-ok-strack').style.background = grad(sat);
    const lig = []; for (let i = 0; i <= 8; i++) lig.push(okhslToHex(h, s, i / 8));
    $('ge-ok-ltrack').style.background = grad(lig);
  }

  function setFromHsl(h, s, l, pushToFg) {
    hS.value = String(Math.round(h));
    sS.value = String(Math.round(s * 100));
    lS.value = String(Math.round(l * 100));
    hv.textContent = Math.round(h) + '°';
    sv.textContent = Math.round(s * 100) + '%';
    lv.textContent = Math.round(l * 100) + '%';
    const hexv = okhslToHex(h, s, l);
    chip.style.background = hexv;
    if (document.activeElement !== hex) hex.value = hexv;
    paintTracks(h, s, l);
    if (pushToFg) {
      suppress = true;
      fg.value = hexv;
      fg.dispatchEvent(new Event('input', { bubbles: true }));
      suppress = false;
    }
  }

  const readSliders = () => ({ h: +hS.value, s: +sS.value / 100, l: +lS.value / 100 });
  const onSlide = () => { const { h, s, l } = readSliders(); setFromHsl(h, s, l, true); };
  hS.addEventListener('input', onSlide);
  sS.addEventListener('input', onSlide);
  lS.addEventListener('input', onSlide);

  hex.addEventListener('change', () => {
    const v = hex.value.trim();
    if (!/^#?[0-9a-f]{6}$/i.test(v)) { syncFromFg(); return; }
    const { h, s, l } = hexToOkhsl(v);
    setFromHsl(h, s, l, true);
  });

  function syncFromFg() {
    if (suppress) return;
    const v = (fg.value || '#000000');
    const { h, s, l } = hexToOkhsl(v);
    setFromHsl(h, s, l, false);
  }
  fg.addEventListener('input', syncFromFg);
  syncFromFg(); // initial

  // ── Color-panel tabs (OK Color / Swatches) ──
  const tabs = document.querySelectorAll('.ge-color-tab');
  tabs.forEach((t) => t.addEventListener('click', () => {
    const which = t.dataset.ctab;
    tabs.forEach((x) => x.classList.toggle('active', x === t));
    document.querySelectorAll('.ge-color-pane').forEach((p) => {
      p.style.display = p.dataset.cpane === which ? '' : 'none';
    });
  }));
}
