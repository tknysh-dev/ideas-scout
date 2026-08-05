#!/usr/bin/env bash
# runner-lib.guard.test.sh — тести саме на is_allowed_path/stage_allowed_paths:
# це allowlist-межа проти промпт-ін'єкції (див. коментар над is_allowed_path в
# runner-lib.sh і шапку runner.sh) — найцінніша для покриття функція в репо,
# тому вона отримує окремий, помітний і навмисно вичерпний набір тестів,
# а не кілька рядків всередині загальних юніт-тестів runner-lib.
#
# Тут НЕ викликається runner.sh (локи, бойовий Supabase) і НЕ викликається
# git (stage_allowed_paths робить git add — тому її поведінку тут документує
# окрема локальна копія glob-патерну, а не сам виклик функції).
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_NAME="runner-lib guard (is_allowed_path)"
source "$SCRIPT_DIR/test-lib.sh"
source "$SCRIPT_DIR/runner-lib.sh"

# ---------------------------------------------------------------------------
# 1. Дозволене — по одному тесту на кожну гілку case, реалістичні шляхи.
# ---------------------------------------------------------------------------

expect_ok "agents/catalogs/*"              is_allowed_path "agents/catalogs/ai-capabilities.md"
expect_ok "logs/decisions.md"              is_allowed_path "logs/decisions.md"
expect_ok "logs/dedup-decisions.md"        is_allowed_path "logs/dedup-decisions.md"
expect_ok "inbox (без слеша)"              is_allowed_path "inbox"
expect_ok "inbox/* (вкладення тріажу)"     is_allowed_path "inbox/20260729-141444-passive-income/idea.md"
expect_ok "logs/triage/*.progress"         is_allowed_path "logs/triage/20260729-141444.progress"

expect_ok "agents/criteria/criteria*"                  is_allowed_path "agents/criteria/criteria-apps.md"
expect_ok "agents/criteria/search-queries-*.md"        is_allowed_path "agents/criteria/search-queries-app-ideas.md"
expect_ok "agents/criteria/search-queries.md"           is_allowed_path "agents/criteria/search-queries.md"
expect_ok "agents/criteria/taxonomy.md"                 is_allowed_path "agents/criteria/taxonomy.md"
expect_ok "agents/criteria/availability.md"              is_allowed_path "agents/criteria/availability.md"

expect_ok "logs/locks (тека)"              is_allowed_path "logs/locks"
expect_ok "logs/locks/* (файл локу)"       is_allowed_path "logs/locks/passive-income-collector.lock"
expect_ok "logs/launchd (тека)"            is_allowed_path "logs/launchd"
expect_ok "logs/launchd/* (лог)"           is_allowed_path "logs/launchd/app-ideas-collector.log"
expect_ok "logs/quarantine (тека)"         is_allowed_path "logs/quarantine"
expect_ok "logs/quarantine/* (diff)"       is_allowed_path "logs/quarantine/20260801-050005-claude-passive-income-analyst-blocked-paths.diff"

# ---------------------------------------------------------------------------
# 2. Заблоковане — усе, що шапка runner.sh називає забороненим, плюс те, що
#    Фаза 4 прибрала з allowlist (тепер має ловитись, а не тихо пропускатись).
# ---------------------------------------------------------------------------

expect_fail "agents/scripts/runner.sh (сам guard не може дозволити себе)" is_allowed_path "agents/scripts/runner.sh"
expect_fail "agents/scripts/db.sh"          is_allowed_path "agents/scripts/db.sh"
expect_fail "agents/prompts/*"              is_allowed_path "agents/prompts/analyst.md"
expect_fail "agents/launchd/*.plist"        is_allowed_path "agents/launchd/com.ideas-scout.monitor.plist"
expect_fail ".gitignore"                    is_allowed_path ".gitignore"
expect_fail "docs/*"                        is_allowed_path "docs/operations.md"
expect_fail "shared/schema.sql"             is_allowed_path "shared/schema.sql"
expect_fail "shared/migrations/*"           is_allowed_path "shared/migrations/2026-08-03-no-market-rejection-code.sql"
expect_fail "dashboard/src/*"               is_allowed_path "dashboard/src/auth.ts"
expect_fail "корінь: README.md"             is_allowed_path "README.md"
expect_fail "корінь: check.sh"              is_allowed_path "check.sh"
expect_fail "корінь: AGENTS.md"             is_allowed_path "AGENTS.md"
expect_fail ".github/*"                     is_allowed_path ".github/workflows/ci.yml"
expect_fail "hooks/pre-commit"              is_allowed_path "hooks/pre-commit"

expect_fail "Фаза 4: registries/* більше не allowlist" is_allowed_path "registries/passive-income/ideas.md"
expect_fail "Фаза 4: logs/runs/*"                        is_allowed_path "logs/runs/20260728-185055-claude-passive-income-analyst.md"
expect_fail "Фаза 4: logs/status/*"                      is_allowed_path "logs/status/monitor.json"
expect_fail "Фаза 4: logs/triage/*.md (саме .md, не .progress)" is_allowed_path "logs/triage/20260729-141444.md"

# ---------------------------------------------------------------------------
# 3. Адверсарні випадки — шляхи, СХОЖІ на дозволені, але дозволятись не мають.
# ---------------------------------------------------------------------------

# Префіксні підробки: одного зайвого символу перед "/" достатньо, щоб case
# не збігся — це навмисно перевіряє, що match саме на "agents/catalogs/",
# а не на будь-що з префіксом "agents/catalogs".
expect_fail "підробка префіксу: agents/catalogsX/evil.md" is_allowed_path "agents/catalogsX/evil.md"
expect_fail "підробка префіксу: inbox-evil/x"              is_allowed_path "inbox-evil/x"
expect_fail "підробка суфіксу: logs/decisions.md.bak"      is_allowed_path "logs/decisions.md.bak"
expect_fail "підробка суфіксу: logs/triage/x.progress.md (закінчується на .md, не .progress)" \
  is_allowed_path "logs/triage/x.progress.md"

# ВІДОМА ДІРА: case-glob робить чисте зіставлення рядка, без нормалізації
# шляху. "agents/catalogs/*" (і будь-який інший allowlisted префікс) як
# glob-патерн збігається з рядком, що ПОЧИНАЄТЬСЯ на цей префікс, включно з
# ".." усередині — тобто is_allowed_path пропускає вихід за межі дозволеної
# теки через "../". На практиці ця діра НЕ досяжна: runner.sh годує функцію
# шляхами з `git status --porcelain -z`, а git такі шляхи не видає (він working-tree-relative
# і не повертає компоненти ".." — вони можуть з'явитися лише якщо хтось
# викличе is_allowed_path напряму з довільним рядком, а не через runner.sh).
expect_ok "ВІДОМА ДІРА: вихід угору через .. всередині allowlisted префіксу (недосяжно через git status -z)" \
  is_allowed_path "agents/catalogs/../../agents/scripts/runner.sh"
expect_ok "ВІДОМА ДІРА: те саме для inbox/.. (недосяжно через git status -z)" \
  is_allowed_path "inbox/../.git/hooks/pre-commit"

# Абсолютний шлях: жоден allowlisted патерн не починається з "/", тож
# абсолютні шляхи блокуються завжди — навіть якщо ведуть усередину allowlisted
# теки цього ж репозиторію.
expect_fail "абсолютний шлях поза репо: /etc/passwd" is_allowed_path "/etc/passwd"
expect_fail "абсолютний шлях у дозволену теку репо (все одно блокується — case matches, не файлова система)" \
  is_allowed_path "/Users/tknysh/Development/Projects/Personal/ideas-scout/agents/catalogs/x.md"

# Порожній рядок і шлях із пробілом.
expect_fail "порожній рядок" is_allowed_path ""
expect_ok "шлях із пробілом всередині дозволеної теки (пробіл — звичайний символ для case)" \
  is_allowed_path "agents/catalogs/idea one.md"

# ---------------------------------------------------------------------------
# 4. Дзеркальність is_allowed_path <-> stage_allowed_paths.
#
# stage_allowed_paths коміт не за is_allowed_path, а за власним, окремо
# прописаним переліком `git add` (дзеркало is_allowed_path мінус рантайм) —
# з цього приводу і виникає розбіжність. Функцію stage_allowed_paths тут НЕ
# викликаємо (вона робить git add), тому нижче — локальна копія РІВНО того
# glob-патерну критеріїв, що в самій функції (runner-lib.sh:121,
# `agents/criteria/criteria*.md`), аби зафіксувати розбіжність з
# is_allowed_path (runner-lib.sh:95, `agents/criteria/criteria*` — без .md)
# без побічних ефектів git.
# ---------------------------------------------------------------------------

# Копія glob з stage_allowed_paths — синхронізувати вручну, якщо той рядок
# зміниться, інакше цей тест перестане відображати реальність.
stage_criteria_glob_matches() {
  case "$1" in
    agents/criteria/criteria*.md) return 0 ;;
    *) return 1 ;;
  esac
}

expect_ok "is_allowed_path пропускає agents/criteria/criteriaFOO (без .md)" \
  is_allowed_path "agents/criteria/criteriaFOO"
expect_fail "РОЗБІЖНІСТЬ: той самий шлях НЕ застейджиться — stage-патерн вимагає .md (не лагодимо тут, лише фіксуємо)" \
  stage_criteria_glob_matches "agents/criteria/criteriaFOO"

test_summary 47
