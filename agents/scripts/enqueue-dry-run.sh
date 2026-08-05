#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=agents/scripts/db.sh
source "$REPO_ROOT/agents/scripts/db.sh"

REQUESTED_BY="owner:local-test"
BODY="$(python3 -c 'import json,sys; print(json.dumps({"type":"infrastructure_dry_run","requested_by":sys.argv[1]}))' "$REQUESTED_BY")"
_db_request POST "/jobs" "$BODY"
