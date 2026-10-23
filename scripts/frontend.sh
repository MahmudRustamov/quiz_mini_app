#!/bin/sh
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if ! command -v node >/dev/null 2>&1; then
  PATH="$ROOT_DIR/.runtime/node-v22.23.4-darwin-arm64/bin:$PATH"
  export PATH
fi
cd "$ROOT_DIR/frontend"
exec npm run "${1:-dev}"
