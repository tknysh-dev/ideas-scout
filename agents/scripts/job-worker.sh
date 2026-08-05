#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${IDEAS_SCOUT_ENV_FILE:-$HOME/.config/ideas-scout/env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "job-worker.sh: env-файл не знайдено: $ENV_FILE" >&2
  exit 1
fi

set -a
# env-файл користувача (шлях configurable через IDEAS_SCOUT_ENV_FILE) — статично не резолвний
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
exec node "$REPO_ROOT/agents/worker/job-worker.mjs"
