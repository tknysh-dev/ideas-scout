#!/usr/bin/env bash
# monitor.sh — щоденний дайджест: підсумовує стан прогонів (таблиця runs у
# Supabase, Фаза 4 міграції — раніше logs/status/*.json), рахує нові/змінені
# ideas за 24 год, попереджає про джоби, що не запускались довше очікуваного
# інтервалу, і надсилає все в Telegram. Секрети — лише з Keychain, ніколи з репо/env.
#
# Дедлайн-свисток (рекомендація рецензії): «відсутність дайджесту — сама по собі
# сигнал» ненадійне — тому після успішної відправки в Telegram додатково пінгуємо
# зовнішній dead-man's switch (Keychain-запис ideas-scout-healthcheck), якщо він є.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT" || exit 2

# shellcheck disable=SC1091
source "$SCRIPT_DIR/db.sh"

# Джоби, які мають запускатись регулярно (Фаза 6, розклад): "<track>-<agent>".
EXPECTED_JOBS=("passive-income-collector" "passive-income-analyst" "passive-income-revisor" "app-ideas-collector" "app-ideas-analyst")
STALE_AFTER_S=$((3 * 24 * 3600))  # 3 доби, як зазначено в PLAN.md — поріг за замовчуванням

# Ревізор ганяє лише 2×/тиждень (ср/сб), тому загальний 72-годинний поріг для нього
# зайвий: інтервал між прогонами вже сам по собі >3 доби. Окремий, м'якший поріг.
# app-ideas — легкий тижневий розклад (1 прогін/тиждень на джоб), тому їхній
# поріг ще м'якший — 8 діб, з запасом понад тижневий інтервал між прогонами.
stale_after_for_job() {
  case "$1" in
    passive-income-revisor) echo $((5 * 24 * 3600)) ;;
    app-ideas-collector|app-ideas-analyst) echo $((8 * 24 * 3600)) ;;
    *) echo "$STALE_AFTER_S" ;;
  esac
}

get_run_field() {
  # get_run_field <run-json-масив-з-get-last-run> <поле> — повертає порожньо,
  # якщо запису/поля немає (get-last-run повертає масив з 0 або 1 елементом).
  local run_json="$1" field="$2"
  python3 -c "
import json, sys
try:
    rows = json.loads(sys.argv[1])
    v = (rows[0] if rows else {}).get(sys.argv[2], '')
    print('' if v is None else v)
except Exception:
    print('')
" "$run_json" "$field" 2>/dev/null
}

now_epoch="$(date +%s)"

DIGEST_LINES=()
DIGEST_LINES+=("Ideas-scout — щоденний дайджест ($(date -u +%FT%TZ))")
DIGEST_LINES+=("")
DIGEST_LINES+=("Джоби:")

MAX_STASH=0

for job in "${EXPECTED_JOBS[@]}"; do
  # job тут — "<track>-<agent>" (напр. "passive-income-collector"); runs.job у
  # БД — сам агент ("collector"), track — окрема колонка.
  db_track="${job%-*}"
  db_agent="${job##*-}"
  run_json="$(./agents/scripts/db.sh get-last-run "$db_agent" "$db_track" 2>/dev/null || echo "[]")"
  if [ -z "$run_json" ] || [ "$run_json" = "[]" ]; then
    DIGEST_LINES+=("⚠️ ${job}: ще жодного разу не запускався (або БД недоступна)")
    continue
  fi
  finished_at="$(get_run_field "$run_json" finished_at)"
  status="$(get_run_field "$run_json" status)"
  push="$(python3 -c "
import json,sys
rows = json.loads(sys.argv[1])
meta = (rows[0] if rows else {}).get('meta') or {}
print(meta.get('push') or '')
" "$run_json" 2>/dev/null)"

  age_note=""
  job_stale_after_s="$(stale_after_for_job "$job")"
  if [ -n "$finished_at" ]; then
    # PostgREST віддає ISO8601 з офсетом виду "+00:00" (не "Z", не "+0000"),
    # BSD date(1) на macOS такого не парсить — python3 надійніший тут.
    finished_epoch="$(python3 -c "
import datetime, sys
try:
    print(int(datetime.datetime.fromisoformat(sys.argv[1]).timestamp()))
except Exception:
    print(0)
" "$finished_at" 2>/dev/null || echo 0)"
    case "$finished_epoch" in ''|*[!0-9]*) finished_epoch=0 ;; esac
    if [ "$finished_epoch" -gt 0 ]; then
      age=$(( now_epoch - finished_epoch ))
      if [ "$age" -gt "$job_stale_after_s" ]; then
        age_note=" ⚠️ давно не запускався ($((age / 3600)) год тому, поріг $((job_stale_after_s / 3600)) год)"
      fi
    fi
  fi

  DIGEST_LINES+=("- ${job}: останній прогін ${finished_at:-?}, статус=${status:-?}, push=${push:-?}${age_note}")
done

DIGEST_LINES+=("")

# Рахуємо stash-и наживо, а не з status.json: записане число застаріває одразу,
# щойно власник розбере stash руками, і попередження висить до наступного прогону.
MAX_STASH="$(git -C "$REPO_ROOT" stash list 2>/dev/null | wc -l | tr -d ' ')"
case "$MAX_STASH" in ''|*[!0-9]*) MAX_STASH=0 ;; esac

if [ "$MAX_STASH" -gt 0 ]; then
  DIGEST_LINES+=("⚠️ У репозиторії ${MAX_STASH} відкладених stash від прогонів (засташована чужа робота) — розберіть 'git stash list' вручну")
  DIGEST_LINES+=("")
fi

SINCE_24H="$(python3 -c "
import datetime
print((datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=24)).strftime('%Y-%m-%dT%H:%M:%SZ'))
")"
CHANGED_COUNT="$(./agents/scripts/db.sh count-ideas-changed-since "$SINCE_24H" 2>/dev/null || echo "?")"
DIGEST_LINES+=("Ideas додано/змінено за 24 год: ${CHANGED_COUNT}")

DIGEST_TEXT="$(printf '%s\n' "${DIGEST_LINES[@]}")"
echo "$DIGEST_TEXT"

# ---------------------------------------------------------------------------
# Telegram: токен і chat_id ЛИШЕ з Keychain. Немає — лог-попередження, не помилка.
# ---------------------------------------------------------------------------

TELEGRAM_SENT=false
TG_ERROR=""

TG_TOKEN="$(security find-generic-password -s ideas-scout-telegram -w 2>/dev/null || true)"
TG_CHAT_ID="$(security find-generic-password -s ideas-scout-telegram-chat -w 2>/dev/null || true)"

# security -w віддає запис як hex-дамп, якщо в ньому є непечатний байт — класика:
# невидимий NBSP, скопійований разом зі значенням. Без цієї перевірки запит іде зі
# сміттєвим chat_id, а Telegram відповідає невиразним 404.
CREDS_ERROR=""
if [ -n "$TG_CHAT_ID" ] && ! printf '%s' "$TG_CHAT_ID" | grep -Eq '^-?[0-9]+$'; then
  CREDS_ERROR="chat_id у Keychain не є числом (ймовірно збережений з невидимим символом). Перезапиши: security add-generic-password -U -A -s ideas-scout-telegram-chat -a ideas-scout -w '<ЧИСЛО>'"
elif [ -n "$TG_TOKEN" ] && ! printf '%s' "$TG_TOKEN" | grep -Eq '^[0-9]+:[A-Za-z0-9_-]+$'; then
  CREDS_ERROR="токен у Keychain не схожий на токен Telegram (ймовірно збережений з невидимим символом). Перезапиши: security add-generic-password -U -A -s ideas-scout-telegram -a ideas-scout -w '<ТОКЕН>'"
fi

if [ -n "$CREDS_ERROR" ]; then
  echo "monitor.sh: $CREDS_ERROR" >&2
  TG_ERROR="invalid telegram credentials in Keychain"
elif [ -z "$TG_TOKEN" ] || [ -z "$TG_CHAT_ID" ]; then
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

# Фаза 4: власний статус monitor.sh теж іде в runs (job=monitor, без track),
# не в logs/status/monitor.json. Реєструємо як миттєвий прогін (старт=фініш).
MONITOR_RUN_ID="monitor-$(date -u +%Y%m%dT%H%M%SZ)"
if ./agents/scripts/db.sh register-run-start "$MONITOR_RUN_ID" monitor >/dev/null 2>&1; then
  META_JSON="$(python3 -c "
import json,sys
print(json.dumps({
  'error': sys.argv[1] or None,
  'telegram_sent': sys.argv[2] == 'true',
  'healthcheck_pinged': sys.argv[3] == 'true',
  'changed_ideas_24h': sys.argv[4],
}))
" "$TG_ERROR" "$TELEGRAM_SENT" "$HEALTHCHECK_PINGED" "$CHANGED_COUNT")"
  ERRORS_JSON="[]"
  [ -n "$TG_ERROR" ] && ERRORS_JSON="$(python3 -c 'import json,sys; print(json.dumps([sys.argv[1]]))' "$TG_ERROR")"
  ./agents/scripts/db.sh register-run-finish "$MONITOR_RUN_ID" "$MONITOR_STATUS" "$ERRORS_JSON" "-" "-" "-" "$META_JSON" >/dev/null 2>&1 \
    || echo "monitor.sh: попередження — не вдалось записати завершення в БД (runs)" >&2
else
  echo "monitor.sh: попередження — не вдалось зареєструвати прогін monitor у БД (runs)" >&2
fi

exit 0
