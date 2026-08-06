# shellcheck shell=bash
# doctor-lib.sh — чисті функції з doctor.sh, винесені для юніт-тестів.
#
# Файл призначений ЛИШЕ для source, не для запуску: без `set -uo pipefail`,
# без виконуваного біта, без коду поза визначеннями функцій — сорсинг сам по
# собі не має жодних побічних ефектів (тест сорсить цей файл і викликає
# функції напряму, без curl/git/security/launchctl/читання файлів, якими живе
# doctor.sh).
#
# Головне правило: нову чисту функцію doctor.sh (рішення за вже здобутими
# даними — чи протухло, чи в межах порогу, розбір рядка з launchctl, класифікація
# стану — яку можна покрити тестом без бойової машини) додавай СЮДИ, а не в
# тіло doctor.sh.

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

# has_ideas_scout_jobs <launchctl_list_output> — чи є серед рядків `launchctl
# list` хоч один джоб ideas-scout. Дані (сам `launchctl list`) здобуває
# doctor.sh, сюди приїжджає вже готовий текст.
has_ideas_scout_jobs() {
  printf '%s\n' "$1" | awk '/com\.ideas-scout\./ {print $3}' | grep -q .
}

# launchctl_job_status <print_out> — розбір виводу `launchctl print
# <domain>/<label>` у "state<TAB>exit_code". exit_code порожній, якщо в
# виводі немає числового "last exit code" (джоб ще жодного разу не завершувався).
launchctl_job_status() {
  local print_out="$1"
  local state exit_code
  state="$(printf '%s\n' "$print_out" | awk -F'= ' '/^\tstate = /{print $2; exit}')"
  exit_code="$(printf '%s\n' "$print_out" | awk -F'= ' '/last exit code = /{print $2; exit}')"
  case "$exit_code" in *[!0-9]*) exit_code="" ;; esac
  printf '%s\t%s\n' "$state" "$exit_code"
}

# classify_launchd_job <short> <state> <exit_code> — job-worker єдиний
# постійний процес: для нього "not running" — це поломка, а не спокій, тому
# отримує власну гілку. Повертає одне з: worker_running / worker_down /
# exit_nonzero / scheduled_ok.
classify_launchd_job() {
  local short="$1" state="$2" exit_code="$3"
  if [ "$short" = "job-worker" ]; then
    if [ "$state" = "running" ]; then
      echo "worker_running"
    else
      echo "worker_down"
    fi
  elif [ -n "$exit_code" ] && [ "$exit_code" != "0" ]; then
    echo "exit_nonzero"
  else
    echo "scheduled_ok"
  fi
}

# clamshell_count_since <baseline> <log_lines> — скільки рядків "Clamshell
# Sleep" з журналу pmset датовані не раніше за baseline. Префікс рядка pmset —
# "РРРР-ММ-ДД ГГ:ХХ:СС" фіксованої ширини, тому лексикографічне порівняння з
# позначкою і є порівнянням за часом.
clamshell_count_since() {
  local baseline="$1" lines="$2" n
  n="$(printf '%s\n' "$lines" | awk -v b="$baseline" 'substr($0,1,19) >= b' | wc -l | tr -d ' ')"
  case "$n" in ''|*[!0-9]*) n=0 ;; esac
  printf '%s\n' "$n"
}

# classify_realtime_status <last_realtime> — останній статус realtime-каналу
# з логу воркера -> ok / warn / err.
classify_realtime_status() {
  case "$1" in
    SUBSCRIBED) echo "ok" ;;
    "")         echo "warn" ;;
    *)          echo "err" ;;
  esac
}

# classify_realtime_churn <reconnects> <escalations> <uptime_s> — чи справді
# realtime-канал «не тримається».
#
# Поодинокі розриви WebSocket — норма: канал падає раз на кілька годин і за
# секунду піднімається назад, джоби цього навіть не помічають. Тому попередній
# абсолютний поріг («більше 10 перепідключень») був приречений: лічильник росте
# разом з аптаймом воркера, отже здоровий воркер гарантовано доходив до 10 —
# що довше він працював БЕЗ поломок, то невідворотніше приходило попередження
# про поломку. Реальний випадок: 12 розривів за 38 годин, кожен відновився з
# першої спроби, жоден джоб не постраждав — і ✘ у дайджесті.
#
# Тому дивимось на дві речі, які абсолютний лічильник змішував в одну:
#   * escalations — скільки разів канал НЕ піднявся з першої спроби (у лозі це
#     `realtime reconnect #2` і далі). Це ознака поломки сама по собі: не
#     залежить ні від аптайму, ні від порогів;
#   * частота розривів на годину аптайму — шум це чи справжнє тріпотіння.
#
# uptime_s = 0 означає «аптайм невідомий» (у лозі немає маркера старту): тоді
# частоту рахувати нема з чого, лишається старий абсолютний поріг.
# Повертає: not_recovering / flapping / ok.
classify_realtime_churn() {
  local reconnects="${1:-0}" escalations="${2:-0}" uptime="${3:-0}"
  case "$reconnects" in ''|*[!0-9]*) reconnects=0 ;; esac
  case "$escalations" in ''|*[!0-9]*) escalations=0 ;; esac
  case "$uptime" in ''|*[!0-9]*) uptime=0 ;; esac

  if [ "$escalations" -ge 3 ]; then
    echo "not_recovering"
  elif [ "$uptime" -lt 3600 ]; then
    # Менше години аптайму (або аптайм невідомий) — вибірка замала для частоти.
    if [ "$reconnects" -gt 10 ]; then echo "flapping"; else echo "ok"; fi
  elif [ $((reconnects * 36000 / uptime)) -gt 20 ]; then
    # Більше 2 розривів на годину. 12 за 38 год (0.3/год) — тиша; 3 за годину —
    # вже видно.
    echo "flapping"
  else
    echo "ok"
  fi
}

# classify_queue_state <due> <oldest_s> <busy_type> <stale_after_s> —
# Воркер бере джоби по одному, а глибоке дослідження триває до 90 хв — черга
# за ним стоїть законно й виглядає точно як мертвий воркер. Розрізняє їх
# живий lease: якщо довгий джоб реально працює, це очікування, не поломка.
# Повертає: waiting_long_job / stalled / moving / empty.
classify_queue_state() {
  local due="$1" oldest="$2" busy_type="$3" stale_after="$4"
  local long_job_busy=0
  case "$busy_type" in
    deep_research_synthesis) long_job_busy=1 ;;
    *) long_job_busy=0 ;;
  esac
  if [ "${oldest:-0}" -gt "$stale_after" ] && [ "$long_job_busy" -eq 1 ]; then
    echo "waiting_long_job"
  elif [ "${oldest:-0}" -gt "$stale_after" ]; then
    echo "stalled"
  elif [ "${due:-0}" -gt 0 ]; then
    echo "moving"
  else
    echo "empty"
  fi
}

# classify_run_state <age_s> <threshold_s> <status> — прогін агента застарів,
# впав з помилкою, чи все гаразд. Повертає: stale / error / ok.
classify_run_state() {
  local age="$1" threshold="$2" status="$3"
  if [ "$age" -gt "$threshold" ]; then
    echo "stale"
  elif [ "$status" = "error" ]; then
    echo "error"
  else
    echo "ok"
  fi
}

# classify_websearch_probe <ws_out> <elapsed_s> <timeout_s> — відповідь claude
# на пробний запит із веб-пошуком: знятий за таймаутом і порожній, не
# автентифікувався, реально повернув URL з датою, чи не повернув нічого
# придатного. Модель, яка не змогла автентифікуватись, теж не поверне URL —
# але це зовсім інша поломка з іншим лікуванням, тому auth_failed перевіряється
# окремою гілкою, а не змішується з no_result. Повертає: timeout / auth_failed
# / ok / no_result.
classify_websearch_probe() {
  local out="$1" elapsed="$2" timeout="$3"
  if [ "$elapsed" -ge "$timeout" ] && [ -z "${out//[[:space:]]/}" ]; then
    echo "timeout"
  elif printf '%s' "$out" | grep -Eqi 'oauth|authenticat|401|invalid api key|credit balance'; then
    echo "auth_failed"
  elif printf '%s' "$out" | grep -Eq 'https?://[^[:space:]]+' \
     && printf '%s' "$out" | grep -Eq '[0-9]{4}-[0-9]{2}-[0-9]{2}'; then
    echo "ok"
  else
    echo "no_result"
  fi
}
