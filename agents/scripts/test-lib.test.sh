#!/usr/bin/env bash
# shellcheck disable=SC2016
# test-lib.test.sh — харнес тестів перевіряє сам себе.
#
# Курка та яйце: не можна перевіряти expect_*/test_summary їхніми ж власними
# expect_*, бо саме їх ми й тестуємо. Тому кожен сценарій запускає test-lib.sh
# у СВІЖОМУ підпроцесі bash -c (стан не тече між перевірками), а результат
# (stdout+stderr, код виходу) звіряється голим `[ ... ]`/`case` і рахується
# власними, не-харнесними лічильниками нижче.
#
# ПОМІЧЕНО ПРИ РОБОТІ НАД ПОКРИТТЯМ: код усередині `bash -c '...'` (окремий
# exec'нутий процес) для kcov на цій машині завжди невидимий — навіть коли
# тест реально проганяє гілку (_fail, test_summary), kcov показує ці рядки
# як непокриті. Заміна на підстановку команди без bash -c (голий fork) іноді
# робить рядки видимими для kcov ізольовано, але ламається (0 підхоплених
# рядків) щойно у файлі вже визначені звичайні shell-функції (pass/fail/
# assert_contains) — а вони тут потрібні. Тому це не інструментальний
# недолік тестів: bash -c лишається правильним і стабільним вибором для
# ізоляції, а _fail (рядки 16-20) і гілки провалу test_summary (52-53, 56,
# 58) реально виконуються цими тестами, просто kcov на цій машині не вміє
# їх порахувати.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$SCRIPT_DIR/test-lib.sh"
export LIB

RUN=0
FAILED=0

pass() {
  RUN=$((RUN + 1))
  printf '  ok - %s\n' "$1"
}

fail() {
  RUN=$((RUN + 1))
  FAILED=$((FAILED + 1))
  printf '  FAIL - %s\n' "$1"
  [ $# -gt 1 ] && printf '      %s\n' "$2"
}

assert_contains() {
  # assert_contains "опис" "вивід" "підрядок, що має бути присутній"
  case "$2" in
    *"$3"*) pass "$1" ;;
    *) fail "$1" "очікував входження [$3] у [$2]" ;;
  esac
}

assert_eq_lines() {
  # assert_eq_lines "опис" "очікувана_кількість_рядків" "вивід"
  local n
  n="$(printf '%s' "$3" | grep -c '')"
  if [ "$n" -eq "$2" ] 2>/dev/null; then pass "$1"; else fail "$1" "очікував $2 рядок(ів), отримав $n"; fi
}

assert_zero() {
  # assert_zero "опис" "код_виходу"
  if [ "$2" -eq 0 ] 2>/dev/null; then pass "$1"; else fail "$1" "очікував код 0, отримав [$2]"; fi
}

assert_nonzero() {
  # assert_nonzero "опис" "код_виходу"
  if [ "$2" -ne 0 ] 2>/dev/null; then pass "$1"; else fail "$1" "очікував ненульовий код, отримав [$2]"; fi
}

# check_eq_pass "опис" "значення" — expect_eq(значення, значення) має пройти
check_eq_pass() {
  local desc="$1" val="$2" out
  out="$(VAL="$val" bash -c 'source "$LIB"; expect_eq "t" "$VAL" "$VAL"; printf "FAILED=%s\n" "$TESTS_FAILED"' 2>&1)"
  assert_contains "$desc" "$out" "FAILED=0"
}

# check_eq_fail "опис" "a" "b" — expect_eq(a, b) з різними a/b має впасти
check_eq_fail() {
  local desc="$1" a="$2" b="$3" out
  out="$(A="$a" B="$b" bash -c 'source "$LIB"; expect_eq "t" "$A" "$B"; printf "FAILED=%s\n" "$TESTS_FAILED"' 2>&1)"
  assert_contains "$desc" "$out" "FAILED=1"
}

printf '=== expect_ok / expect_fail ===\n'

out="$(bash -c 'source "$LIB"; expect_ok "код 0" true; printf "RUN=%s FAILED=%s\n" "$TESTS_RUN" "$TESTS_FAILED"' 2>&1)"
assert_contains "expect_ok: команда з кодом 0 рахується проходом" "$out" "RUN=1 FAILED=0"
assert_contains "expect_ok: прохід друкує ✔" "$out" "✔"

out="$(bash -c 'source "$LIB"; expect_ok "код 1" false; printf "RUN=%s FAILED=%s\n" "$TESTS_RUN" "$TESTS_FAILED"' 2>&1)"
assert_contains "expect_ok: команда з ненульовим кодом рахується провалом" "$out" "RUN=1 FAILED=1"
assert_contains "expect_ok: провал друкує опис" "$out" "код 1"
assert_contains "expect_ok: провал друкує отриманий код" "$out" "код 0, отримав 1"

out="$(bash -c 'source "$LIB"; expect_ok "немає такої команди" no_such_command_xyz_123; printf "RUN=%s FAILED=%s\n" "$TESTS_RUN" "$TESTS_FAILED"' 2>&1)"
assert_contains "expect_ok: неіснуюча команда — провал, а не обрив скрипту" "$out" "RUN=1 FAILED=1"

out="$(bash -c 'source "$LIB"; expect_ok "команда з аргументами" test -f "$LIB"; printf "RUN=%s FAILED=%s\n" "$TESTS_RUN" "$TESTS_FAILED"' 2>&1)"
assert_contains "expect_ok: команда з кількома аргументами виконується коректно" "$out" "RUN=1 FAILED=0"

out="$(bash -c 'source "$LIB"; expect_fail "очікує нуль, отримав нуль" true; printf "FAILED=%s\n" "$TESTS_FAILED"' 2>&1)"
assert_contains "expect_fail: код 0 — це провал (а не навпаки)" "$out" "FAILED=1"
assert_contains "expect_fail: провал друкує повідомлення про отриманий 0" "$out" "ненульовий код, отримав 0"

out="$(bash -c 'source "$LIB"; expect_fail "очікує нуль, отримав 1" false; printf "FAILED=%s\n" "$TESTS_FAILED"' 2>&1)"
assert_contains "expect_fail: ненульовий код — це прохід" "$out" "FAILED=0"

out="$(bash -c '
  source "$LIB"
  expect_ok "a" true
  expect_ok "b" false
  expect_fail "c" true
  expect_fail "d" false
  printf "RUN=%s FAILED=%s\n" "$TESTS_RUN" "$TESTS_FAILED"
' 2>&1)"
assert_contains "лічильники: 4 виклики, провал одного не скидає RUN, кілька провалів рахуються всі" "$out" "RUN=4 FAILED=2"

out="$(bash -c 'source "$LIB"; expect_ok "a" true; printf "code=%s\n" "$?"' 2>&1)"
assert_contains 'expect_ok/expect_fail самі завжди повертають 0 (безпека йде через TESTS_FAILED+test_summary, не через $?)' "$out" "code=0"

printf '\n=== _fail напряму (без обгортки expect_*) ===\n'

# _fail — внутрішня функція test-lib.sh (не викликається напряму з жодного
# expect_*-тесту з другим аргументом чи без нього одночасно), тому тут явно
# перевіряється обидва варіанти виклику: з деталями і без.
out="$(bash -c 'source "$LIB"; _fail "опис без деталей"' 2>&1)"
assert_contains "_fail: без другого аргументу друкує лише опис" "$out" "✘ опис без деталей"
assert_eq_lines "_fail: без другого аргументу друкує РІВНО один рядок (немає рядка деталей)" 1 "$out"

out="$(bash -c 'source "$LIB"; _fail "опис з деталями" "додаткові деталі провалу"' 2>&1)"
assert_contains "_fail: з другим аргументом друкує опис" "$out" "✘ опис з деталями"
assert_contains "_fail: з другим аргументом друкує деталі окремим рядком" "$out" "додаткові деталі провалу"
assert_eq_lines "_fail: з другим аргументом друкує РІВНО два рядки" 2 "$out"

out="$(bash -c 'source "$LIB"; _fail "рахує провал" >/dev/null; printf "RUN=%s FAILED=%s\n" "$TESTS_RUN" "$TESTS_FAILED"' 2>&1)"
assert_contains "_fail: рахує TESTS_RUN і TESTS_FAILED так само, як через expect_*" "$out" "RUN=1 FAILED=1"

out="$(bash -c 'source "$LIB"; _fail "код завжди 0" >/dev/null; printf "code=%s\n" "$?"' 2>&1)"
assert_contains "_fail: сама завжди повертає 0" "$out" "code=0"

printf '\n=== expect_eq ===\n'

check_eq_pass "expect_eq: однакові прості рядки" "hello"
check_eq_fail "expect_eq: різні прості рядки" "hello" "world"
check_eq_pass "expect_eq: порожні рядки рівні" ""
check_eq_fail "expect_eq: порожній проти непорожнього" "" "x"
check_eq_pass "expect_eq: рядок із внутрішніми пробілами" "a b  c   d"
check_eq_fail "expect_eq: різна кількість пробілів — це різні рядки" "a b" "a  b"
check_eq_pass "expect_eq: кирилиця" "привіт, світ! Це тест."
check_eq_fail "expect_eq: схожа, але різна кирилиця (і проти и)" "привіт" "превіт"
check_eq_pass "expect_eq: рядок-пастка -n рівний сам собі" "-n"
check_eq_pass "expect_eq: рядок-пастка -z рівний сам собі" "-z"
check_eq_pass "expect_eq: рядок-пастка -- рівний сам собі" "--"
check_eq_fail "expect_eq: -n і -z — різні прапорці-пастки" "-n" "-z"
check_eq_pass "expect_eq: багаторядковий рядок рівний сам собі" "$(printf 'рядок1\nрядок2\nрядок3')"
check_eq_fail "expect_eq: багаторядкові рядки різняться другим рядком" \
  "$(printf 'a\nb\nc')" "$(printf 'a\nX\nc')"

out="$(bash -c 'source "$LIB"; expect_eq "мій опис перевірки" "очікую" "маю"' 2>&1)"
assert_contains "expect_eq: провал друкує опис" "$out" "мій опис перевірки"
assert_contains "expect_eq: провал друкує очікуване значення" "$out" "очікував [очікую]"
assert_contains "expect_eq: провал друкує фактичне значення" "$out" "отримав [маю]"

printf '\n=== test_summary ===\n'

out="$(bash -c 'source "$LIB"; expect_ok "a" true; expect_ok "b" true; test_summary 2' 2>&1)"
code=$?
assert_zero "test_summary: 0 провалів і правильна очікувана кількість -> код 0" "$code"

out="$(bash -c 'source "$LIB"; expect_ok "a" true; expect_ok "b" false; test_summary 2' 2>&1)"
code=$?
assert_nonzero "test_summary: є провали -> ненульовий код" "$code"

out="$(bash -c 'source "$LIB"; expect_ok "a" true; test_summary 5' 2>&1)"
code=$?
assert_nonzero "test_summary: фактична кількість МЕНША за очікувану (обрив набору) -> ненульовий код" "$code"
assert_contains "test_summary: обрив стається навіть коли провалених 0" "$out" "0 провалено"
assert_contains "test_summary: повідомлення про обрив пояснює причину" "$out" "набір обірвався"

out="$(bash -c '
  source "$LIB"
  expect_ok "a" true
  expect_ok "b" true
  expect_ok "c" true
  test_summary 2
' 2>&1)"
code=$?
assert_nonzero "test_summary: фактична кількість БІЛЬША за очікувану -> ненульовий код" "$code"
assert_contains "test_summary: повідомлення про перевищення теж пояснює причину (той самий рядок, що й недобіг)" \
  "$out" "набір обірвався"

out="$(bash -c 'source "$LIB"; test_summary' 2>&1)"
code=$?
assert_nonzero "test_summary: виклик без аргументу -> ненульовий код" "$code"
assert_contains "test_summary: без аргументу друкує пояснення" "$out" "викликано без очікуваної кількості"

out="$(bash -c 'source "$LIB"; test_summary ""' 2>&1)"
code=$?
assert_nonzero "test_summary: виклик із порожнім рядком замість кількості -> ненульовий код" "$code"

out="$(bash -c 'source "$LIB"; TEST_NAME="назва-набору"; expect_ok "a" true; test_summary 1' 2>&1)"
assert_contains "test_summary: використовує TEST_NAME у заголовку підсумку" "$out" "назва-набору: 1 тест(ів), 0 провалено"

out="$(bash -c 'source "$LIB"; expect_ok "a" true; test_summary 1' 2>&1)"
assert_contains "test_summary: без TEST_NAME використовує дефолт «тести» у заголовку" "$out" "тести: 1 тест(ів), 0 провалено"

printf '\n%s: %d тест(ів), %d провалено\n' "test-lib.test.sh" "$RUN" "$FAILED"
[ "$FAILED" -eq 0 ]
exit $?
