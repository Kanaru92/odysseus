/**
 * Gradient tool controls — toggles for type (linear/radial) and mode
 * (FG→BG / FG→Transparent) plus the opacity label. The active button in each
 * group is read at fill time by editor/tools/gradient.js.
 */
export function wireGradientControls() {
  for (const cls of ['ge-grad-type', 'ge-grad-mode']) {
    const btns = document.querySelectorAll('.' + cls);
    btns.forEach((btn) => {
      btn.addEventListener('click', () => {
        btns.forEach((b) => b.classList.toggle('active', b === btn));
      });
    });
  }
  const op = document.getElementById('ge-grad-opacity');
  op?.addEventListener('input', () => {
    const lbl = document.getElementById('ge-grad-opacity-label');
    if (lbl) lbl.textContent = op.value + '%';
  });
}
