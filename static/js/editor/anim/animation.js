/**
 * Animation controller — wires the pure cel model (model.js) into the live
 * editor. A cel IS a normal layer (cel.layerId), so the brush/mask/blend systems
 * work on animation drawings unchanged. At the current frame the controller
 * resolves which cel each track shows (hold-last for unassigned frames) and sets
 * those layers' visibility; the normal composite() then renders them. Onion skin
 * is a faint, tinted post-composite overlay of neighbouring cels. Playback is a
 * requestAnimationFrame loop that advances the frame at the doc's FPS.
 *
 * @param {{ composite:()=>void, createLayer:(n,w,h)=>object,
 *           renderLayerPanel:()=>void }} deps
 */
import { state } from '../state.js';
import * as M from './model.js';

export function createAnimation({ composite, createLayer, renderLayerPanel, onChange }) {
  const emit = () => { try { onChange && onChange(); } catch {} };
  let scratch = null; // reusable canvas for tinting onion cels
  let raf = 0, lastT = 0, acc = 0;

  function ensure() {
    if (!state.anim) {
      const doc = M.createAnimationDoc({ fps: 12, frameCount: 1 });
      doc.onion = M.defaultOnionSkin();
      doc.enabled = false; doc.playing = false; doc.loop = true; doc.pingpong = false; doc._dir = 1;
      const trk = M.addTrack(doc, 'Animation');
      doc._trackId = trk.id;
      state.anim = doc;
    }
    return state.anim;
  }
  function track() { const a = ensure(); return a.tracks.find((t) => t.id === a._trackId) || a.tracks[0]; }
  const celLayer = (cel) => cel && state.layers.find((l) => l.id === cel.layerId);

  // Resolve which cel is shown this frame and toggle cel-layer visibility to
  // match (non-cel layers are left alone — they act as static background/fg).
  function applyFrameVisibility() {
    const a = state.anim, trk = track();
    if (!a || !trk) return;
    const resolved = M.celAtFrame(trk, a.currentFrame);
    const celIds = new Map(trk.cels.map((c) => [c.layerId, c.id]));
    for (const layer of state.layers) {
      if (celIds.has(layer.id)) layer.visible = celIds.get(layer.id) === resolved;
    }
  }

  function gotoFrame(f) {
    const a = ensure(), trk = track();
    const fc = Math.max(1, a.frameCount || 1);
    a.currentFrame = ((f % fc) + fc) % fc; // wrap
    applyFrameVisibility();
    const cel = trk.cels.find((c) => c.id === M.celAtFrame(trk, a.currentFrame));
    if (cel) state.activeLayerId = cel.layerId; // paint target = the visible cel
    else if (!state.layers.some((l) => l.id === state.activeLayerId)) {
      // No cel resolves (hold frame) and the prior active layer is gone (e.g.
      // deleted by deleteFrame) — fall back to a surviving layer so paint/strokes
      // don't target a dead layer id.
      state.activeLayerId = state.layers[state.layers.length - 1]?.id ?? null;
    }
    composite();
    renderLayerPanel && renderLayerPanel();
    emit();
  }

  // New blank cel (a fresh layer) assigned to the current frame.
  function addCelAt(frame) {
    const a = ensure(), trk = track();
    const layer = createLayer('Cel ' + (trk.cels.length + 1), state.imgWidth, state.imgHeight);
    state.layers.push(layer);
    const cel = M.addCel(a, trk, layer.id);
    M.setFrameCel(trk, frame, cel.id);
    if (frame + 1 > a.frameCount) a.frameCount = frame + 1;
    state.activeLayerId = layer.id;
    return cel;
  }

  // Append a new frame after the current one and drop a blank cel on it.
  function addFrame() {
    const a = ensure();
    const at = a.currentFrame + 1;
    a.frameCount = Math.max(a.frameCount || 1, at + 1);
    addCelAt(at);
    gotoFrame(at);
  }

  // Duplicate the current cel's pixels into a new cel on the next frame.
  function duplicateFrame() {
    const a = ensure(), trk = track();
    const src = celLayer(trk.cels.find((c) => c.id === M.celAtFrame(trk, a.currentFrame)));
    const at = a.currentFrame + 1;
    a.frameCount = Math.max(a.frameCount || 1, at + 1);
    const cel = addCelAt(at);
    const dst = celLayer(cel);
    if (src && dst) { dst.ctx.drawImage(src.canvas, 0, 0); }
    gotoFrame(at);
  }

  // Remove the cel assigned at the current frame (+ its layer + map entry).
  function deleteFrame() {
    const a = ensure(), trk = track();
    const celId = trk.frameMap[a.currentFrame];
    if (celId == null) { gotoFrame(Math.max(0, a.currentFrame - 1)); return; }
    const cel = trk.cels.find((c) => c.id === celId);
    if (cel) {
      const li = state.layers.findIndex((l) => l.id === cel.layerId);
      if (li >= 0 && state.layers.length > 1) state.layers.splice(li, 1);
      trk.cels = trk.cels.filter((c) => c.id !== celId);
    }
    delete trk.frameMap[a.currentFrame];
    gotoFrame(Math.max(0, a.currentFrame - 1));
  }

  function nextFrame() { gotoFrame((state.anim?.currentFrame || 0) + 1); }
  function prevFrame() { gotoFrame((state.anim?.currentFrame || 0) - 1); }

  // Faint, tinted overlay of neighbour cels (light table). Called from composite
  // AFTER the layers are drawn. Tints each neighbour on a scratch canvas so the
  // tint only affects that cel, not the real frame underneath.
  function drawOnion() {
    const a = state.anim;
    if (!a || !a.enabled || !a.onion || !a.onion.enabled || !state.mainCtx) return;
    const trk = track();
    const W = state.mainCanvas.width, H = state.mainCanvas.height;
    if (!scratch) scratch = document.createElement('canvas');
    if (scratch.width !== W || scratch.height !== H) { scratch.width = W; scratch.height = H; }
    const sctx = scratch._ctx || (scratch._ctx = scratch.getContext('2d'));
    const main = state.mainCtx;
    const fc = Math.max(1, a.frameCount || 1);
    for (const ent of M.onionFrames(a.currentFrame, a.onion)) {
      if (ent.frame < 0 || ent.frame >= fc) continue; // skip phantom frames past the timeline
      const layer = celLayer(trk.cels.find((c) => c.id === M.celAtFrame(trk, ent.frame)));
      if (!layer || !layer.canvas || !layer.canvas.width) continue;
      const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 };
      sctx.clearRect(0, 0, W, H);
      sctx.globalCompositeOperation = 'source-over';
      sctx.globalAlpha = 1;
      sctx.drawImage(layer.canvas, off.x, off.y);
      sctx.globalCompositeOperation = 'source-atop'; // tint only the cel's pixels
      sctx.fillStyle = ent.tint;
      sctx.globalAlpha = 0.55;
      sctx.fillRect(0, 0, W, H);
      sctx.globalCompositeOperation = 'source-over';
      sctx.globalAlpha = 1;
      main.save();
      main.globalAlpha = Math.max(0, Math.min(1, ent.alpha));
      main.drawImage(scratch, 0, 0);
      main.restore();
    }
  }

  function play() {
    const a = ensure();
    if (a.playing) return;
    a.playing = true; a._dir = 1; lastT = 0; acc = 0;
    emit();
    const tick = (t) => {
      if (!state.anim || !state.anim.playing) { raf = 0; return; }
      if (!lastT) lastT = t;
      acc += (t - lastT) / 1000; lastT = t;
      const spf = 1 / Math.max(1, state.anim.fps || 12);
      while (acc >= spf) {
        acc -= spf;
        step();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
  function step() {
    const a = state.anim; const fc = Math.max(1, a.frameCount || 1);
    let f = a.currentFrame + a._dir;
    if (a.pingpong) {
      if (f >= fc) { f = fc - 2 >= 0 ? fc - 2 : 0; a._dir = -1; }
      else if (f < 0) { f = 1 < fc ? 1 : 0; a._dir = 1; }
    } else if (f >= fc) {
      if (!a.loop) { pause(); return; }
      f = 0;
    }
    gotoFrame(f);
  }
  function pause() { const a = ensure(); a.playing = false; if (raf) { cancelAnimationFrame(raf); raf = 0; } emit(); }
  function togglePlay() { (state.anim && state.anim.playing) ? pause() : play(); }

  function setFps(v) { ensure().fps = Math.max(1, Math.min(60, v | 0)); }
  function toggleOnion(on) { const a = ensure(); a.onion.enabled = on == null ? !a.onion.enabled : !!on; composite(); emit(); }
  // Light-table options (CSP-style): how many cels before/after, their tints,
  // and the overall opacity.
  function setOnion(opts) {
    const a = ensure();
    if (opts.before != null) a.onion.before = Math.max(0, Math.min(8, opts.before | 0));
    if (opts.after != null) a.onion.after = Math.max(0, Math.min(8, opts.after | 0));
    if (opts.opacity != null) a.onion.opacity = Math.max(0, Math.min(1, opts.opacity));
    if (opts.beforeTint) a.onion.beforeTint = opts.beforeTint;
    if (opts.afterTint) a.onion.afterTint = opts.afterTint;
    composite(); emit();
  }
  // CSP cel reuse: place an EXISTING cel on the current frame (the same drawing
  // can repeat across frames), or clear the frame so it HOLDS the previous cel.
  function assignCel(celId) { const a = ensure(), trk = track(); M.setFrameCel(trk, a.currentFrame, celId); gotoFrame(a.currentFrame); }
  function setHold() { const a = ensure(), trk = track(); M.setFrameCel(trk, a.currentFrame, null); gotoFrame(a.currentFrame); }
  function cels() { return track().cels.slice(); }

  function enable() {
    const a = ensure();
    a.enabled = true;
    // If there are no cels yet, adopt the current active layer as the first cel
    // so the user's existing drawing becomes frame 0.
    const trk = track();
    if (trk.cels.length === 0) {
      const base = state.layers.find((l) => l.id === state.activeLayerId) || state.layers[state.layers.length - 1];
      if (base) { const cel = M.addCel(a, trk, base.id); M.setFrameCel(trk, 0, cel.id); }
      a.frameCount = Math.max(1, a.frameCount);
    }
    gotoFrame(a.currentFrame || 0);
  }
  function disable() {
    pause();
    const a = state.anim; if (!a) return;
    a.enabled = false;
    for (const l of state.layers) l.visible = true; // restore full visibility
    composite(); renderLayerPanel && renderLayerPanel();
    emit();
  }
  function toggle() { (state.anim && state.anim.enabled) ? disable() : enable(); }

  // Flattened cel rasters in frame order — the source for GIF/MP4 export.
  function frameCanvases() {
    const a = ensure(), trk = track();
    const out = [];
    for (let f = 0; f < (a.frameCount || 1); f++) {
      const layer = celLayer(trk.cels.find((c) => c.id === M.celAtFrame(trk, f)));
      const c = document.createElement('canvas'); c.width = state.imgWidth; c.height = state.imgHeight;
      const ctx = c.getContext('2d');
      if (layer && layer.canvas) { const off = state.layerOffsets.get(layer.id) || { x: 0, y: 0 }; ctx.drawImage(layer.canvas, off.x, off.y); }
      out.push(c);
    }
    return out;
  }

  return {
    ensure, track, gotoFrame, nextFrame, prevFrame, addFrame, duplicateFrame, deleteFrame,
    drawOnion, play, pause, togglePlay, step, setFps, toggleOnion, setOnion, assignCel, setHold, cels,
    enable, disable, toggle, frameCanvases,
    isEnabled: () => !!(state.anim && state.anim.enabled),
  };
}
