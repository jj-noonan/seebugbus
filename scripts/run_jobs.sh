#!/usr/bin/env bash
#
# Supervisor for the long-running data jobs.
#
# Both are resumable and idempotent — every completed lookup is committed to
# SQLite immediately — so restarting one costs nothing but the request in
# flight. They hit different APIs (Spotify vs MusicBrainz) so they do not
# compete for rate limit, only for the database, which the retry/backoff in
# db.py now handles.
#
# Exists because this shell's children get reaped regularly; supervising both
# from one process means one thing to restart rather than two, and they come
# back on their own between kills.
#
#   bash scripts/run_jobs.sh
set -uo pipefail
cd "$(dirname "$0")/.."
PY=.venv/bin/python
LOG=data/jobs.log

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

supervise() {
  local name="$1"; shift
  while true; do
    # Match on the script path so this loop cannot mistake itself for the job.
    if ! pgrep -f "bin/python -u $1" >/dev/null 2>&1; then
      log "starting $name"
      $PY -u "$@" >> "$LOG" 2>&1 &
    fi
    sleep 60
  done
}

log "supervisor up"
# Spotify is banned until ~23h from 2026-09-03; re-enable after that.
# supervise "spotify" scripts/resolve_spotify.py 30000 &
supervise "ratings" scripts/backfill_ratings.py 25000 &
wait
