"""
MorphBlend Server - FILM-based frame interpolation
Runs a local HTTP server that accepts two images and returns morphed intermediates.
"""

import http.server
import json
import os
import sys
import tempfile
import base64
import bisect
import threading
import uuid
import time
import gc
import warnings
from io import BytesIO
from pathlib import Path

import numpy as np
import torch
from PIL import Image

# FILM's frozen weights use Conv2d with padding='same' on kernel+dilation
# combos that need asymmetric padding. PyTorch >=2.0 handles this by zero-
# padding a copy of the input and emits a UserWarning every forward pass.
# It's a perf hint, not a correctness issue, and there's nothing to do at
# our level (the model is loaded as torch.jit/pickle, weights frozen).
# Suppress just that specific warning so server stderr stays readable.
warnings.filterwarnings("ignore", message=r".*padding='same'.*")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

PORT = 5557
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
TEMP_DIR = os.path.join(tempfile.gettempdir(), "MorphBlend")
os.makedirs(TEMP_DIR, exist_ok=True)

# Where to find / download the FILM model
_user_home = os.path.expanduser("~")
MODEL_SEARCH_PATHS = [
    # ComfyUI Frame-Interpolation node pack cache (SwarmUI layout)
    os.path.join(_user_home, "Documents", "SwarmUI", "SwarmUI",
                 "dlbackend", "comfy", "ComfyUI", "custom_nodes",
                 "ComfyUI-Frame-Interpolation", "ckpts", "film", "film_net_fp32.pt"),
    # Standalone ComfyUI
    os.path.join(_user_home, "ComfyUI", "custom_nodes",
                 "ComfyUI-Frame-Interpolation", "ckpts", "film", "film_net_fp32.pt"),
    # Local models dir next to this script
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "film_net_fp32.pt"),
]

MODEL_DOWNLOAD_URLS = [
    "https://github.com/dajes/frame-interpolation-pytorch/releases/download/v1.0.0/film_net_fp32.pt",
    "https://github.com/Fannovel16/ComfyUI-Frame-Interpolation/releases/download/models/film_net_fp32.pt",
]

# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------

_model = None


def find_or_download_model():
    """Locate the FILM model checkpoint, downloading if necessary."""
    # Explicit override wins — lets an Odysseus user point at an existing
    # film_net_fp32.pt (e.g. from a prior MorphBlend install) instead of
    # re-downloading 134MB. Set MORPH_MODEL_PATH=/abs/path/film_net_fp32.pt
    env_path = os.environ.get("MORPH_MODEL_PATH")
    if env_path and os.path.isfile(env_path):
        print(f"[MorphBlend] Using MORPH_MODEL_PATH model at {env_path}")
        return os.path.abspath(env_path)

    for p in MODEL_SEARCH_PATHS:
        resolved = os.path.abspath(p)
        if os.path.isfile(resolved):
            print(f"[MorphBlend] Found model at {resolved}")
            return resolved

    # Download to local models/ dir
    local_dir = os.path.join(os.path.dirname(__file__), "models")
    os.makedirs(local_dir, exist_ok=True)
    dest = os.path.join(local_dir, "film_net_fp32.pt")

    for url in MODEL_DOWNLOAD_URLS:
        print(f"[MorphBlend] Downloading model from {url} ...")
        try:
            torch.hub.download_url_to_file(url, dest)
            print(f"[MorphBlend] Saved to {dest}")
            return dest
        except Exception as e:
            print(f"[MorphBlend] Failed: {e}")

    raise RuntimeError("Could not find or download film_net_fp32.pt")


def get_model():
    global _model
    if _model is None:
        path = find_or_download_model()
        _model = torch.jit.load(path, map_location="cpu")
        _model.eval()
        _model = _model.to(DEVICE)
        print(f"[MorphBlend] Model loaded on {DEVICE}")
    return _model


# ---------------------------------------------------------------------------
# FILM inference  (adapted from ComfyUI-Frame-Interpolation)
# ---------------------------------------------------------------------------


def film_interpolate(model, img_a: torch.Tensor, img_b: torch.Tensor, num_intermediates: int):
    """
    Recursively interpolate between two images using FILM.
    img_a, img_b: [1, C, H, W] float32 tensors in [0, 1]
    num_intermediates: number of frames to generate BETWEEN a and b
    Returns list of [1, C, H, W] tensors (length = num_intermediates + 2, including endpoints)
    """
    results = [img_a, img_b]
    idxes = [0, num_intermediates + 1]
    remains = list(range(1, num_intermediates + 1))
    splits = torch.linspace(0, 1, num_intermediates + 2)

    for _ in range(len(remains)):
        starts = splits[idxes[:-1]]
        ends = splits[idxes[1:]]
        distances = ((splits[None, remains] - starts[:, None]) / (ends[:, None] - starts[:, None]) - 0.5).abs()
        matrix = torch.argmin(distances).item()
        start_i, step = np.unravel_index(matrix, distances.shape)
        end_i = start_i + 1

        x0 = results[start_i].to(DEVICE)
        x1 = results[end_i].to(DEVICE)
        dt = x0.new_full(
            (1, 1),
            (splits[remains[step]] - splits[idxes[start_i]]) / (splits[idxes[end_i]] - splits[idxes[start_i]]),
        )

        with torch.no_grad():
            prediction = model(x0, x1, dt)

        insert_position = bisect.bisect_left(idxes, remains[step])
        idxes.insert(insert_position, remains[step])
        results.insert(insert_position, prediction.clamp(0, 1).float().cpu())
        del remains[step]

    return results


def process_morph(session_id, img_a_pil: Image.Image, img_b_pil: Image.Image, num_frames: int, max_size: int):
    """Run FILM interpolation and save results. Called in a background thread."""
    session = sessions[session_id]
    try:
        session["status"] = "processing"
        session["progress"] = 0.0

        model = get_model()

        # Ensure same size
        w, h = img_a_pil.size
        if img_b_pil.size != (w, h):
            img_b_pil = img_b_pil.resize((w, h), Image.LANCZOS)

        # Optionally downscale
        scale = 1.0
        longest = max(w, h)
        if longest > max_size:
            scale = max_size / longest
            new_w, new_h = int(w * scale), int(h * scale)
            # Ensure dimensions are divisible by 32 for the model
            new_w = (new_w // 32) * 32
            new_h = (new_h // 32) * 32
            img_a_pil = img_a_pil.resize((new_w, new_h), Image.LANCZOS)
            img_b_pil = img_b_pil.resize((new_w, new_h), Image.LANCZOS)
            w, h = new_w, new_h
        else:
            # Still ensure divisible by 32
            new_w = (w // 32) * 32
            new_h = (h // 32) * 32
            if new_w != w or new_h != h:
                img_a_pil = img_a_pil.resize((new_w, new_h), Image.LANCZOS)
                img_b_pil = img_b_pil.resize((new_w, new_h), Image.LANCZOS)
                w, h = new_w, new_h

        session["output_width"] = w
        session["output_height"] = h

        # Convert to tensors [1, C, H, W]
        arr_a = np.array(img_a_pil).astype(np.float32) / 255.0
        arr_b = np.array(img_b_pil).astype(np.float32) / 255.0
        t_a = torch.from_numpy(arr_a).permute(2, 0, 1).unsqueeze(0)  # [1, 3, H, W]
        t_b = torch.from_numpy(arr_b).permute(2, 0, 1).unsqueeze(0)

        # num_frames includes endpoints, so intermediates = num_frames - 2
        num_intermediates = max(num_frames - 2, 1)

        print(f"[MorphBlend] Generating {num_intermediates} intermediate frames at {w}x{h} ...")
        start_time = time.time()

        frames = film_interpolate(model, t_a, t_b, num_intermediates)

        elapsed = time.time() - start_time
        print(f"[MorphBlend] Generated {len(frames)} frames in {elapsed:.1f}s")

        # Save frames
        session_dir = os.path.join(TEMP_DIR, session_id)
        os.makedirs(session_dir, exist_ok=True)

        for i, frame_tensor in enumerate(frames):
            arr = frame_tensor.squeeze(0).permute(1, 2, 0).numpy()  # [H, W, 3]
            arr = (arr * 255).clip(0, 255).astype(np.uint8)
            img = Image.fromarray(arr)

            # Save full-res PNG for Apply
            img.save(os.path.join(session_dir, f"frame_{i:04d}.png"), "PNG")

            # Save preview JPEG
            img.save(os.path.join(session_dir, f"preview_{i:04d}.jpg"), "JPEG", quality=85)

            session["progress"] = (i + 1) / len(frames)

        session["frame_count"] = len(frames)
        session["status"] = "complete"
        print(f"[MorphBlend] Session {session_id} complete: {len(frames)} frames saved")

    except Exception as e:
        session["status"] = "error"
        session["error"] = str(e)
        print(f"[MorphBlend] Error in session {session_id}: {e}")
        import traceback
        traceback.print_exc()
    finally:
        # Free GPU memory
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        gc.collect()


# ---------------------------------------------------------------------------
# Session storage
# ---------------------------------------------------------------------------

sessions = {}

# ---------------------------------------------------------------------------
# HTTP Handler
# ---------------------------------------------------------------------------


class MorphHandler(http.server.BaseHTTPRequestHandler):

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json_response(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self._cors_headers()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_file(self, path, content_type):
        if not os.path.isfile(path):
            self._json_response({"error": "not found"}, 404)
            return
        with open(path, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self._cors_headers()
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def do_GET(self):
        # Strip query string before splitting — the client appends ?t=<ts> to
        # bypass the image-cache, and naively int()ing parts[2] failed with
        # "invalid literal for int() with base 10: '7?t=1778127427296'".
        # urllib.parse handles '#' fragments too if they ever creep in.
        from urllib.parse import urlparse
        parsed = urlparse(self.path)
        clean_path = parsed.path
        parts = clean_path.strip("/").split("/")

        if clean_path == "/health":
            self._json_response({"status": "ok", "device": str(DEVICE)})

        elif clean_path == "/config":
            self._json_response({"version": "1.0", "port": PORT, "temp_dir": TEMP_DIR})

        elif parts[0] == "preview" and len(parts) == 3:
            sid, idx = parts[1], parts[2]
            path = os.path.join(TEMP_DIR, sid, f"preview_{int(idx):04d}.jpg")
            self._serve_file(path, "image/jpeg")

        elif parts[0] == "frame" and len(parts) == 3:
            sid, idx = parts[1], parts[2]
            path = os.path.join(TEMP_DIR, sid, f"frame_{int(idx):04d}.png")
            self._serve_file(path, "image/png")

        elif parts[0] == "frame-path" and len(parts) == 3:
            sid, idx = parts[1], parts[2]
            path = os.path.join(TEMP_DIR, sid, f"frame_{int(idx):04d}.png")
            self._json_response({"path": os.path.abspath(path)})

        elif parts[0] == "status" and len(parts) == 2:
            sid = parts[1]
            if sid not in sessions:
                self._json_response({"error": "unknown session"}, 404)
            else:
                s = sessions[sid]
                self._json_response({
                    "status": s.get("status", "unknown"),
                    "progress": s.get("progress", 0),
                    "frame_count": s.get("frame_count", 0),
                    "output_width": s.get("output_width", 0),
                    "output_height": s.get("output_height", 0),
                    "error": s.get("error", None),
                })

        else:
            self._json_response({"error": "not found"}, 404)

    def do_POST(self):
        if self.path == "/morph":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                self._json_response({"error": "invalid JSON"}, 400)
                return

            # Decode images from base64 (handle optional data URI prefix)
            try:
                b64_a = data["image_a"]
                b64_b = data["image_b"]
                # Strip data URI prefix if present
                if b64_a.startswith("data:"):
                    b64_a = b64_a.split(",", 1)[1]
                if b64_b.startswith("data:"):
                    b64_b = b64_b.split(",", 1)[1]
                img_a_bytes = base64.b64decode(b64_a)
                img_b_bytes = base64.b64decode(b64_b)
                img_a = Image.open(BytesIO(img_a_bytes)).convert("RGB")
                img_b = Image.open(BytesIO(img_b_bytes)).convert("RGB")
            except Exception as e:
                self._json_response({"error": f"image decode failed: {e}"}, 400)
                return

            num_frames = data.get("num_frames", 33)
            max_size = data.get("max_size", 2048)

            session_id = uuid.uuid4().hex[:12]
            sessions[session_id] = {"status": "queued", "progress": 0, "frame_count": 0}

            thread = threading.Thread(
                target=process_morph,
                args=(session_id, img_a, img_b, num_frames, max_size),
                daemon=True,
            )
            thread.start()

            self._json_response({"session_id": session_id})

        elif self.path == "/morph-from-files":
            # Alternative: accept file paths instead of base64
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                self._json_response({"error": "invalid JSON"}, 400)
                return

            try:
                img_a = Image.open(data["path_a"]).convert("RGB")
                img_b = Image.open(data["path_b"]).convert("RGB")
            except Exception as e:
                self._json_response({"error": f"file read failed: {e}"}, 400)
                return

            num_frames = data.get("num_frames", 33)
            max_size = data.get("max_size", 2048)

            session_id = uuid.uuid4().hex[:12]
            sessions[session_id] = {"status": "queued", "progress": 0, "frame_count": 0}

            thread = threading.Thread(
                target=process_morph,
                args=(session_id, img_a, img_b, num_frames, max_size),
                daemon=True,
            )
            thread.start()

            self._json_response({"session_id": session_id})

        else:
            self._json_response({"error": "not found"}, 404)

    def log_message(self, format, *args):
        # Quieter logging
        if "/status/" not in (args[0] if args else ""):
            super().log_message(format, *args)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print(f"[MorphBlend] Starting server on port {PORT}")
    print(f"[MorphBlend] Device: {DEVICE}")
    print(f"[MorphBlend] Temp dir: {TEMP_DIR}")

    # Pre-load model
    print("[MorphBlend] Loading FILM model...")
    get_model()
    print("[MorphBlend] Ready!")

    server = http.server.HTTPServer(("127.0.0.1", PORT), MorphHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[MorphBlend] Shutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
