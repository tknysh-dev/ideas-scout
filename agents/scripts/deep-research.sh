#!/usr/bin/env bash
# M1-handler глибокого дослідження (job deep_research_synthesis). Контракт
# незмінний з часів dry run: stdin — JSON {"idea_id": "PI-0013"}, ненульовий
# exit = провал джоба. Уся оркестрація (звіти зовнішніх моделей з БД → синтез
# Claude → запис у БД) — у deep-research.py;
# IDEAS_SCOUT_DEEP_RESEARCH_DRY_RUN=1 лишає швидкий інфраструктурний прогін
# без жодного виклику LLM.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec /usr/bin/python3 "$SCRIPT_DIR/deep-research.py" "$@"
