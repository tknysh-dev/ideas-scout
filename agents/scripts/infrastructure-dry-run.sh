#!/usr/bin/env bash
set -euo pipefail

DELAY_SECONDS="${IDEAS_SCOUT_DRY_RUN_DELAY_SECONDS:-10}"
case "$DELAY_SECONDS" in
  ''|*[!0-9]*) echo "infrastructure-dry-run: delay має бути цілим числом" >&2; exit 2 ;;
esac
if [ "$DELAY_SECONDS" -gt 30 ]; then
  echo "infrastructure-dry-run: delay не може перевищувати 30 секунд" >&2
  exit 2
fi

echo "infrastructure-dry-run: старт"
sleep "$DELAY_SECONDS"
echo "infrastructure-dry-run: успішно завершено через ${DELAY_SECONDS}с"
