#!/usr/bin/env bash
# llm-invoke.contract.test.sh — тести захисних перевірок llm-invoke.sh
# (валідація аргументів/stdin, що спрацьовує ДО диспетчеризації в claude/
# codex/gemini/deepseek).
#
# llm-invoke.sh не рефакториться і не сорситься (сам файл одразу
# диспетчеризує підкоманду внизу) — кожен випадок тут викликає його як
# підпроцес і звіряє код виходу та повідомлення. Кожен кейс підібраний так,
# щоб падати ще на валідації аргументів/stdin, ДО кроку, який реально запускає
# зовнішній CLI чи йде в мережу (жоден тест тут не викликає claude/codex/
# gemini і не чіпає мережу — див. звіт, де це перевірено по кожному кейсу).
#
# IDEAS_SCOUT_ENV_FILE=/dev/null — обов'язково: без цього llm-invoke.sh
# спробує підвантажити бойовий env-файл власника ($HOME/.config/ideas-scout/env).
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_NAME="llm-invoke.sh contract"
source "$SCRIPT_DIR/test-lib.sh"

LLM_INVOKE="$SCRIPT_DIR/llm-invoke.sh"

LAST_OUTPUT=""
LAST_CODE=0

# invoke <stdin-контент> <аргументи llm-invoke.sh...>
#
# stdin подається окремим першим аргументом (а не через `<<<`), щоб виклики
# без реального промпту могли явно передати "" — і жоден кейс тут не залежав
# від успадкованого stdin тестового процесу.
invoke() {
  local stdin_content="$1"; shift
  LAST_OUTPUT="$(printf '%s' "$stdin_content" | IDEAS_SCOUT_ENV_FILE=/dev/null "$LLM_INVOKE" "$@" 2>&1)"
  LAST_CODE=$?
}

code_is() { [ "$LAST_CODE" -eq "$1" ]; }
output_has() {
  case "$LAST_OUTPUT" in
    *"$1"*) return 0 ;;
    *) return 1 ;;
  esac
}

# ---------------------------------------------------------------------------
# run: невідомий провайдер
# ---------------------------------------------------------------------------

invoke "тестовий промпт" run bogus-provider
expect_eq "run bogus-provider: код виходу 2" "2" "$LAST_CODE"
expect_ok "run bogus-provider: повідомлення називає провайдера і дозволений список" \
  output_has "run: невідомий провайдер: 'bogus-provider' (очікую claude|codex|gemini|deepseek)"

# ---------------------------------------------------------------------------
# run: --timeout не число (нечислове, порожнє, від'ємне)
# ---------------------------------------------------------------------------

invoke "" run claude --timeout abc
expect_eq "--timeout abc: код виходу 2" "2" "$LAST_CODE"
expect_ok "--timeout abc: повідомлення про ціле число секунд" \
  output_has "run: --timeout має бути цілим числом секунд"

invoke "" run claude --timeout ""
expect_eq "--timeout '' (порожнє значення): код виходу 2" "2" "$LAST_CODE"
expect_ok "--timeout '' : те саме повідомлення" \
  output_has "run: --timeout має бути цілим числом секунд"

invoke "" run claude --timeout -5
expect_eq "--timeout -5 (від'ємне): код виходу 2" "2" "$LAST_CODE"
expect_ok "--timeout -5: те саме повідомлення (мінус — не цифра)" \
  output_has "run: --timeout має бути цілим числом секунд"

# ---------------------------------------------------------------------------
# run: невідомий аргумент після провайдера
# ---------------------------------------------------------------------------

invoke "" run claude --bogus-flag
expect_eq "run claude --bogus-flag: код виходу 2" "2" "$LAST_CODE"
expect_ok "run claude --bogus-flag: повідомлення називає невідомий аргумент" \
  output_has "run: невідомий аргумент: --bogus-flag"

# ---------------------------------------------------------------------------
# run: порожній stdin
# ---------------------------------------------------------------------------

invoke "" run claude
expect_eq "run claude з порожнім stdin: код виходу 2" "2" "$LAST_CODE"
expect_ok "run claude з порожнім stdin: повідомлення про порожній промпт" \
  output_has "run: порожній промпт на stdin"

# ---------------------------------------------------------------------------
# без аргументів і --help
# ---------------------------------------------------------------------------

invoke ""
expect_eq "без аргументів: код виходу 2" "2" "$LAST_CODE"
expect_ok "без аргументів: показує usage (\"Використання:\")" \
  output_has "Використання:"

invoke "" --help
expect_eq "--help: код виходу 0" "0" "$LAST_CODE"
expect_ok "--help: показує usage (\"Використання:\")" \
  output_has "Використання:"

# ---------------------------------------------------------------------------
# check: невідомий провайдер — ненульовий код
# ---------------------------------------------------------------------------

invoke "" check bogus-provider
expect_fail "check bogus-provider: код виходу ненульовий" code_is 0
expect_ok "check bogus-provider: повідомлення називає провайдера невідомим" \
  output_has "bogus-provider: невідомий провайдер"

test_summary 18
