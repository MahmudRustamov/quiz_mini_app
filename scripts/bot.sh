#!/bin/sh
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR/backend"
if [ "${1:-poll}" = "poll" ]; then
  # Explicit local polling command; production settings reject polling.
  BOT_MODE=polling
  export BOT_MODE
fi
exec .venv/bin/python -m app.bot.main "${1:-poll}"
