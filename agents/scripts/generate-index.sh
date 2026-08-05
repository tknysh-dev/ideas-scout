#!/usr/bin/env bash
# generate-index.sh — будує registries/<track>/ideas.md (індекс, у .gitignore, не комітиться)
# з frontmatter усіх записів у registries/<track>/ideas/*.md.
#
# Використання: generate-index.sh <passive-income|app-ideas>   (без аргументу — обидва треки)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT" || exit 2

# shellcheck source=agents/scripts/scripts-lib.sh
source "$SCRIPT_DIR/scripts-lib.sh"

build_index() {
  local track="$1"
  local ideas_dir="$REPO_ROOT/registries/${track}/ideas"
  local out_file="$REPO_ROOT/registries/${track}/ideas.md"

  if [ ! -d "$ideas_dir" ]; then
    echo "generate-index.sh: тека $ideas_dir не знайдена — пропускаю трек $track" >&2
    return 0
  fi

  {
    generate_index_header "$track" "$(date -u +%FT%TZ)"

    local f id title type status rejection_code confidence
    shopt -s nullglob
    for f in "$ideas_dir"/*.md; do
      id="$(extract_field "$f" id)"
      title="$(extract_field "$f" title)"
      type="$(extract_field "$f" type)"
      status="$(extract_field "$f" status)"
      rejection_code="$(extract_field "$f" rejection_code)"
      confidence="$(extract_field "$f" confidence)"
      generate_index_row "$id" "$title" "$type" "$status" "$rejection_code" "$confidence"
    done
    shopt -u nullglob
  } > "$out_file"

  echo "generate-index.sh: побудовано $out_file"
}

if [ $# -eq 0 ]; then
  build_index "passive-income"
  build_index "app-ideas"
else
  build_index "$1"
fi
