/**
 * Animation export orchestration. Takes the flattened per-frame canvases from
 * the animation controller (`anim.frameCanvases()`) and produces a downloadable
 * file:
 *   - GIF : the in-house GIF89a encoder (gif-encoder.js) — fully verified.
 *   - WebM: native MediaRecorder over an offscreen canvas (real-time capture).
 *   - MP4 : (follow-up) WebCodecs VideoEncoder + an MP4 muxer.
 *
 * GIF is the dependable, headless-verifiable path; WebM relies on the browser's
 * media stack so it's a best-effort convenience.
 */
import { encodeGIF } from './gif-encoder.js';

export const ANIM_FORMATS = [
  { id: 'gif', label: 'Animated GIF (.gif)' },
  { id: 'webm', label: 'Video — WebM (.webm)' },
];

function encodeWebM(frames, fps) {
  return new Promise((resolve, reject) => {
    if (typeof MediaRecorder === 'undefined') { reject(new Error('MediaRecorder unavailable')); return; }
    const W = frames[0].width, H = frames[0].height;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const stream = c.captureStream(Math.max(1, fps));
    let mime = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm;codecs=vp8';
    if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm';
    const rec = new MediaRecorder(stream, { mimeType: mime });
    const chunks = [];
    const stopTracks = () => { try { stream.getTracks().forEach((t) => t.stop()); } catch {} };
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => { stopTracks(); resolve(new Blob(chunks, { type: 'video/webm' })); };
    rec.onerror = (e) => { stopTracks(); reject((e && e.error) || new Error('WebM record failed')); };
    const spf = 1000 / Math.max(1, fps);
    rec.start();
    // Drive frame advancement from a monotonic clock (rAF + performance.now) so
    // pacing doesn't drift the way chained setTimeout does (clamped/throttled).
    // Defer frame 0 by one tick so it's captured after the stream is live, and
    // hold the last frame for a floor before stopping so the encoder flushes it.
    const last = frames.length - 1;
    const stopDelay = Math.max(100, 2 * spf);
    let drawn = -1;     // index of the frame currently on-canvas
    let startTs = 0;    // monotonic clock seeded once the stream is live
    let endTs = 0;      // timestamp the final frame was first drawn
    const tick = (now) => {
      // Frame index due by elapsed wall-clock time (best-effort: intervening
      // frames are skipped if a tab throttles, but duration tracks `fps`).
      const want = Math.min(last, Math.floor((now - startTs) / spf));
      if (want !== drawn) {
        drawn = want;
        ctx.clearRect(0, 0, W, H); ctx.drawImage(frames[drawn], 0, 0);
        if (drawn === last) endTs = now;
      }
      if (drawn >= last && now - endTs >= stopDelay) {
        try { rec.requestData(); } catch {}
        try { rec.stop(); } catch {}
        return;
      }
      requestAnimationFrame(tick);
    };
    // First draw deferred to the next frame: capture frame 0 once the pipeline
    // is live, and seed the monotonic clock from that same timestamp.
    requestAnimationFrame((now) => { startTs = now; tick(now); });
  });
}

export async function exportAnimation(frames, { format = 'gif', fps = 12, loop = true } = {}) {
  if (!frames || !frames.length) throw new Error('No animation frames to export');
  if (format === 'gif') return encodeGIF(frames, { fps, loop });
  if (format === 'webm') return encodeWebM(frames, fps);
  throw new Error('Unsupported animation format: ' + format);
}

export function downloadAnim(blob, format) {
  const ext = format === 'webm' ? 'webm' : 'gif';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'animation.' + ext;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} }, 2000);
}
