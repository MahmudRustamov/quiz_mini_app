#!/bin/sh
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"
PG_BIN=${PG_BIN:-/opt/homebrew/bin}
PG_PORT=${PG_PORT:-55432}
case "${1:-start}" in
  start)
    if [ ! -f data/pg/PG_VERSION ]; then
      mkdir -p data/pg
      "$PG_BIN/initdb" -D data/pg -A trust --no-locale -E UTF8
    fi
    if ! "$PG_BIN/pg_ctl" -D data/pg status >/dev/null 2>&1; then
      "$PG_BIN/pg_ctl" -D data/pg -l data/pg/server.log -o "-h 127.0.0.1 -p $PG_PORT -k /private/tmp" start
    fi
    if [ "$("$PG_BIN/psql" -h 127.0.0.1 -p "$PG_PORT" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='milliy_sertifikat'")" != "1" ]; then
      "$PG_BIN/createdb" -h 127.0.0.1 -p "$PG_PORT" milliy_sertifikat
    fi
    ;;
  stop) "$PG_BIN/pg_ctl" -D data/pg stop ;;
  status) "$PG_BIN/pg_ctl" -D data/pg status ;;
  *) echo 'Usage: scripts/database.sh start|stop|status'; exit 1 ;;
esac
