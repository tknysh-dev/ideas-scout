#!/usr/bin/env bash
# reddit-fetch.sh — передкачування Reddit для агента-збирача (Фаза 3, PLAN.md).
# Агент (claude -p) не має Bash/git — не може сам зробити OAuth POST до Reddit,
# тож runner.sh викликає цей скрипт ДО запуску CLI (лише для --agent collector).
# Опційне джерело: без Keychain-креденшелів скрипт чисто виходить з кодом 0.
#
# Секрети (client secret, access token) НІКОЛИ не потрапляють в argv (видно
# в `ps aux` будь-якому локальному процесу) і в логи — передаються curl-у
# через -K - (конфіг на stdin), як у scripts/monitor.sh.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

CACHE_DIR="$REPO_ROOT/logs/runs/reddit-cache/latest"
USER_AGENT="macos:ideas-scout:v0.1 (by /u/ideas-scout-agent)"
SUBREDDITS=(passive_income sidehustle EntrepreneurRideAlong juststart SaaS)

# ---------------------------------------------------------------------------
# Креденшели лише з Keychain. Немає хоч одного — опційне джерело, чистий вихід.
# ---------------------------------------------------------------------------

CLIENT_ID="$(security find-generic-password -s ideas-scout-reddit-id -w 2>/dev/null || true)"
CLIENT_SECRET="$(security find-generic-password -s ideas-scout-reddit-secret -w 2>/dev/null || true)"

if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ]; then
  echo "reddit-fetch.sh: Reddit-креденшели не налаштовані — пропускаю"
  exit 0
fi

json_reader() {
  if command -v jq >/dev/null 2>&1; then
    echo "jq"
  elif command -v python3 >/dev/null 2>&1; then
    echo "python3"
  else
    echo "none"
  fi
}
READER="$(json_reader)"

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

if [ "$READER" = "none" ]; then
  echo "reddit-fetch.sh: ні jq, ні python3 не знайдено — не можу розібрати відповіді Reddit, пропускаю" >&2
  exit 0
fi

rm -rf "$CACHE_DIR"
mkdir -p "$CACHE_DIR"

# ---------------------------------------------------------------------------
# OAuth client_credentials (userless, read-only): client id/secret через basic
# auth у -K config (рядок "user = id:secret"), не через argv.
# ---------------------------------------------------------------------------

TOKEN_FILE="$(mktemp "${TMPDIR:-/tmp}/ideas-scout-reddit-token.XXXXXX")"
trap 'rm -f "$TOKEN_FILE"' EXIT

HTTP_CODE="$(curl -sS -o "$TOKEN_FILE" -w '%{http_code}' --max-time 20 -K - <<EOF 2>/dev/null || true
url = "https://www.reddit.com/api/v1/access_token"
user = "${CLIENT_ID}:${CLIENT_SECRET}"
data = "grant_type=client_credentials"
header = "User-Agent: ${USER_AGENT}"
EOF
)"
[ -n "$HTTP_CODE" ] || HTTP_CODE="000"

if [ "$HTTP_CODE" != "200" ]; then
  echo "reddit-fetch.sh: не вдалось отримати OAuth-токен (HTTP ${HTTP_CODE}) — Reddit пропущено цього прогону" >&2
  {
    echo "# Reddit-кеш — $(date -u +%FT%TZ)"
    echo ""
    echo "OAuth-токен не отримано (HTTP ${HTTP_CODE}). Усі сабреддіти пропущено цього прогону."
  } > "$CACHE_DIR/_meta.md"
  exit 0
fi

ACCESS_TOKEN="$(get_json_field "$TOKEN_FILE" access_token)"
rm -f "$TOKEN_FILE"

if [ -z "$ACCESS_TOKEN" ]; then
  echo "reddit-fetch.sh: відповідь OAuth без access_token — Reddit пропущено цього прогону" >&2
  {
    echo "# Reddit-кеш — $(date -u +%FT%TZ)"
    echo ""
    echo "OAuth-відповідь HTTP 200, але без access_token у тілі. Усі сабреддіти пропущено цього прогону."
  } > "$CACHE_DIR/_meta.md"
  exit 0
fi

# ---------------------------------------------------------------------------
# По одному GET на сабреддіт. Bearer-токен теж лише через -K config, не argv.
# 429/403 → одна повторна спроба через 15с; далі — зафіксувати деградацію й іти далі.
# ---------------------------------------------------------------------------

fetch_subreddit() {
  local sub="$1" outfile="$2"
  curl -sS -o "$outfile" -w '%{http_code}' --max-time 30 -K - <<EOF 2>/dev/null || true
url = "https://oauth.reddit.com/r/${sub}/top?t=week&limit=50"
header = "Authorization: bearer ${ACCESS_TOKEN}"
header = "User-Agent: ${USER_AGENT}"
EOF
}

OK_SUBS=()
DEGRADED_SUBS=()

for sub in "${SUBREDDITS[@]}"; do
  outfile="$CACHE_DIR/${sub}.json"
  code="$(fetch_subreddit "$sub" "$outfile")"
  [ -n "$code" ] || code="000"

  if [ "$code" = "429" ] || [ "$code" = "403" ]; then
    echo "reddit-fetch.sh: r/${sub} — HTTP ${code}, повторна спроба через 15с"
    sleep 15
    code="$(fetch_subreddit "$sub" "$outfile")"
    [ -n "$code" ] || code="000"
  fi

  if [ "$code" = "200" ]; then
    n="$(count_posts "$outfile")"
    OK_SUBS+=("${sub} (постів: ${n})")
    echo "reddit-fetch.sh: r/${sub} — ок, постів: ${n}"
  else
    DEGRADED_SUBS+=("${sub} (HTTP ${code})")
    echo "reddit-fetch.sh: r/${sub} — деградація, HTTP ${code}" >&2
    rm -f "$outfile"
  fi

  sleep 2
done

{
  echo "# Reddit-кеш — $(date -u +%FT%TZ)"
  echo ""
  echo "## Ок"
  if [ "${#OK_SUBS[@]}" -eq 0 ]; then
    echo "(жодного)"
  else
    for s in "${OK_SUBS[@]}"; do echo "- ${s}"; done
  fi
  echo ""
  echo "## Деградували"
  if [ "${#DEGRADED_SUBS[@]}" -eq 0 ]; then
    echo "(жодного)"
  else
    for s in "${DEGRADED_SUBS[@]}"; do echo "- ${s}"; done
  fi
} > "$CACHE_DIR/_meta.md"

echo "reddit-fetch.sh: завершено (ок: ${#OK_SUBS[@]}, деградували: ${#DEGRADED_SUBS[@]})"
exit 0
