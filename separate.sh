#!/usr/bin/env bash
# Offline source separation on this machine: ./separate.sh song.mp3 [options]
# Run ./separate.sh --help for all options. First-time setup: backend/separator/setup.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")/backend/separator" && pwd)"
PY="$DIR/.venv/bin/python"
if [ ! -x "$PY" ]; then
  echo "Python environment not found. Run first:  backend/separator/setup.sh   (or: setup.sh cpu)" >&2
  exit 1
fi
exec "$PY" "$DIR/offline.py" "$@"
