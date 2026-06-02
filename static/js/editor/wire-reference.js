/**
 * Reference image panel — load an image to paint from, shown in the right
 * panel (a Krita-style reference docker). Display-only: it never touches the
 * canvas, layers, or composite, so it has zero rendering blast radius. Supports
 * dim (opacity), horizontal flip (artists flip references to spot errors), and
 * clear. Self-contained DOM wiring.
 */
export function wireReference() {
  const load = document.getElementById('ge-ref-load');
  const file = document.getElementById('ge-ref-file');
  const img = document.getElementById('ge-ref-img');
  const wrap = document.getElementById('ge-ref-wrap');
  const op = document.getElementById('ge-ref-opacity');
  const opLbl = document.getElementById('ge-ref-opacity-label');
  const flip = document.getElementById('ge-ref-flip');
  const clear = document.getElementById('ge-ref-clear');
  const details = document.getElementById('ge-reference-section');
  if (!load || !file || !img) return;
  let flipped = false;

  load.addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      img.src = r.result;
      if (wrap) wrap.style.display = '';
      if (details) details.open = true;
    };
    r.readAsDataURL(f);
    file.value = '';
  });
  op?.addEventListener('input', () => {
    img.style.opacity = String((parseInt(op.value, 10) || 100) / 100);
    if (opLbl) opLbl.textContent = op.value + '%';
  });
  flip?.addEventListener('click', () => {
    flipped = !flipped;
    img.style.transform = flipped ? 'scaleX(-1)' : '';
  });
  clear?.addEventListener('click', () => {
    img.removeAttribute('src');
    if (wrap) wrap.style.display = 'none';
    flipped = false;
    img.style.transform = '';
  });
}
