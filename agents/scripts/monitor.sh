#!/usr/bin/env bash
# monitor.sh — доставка щоденного дайджесту: чекає на мережу, бере готове тіло в
# digest.py, шле в Telegram, пінгує dead-man's switch і реєструє власний прогін.
# Що саме йде в текст — справа digest.py; тут лише транспорт і секрети.
# Секрети — лише з Keychain, ніколи з репо/env.
#
# Дедлайн-свисток (рекомендація рецензії): «відсутність дайджесту — сама по собі
# сигнал» ненадійне — тому після успішної відправки в Telegram додатково пінгуємо
# зовнішній dead-man's switch (Keychain-запис ideas-scout-healthcheck), якщо він є.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT" || exit 2

# monitor.sh — точка входу launchd, тому PATH тут теж голий (див. коментар у
# doctor.sh). Сам монітор обходиться python3 і curl з /usr/bin, але все, що він
# запускає далі, успадковує це середовище — саме так дайджест і отримав чужі ✘.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

# shellcheck source=agents/scripts/db.sh
source "$SCRIPT_DIR/db.sh"
# shellcheck source=agents/scripts/scripts-lib.sh
source "$SCRIPT_DIR/scripts-lib.sh"

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

DIGEST_JSON="$(python3 "$SCRIPT_DIR/digest.py" 2>/dev/null || echo "")"
if [ -z "$DIGEST_JSON" ]; then
  echo "monitor.sh: digest.py не віддав тіло дайджесту — нічого не надсилаю" >&2
  exit 1
fi

DIGEST_TEXT="$(digest_text_from_json "$DIGEST_JSON")"
read -r CREATED_COUNT UPDATED_COUNT <<<"$(digest_counts_from_json "$DIGEST_JSON")"

# Глибина черги видима в самому дайджесті (через doctor.sh), але в meta прогону
# лишається числом: історія runs — єдине місце, де видно динаміку за тижні.
QUEUE_JSON="$(./agents/scripts/db.sh queue-health 2>/dev/null || echo "")"

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
CREDS_ERROR="$(telegram_creds_error "$TG_CHAT_ID" "$TG_TOKEN")"

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
    --data-urlencode "parse_mode=HTML" \
    --data-urlencode "disable_web_page_preview=true" \
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

MONITOR_STATUS="$(monitor_status_from_sent "$TELEGRAM_SENT")"

# Фаза 4: власний статус monitor.sh теж іде в runs (job=monitor, без track),
# не в logs/status/monitor.json. Реєструємо як миттєвий прогін (старт=фініш).
MONITOR_RUN_ID="monitor-$(date -u +%Y%m%dT%H%M%SZ)"
if ./agents/scripts/db.sh register-run-start "$MONITOR_RUN_ID" monitor >/dev/null 2>&1; then
  META_JSON="$(monitor_meta_json "$TG_ERROR" "$TELEGRAM_SENT" "$HEALTHCHECK_PINGED" "$CREATED_COUNT" "$UPDATED_COUNT" "$QUEUE_JSON")"
  ERRORS_JSON="$(monitor_errors_json "$TG_ERROR")"
  ./agents/scripts/db.sh register-run-finish "$MONITOR_RUN_ID" "$MONITOR_STATUS" "$ERRORS_JSON" "-" "-" "-" "$META_JSON" >/dev/null 2>&1 \
    || echo "monitor.sh: попередження — не вдалось записати завершення в БД (runs)" >&2
else
  echo "monitor.sh: попередження — не вдалось зареєструвати прогін monitor у БД (runs)" >&2
fi

exit 0
