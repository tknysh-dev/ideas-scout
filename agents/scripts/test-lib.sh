# shellcheck shell=bash
# test-lib.sh — мінімальний харнес для тестів на bash.
#
# Призначений лише для source з файлів *.test.sh. Свідомо без залежностей
# (bats тощо): тести мають запускатись на голій машині тією ж командою, що й
# решта перевірок, інакше їх перестануть ганяти.
#
# Кожен тест — один виклик expect_*; наприкінці файл має викликати test_summary,
# який поверне ненульовий код, якщо хоч один тест упав.

TESTS_RUN=0
TESTS_FAILED=0

_pass() { TESTS_RUN=$((TESTS_RUN + 1)); printf '  ✔ %s\n' "$1"; }
_fail() {
  TESTS_RUN=$((TESTS_RUN + 1))
  TESTS_FAILED=$((TESTS_FAILED + 1))
  printf '  ✘ %s\n' "$1"
  [ $# -gt 1 ] && printf '      %s\n' "$2"
  return 0
}

# expect_ok "опис" команда...   — команда має повернути 0
expect_ok() {
  local desc="$1"; shift
  if "$@"; then _pass "$desc"; else _fail "$desc" "очікував код 0, отримав $?"; fi
}

# expect_fail "опис" команда... — команда має повернути НЕ 0
expect_fail() {
  local desc="$1"; shift
  if "$@"; then _fail "$desc" "очікував ненульовий код, отримав 0"; else _pass "$desc"; fi
}

# expect_eq "опис" "очікуване" "фактичне"
expect_eq() {
  if [ "$2" = "$3" ]; then _pass "$1"; else _fail "$1" "очікував [$2], отримав [$3]"; fi
}

# test_summary <очікувана_кількість_тестів>
#
# Кількість обовʼязкова, і це не формальність. Зламана функція може не просто
# провалити тест, а обірвати виконання файлу посередині — тоді решта тестів
# просто не запуститься, а набір відрапортує «0 провалено» і код 0. Саме так
# поводився цей харнес, коли з within_work_window прибрали 10#: 39 тестів
# замість 45 і зелений результат. Звірка з очікуваним числом робить таке
# мовчазне недобігання помилкою.
test_summary() {
  local expected="${1:-}"
  printf '%s: %d тест(ів), %d провалено\n' "${TEST_NAME:-тести}" "$TESTS_RUN" "$TESTS_FAILED"
  if [ -z "$expected" ]; then
    printf '  ✘ test_summary викликано без очікуваної кількості тестів\n'
    return 1
  fi
  if [ "$TESTS_RUN" -ne "$expected" ]; then
    printf '  ✘ виконано %d тест(ів), а очікувалось %d — набір обірвався або тест загубився\n' \
      "$TESTS_RUN" "$expected"
    return 1
  fi
  [ "$TESTS_FAILED" -eq 0 ]
}
