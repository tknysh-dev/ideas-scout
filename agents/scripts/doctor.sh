#!/usr/bin/env bash
# doctor.sh — одна команда, що перевіряє всю систему: живлення й сон машини,
# launchd-джоби, job-worker і чергу, доступ до Supabase, секрети в Keychain,
# реєстрацію Telegram-webhook, свіжість логінів до LLM і стан репозиторію.
#
# Тільки читає. Нічого не запускає, не лагодить і не надсилає — щоб можна було
# ганяти будь-коли, зокрема посеред прогону агента.
#
# Секрети не друкуються ніде: перевіряється лише факт наявності й формат.
#
# ВАЖЛИВО ДЛЯ РОЗРОБКИ: кожен новий постійний компонент (launchd-джоб, воркер,
# зовнішній сервіс, секрет, тип job) має отримати тут свою перевірку — інакше
# його поломка знову буде тихою. Правила — в AGENTS.md, розділ «doctor.sh».

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT" || exit 2

ENV_FILE="${IDEAS_SCOUT_ENV_FILE:-$HOME/.config/ideas-scout/env}"
WORKER_LOG="$REPO_ROOT/logs/launchd/job-worker.launchd.log"
QUEUE_STALE_AFTER_S=900
WORKER_LOG_STALE_AFTER_S=$((6 * 3600))

SKIP_NETWORK=0
PROBE_LLM=0
while [ $# -gt 0 ]; do
  case "$1" in
    --offline) SKIP_NETWORK=1 ;;
    --llm) PROBE_LLM=1 ;;
    -h|--help)
      cat <<'EOF'
Використання: doctor.sh [--offline] [--llm]

  --offline  без мережевих перевірок (Supabase, Telegram, LLM)
  --llm      додатково зробити реальний виклик claude -p, щоб переконатись,
             що логін живий — єдина по-справжньому надійна перевірка, але
             вона витрачає ліміт підписки
EOF
      exit 0 ;;
    *) echo "doctor.sh: невідомий аргумент: $1" >&2; exit 2 ;;
  esac
  shift
done

OK_COUNT=0
WARN_COUNT=0
ERR_COUNT=0

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'
else
  C_RESET=""; C_BOLD=""; C_DIM=""; C_OK=""; C_WARN=""; C_ERR=""
fi

section() { printf '\n%s%s%s\n' "$C_BOLD" "$1" "$C_RESET"; }
ok()   { OK_COUNT=$((OK_COUNT + 1));   printf '  %s✔%s  %s\n' "$C_OK" "$C_RESET" "$1"; }
warn() { WARN_COUNT=$((WARN_COUNT + 1)); printf '  %s▲%s  %s\n' "$C_WARN" "$C_RESET" "$1"; }
err()  { ERR_COUNT=$((ERR_COUNT + 1));  printf '  %s✘%s  %s\n' "$C_ERR" "$C_RESET" "$1"; }
note() { printf '  %s·  %s%s\n' "$C_DIM" "$1" "$C_RESET"; }
hint() { printf '     %s↳ %s%s\n' "$C_DIM" "$1" "$C_RESET"; }

human_age() {
  local s="${1:-0}"
  case "$s" in ''|*[!0-9]*) echo "?"; return ;; esac
  if   [ "$s" -lt 90 ];     then echo "${s} с"
  elif [ "$s" -lt 5400 ];   then echo "$((s / 60)) хв"
  elif [ "$s" -lt 172800 ]; then echo "$((s / 3600)) год"
  else                           echo "$((s / 86400)) дн"
  fi
}

iso_to_epoch() {
  python3 -c "
import datetime, sys
try:
    print(int(datetime.datetime.fromisoformat(sys.argv[1].replace('Z', '+00:00')).timestamp()))
except Exception:
    print(0)
" "$1" 2>/dev/null || echo 0
}

NOW_EPOCH="$(date +%s)"
DOMAIN="gui/$(id -u)"

# Частина перевірок має сенс лише там, де реально живе постійний воркер: на твоєму
# ноуті ні вимкнений сон, ні node_modules воркера нічого не ламають.
IS_WORKER_HOST=0
launchctl print "${DOMAIN}/com.ideas-scout.job-worker" >/dev/null 2>&1 && IS_WORKER_HOST=1

IS_AGENT_HOST=0
for _label in $(launchctl list 2>/dev/null | awk '/com\.ideas-scout\./ {print $3}'); do
  IS_AGENT_HOST=1
  break
done

# Секрет обов'язковий лише там, де крутяться джоби; на робочому ноуті його
# відсутність — норма, і кричати про неї означає привчити ігнорувати ✘.
required_here() { [ "$IS_AGENT_HOST" -eq 1 ] && err "$1" || note "$1 (тут не критично — джоби на цій машині не крутяться)"; }

printf '%sideas-scout doctor%s  %s  %s\n' "$C_BOLD" "$C_RESET" "$(hostname -s)" "$(date '+%F %H:%M')"
[ "$SKIP_NETWORK" -eq 1 ] && note "режим --offline: мережеві перевірки пропускаються"

# ---------------------------------------------------------------------------
section "Машина і сон"
# ---------------------------------------------------------------------------
if ! command -v pmset >/dev/null 2>&1; then
  note "pmset недоступний — не macOS, перевірку сну пропущено"
elif [ "$IS_WORKER_HOST" -eq 0 ]; then
  note "тут не запущений job-worker — режим сну цієї машини на систему не впливає"
else
  # Рядка SleepDisabled у виводі просто немає, поки disablesleep жодного разу не
  # ставили; відсутність тут дорівнює нулю, а не «не вдалося прочитати».
  SLEEP_DISABLED="$(pmset -g 2>/dev/null | awk '/SleepDisabled/ {print $2}')"
  if [ "${SLEEP_DISABLED:-0}" = "1" ]; then
    ok "сон вимкнено системно (SleepDisabled 1)"
  else
    err "сон НЕ вимкнено — закрита кришка присипляє машину, і воркер глухне до пробудження"
    hint "sudo pmset -a disablesleep 1 && sudo pmset -c sleep 0 disksleep 0 standby 0 powernap 0"
  fi

  # Clamshell sleep не блокується жодною assertion-утилітою (Amphetamine теж),
  # тому рахуємо саме його, а не загальну кількість снів.
  CLAMSHELL="$(pmset -g log 2>/dev/null | grep -c "Clamshell Sleep" || true)"
  case "$CLAMSHELL" in ''|*[!0-9]*) CLAMSHELL=0 ;; esac
  if [ "$CLAMSHELL" -gt 0 ]; then
    warn "у журналі живлення ${CLAMSHELL} засинань від закритої кришки — якщо число росте після фіксу, sudo pmset не застосувався"
  else
    ok "засинань від закритої кришки в журналі немає"
  fi
fi

# ---------------------------------------------------------------------------
section "launchd-джоби"
# ---------------------------------------------------------------------------
shopt -s nullglob
PLIST_FILES=("$REPO_ROOT/agents/launchd"/*.plist)
shopt -u nullglob

INSTALLED_COUNT=0
for src in "${PLIST_FILES[@]}"; do
  label="$(basename "$src" .plist)"
  launchctl print "${DOMAIN}/${label}" >/dev/null 2>&1 && INSTALLED_COUNT=$((INSTALLED_COUNT + 1))
done

if [ "${#PLIST_FILES[@]}" -eq 0 ]; then
  err "у agents/launchd немає жодного *.plist — нема що перевіряти"
elif [ "$INSTALLED_COUNT" -eq 0 ]; then
  note "жоден джоб ideas-scout тут не встановлений — ця машина не є M1-воркером, перевірку пропущено"
else
  for src in "${PLIST_FILES[@]}"; do
    label="$(basename "$src" .plist)"
    short="${label#com.ideas-scout.}"
    if ! print_out="$(launchctl print "${DOMAIN}/${label}" 2>/dev/null)"; then
      err "${short}: не встановлений у launchd"
      hint "./agents/scripts/install-launchd.sh"
      continue
    fi
    state="$(printf '%s\n' "$print_out" | awk -F'= ' '/^\tstate = /{print $2; exit}')"
    exit_code="$(printf '%s\n' "$print_out" | awk -F'= ' '/last exit code = /{print $2; exit}')"
    case "$exit_code" in *[!0-9]*) exit_code="" ;; esac

    if [ "$short" = "job-worker" ]; then
      # Єдиний постійний процес: для нього "not running" — це поломка, а не спокій.
      if [ "$state" = "running" ]; then
        ok "job-worker: працює${exit_code:+, останній вихід $exit_code}"
      else
        err "job-worker: state=${state:-?} — постійний воркер не запущений, черга нікому не потрібна"
        hint "launchctl kickstart -k ${DOMAIN}/${label}"
      fi
    elif [ -n "$exit_code" ] && [ "$exit_code" != "0" ]; then
      warn "${short}: завантажений, але останній прогін вийшов з кодом ${exit_code}"
    else
      ok "${short}: завантажений (за розкладом)"
    fi
  done

  LEGACY="com.ideas-scout.telegram-bot"
  if launchctl print "${DOMAIN}/${LEGACY}" >/dev/null 2>&1 || [ -f "$HOME/Library/LaunchAgents/${LEGACY}.plist" ]; then
    warn "залишився legacy-джоб ${LEGACY} з часів long-polling — він падає по колу і засмічує логи"
    hint "./agents/scripts/install-launchd.sh   # сам знімає legacy-агент"
  fi
fi

# ---------------------------------------------------------------------------
section "Job-worker"
# ---------------------------------------------------------------------------
if [ ! -f "$WORKER_LOG" ]; then
  note "лог воркера відсутній ($WORKER_LOG) — воркер тут не запускався"
else
  log_epoch="$(stat -f %m "$WORKER_LOG" 2>/dev/null || stat -c %Y "$WORKER_LOG" 2>/dev/null || echo 0)"
  log_age=$((NOW_EPOCH - log_epoch))
  if [ "$log_age" -gt "$WORKER_LOG_STALE_AFTER_S" ]; then
    warn "лог воркера не оновлювався $(human_age "$log_age") — жодної активності, включно з періодичним sweep"
  else
    ok "лог воркера свіжий (оновлений $(human_age "$log_age") тому)"
  fi

  last_realtime="$(grep -o 'realtime=[A-Z_]*' "$WORKER_LOG" | tail -1 | cut -d= -f2)"
  case "$last_realtime" in
    SUBSCRIBED) ok "Realtime-канал підписаний (останній статус SUBSCRIBED)" ;;
    "")         warn "у лозі немає жодного статусу realtime — воркер не доходив до підписки" ;;
    *)          err "Realtime-канал у стані ${last_realtime} — воркер живий, але глухий до нових подій"
                hint "launchctl kickstart -k ${DOMAIN}/com.ideas-scout.job-worker" ;;
  esac

  reconnects="$(tail -200 "$WORKER_LOG" | grep -c "realtime reconnect" || true)"
  case "$reconnects" in ''|*[!0-9]*) reconnects=0 ;; esac
  if [ "$reconnects" -gt 10 ]; then
    warn "${reconnects} перепідключень Realtime в останніх 200 рядках — канал не тримається; шукай причину в мережі або на боці Supabase"
  fi

  fatals="$(tail -200 "$WORKER_LOG" | grep -c "^.*fatal:" || true)"
  case "$fatals" in ''|*[!0-9]*) fatals=0 ;; esac
  [ "$fatals" -gt 0 ] && warn "${fatals} фатальних виходів воркера в останніх 200 рядках лога"
fi

# ---------------------------------------------------------------------------
section "База даних і черга"
# ---------------------------------------------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  err "немає env-файла $ENV_FILE — воркер не стартує без SUPABASE_URL/SUPABASE_SERVICE_KEY"
else
  perms="$(stat -f %Lp "$ENV_FILE" 2>/dev/null || stat -c %a "$ENV_FILE" 2>/dev/null || echo "?")"
  if [ "$perms" = "600" ]; then
    ok "env-файл на місці, права 600"
  else
    warn "env-файл на місці, але права ${perms} — сервісний ключ Supabase має бути читабельним лише власнику (chmod 600)"
  fi
  for key in SUPABASE_URL SUPABASE_SERVICE_KEY; do
    grep -q "^${key}=." "$ENV_FILE" || err "у env-файлі немає ${key}"
  done
fi

if [ "$SKIP_NETWORK" -eq 1 ]; then
  note "перевірку Supabase пропущено (--offline)"
else
  db_start="$(date +%s)"
  QUEUE_JSON="$(./agents/scripts/db.sh queue-health 2>/dev/null || echo "")"
  db_elapsed=$(( $(date +%s) - db_start ))
  if [ -z "$QUEUE_JSON" ]; then
    err "Supabase недосяжна або відмовляє в доступі — ні дайджест, ні воркер, ні dashboard зараз не працюють"
    hint "./agents/scripts/db.sh get-last-run monitor   # покаже точну помилку PostgREST"
  else
    ok "Supabase відповідає (${db_elapsed} с)"
    read -r Q_DUE Q_OLDEST Q_RUNNING Q_STALE <<<"$(python3 -c "
import json, sys
q = json.loads(sys.argv[1])
print(q['due_pending'], q['oldest_due_pending_s'], q['running'], q['stale_running'])
" "$QUEUE_JSON" 2>/dev/null || echo "0 0 0 0")"

    if [ "${Q_OLDEST:-0}" -gt "$QUEUE_STALE_AFTER_S" ]; then
      err "черга стоїть: ${Q_DUE} завдань чекають, найстаріше $(human_age "$Q_OLDEST") — саме так виглядає непрацюючий воркер із боку користувача"
    elif [ "${Q_DUE:-0}" -gt 0 ]; then
      ok "черга рухається: ${Q_DUE} чекає (найстаріше $(human_age "$Q_OLDEST")), ${Q_RUNNING} у роботі"
    else
      ok "черга порожня, ${Q_RUNNING} завдань у роботі"
    fi
    [ "${Q_STALE:-0}" -gt 0 ] && warn "${Q_STALE} завдань у running із простроченою орендою — воркер помер посеред роботи, вони чекають перепризначення"
  fi
fi

# ---------------------------------------------------------------------------
section "Прогони агентів"
# ---------------------------------------------------------------------------
if [ "$SKIP_NETWORK" -eq 1 ]; then
  note "перевірку прогонів пропущено (--offline)"
else
  # Пороги дзеркалять monitor.sh: у джобів різний розклад, спільний поріг брехав би.
  for entry in "passive-income-collector:259200" "passive-income-analyst:259200" \
               "passive-income-revisor:432000" "app-ideas-collector:691200" \
               "app-ideas-analyst:691200"; do
    job="${entry%:*}"; threshold="${entry#*:}"
    track="${job%-*}"; agent="${job##*-}"
    run_json="$(./agents/scripts/db.sh get-last-run "$agent" "$track" 2>/dev/null || echo "[]")"
    if [ -z "$run_json" ] || [ "$run_json" = "[]" ]; then
      warn "${job}: жодного прогону в БД"
      continue
    fi
    read -r r_status r_finished <<<"$(python3 -c "
import json, sys
rows = json.loads(sys.argv[1])
row = rows[0] if rows else {}
print(row.get('status') or '?', row.get('finished_at') or '')
" "$run_json" 2>/dev/null || echo "? ")"
    age=0
    if [ -n "${r_finished:-}" ]; then
      f_epoch="$(iso_to_epoch "$r_finished")"
      [ "$f_epoch" -gt 0 ] && age=$((NOW_EPOCH - f_epoch))
    fi
    if [ "$age" -gt "$threshold" ]; then
      warn "${job}: останній прогін $(human_age "$age") тому (поріг $(human_age "$threshold")), статус=${r_status}"
    elif [ "$r_status" = "error" ]; then
      warn "${job}: останній прогін завершився помилкою ($(human_age "$age") тому)"
    else
      ok "${job}: ${r_status}, $(human_age "$age") тому"
    fi
  done
fi

# ---------------------------------------------------------------------------
section "Секрети в Keychain"
# ---------------------------------------------------------------------------
kc() { security find-generic-password -s "$1" -w 2>/dev/null || true; }

TG_TOKEN="$(kc ideas-scout-telegram)"
TG_CHAT="$(kc ideas-scout-telegram-chat)"

if [ -z "$TG_TOKEN" ]; then
  required_here "немає ideas-scout-telegram — ні дайджест, ні бот нічого не надішлють"
elif ! printf '%s' "$TG_TOKEN" | grep -Eq '^[0-9]+:[A-Za-z0-9_-]+$'; then
  err "ideas-scout-telegram не схожий на токен Telegram — ймовірно збережений із невидимим символом"
  hint "security add-generic-password -U -A -s ideas-scout-telegram -a ideas-scout -w '<ТОКЕН>'"
else
  ok "токен Telegram на місці й валідного формату"
fi

if [ -z "$TG_CHAT" ]; then
  required_here "немає ideas-scout-telegram-chat"
elif ! printf '%s' "$TG_CHAT" | grep -Eq '^-?[0-9]+$'; then
  err "ideas-scout-telegram-chat не є числом — ймовірно збережений із невидимим символом"
else
  ok "chat_id на місці"
fi

if [ -n "$(kc ideas-scout-healthcheck)" ]; then
  ok "dead-man's switch налаштований (ideas-scout-healthcheck)"
elif [ "$IS_AGENT_HOST" -eq 1 ]; then
  warn "немає ideas-scout-healthcheck — якщо дайджест перестане надходити, ніхто про це не попередить ззовні"
else
  note "немає ideas-scout-healthcheck (перевіряється на машині з джобами)"
fi

if [ -n "$(kc ideas-scout-reddit-id)" ] && [ -n "$(kc ideas-scout-reddit-secret)" ]; then
  ok "Reddit-креденшели на місці (опційне джерело)"
else
  note "Reddit-креденшели не налаштовані — collector працює без Reddit, це штатно"
fi

# ---------------------------------------------------------------------------
section "Telegram webhook"
# ---------------------------------------------------------------------------
if [ "$SKIP_NETWORK" -eq 1 ]; then
  note "перевірку webhook пропущено (--offline)"
elif [ -z "$TG_TOKEN" ]; then
  note "без токена перевірити webhook неможливо"
else
  WEBHOOK_INFO="$(curl -sS --max-time 10 "https://api.telegram.org/bot${TG_TOKEN}/getWebhookInfo" 2>/dev/null || echo "")"
  if [ -z "$WEBHOOK_INFO" ]; then
    err "Telegram API недосяжний"
  else
    read -r W_URL W_PENDING W_ERRDATE W_ERRMSG <<<"$(python3 -c "
import json, sys
r = json.loads(sys.argv[1]).get('result') or {}
url = r.get('url') or ''
print(
    'set' if url else 'none',
    r.get('pending_update_count', 0),
    r.get('last_error_date') or 0,
    (r.get('last_error_message') or '-').replace(' ', '_'),
)
" "$WEBHOOK_INFO" 2>/dev/null || echo "none 0 0 -")"

    if [ "$W_URL" = "set" ]; then
      ok "webhook зареєстрований у Telegram"
    else
      err "webhook не зареєстрований — Telegram нікуди не доставляє твої повідомлення"
      hint "./agents/scripts/configure-telegram-webhook.py https://<домен-vercel>"
    fi

    if [ "${W_PENDING:-0}" -gt 0 ]; then
      warn "${W_PENDING} апдейтів не доставлено — Telegram не отримує 2xx від dashboard на Vercel"
    else
      ok "недоставлених апдейтів немає"
    fi

    if [ "${W_ERRDATE:-0}" -gt 0 ]; then
      err_age=$((NOW_EPOCH - W_ERRDATE))
      if [ "$err_age" -lt 3600 ]; then
        err "остання доставка провалилась $(human_age "$err_age") тому: ${W_ERRMSG//_/ }"
      else
        note "остання помилка доставки була $(human_age "$err_age") тому: ${W_ERRMSG//_/ }"
      fi
    fi
  fi
  unset TG_TOKEN
fi

# ---------------------------------------------------------------------------
section "Логіни до LLM"
# ---------------------------------------------------------------------------
if command -v claude >/dev/null 2>&1; then
  ok "claude CLI встановлений ($(claude --version 2>/dev/null | head -1))"
else
  err "claude CLI не знайдено в PATH — усі прогони агентів впадуть одразу"
fi

CLAUDE_CREDS="$(security find-generic-password -s 'Claude Code-credentials' -w 2>/dev/null || true)"
if [ -z "$CLAUDE_CREDS" ]; then
  err "у Keychain немає Claude Code-credentials — логін протух або не робився під цим юзером"
  hint "залогінься під агентським юзером: claude"
else
  read -r CL_EXP_AGE CL_PLAN <<<"$(python3 -c "
import json, sys, time
o = json.loads(sys.argv[1]).get('claudeAiOauth') or {}
exp = int(o.get('expiresAt', 0)) / 1000
print(int(exp - time.time()), o.get('subscriptionType') or '?')
" "$CLAUDE_CREDS" 2>/dev/null || echo "0 ?")"
  unset CLAUDE_CREDS
  if [ "${CL_EXP_AGE:-0}" -gt 0 ]; then
    ok "логін Claude активний (план ${CL_PLAN}, токен дійсний ще $(human_age "$CL_EXP_AGE"))"
  else
    # CLI оновлює токен сам і не завжди переписує запис у Keychain, тому протухла
    # мітка — привід перевірити, а не вирок: остаточну відповідь дає --llm.
    warn "мітка токена Claude у Keychain протухла $(human_age "$((0 - CL_EXP_AGE))") тому — може бути й безпечно, CLI оновлює токен сам"
    hint "./agents/scripts/doctor.sh --llm   # реальний виклик, остаточна перевірка"
  fi
fi

if [ "$PROBE_LLM" -eq 1 ] && [ "$SKIP_NETWORK" -eq 0 ]; then
  if LLM_OUT="$(claude -p "Відповідай одним словом: ok" 2>&1)"; then
    ok "живий виклик claude -p пройшов (відповідь: $(printf '%s' "$LLM_OUT" | head -c 40 | tr '\n' ' '))"
  else
    err "живий виклик claude -p провалився: $(printf '%s' "$LLM_OUT" | head -c 200 | tr '\n' ' ')"
    hint "залогінься під агентським юзером: claude"
  fi
fi

CODEX_AUTH="$HOME/.codex/auth.json"
if [ -f "$CODEX_AUTH" ]; then
  CODEX_REFRESH="$(python3 -c "
import json
print((json.load(open('$CODEX_AUTH')).get('last_refresh') or '')[:19])
" 2>/dev/null || echo "")"
  note "codex: логін є (оновлений ${CODEX_REFRESH:-?}); провайдер вимкнений за замовчуванням, тому це лише довідка"
else
  note "codex: логіна немає — штатно, провайдер вимкнений за замовчуванням"
fi

# ---------------------------------------------------------------------------
section "Репозиторій"
# ---------------------------------------------------------------------------
BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")"
if [ "$BRANCH" = "main" ]; then
  ok "гілка main"
else
  err "HEAD на гілці ${BRANCH}, а не main — runner.sh у такому стані зупиняється й нічого не робить"
fi

DIRTY="$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
[ "${DIRTY:-0}" -gt 0 ] \
  && warn "${DIRTY} незакомічених змін — наступний прогін їх засташає" \
  || ok "робоче дерево чисте"

STASHES="$(git -C "$REPO_ROOT" stash list 2>/dev/null | wc -l | tr -d ' ')"
[ "${STASHES:-0}" -gt 0 ] \
  && warn "${STASHES} відкладених stash від попередніх прогонів — розбери 'git stash list' вручну" \
  || ok "stash-ів немає"

AHEAD="$(git -C "$REPO_ROOT" rev-list --count @{u}..HEAD 2>/dev/null || echo 0)"
[ "${AHEAD:-0}" -gt 0 ] && warn "${AHEAD} комітів не запушено (за даними останнього fetch)"

QUARANTINE="$(git -C "$REPO_ROOT" branch --list 'quarantine/*' 2>/dev/null | wc -l | tr -d ' ')"
[ "${QUARANTINE:-0}" -gt 0 ] && warn "${QUARANTINE} гілок quarantine/* — там лежать результати прогонів, що впали; перегляньте й видаліть"

# ---------------------------------------------------------------------------
section "Залежності"
# ---------------------------------------------------------------------------
for bin in node npm python3 git curl; do
  command -v "$bin" >/dev/null 2>&1 || err "${bin} не знайдено в PATH"
done
if [ -d "$REPO_ROOT/agents/worker/node_modules/@supabase/supabase-js" ]; then
  ok "залежності воркера встановлені"
elif [ "$IS_WORKER_HOST" -eq 1 ]; then
  err "немає agents/worker/node_modules — воркер не стартує"
  hint "npm ci --omit=dev --prefix agents/worker"
else
  note "залежності воркера не встановлені — тут воркер не працює, це штатно"
fi
command -v node >/dev/null 2>&1 && ok "node $(node --version), npm $(npm --version 2>/dev/null)"

# ---------------------------------------------------------------------------
printf '\n%s%s%s\n' "$C_BOLD" "Підсумок" "$C_RESET"
printf '  %s%d ок%s  ·  %s%d попереджень%s  ·  %s%d проблем%s\n\n' \
  "$C_OK" "$OK_COUNT" "$C_RESET" "$C_WARN" "$WARN_COUNT" "$C_RESET" "$C_ERR" "$ERR_COUNT" "$C_RESET"

if [ "$ERR_COUNT" -gt 0 ]; then
  echo "Є проблеми, які ламають роботу системи прямо зараз — дивись рядки з ✘ вище."
  exit 2
elif [ "$WARN_COUNT" -gt 0 ]; then
  echo "Критичного нічого, але є на що глянути — рядки з ▲ вище."
  exit 1
fi
echo "Усе в нормі."
exit 0
