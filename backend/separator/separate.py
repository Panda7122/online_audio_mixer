#!/usr/bin/env python3
"""HTDemucs source-separation worker.

Invoked by the Node.js backend. Communicates through JSON lines on stdout:
    {"event": "status",   "stage": "loading_model" | "decoding" | "separating" | "encoding"}
    {"event": "progress", "value": 0.0 .. 1.0}
    {"event": "done",     "samplerate": 44100, "stems": [{"name": "vocals", "path": "..."}]}
    {"event": "error",    "message": "..."}

Usage:
    separate.py --check
    separate.py --input song.mp3 --outdir /tmp/out [--model htdemucs] [--device auto]
                [--shifts 1] [--overlap 0.25] [--stems vocals,drums] [--format flac]
"""
import argparse
import json
import os
import subprocess
import sys

MODELS = {
    "htdemucs": ["drums", "bass", "other", "vocals"],
    "htdemucs_ft": ["drums", "bass", "other", "vocals"],
    "htdemucs_6s": ["drums", "bass", "other", "vocals", "guitar", "piano"],
}


def emit(**payload):
    """Write one JSON event line for the backend."""
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def decode_audio(path, samplerate):
    """Decode any ffmpeg-readable file to a float32 array of shape (2, samples)."""
    import numpy as np

    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-i", path,
           "-f", "f32le", "-acodec", "pcm_f32le", "-ac", "2", "-ar", str(samplerate), "-"]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError("ffmpeg could not decode the input: " + proc.stderr.decode(errors="replace").strip())
    data = np.frombuffer(proc.stdout, dtype=np.float32)
    if data.size < 2:
        raise RuntimeError("The input file contains no audio")
    return data.reshape(-1, 2).T.copy()


CODECS = {
    "flac": ["-c:a", "flac", "-sample_fmt", "s16"],
    "wav": ["-c:a", "pcm_s16le"],
    "mp3": ["-c:a", "libmp3lame", "-b:a", "320k"],
}


def encode_audio(data, samplerate, path, fmt):
    """Encode a (2, samples) float array to FLAC (16-bit), WAV (16-bit PCM) or MP3 (320 kbps)."""
    import numpy as np

    codec = CODECS[fmt]
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-y",
           "-f", "f32le", "-ac", "2", "-ar", str(samplerate), "-i", "-", *codec, path]
    raw = np.ascontiguousarray(np.clip(data, -1.0, 1.0).T, dtype=np.float32).tobytes()
    proc = subprocess.run(cmd, input=raw, capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError("ffmpeg could not encode a stem: " + proc.stderr.decode(errors="replace").strip())


def pick_device(requested):
    import torch

    if requested == "auto":
        if torch.cuda.is_available():
            return "cuda"
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
        return "cpu"
    return requested


def check():
    """Report whether the environment can run separation."""
    import shutil

    import demucs
    import torch

    device = pick_device("auto")
    emit(
        event="check",
        ok=shutil.which("ffmpeg") is not None,
        ffmpeg=shutil.which("ffmpeg") is not None,
        device=device,
        gpu=torch.cuda.get_device_name(0) if device == "cuda" else None,
        torch=torch.__version__,
        demucs=demucs.__version__,
        models=MODELS,
    )


def install_progress_hook(total_passes, report=None):
    """Report progress by replacing the tqdm wrapper demucs uses when progress=True.

    demucs.apply calls tqdm.tqdm(futures, ...) once per model pass (models in a bag x shifts);
    each item is one audio chunk that gets computed while we iterate.
    `report(value)` receives progress in 0..1 (default: a JSON progress event).
    """
    report = report or (lambda value: emit(event="progress", value=value))
    import demucs.apply as dapply

    state = {"pass": 0, "last": -1.0}

    class ProgressTqdm:
        @staticmethod
        def tqdm(iterable, **_kwargs):
            items = list(iterable)
            n = max(1, len(items))
            current = state["pass"]
            for i, item in enumerate(items):
                yield item
                value = min(1.0, (current + (i + 1) / n) / total_passes)
                if value - state["last"] >= 0.005 or value >= 1.0:
                    state["last"] = value
                    report(round(value, 4))
            state["pass"] += 1

    dapply.tqdm = ProgressTqdm


def count_passes(model, shifts):
    """Number of model passes apply_model makes (models in a bag x random shifts)."""
    from demucs.apply import BagOfModels

    return (len(model.models) if isinstance(model, BagOfModels) else 1) * max(1, shifts)


def run_model(model, wav, device, shifts, overlap):
    """Separate a (2, samples) tensor; returns (sources, 2, samples) on the CPU."""
    import torch
    from demucs.apply import apply_model

    # Normalize like the official demucs CLI, then undo it on the output.
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    with torch.no_grad():
        out = apply_model(model, ((wav - mean) / std)[None], device=device, shifts=shifts, split=True,
                          overlap=overlap, progress=True)[0]
    return (out * std + mean).cpu()


def separate(args):
    import torch
    from demucs.pretrained import get_model

    os.makedirs(args.outdir, exist_ok=True)
    device = pick_device(args.device)

    emit(event="status", stage="loading_model", device=device)
    model = get_model(args.model)  # downloads weights into $TORCH_HOME on first use
    model.eval()
    samplerate = model.samplerate
    sources = list(model.sources)
    wanted = [s for s in (args.stems.split(",") if args.stems else sources) if s in sources]
    if not wanted:
        raise RuntimeError("None of the requested stems exist in model " + args.model)

    emit(event="status", stage="decoding")
    wav = torch.from_numpy(decode_audio(args.input, samplerate))

    install_progress_hook(count_passes(model, args.shifts))
    emit(event="status", stage="separating", device=device)
    out = run_model(model, wav, device, args.shifts, args.overlap)

    emit(event="status", stage="encoding")
    stems = []
    for name, source in zip(sources, out):
        if name not in wanted:
            continue
        path = os.path.join(args.outdir, f"{name}.{args.format}")
        encode_audio(source.numpy(), samplerate, path, args.format)
        stems.append({"name": name, "path": path})

    emit(event="done", samplerate=samplerate, model=args.model, stems=stems)


def main():
    ap = argparse.ArgumentParser(description="HTDemucs source separation worker")
    ap.add_argument("--check", action="store_true", help="check the environment and exit")
    ap.add_argument("--input")
    ap.add_argument("--outdir")
    ap.add_argument("--model", default="htdemucs", choices=sorted(MODELS))
    ap.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu", "mps"])
    ap.add_argument("--shifts", type=int, default=1, help="random shifts (1-10); more = better and slower")
    ap.add_argument("--overlap", type=float, default=0.25)
    ap.add_argument("--stems", default="", help="comma-separated stems to keep (default: all)")
    ap.add_argument("--format", default="flac", choices=["flac", "wav"])
    args = ap.parse_args()

    try:
        if args.check:
            check()
            return
        if not args.input or not args.outdir:
            ap.error("--input and --outdir are required")
        args.shifts = max(1, min(10, args.shifts))
        args.overlap = max(0.0, min(0.9, args.overlap))
        separate(args)
    except Exception as exc:  # report every failure as a JSON event
        emit(event="error", message=f"{type(exc).__name__}: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
