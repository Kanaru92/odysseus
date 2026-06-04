/**
 * Reference image panel — load an image to paint from, shown in the right
 * panel (a reference docker like painting apps). Display-only: it never touches the
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
  const K_IMG = 'ge-ref-img-v1', K_FLIP = 'ge-ref-flip-v1', K_OP = 'ge-ref-op-v1';
  const ls = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };

  load.addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      img.src = r.result;
      if (wrap) wrap.style.display = '';
      if (details) details.open = true;
      ls(K_IMG, r.result); // persist across reloads (best-effort; large images may exceed quota)
    };
    r.readAsDataURL(f);
    file.value = '';
  });
  op?.addEventListener('input', () => {
    img.style.opacity = String((parseInt(op.value, 10) || 100) / 100);
    if (opLbl) opLbl.textContent = op.value + '%';
    ls(K_OP, op.value);
  });
  flip?.addEventListener('click', () => {
    flipped = !flipped;
    img.style.transform = flipped ? 'scaleX(-1)' : '';
    ls(K_FLIP, flipped ? '1' : '');
  });
  clear?.addEventListener('click', () => {
    img.removeAttribute('src');
    if (wrap) wrap.style.display = 'none';
    flipped = false;
    img.style.transform = '';
    ls(K_IMG, null); ls(K_FLIP, null); ls(K_OP, null);
  });

  // Restore a previously-loaded reference (image + flip + opacity) across reloads.
  try {
    const savedImg = localStorage.getItem(K_IMG);
    if (savedImg) {
      img.src = savedImg;
      if (wrap) wrap.style.display = '';
      flipped = localStorage.getItem(K_FLIP) === '1';
      img.style.transform = flipped ? 'scaleX(-1)' : '';
      const savedOp = localStorage.getItem(K_OP);
      if (savedOp != null && op) {
        op.value = savedOp;
        img.style.opacity = String((parseInt(savedOp, 10) || 100) / 100);
        if (opLbl) opLbl.textContent = savedOp + '%';
      }
    }
  } catch {}
}
