#!/usr/bin/env bash
# check.sh — одна команда, що перед push'ем ганяє всі статичні перевірки й
# тести: синтаксис і shellcheck shell-скриптів, компільованість і ruff
# python-скриптів агентів, усі набори тестів, контракт промптів, узгодженість
# міграцій зі схемою, валідність launchd-plist, пошук секретів, і типи/lint/
# збірку/тести порталу та воркера. Мета — зловити те, що інакше випливе аж на
# проді чи в наступному прогоні runner.sh.
#
# Як і doctor.sh, check.sh НЕ зупиняється на першій помилці: проганяє всі
# перевірки й доповідає підсумок у кінці. Це той самий стиль виводу і той
# самий контракт кодів виходу.
#
# ГОЛОВНЕ ПРАВИЛО: кожен новий вид коду в репозиторії (нова мова, новий
# підкаталог зі скриптами чи власним package.json) має отримати тут свою
# перевірку — інакше поламаний код мовчки долетить до remote.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"
cd "$REPO_ROOT" || exit 2

FAST=0
COVERAGE=0
SECRETS_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --fast) FAST=1 ;;
    --coverage) COVERAGE=1 ;;
    --secrets) SECRETS_ONLY=1 ;;
    -h|--help)
      cat <<'EOF'
Використання: check.sh [--fast|--secrets]

  --fast  пропустити повільне: tsc --noEmit, lint, прод-збірку порталу і
          npm audit. Тести й shell/python-перевірки лишаються.

  --secrets
          лише пошук секретів у відстежуваних файлах, нічого більше. Цей
          режим використовує pre-commit hook: коміт має лишатись дешевим,
          а секрет, який туди потрапив, лишається в історії назавжди —
          на відміну від решти помилок, які ловить pre-push.

  --coverage
          додатково зібрати покриття тестами (портал, python, воркер) і
          показати числа. Окремим прапорцем, бо це ганяє всі набори ще раз;
          порогів немає — мета побачити, які ділянки не зачеплені.

Без прапорців ганяє все: shell (bash -n, shellcheck), python (py_compile,
ruff), портал (tsc, lint, test) і воркер (test). Саме так його запускає
pre-push hook.

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
# warn не валить прогін: це відоме, вже наявне занепокоєння (напр. міграція без
# IF NOT EXISTS), яке треба бачити, але яке не має блокувати push.
warn() { WARN_COUNT=$((WARN_COUNT + 1)); printf '  %s▲%s  %s\n' "$C_WARN" "$C_RESET" "$1"; }
err()  { ERR_COUNT=$((ERR_COUNT + 1));  printf '  %s✘%s  %s\n' "$C_ERR" "$C_RESET" "$1"; }
note() { printf '  %s·  %s%s\n' "$C_DIM" "$1" "$C_RESET"; }

# Сторожі проєкту (doctor_prompt_contract.py, migrations_check.py) друкують
# рядки "рівень<TAB>повідомлення" — той самий контракт, що споживає doctor.sh.
# Тут він розкладається у ok/warn/err/note, щоб коди виходу лишались єдиними.
run_contract_check() {
  local label="$1"; shift
  local out status
  out="$("$@" 2>&1)"
  status=$?
  if [ "$status" -ne 0 ] && [ -z "$out" ]; then
    err "$label: перевірка впала (код $status)"
    return
  fi
  # Попередження згортаються в підсумок: у міграцій їх сімнадцять, усі про два
  # давно накочені файли, і щоденні сімнадцять рядків просто перестануть читати.
  # Число лишається на очах — воно зросте, якщо нову міграцію напишуть так само.
  local level message warn_count=0 first_warn=""
  while IFS=$'\t' read -r level message; do
    [ -z "$level" ] && continue
    case "$level" in
      ok)   ok "$label: $message" ;;
      err)  err "$label: $message" ;;
      warn)
        warn_count=$((warn_count + 1))
        [ -z "$first_warn" ] && first_warn="$message"
        ;;
      *)    note "$label: $message" ;;
    esac
  done <<< "$out"
  if [ "$warn_count" -eq 1 ]; then
    warn "$label: $first_warn"
  elif [ "$warn_count" -gt 1 ]; then
    warn "$label: $warn_count попереджень, перше — $first_warn"
    note "$label: решта — запусти перевірку напряму"
  fi
}

START_EPOCH="$(date +%s)"
step_start() { STEP_EPOCH="$(date +%s)"; note "$1…"; }
step_elapsed() { echo "$(( $(date +%s) - STEP_EPOCH ))с"; }

# Секрети в репозиторії заборонені (AGENTS.md, README). .gitignore прикриває
# env-файли, але не ключ, вставлений у код чи в лог. Шукаємо за формою відомих
# токенів — і лише у файлах, які git реально відстежує.
scan_secrets() {
  step_start "пошук секретів у відстежуваних файлах"
  local hits
  hits="$(git ls-files -z 2>/dev/null | xargs -0 grep -nIE \
    -e 'eyJhbGciOiJ[A-Za-z0-9_-]{10,}' \
    -e '\b[0-9]{8,10}:AA[A-Za-z0-9_-]{30,}' \
    -e '\bsk-(ant-)?[A-Za-z0-9_-]{20,}' \
    -e '\bgh[pousr]_[A-Za-z0-9]{30,}' \
    2>/dev/null)"
  if [ -z "$hits" ]; then
    ok "секретів за відомими формами не знайдено ($(step_elapsed))"
  else
    err "схоже на секрет у відстежуваних файлах ($(step_elapsed)):"
    printf '%s\n' "$hits" | cut -c1-160 | sed 's/^/      /'
  fi
}

summary() {
  local elapsed=$(( $(date +%s) - START_EPOCH ))
  printf '\n%s%s%s  (%sс)\n' "$C_BOLD" "Підсумок" "$C_RESET" "$elapsed"
  printf '  %s%d ок%s  ·  %s%d попереджень%s  ·  %s%d проблем%s\n\n' \
    "$C_OK" "$OK_COUNT" "$C_RESET" "$C_WARN" "$WARN_COUNT" "$C_RESET" "$C_ERR" "$ERR_COUNT" "$C_RESET"

  if [ "$ERR_COUNT" -gt 0 ]; then
    echo "Є помилки — дивись рядки з ✘ вище."
    exit 1
  fi
  echo "Усе чисто."
  exit 0
}

printf '%sideas-scout check%s  %s%s\n' "$C_BOLD" "$C_RESET" "$(date '+%F %H:%M')" "$([ "$FAST" -eq 1 ] && echo "  (--fast)")$([ "$SECRETS_ONLY" -eq 1 ] && echo "  (--secrets)")"

if [ "$SECRETS_ONLY" -eq 1 ]; then
  section "Секрети"
  scan_secrets
  summary
fi

# ---------------------------------------------------------------------------
section "Shell"
# ---------------------------------------------------------------------------
shopt -s nullglob
SHELL_FILES=("$REPO_ROOT/agents/scripts"/*.sh "$REPO_ROOT/dev.sh" \
             "$REPO_ROOT/shared/migrations/apply.sh" "$REPO_ROOT/check.sh" \
             "$REPO_ROOT/hooks"/*)
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

step_start "контракт промптів"
run_contract_check "промпти" python3 "$REPO_ROOT/agents/scripts/doctor_prompt_contract.py"

step_start "міграції проти shared/schema.sql"
run_contract_check "міграції" python3 "$REPO_ROOT/agents/scripts/migrations_check.py"

step_start "посилання в документації"
run_contract_check "документація" python3 "$REPO_ROOT/agents/scripts/docs_links_check.py"

# SQL: набір правил звужено до PG01 (див. .sqlfluff) — блокування таблиці при
# CREATE INDEX без CONCURRENTLY і ADD CONSTRAINT без NOT VALID. Наявні
# спрацювання — в уже накочених файлах, тому warn, а не err: число має
# зрости, якщо НОВА міграція лочитиме таблицю, і це видно до накату на прод.
SQLFLUFF=""
if command -v sqlfluff >/dev/null 2>&1; then
  SQLFLUFF="sqlfluff"
elif command -v uvx >/dev/null 2>&1; then
  SQLFLUFF="uvx sqlfluff"
fi
if [ -n "$SQLFLUFF" ]; then
  step_start "sqlfluff (PG01) для shared/"
  shopt -s nullglob
  SQL_FILES=("$REPO_ROOT/shared/schema.sql" "$REPO_ROOT/shared/migrations"/*.sql)
  shopt -u nullglob
  SQL_HITS="$($SQLFLUFF lint "${SQL_FILES[@]}" 2>/dev/null | grep -c '| PG01 |')"
  case "$SQL_HITS" in ''|*[!0-9]*) SQL_HITS=0 ;; esac
  if [ "$SQL_HITS" -eq 0 ]; then
    ok "sqlfluff: блокувальних конструкцій у SQL немає ($(step_elapsed))"
  else
    warn "sqlfluff: $SQL_HITS блокувальних конструкцій (CREATE INDEX без CONCURRENTLY, ADD CONSTRAINT без NOT VALID) — усі в уже накочених файлах"
  fi
else
  note "sqlfluff недоступний — перевірку SQL пропущено (uv tool install sqlfluff)"
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
section "Залежності"
# ---------------------------------------------------------------------------
# Тільки інформативно, ніколи не валить прогін: npm audit залежить від мережі й
# від щойно опублікованих порад, тож як блокуючий гейт він зробив би check.sh
# недетермінованим — коміт падав би через чужу вразливість, знайдену вночі.
if [ "$FAST" -eq 1 ]; then
  note "--fast: npm audit пропущено"
else
  for pkg in dashboard agents/worker; do
    if [ -d "$REPO_ROOT/$pkg/node_modules" ]; then
      if npm audit --audit-level=high --prefix "$REPO_ROOT/$pkg" >/dev/null 2>&1; then
        note "$pkg: npm audit не бачить вразливостей рівня high і вище"
      else
        note "$pkg: npm audit щось знайшов — глянь окремо (не блокує коміт)"
      fi
    else
      note "$pkg: немає node_modules, audit пропущено"
    fi
  done
fi

# ---------------------------------------------------------------------------
section "Конфігурація і секрети"
# ---------------------------------------------------------------------------
# plutil стоїть і в install-launchd.sh, але там він спрацьовує аж при
# встановленні. Зламаний plist означає, що джоб тихо ніколи не запуститься —
# це треба ловити на push'і, а не через тиждень мовчазної тиші.
if command -v plutil >/dev/null 2>&1; then
  shopt -s nullglob
  PLISTS=("$REPO_ROOT/agents/launchd"/*.plist)
  shopt -u nullglob
  PLIST_BAD=0
  for f in "${PLISTS[@]}"; do
    plutil -lint "$f" >/dev/null 2>&1 || { err "невалідний plist: ${f#"$REPO_ROOT"/}"; PLIST_BAD=1; }
  done
  [ "$PLIST_BAD" -eq 0 ] && ok "plutil: усі ${#PLISTS[@]} launchd-plist валідні"
else
  note "plutil недоступний — валідність plist не перевірено"
fi

scan_secrets

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

    # Портал деплоїться у Vercel, а збірка падає там, де tsc мовчить: порушення
    # межі server/client, server-only в клієнтському компоненті, помилки в
    # конфігурації маршрутів. Без цього кроку таке виявляється аж на деплої.
    # Мертвий код — інформативно, як і npm audit: невикористаний експорт нічого
    # не ламає, а блокуючий гейт тут змушував би прибирати щойно написане, ще
    # не під'єднане. Число в підсумку видно, рішення за власником.
    if npm run deadcode >/dev/null 2>&1; then
      note "knip: невикористаних експортів і залежностей не знайдено"
    else
      note "knip: є невикористані експорти чи залежності — npm run deadcode --prefix dashboard"
    fi

    step_start "npm run build"
    BUILD_OUT="$(npm run build 2>&1)"
    BUILD_STATUS=$?
    if [ "$BUILD_STATUS" -eq 0 ]; then
      ok "npm run build: прод-збірка зібралась ($(step_elapsed))"
    else
      err "npm run build провалився ($(step_elapsed)):"
      printf '%s\n' "$BUILD_OUT" | tail -40 | sed 's/^/      /'
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

# Лінт воркера — dev-залежність, тож без node_modules його просто немає. Тести
# нижче від цього не залежать і йдуть у будь-якому разі.
if [ -d node_modules ]; then
  # job-worker.mjs — чистий JS, тож типи перевіряються через checkJs і JSDoc:
  # eslint ловить синтаксис, але не форму даних, які їдуть у jobs/runs.
  step_start "npm run typecheck"
  WTYPE_OUT="$(npm run typecheck 2>&1)"
  WTYPE_STATUS=$?
  if [ "$WTYPE_STATUS" -eq 0 ]; then
    ok "npm run typecheck: типи ок ($(step_elapsed))"
  else
    err "npm run typecheck знайшов помилки ($(step_elapsed)):"
    printf '%s\n' "$WTYPE_OUT" | sed 's/^/      /'
  fi

  step_start "npm run lint"
  WLINT_OUT="$(npm run lint 2>&1)"
  WLINT_STATUS=$?
  if [ "$WLINT_STATUS" -eq 0 ]; then
    ok "npm run lint: зауважень немає ($(step_elapsed))"
  else
    err "npm run lint знайшов зауваження ($(step_elapsed)):"
    printf '%s\n' "$WLINT_OUT" | sed 's/^/      /'
  fi
else
  note "немає node_modules — лінт воркера пропущено (npm install --prefix agents/worker)"
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

# ---------------------------------------------------------------------------
if [ "$COVERAGE" -eq 1 ]; then
  section "Покриття"
  # Без порогів і без впливу на код виходу: число тут — привід подивитись, які
  # ділянки не зачеплені, а не гейт. Гейт із порогом змушував би дописувати
  # тести заради відсотка, а не заради ризику.
  step_start "python (coverage.py)"
  PYCOV="$(cd "$REPO_ROOT/agents/scripts" && python3 -m coverage run -m unittest discover -p '*_test.py' -t . >/dev/null 2>&1 && python3 -m coverage report 2>/dev/null | tail -1)"
  if [ -n "$PYCOV" ]; then
    note "python: $PYCOV"
  else
    note "python: coverage.py недоступний (python3 -m pip install --user coverage)"
  fi

  if [ -d "$REPO_ROOT/dashboard/node_modules" ]; then
    step_start "портал (c8 + vitest)"
    DASHCOV="$(cd "$REPO_ROOT/dashboard" && npm run coverage 2>&1 | grep -iE '^all files' | tail -1)"
    if [ -n "$DASHCOV" ]; then
      note "портал: $DASHCOV"
    else
      note "портал: покриття зібрати не вдалось"
    fi
  fi

  if command -v kcov >/dev/null 2>&1; then
    step_start "bash (kcov)"
    # kcov не приймає абсолютний шлях до скрипта («Can't start/attach»), тому
    # і скрипт, і тека звіту передаються відносно кореня репозиторію.
    KCOV_OUT="agents/scripts/.kcov-out"
    rm -rf "${REPO_ROOT:?}/${KCOV_OUT:?}"
    mkdir -p "$KCOV_OUT"
    for f in agents/scripts/*.test.sh; do
      kcov --include-pattern=agents/scripts/runner-lib.sh,agents/scripts/db-lib.sh,agents/scripts/doctor-lib.sh,agents/scripts/scripts-lib.sh,agents/scripts/test-lib.sh \
        "$KCOV_OUT/$(basename "$f" .sh)" "$f" >/dev/null 2>&1
    done
    BASHCOV="$(kcov --merge "$KCOV_OUT/merged" "$KCOV_OUT"/*.test >/dev/null 2>&1; python3 -c "
import json, sys
try:
    d = json.load(open('$KCOV_OUT/merged/kcov-merged/coverage.json'))
    print('%.1f%% (%s/%s рядків)' % (float(d['percent_covered']), d['covered_lines'], d['total_lines']))
except Exception:
    sys.exit(1)
" 2>/dev/null)"
    if [ -n "$BASHCOV" ]; then
      note "bash: $BASHCOV"
    else
      note "bash: kcov не зміг зібрати звіт"
    fi
  else
    note "bash: kcov не встановлений (brew install kcov)"
  fi

  step_start "воркер (node --test)"
  WCOV="$(cd "$REPO_ROOT/agents/worker" && node --test --experimental-test-coverage job-worker.test.mjs 2>&1 | grep -E 'job-worker\.mjs' | tail -1)"
  if [ -n "$WCOV" ]; then
    note "воркер: $WCOV"
  else
    note "воркер: покриття зібрати не вдалось"
  fi
fi

# ---------------------------------------------------------------------------
summary
