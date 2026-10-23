#!/bin/sh
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR/backend"
exec .venv/bin/uvicorn app.main:app --reload --port 8000
