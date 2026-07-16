#!/usr/bin/env bash
# monitor.sh — щоденний дайджест: підсумовує logs/status/*.json, рахує нові/змінені
# записи реєстру за 24 год, попереджає про джоби, що не запускались довше очікуваного
# інтервалу, і надсилає все в Telegram. Секрети — лише з Keychain, ніколи з репо/env.
#
# Дедлайн-свисток (рекомендація рецензії): «відсутність дайджесту — сама по собі
# сигнал» ненадійне — тому після успішної відправки в Telegram додатково пінгуємо
# зовнішній dead-man's switch (Keychain-запис ideas-scout-healthcheck), якщо він є.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT" || exit 2

mkdir -p "$REPO_ROOT/logs/status"
STATUS_DIR="$REPO_ROOT/logs/status"
MONITOR_STATUS_FILE="$STATUS_DIR/monitor.json"

# Джоби, які мають запускатись регулярно (Фаза 6, розклад). Трек app-ideas свідомо
# відсутній — критерії v0.0 порожні (PLAN.md), додати сюди при активації треку.
EXPECTED_JOBS=("passive-income-collector" "passive-income-analyst")
STALE_AFTER_S=$((3 * 24 * 3600))  # 3 доби, як зазначено в PLAN.md

json_reader() {
  # Перевага jq, якщо є (простіше й швидше); фолбек — python3 (надійніша
  # гарантія наявності на macOS, ніж jq, якого стандартно немає в системі).
  if command -v jq >/dev/null 2>&1; then
    echo "jq"
  elif command -v python3 >/dev/null 2>&1; then
    echo "python3"
  else
    echo "none"
  fi
}

READER="$(json_reader)"
if [ "$READER" = "none" ]; then
  echo "monitor.sh: ні jq, ні python3 не знайдено — не можу розібрати статус-файли" >&2
  cat > "$MONITOR_STATUS_FILE" <<EOF
{"checked_at": "$(date -u +%FT%TZ)", "status": "error", "error": "no jq or python3 available", "telegram_sent": false, "healthcheck_pinged": false}
EOF
  exit 0
fi

get_field() {
  # get_field <файл.json> <поле> — повертає порожньо, якщо файла/поля нема.
  local file="$1" field="$2"
  [ -f "$file" ] || { echo ""; return; }
  if [ "$READER" = "jq" ]; then
    jq -r --arg f "$field" '.[$f] // ""' "$file" 2>/dev/null
  else
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

now_epoch="$(date +%s)"

DIGEST_LINES=()
DIGEST_LINES+=("Ideas-scout — щоденний дайджест ($(date -u +%FT%TZ))")
DIGEST_LINES+=("")
DIGEST_LINES+=("Джоби:")

MAX_STASH=0

for job in "${EXPECTED_JOBS[@]}"; do
  status_file="$STATUS_DIR/${job}.json"
  if [ ! -f "$status_file" ]; then
    DIGEST_LINES+=("⚠️ ${job}: ще жодного разу не запускався")
    continue
  fi
  finished_at="$(get_field "$status_file" finished_at)"
  status="$(get_field "$status_file" status)"
  push="$(get_field "$status_file" push)"
  stash_count="$(get_field "$status_file" stash_count)"
  case "$stash_count" in ''|*[!0-9]*) stash_count=0 ;; esac
  [ "$stash_count" -gt "$MAX_STASH" ] && MAX_STASH="$stash_count"

  age_note=""
  if [ -n "$finished_at" ]; then
    finished_epoch="$(date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$finished_at" +%s 2>/dev/null || echo 0)"
    if [ "$finished_epoch" -gt 0 ]; then
      age=$(( now_epoch - finished_epoch ))
      if [ "$age" -gt "$STALE_AFTER_S" ]; then
        age_note=" ⚠️ давно не запускався ($((age / 3600)) год тому, поріг 72 год)"
      fi
    fi
  fi

  DIGEST_LINES+=("- ${job}: останній прогін ${finished_at:-?}, статус=${status:-?}, push=${push:-?}${age_note}")
done

DIGEST_LINES+=("")

if [ "$MAX_STASH" -gt 0 ]; then
  DIGEST_LINES+=("⚠️ У репозиторії ${MAX_STASH} відкладених stash від прогонів (засташована чужа робота) — розберіть 'git stash list' вручну")
  DIGEST_LINES+=("")
fi

CHANGED_COUNT=0
if git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  CHANGED_COUNT="$(git -C "$REPO_ROOT" log --since="24 hours ago" --name-only --pretty=format: -- 'registries/*/ideas/*.md' 2>/dev/null \
    | sed '/^$/d' | sort -u | wc -l | tr -d ' ')"
fi
DIGEST_LINES+=("Записів реєстру додано/змінено за 24 год: ${CHANGED_COUNT}")

DIGEST_TEXT="$(printf '%s\n' "${DIGEST_LINES[@]}")"
echo "$DIGEST_TEXT"

# ---------------------------------------------------------------------------
# Telegram: токен і chat_id ЛИШЕ з Keychain. Немає — лог-попередження, не помилка.
# ---------------------------------------------------------------------------

TELEGRAM_SENT=false
TG_ERROR=""

TG_TOKEN="$(security find-generic-password -s ideas-scout-telegram -w 2>/dev/null || true)"
TG_CHAT_ID="$(security find-generic-password -s ideas-scout-telegram-chat -w 2>/dev/null || true)"

if [ -z "$TG_TOKEN" ] || [ -z "$TG_CHAT_ID" ]; then
  echo "monitor.sh: немає Telegram-токена/chat_id у Keychain (ideas-scout-telegram / ideas-scout-telegram-chat) — дайджест не надіслано" >&2
  TG_ERROR="no telegram credentials in Keychain"
else
  # URL з токеном передається curl-у через config на stdin (-K -), НЕ через argv —
  # аргументи процесу видно будь-кому в `ps aux`, stdin — ні. Текст дайджесту
  # і chat_id не секретні, вони лишаються в argv.
  HTTP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' \
    --max-time 20 \
    --data-urlencode "chat_id=${TG_CHAT_ID}" \
    --data-urlencode "text=${DIGEST_TEXT}" \
    -K - <<EOF 2>/dev/null || true
url = "https://api.telegram.org/bot${TG_TOKEN}/sendMessage"
EOF
)"
  [ -n "$HTTP_CODE" ] || HTTP_CODE="000"
  # TG_TOKEN ніколи не пишемо в лог/статус — лише http-код відповіді.
  if [ "$HTTP_CODE" = "200" ]; then
    TELEGRAM_SENT=true
    echo "monitor.sh: дайджест надіслано в Telegram (HTTP $HTTP_CODE)"
  else
    TG_ERROR="telegram sendMessage HTTP ${HTTP_CODE}"
    echo "monitor.sh: помилка надсилання в Telegram (HTTP $HTTP_CODE)" >&2
  fi
  unset TG_TOKEN
fi

# ---------------------------------------------------------------------------
# Dead-man's ping: лише після успішного надсилання, лише якщо URL є в Keychain.
# ---------------------------------------------------------------------------

HEALTHCHECK_PINGED=false
if [ "$TELEGRAM_SENT" = "true" ]; then
  HC_URL="$(security find-generic-password -s ideas-scout-healthcheck -w 2>/dev/null || true)"
  if [ -n "$HC_URL" ]; then
    # URL теж через config на stdin — приватний uuid перевірки не світиться в ps.
    if curl -fsS -o /dev/null --max-time 10 -K - >/dev/null 2>&1 <<EOF
url = "${HC_URL}"
EOF
    then
      HEALTHCHECK_PINGED=true
      echo "monitor.sh: healthcheck-пінг надіслано"
    else
      echo "monitor.sh: healthcheck-пінг не вдався" >&2
    fi
    unset HC_URL
  fi
fi

MONITOR_STATUS="ok"
[ "$TELEGRAM_SENT" = "false" ] && MONITOR_STATUS="error"

tmp="$(mktemp "${MONITOR_STATUS_FILE}.XXXXXX")"
cat > "$tmp" <<EOF
{
  "checked_at": "$(date -u +%FT%TZ)",
  "status": "${MONITOR_STATUS}",
  "error": "${TG_ERROR}",
  "telegram_sent": ${TELEGRAM_SENT},
  "healthcheck_pinged": ${HEALTHCHECK_PINGED},
  "changed_ideas_24h": ${CHANGED_COUNT}
}
EOF
mv "$tmp" "$MONITOR_STATUS_FILE"

exit 0
