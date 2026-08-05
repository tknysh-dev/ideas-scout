# shellcheck shell=bash
# scripts-lib.sh — чисті функції з monitor.sh, reddit-fetch.sh,
# install-launchd.sh і generate-index.sh, винесені для юніт-тестів. Один файл
# на всі чотири скрипти: кожен окремо занадто дрібний для власного -lib.sh.
#
# Файл призначений ЛИШЕ для source, не для запуску: без `set -uo pipefail`,
# без виконуваного біта, без коду поза визначеннями функцій — сорсинг сам по
# собі не має жодних побічних ефектів (тест сорсить цей файл і викликає
# функції напряму, без мережі/git/launchctl/запису на диск, якими живуть
# самі скрипти).
#
# Головне правило: нову чисту функцію (без мережі/git/launchctl/запису на
# диск — яку можна покрити тестом без бойового прогону) додавай СЮДИ, а не в
# тіло monitor.sh / reddit-fetch.sh / install-launchd.sh / generate-index.sh.

# ---------------------------------------------------------------------------
# monitor.sh
# ---------------------------------------------------------------------------

# telegram_creds_error <chat_id> <token> — перевірка формату Telegram-креденшелів
# із Keychain (класична ознака зіпсованого запису — невидимий символ, скопійований
# разом зі значенням). Порожній вивід — креденшели виглядають валідно.
telegram_creds_error() {
  local chat_id="$1" token="$2"
  if [ -n "$chat_id" ] && ! printf '%s' "$chat_id" | grep -Eq '^-?[0-9]+$'; then
    echo "chat_id у Keychain не є числом (ймовірно збережений з невидимим символом). Перезапиши: security add-generic-password -U -A -s ideas-scout-telegram-chat -a ideas-scout -w '<ЧИСЛО>'"
  elif [ -n "$token" ] && ! printf '%s' "$token" | grep -Eq '^[0-9]+:[A-Za-z0-9_-]+$'; then
    echo "токен у Keychain не схожий на токен Telegram (ймовірно збережений з невидимим символом). Перезапиши: security add-generic-password -U -A -s ideas-scout-telegram -a ideas-scout -w '<ТОКЕН>'"
  fi
}

# digest_text_from_json <json> — текст дайджесту з тіла, яке віддає digest.py.
digest_text_from_json() {
  python3 -c 'import json,sys; print(json.loads(sys.argv[1])["text"])' "$1"
}

# digest_counts_from_json <json> — "created updated" з тіла digest.py; "? ?",
# якщо тіло не розбирається (для read -r CREATED_COUNT UPDATED_COUNT <<<...).
digest_counts_from_json() {
  python3 -c '
import json, sys
d = json.loads(sys.argv[1])
print(d["created"], d["updated"])
' "$1" 2>/dev/null || echo "? ?"
}

# monitor_status_from_sent <telegram_sent> — статус власного прогону monitor
# у runs: "error", якщо дайджест не пішов у Telegram, інакше "ok".
monitor_status_from_sent() {
  local sent="$1"
  local status="ok"
  [ "$sent" = "false" ] && status="error"
  echo "$status"
}

# monitor_meta_json <tg_error> <telegram_sent> <healthcheck_pinged> <created>
# <updated> <queue_json> — meta-поле для register-run-finish.
monitor_meta_json() {
  python3 -c "
import json,sys
print(json.dumps({
  'error': sys.argv[1] or None,
  'telegram_sent': sys.argv[2] == 'true',
  'healthcheck_pinged': sys.argv[3] == 'true',
  'created_ideas_24h': sys.argv[4],
  'updated_ideas_24h': sys.argv[5],
  'queue': json.loads(sys.argv[6]) if sys.argv[6] else None,
}))
" "$1" "$2" "$3" "$4" "$5" "$6"
}

# monitor_errors_json <tg_error> — errors-поле для register-run-finish: "[]"
# або однoелементний JSON-масив з текстом помилки.
monitor_errors_json() {
  local tg_error="$1"
  if [ -n "$tg_error" ]; then
    python3 -c 'import json,sys; print(json.dumps([sys.argv[1]]))' "$tg_error"
  else
    echo "[]"
  fi
}

# ---------------------------------------------------------------------------
# reddit-fetch.sh
# ---------------------------------------------------------------------------

json_reader() {
  if command -v jq >/dev/null 2>&1; then
    echo "jq"
  elif command -v python3 >/dev/null 2>&1; then
    echo "python3"
  else
    echo "none"
  fi
}

get_json_field() {
  # get_json_field <файл> <поле> — порожньо, якщо нема файла/поля.
  local file="$1" field="$2"
  [ -f "$file" ] || { echo ""; return; }
  if [ "$READER" = "jq" ]; then
    jq -r --arg f "$field" '.[$f] // ""' "$file" 2>/dev/null
  elif [ "$READER" = "python3" ]; then
    python3 -c "
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    v = d.get(sys.argv[2], '')
    print('' if v is None else v)
except Exception:
    print('')
" "$file" "$field" 2>/dev/null
  fi
}

count_posts() {
  # count_posts <файл> — кількість постів у data.children, або "?" якщо не розбирається.
  local file="$1"
  [ -f "$file" ] || { echo "0"; return; }
  if [ "$READER" = "jq" ]; then
    jq -r '.data.children | length' "$file" 2>/dev/null || echo "?"
  elif [ "$READER" = "python3" ]; then
    python3 -c "
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    print(len(d.get('data', {}).get('children', [])))
except Exception:
    print('?')
" "$file" 2>/dev/null
  else
    echo "?"
  fi
}

# reddit_format_group <заголовок> [елемент...] — секція "## заголовок" у
# _meta.md: "(жодного)" без елементів, інакше по одному "- елемент" на рядок.
reddit_format_group() {
  local header="$1"; shift
  echo "## ${header}"
  if [ "$#" -eq 0 ]; then
    echo "(жодного)"
  else
    local s
    for s in "$@"; do echo "- ${s}"; done
  fi
}

# ---------------------------------------------------------------------------
# install-launchd.sh
# ---------------------------------------------------------------------------

# install_launchd_uninstall_flag <arg> — розбір єдиного позиційного аргументу:
# echoes 0/1, повертає ненульовий код на невідомий прапорець (виклик — його
# справа вирішувати, друкувати usage й виходити з кодом 2).
install_launchd_uninstall_flag() {
  case "${1:-}" in
    --uninstall) echo 1 ;;
    "") echo 0 ;;
    *) return 1 ;;
  esac
}

# install_launchd_domain <uid> — launchctl-домен поточного користувача.
install_launchd_domain() {
  echo "gui/$1"
}

# install_launchd_label <basename плиста> — label джобу (ім'я файла без .plist).
install_launchd_label() {
  local base="$1"
  echo "${base%.plist}"
}

# ---------------------------------------------------------------------------
# generate-index.sh
# ---------------------------------------------------------------------------

# Мінімальний YAML-парсер frontmatter для наших цілей: без зовнішніх
# залежностей (без yq); поле — це рядок виду "key: значення" на верхньому
# рівні frontmatter (не всередині sources: чи інших вкладених блоків).
extract_field() {
  local file="$1" field="$2"
  awk -v f="$field" '
    /^---$/ { d++; next }
    d==1 && $0 ~ "^" f ":" {
      sub("^" f ":[ \t]*", "");
      gsub(/^"|"$/, "");
      sub(/[ \t]*#.*$/, "");
      gsub(/^[ \t]+|[ \t]+$/, "");
      print;
      exit
    }
    d>=2 { exit }
  ' "$file"
}

# generate_index_header <track> <generated_at> — шапка й хедер таблиці індексу.
# generated_at приймається аргументом (не викликає date сама), щоб бути
# детермінованою й тестованою — той самий підхід, що build_run_id у runner-lib.sh.
generate_index_header() {
  local track="$1" generated_at="$2"
  cat <<EOF
# Індекс: $track

Автогенеровано \`agents/scripts/generate-index.sh\` ${generated_at}. Не редагувати вручну — файл у .gitignore, перегенеровується щоразу.

| id | title | type | status | rejection_code | confidence |
|---|---|---|---|---|---|
EOF
}

# generate_index_row <id> <title> <type> <status> <rejection_code> <confidence>
# — один рядок таблиці індексу; порожні поля замінюються "?" (rejection_code — "—").
generate_index_row() {
  local id="$1" title="$2" type="$3" status="$4" rejection_code="$5" confidence="$6"
  [ -z "$id" ] && id="?"
  [ -z "$title" ] && title="?"
  [ -z "$type" ] && type="?"
  [ -z "$status" ] && status="?"
  [ -z "$rejection_code" ] && rejection_code="—"
  [ -z "$confidence" ] && confidence="?"
  echo "| $id | $title | $type | $status | $rejection_code | $confidence |"
}
