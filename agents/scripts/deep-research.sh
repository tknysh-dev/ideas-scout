#!/usr/bin/env bash
# M1-handler кнопки «Глибоке дослідження». Контракт незмінний з часів dry run:
# stdin — JSON {"idea_id": "PI-0013"}, ненульовий exit = провал джоба.
# Уся оркестрація (моделі-дослідники → крос-допит → синтез → запис у БД) —
# у deep-research.py; IDEAS_SCOUT_DEEP_RESEARCH_DRY_RUN=1 лишає швидкий
# інфраструктурний прогін без жодного виклику LLM.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec /usr/bin/python3 "$SCRIPT_DIR/deep-research.py" "$@"
