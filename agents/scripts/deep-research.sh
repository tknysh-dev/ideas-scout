#!/usr/bin/env bash
# Тимчасовий M1-handler кнопки «Глибоке дослідження». Контракт і шлях запуску вже
# production-like; тіло після dry run можна замінити реальною дослідницькою задачею.

set -euo pipefail

IDEA_ID="$(/usr/bin/python3 -c '
import json
import re
import sys

try:
    payload = json.load(sys.stdin)
except (json.JSONDecodeError, OSError) as error:
    raise SystemExit(f"deep-research: payload не є валідним JSON: {error}")

idea_id = payload.get("idea_id") if isinstance(payload, dict) else None
if not isinstance(idea_id, str) or not re.fullmatch(r"[A-Z]{2,10}-[0-9]{3,8}", idea_id):
    raise SystemExit("deep-research: некоректний або відсутній idea_id")
print(idea_id)
')"

DELAY_SECONDS="${IDEAS_SCOUT_DEEP_RESEARCH_DRY_RUN_DELAY_SECONDS:-10}"
case "$DELAY_SECONDS" in
  ''|*[!0-9]*) echo "deep-research: delay має бути цілим числом" >&2; exit 2 ;;
esac
if [ "$DELAY_SECONDS" -gt 30 ]; then
  echo "deep-research: delay не може перевищувати 30 секунд" >&2
  exit 2
fi

echo "deep-research: dry run для ${IDEA_ID} стартував"
sleep "$DELAY_SECONDS"
echo "deep-research: dry run для ${IDEA_ID} успішно завершено через ${DELAY_SECONDS}с"
