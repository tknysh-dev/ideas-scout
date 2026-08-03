#!/usr/bin/env bash
# llm-invoke.sh — єдина точка headless-виклику LLM-провайдерів для глибокого
# дослідження (аналог runner.sh-принципу «одне місце знає CLI», але для
# research-only профілю: модель лише шукає у вебі й повертає текст).
#
# Використання:
#   llm-invoke.sh check [provider ...]        — доступність/авторизація провайдерів
#   llm-invoke.sh run <provider> [--model X] [--timeout S] [--workdir DIR]
#                                              — промпт зі stdin, відповідь у stdout
#
# Провайдери: claude | codex | gemini | deepseek.
#
# Межа безпеки research-профілю ЖОРСТКІША за runner.sh: жодних Write/Edit,
# жодного db.sh, жодного доступу до репозиторію. Дослідник читає веб і друкує
# текст; у БД пише лише оркестратор (deep-research.sh) після синтезу. Тому
# гейт IDEAS_SCOUT_ALLOW_CODEX тут НЕ застосовується: codex викликається в
# sandbox read-only (без запису на диск), а не workspace-write, як в runner.sh.
#
# deepseek — опційний і без веб-пошуку (чистий API): для ролі незалежного
# дослідника непридатний (віддавав би закешовані знання — саме те, чого
# уникаємо), тож оркестратор може використовувати його лише для крос-допиту
# вже зібраних доказів. Потребує DEEPSEEK_API_KEY в env-файлі.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

ENV_FILE="${IDEAS_SCOUT_ENV_FILE:-$HOME/.config/ideas-scout/env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

TERM_GRACE_S="${LLM_INVOKE_TERM_GRACE_S:-10}"

die() { echo "llm-invoke.sh: $*" >&2; exit 2; }

usage() {
  cat >&2 <<'EOF'
Використання:
  llm-invoke.sh check [provider ...]
  llm-invoke.sh run <claude|codex|gemini|deepseek> [--model X] [--timeout S] [--workdir DIR]

Промпт для run подається на stdin, відповідь моделі — у stdout.
EOF
}

# Той самий поліфіл, що в runner.sh (на macOS немає gtimeout/timeout).
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
# run — research-only виклики
# ---------------------------------------------------------------------------

run_claude() {
  local prompt="$1" model="$2" timeout_s="$3"
  command -v claude >/dev/null 2>&1 || { echo "claude CLI не знайдено в PATH" >&2; return 127; }
  # Лише веб-інструменти: дослідник не має ні файлової системи, ні db.sh.
  local -a cmd=(claude --permission-mode bypassPermissions
    --allowedTools WebSearch WebFetch
    --output-format text)
  [ -n "$model" ] && cmd+=(--model "$model")
  [ -n "${RUNNER_MAX_BUDGET_USD:-}" ] && cmd+=(--max-budget-usd "$RUNNER_MAX_BUDGET_USD")
  cmd+=(-p "$prompt")
  with_timeout "$timeout_s" "${cmd[@]}"
}

run_codex() {
  local prompt="$1" model="$2" timeout_s="$3" workdir="$4"
  command -v codex >/dev/null 2>&1 || { echo "codex CLI не знайдено в PATH" >&2; return 127; }
  # sandbox read-only + --search: модель шукає у вебі нативним інструментом,
  # а shell-команди в пісочниці не можуть писати на диск. -C вказує на порожню
  # робочу теку ПОЗА репозиторієм — досліднику нема чого робити в коді.
  # УВАГА: прапорці звірити з `codex exec --help` на M1 перед першим бойовим
  # прогоном (llm-invoke.sh check робить цю перевірку автоматично).
  local -a cmd=(codex exec --skip-git-repo-check --sandbox read-only --search
    --ask-for-approval never -C "$workdir")
  [ -n "$model" ] && cmd+=(-m "$model")
  cmd+=("$prompt")
  with_timeout "$timeout_s" "${cmd[@]}"
}

run_gemini() {
  local prompt="$1" model="$2" timeout_s="$3" workdir="$4"
  command -v gemini >/dev/null 2>&1 || { echo "gemini CLI не знайдено в PATH" >&2; return 127; }
  # Без --yolo/--approval-mode: у неінтерактивному режимі gemini самостійно
  # виконує лише read-only інструменти (google_web_search, web_fetch), а
  # write-інструменти без схвалення відпадають — що нам і треба.
  local -a cmd=(gemini)
  [ -n "$model" ] && cmd+=(-m "$model")
  cmd+=(-p "$prompt")
  (cd "$workdir" && with_timeout "$timeout_s" "${cmd[@]}")
}

run_deepseek() {
  local prompt="$1" model="$2" timeout_s="$3"
  [ -n "${DEEPSEEK_API_KEY:-}" ] || { echo "DEEPSEEK_API_KEY не заданий у $ENV_FILE" >&2; return 127; }
  model="${model:-${DEEPSEEK_MODEL:-deepseek-reasoner}}"
  local body
  body="$(python3 -c '
import json, sys
print(json.dumps({
    "model": sys.argv[1],
    "messages": [{"role": "user", "content": sys.stdin.read()}],
    "stream": False,
}))
' "$model" <<<"$prompt")" || return 2
  local raw
  raw="$(with_timeout "$timeout_s" curl -sS --fail-with-body \
    -H "Authorization: Bearer ${DEEPSEEK_API_KEY}" \
    -H "Content-Type: application/json" \
    --data-raw "$body" \
    https://api.deepseek.com/chat/completions)" || {
      echo "deepseek API помилка: $raw" >&2; return 1; }
  printf '%s' "$raw" | python3 -c '
import json, sys
d = json.load(sys.stdin)
print(d["choices"][0]["message"]["content"])
'
}

cmd_run() {
  local provider="${1:-}"; shift || true
  local model="" timeout_s="${LLM_INVOKE_TIMEOUT_S:-1800}" workdir=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --model) model="${2:-}"; shift 2 ;;
      --timeout) timeout_s="${2:-}"; shift 2 ;;
      --workdir) workdir="${2:-}"; shift 2 ;;
      *) die "run: невідомий аргумент: $1" ;;
    esac
  done
  case "$timeout_s" in ''|*[!0-9]*) die "run: --timeout має бути цілим числом секунд" ;; esac

  local prompt
  prompt="$(cat)"
  [ -n "$prompt" ] || die "run: порожній промпт на stdin"

  # Порожня робоча тека поза репо — спільна для провайдерів, яким потрібен cwd.
  # Прибирання через глобальну змінну: EXIT-trap спрацьовує вже поза скоупом
  # локальних змінних функції (set -u впав би на "unbound variable").
  if [ -z "$workdir" ]; then
    TMP_WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/ideas-scout-research.XXXXXX")" || die "run: mktemp не вдався"
    workdir="$TMP_WORKDIR"
    trap '[ -n "${TMP_WORKDIR:-}" ] && rm -rf "$TMP_WORKDIR"' EXIT
  fi

  case "$provider" in
    claude)   [ -n "$model" ] || model="${RUNNER_CLAUDE_MODEL:-}";  run_claude "$prompt" "$model" "$timeout_s" ;;
    codex)    [ -n "$model" ] || model="${RUNNER_CODEX_MODEL:-}";   run_codex "$prompt" "$model" "$timeout_s" "$workdir" ;;
    gemini)   [ -n "$model" ] || model="${RUNNER_GEMINI_MODEL:-}";  run_gemini "$prompt" "$model" "$timeout_s" "$workdir" ;;
    deepseek) run_deepseek "$prompt" "$model" "$timeout_s" ;;
    *) die "run: невідомий провайдер: '$provider' (очікую claude|codex|gemini|deepseek)" ;;
  esac
}

# ---------------------------------------------------------------------------
# check — діагностика доступності для запуску на M1
# ---------------------------------------------------------------------------

check_one() {
  local provider="$1"
  case "$provider" in
    claude)
      if ! command -v claude >/dev/null 2>&1; then echo "claude: ВІДСУТНІЙ (npm i -g @anthropic-ai/claude-code)"; return 1; fi
      echo "claude: OK ($(claude --version 2>/dev/null | head -1))"
      ;;
    codex)
      if ! command -v codex >/dev/null 2>&1; then echo "codex: ВІДСУТНІЙ (npm i -g @openai/codex; потім 'codex login')"; return 1; fi
      local help
      help="$(codex exec --help 2>&1)"
      local missing=""
      for flag in --sandbox --search --skip-git-repo-check --ask-for-approval; do
        printf '%s' "$help" | grep -q -- "$flag" || missing="$missing $flag"
      done
      if [ -n "$missing" ]; then
        echo "codex: ВСТАНОВЛЕНО ($(codex --version 2>/dev/null | head -1)), але 'codex exec --help' не показує:$missing — скоригуй run_codex() в llm-invoke.sh"
        return 1
      fi
      echo "codex: OK ($(codex --version 2>/dev/null | head -1))"
      ;;
    gemini)
      if ! command -v gemini >/dev/null 2>&1; then echo "gemini: ВІДСУТНІЙ (npm i -g @google/gemini-cli; перший запуск 'gemini' інтерактивно для логіну Google)"; return 1; fi
      echo "gemini: OK ($(gemini --version 2>/dev/null | head -1))"
      ;;
    deepseek)
      if [ -z "${DEEPSEEK_API_KEY:-}" ]; then echo "deepseek: ВИМКНЕНО (немає DEEPSEEK_API_KEY у $ENV_FILE — опційний, лише крос-допит)"; return 1; fi
      local code
      code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 \
        -H "Authorization: Bearer ${DEEPSEEK_API_KEY}" https://api.deepseek.com/models 2>/dev/null)"
      if [ "$code" = "200" ]; then echo "deepseek: OK (API-ключ прийнято)"; else echo "deepseek: ПОМИЛКА (HTTP $code на /models — перевір ключ/мережу)"; return 1; fi
      ;;
    *)
      echo "$provider: невідомий провайдер"; return 1 ;;
  esac
}

cmd_check() {
  local providers=("$@")
  [ ${#providers[@]} -gt 0 ] || providers=(claude codex gemini deepseek)
  local failed=0
  for p in "${providers[@]}"; do
    check_one "$p" || failed=1
  done
  return "$failed"
}

case "${1:-}" in
  run) shift; cmd_run "$@" ;;
  check) shift; cmd_check "$@" ;;
  -h|--help) usage; exit 0 ;;
  *) usage; exit 2 ;;
esac
