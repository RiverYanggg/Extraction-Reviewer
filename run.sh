#!/usr/bin/env bash
# Evidence Note Annotator — one-command launcher.
# Creates a venv on first run, installs deps, then serves the app.
set -euo pipefail
cd "$(dirname "$0")/app"

PY=python3
VENV=.venv

if [ ! -d "$VENV" ]; then
  echo "▶ creating virtualenv…"
  $PY -m venv "$VENV"
  ./$VENV/bin/python -m pip install --quiet --upgrade pip
fi

echo "▶ installing dependencies…"
./$VENV/bin/python -m pip install --quiet -r requirements.txt

PORT="${PORT:-8765}"
echo "▶ Evidence Note Annotator → http://127.0.0.1:${PORT}"
exec ./$VENV/bin/python -m uvicorn server:app --host 127.0.0.1 --port "$PORT"
