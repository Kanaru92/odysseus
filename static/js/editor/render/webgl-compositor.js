// webgl-compositor.js
// WebGL2 layer compositor for the in-browser image editor.
//
// Composites a stack of pre-rendered layer canvases (each already has its own
// adjustments / mask / fx baked in) into a single image on the GPU, replacing a
// CPU per-layer drawImage + globalCompositeOperation loop.
//
// The final result is written to the GL canvas's default framebuffer with
// STRAIGHT (un-premultiplied) alpha, so the caller can do
//   ctx.drawImage(glCanvas, 0, 0)
// onto a normal 2D canvas and have it composite correctly with source-over.
//
// ---------------------------------------------------------------------------
// Y CONVENTION
// ---------------------------------------------------------------------------
// Layer canvases are top-down (row 0 = top, y grows downward), like all 2D
// canvases. WebGL's framebuffer origin is bottom-left (y grows upward).
//
// We keep ALL internal math in a single, consistent "top-down" space:
//   * Layer textures are uploaded WITHOUT UNPACK_FLIP_Y_WEBGL (so texel (0,0)
//     of the texture == top-left pixel of the layer canvas). The texture is
//     therefore stored "upside down" relative to GL's default sampling, which
//     is exactly what we want: we treat texture V=0 as the TOP row.
//   * Blend / present shaders sample with the same convention, so the ping-pong
//     FBO textures are also top-down.
//   * The blend shader positions each layer using top-down pixel coordinates
//     (layer.x, layer.y measured from the top-left of the WxH composite).
//   * Only the FINAL present pass flips Y once, when drawing the top-down result
//     texture into GL's bottom-left default framebuffer, so that the resulting
//     drawing buffer is itself top-down again. The net effect: drawImage of the
//     GL canvas matches having drawn each layer at (x, y) on a 2D canvas.
//
// In short: everything is top-down; the single Y-flip happens only in the
// present pass to reconcile with GL's bottom-left default framebuffer.
// ---------------------------------------------------------------------------

// Blend mode string -> integer index used by the GLSL `uMode` uniform.
// This is the authoritative SUPPORTED list; anything not here is CPU-only.
const MODE_INDEX = {
  'source-over': 0,
  'multiply': 1,
  'screen': 2,
  'darken': 3,
  'lighten': 4,
  'overlay': 5,
  'hard-light': 6,
  'color-dodge': 7,
  'color-burn': 8,
  'soft-light': 9,
  'difference': 10,
  'exclusion': 11,
  'linear-burn': 12,
  'linear-dodge': 13,
  'subtract': 14,
  'divide': 15,
  'linear-light': 16,
  'vivid-light': 17,
  'pin-light': 18,
  'hard-mix': 19,
};

// Modes that are explicitly NOT GPU-supported here (non-separable or special).
// isSupported() returns false for these and for any unknown id; the caller
// falls back to CPU compositing for those layers.
//   non-separable: 'hue','saturation','color','luminosity'
//   special:       'darker-color','lighter-color','dissolve'

// ---------------------------------------------------------------------------
// Shaders (GLSL ES 3.00)
// ---------------------------------------------------------------------------

// Full-screen triangle generated from gl_VertexID — no VBO needed.
// vUV is in [0,1] across the framebuffer with V=0 at the TOP (top-down),
// matching our texture convention (see Y CONVENTION above).
const VERT_SRC = `#version 300 es
precision highp float;
out vec2 vUV;
void main() {
  // Oversized triangle covering the clip-space viewport.
  // gl_VertexID: 0,1,2
  vec2 pos = vec2(
    (gl_VertexID == 2) ? 3.0 : -1.0,
    (gl_VertexID == 1) ? 3.0 : -1.0
  );
  gl_Position = vec4(pos, 0.0, 1.0);
  // NO Y-flip here: write-vUV and read-vUV must share ONE orientation, else the
  // ping-pong backdrop read is flipped relative to the write and multi-layer
  // (3+) compositing mis-registers vertically. The single net flip happens only
  // in the present pass. (Verified by the multi-layer golden diff.)
  vUV = pos * 0.5 + 0.5;
}`;

// Blend pass: sample the accumulated backdrop (top-down) and the current layer
// (positioned via uniforms), then composite the layer OVER the backdrop using
// the W3C separable blend + source-over math.
const BLEND_FRAG_SRC = `#version 300 es
precision highp float;

in vec2 vUV;
out vec4 outColor;

uniform sampler2D uBackdrop;  // accumulated result so far (straight alpha, top-down)
uniform sampler2D uLayer;     // current layer pixels (straight alpha, top-down)

uniform vec2  uCompSize;   // composite size in pixels (W, H)
uniform vec2  uLayerOrigin;// layer top-left offset in composite pixels (x, y)
uniform vec2  uLayerSize;  // layer canvas size in pixels (w, h)
uniform float uOpacity;    // 0..1
uniform int   uMode;       // blend mode index (see MODE_INDEX in JS)

// ---- separable per-channel blend functions (operate on 0..1) ----
float blendChannel(int mode, float Cb, float Cs) {
  if (mode == 0)  return Cs;                                   // source-over (Normal)
  if (mode == 1)  return Cb * Cs;                              // multiply
  if (mode == 2)  return Cb + Cs - Cb * Cs;                    // screen
  if (mode == 3)  return min(Cb, Cs);                          // darken
  if (mode == 4)  return max(Cb, Cs);                          // lighten
  if (mode == 5)  return (Cb <= 0.5) ? (2.0 * Cb * Cs)         // overlay
                                     : (1.0 - 2.0 * (1.0 - Cb) * (1.0 - Cs));
  if (mode == 6)  return (Cs <= 0.5) ? (2.0 * Cb * Cs)         // hard-light
                                     : (1.0 - 2.0 * (1.0 - Cb) * (1.0 - Cs));
  if (mode == 7)  return (Cs >= 1.0) ? 1.0                     // color-dodge
                                     : min(1.0, Cb / (1.0 - Cs));
  if (mode == 8)  return (Cs <= 0.0) ? 0.0                     // color-burn
                                     : 1.0 - min(1.0, (1.0 - Cb) / Cs);
  if (mode == 9) {                                             // soft-light (W3C)
    float D = (Cb <= 0.25)
      ? (((16.0 * Cb - 12.0) * Cb + 4.0) * Cb)
      : sqrt(Cb);
    return (Cs <= 0.5)
      ? (Cb - (1.0 - 2.0 * Cs) * Cb * (1.0 - Cb))
      : (Cb + (2.0 * Cs - 1.0) * (D - Cb));
  }
  if (mode == 10) return abs(Cb - Cs);                         // difference
  if (mode == 11) return Cb + Cs - 2.0 * Cb * Cs;             // exclusion
  if (mode == 12) return clamp(Cb + Cs - 1.0, 0.0, 1.0);      // linear-burn
  if (mode == 13) return clamp(Cb + Cs, 0.0, 1.0);            // linear-dodge
  if (mode == 14) return max(Cb - Cs, 0.0);                    // subtract
  if (mode == 15) return (Cs <= 0.0) ? 1.0                     // divide
                                     : min(Cb / Cs, 1.0);
  if (mode == 16) return clamp(Cb + 2.0 * Cs - 1.0, 0.0, 1.0); // linear-light
  if (mode == 17) {                                            // vivid-light
    if (Cs <= 0.5) {
      float d = 2.0 * Cs;
      return (d <= 0.0) ? 0.0 : (1.0 - min(1.0, (1.0 - Cb) / d));
    } else {
      float d = 2.0 * (Cs - 0.5);
      return (d >= 1.0) ? 1.0 : min(1.0, Cb / (1.0 - d));
    }
  }
  if (mode == 18) return (Cs <= 0.5) ? min(Cb, 2.0 * Cs)       // pin-light
                                     : max(Cb, 2.0 * Cs - 1.0);
  if (mode == 19) {                                            // hard-mix
    // Use vivid-light result; >= 0.5 -> 1, else 0.
    float v;
    if (Cs <= 0.5) {
      float d = 2.0 * Cs;
      v = (d <= 0.0) ? 0.0 : (1.0 - min(1.0, (1.0 - Cb) / d));
    } else {
      float d = 2.0 * (Cs - 0.5);
      v = (d >= 1.0) ? 1.0 : min(1.0, Cb / (1.0 - d));
    }
    return (v < 0.5) ? 0.0 : 1.0;
  }
  return Cs; // fallback == Normal
}

vec3 blendRGB(int mode, vec3 Cb, vec3 Cs) {
  return vec3(
    blendChannel(mode, Cb.r, Cs.r),
    blendChannel(mode, Cb.g, Cs.g),
    blendChannel(mode, Cb.b, Cs.b)
  );
}

void main() {
  // Backdrop straight color/alpha at this composite pixel.
  vec4 backdrop = texture(uBackdrop, vUV);
  vec3 Cb = backdrop.rgb;
  float ab = backdrop.a;

  // Map this composite pixel to the layer's local UV. The layer occupies the
  // rectangle [uLayerOrigin, uLayerOrigin + uLayerSize) in top-down composite
  // pixels. Pixels outside the layer contribute nothing.
  vec2 compPx = vUV * uCompSize;            // composite pixel coords (top-down)
  vec2 localPx = compPx - uLayerOrigin;     // pixel coords inside the layer
  vec2 layerUV = localPx / uLayerSize;      // 0..1 layer UV (top-down)

  vec3 Cs = vec3(0.0);
  float srcA = 0.0;
  if (layerUV.x >= 0.0 && layerUV.x < 1.0 &&
      layerUV.y >= 0.0 && layerUV.y < 1.0) {
    vec4 layer = texture(uLayer, layerUV);
    Cs = layer.rgb;
    srcA = layer.a;
  }

  float as = srcA * uOpacity;               // effective source alpha

  // W3C compositing + blending (source-over), straight alpha throughout.
  vec3 B   = blendRGB(uMode, Cb, Cs);       // per-channel blend
  vec3 Csb = (1.0 - ab) * Cs + ab * B;      // blended source color
  float ao = as + ab * (1.0 - as);          // output alpha (source-over)
  vec3 Co  = (ao <= 0.0)
    ? vec3(0.0)
    : (as * Csb + ab * (1.0 - as) * Cb) / ao;

  outColor = vec4(Co, ao);
}`;

// Present pass: draw the final top-down result texture into the GL canvas's
// default framebuffer. Because the default framebuffer origin is bottom-left,
// we sample with a vertically flipped V so the drawing buffer ends up top-down.
const PRESENT_FRAG_SRC = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uTex;
void main() {
  // vUV is top-down; flip V so the bottom-left default framebuffer ends up
  // holding a top-down image. Output straight alpha unchanged.
  vec4 c = texture(uTex, vec2(vUV.x, 1.0 - vUV.y));
  outColor = c;
}`;

// ---------------------------------------------------------------------------
// Compositor factory
// ---------------------------------------------------------------------------

export function createWebGLCompositor() {
  /** @type {HTMLCanvasElement|null} */
  let canvas = null;
  /** @type {WebGL2RenderingContext|null} */
  let gl = null;

  let initFailed = false;     // permanent failure (no point retrying)
  let contextLost = false;    // transient; recovers on contextrestored
  let warnedShader = false;   // only log the shader info log once

  // GPU resources
  let blendProgram = null;
  let presentProgram = null;
  let vao = null;             // empty VAO (vertexless draw still needs one bound)

  // Ping-pong color textures + a single FBO we retarget each pass.
  let texA = null;
  let texB = null;
  let fbo = null;

  // Reused upload texture for each layer.
  let layerTex = null;
  // Allocated dimensions of the reusable layer texture, so we can texSubImage2D
  // (update in place) when the next layer matches and only reallocate storage
  // via texImage2D when the size actually changes.
  let layerTexW = 0;
  let layerTexH = 0;

  // Allocated dimensions of the ping-pong textures.
  let allocW = 0;
  let allocH = 0;

  // Cached MAX_TEXTURE_SIZE (queried lazily; 0 = unknown/unavailable).
  let maxTexSize = 0;

  // Cached uniform locations for the blend program.
  let bu = null; // { uBackdrop, uLayer, uCompSize, uLayerOrigin, uLayerSize, uOpacity, uMode }
  let pu = null; // { uTex }

  // ---- GL helpers -------------------------------------------------------

  function compileShader(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      if (!warnedShader) {
        warnedShader = true;
        console.warn(
          'webgl-compositor: shader compile failed:\n' +
          gl.getShaderInfoLog(sh)
        );
      }
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  function linkProgram(vsSrc, fsSrc) {
    const vs = compileShader(gl.VERTEX_SHADER, vsSrc);
    const fs = compileShader(gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      return null;
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    // Shaders can be detached/deleted after a successful link.
    gl.detachShader(prog, vs);
    gl.detachShader(prog, fs);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      if (!warnedShader) {
        warnedShader = true;
        console.warn(
          'webgl-compositor: program link failed:\n' +
          gl.getProgramInfoLog(prog)
        );
      }
      gl.deleteProgram(prog);
      return null;
    }
    return prog;
  }

  function createColorTexture(w, h) {
    const tex = gl.createTexture();
    if (!tex) return null;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // Detect a real allocation failure (e.g. out of memory / size too large):
    // clear pending errors, then check whether texStorage2D produced one.
    while (gl.getError() !== gl.NO_ERROR) { /* drain stale errors */ }
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    if (gl.getError() !== gl.NO_ERROR) {
      gl.deleteTexture(tex);
      return null;
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  // Build the (size-independent) programs, VAO and the reusable layer texture.
  function initPrograms() {
    blendProgram = linkProgram(VERT_SRC, BLEND_FRAG_SRC);
    presentProgram = linkProgram(VERT_SRC, PRESENT_FRAG_SRC);
    if (!blendProgram || !presentProgram) {
      // Partial init: one program may have linked. Delete it so a successfully
      // linked program isn't leaked when the other failed.
      if (blendProgram) gl.deleteProgram(blendProgram);
      if (presentProgram) gl.deleteProgram(presentProgram);
      blendProgram = presentProgram = null;
      return false;
    }

    bu = {
      uBackdrop: gl.getUniformLocation(blendProgram, 'uBackdrop'),
      uLayer: gl.getUniformLocation(blendProgram, 'uLayer'),
      uCompSize: gl.getUniformLocation(blendProgram, 'uCompSize'),
      uLayerOrigin: gl.getUniformLocation(blendProgram, 'uLayerOrigin'),
      uLayerSize: gl.getUniformLocation(blendProgram, 'uLayerSize'),
      uOpacity: gl.getUniformLocation(blendProgram, 'uOpacity'),
      uMode: gl.getUniformLocation(blendProgram, 'uMode'),
    };
    pu = { uTex: gl.getUniformLocation(presentProgram, 'uTex') };

    // Empty VAO: WebGL2 still requires a bound VAO for vertexless draws.
    vao = gl.createVertexArray();

    // Reusable per-layer upload texture (re-texImage2D'd each layer).
    layerTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, layerTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    fbo = gl.createFramebuffer();
    return true;
  }

  // (Re)allocate ping-pong textures to EXACTLY W x H. Exact sizing matters: the
  // shaders sample with vUV 0..1 assuming the texture == the composite, so a
  // grow-only texture would make a later smaller doc sample a stale region.
  function ensureTextures(W, H) {
    if (texA && texB && allocW === W && allocH === H) return true;
    if (texA) gl.deleteTexture(texA);
    if (texB) gl.deleteTexture(texB);
    texA = createColorTexture(W, H);
    texB = createColorTexture(W, H);
    if (!texA || !texB) {
      // Allocation failed (e.g. OOM); drop any partial texture so we don't leak
      // it and don't leave a broken half-allocated state.
      if (texA) gl.deleteTexture(texA);
      if (texB) gl.deleteTexture(texB);
      texA = texB = null;
      allocW = allocH = 0;
      return false;
    }
    allocW = W;
    allocH = H;
    return true;
  }

  // ---- context lifecycle ------------------------------------------------

  function handleContextLost(e) {
    // Prevent the default so the context can be restored later.
    e.preventDefault();
    contextLost = true;
    // GL objects are invalid now; drop our references so we recreate them.
    blendProgram = presentProgram = null;
    vao = null;
    texA = texB = null;
    fbo = null;
    layerTex = null;
    layerTexW = layerTexH = 0;
    allocW = allocH = 0;
    maxTexSize = 0;
    bu = pu = null;
  }

  function handleContextRestored() {
    contextLost = false;
    // Recreate size-independent resources. Textures are recreated lazily by
    // ensureTextures() on the next composite() / available() resize check.
    try {
      if (gl && initPrograms()) {
        // ok; textures recreated on demand
      } else {
        initFailed = true;
      }
    } catch (err) {
      console.warn('webgl-compositor: failed to restore context:', err);
      initFailed = true;
    }
  }

  function createContext() {
    canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    canvas.addEventListener('webglcontextlost', handleContextLost, false);
    canvas.addEventListener('webglcontextrestored', handleContextRestored, false);

    const attrs = {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true, // so drawImage(glCanvas) reads the result reliably
    };
    gl = canvas.getContext('webgl2', attrs);
    if (!gl) return false;
    return initPrograms();
  }

  // ---- public API -------------------------------------------------------

  // Ensure a usable WebGL2 context exists and the canvas/FBO are >= W x H.
  // Returns true if WebGL2 is usable, false otherwise (caller falls back to CPU).
  function available(W, H) {
    if (initFailed) return false;
    if (contextLost) return false;

    try {
      if (!gl) {
        if (!createContext()) {
          initFailed = true;
          return false;
        }
      }
      // gl can be lost between calls — guard.
      if (!gl || gl.isContextLost()) {
        contextLost = true;
        return false;
      }

      const needW = Math.max(1, W | 0);
      const needH = Math.max(1, H | 0);

      // A composite bigger than the GPU's MAX_TEXTURE_SIZE can't be allocated;
      // bail to CPU cleanly instead of letting texStorage2D fail and rendering
      // garbage. (Callers may also pre-check via maxTextureSize().)
      const max = maxTextureSize();
      if (max && (needW > max || needH > max)) return false;

      // EXACT-size the GL canvas so the present viewport == canvas == composite
      // (vUV 0..1 maps to the whole composite; no grow-only stale regions).
      if (canvas.width !== needW) canvas.width = needW;
      if (canvas.height !== needH) canvas.height = needH;

      if (!ensureTextures(needW, needH)) {
        return false;
      }
      return true;
    } catch (err) {
      console.warn('webgl-compositor: available() failed:', err);
      initFailed = true;
      return false;
    }
  }

  function maxTextureSize() {
    if (!gl || gl.isContextLost()) return 0;
    if (maxTexSize > 0) return maxTexSize;
    try {
      maxTexSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0;
    } catch (_) {
      maxTexSize = 0;
    }
    return maxTexSize;
  }

  // True if this blend mode string is GPU-supported.
  function isSupported(mode) {
    return Object.prototype.hasOwnProperty.call(MODE_INDEX, mode);
  }

  function getCanvas() {
    return canvas;
  }

  // Render `layers` (bottom-first) into the GL canvas. Returns the GL canvas or
  // null on failure.
  function composite(W, H, layers) {
    if (!available(W, H)) return null;
    if (!gl || gl.isContextLost()) {
      contextLost = true;
      return null;
    }

    try {
      const compW = Math.max(1, W | 0);
      const compH = Math.max(1, H | 0);
      const maxTex = maxTextureSize();

      gl.bindVertexArray(vao);
      gl.disable(gl.BLEND);     // all blending happens in-shader
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.SCISSOR_TEST);
      // Straight alpha everywhere: do NOT premultiply on upload.
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      // Keep texture data top-down (texel (0,0) == top-left). See Y CONVENTION.
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);

      // Ping-pong: `read` holds the accumulated backdrop, `write` is the target.
      let readTex = texA;
      let writeTex = texB;

      // Clear the initial backdrop (read texture) to fully transparent.
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, readTex, 0
      );
      gl.viewport(0, 0, compW, compH);
      gl.clearColor(0.0, 0.0, 0.0, 0.0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const list = Array.isArray(layers) ? layers : [];

      gl.useProgram(blendProgram);
      gl.uniform1i(bu.uBackdrop, 0); // texture unit 0 == backdrop
      gl.uniform1i(bu.uLayer, 1);    // texture unit 1 == layer
      gl.uniform2f(bu.uCompSize, compW, compH);

      for (let i = 0; i < list.length; i++) {
        const layer = list[i];
        if (!layer || !layer.canvas) continue;

        const src = layer.canvas;
        const lw = src.width | 0;
        const lh = src.height | 0;
        if (lw <= 0 || lh <= 0) continue;
        // A layer larger than MAX_TEXTURE_SIZE can't be uploaded; skip it rather
        // than let texImage2D fail. (The caller should bail the whole frame to
        // CPU when this happens — see _glRenderTo — but guard here too.)
        if (maxTex && (lw > maxTex || lh > maxTex)) continue;

        const mode = isSupported(layer.mode) ? MODE_INDEX[layer.mode]
                                             : MODE_INDEX['source-over'];
        const opacity = (typeof layer.opacity === 'number')
          ? Math.min(1, Math.max(0, layer.opacity))
          : 1.0;
        const ox = (typeof layer.x === 'number') ? layer.x : 0;
        const oy = (typeof layer.y === 'number') ? layer.y : 0;

        // Upload this layer into the reusable layer texture. Reallocate storage
        // (texImage2D) only when the size changed; otherwise update in place
        // (texSubImage2D) to avoid reallocating texture storage every layer.
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, layerTex);
        try {
          if (lw === layerTexW && lh === layerTexH) {
            gl.texSubImage2D(
              gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src
            );
          } else {
            gl.texImage2D(
              gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src
            );
            layerTexW = lw;
            layerTexH = lh;
          }
        } catch (uploadErr) {
          // A bad / tainted source canvas: skip this layer rather than abort.
          console.warn('webgl-compositor: layer upload failed, skipping:', uploadErr);
          continue;
        }

        // Bind the accumulated backdrop on unit 0.
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, readTex);

        // Target the write texture (never the one we are sampling).
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(
          gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, writeTex, 0
        );
        gl.viewport(0, 0, compW, compH);

        gl.uniform2f(bu.uLayerOrigin, ox, oy);
        gl.uniform2f(bu.uLayerSize, lw, lh);
        gl.uniform1f(bu.uOpacity, opacity);
        gl.uniform1i(bu.uMode, mode);

        // Full-screen triangle.
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        // Swap ping-pong: the freshly written texture becomes the backdrop.
        const tmp = readTex;
        readTex = writeTex;
        writeTex = tmp;
      }

      // Present: draw the final result (readTex) into the default framebuffer.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, compW, compH);
      gl.clearColor(0.0, 0.0, 0.0, 0.0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(presentProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, readTex);
      gl.uniform1i(pu.uTex, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.flush();
      return canvas;
    } catch (err) {
      console.warn('webgl-compositor: composite() failed:', err);
      if (gl && gl.isContextLost()) contextLost = true;
      return null;
    }
  }

  // Release the GL context, GPU resources and the canvas event listeners added
  // in createContext(). Idempotent. After this the compositor is permanently
  // disabled (available()/composite() return false / null). Call when the owning
  // component is torn down so the listeners + GPU memory don't outlive it.
  function dispose() {
    initFailed = true;
    if (gl) {
      try {
        if (blendProgram) gl.deleteProgram(blendProgram);
        if (presentProgram) gl.deleteProgram(presentProgram);
        if (vao) gl.deleteVertexArray(vao);
        if (texA) gl.deleteTexture(texA);
        if (texB) gl.deleteTexture(texB);
        if (layerTex) gl.deleteTexture(layerTex);
        if (fbo) gl.deleteFramebuffer(fbo);
      } catch (_) { /* context may already be lost; nothing to free */ }
    }
    if (canvas) {
      canvas.removeEventListener('webglcontextlost', handleContextLost, false);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored, false);
    }
    blendProgram = presentProgram = null;
    vao = null;
    texA = texB = null;
    layerTex = null;
    layerTexW = layerTexH = 0;
    fbo = null;
    allocW = allocH = 0;
    maxTexSize = 0;
    bu = pu = null;
    gl = null;
    canvas = null;
  }

  return {
    available,
    maxTextureSize,
    isSupported,
    composite,
    getCanvas,
    dispose,
  };
}
