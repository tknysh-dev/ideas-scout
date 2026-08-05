#!/usr/bin/env bash
# check.sh — одна команда, що перед комітом ганяє всі статичні перевірки й
# тести: синтаксис і shellcheck усіх shell-скриптів, компільованість і lint
# python-скриптів агентів, типи/lint/тести порталу (dashboard/) і тести
# воркера (agents/worker/). Мета — зловити те, що інакше випливе аж на
# проді чи в наступному прогоні runner.sh.
#
# Як і doctor.sh, check.sh НЕ зупиняється на першій помилці: проганяє всі
# перевірки й доповідає підсумок у кінці. Це той самий стиль виводу і той
# самий контракт кодів виходу.
#
# ГОЛОВНЕ ПРАВИЛО: кожен новий вид коду в репозиторії (нова мова, новий
# підкаталог зі скриптами чи власним package.json) має отримати тут свою
# перевірку — інакше поламаний код мовчки долетить до коміту.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"
cd "$REPO_ROOT" || exit 2

FAST=0
while [ $# -gt 0 ]; do
  case "$1" in
    --fast) FAST=1 ;;
    -h|--help)
      cat <<'EOF'
Використання: check.sh [--fast]

  --fast  пропустити повільне: tsc --noEmit і npm run lint у dashboard/.
          Тести й shell/python-перевірки лишаються. Цей режим використовує
          pre-commit hook — щоб коміт не чекав на повний прогін порталу.

Без прапорців ганяє все: shell (bash -n, shellcheck), python (py_compile,
ruff), портал (tsc, lint, test) і воркер (test).

Коди виходу: 0 — усе чисто (NOTE не рахуються за помилку); 1 — є хоча б
одна помилка; 2 — помилка використання самого скрипта (невідомий прапорець).
EOF
      exit 0 ;;
    *) echo "check.sh: невідомий аргумент: $1" >&2; exit 2 ;;
  esac
  shift
done

OK_COUNT=0
WARN_COUNT=0
ERR_COUNT=0

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'
else
  C_RESET=""; C_BOLD=""; C_DIM=""; C_OK=""; C_WARN=""; C_ERR=""
fi

section() { printf '\n%s%s%s\n' "$C_BOLD" "$1" "$C_RESET"; }
ok()   { OK_COUNT=$((OK_COUNT + 1));   printf '  %s✔%s  %s\n' "$C_OK" "$C_RESET" "$1"; }
err()  { ERR_COUNT=$((ERR_COUNT + 1));  printf '  %s✘%s  %s\n' "$C_ERR" "$C_RESET" "$1"; }
note() { printf '  %s·  %s%s\n' "$C_DIM" "$1" "$C_RESET"; }

START_EPOCH="$(date +%s)"
step_start() { STEP_EPOCH="$(date +%s)"; note "$1…"; }
step_elapsed() { echo "$(( $(date +%s) - STEP_EPOCH ))с"; }

printf '%sideas-scout check%s  %s%s\n' "$C_BOLD" "$C_RESET" "$(date '+%F %H:%M')" "$([ "$FAST" -eq 1 ] && echo "  (--fast)")"

# ---------------------------------------------------------------------------
section "Shell"
# ---------------------------------------------------------------------------
shopt -s nullglob
SHELL_FILES=("$REPO_ROOT/agents/scripts"/*.sh "$REPO_ROOT/dev.sh" \
             "$REPO_ROOT/shared/migrations/apply.sh" "$REPO_ROOT/check.sh" \
             "$REPO_ROOT/hooks/pre-commit")
shopt -u nullglob

for f in "${SHELL_FILES[@]}"; do
  rel="${f#"$REPO_ROOT"/}"
  SYNTAX_ERR="$(bash -n "$f" 2>&1)"
  if [ -z "$SYNTAX_ERR" ]; then
    ok "синтаксис ок: ${rel}"
  else
    err "синтаксична помилка в ${rel}: $(printf '%s' "$SYNTAX_ERR" | tr '\n' ' ')"
  fi
done

if command -v shellcheck >/dev/null 2>&1; then
  # Поріг піднято до --severity=style (найсуворіший рівень shellcheck): усі
  # скрипти проєкту тепер проходять його чисто. Кожен sourced-файл (test-lib.sh,
  # db-lib.sh, runner-lib.sh, db.sh) має власну директиву
  # "# shellcheck source=<шлях>" над відповідним source — завдяки цьому shellcheck
  # реально читає той файл (а не лише гасить SC1091/SC1090), і саме тому весь
  # список файлів так само передається одним викликом: sourced-файли мають бути
  # серед аргументів, інакше директива source= не спрацює. Де шлях справді
  # динамічний (env-файл користувача) — окремий "# shellcheck disable=SC1090" з
  # поясненням поруч. Рядок коментаря не має починатися зі слова shellcheck —
  # воно читається як директива й ламає розбір файлу.
  step_start "shellcheck (--severity=style) для ${#SHELL_FILES[@]} файлів"
  SC_OUT="$(shellcheck --severity=style "${SHELL_FILES[@]}" 2>&1)"
  SC_STATUS=$?
  if [ "$SC_STATUS" -eq 0 ]; then
    ok "shellcheck: зауважень немає, включно зі стилем ($(step_elapsed))"
  else
    err "shellcheck знайшов зауваження ($(step_elapsed)):"
    printf '%s\n' "$SC_OUT" | sed 's/^/      /'
  fi
else
  note "shellcheck не встановлений — перевірку пропущено (brew install shellcheck)"
fi

# ---------------------------------------------------------------------------
section "Тести скриптів"
# ---------------------------------------------------------------------------
shopt -s nullglob
SH_TESTS=("$REPO_ROOT/agents/scripts"/*.test.sh)
shopt -u nullglob

if [ "${#SH_TESTS[@]}" -eq 0 ]; then
  note "немає жодного agents/scripts/*.test.sh"
else
  for f in "${SH_TESTS[@]}"; do
    rel="${f#"$REPO_ROOT"/}"
    step_start "$rel"
    T_OUT="$("$f" 2>&1)"
    T_STATUS=$?
    if [ "$T_STATUS" -eq 0 ]; then
      ok "${rel}: $(printf '%s' "$T_OUT" | tail -1) ($(step_elapsed))"
    else
      err "${rel} провалився ($(step_elapsed)):"
      printf '%s\n' "$T_OUT" | sed 's/^/      /'
    fi
  done
fi

# unittest зі стдлібу, без pytest: перевірки мають працювати на голій машині.
# -t тека тестів, бо скрипти агентів імпортуються через test_support.load_script,
# і той шим лежить поруч із ними, а не в корені репозиторію.
step_start "python3 -m unittest (agents/scripts/*_test.py)"
PY_TEST_OUT="$(cd "$REPO_ROOT/agents/scripts" && python3 -m unittest discover -p '*_test.py' -t . 2>&1)"
PY_TEST_STATUS=$?
if [ "$PY_TEST_STATUS" -eq 0 ]; then
  ok "unittest: $(printf '%s' "$PY_TEST_OUT" | grep -E '^Ran ' | head -1) ($(step_elapsed))"
else
  err "unittest провалився ($(step_elapsed)):"
  printf '%s\n' "$PY_TEST_OUT" | sed 's/^/      /'
fi

# ---------------------------------------------------------------------------
section "Python"
# ---------------------------------------------------------------------------
shopt -s nullglob
PY_FILES=("$REPO_ROOT/agents/scripts"/*.py)
shopt -u nullglob

for f in "${PY_FILES[@]}"; do
  rel="${f#"$REPO_ROOT"/}"
  if PY_ERR="$(python3 -m py_compile "$f" 2>&1)"; then
    ok "компілюється: ${rel}"
  else
    err "не компілюється ${rel}: $(printf '%s' "$PY_ERR" | tr '\n' ' ')"
  fi
done
find "$REPO_ROOT/agents/scripts" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null

# Конвеєр запускає deep-research.py явно через /usr/bin/python3 (див.
# deep-research.sh), а це системний python macOS — 3.9, значно старший за той,
# що в PATH. Різниця не гіпотетична: ruff із неправильним target-version уже
# радив тут datetime.UTC (3.11+), і скрипт падав би ImportError на першому ж
# нічному прогоні, бо py_compile і тести бачать лише новий python.
SYSTEM_PY="/usr/bin/python3"
if [ -x "$SYSTEM_PY" ]; then
  step_start "$SYSTEM_PY ($("$SYSTEM_PY" --version 2>&1)) завантажує deep-research.py"
  SYSPY_OUT="$("$SYSTEM_PY" -c '
import importlib.util, sys
spec = importlib.util.spec_from_file_location("m", "agents/scripts/deep-research.py")
module = importlib.util.module_from_spec(spec)
sys.modules["m"] = module
spec.loader.exec_module(module)
' 2>&1)"
  SYSPY_STATUS=$?
  if [ "$SYSPY_STATUS" -eq 0 ]; then
    ok "deep-research.py завантажується системним python ($(step_elapsed))"
  else
    err "deep-research.py НЕ завантажується під $SYSTEM_PY — нічний прогін впаде ($(step_elapsed)):"
    printf '%s\n' "$SYSPY_OUT" | sed 's/^/      /'
  fi
else
  note "немає $SYSTEM_PY — перевірку сумісності з системним python пропущено"
fi

if command -v ruff >/dev/null 2>&1; then
  step_start "ruff check agents/scripts/"
  RUFF_OUT="$(ruff check "$REPO_ROOT/agents/scripts/" 2>&1)"
  RUFF_STATUS=$?
  if [ "$RUFF_STATUS" -eq 0 ]; then
    ok "ruff: зауважень немає ($(step_elapsed))"
  else
    err "ruff знайшов зауваження ($(step_elapsed)):"
    printf '%s\n' "$RUFF_OUT" | sed 's/^/      /'
  fi
else
  note "ruff не встановлений — перевірку пропущено (brew install ruff)"
fi

# ---------------------------------------------------------------------------
section "Портал (dashboard/)"
# ---------------------------------------------------------------------------
if [ ! -d "$REPO_ROOT/dashboard/node_modules" ]; then
  note "немає node_modules, спершу npm install --prefix dashboard"
else
  # Без subshell: ok/err пишуть у OK_COUNT/ERR_COUNT поточного процесу, а
  # subshell (…) їх би загубив — лічильники не виходять за межі підпроцесу.
  cd "$REPO_ROOT/dashboard" || exit 2

  if [ "$FAST" -eq 1 ]; then
    note "--fast: tsc --noEmit і lint пропущено"
  else
    # --no-install: якщо tsc раптом відсутній у node_modules, хочемо
    # чіткий err нижче, а не мовчазне автовстановлення npx посеред перевірки.
    step_start "tsc --noEmit"
    TSC_OUT="$(npx --no-install tsc --noEmit 2>&1)"
    TSC_STATUS=$?
    if [ "$TSC_STATUS" -eq 0 ]; then
      ok "tsc --noEmit: типи ок ($(step_elapsed))"
    else
      err "tsc --noEmit знайшов помилки типів ($(step_elapsed)):"
      printf '%s\n' "$TSC_OUT" | sed 's/^/      /'
    fi

    step_start "npm run lint"
    LINT_OUT="$(npm run lint 2>&1)"
    LINT_STATUS=$?
    if [ "$LINT_STATUS" -eq 0 ]; then
      ok "npm run lint: зауважень немає ($(step_elapsed))"
    else
      err "npm run lint знайшов зауваження ($(step_elapsed)):"
      printf '%s\n' "$LINT_OUT" | sed 's/^/      /'
    fi
  fi

  step_start "npm test"
  TEST_OUT="$(npm test 2>&1)"
  TEST_STATUS=$?
  if [ "$TEST_STATUS" -eq 0 ]; then
    ok "npm test: тести пройшли ($(step_elapsed))"
  else
    err "npm test провалився ($(step_elapsed)):"
    printf '%s\n' "$TEST_OUT" | sed 's/^/      /'
  fi
  cd "$REPO_ROOT" || exit 2
fi

# ---------------------------------------------------------------------------
section "Воркер (agents/worker/)"
# ---------------------------------------------------------------------------
# Без гейта на node_modules: job-worker.mjs не має зовнішніх імпортів (supabase
# інжектиться зовні), тож тести воркера йдуть на голому node. Гейт тут означав
# би, що на машині без npm install ці тести тихо не запускаються ніколи.
cd "$REPO_ROOT/agents/worker" || exit 2
step_start "npm test"
TEST_OUT="$(npm test 2>&1)"
TEST_STATUS=$?
if [ "$TEST_STATUS" -eq 0 ]; then
  ok "npm test: тести пройшли ($(step_elapsed))"
else
  err "npm test провалився ($(step_elapsed)):"
  printf '%s\n' "$TEST_OUT" | sed 's/^/      /'
fi
cd "$REPO_ROOT" || exit 2

# ---------------------------------------------------------------------------
TOTAL_ELAPSED=$(( $(date +%s) - START_EPOCH ))
printf '\n%s%s%s  (%sс)\n' "$C_BOLD" "Підсумок" "$C_RESET" "$TOTAL_ELAPSED"
printf '  %s%d ок%s  ·  %s%d попереджень%s  ·  %s%d проблем%s\n\n' \
  "$C_OK" "$OK_COUNT" "$C_RESET" "$C_WARN" "$WARN_COUNT" "$C_RESET" "$C_ERR" "$ERR_COUNT" "$C_RESET"

if [ "$ERR_COUNT" -gt 0 ]; then
  echo "Є помилки — дивись рядки з ✘ вище. Коміт краще притримати."
  exit 1
fi
echo "Усе чисто."
exit 0
