#!/usr/bin/env bash
# Create the Python environment for the HTDemucs separation worker.
#
#   ./setup.sh          CUDA 12.8 build of PyTorch (NVIDIA GPU)
#   ./setup.sh cpu      CPU-only build (much slower, no GPU needed)
#
# Requires Python 3.10-3.12 and ffmpeg on PATH.
set -euo pipefail

cd "$(dirname "$0")"
VARIANT="${1:-cu128}"
TORCH_INDEX="https://download.pytorch.org/whl/${VARIANT}"
PY="${PYTHON:-}"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "error: ffmpeg is required (used to decode input audio and encode stems)" >&2
  exit 1
fi

# Pick a supported Python interpreter.
if [ -z "$PY" ]; then
  for c in python3.11 python3.12 python3.10; do
    if command -v "$c" >/dev/null 2>&1; then PY="$c"; break; fi
  done
fi
if [ -z "$PY" ]; then
  echo "error: Python 3.10-3.12 not found (set PYTHON=/path/to/python)" >&2
  exit 1
fi
echo "Using $PY, PyTorch index: $TORCH_INDEX"

if command -v uv >/dev/null 2>&1; then
  uv venv --python "$PY" .venv
  uv pip install --python .venv/bin/python --extra-index-url "$TORCH_INDEX" -r requirements.txt
else
  "$PY" -m venv .venv
  .venv/bin/pip install --upgrade pip
  .venv/bin/pip install --extra-index-url "$TORCH_INDEX" -r requirements.txt
fi

echo
.venv/bin/python separate.py --check
echo
echo "Done. The backend uses backend/separator/.venv/bin/python automatically."
