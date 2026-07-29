#!/usr/bin/env bash
# runner.sh — єдина точка запуску одного прогону одного агента на одному треку.
# Використання: runner.sh --track passive-income|app-ideas --agent collector|analyst|revisor --provider claude|codex [--dry-run]
#
# Реалізує рекомендації рецензії PLAN.md і адверсарної рецензії інфраструктури:
# - mkdir-локи (macOS не має flock(1)): per-job лок + репо-широкий git-лок навколо
#   git-критичних секцій (гігієна+pull на старті, commit/push наприкінці) — щоб
#   collector і analyst, запущені одночасно (launchd catch-up), не били по git-стану;
# - git-гігієна без reset --hard; після кожного невдалого pull --rebase — rebase --abort;
#   на старті — прибирання залишків rebase/index.lock від попереднього вбитого прогону;
# - вимога HEAD == main: detached HEAD чи чужа гілка → status=error без git-операцій;
# - guard проти промпт-ін'єкції за ALLOWLIST: будь-який змінений шлях поза дозволеним
#   переліком (registries/, logs/runs|status|decisions, catalogs/, config/criteria* та ін.)
#   відкочується, потрапляє в blocked_paths і дає status=blocked_paths;
# - quarantine-гілка для часткових результатів упалого CLI (без push);
# - захист робочих годин: у вікні IDEAS_SCOUT_WORK_HOURS (дефолт пн–пт 09:00–19:00)
#   автопрогін пропускається зі status=skipped_work_hours — щоб launchd catch-up після
#   сну не спалював підписку вдень;
# - таймаут-поліфіл TERM→(грейс)→KILL (немає gtimeout на macOS).
#
# Навмисно НЕ дає агенту (claude -p) інструментів Bash/git: увесь git commit/push
# виконує сам runner.sh ПІСЛЯ завершення прогону — це і є межа проти промпт-ін'єкції.
# --provider codex за замовчуванням ВИМКНЕНО (sandbox codex exec дає агенту shell,
# що ламає цей інваріант) — вмикається лише явним IDEAS_SCOUT_ALLOW_CODEX=1.

set -uo pipefail
# Свідомо без -e: частина кроків (виклик CLI, pull/push) МАЄ провалюватись без обриву
# скрипта — статус помилки записується явно, а виконання продовжується до git-секції.

# ---------------------------------------------------------------------------
# Аргументи
# ---------------------------------------------------------------------------

TRACK=""
AGENT=""
PROVIDER=""
DRY_RUN=0

usage() {
  cat >&2 <<'EOF'
Використання: runner.sh --track <passive-income|app-ideas> --agent <collector|analyst|revisor> --provider <claude|codex> [--dry-run]
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --track) TRACK="${2:-}"; shift 2 ;;
    --agent) AGENT="${2:-}"; shift 2 ;;
    --provider) PROVIDER="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "runner.sh: невідомий аргумент: $1" >&2; usage; exit 2 ;;
  esac
done

case "$TRACK" in passive-income|app-ideas) ;; *) echo "runner.sh: --track має бути passive-income або app-ideas (отримано: '$TRACK')" >&2; exit 2 ;; esac
case "$AGENT" in collector|analyst|revisor|triage) ;; *) echo "runner.sh: --agent має бути collector, analyst, revisor або triage (отримано: '$AGENT')" >&2; exit 2 ;; esac
case "$PROVIDER" in claude|codex) ;; *) echo "runner.sh: --provider має бути claude або codex (отримано: '$PROVIDER')" >&2; exit 2 ;; esac

# ---------------------------------------------------------------------------
# Корінь репозиторію (не покладаємось на git тут — просто йдемо від шляху скрипта)
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT" || { echo "runner.sh: не вдалось перейти в $REPO_ROOT" >&2; exit 2; }

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "runner.sh: $REPO_ROOT не є git-репозиторієм" >&2
  exit 2
fi

# launchd дає джобам мінімальний PATH (/usr/bin:/bin:/usr/sbin:/sbin), і той самий
# PATH успадковує telegram-bot.py разом з усім, що він запускає. claude при цьому
# ставиться в ~/.local/bin (або homebrew) — без цього рядка прогін обривається за
# секунду з «CLI не знайдено» і кодом 127, що ззовні виглядає як мовчазна поломка.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

mkdir -p "$REPO_ROOT/logs/status" "$REPO_ROOT/logs/locks" "$REPO_ROOT/logs/launchd" "$REPO_ROOT/logs/quarantine" "$REPO_ROOT/logs/runs"

MAIN_BRANCH="${IDEAS_SCOUT_MAIN_BRANCH:-main}"
# Тріаж оцінює рівно один матеріал і власник чекає відповідь у чаті — 45 хв тут
# означали б лише те, що зависання помітно через три чверті години.
if [ "$AGENT" = "triage" ]; then
  RUN_TIMEOUT_S="${RUNNER_TIMEOUT_S:-900}"  # 15 хв
else
  RUN_TIMEOUT_S="${RUNNER_TIMEOUT_S:-2700}" # 45 хв за замовчуванням
fi
TERM_GRACE_S=10
# Застарілість лока прив'язана до фактичного таймауту прогону (+15 хв запасу),
# а не до фіксованих 6 год — вбитий джоб не має блокувати чергу пів доби.
STALE_AFTER_S=$(( RUN_TIMEOUT_S + 900 ))

JOB_NAME="${TRACK}-${AGENT}"
LOG_FILE="$REPO_ROOT/logs/launchd/${JOB_NAME}.log"
STATUS_FILE="$REPO_ROOT/logs/status/${JOB_NAME}.json"

# Увесь подальший stdout/stderr — і в консоль (для launchd StandardOut/ErrorPath — там же
# опиняється дублікат), і в лог-файл джоба з датою.
exec > >(tee -a "$LOG_FILE") 2>&1
echo ""
echo "===== $(date -u +%FT%TZ) runner.sh --track $TRACK --agent $AGENT --provider $PROVIDER dry_run=$DRY_RUN ====="

# ---------------------------------------------------------------------------
# Локи: per-job (черга того самого джоба) + репо-широкий git-лок (git-стан один
# на всі джоби). Прибирання при виході чіпає лише локи, якими реально володіємо.
# ---------------------------------------------------------------------------

LOCK_OWNED=0
LOCK_DIR="$REPO_ROOT/logs/locks/${JOB_NAME}.lock"
GIT_LOCK_OWNED=0
GIT_LOCK_DIR="$REPO_ROOT/logs/locks/git.lock"
TMP_FILES=()

cleanup() {
  local ec=$?
  if [ "$GIT_LOCK_OWNED" = "1" ]; then
    rm -rf "$GIT_LOCK_DIR" 2>/dev/null
  fi
  if [ "$LOCK_OWNED" = "1" ]; then
    rm -rf "$LOCK_DIR" 2>/dev/null
  fi
  local f
  for f in "${TMP_FILES[@]:-}"; do
    [ -n "$f" ] && rm -f "$f" 2>/dev/null
  done
  exit "$ec"
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
# Статус: атомарний запис (tmp + mv), викликається з будь-якої точки завершення.
# ---------------------------------------------------------------------------

STARTED_AT="$(date -u +%FT%TZ)"
STARTED_EPOCH="$(date +%s)"
RUN_ID=""

json_escape() {
  # мінімальне екранування для рядкових полів (лапки, зворотні слеші, переводи рядків)
  printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().rstrip("\n")))' 2>/dev/null \
    || printf '"%s"' "$(printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\n' ' ')"
}

write_status() {
  local status="$1" push="$2" error_tail="$3" cli_exit="${4:-null}" blocked_json="${5:-[]}" offline="${6:-false}"
  local finished_at finished_epoch duration stash_count
  finished_at="$(date -u +%FT%TZ)"
  finished_epoch="$(date +%s)"
  duration=$(( finished_epoch - STARTED_EPOCH ))
  # Лічильник stash-ів — щоб накопичення відкладеної чужої роботи не лишалось
  # непомітним; monitor.sh попереджає в дайджесті при >0.
  stash_count="$(git stash list 2>/dev/null | wc -l | tr -d ' ')"
  case "$stash_count" in ''|*[!0-9]*) stash_count=0 ;; esac
  local tmp
  tmp="$(mktemp "${STATUS_FILE}.XXXXXX")"
  cat > "$tmp" <<EOF
{
  "run_id": $(json_escape "${RUN_ID:-}"),
  "track": $(json_escape "$TRACK"),
  "agent": $(json_escape "$AGENT"),
  "provider": $(json_escape "$PROVIDER"),
  "started_at": $(json_escape "$STARTED_AT"),
  "finished_at": $(json_escape "$finished_at"),
  "duration_s": $duration,
  "status": $(json_escape "$status"),
  "push": $(json_escape "$push"),
  "cli_exit_code": $cli_exit,
  "offline": $offline,
  "stash_count": $stash_count,
  "blocked_paths": $blocked_json,
  "error_tail": $(json_escape "$error_tail")
}
EOF
  mv "$tmp" "$STATUS_FILE"
}

# ---------------------------------------------------------------------------
# Захист робочих годин: launchd після сну доганяє пропущені розклади вдень —
# такий catch-up конкурує з власником за ліміт підписки. Реальний (не dry-run)
# прогін у робочому вікні пропускається. Overrides: IDEAS_SCOUT_WORK_DAYS
# (дефолт "1,2,3,4,5", 1=понеділок), IDEAS_SCOUT_WORK_HOURS (дефолт
# "09:00-19:00"; значення "none" вимикає захист), IDEAS_SCOUT_IGNORE_WORK_HOURS=1
# — разовий обхід для ручного запуску.
# ---------------------------------------------------------------------------

in_work_hours() {
  local days="${IDEAS_SCOUT_WORK_DAYS:-1,2,3,4,5}"
  local hours="${IDEAS_SCOUT_WORK_HOURS:-09:00-19:00}"
  [ "$hours" = "none" ] && return 1
  local dow
  dow="$(date +%u)"
  case ",$days," in
    *,"$dow",*) ;;
    *) return 1 ;;
  esac
  local now_min start end sm em
  now_min=$(( 10#$(date +%H) * 60 + 10#$(date +%M) ))
  start="${hours%-*}"
  end="${hours#*-}"
  sm=$(( 10#${start%:*} * 60 + 10#${start#*:} ))
  em=$(( 10#${end%:*} * 60 + 10#${end#*:} ))
  [ "$now_min" -ge "$sm" ] && [ "$now_min" -lt "$em" ]
}

# Тріаж завжди ініціює власник вручну з чату — це не launchd catch-up, і мовчазний
# skip виглядав би для нього як зависання бота. Захист робочих годин його не стосується.
if [ "$AGENT" != "triage" ] && [ "$DRY_RUN" = "0" ] && [ "${IDEAS_SCOUT_IGNORE_WORK_HOURS:-0}" != "1" ] && in_work_hours; then
  echo "runner.sh: зараз робоче вікно (${IDEAS_SCOUT_WORK_DAYS:-1,2,3,4,5} ${IDEAS_SCOUT_WORK_HOURS:-09:00-19:00}) — прогін пропущено, щоб не конкурувати за підписку (status=skipped_work_hours)"
  write_status "skipped_work_hours" "skipped" "робоче вікно: автопрогони заборонені (override: IDEAS_SCOUT_IGNORE_WORK_HOURS=1)"
  exit 0
fi

# ---------------------------------------------------------------------------
# Локи: mkdir-лок замість flock(1). Усередині — pid, час старту і командний
# рядок процесу (звірка через ps захищає від PID-reuse: чужий живий процес
# із тим самим номером не вважається власником лока).
# ---------------------------------------------------------------------------

lock_write_owner() {
  echo $$ > "$1/pid"
  date +%s > "$1/started_epoch"
  ps -o command= -p $$ > "$1/cmd" 2>/dev/null || echo "runner.sh" > "$1/cmd"
}

lock_holder_alive() {
  # 0 = власник живий і лок не застарілий; 1 = мертвий/застарілий/PID-reuse
  local dir="$1"
  local old_pid old_epoch old_cmd now age cur_cmd
  old_pid="$(cat "$dir/pid" 2>/dev/null || echo "")"
  old_epoch="$(cat "$dir/started_epoch" 2>/dev/null || echo 0)"
  old_cmd="$(cat "$dir/cmd" 2>/dev/null || echo "")"
  case "$old_epoch" in ''|*[!0-9]*) old_epoch=0 ;; esac
  now="$(date +%s)"
  age=$(( now - old_epoch ))
  [ "$age" -ge "$STALE_AFTER_S" ] && return 1
  case "$old_pid" in ''|*[!0-9]*) return 1 ;; esac
  kill -0 "$old_pid" 2>/dev/null || return 1
  if [ -n "$old_cmd" ]; then
    cur_cmd="$(ps -o command= -p "$old_pid" 2>/dev/null || echo "")"
    [ "$cur_cmd" != "$old_cmd" ] && return 1
  fi
  return 0
}

lock_try_acquire() {
  # 0 = лок наш; 1 = зайнятий живим власником або перехоплення програно гонці
  local dir="$1"
  if mkdir "$dir" 2>/dev/null; then
    lock_write_owner "$dir"
    return 0
  fi

  # Перехоплення застарілого лока. Небезпека гонки: між probe і rm інший процес
  # міг уже перехопити цей самий лок. Захист: (а) звірка, що pid у лоці не
  # змінився між читанням до probe і після; (б) mkdir атомарний — перемагає
  # рівно один; (в) фінальна верифікація, що pid-файл усередині — наш.
  local pid_seen pid_now
  pid_seen="$(cat "$dir/pid" 2>/dev/null || echo "")"
  lock_holder_alive "$dir" && return 1
  pid_now="$(cat "$dir/pid" 2>/dev/null || echo "")"
  [ "$pid_now" != "$pid_seen" ] && return 1

  echo "runner.sh: знайдено застарілий лок ($dir, pid=${pid_seen:-?}) — перехоплюю"
  rm -rf "$dir" 2>/dev/null
  mkdir "$dir" 2>/dev/null || return 1
  lock_write_owner "$dir"
  [ "$(cat "$dir/pid" 2>/dev/null)" = "$$" ] || return 1
  return 0
}

git_lock_acquire() {
  # Чекає на репо-широкий git-лок до $1 секунд (poll кожні 5с), 0 = наш.
  local max_wait="${IDEAS_SCOUT_GIT_LOCK_WAIT_S:-$1}"
  local deadline=$(( $(date +%s) + max_wait ))
  while :; do
    if lock_try_acquire "$GIT_LOCK_DIR"; then
      GIT_LOCK_OWNED=1
      return 0
    fi
    [ "$(date +%s)" -ge "$deadline" ] && return 1
    sleep 5
  done
}

git_lock_release() {
  if [ "$GIT_LOCK_OWNED" = "1" ]; then
    rm -rf "$GIT_LOCK_DIR" 2>/dev/null
    GIT_LOCK_OWNED=0
  fi
}

if lock_try_acquire "$LOCK_DIR"; then
  LOCK_OWNED=1
else
  echo "runner.sh: лок $LOCK_DIR живий — прогін пропущено (status=skipped)"
  write_status "skipped" "skipped" "лок $JOB_NAME живий (інший прогін ще триває)"
  exit 0
fi

# ---------------------------------------------------------------------------
# run_id
# ---------------------------------------------------------------------------

RUN_ID="$(date +%Y%m%d-%H%M%S)-${PROVIDER}-${TRACK}-${AGENT}"
echo "runner.sh: run_id=$RUN_ID"

# ---------------------------------------------------------------------------
# Таймаут-поліфіл (немає gtimeout/timeout на цій macOS): фоновий watcher.
# Спершу TERM (даємо процесу шанс коректно завершитись — git встигає прибрати
# index.lock), через ${TERM_GRACE_S}с — KILL.
# ---------------------------------------------------------------------------

with_timeout() {
  local timeout_s="$1"; shift
  "$@" &
  local pid=$!
  (
    sleep "$timeout_s"
    kill -TERM "$pid" 2>/dev/null
    sleep "$TERM_GRACE_S"
    kill -9 "$pid" 2>/dev/null
  ) &
  local watcher=$!
  local status=0
  wait "$pid" 2>/dev/null || status=$?
  kill "$watcher" 2>/dev/null
  wait "$watcher" 2>/dev/null
  return "$status"
}

# ---------------------------------------------------------------------------
# Доступність remote (короткий ls-remote з таймаутом — щоб не зависнути офлайн)
# ---------------------------------------------------------------------------

OFFLINE=0
remote_reachable() {
  with_timeout 15 git ls-remote --exit-code --heads origin >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# Git-критична секція №1 (під репо-широким локом): преflight-прибирання після
# можливого вбитого попереднього прогону, перевірка гілки, stash, pull --rebase.
# ---------------------------------------------------------------------------

if ! git_lock_acquire 600; then
  echo "runner.sh: git-лок зайнятий іншим прогоном понад ліміт очікування — прогін пропущено (status=skipped)"
  write_status "skipped" "skipped" "git-лок зайнятий (інший джоб у git-секції)"
  exit 0
fi

# Залишки від вбитого git-процесу: index.lock без живого git — прибрати.
if [ -f .git/index.lock ]; then
  if ! pgrep -x git >/dev/null 2>&1; then
    lock_mtime="$(stat -f %m .git/index.lock 2>/dev/null || echo 0)"
    if [ $(( $(date +%s) - lock_mtime )) -gt 60 ]; then
      echo "runner.sh: прибираю застарілий .git/index.lock (git-процесів немає, файлу >60с)"
      rm -f .git/index.lock
    fi
  fi
fi

# Незавершений rebase від попереднього прогону (вбитий pull --rebase) —
# абортувати ДО stash, інакше stash підхопить unmerged-шляхи з конфлікт-маркерами.
if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ]; then
  echo "runner.sh: знайдено незавершений rebase — git rebase --abort"
  git rebase --abort >/dev/null 2>&1 \
    || echo "runner.sh: попередження — rebase --abort не вдався, стан репо потребує ручного розбору" >&2
fi

# Вимога: HEAD на $MAIN_BRANCH. Detached HEAD чи чужа гілка (напр. застряглий
# quarantine-checkout після краху) → без git-операцій, ручне втручання.
CUR_REF="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
if [ "$CUR_REF" != "$MAIN_BRANCH" ]; then
  echo "runner.sh: HEAD не на ${MAIN_BRANCH} (зараз: ${CUR_REF:-detached}) — прогін зупинено, потрібне ручне втручання (status=error)" >&2
  write_status "error" "skipped" "HEAD не на ${MAIN_BRANCH} (зараз: ${CUR_REF:-detached}); git-операції пропущено, розберіться вручну"
  exit 0
fi

STASHED=0
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  echo "runner.sh: робоче дерево брудне на старті — stash (мітка runner:${RUN_ID})"
  # Виключено з pathspec: 1) scripts/, config/prompts/, launchd/, .gitignore —
  # захищені guard-ом шляхи, гігієна їх не чіпає; 2) logs/locks/, logs/launchd/,
  # logs/quarantine/ — живий рантайм ЦЬОГО прогону (лок, лог-файл, у який зараз
  # пише tee) — інакше stash -u міг би змести їх з-під самого себе; 3) inbox/,
  # logs/triage/ — матеріал, який власник щойно надіслав у Telegram: він пишеться
  # ДО старту прогону тріажу, тож stash з'їв би вхід цього ж прогону.
  if git stash push -u -m "runner:${RUN_ID}" \
      -- . ':!scripts' ':!config/prompts' ':!launchd' ':!.gitignore' \
         ':!logs/locks' ':!logs/launchd' ':!logs/quarantine' \
         ':!inbox' ':!logs/triage' \
      >/dev/null 2>&1; then
    STASHED=1
  else
    echo "runner.sh: попередження — git stash push не вдався, продовжую на брудному дереві" >&2
  fi
fi

if remote_reachable; then
  if ! git pull --rebase origin "$MAIN_BRANCH" >/dev/null 2>&1; then
    git rebase --abort >/dev/null 2>&1 || true
    echo "runner.sh: попередження — git pull --rebase не вдався (rebase абортовано), працюю з локальним станом" >&2
  fi
else
  OFFLINE=1
  echo "runner.sh: remote недоступний — офлайн-режим, працюю локально"
fi

git_lock_release

# ---------------------------------------------------------------------------
# --dry-run: усе вище виконується по-справжньому (локи + git-гігієна). Далі —
# лише echo команд замість реального виклику CLI/commit/push.
# ---------------------------------------------------------------------------

if [ "$DRY_RUN" = "1" ]; then
  if [ "$AGENT" = "collector" ] && [ "$TRACK" = "passive-income" ]; then
    echo "--- DRY RUN: далі викликався б $REPO_ROOT/scripts/reddit-fetch.sh (передкачування Reddit-кешу для collector, лише трек passive-income) ---"
  elif [ "$AGENT" = "collector" ]; then
    echo "--- DRY RUN: reddit-fetch.sh НЕ викликається для треку $TRACK (сабреддіти в скрипті специфічні для passive-income) ---"
  fi
  echo "--- DRY RUN: далі йшов би виклик CLI провайдера '$PROVIDER' з промптом config/prompts/${AGENT}.md ---"
  echo "--- DRY RUN: далі йшов би git add/commit/push (або quarantine-гілка при помилці CLI) ---"
  write_status "dry_run" "skipped" "" "null" "[]" "$( [ "$OFFLINE" = 1 ] && echo true || echo false )"
  echo "runner.sh: dry-run завершено, статус записано в $STATUS_FILE"
  exit 0
fi

# ---------------------------------------------------------------------------
# Гейт провайдера codex: codex exec навіть у sandbox workspace-write з
# --ask-for-approval never дає агенту shell — це ламає інваріант «агент без
# shell», на якому тримається весь захист від промпт-ін'єкції (агент не повинен
# мати шляху до git/curl/Keychain). Тому codex вимкнено за замовчуванням.
# ---------------------------------------------------------------------------

if [ "$PROVIDER" = "codex" ] && [ "${IDEAS_SCOUT_ALLOW_CODEX:-0}" != "1" ]; then
  echo "runner.sh: --provider codex вимкнено: sandbox codex exec дає агенту shell — межа безпеки НЕ еквівалентна claude-варіанту (allowlist інструментів без Bash). Явний дозвіл: IDEAS_SCOUT_ALLOW_CODEX=1. Див. docs/operations.md." >&2
  write_status "error" "skipped" "codex вимкнено за замовчуванням (агент отримав би shell); IDEAS_SCOUT_ALLOW_CODEX=1 для явного дозволу"
  exit 0
fi

# ---------------------------------------------------------------------------
# Reddit-місток (лише для collector, лише трек passive-income): агент не має
# Bash, тож OAuth-фетч Reddit робить сам runner.sh ДО виклику CLI. Нефатально —
# падіння фетчера не зриває прогін, collector просто працює без Reddit-кешу.
#
# reddit-fetch.sh має захардкоджений список сабреддітів про заробіток
# (SUBREDDITS у самому скрипті) — вони не мають стосунку до app-ideas. Поки
# для цього треку не заведено окремого набору сабреддітів, викликати фетчер
# для нього означає передкачувати нерелевантний кеш, який промпт collector-а
# все одно читає без фільтра за треком.
# ---------------------------------------------------------------------------

if [ "$AGENT" = "collector" ] && [ "$TRACK" = "passive-income" ]; then
  if [ -x "$REPO_ROOT/scripts/reddit-fetch.sh" ]; then
    "$REPO_ROOT/scripts/reddit-fetch.sh" || echo "runner.sh: попередження — reddit-fetch.sh завершився з помилкою, продовжую без Reddit-кешу" >&2
  else
    echo "runner.sh: попередження — scripts/reddit-fetch.sh не знайдено або не виконуваний, пропускаю Reddit-фетч" >&2
  fi
elif [ "$AGENT" = "collector" ]; then
  echo "runner.sh: трек $TRACK — reddit-fetch.sh пропущено (сабреддіти в ньому специфічні для passive-income, для $TRACK окремого набору ще нема)"
fi

# ---------------------------------------------------------------------------
# Промпт: config/prompts/<agent>.md з підстановкою {{RUN_ID}} і {{TRACK}}
# (для triage додатково {{INBOX_FILE}} і {{DRAFT_ID}} — їх передає telegram-bot.py
# через середовище; це шлях до вже записаного вхідного матеріалу, не його вміст).
# ---------------------------------------------------------------------------

PROMPT_SRC="$REPO_ROOT/config/prompts/${AGENT}.md"
if [ ! -f "$PROMPT_SRC" ]; then
  echo "runner.sh: промпт не знайдено: $PROMPT_SRC" >&2
  write_status "error" "skipped" "промпт не знайдено: $PROMPT_SRC"
  exit 0
fi

INBOX_FILE="${IDEAS_SCOUT_INBOX_FILE:-}"
DRAFT_ID="${IDEAS_SCOUT_DRAFT_ID:-}"
if [ "$AGENT" = "triage" ]; then
  # Шлях приходить ззовні й підставляється в промпт — приймаємо лише безпечну форму
  # всередині inbox/, щоб цим не можна було націлити агента на будь-який файл машини.
  case "$INBOX_FILE" in
    inbox/*) [[ "$INBOX_FILE" == *".."* ]] && INBOX_FILE="" ;;
    *) INBOX_FILE="" ;;
  esac
  case "$DRAFT_ID" in ''|*[!0-9-]*) DRAFT_ID="" ;; esac
  if [ -z "$INBOX_FILE" ] || [ -z "$DRAFT_ID" ] || [ ! -f "$REPO_ROOT/$INBOX_FILE" ]; then
    echo "runner.sh: --agent triage вимагає IDEAS_SCOUT_INBOX_FILE (шлях виду inbox/... який існує) і IDEAS_SCOUT_DRAFT_ID" >&2
    write_status "error" "skipped" "triage без валідного IDEAS_SCOUT_INBOX_FILE/IDEAS_SCOUT_DRAFT_ID"
    exit 0
  fi
fi

PROMPT_TMP="$(mktemp "${TMPDIR:-/tmp}/ideas-scout-prompt.XXXXXX")"
TMP_FILES+=("$PROMPT_TMP")
sed -e "s/{{RUN_ID}}/${RUN_ID}/g" -e "s/{{TRACK}}/${TRACK}/g" \
    -e "s|{{INBOX_FILE}}|${INBOX_FILE}|g" -e "s/{{DRAFT_ID}}/${DRAFT_ID}/g" \
    "$PROMPT_SRC" > "$PROMPT_TMP"

# ---------------------------------------------------------------------------
# Виклик CLI headless — уся різниця між провайдерами ізольована в цих двох
# функціях (вимога PLAN.md Фаза 4: runner.sh — єдине місце, що знає CLI).
#
# Свідомо НЕ даємо агенту жодних Bash/shell-інструментів: агент лише читає й
# пише файли в робочій теці репозиторію; git commit/push виконує сам runner.sh
# після завершення прогону (guard проти промпт-ін'єкції нижче).
# ---------------------------------------------------------------------------

invoke_claude() {
  local prompt_text
  prompt_text="$(cat "$PROMPT_TMP")"

  if ! command -v claude >/dev/null 2>&1; then
    echo "invoke_claude: claude CLI не знайдено в PATH" >&2
    return 127
  fi

  # --permission-mode bypassPermissions разом із жорстким --allowedTools:
  # межу безпеки задає саме перелік дозволених інструментів (без Bash), а не
  # інтерактивні permission-діалоги, які в headless-режимі однаково не спрацюють.
  local -a cmd=(claude --permission-mode bypassPermissions
    --allowedTools Read Write Edit Glob Grep WebFetch WebSearch
    --output-format text)
  if [ -n "${RUNNER_CLAUDE_MODEL:-}" ]; then
    cmd+=(--model "$RUNNER_CLAUDE_MODEL")
  fi
  if [ -n "${RUNNER_MAX_BUDGET_USD:-}" ]; then
    cmd+=(--max-budget-usd "$RUNNER_MAX_BUDGET_USD")
  fi
  cmd+=(-p "$prompt_text")

  with_timeout "$RUN_TIMEOUT_S" "${cmd[@]}"
}

invoke_codex() {
  local prompt_text
  prompt_text="$(cat "$PROMPT_TMP")"

  if ! command -v codex >/dev/null 2>&1; then
    echo "invoke_codex: codex CLI не знайдено в PATH" >&2
    return 127
  fi

  # УВАГА: ці прапорці НЕ перевірені живим прогоном `codex --help` на цій машині —
  # інсталяція codex тут була зламана (broken symlink кастомної версії brew cask).
  # Перед першим бойовим прогоном на M1 обов'язково звірити з `codex --help` і
  # `codex exec --help` та скоригувати за потреби. Виклик можливий лише при
  # IDEAS_SCOUT_ALLOW_CODEX=1 (див. гейт вище): sandbox дає агенту shell.
  local -a cmd=(codex exec --skip-git-repo-check --sandbox workspace-write
    --ask-for-approval never -C "$REPO_ROOT")
  if [ -n "${RUNNER_CODEX_MODEL:-}" ]; then
    cmd+=(-m "$RUNNER_CODEX_MODEL")
  fi
  cmd+=("$prompt_text")

  with_timeout "$RUN_TIMEOUT_S" "${cmd[@]}"
}

echo "runner.sh: виклик провайдера '$PROVIDER' (таймаут ${RUN_TIMEOUT_S}с)"

# Вихід CLI пишемо в окремий тимчасовий файл (не одразу в спільний $LOG_FILE,
# що накопичується між прогонами) — щоб error_tail нижче був хвостом саме
# ЦЬОГО виклику, а не випадковим зрізом через кілька прогонів поспіль.
CLI_OUTPUT_FILE="$(mktemp "${TMPDIR:-/tmp}/ideas-scout-cli-out.XXXXXX")"
TMP_FILES+=("$CLI_OUTPUT_FILE")

# PROMPT_TMP створений щойно, до виклику CLI — його mtime слугує маркером
# «до прогону» для детекції нових/змінених файлів у .git/hooks (porcelain
# внутрішності .git не показує, тож hooks перевіряються окремо).
HOOKS_MARKER="$PROMPT_TMP"

CLI_EXIT=0
if [ "$PROVIDER" = "claude" ]; then
  invoke_claude >"$CLI_OUTPUT_FILE" 2>&1 || CLI_EXIT=$?
else
  invoke_codex >"$CLI_OUTPUT_FILE" 2>&1 || CLI_EXIT=$?
fi
cat "$CLI_OUTPUT_FILE"
echo "runner.sh: провайдер '$PROVIDER' завершився з кодом $CLI_EXIT"

ERROR_TAIL=""
if [ "$CLI_EXIT" != "0" ]; then
  ERROR_TAIL="$(tail -n 40 "$CLI_OUTPUT_FILE" 2>/dev/null | tr '\n' ' ' | cut -c1-4000)"
fi

# ---------------------------------------------------------------------------
# Git-критична секція №2 (під репо-широким локом): guard, коміт, push, статус.
# ---------------------------------------------------------------------------

FINAL_STATUS="ok"
PUSH_STATUS="skipped"
BLOCKED_JSON="[]"

if ! git_lock_acquire 1800; then
  echo "runner.sh: git-лок зайнятий понад ліміт очікування — зміни прогону лишились незакоміченими в робочому дереві (їх підхопить/перевірить guard наступного прогону)" >&2
  write_status "error" "skipped" "git-лок зайнятий після CLI: зміни не закомічені, guard не виконувався${ERROR_TAIL:+; хвіст CLI: }$ERROR_TAIL" "$CLI_EXIT" "[]" "$( [ "$OFFLINE" = 1 ] && echo true || echo false )"
  exit 0
fi

# ---------------------------------------------------------------------------
# Guard проти промпт-ін'єкції — ALLOWLIST: комітиться (і взагалі приймається)
# лише те, що агент має право міняти. БУДЬ-ЯКИЙ інший змінений/новий шлях
# (scripts/, config/prompts/, launchd/, .gitignore, docs/, корінь, .github/ —
# будь-що) відкочується, потрапляє в blocked_paths і дає status=blocked_paths.
# Розбір порцеляну через -z/NUL — шляхи з пробілами та не-ASCII (git-лапки)
# не обходять детекцію.
# ---------------------------------------------------------------------------

is_allowed_path() {
  case "$1" in
    registries/*|catalogs/*) return 0 ;;
    logs/runs/*|logs/status/*|logs/decisions.md|logs/dedup-decisions.md) return 0 ;;
    # Ручне подання з Telegram: inbox/ пише бот (не агент), logs/triage/ — агент-тріаж.
    inbox/*|logs/triage/*) return 0 ;;
    inbox|logs/triage) return 0 ;;
    config/criteria*|config/search-queries-*.md|config/taxonomy.md|config/availability.md) return 0 ;;
    # Рантайм цього ж прогону (gitignored; тут — belt-and-braces на випадок
    # checkout без оновленого .gitignore): не блокувати самих себе.
    logs/locks/*|logs/launchd/*|logs/quarantine/*) return 0 ;;
    logs/runs|logs/status|logs/locks|logs/launchd|logs/quarantine) return 0 ;;
    *) return 1 ;;
  esac
}

BLOCKED_PATHS=()
while IFS= read -r -d '' entry; do
  p="${entry:3}"
  [ -z "$p" ] && continue
  if ! is_allowed_path "$p"; then
    BLOCKED_PATHS+=("$p")
  fi
done < <(git status --porcelain -z --no-renames 2>/dev/null)

# .git/hooks не видно в porcelain — окрема перевірка за mtime відносно маркера.
if [ -d .git/hooks ]; then
  while IFS= read -r h; do
    [ -z "$h" ] && continue
    BLOCKED_PATHS+=("$h")
  done < <(find .git/hooks -type f -newer "$HOOKS_MARKER" 2>/dev/null)
fi

if [ "${#BLOCKED_PATHS[@]}" -gt 0 ]; then
  echo "runner.sh: ПОПЕРЕДЖЕННЯ — заблоковано ${#BLOCKED_PATHS[@]} шлях(ів) поза allowlist, можлива промпт-ін'єкція: ${BLOCKED_PATHS[*]}"
  QFILE="$REPO_ROOT/logs/quarantine/${RUN_ID}-blocked-paths.diff"
  {
    echo "# Заблоковані шляхи прогону $RUN_ID (guard проти промпт-ін'єкції, allowlist)"
    echo "# Ці зміни НЕ закомічені й відкочені. Перегляньте перед тим, як довіряти цьому прогону."
    for p in "${BLOCKED_PATHS[@]}"; do
      echo ""
      echo "## $p"
      if git ls-files --error-unmatch -- "$p" >/dev/null 2>&1; then
        git diff -- "$p" 2>/dev/null
      else
        echo "(новий, не відстежуваний файл/тека)"
        if [ -f "$p" ]; then
          echo "--- вміст ---"
          cat "$p" 2>/dev/null
        elif [ -d "$p" ]; then
          find "$p" -type f 2>/dev/null
        fi
      fi
    done
  } > "$QFILE" 2>/dev/null

  for p in "${BLOCKED_PATHS[@]}"; do
    if git ls-files --error-unmatch -- "$p" >/dev/null 2>&1; then
      git checkout -- "$p" 2>/dev/null
    else
      rm -rf "$p" 2>/dev/null
    fi
  done

  BLOCKED_JSON="$(printf '%s\n' "${BLOCKED_PATHS[@]}" | python3 -c 'import json,sys; print(json.dumps([l.rstrip() for l in sys.stdin if l.strip()]))' 2>/dev/null \
    || printf '["%s"]' "$(printf '%s' "${BLOCKED_PATHS[*]}" | sed 's/"/\\"/g')")"
fi

# ---------------------------------------------------------------------------
# Коміт: staging строго за allowlist (дзеркало is_allowed_path, мінус рантайм і
# мінус статус-файли — статус цього джоба комітиться окремо після відомого
# push-результату; чужі статус-файли комітять їхні власні джоби).
# ---------------------------------------------------------------------------

stage_allowed_paths() {
  local p
  for p in registries catalogs logs/runs logs/decisions.md logs/dedup-decisions.md \
           inbox logs/triage config/taxonomy.md config/availability.md; do
    [ -e "$p" ] && git add -A -- "$p" 2>/dev/null
  done
  for p in config/criteria*.md config/search-queries-*.md; do
    [ -e "$p" ] && git add -A -- "$p" 2>/dev/null
  done
}

push_with_retry() {
  local branch="$1"
  local attempt=1
  if [ "$OFFLINE" = "1" ]; then
    return 1
  fi
  while [ "$attempt" -le 3 ]; do
    if with_timeout 60 git pull --rebase origin "$branch" >/dev/null 2>&1; then
      if with_timeout 60 git push origin "$branch" >/dev/null 2>&1; then
        return 0
      fi
    else
      # невдалий/вбитий pull --rebase не має лишати репо в rebase-стані
      git rebase --abort >/dev/null 2>&1 || true
    fi
    attempt=$((attempt + 1))
    sleep 2
  done
  return 1
}

if [ "$CLI_EXIT" != "0" ]; then
  # Часткові/помилкові результати — у quarantine, НЕ в основну гілку, НЕ пушити.
  FINAL_STATUS="error"
  stage_allowed_paths
  if [ -n "$(git diff --cached --name-only 2>/dev/null)" ]; then
    QBRANCH="quarantine/${RUN_ID}"
    echo "runner.sh: CLI провалився — коміт часткових результатів у $QBRANCH (без push)"
    if git checkout -b "$QBRANCH" >/dev/null 2>&1; then
      git commit -q -m "Прогін ${RUN_ID} (карантин — CLI завершився з кодом ${CLI_EXIT})" || true
      git checkout -q "$MAIN_BRANCH" >/dev/null 2>&1
    fi
    PUSH_STATUS="skipped"
  else
    echo "runner.sh: CLI провалився, змін для коміту немає"
    PUSH_STATUS="skipped"
  fi
else
  stage_allowed_paths
  if [ -n "$(git diff --cached --name-only 2>/dev/null)" ]; then
    COMMIT_PATHS="$(git diff --cached --name-only 2>/dev/null)"
    git commit -q -m "$(printf 'Прогін %s\n\n%s' "$RUN_ID" "$COMMIT_PATHS")" || true
    if push_with_retry "$MAIN_BRANCH"; then
      PUSH_STATUS="ok"
    else
      PUSH_STATUS="failed"
    fi
  else
    echo "runner.sh: змін для коміту немає"
    PUSH_STATUS="skipped"
  fi
  if [ "${#BLOCKED_PATHS[@]}" -gt 0 ]; then
    FINAL_STATUS="blocked_paths"
  fi
fi

write_status "$FINAL_STATUS" "$PUSH_STATUS" "$ERROR_TAIL" "$CLI_EXIT" "$BLOCKED_JSON" "$( [ "$OFFLINE" = 1 ] && echo true || echo false )"

# Статус-файл комітимо окремим маленьким комітом — щоб не бути на шляху
# основного коміту (він же й записує push-результат основного коміту вище);
# best-effort: провал цього кроку не змінює вже записаний FINAL_STATUS.
if [ "$OFFLINE" != "1" ] && [ "$FINAL_STATUS" != "error" ]; then
  git add -- "$STATUS_FILE" 2>/dev/null
  if [ -n "$(git diff --cached --name-only 2>/dev/null)" ]; then
    git commit -q -m "Статус прогону ${RUN_ID}" 2>/dev/null || true
    push_with_retry "$MAIN_BRANCH" >/dev/null 2>&1 || true
  fi
fi

git_lock_release

if [ "$STASHED" = "1" ]; then
  echo "runner.sh: увага — на старті було засташовано чужі зміни (runner:${RUN_ID}). Перевірте 'git stash list' і розберіть вручну."
fi

echo "runner.sh: завершено, status=$FINAL_STATUS push=$PUSH_STATUS"
exit 0
