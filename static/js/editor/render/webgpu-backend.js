/**
 * WebGPU compute backend (lazy, self-gating) — runs heavy image kernels on the
 * GPU via compute shaders (WGSL), the modern successor to the WebGL2 compositor.
 *
 * First kernel: a separable box blur (1 pass = Box Blur; 3 passes ≈ Gaussian),
 * matching the CPU kernels in filters/filters.js so results agree to ≤1–2 LSB.
 *
 * SAFETY: WebGPU isn't available everywhere (and can't be exercised in the
 * headless test harness), so this backend is **self-gating**: on first use it
 * runs a tiny self-test comparing the GPU result to the CPU reference and only
 * stays enabled if they agree. Any unavailability / device-loss / shader error /
 * self-test failure makes every entry point return null, and the caller falls
 * back to the existing CPU/worker path. It can therefore ship safely even where
 * the GPU path hasn't been visually verified — worst case it stays dormant.
 *
 * Inspect at runtime via window.__geWebGPUStatus() (wired in galleryEditor).
 */

// CPU reference (kept identical to the filter kernels) — used by the self-test
// and as documentation of what the shader must reproduce.
function cpuBoxBlur(d, w, h, radius) {
  if (radius < 1) return;
  const tmp = new Float32Array(d.length);
  // horizontal
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let x = -radius; x <= radius; x++) { const xi = Math.max(0, Math.min(w - 1, x)); sum += d[(y * w + xi) * 4 + c]; }
      const win = 2 * radius + 1;
      for (let x = 0; x < w; x++) {
        tmp[(y * w + x) * 4 + c] = sum / win;
        const xOut = Math.max(0, Math.min(w - 1, x - radius));
        const xIn = Math.max(0, Math.min(w - 1, x + radius + 1));
        sum += d[(y * w + xIn) * 4 + c] - d[(y * w + xOut) * 4 + c];
      }
    }
  }
  // vertical
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) { const yi = Math.max(0, Math.min(h - 1, y)); sum += tmp[(yi * w + x) * 4 + c]; }
      const win = 2 * radius + 1;
      for (let y = 0; y < h; y++) {
        d[(y * w + x) * 4 + c] = Math.round(sum / win);
        const yOut = Math.max(0, Math.min(h - 1, y - radius));
        const yIn = Math.max(0, Math.min(h - 1, y + radius + 1));
        sum += tmp[(yIn * w + x) * 4 + c] - tmp[(yOut * w + x) * 4 + c];
      }
    }
  }
}

const WGSL = `
struct Params { w:u32, h:u32, radius:u32, horizontal:u32 };
@group(0) @binding(0) var<storage, read> src: array<u32>;
@group(0) @binding(1) var<storage, read_write> dst: array<u32>;
@group(0) @binding(2) var<uniform> p: Params;

fn unpack(v:u32) -> vec4<f32> {
  return vec4<f32>(f32(v & 0xffu), f32((v >> 8u) & 0xffu), f32((v >> 16u) & 0xffu), f32((v >> 24u) & 0xffu));
}
fn pack(c:vec4<f32>) -> u32 {
  let r = u32(clamp(round(c.x), 0.0, 255.0));
  let g = u32(clamp(round(c.y), 0.0, 255.0));
  let b = u32(clamp(round(c.z), 0.0, 255.0));
  let a = u32(clamp(round(c.w), 0.0, 255.0));
  return r | (g << 8u) | (b << 16u) | (a << 24u);
}
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= p.w || gid.y >= p.h) { return; }
  let r = i32(p.radius);
  var sum = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  let win = f32(2 * r + 1);
  if (p.horizontal == 1u) {
    for (var k = -r; k <= r; k = k + 1) {
      let xi = clamp(i32(gid.x) + k, 0, i32(p.w) - 1);
      sum = sum + unpack(src[gid.y * p.w + u32(xi)]);
    }
  } else {
    for (var k = -r; k <= r; k = k + 1) {
      let yi = clamp(i32(gid.y) + k, 0, i32(p.h) - 1);
      sum = sum + unpack(src[u32(yi) * p.w + gid.x]);
    }
  }
  dst[gid.y * p.w + gid.x] = pack(sum / win);
}`;

const STATUS = { available: false, device: false, selfTest: null, used: 0, lastError: null };
export function webgpuStatus() { return { ...STATUS }; }

let _device = null, _devicePromise = null, _unavailable = false;
let _pipeline = null, _bgl = null, _selfTest = null;

async function getDevice() {
  if (_device) return _device;
  if (_unavailable) return null;
  if (!_devicePromise) {
    _devicePromise = (async () => {
      try {
        if (typeof navigator === 'undefined' || !navigator.gpu) { _unavailable = true; return null; }
        STATUS.available = true;
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) { _unavailable = true; return null; }
        const dev = await adapter.requestDevice();
        if (!dev) { _unavailable = true; return null; }
        try { dev.lost.then(() => { _device = null; _pipeline = null; _unavailable = true; STATUS.device = false; }); } catch {}
        _device = dev; STATUS.device = true;
        return dev;
      } catch (e) { _unavailable = true; STATUS.lastError = String(e); return null; }
    })();
  }
  return _devicePromise;
}

function ensurePipeline(device) {
  if (_pipeline) return;
  const mod = device.createShaderModule({ code: WGSL });
  _bgl = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ],
  });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [_bgl] });
  _pipeline = device.createComputePipeline({ layout, compute: { module: mod, entryPoint: 'main' } });
}

// Run a separable box blur `passes` times over packed-RGBA u32 data. Returns a
// new Uint32Array with the result, or throws on a GPU error (caller catches).
async function gpuBoxBlur(device, srcU32, w, h, radius, passes) {
  ensurePipeline(device);
  const bytes = srcU32.byteLength;
  const mk = (usage) => device.createBuffer({ size: bytes, usage });
  const A = mk(GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
  const B = mk(GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
  device.queue.writeBuffer(A, 0, srcU32);
  const uni = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bg = (s, d, horiz) => {
    device.queue.writeBuffer(uni, 0, new Uint32Array([w, h, radius, horiz]));
    return device.createBindGroup({ layout: _bgl, entries: [
      { binding: 0, resource: { buffer: s } }, { binding: 1, resource: { buffer: d } }, { binding: 2, resource: { buffer: uni } },
    ] });
  };
  const gx = Math.ceil(w / 8), gy = Math.ceil(h / 8);
  // Each box pass = horizontal (A->B) then vertical (B->A); result ends in A.
  for (let pass = 0; pass < passes; pass++) {
    const enc = device.createCommandEncoder();
    const ph = enc.beginComputePass(); ph.setPipeline(_pipeline); ph.setBindGroup(0, bg(A, B, 1)); ph.dispatchWorkgroups(gx, gy); ph.end();
    device.queue.submit([enc.finish()]);
    const enc2 = device.createCommandEncoder();
    const pv = enc2.beginComputePass(); pv.setPipeline(_pipeline); pv.setBindGroup(0, bg(B, A, 0)); pv.dispatchWorkgroups(gx, gy); pv.end();
    device.queue.submit([enc2.finish()]);
  }
  const read = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const enc3 = device.createCommandEncoder();
  enc3.copyBufferToBuffer(A, 0, read, 0, bytes);
  device.queue.submit([enc3.finish()]);
  await read.mapAsync(GPUMapMode.READ);
  const out = new Uint32Array(read.getMappedRange().slice(0));
  read.unmap();
  [A, B, uni, read].forEach((b) => { try { b.destroy(); } catch {} });
  return out;
}

async function runSelfTest(device) {
  if (_selfTest !== null) return _selfTest;
  try {
    const w = 16, h = 16;
    const u8 = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { u8[i * 4] = (i * 7) & 255; u8[i * 4 + 1] = (i * 13) & 255; u8[i * 4 + 2] = (i * 29) & 255; u8[i * 4 + 3] = 255; }
    const cpu = u8.slice();
    cpuBoxBlur(cpu, w, h, 2);
    const gpu = await gpuBoxBlur(device, new Uint32Array(u8.buffer.slice(0)), w, h, 2, 1);
    const gpuU8 = new Uint8ClampedArray(gpu.buffer);
    let maxDelta = 0;
    for (let i = 0; i < cpu.length; i++) { const dd = Math.abs(cpu[i] - gpuU8[i]); if (dd > maxDelta) maxDelta = dd; }
    _selfTest = maxDelta <= 2; // round-half-even (CPU) vs round (GPU) ⇒ ≤1; allow 2
    STATUS.selfTest = _selfTest;
    if (!_selfTest) STATUS.lastError = 'self-test maxDelta=' + maxDelta;
    return _selfTest;
  } catch (e) { _selfTest = false; STATUS.selfTest = false; STATUS.lastError = 'self-test: ' + e; return false; }
}

/** Filter ids this backend can run on the GPU. */
export function gpuSupportsFilter(type) { return type === 'blur' || type === 'gaussian'; }

/**
 * Run a supported filter on the GPU. Resolves to a NEW ImageData on success, or
 * null (unavailable / unsupported / self-test failed / any error) so the caller
 * falls back to the CPU/worker path.
 */
export async function gpuFilterAsync(img, type, amount, _opts) {
  try {
    if (!gpuSupportsFilter(type)) return null;
    const device = await getDevice();
    if (!device) return null;
    if (!(await runSelfTest(device))) return null;
    const w = img.width, h = img.height;
    const radius = type === 'gaussian' ? Math.max(1, Math.round(amount / 12)) : Math.max(1, Math.round(amount / 8));
    const passes = type === 'gaussian' ? 3 : 1;
    const srcU32 = new Uint32Array(img.data.buffer.slice(0)); // copy (don't detach caller's data)
    const outU32 = await gpuBoxBlur(device, srcU32, w, h, radius, passes);
    STATUS.used++;
    return new ImageData(new Uint8ClampedArray(outU32.buffer), w, h);
  } catch (e) { STATUS.lastError = String(e); return null; }
}
