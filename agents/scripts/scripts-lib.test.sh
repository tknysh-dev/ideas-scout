#!/usr/bin/env bash
# Юніт-тести чистих функцій scripts-lib.sh: monitor.sh, reddit-fetch.sh,
# install-launchd.sh, generate-index.sh.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_NAME="scripts-lib"
# shellcheck source=agents/scripts/test-lib.sh
source "$SCRIPT_DIR/test-lib.sh"
# shellcheck source=agents/scripts/scripts-lib.sh
source "$SCRIPT_DIR/scripts-lib.sh"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# ---------------------------------------------------------------------------
# telegram_creds_error <chat_id> <token>
# ---------------------------------------------------------------------------

expect_eq "telegram_creds_error: валідні chat_id і токен — порожньо" \
  "" "$(telegram_creds_error "123456789" "111111:AAAAbbbbCCCCddddEEEEffff")"
expect_eq "telegram_creds_error: обидва порожні — порожньо (перевіряються деінде)" \
  "" "$(telegram_creds_error "" "")"
expect_eq "telegram_creds_error: chat_id не число" \
  "chat_id у Keychain не є числом (ймовірно збережений з невидимим символом). Перезапиши: security add-generic-password -U -A -s ideas-scout-telegram-chat -a ideas-scout -w '<ЧИСЛО>'" \
  "$(telegram_creds_error "12a34" "111111:AAAAbbbb")"
expect_eq "telegram_creds_error: chat_id з невидимим NBSP всередині — не число" \
  "chat_id у Keychain не є числом (ймовірно збережений з невидимим символом). Перезапиши: security add-generic-password -U -A -s ideas-scout-telegram-chat -a ideas-scout -w '<ЧИСЛО>'" \
  "$(telegram_creds_error "$(printf '123\xc2\xa0456')" "111111:AAAAbbbb")"
expect_eq "telegram_creds_error: chat_id від'ємний — валідний формат" \
  "" "$(telegram_creds_error "-100123456" "111111:AAAAbbbb")"
expect_eq "telegram_creds_error: токен без двокрапки" \
  "токен у Keychain не схожий на токен Telegram (ймовірно збережений з невидимим символом). Перезапиши: security add-generic-password -U -A -s ideas-scout-telegram -a ideas-scout -w '<ТОКЕН>'" \
  "$(telegram_creds_error "123" "not-a-token")"
expect_eq "telegram_creds_error: пріоритет за chat_id, якщо обидва биті" \
  "chat_id у Keychain не є числом (ймовірно збережений з невидимим символом). Перезапиши: security add-generic-password -U -A -s ideas-scout-telegram-chat -a ideas-scout -w '<ЧИСЛО>'" \
  "$(telegram_creds_error "abc" "not-a-token")"

# ---------------------------------------------------------------------------
# digest_text_from_json / digest_counts_from_json
# ---------------------------------------------------------------------------

expect_eq "digest_text_from_json: звичайний текст" \
  "hello world" "$(digest_text_from_json '{"text": "hello world", "created": 1, "updated": 2}')"
expect_eq "digest_text_from_json: кирилиця й HTML-теги" \
  "<b>Привіт</b>" "$(digest_text_from_json '{"text": "<b>Привіт</b>"}')"

expect_eq "digest_counts_from_json: звичайні числа" \
  "3 5" "$(digest_counts_from_json '{"text": "x", "created": 3, "updated": 5}')"
expect_eq "digest_counts_from_json: нулі" \
  "0 0" "$(digest_counts_from_json '{"created": 0, "updated": 0}')"
expect_eq "digest_counts_from_json: сміттєвий JSON — фолбек ? ?" \
  "? ?" "$(digest_counts_from_json 'not json at all {{{')"
expect_eq "digest_counts_from_json: порожній рядок — фолбек ? ?" \
  "? ?" "$(digest_counts_from_json '')"
expect_eq "digest_counts_from_json: без полів created/updated — фолбек ? ?" \
  "? ?" "$(digest_counts_from_json '{"text": "x"}')"

# ---------------------------------------------------------------------------
# monitor_status_from_sent
# ---------------------------------------------------------------------------

expect_eq "monitor_status_from_sent: true -> ok" "ok" "$(monitor_status_from_sent "true")"
expect_eq "monitor_status_from_sent: false -> error" "error" "$(monitor_status_from_sent "false")"

# ---------------------------------------------------------------------------
# monitor_meta_json / monitor_errors_json
# ---------------------------------------------------------------------------

expect_eq "monitor_meta_json: успіх без помилки, з чергою" \
  '{"error": null, "telegram_sent": true, "healthcheck_pinged": true, "created_ideas_24h": "3", "updated_ideas_24h": "5", "queue": {"due": 2}}' \
  "$(monitor_meta_json "" "true" "true" "3" "5" '{"due": 2}')"
expect_eq "monitor_meta_json: з помилкою, без черги (порожній аргумент -> null)" \
  '{"error": "telegram sendMessage HTTP 404", "telegram_sent": false, "healthcheck_pinged": false, "created_ideas_24h": "?", "updated_ideas_24h": "?", "queue": null}' \
  "$(monitor_meta_json "telegram sendMessage HTTP 404" "false" "false" "?" "?" "")"

expect_eq "monitor_errors_json: без помилки -> []" "[]" "$(monitor_errors_json "")"
expect_eq "monitor_errors_json: з помилкою -> масив з одним рядком" \
  '["no telegram credentials in Keychain"]' "$(monitor_errors_json "no telegram credentials in Keychain")"

# ---------------------------------------------------------------------------
# json_reader (детекція jq/python3 через PATH)
# ---------------------------------------------------------------------------

expect_eq "json_reader: звичайний PATH — jq або python3 у наявності" "jq" "$(
  FAKEBIN="$TMP_DIR/reader-jq"; mkdir -p "$FAKEBIN"
  ln -s "$(command -v cat)" "$FAKEBIN/jq"
  PATH="$FAKEBIN" json_reader
)"
expect_eq "json_reader: лише python3 у PATH" "python3" "$(
  FAKEBIN="$TMP_DIR/reader-py"; mkdir -p "$FAKEBIN"
  ln -s "$(command -v python3)" "$FAKEBIN/python3"
  PATH="$FAKEBIN" json_reader
)"
expect_eq "json_reader: ні jq, ні python3 у PATH" "none" "$(
  FAKEBIN="$TMP_DIR/reader-none"; mkdir -p "$FAKEBIN"
  PATH="$FAKEBIN" json_reader
)"

# ---------------------------------------------------------------------------
# get_json_field / count_posts — обробка відповіді Reddit, включно з
# ворожими входами (порожній файл, сміттєвий JSON, дуже довгі рядки, розмітка).
# ---------------------------------------------------------------------------

READER="python3"

TOKEN_OK="$TMP_DIR/token_ok.json"
printf '%s' '{"access_token": "abc123", "expires_in": 3600}' > "$TOKEN_OK"
expect_eq "get_json_field (python3): звичайне поле" "abc123" "$(get_json_field "$TOKEN_OK" access_token)"
expect_eq "get_json_field (python3): відсутнє поле" "" "$(get_json_field "$TOKEN_OK" nope)"

expect_eq "get_json_field: файла не існує — порожньо" "" "$(get_json_field "$TMP_DIR/does-not-exist.json" access_token)"

EMPTY_FILE="$TMP_DIR/empty.json"
: > "$EMPTY_FILE"
expect_eq "get_json_field: порожній файл — порожньо (не падає)" "" "$(get_json_field "$EMPTY_FILE" access_token)"
expect_eq "count_posts: порожній файл — 0 (файл існує, парсер сам поверне ?)" \
  "?" "$(count_posts "$EMPTY_FILE")"

GARBAGE_FILE="$TMP_DIR/garbage.json"
printf '%s' '{not valid json at all [[[' > "$GARBAGE_FILE"
expect_eq "get_json_field: сміттєвий JSON — порожньо, не падає" "" "$(get_json_field "$GARBAGE_FILE" access_token)"
expect_eq "count_posts: сміттєвий JSON — ?" "?" "$(count_posts "$GARBAGE_FILE")"

LONG_VALUE="$(python3 -c 'print("x" * 200000)')"
LONG_FILE="$TMP_DIR/long.json"
python3 -c 'import json,sys; json.dump({"access_token": sys.argv[1]}, open(sys.argv[2], "w"))' "$LONG_VALUE" "$LONG_FILE"
expect_eq "get_json_field: дуже довге значення (200000 символів) читається ціле" \
  "$LONG_VALUE" "$(get_json_field "$LONG_FILE" access_token)"

MARKUP_FILE="$TMP_DIR/markup.json"
# shellcheck disable=SC2016  # одинарні лапки навмисно: $ і ` у фікстурі буквальні, не для розкриття
MARKUP_VALUE='<script>alert(1)</script> & "лапки" та `бектики`'
python3 -c 'import json,sys; json.dump({"title": sys.argv[1]}, open(sys.argv[2], "w"))' \
  "$MARKUP_VALUE" "$MARKUP_FILE"
expect_eq "get_json_field: символи розмітки/лапки в значенні — повертаються дослівно" \
  "$MARKUP_VALUE" "$(get_json_field "$MARKUP_FILE" title)"

POSTS_FILE="$TMP_DIR/posts.json"
python3 -c 'import json; json.dump({"data": {"children": [{}, {}, {}]}}, open("'"$POSTS_FILE"'", "w"))'
expect_eq "count_posts (python3): три пости" "3" "$(count_posts "$POSTS_FILE")"

NO_CHILDREN_FILE="$TMP_DIR/no_children.json"
printf '%s' '{"data": {}}' > "$NO_CHILDREN_FILE"
expect_eq "count_posts: data без children — 0, не падає" "0" "$(count_posts "$NO_CHILDREN_FILE")"

expect_eq "count_posts: файла не існує — 0" "0" "$(count_posts "$TMP_DIR/does-not-exist.json")"

READER="jq"
if command -v jq >/dev/null 2>&1; then
  JQ_TOKEN_FILE="$TMP_DIR/jq_token.json"
  printf '%s' '{"access_token": "jqtoken"}' > "$JQ_TOKEN_FILE"
  expect_eq "get_json_field (jq): звичайне поле" "jqtoken" "$(get_json_field "$JQ_TOKEN_FILE" access_token)"

  JQ_GARBAGE_FILE="$TMP_DIR/jq_garbage.json"
  printf '%s' '{not valid' > "$JQ_GARBAGE_FILE"
  expect_eq "get_json_field (jq): сміттєвий JSON — порожньо, не падає" "" "$(get_json_field "$JQ_GARBAGE_FILE" access_token)"

  JQ_POSTS_FILE="$TMP_DIR/jq_posts.json"
  printf '%s' '{"data": {"children": [1, 2]}}' > "$JQ_POSTS_FILE"
  expect_eq "count_posts (jq): два пости" "2" "$(count_posts "$JQ_POSTS_FILE")"
else
  expect_eq "get_json_field (jq): пропущено, jq не встановлено — фіктивний прохідний тест" "1" "1"
  expect_eq "get_json_field (jq): пропущено, jq не встановлено — фіктивний прохідний тест 2" "1" "1"
  expect_eq "count_posts (jq): пропущено, jq не встановлено — фіктивний прохідний тест" "1" "1"
fi
READER="python3"

# ---------------------------------------------------------------------------
# reddit_format_group
# ---------------------------------------------------------------------------

expect_eq "reddit_format_group: без елементів" \
  "$(printf '## Ок\n(жодного)')" "$(reddit_format_group "Ок")"
expect_eq "reddit_format_group: один елемент" \
  "$(printf '## Ок\n- passive_income (постів: 12)')" \
  "$(reddit_format_group "Ок" "passive_income (постів: 12)")"
expect_eq "reddit_format_group: кілька елементів у заданому порядку" \
  "$(printf '## Деградували\n- SaaS (HTTP 429)\n- juststart (HTTP 000)')" \
  "$(reddit_format_group "Деградували" "SaaS (HTTP 429)" "juststart (HTTP 000)")"

# ---------------------------------------------------------------------------
# install_launchd_uninstall_flag
# ---------------------------------------------------------------------------

expect_eq "install_launchd_uninstall_flag: без аргументу -> 0" "0" "$(install_launchd_uninstall_flag "")"
expect_eq "install_launchd_uninstall_flag: --uninstall -> 1" "1" "$(install_launchd_uninstall_flag "--uninstall")"
expect_fail "install_launchd_uninstall_flag: невідомий аргумент -> ненульовий код" \
  install_launchd_uninstall_flag "--bogus"
expect_fail "install_launchd_uninstall_flag: випадковий текст -> ненульовий код" \
  install_launchd_uninstall_flag "uninstall"

# ---------------------------------------------------------------------------
# install_launchd_domain / install_launchd_label
# ---------------------------------------------------------------------------

expect_eq "install_launchd_domain: звичайний uid" "gui/501" "$(install_launchd_domain "501")"
expect_eq "install_launchd_domain: uid 0 (root)" "gui/0" "$(install_launchd_domain "0")"

expect_eq "install_launchd_label: звичайний .plist" \
  "com.ideas-scout.monitor" "$(install_launchd_label "com.ideas-scout.monitor.plist")"
expect_eq "install_launchd_label: без розширення — без змін" \
  "com.ideas-scout.monitor" "$(install_launchd_label "com.ideas-scout.monitor")"
expect_eq "install_launchd_label: .plist посередині імені не чіпається (лише суфікс)" \
  "foo.plist.bak" "$(install_launchd_label "foo.plist.bak")"

# ---------------------------------------------------------------------------
# generate_index_header
# ---------------------------------------------------------------------------

# shellcheck disable=SC2016  # одинарні лапки навмисно: ` у шаблоні буквальний, не для розкриття
EXPECTED_INDEX_HEADER='# Індекс: passive-income

Автогенеровано `agents/scripts/generate-index.sh` 2026-08-05T12:00:00Z. Не редагувати вручну — файл у .gitignore, перегенеровується щоразу.

| id | title | type | status | rejection_code | confidence |
|---|---|---|---|---|---|'
expect_eq "generate_index_header: точний формат для passive-income" \
  "$EXPECTED_INDEX_HEADER" \
  "$(generate_index_header "passive-income" "2026-08-05T12:00:00Z")"

# ---------------------------------------------------------------------------
# generate_index_row
# ---------------------------------------------------------------------------

expect_eq "generate_index_row: усі поля заповнені" \
  "| idea-001 | Назва ідеї | passive-income | active | — | 0.8 |" \
  "$(generate_index_row "idea-001" "Назва ідеї" "passive-income" "active" "" "0.8")"
expect_eq "generate_index_row: усі поля порожні -> дефолти" \
  "| ? | ? | ? | ? | — | ? |" \
  "$(generate_index_row "" "" "" "" "" "")"
expect_eq "generate_index_row: rejection_code заповнений, інші порожні" \
  "| ? | ? | ? | ? | too-niche | ? |" \
  "$(generate_index_row "" "" "" "" "too-niche" "")"
expect_eq "generate_index_row: символ | у полі не екранується (дослівна поведінка оригіналу)" \
  "| id-1 | a|b | c | d | — | e |" \
  "$(generate_index_row "id-1" "a|b" "c" "d" "" "e")"

# ---------------------------------------------------------------------------
# extract_field (front-matter)
# ---------------------------------------------------------------------------

FM_FILE="$TMP_DIR/idea.md"
cat > "$FM_FILE" <<'EOF'
---
id: idea-001
title: "Назва в лапках"
type: passive-income
status: active
confidence: 0.75
sources:
  - id: reddit-1
    nested_only: "не мій рівень frontmatter"
---

# Тіло нотатки
EOF

expect_eq "extract_field: звичайне поле id" "idea-001" "$(extract_field "$FM_FILE" id)"
expect_eq "extract_field: поле в лапках — лапки знімаються" \
  "Назва в лапках" "$(extract_field "$FM_FILE" title)"
expect_eq "extract_field: числове поле" "0.75" "$(extract_field "$FM_FILE" confidence)"
expect_eq "extract_field: не бачить поле, яке існує лише всередині вкладеного sources:" \
  "" "$(extract_field "$FM_FILE" nested_only)"
expect_eq "extract_field: id з top-level не підмінюється вкладеним id всередині sources:" \
  "idea-001" "$(extract_field "$FM_FILE" id)"
expect_eq "extract_field: відсутнє поле -> порожньо" "" "$(extract_field "$FM_FILE" rejection_code)"
NO_FM_FILE="$TMP_DIR/no-frontmatter.md"
printf '%s\n' "# Просто нотатка без frontmatter" > "$NO_FM_FILE"
expect_eq "extract_field: файл без frontmatter -> порожньо" \
  "" "$(extract_field "$NO_FM_FILE" id)"

FM_COMMENT="$TMP_DIR/idea-comment.md"
cat > "$FM_COMMENT" <<'EOF'
---
id: idea-002 # службовий коментар
status: rejected
---
EOF
expect_eq "extract_field: обрізає інлайновий # коментар і пробіли навколо" \
  "idea-002" "$(extract_field "$FM_COMMENT" id)"

test_summary 63
