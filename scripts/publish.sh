#!/usr/bin/env bash
# Refresh the published catalog snapshot and deploy.
#
# The site serves a frozen export, so publishing means: re-export from SQLite,
# commit if the data actually changed, push. The Pages workflow does the rest.
set -uo pipefail
cd "$(dirname "$0")/.."

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

log "publishing — db state:"
.venv/bin/python -c "
import sys; sys.path.insert(0,'scripts'); import db
c = db.connect(); print('   ', db.stats(c)); print('   ', db.crawl_progress(c))"

# Freshly crawled albums have no listener count until a sweep ends, and the
# export stratifies by popularity — without this they would all pile into the
# bottom decile and crowd out the real deep cuts.
log "backfilling popularity before export"
.venv/bin/python scripts/backfill_popularity.py 2>&1 | tail -2

.venv/bin/python scripts/export_catalog.py || { log "export failed"; exit 1; }

if git diff --quiet -- src/data/catalog.json; then
  log "catalog unchanged — nothing to publish"
  exit 0
fi

ALBUMS=$(.venv/bin/python -c "import json;print(json.load(open('src/data/catalog.json'))['stats']['albums'])")
TOTAL=$(.venv/bin/python -c "import json;print(json.load(open('src/data/catalog.json'))['stats']['totalInDb'])")

git add src/data/catalog.json
git commit -q -m "Publish catalog snapshot: ${ALBUMS} of ${TOTAL} albums

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011LxfVt6m24HUxSJpzbfTyk" || { log "commit failed"; exit 1; }

git push origin main || { log "push failed"; exit 1; }
log "published ${ALBUMS} of ${TOTAL} albums; Pages workflow triggered"
