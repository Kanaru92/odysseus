# Animation (`editor/anim/`) — SCAFFOLD (not yet wired)

Cel-based animation (reusable cels + light table + timeline), using reusable
cels rather than per-frame snapshots. Full plan:
`../../../documentation/painting-suite/ANIMATION.md`.

- **`model.js`** — pure, DOM-free data model: `AnimationDoc / Track / Cel /
  CameraTrack`, with `celAtFrame` (hold resolution), `onionFrames`, and
  `cameraAt` (linear/smooth/hold interpolation). Unit-testable; no editor deps.

Planned for the M7 build (each its own module so it stays modular/mergeable):
- `timeline.js` — timeline docker (lanes per track, scrub head, FPS, drag cels)
- `onion-skin.js` — light table via the composite overlay path
- `playback.js` — `requestAnimationFrame` loop (play / loop / ping-pong; `,`/`.` step)
- `export.js` — PNG sequence → GIF/APNG → WebM/MP4 (server mux)
- an animation-aware branch in `composite()` (resolve each track's cel at the
  current frame, draw onion neighbours)
- **Auto in-between** (automatic raster tweening) — planned.

Cels reference normal editor layers (`cel.layerId`), so the brush engine, masks,
and blend modes all work on animation cels unchanged.
