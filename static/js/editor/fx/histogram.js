/**
 * Draw a luminance histogram of a layer's pixels onto the given
 * canvas. Sampling is capped at ~400×400 so the call stays cheap on
 * very large images.
 *
 * If the layer has a staged Levels adjustment
 * (`layer._stagedAdj.params` with `inBlack` / `inWhite`), the two
 * endpoint markers are drawn over the bars.
 *
 * @param {HTMLCanvasElement} canvas  The histogram canvas to render into.
 * @param {{
 *   canvas: HTMLCanvasElement,
 *   _stagedAdj?: {params?: {inBlack?: number, inWhite?: number}}
 * }} layer                            Source layer.
 */
// Reusable sampling canvas/context shared across calls. drawHistogram is a
// hot path (redrawn every composited rAF frame and on every Levels handle
// drag), so allocating a fresh canvas + context + ImageData per call churned
// GC. willReadFrequently keeps the canvas CPU-backed to avoid a GPU readback
// stall on the per-frame getImageData.
let _sampleCanvas = null;
let _sampleCtx = null;

export function drawHistogram(canvas, layer, channel) {
  if (!canvas) return;
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  // For per-channel Levels editing, draw that single channel's distribution
  // (in its own colour) instead of the composite luminance.
  const chIdx = channel === 'r' ? 0 : channel === 'g' ? 1 : channel === 'b' ? 2 : -1;

  // Down-sample huge images so the histogram stays interactive on 8k+
  // photos. ~400×400 is enough to characterise the distribution.
  const src = layer.canvas;
  const sw = src.width, sh = src.height;
  const maxSamples = 400;
  const sampleW = Math.min(maxSamples, sw);
  const sampleH = Math.min(maxSamples, sh);
  if (!_sampleCanvas) {
    _sampleCanvas = document.createElement('canvas');
    _sampleCtx = _sampleCanvas.getContext('2d', { willReadFrequently: true });
  }
  const tmp = _sampleCanvas;
  if (tmp.width !== sampleW || tmp.height !== sampleH) {
    tmp.width = sampleW; tmp.height = sampleH;
  } else {
    _sampleCtx.clearRect(0, 0, sampleW, sampleH);
  }
  const tctx = _sampleCtx;
  tctx.drawImage(src, 0, 0, sampleW, sampleH);
  const img = tctx.getImageData(0, 0, sampleW, sampleH).data;

  const hist = new Uint32Array(256);
  for (let i = 0; i < img.length; i += 4) {
    if (img[i + 3] < 8) continue; // skip near-transparent
    if (chIdx >= 0) {
      hist[img[i + chIdx]]++;
    } else {
      // Rec. 709 luminance — common choice for histograms in photo editors.
      const Y = (0.2126 * img[i] + 0.7152 * img[i + 1] + 0.0722 * img[i + 2]) | 0;
      hist[Math.min(255, Y)]++;
    }
  }
  let peak = 1;
  for (let i = 0; i < 256; i++) if (hist[i] > peak) peak = hist[i];

  // Background.
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(0, 0, w, h);

  // Bars. sqrt-scaled so the long tails (specular highlights, deep
  // shadows) stay visible even when the central mass dominates.
  ctx.fillStyle = chIdx === 0 ? 'rgba(255,90,90,0.6)' : chIdx === 1 ? 'rgba(90,220,90,0.6)' : chIdx === 2 ? 'rgba(90,150,255,0.65)' : 'rgba(255,255,255,0.55)';
  for (let i = 0; i < 256; i++) {
    const x = (i / 256) * w;
    const bh = Math.pow(hist[i] / peak, 0.5) * h;
    ctx.fillRect(x, h - bh, w / 256 + 0.5, bh);
  }

  // Endpoint markers (input black / input white) from a staged Levels
  // adjustment, if one is in flight.
  const params = layer._stagedAdj?.params;
  const p = (chIdx >= 0 && params?.channels?.[channel]) ? params.channels[channel] : params;
  if (p) {
    // Map the 0..255 value range with /255 so the markers line up with the
    // DOM drag-handles and gamma math overlaid on this canvas (which use /255).
    ctx.fillStyle = 'rgba(0,0,0,0.9)';
    ctx.fillRect((p.inBlack / 255) * w, 0, 1, h);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect((p.inWhite / 255) * w, 0, 1, h);
  }
}
