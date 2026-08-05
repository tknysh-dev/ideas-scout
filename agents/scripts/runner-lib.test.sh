#!/usr/bin/env bash
# Юніт-тести чистих функцій runner-lib.sh: within_work_window, build_run_id,
# json_escape, json_array_of_strings. is_allowed_path/stage_allowed_paths —
# в окремому runner-lib.guard.test.sh, тут не чіпаємо.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_NAME="runner-lib"
# shellcheck source=agents/scripts/test-lib.sh
source "$SCRIPT_DIR/test-lib.sh"
# shellcheck source=agents/scripts/runner-lib.sh
source "$SCRIPT_DIR/runner-lib.sh"

# ---------------------------------------------------------------------------
# within_work_window <dow> <hh> <mm> <days_csv> <hours_range>
# ---------------------------------------------------------------------------

# усередині/поза вікном
expect_ok "12:00 у робочий день — усередині вікна 09:00-19:00" \
  within_work_window 3 12 00 "1,2,3,4,5" "09:00-19:00"
expect_fail "08:59 — до початку вікна" \
  within_work_window 3 08 59 "1,2,3,4,5" "09:00-19:00"
expect_fail "20:00 — після кінця вікна" \
  within_work_window 3 20 00 "1,2,3,4,5" "09:00-19:00"

# точні межі: старт включно (-ge), кінець виключно (-lt)
expect_ok "09:00 рівно — початок вікна ВКЛЮЧНО" \
  within_work_window 3 09 00 "1,2,3,4,5" "09:00-19:00"
expect_ok "18:59 — щойно перед кінцем, ще всередині" \
  within_work_window 3 18 59 "1,2,3,4,5" "09:00-19:00"
expect_fail "19:00 рівно — кінець вікна ВЖЕ ПОЗА" \
  within_work_window 3 19 00 "1,2,3,4,5" "09:00-19:00"

# день тижня: межі переліку і вихідні
expect_ok "dow=1 (перший у переліку 1,2,3,4,5)" \
  within_work_window 1 12 00 "1,2,3,4,5" "09:00-19:00"
expect_ok "dow=5 (останній у переліку 1,2,3,4,5)" \
  within_work_window 5 12 00 "1,2,3,4,5" "09:00-19:00"
expect_fail "dow=6 — субота поза переліком 1,2,3,4,5" \
  within_work_window 6 12 00 "1,2,3,4,5" "09:00-19:00"
expect_fail "dow=7 — неділя поза переліком 1,2,3,4,5" \
  within_work_window 7 12 00 "1,2,3,4,5" "09:00-19:00"

# hours="none" вимикає захист повністю
expect_fail "hours=none вимикає захист навіть у робочий день/годину" \
  within_work_window 3 12 00 "1,2,3,4,5" "none"
expect_fail "hours=none вимикає захист навіть коли dow поза переліком днів" \
  within_work_window 7 12 00 "1,2,3,4,5" "none"

# провідні нулі (10# у коді — інакше bash читає 08/09 як вісімкові)
expect_ok "09:00 у dow/hh/mm з провідними нулями — усередині" \
  within_work_window 3 09 00 "1,2,3,4,5" "09:00-19:00"
expect_ok "08:30 усередині вікна 08:00-09:00 (провідні нулі й у межах)" \
  within_work_window 3 08 30 "1,2,3,4,5" "08:00-09:00"
expect_ok "08:00 — старт вікна з провідним нулем включно" \
  within_work_window 3 08 00 "1,2,3,4,5" "08:00-09:00"
expect_fail "09:00 — кінець вікна 08:00-09:00 з провідним нулем виключно" \
  within_work_window 3 09 00 "1,2,3,4,5" "08:00-09:00"

# нестандартні переліки днів
expect_ok "days=3 (один день) — dow=3 співпадає" \
  within_work_window 3 12 00 "3" "09:00-19:00"
expect_fail "days=3 (один день) — dow=2 не співпадає" \
  within_work_window 2 12 00 "3" "09:00-19:00"
expect_ok "days=1,2,3,4,5,6,7 (усі сім) — dow=6 усередині" \
  within_work_window 6 12 00 "1,2,3,4,5,6,7" "09:00-19:00"
expect_ok "days=1,2,3,4,5,6,7 (усі сім) — dow=7 усередині" \
  within_work_window 7 12 00 "1,2,3,4,5,6,7" "09:00-19:00"

# Вікно через північ (start > end, напр. "19:00-09:00"): sm=1140 > em=540 ->
# перетин півночі, усередині — now_min >= sm АБО now_min < em (не "і").
expect_fail "вікно через північ 19:00-09:00: полудень — поза вікном" \
  within_work_window 3 12 00 "1,2,3,4,5" "19:00-09:00"
expect_ok "вікно через північ 19:00-09:00: 20:00 (до півночі) — усередині" \
  within_work_window 3 20 00 "1,2,3,4,5" "19:00-09:00"
expect_ok "вікно через північ 19:00-09:00: 02:00 (після півночі) — усередині" \
  within_work_window 3 02 00 "1,2,3,4,5" "19:00-09:00"
expect_ok "вікно через північ 19:00-09:00: 00:00 (опівночі) — усередині" \
  within_work_window 3 00 00 "1,2,3,4,5" "19:00-09:00"
expect_ok "вікно через північ 19:00-09:00: 19:00 рівно — старт ВКЛЮЧНО" \
  within_work_window 3 19 00 "1,2,3,4,5" "19:00-09:00"
expect_fail "вікно через північ 19:00-09:00: 09:00 рівно — кінець ВИКЛЮЧНО" \
  within_work_window 3 09 00 "1,2,3,4,5" "19:00-09:00"

# sm == em ("10:00-10:00"): свідомо вікно нульової довжини (не цілодобове) —
# див. коментар у within_work_window.
expect_fail "sm==em (10:00-10:00): рівно на межі — порожнє вікно" \
  within_work_window 3 10 00 "1,2,3,4,5" "10:00-10:00"
expect_fail "sm==em (10:00-10:00): будь-який інший час теж поза вікном" \
  within_work_window 3 15 30 "1,2,3,4,5" "10:00-10:00"

# ---------------------------------------------------------------------------
# in_work_hours — тонка обгортка над within_work_window, бере фактичний час
# через `date`. "Усередині вікна" тут не тестується — залежало б від
# годинника машини (флейкі); IDEAS_SCOUT_WORK_HOURS=none вимикає захист
# незалежно від поточного часу/дня — єдиний детермінований випадок.
# ---------------------------------------------------------------------------

IDEAS_SCOUT_WORK_HOURS="none" expect_fail \
  "in_work_hours: IDEAS_SCOUT_WORK_HOURS=none вимикає захист незалежно від поточного часу/дня" \
  in_work_hours

# ---------------------------------------------------------------------------
# build_run_id <stamp> <provider> <track> <agent>
# ---------------------------------------------------------------------------

expect_eq "run_id: claude/passive-income/collector" \
  "20260804-174618-claude-passive-income-collector" \
  "$(build_run_id "20260804-174618" "claude" "passive-income" "collector")"
expect_eq "run_id: claude/passive-income/analyst" \
  "20260728-185055-claude-passive-income-analyst" \
  "$(build_run_id "20260728-185055" "claude" "passive-income" "analyst")"
expect_eq "run_id: claude/passive-income/revisor" \
  "20260729-124410-claude-passive-income-revisor" \
  "$(build_run_id "20260729-124410" "claude" "passive-income" "revisor")"
expect_eq "run_id: codex/app-ideas/collector" \
  "20260805-060000-codex-app-ideas-collector" \
  "$(build_run_id "20260805-060000" "codex" "app-ideas" "collector")"
expect_eq "run_id: codex/app-ideas/triage" \
  "20260805-060000-codex-app-ideas-triage" \
  "$(build_run_id "20260805-060000" "codex" "app-ideas" "triage")"
expect_eq "run_id: codex/passive-income/analyst" \
  "20260805-060000-codex-passive-income-analyst" \
  "$(build_run_id "20260805-060000" "codex" "passive-income" "analyst")"
expect_eq "run_id: claude/app-ideas/revisor" \
  "20260805-060000-claude-app-ideas-revisor" \
  "$(build_run_id "20260805-060000" "claude" "app-ideas" "revisor")"

# ---------------------------------------------------------------------------
# json_escape (гілка python3)
# ---------------------------------------------------------------------------

expect_eq "json_escape: звичайний рядок" '"hello"' "$(json_escape 'hello')"
expect_eq "json_escape: лапки всередині" '"he said \"hi\""' "$(json_escape 'he said "hi"')"
expect_eq "json_escape: зворотний слеш" '"a\\b"' "$(json_escape 'a\b')"
expect_eq "json_escape: перевід рядка" '"line1\nline2"' "$(json_escape "$(printf 'line1\nline2')")"
expect_eq "json_escape: кирилиця (python json.dumps екранує в \\uXXXX)" \
  '"\u041f\u0440\u0438\u0432\u0456\u0442"' "$(json_escape 'Привіт')"
expect_eq "json_escape: порожній рядок" '""' "$(json_escape '')"

# ---------------------------------------------------------------------------
# json_escape (фолбек на sed — python3 навмисно прибрано з PATH)
# ---------------------------------------------------------------------------

FAKEBIN="$(mktemp -d)"
ln -s "$(command -v sed)" "$FAKEBIN/sed"
ln -s "$(command -v tr)" "$FAKEBIN/tr"

expect_eq "json_escape фолбек: лапки всередині" '"he said \"hi\""' \
  "$(PATH="$FAKEBIN" json_escape 'he said "hi"')"
expect_eq "json_escape фолбек: зворотний слеш" '"a\\b"' \
  "$(PATH="$FAKEBIN" json_escape 'a\b')"
# фолбек не вміє екранувати переведення рядка як \n — sed/tr підмінює його
# ПРОБІЛОМ (tr '\n' ' '), на відміну від python-гілки. Це задокументована
# різниця поведінки фолбека, не баг цього тесту.
expect_eq "json_escape фолбек: перевід рядка стає пробілом (не \\n)" '"line1 line2"' \
  "$(PATH="$FAKEBIN" json_escape "$(printf 'line1\nline2')")"
expect_eq "json_escape фолбек: порожній рядок" '""' \
  "$(PATH="$FAKEBIN" json_escape '')"

rm -rf "$FAKEBIN"

# ---------------------------------------------------------------------------
# json_array_of_strings
# ---------------------------------------------------------------------------

expect_eq "json_array_of_strings: без аргументів" '[]' "$(json_array_of_strings)"
expect_eq "json_array_of_strings: один аргумент" '["a"]' "$(json_array_of_strings a)"
expect_eq "json_array_of_strings: кілька аргументів" '["a", "b", "c"]' "$(json_array_of_strings a b c)"
expect_eq "json_array_of_strings: лапки, пробіли, кирилиця" \
  '["\u0437 \u043b\u0430\u043f\u043a\u0430\u043c\u0438 \"\u0442\u0435\u0441\u0442\"", "\u043f\u0440\u043e\u0431\u0456\u043b \u0442\u0443\u0442"]' \
  "$(json_array_of_strings 'з лапками "тест"' 'пробіл тут')"

test_summary 50
