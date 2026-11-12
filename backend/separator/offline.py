#!/usr/bin/env python3
"""Offline HTDemucs source separation on your own machine (no server, no website).

Examples:
    ./offline.py song.mp3                         # -> separated/song/{drums,bass,other,vocals}.wav
    ./offline.py song.mp3 --karaoke               # -> separated/song/{vocals,instrumental}.wav
    ./offline.py music/ -o stems --format flac    # every audio file in a folder (recursive)
    ./offline.py song.mp3 --model htdemucs_6s     # also guitar and piano
    ./offline.py song.mp3 --model htdemucs_ft --shifts 4   # best quality, slower

Model weights are cached in ./models (override with TORCH_HOME); once a model has been
downloaded, separation works without an internet connection.
"""
import argparse
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault("TORCH_HOME", os.path.join(HERE, "models"))
sys.path.insert(0, HERE)

import separate as sep  # noqa: E402  (shared decode / model / encode helpers)

AUDIO_EXT = {".wav", ".mp3", ".flac", ".ogg", ".oga", ".opus", ".m4a", ".aac", ".wma", ".aiff", ".aif",
             ".webm", ".mp4", ".mkv", ".mov"}


def find_inputs(paths):
    """Expand files and folders (recursively) into a sorted list of audio files."""
    files = []
    for p in paths:
        if os.path.isdir(p):
            for root, _dirs, names in os.walk(p):
                files += [os.path.join(root, n) for n in names if os.path.splitext(n)[1].lower() in AUDIO_EXT]
        elif os.path.isfile(p):
            files.append(p)
        else:
            print(f"warning: not found: {p}", file=sys.stderr)
    return sorted(dict.fromkeys(os.path.abspath(f) for f in files))


def progress_bar(prefix):
    """Return a report(value) callback that draws a one-line progress bar."""
    start = time.time()

    def report(value):
        width = 30
        filled = int(width * value)
        elapsed = time.time() - start
        eta = f"{elapsed / value - elapsed:4.0f}s left" if 0 < value < 1 else f"{elapsed:4.0f}s"
        sys.stderr.write(f"\r  {prefix} [{'#' * filled}{'.' * (width - filled)}] {value * 100:5.1f}%  {eta}")
        sys.stderr.flush()
        if value >= 1:
            sys.stderr.write("\n")

    return report


def plan_outputs(sources, args):
    """List of (output name, [source indices summed into it])."""
    if args.karaoke or args.two_stems:
        target = args.two_stems or "vocals"
        if target not in sources:
            raise SystemExit(f"error: model {args.model} has no stem '{target}' (has: {', '.join(sources)})")
        rest = "instrumental" if target == "vocals" else f"no_{target}"
        return [(target, [sources.index(target)]), (rest, [i for i, s in enumerate(sources) if s != target])]
    wanted = args.stems.split(",") if args.stems else sources
    bad = [s for s in wanted if s not in sources]
    if bad:
        raise SystemExit(f"error: model {args.model} has no stem {', '.join(bad)} (has: {', '.join(sources)})")
    return [(s, [sources.index(s)]) for s in wanted]


def main():
    ap = argparse.ArgumentParser(
        description="Split songs into stems (vocals, drums, bass, ...) locally with HTDemucs.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__.split("Examples:", 1)[1].split("Model weights", 1)[0].rstrip(),
    )
    ap.add_argument("inputs", nargs="+", help="audio files or folders")
    ap.add_argument("-o", "--outdir", default="separated", help="output folder (default: ./separated)")
    ap.add_argument("-m", "--model", default="htdemucs", choices=sorted(sep.MODELS),
                    help="htdemucs (default, fast) | htdemucs_ft (better, 4x slower) | htdemucs_6s (+guitar, piano)")
    ap.add_argument("-f", "--format", default="wav", choices=sorted(sep.CODECS), help="output format (default: wav)")
    ap.add_argument("--karaoke", action="store_true", help="output only vocals + instrumental")
    ap.add_argument("--two-stems", metavar="STEM", help="output STEM + everything else (e.g. drums -> drums, no_drums)")
    ap.add_argument("--stems", default="", help="comma-separated stems to keep, e.g. vocals,bass (default: all)")
    ap.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu", "mps"])
    ap.add_argument("--shifts", type=int, default=1, help="random shifts 1-10: more = slightly better, linearly slower")
    ap.add_argument("--overlap", type=float, default=0.25, help="chunk overlap 0-0.9 (default 0.25)")
    ap.add_argument("--overwrite", action="store_true", help="redo songs whose output already exists")
    args = ap.parse_args()
    args.shifts = max(1, min(10, args.shifts))
    args.overlap = max(0.0, min(0.9, args.overlap))

    files = find_inputs(args.inputs)
    if not files:
        raise SystemExit("error: no audio files found")

    import shutil

    if not shutil.which("ffmpeg"):
        raise SystemExit("error: ffmpeg is required (install it and make sure it is on PATH)")

    import torch
    from demucs.pretrained import get_model

    device = sep.pick_device(args.device)
    gpu = f" ({torch.cuda.get_device_name(0)})" if device == "cuda" else ""
    print(f"Loading {args.model} on {device}{gpu} ...", file=sys.stderr)
    model = get_model(args.model)
    model.eval()
    sources = list(model.sources)
    outputs = plan_outputs(sources, args)
    passes = sep.count_passes(model, args.shifts)

    failed = []
    for n, path in enumerate(files, 1):
        name = os.path.splitext(os.path.basename(path))[0]
        song_dir = os.path.join(args.outdir, name)
        targets = [os.path.join(song_dir, f"{o}.{args.format}") for o, _ in outputs]
        print(f"[{n}/{len(files)}] {os.path.basename(path)}", file=sys.stderr)
        if not args.overwrite and all(os.path.exists(t) for t in targets):
            print("  already separated, skipping (use --overwrite to redo)", file=sys.stderr)
            continue
        try:
            wav = torch.from_numpy(sep.decode_audio(path, model.samplerate))
            sep.install_progress_hook(passes, progress_bar("separating"))
            out = sep.run_model(model, wav, device, args.shifts, args.overlap)
            os.makedirs(song_dir, exist_ok=True)
            for (label, idx), target in zip(outputs, targets):
                sep.encode_audio(out[idx].sum(0).numpy(), model.samplerate, target, args.format)
            print(f"  -> {song_dir}/ ({', '.join(o for o, _ in outputs)})", file=sys.stderr)
        except KeyboardInterrupt:
            raise SystemExit("\ninterrupted")
        except Exception as exc:  # keep going with the remaining files
            print(f"\n  failed: {type(exc).__name__}: {exc}", file=sys.stderr)
            failed.append(path)
        finally:
            if device == "cuda":
                torch.cuda.empty_cache()

    if failed:
        print(f"\n{len(failed)} file(s) failed:", *failed, sep="\n  ", file=sys.stderr)
        sys.exit(1)
    print("\nDone.", file=sys.stderr)


if __name__ == "__main__":
    main()
