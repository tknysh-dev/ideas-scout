#!/usr/bin/env bash
# Юніт-тести чистих функцій doctor-lib.sh: human_age, iso_to_epoch,
# has_ideas_scout_jobs, launchctl_job_status, classify_launchd_job,
# clamshell_count_since, classify_realtime_status, classify_queue_state,
# classify_run_state, classify_websearch_probe.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_NAME="doctor-lib"
# shellcheck source=agents/scripts/test-lib.sh
source "$SCRIPT_DIR/test-lib.sh"
# shellcheck source=agents/scripts/doctor-lib.sh
source "$SCRIPT_DIR/doctor-lib.sh"

# ---------------------------------------------------------------------------
# iso_to_epoch <iso8601>
# ---------------------------------------------------------------------------

expect_eq "iso_to_epoch: валідний ISO з офсетом" \
  "1704110400" "$(iso_to_epoch "2024-01-01T12:00:00+00:00")"
expect_eq "iso_to_epoch: валідний ISO з Z (UTC)" \
  "1704110400" "$(iso_to_epoch "2024-01-01T12:00:00Z")"
expect_eq "iso_to_epoch: валідний ISO без офсету/Z (наївний -> локальний час)" \
  "$(python3 -c "import datetime; print(int(datetime.datetime.fromisoformat('2024-01-01T12:00:00').timestamp()))")" \
  "$(iso_to_epoch "2024-01-01T12:00:00")"
expect_eq "iso_to_epoch: порожній рядок -> 0" \
  "0" "$(iso_to_epoch "")"
expect_eq "iso_to_epoch: сміття -> 0" \
  "0" "$(iso_to_epoch "не дата взагалі")"
expect_eq "iso_to_epoch: майбутня дата рахується так само, як і будь-яка інша" \
  "4102444800" "$(iso_to_epoch "2100-01-01T00:00:00Z")"
expect_eq "iso_to_epoch: мілісекунди у рядку (звичний формат Supabase) теж парсяться" \
  "1704110400" "$(iso_to_epoch "2024-01-01T12:00:00.123456Z")"

# ---------------------------------------------------------------------------
# human_age <seconds>
# ---------------------------------------------------------------------------

expect_eq "human_age: 0 секунд" "0 с" "$(human_age 0)"
expect_eq "human_age: 1 секунда" "1 с" "$(human_age 1)"
expect_eq "human_age: 89 секунд — ще в секундах" "89 с" "$(human_age 89)"
expect_eq "human_age: 90 секунд — межа, вже хвилини" "1 хв" "$(human_age 90)"
expect_eq "human_age: 5 хвилин" "5 хв" "$(human_age 300)"
expect_eq "human_age: 5399 секунд — ще хвилини" "89 хв" "$(human_age 5399)"
expect_eq "human_age: 5400 секунд — межа, вже години" "1 год" "$(human_age 5400)"
expect_eq "human_age: 2 години" "2 год" "$(human_age 7200)"
expect_eq "human_age: 172799 секунд — ще години" "47 год" "$(human_age 172799)"
expect_eq "human_age: 172800 секунд — межа, вже дні" "2 дн" "$(human_age 172800)"
expect_eq "human_age: 10 днів" "10 дн" "$(human_age 864000)"
expect_eq "human_age: дуже велике число (рік)" "365 дн" "$(human_age 31536000)"
expect_eq "human_age: відʼємне значення -> ? (мінус не проходить [!0-9]-фільтр цифр)" \
  "?" "$(human_age -1)"
expect_eq "human_age: порожній аргумент -> дефолт 0" "0 с" "$(human_age)"
expect_eq "human_age: сміття -> ?" "?" "$(human_age "abc")"
expect_eq "human_age: число з пробілом -> ?" "?" "$(human_age "1 2")"

# ---------------------------------------------------------------------------
# has_ideas_scout_jobs <launchctl_list_output>
# ---------------------------------------------------------------------------

LAUNCHCTL_LIST_WITH='- 0 com.apple.something
1234 0 com.ideas-scout.job-worker
- - com.other.thing'
LAUNCHCTL_LIST_WITHOUT='- 0 com.apple.something
- - com.other.thing'

expect_ok "has_ideas_scout_jobs: список містить com.ideas-scout.*" \
  has_ideas_scout_jobs "$LAUNCHCTL_LIST_WITH"
expect_fail "has_ideas_scout_jobs: список без com.ideas-scout.*" \
  has_ideas_scout_jobs "$LAUNCHCTL_LIST_WITHOUT"
expect_fail "has_ideas_scout_jobs: порожній вивід" \
  has_ideas_scout_jobs ""

# ---------------------------------------------------------------------------
# launchctl_job_status <print_out> -> "state<TAB>exit_code"
# ---------------------------------------------------------------------------

PRINT_OUT_RUNNING="$(printf 'com.ideas-scout.job-worker = {\n\tactive count = 1\n\tstate = running\n\tlast exit code = 0\n}\n')"
expect_eq "launchctl_job_status: running, exit 0" \
  "$(printf 'running\t0')" "$(launchctl_job_status "$PRINT_OUT_RUNNING")"

PRINT_OUT_WAITING="$(printf 'com.ideas-scout.monitor = {\n\tstate = waiting\n\tlast exit code = 1\n}\n')"
expect_eq "launchctl_job_status: waiting, exit 1" \
  "$(printf 'waiting\t1')" "$(launchctl_job_status "$PRINT_OUT_WAITING")"

PRINT_OUT_NO_EXIT="$(printf 'com.ideas-scout.monitor = {\n\tstate = waiting\n}\n')"
expect_eq "launchctl_job_status: без \"last exit code\" -> exit_code порожній" \
  "$(printf 'waiting\t')" "$(launchctl_job_status "$PRINT_OUT_NO_EXIT")"

PRINT_OUT_GARBAGE_EXIT="$(printf 'com.ideas-scout.monitor = {\n\tstate = waiting\n\tlast exit code = SIGKILL\n}\n')"
expect_eq "launchctl_job_status: нечисловий exit code -> порожній (сигнал, не код)" \
  "$(printf 'waiting\t')" "$(launchctl_job_status "$PRINT_OUT_GARBAGE_EXIT")"

expect_eq "launchctl_job_status: порожній ввід -> порожній state і exit_code" \
  "$(printf '\t')" "$(launchctl_job_status "")"

# ---------------------------------------------------------------------------
# classify_launchd_job <short> <state> <exit_code>
# ---------------------------------------------------------------------------

expect_eq "classify_launchd_job: job-worker, running -> worker_running" \
  "worker_running" "$(classify_launchd_job "job-worker" "running" "0")"
expect_eq "classify_launchd_job: job-worker, waiting -> worker_down (навіть якщо exit=0)" \
  "worker_down" "$(classify_launchd_job "job-worker" "waiting" "0")"
expect_eq "classify_launchd_job: job-worker, порожній state -> worker_down" \
  "worker_down" "$(classify_launchd_job "job-worker" "" "")"
expect_eq "classify_launchd_job: не job-worker, exit=0 -> scheduled_ok" \
  "scheduled_ok" "$(classify_launchd_job "monitor" "waiting" "0")"
expect_eq "classify_launchd_job: не job-worker, exit=1 -> exit_nonzero" \
  "exit_nonzero" "$(classify_launchd_job "monitor" "waiting" "1")"
expect_eq "classify_launchd_job: не job-worker, exit порожній -> scheduled_ok (не було прогону)" \
  "scheduled_ok" "$(classify_launchd_job "monitor" "waiting" "")"
expect_eq "classify_launchd_job: не job-worker, state=running -> scheduled_ok, якщо exit=0" \
  "scheduled_ok" "$(classify_launchd_job "monitor" "running" "0")"

# ---------------------------------------------------------------------------
# clamshell_count_since <baseline> <log_lines>
# ---------------------------------------------------------------------------

CLAMSHELL_LOG='2026-08-01 10:00:00 ... Clamshell Sleep
2026-08-03 09:00:00 ... Clamshell Sleep
2026-08-05 15:30:00 ... Clamshell Sleep'

expect_eq "clamshell_count_since: рахує лише рядки з датою >= baseline" \
  "2" "$(clamshell_count_since "2026-08-02 00:00:00" "$CLAMSHELL_LOG")"
expect_eq "clamshell_count_since: baseline рівно на межі одного з рядків — включно (>=)" \
  "2" "$(clamshell_count_since "2026-08-03 09:00:00" "$CLAMSHELL_LOG")"
expect_eq "clamshell_count_since: на секунду пізніше межі — цей рядок вже НЕ рахується" \
  "1" "$(clamshell_count_since "2026-08-03 09:00:01" "$CLAMSHELL_LOG")"
expect_eq "clamshell_count_since: на секунду раніше межі найближчого рядка — той рядок теж рахується" \
  "2" "$(clamshell_count_since "2026-08-03 08:59:59" "$CLAMSHELL_LOG")"
expect_eq "clamshell_count_since: baseline у майбутньому -> 0" \
  "0" "$(clamshell_count_since "2099-01-01 00:00:00" "$CLAMSHELL_LOG")"
expect_eq "clamshell_count_since: baseline дуже старий -> усі рядки" \
  "3" "$(clamshell_count_since "2000-01-01 00:00:00" "$CLAMSHELL_LOG")"
expect_eq "clamshell_count_since: порожній лог -> 0" \
  "0" "$(clamshell_count_since "2026-08-01 00:00:00" "")"

# ---------------------------------------------------------------------------
# classify_realtime_status <last_realtime>
# ---------------------------------------------------------------------------

expect_eq "classify_realtime_status: SUBSCRIBED -> ok" \
  "ok" "$(classify_realtime_status "SUBSCRIBED")"
expect_eq "classify_realtime_status: порожній рядок -> warn" \
  "warn" "$(classify_realtime_status "")"
expect_eq "classify_realtime_status: CHANNEL_ERROR -> err" \
  "err" "$(classify_realtime_status "CHANNEL_ERROR")"
expect_eq "classify_realtime_status: CLOSED -> err" \
  "err" "$(classify_realtime_status "CLOSED")"
expect_eq "classify_realtime_status: неочікуване значення -> err (за замовчуванням тривога)" \
  "err" "$(classify_realtime_status "TIMED_OUT")"

# ---------------------------------------------------------------------------
# classify_realtime_churn <reconnects> <escalations> <uptime_s>
# ---------------------------------------------------------------------------

# Той самий випадок, через який перевірку й переписали: 12 розривів за 38 годин,
# кожен піднявся з першої спроби. Старий абсолютний поріг (>10) тут кричав.
expect_eq "classify_realtime_churn: 12 розривів за 38 год, усі відновились одразу -> ok" \
  "ok" "$(classify_realtime_churn 12 0 136800)"
expect_eq "classify_realtime_churn: здоровий воркер із довгим аптаймом не набирає тривогу лічильником" \
  "ok" "$(classify_realtime_churn 40 0 864000)"
expect_eq "classify_realtime_churn: 3 розриви на годину -> flapping" \
  "flapping" "$(classify_realtime_churn 3 0 3600)"
expect_eq "classify_realtime_churn: рівно 2 на годину — ще в межах" \
  "ok" "$(classify_realtime_churn 2 0 3600)"
expect_eq "classify_realtime_churn: 0 розривів -> ok" \
  "ok" "$(classify_realtime_churn 0 0 136800)"

# Канал, що не піднімається з першої спроби, — поломка незалежно від аптайму.
expect_eq "classify_realtime_churn: 3 невдалі перші спроби -> not_recovering навіть при великому аптаймі" \
  "not_recovering" "$(classify_realtime_churn 5 3 864000)"
expect_eq "classify_realtime_churn: 2 невдалі перші спроби — ще не тривога" \
  "ok" "$(classify_realtime_churn 5 2 864000)"
expect_eq "classify_realtime_churn: not_recovering має пріоритет над частотою" \
  "not_recovering" "$(classify_realtime_churn 99 9 864000)"

# Аптайм невідомий (у лозі немає маркера старту) або замалий для частоти —
# лишається старий абсолютний поріг.
expect_eq "classify_realtime_churn: аптайм невідомий, 12 розривів -> flapping (старий режим)" \
  "flapping" "$(classify_realtime_churn 12 0 0)"
expect_eq "classify_realtime_churn: аптайм невідомий, 10 розривів -> ok (межа старого порогу)" \
  "ok" "$(classify_realtime_churn 10 0 0)"
expect_eq "classify_realtime_churn: свіжий воркер, 11 розривів за 10 хв -> flapping" \
  "flapping" "$(classify_realtime_churn 11 0 600)"
expect_eq "classify_realtime_churn: свіжий воркер, 2 розриви за 10 хв -> ok" \
  "ok" "$(classify_realtime_churn 2 0 600)"

expect_eq "classify_realtime_churn: сміття замість чисел -> ok, а не падіння" \
  "ok" "$(classify_realtime_churn "abc" "" "хтозна")"
expect_eq "classify_realtime_churn: без аргументів узагалі -> ok" \
  "ok" "$(classify_realtime_churn)"

# ---------------------------------------------------------------------------
# classify_queue_state <due> <oldest_s> <busy_type> <stale_after_s>
# ---------------------------------------------------------------------------

expect_eq "classify_queue_state: черга порожня" \
  "empty" "$(classify_queue_state 0 0 "-" 900)"
expect_eq "classify_queue_state: є due, не протухло -> moving" \
  "moving" "$(classify_queue_state 3 100 "-" 900)"
expect_eq "classify_queue_state: oldest рівно на порозі — ще НЕ протухло (умова строго >)" \
  "moving" "$(classify_queue_state 3 900 "-" 900)"
expect_eq "classify_queue_state: oldest на секунду за порогом -> stalled" \
  "stalled" "$(classify_queue_state 3 901 "-" 900)"
expect_eq "classify_queue_state: протухло і busy_type=deep_research_synthesis -> waiting_long_job" \
  "waiting_long_job" "$(classify_queue_state 3 901 "deep_research_synthesis" 900)"
expect_eq "classify_queue_state: протухло, busy_type інший -> stalled (не виправдовує)" \
  "stalled" "$(classify_queue_state 3 901 "collect" 900)"
expect_eq "classify_queue_state: протухло, busy_type=- (нема активного джоба) -> stalled" \
  "stalled" "$(classify_queue_state 3 901 "-" 900)"
expect_eq "classify_queue_state: due=0, не протухло -> empty" \
  "empty" "$(classify_queue_state 0 500 "-" 900)"
expect_eq "classify_queue_state: due=0 рівно на секунду до протухання -> empty" \
  "empty" "$(classify_queue_state 0 899 "-" 900)"

# ---------------------------------------------------------------------------
# classify_run_state <age_s> <threshold_s> <status>
# ---------------------------------------------------------------------------

expect_eq "classify_run_state: age < threshold, статус ok -> ok" \
  "ok" "$(classify_run_state 100 1000 "ok")"
expect_eq "classify_run_state: age рівно на порозі — ще НЕ stale (умова строго >)" \
  "ok" "$(classify_run_state 1000 1000 "ok")"
expect_eq "classify_run_state: age на секунду за порогом -> stale" \
  "stale" "$(classify_run_state 1001 1000 "ok")"
expect_eq "classify_run_state: age на секунду за порогом, навіть якщо статус error -> stale (протухлість первинна)" \
  "stale" "$(classify_run_state 1001 1000 "error")"
expect_eq "classify_run_state: у межах порогу, статус error -> error" \
  "error" "$(classify_run_state 100 1000 "error")"
expect_eq "classify_run_state: у межах порогу, статус success -> ok" \
  "ok" "$(classify_run_state 100 1000 "success")"
expect_eq "classify_run_state: age=0 -> ok" \
  "ok" "$(classify_run_state 0 1000 "ok")"

# ---------------------------------------------------------------------------
# classify_websearch_probe <ws_out> <elapsed_s> <timeout_s>
# ---------------------------------------------------------------------------

expect_eq "classify_websearch_probe: таймаут вичерпано, вивід порожній -> timeout" \
  "timeout" "$(classify_websearch_probe "" 240 240)"
expect_eq "classify_websearch_probe: elapsed рівно на межі таймауту (>=) — вже timeout" \
  "timeout" "$(classify_websearch_probe "" 240 240)"
expect_eq "classify_websearch_probe: elapsed на секунду до таймауту, вивід порожній -> no_result (ще не timeout)" \
  "no_result" "$(classify_websearch_probe "" 239 240)"
expect_eq "classify_websearch_probe: таймаут вичерпано, але вивід не порожній (лише пробіли) -> timeout" \
  "timeout" "$(classify_websearch_probe "   " 240 240)"
expect_eq "classify_websearch_probe: помилка автентифікації (oauth) -> auth_failed" \
  "auth_failed" "$(classify_websearch_probe "OAuth token expired" 5 240)"
expect_eq "classify_websearch_probe: 401 -> auth_failed" \
  "auth_failed" "$(classify_websearch_probe "Error: 401 Unauthorized" 5 240)"
expect_eq "classify_websearch_probe: invalid api key -> auth_failed" \
  "auth_failed" "$(classify_websearch_probe "invalid api key provided" 5 240)"
expect_eq "classify_websearch_probe: валідна відповідь з URL і датою -> ok" \
  "ok" "$(classify_websearch_probe "https://example.com/news | 2026-08-04 | Заголовок" 12 240)"
expect_eq "classify_websearch_probe: є URL, але немає дати -> no_result" \
  "no_result" "$(classify_websearch_probe "https://example.com/news без дати" 12 240)"
expect_eq "classify_websearch_probe: є дата, але немає URL -> no_result" \
  "no_result" "$(classify_websearch_probe "2026-08-04 без посилання" 12 240)"
expect_eq "classify_websearch_probe: NO_SEARCH (модель чесно каже, що пошуку нема) -> no_result" \
  "no_result" "$(classify_websearch_probe "NO_SEARCH" 12 240)"
expect_eq "classify_websearch_probe: порожній вивід, elapsed НЕ на межі таймауту -> no_result, не timeout" \
  "no_result" "$(classify_websearch_probe "" 12 240)"

test_summary 92
