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

# launchd будить джоб одразу після прокидання Mac, коли Wi-Fi ще не піднявся:
# без цього монітор бачив порожню БД і слав дайджест із фальшивим «жодного
# разу не запускався». Чекаємо на мережу, а не вгадуємо.
wait_for_db() {
  local attempt=1
  while [ "$attempt" -le 20 ]; do
    if _db_get "/runs?select=run_id&limit=1" >/dev/null 2>&1; then return 0; fi
    sleep 15
    attempt=$((attempt + 1))
  done
  return 1
}

if ! wait_for_db; then
  echo "monitor.sh: БД недосяжна 5 хв поспіль — дайджест не надсилаю, щоб не дезінформувати" >&2
  exit 1
fi

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

  # Сам по собі "статус=error" не каже, чи це разова мережева дрібниця, чи
  # системна поломка (протух OAuth-токен CLI — і тоді так само впаде кожен
  # наступний прогін). Тому текст першої помилки йде прямо в дайджест.
  error_note=""
  if [ "$status" = "error" ]; then
    first_error="$(python3 -c "
import json,sys
rows = json.loads(sys.argv[1])
errors = (rows[0] if rows else {}).get('errors') or []
text = ' '.join(str(errors[0]).split()) if errors else ''
print(text[:300])
" "$run_json" 2>/dev/null)"
    [ -n "$first_error" ] && error_note=$'\n'"    ↳ ${first_error}"
  fi

  # dry_run — не «все добре»: прогін відпрацював, але навмисно нічого не записав.
  # Без явної мітки такий трек тихо простоює тижнями.
  mode_note=""
  [ "$status" = "dry_run" ] && mode_note=" ⚠️ у режимі dry_run — реальних змін не пише"

  DIGEST_LINES+=("- ${job}: останній прогін ${finished_at:-?}, статус=${status:-?}, push=${push:-?}${age_note}${mode_note}${error_note}")
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

# Черга jobs — окремий контур від launchd-прогонів вище: Telegram-бот і dashboard
# лише кладуть у неї завдання, а забирає їх постійний job-worker на M1. Коли той
# спить чи глухне, тиша в Telegram виглядає точно як «нічого не відбувалось»,
# тому глибина черги мусить бути в дайджесті явно.
QUEUE_STALE_AFTER_S=900

QUEUE_JSON="$(./agents/scripts/db.sh queue-health 2>/dev/null || echo "")"
if [ -z "$QUEUE_JSON" ]; then
  DIGEST_LINES+=("⚠️ Черга подій: не вдалося прочитати стан jobs у Supabase")
else
  read -r QUEUE_DUE QUEUE_OLDEST_S QUEUE_RUNNING QUEUE_STALE <<<"$(python3 -c "
import json, sys
q = json.loads(sys.argv[1])
print(q['due_pending'], q['oldest_due_pending_s'], q['running'], q['stale_running'])
" "$QUEUE_JSON" 2>/dev/null || echo "0 0 0 0")"

  if [ "${QUEUE_OLDEST_S:-0}" -gt "$QUEUE_STALE_AFTER_S" ]; then
    DIGEST_LINES+=("⚠️ Черга подій: ${QUEUE_DUE} завдань чекають обробки, найстаріше — вже $((QUEUE_OLDEST_S / 60)) хв. Так виглядає непрацюючий job-worker на M1: webhook і dashboard далі кладуть завдання в чергу, але їх ніхто не забирає, тож твої повідомлення боту лишаються без відповіді. Перевір на M1: launchctl print gui/\$(id -u)/com.ideas-scout.job-worker")
  else
    DIGEST_LINES+=("Черга подій: ${QUEUE_DUE} чекає, ${QUEUE_RUNNING} у роботі")
  fi

  if [ "${QUEUE_STALE:-0}" -gt 0 ]; then
    DIGEST_LINES+=("⚠️ ${QUEUE_STALE} завдань у статусі running із простроченою орендою — воркер, що їх узяв, помер посеред роботи; вони чекають на автоматичне перепризначення")
  fi
fi

DIGEST_LINES+=("")

SINCE_24H="$(python3 -c "
import datetime
print((datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=24)).strftime('%Y-%m-%dT%H:%M:%SZ'))
")"
ACTIVITY_JSON="$(./agents/scripts/db.sh ideas-activity-since "$SINCE_24H" 2>/dev/null || echo "")"
read -r CREATED_COUNT UPDATED_COUNT <<<"$(python3 -c "
import json, sys
a = json.loads(sys.argv[1])
print(a['created'], a['updated'])
" "$ACTIVITY_JSON" 2>/dev/null || echo "? ?")"
DIGEST_LINES+=("Ideas за 24 год: ${CREATED_COUNT} нових, ${UPDATED_COUNT} оновлених (правки статусів/полів уже наявних карток)")

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
  'created_ideas_24h': sys.argv[4],
  'updated_ideas_24h': sys.argv[5],
  'queue': json.loads(sys.argv[6]) if sys.argv[6] else None,
}))
" "$TG_ERROR" "$TELEGRAM_SENT" "$HEALTHCHECK_PINGED" "$CREATED_COUNT" "$UPDATED_COUNT" "$QUEUE_JSON")"
  ERRORS_JSON="[]"
  [ -n "$TG_ERROR" ] && ERRORS_JSON="$(python3 -c 'import json,sys; print(json.dumps([sys.argv[1]]))' "$TG_ERROR")"
  ./agents/scripts/db.sh register-run-finish "$MONITOR_RUN_ID" "$MONITOR_STATUS" "$ERRORS_JSON" "-" "-" "-" "$META_JSON" >/dev/null 2>&1 \
    || echo "monitor.sh: попередження — не вдалось записати завершення в БД (runs)" >&2
else
  echo "monitor.sh: попередження — не вдалось зареєструвати прогін monitor у БД (runs)" >&2
fi

exit 0
