/**
 * Gradient tool controls — toggles for type (linear/radial) and mode
 * (FG→BG / FG→Transparent) plus the opacity label. The active button in each
 * group is read at fill time by editor/tools/gradient.js.
 */
import { state } from './state.js';

export function wireGradientControls() {
  for (const cls of ['ge-grad-type', 'ge-grad-mode']) {
    const btns = document.querySelectorAll('.' + cls);
    btns.forEach((btn) => {
      btn.addEventListener('click', () => {
        btns.forEach((b) => b.classList.toggle('active', b === btn));
        // The type group is the canonical control for `state.gradientType`,
        // which gradient.js reads first (state wins over the .active button).
        // Without this write the side-panel Linear/Radial buttons are dead.
        if (cls === 'ge-grad-type' && btn.dataset.gradType) {
          state.gradientType = btn.dataset.gradType;
          const sel = document.querySelector('.ge-grad-type-select');
          if (sel) sel.value = btn.dataset.gradType;
        }
      });
    });
  }
  const op = document.getElementById('ge-grad-opacity');
  op?.addEventListener('input', () => {
    const lbl = document.getElementById('ge-grad-opacity-label');
    if (lbl) lbl.textContent = op.value + '%';
  });
}
