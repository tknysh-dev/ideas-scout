#!/usr/bin/env bash
# Тести оркестрації doctor.sh: як секції складаються у звіт і в код виходу.
#
# doctor-lib.sh (78 тестів у doctor-lib.test.sh) покриває чисті функції
# класифікації. Не покрито було саме те, що визначає, чи власник побачить
# проблему: підрахунок OK_COUNT/WARN_COUNT/ERR_COUNT і мапінг у код виходу —
# ця логіка живе не у функціях, а прямо в тілі doctor.sh (лічильники,
# ok()/warn()/err()/note()/hint(), фінальний блок), тому в doctor-lib.sh
# її виносити нема куди.
#
# Два підходи в цьому файлі:
#   1. Реальний прогін `doctor.sh --offline` (лише читає, мережі нема) і
#      перевірка контракту звіту на його фактичному виводі.
#   2. Ізоляція лічильно-підсумкового блоку: витягуємо ЖИВИЙ текст цього
#      блоку з doctor.sh (за унікальними маркерами, не копію) і сорсимо
#      його в підоболонці з довільними OK/WARN/ERR_COUNT — так перевіряється
#      справжній поточний код, а не його дублікат, що міг розійтись.
#
# НЕ запускати: doctor.sh без --offline, з --llm/--websearch (мережа,
# ліміт підписки) чи --baseline-clamshell (пише файл).
#
# SC2016 вимкнено на весь файл: тут скрізь ідіома `bash -c 'тіло' _ "$арг"`,
# де $1..$N усередині одинарних лапок МАЮТЬ лишитись нерозгорнутими — їх
# підставляє дочірня оболонка з позиційних аргументів. Це і є спосіб передати
# значення в підоболонку, не проходячи через розкриття в батьківській.
# SC2030/SC2031 — про змінні в підоболонці, що тут навмисне: кожен сценарій
# ізольований саме тим, що його стан не тече назовні.
# shellcheck disable=SC2016,SC2030,SC2031
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_NAME="doctor-report"
# shellcheck source=agents/scripts/test-lib.sh
source "$SCRIPT_DIR/test-lib.sh"

DOCTOR_SH="$SCRIPT_DIR/doctor.sh"

# ---------------------------------------------------------------------------
# ./doctor.sh --offline — контракт звіту на реальному прогоні
# ---------------------------------------------------------------------------

OFFLINE_OUT="$("$DOCTOR_SH" --offline 2>&1)"
OFFLINE_EXIT=$?

expect_ok "doctor.sh --offline: завершується одним із задокументованих кодів 0/1/2" \
  bash -c 'case "$1" in 0|1|2) exit 0 ;; *) exit 1 ;; esac' _ "$OFFLINE_EXIT"

# Рядки статусів мають фіксований формат "  <символ>  повідомлення" — саме
# так друкують ok()/warn()/err()/note(). Підсумкова й закриваюча прози
# ("Є проблеми...", "Критичного нічого...") теж містять ✘/▲ у тексті, але
# без цього префікса, тому в підрахунок не потрапляють.
OK_LINES=$(printf '%s\n' "$OFFLINE_OUT" | grep -c '^  ✔  ')
WARN_LINES=$(printf '%s\n' "$OFFLINE_OUT" | grep -c '^  ▲  ')
ERR_LINES=$(printf '%s\n' "$OFFLINE_OUT" | grep -c '^  ✘  ')
NOTE_LINES=$(printf '%s\n' "$OFFLINE_OUT" | grep -c '^  ·  ')

SUMMARY_LINE="$(printf '%s\n' "$OFFLINE_OUT" | grep -E '^ +[0-9]+ ок +· +[0-9]+ попереджень +· +[0-9]+ проблем$')"
expect_ok "підсумковий рядок присутній і має форму «N ок · N попереджень · N проблем»" \
  bash -c '[ -n "$1" ]' _ "$SUMMARY_LINE"

read -r SUM_OK SUM_WARN SUM_ERR <<EOF
$(printf '%s\n' "$SUMMARY_LINE" | grep -oE '[0-9]+' | tr '\n' ' ')
EOF

expect_eq "підсумкове число ✔ у звіті збігається з фактичною кількістю рядків ✔" \
  "$OK_LINES" "${SUM_OK:-?}"
expect_eq "підсумкове число ▲ у звіті збігається з фактичною кількістю рядків ▲" \
  "$WARN_LINES" "${SUM_WARN:-?}"
expect_eq "підсумкове число ✘ у звіті збігається з фактичною кількістю рядків ✘" \
  "$ERR_LINES" "${SUM_ERR:-?}"

expect_ok "рядки з якимось статусом справді є (✔+▲+✘+· > 0) — секції не мовчать" \
  bash -c '[ "$(($1 + $2 + $3 + $4))" -gt 0 ]' _ "$OK_LINES" "$WARN_LINES" "$ERR_LINES" "$NOTE_LINES"

# Код виходу — саме те, від чого залежить, чи власник помітить проблему:
# помилка в цьому мапінгу дасть зелений код виходу при зламаній системі.
if [ "$ERR_LINES" -gt 0 ]; then
  expect_eq "є ✘ у виводі -> код виходу 2 (документований контракт AGENTS.md)" \
    "2" "$OFFLINE_EXIT"
elif [ "$WARN_LINES" -gt 0 ]; then
  expect_eq "нема ✘, є ▲ -> код виходу 1" \
    "1" "$OFFLINE_EXIT"
else
  expect_eq "нема ні ✘, ні ▲ -> код виходу 0" \
    "0" "$OFFLINE_EXIT"
fi

# Секції doctor.sh — усі мають реально дійти до друку заголовка при --offline;
# список береться з живих викликів section "..." у самому doctor.sh, а не
# дублюється тут руками, щоб нова секція автоматично потрапила під перевірку.
SECTION_TITLES="$(grep -oE 'section "[^"]+"' "$DOCTOR_SH" | sed -E 's/^section "(.*)"$/\1/')"
SECTION_COUNT=0
while IFS= read -r title; do
  [ -z "$title" ] && continue
  SECTION_COUNT=$((SECTION_COUNT + 1))
  expect_ok "секція «${title}» зʼявляється у виводі --offline" \
    bash -c 'printf "%s\n" "$1" | grep -qF "$2"' _ "$OFFLINE_OUT" "$title"
done <<EOF
$SECTION_TITLES
EOF

expect_eq "усього секцій у doctor.sh — 12 (якщо зʼявилась нова, онови це число свідомо)" \
  "12" "$SECTION_COUNT"

# ---------------------------------------------------------------------------
# ./doctor.sh --help і невідомий аргумент
# ---------------------------------------------------------------------------

HELP_OUT="$("$DOCTOR_SH" --help 2>&1)"
expect_eq "doctor.sh --help: код виходу 0" "0" "$?"
expect_ok "doctor.sh --help: вивід містить «Використання»" \
  bash -c 'printf "%s" "$1" | grep -qF "Використання"' _ "$HELP_OUT"

BOGUS_OUT="$("$DOCTOR_SH" --totally-unknown-flag 2>&1)"
BOGUS_EXIT=$?
expect_eq "doctor.sh --totally-unknown-flag: код виходу 2 (як помилка аргументів)" \
  "2" "$BOGUS_EXIT"
expect_ok "doctor.sh з невідомим аргументом: повідомлення називає причину" \
  bash -c 'printf "%s" "$1" | grep -qF "невідомий аргумент"' _ "$BOGUS_OUT"

# ---------------------------------------------------------------------------
# Ізольований лічильно-підсумковий блок doctor.sh (сорсинг у підоболонці)
# ---------------------------------------------------------------------------
#
# Витягуємо за унікальними маркерами:
#   - "лічильний" фрагмент: OK_COUNT=0 ... визначення hint() — лічильники,
#     колірна гілка, функції ok/warn/err/note/hint;
#   - "підсумковий" фрагмент: від друку "Підсумок" до кінця файлу (exit 0/1/2).
# Якщо doctor.sh переписали так, що маркери зникли — тест падає з поясненням,
# а не мовчки пропускає перевірку.

COUNT_START="$(grep -n '^OK_COUNT=0$' "$DOCTOR_SH" | head -1 | cut -d: -f1)"
COUNT_END="$(grep -n '^hint() {' "$DOCTOR_SH" | head -1 | cut -d: -f1)"
SUMMARY_START="$(grep -n '"Підсумок"' "$DOCTOR_SH" | head -1 | cut -d: -f1)"

if [ -z "$COUNT_START" ] || [ -z "$COUNT_END" ] || [ -z "$SUMMARY_START" ]; then
  _fail "витяг лічильно-підсумкового блоку з doctor.sh" \
    "маркери (^OK_COUNT=0\$ / ^hint() { / \"Підсумок\") не знайдено — doctor.sh змінився, онови маркери тесту"
  # Решта секції спирається на успішний витяг — далі валити її сенсу нема.
  test_summary 37
  exit $?
fi

ISOLATE_DIR="$(mktemp -d)"
trap 'rm -rf "$ISOLATE_DIR"' EXIT

sed -n "${COUNT_START},${COUNT_END}p" "$DOCTOR_SH" > "$ISOLATE_DIR/counting.sh"
sed -n "${SUMMARY_START},\$p" "$DOCTOR_SH" > "$ISOLATE_DIR/summary.sh"

# run_summary <ok> <warn> <err> — сорсить справжній лічильно-підсумковий код
# doctor.sh у підоболонці з підставленими лічильниками; друкує підсумок,
# повертає код виходу doctor.sh для цієї комбінації.
run_summary() {
  (
    # shellcheck source=/dev/null
    source "$ISOLATE_DIR/counting.sh"
    OK_COUNT="$1"; WARN_COUNT="$2"; ERR_COUNT="$3"
    # shellcheck source=/dev/null
    source "$ISOLATE_DIR/summary.sh"
  )
}

CASE_OUT="$(run_summary 5 0 0)"
expect_eq "ізольовано: ok=5 warn=0 err=0 -> код виходу 0" "0" "$?"
expect_ok "ізольовано: ok=5 warn=0 err=0 -> текст «Усе в нормі»" \
  bash -c 'printf "%s" "$1" | grep -qF "Усе в нормі"' _ "$CASE_OUT"

CASE_OUT="$(run_summary 5 2 0)"
expect_eq "ізольовано: ok=5 warn=2 err=0 -> код виходу 1" "1" "$?"
expect_ok "ізольовано: ok=5 warn=2 err=0 -> текст «Критичного нічого»" \
  bash -c 'printf "%s" "$1" | grep -qF "Критичного нічого"' _ "$CASE_OUT"

CASE_OUT="$(run_summary 0 0 1)"
expect_eq "ізольовано: ok=0 warn=0 err=1 -> код виходу 2" "2" "$?"
expect_ok "ізольовано: ok=0 warn=0 err=1 -> текст «Є проблеми»" \
  bash -c 'printf "%s" "$1" | grep -qF "Є проблеми"' _ "$CASE_OUT"

run_summary 3 4 2 >/dev/null
expect_eq "ізольовано: err>0 і warn>0 одночасно -> перемагає err (код 2, не 1)" \
  "2" "$?"

run_summary 0 0 0 >/dev/null
expect_eq "ізольовано: усі нулі -> код виходу 0 (не помилка порожньої черги)" \
  "0" "$?"

CASE_OUT="$(run_summary 7 3 1)"
expect_ok "ізольовано: підсумковий рядок містить точні числа з підстановки (7/3/1)" \
  bash -c 'printf "%s" "$1" | grep -qE "7 ок .* 3 попереджень .* 1 проблем"' _ "$CASE_OUT"

# Самі ok()/warn()/err()/note() у відриві від doctor.sh: рахують і друкують
# правильний символ, note() лічильники не чіпає.
FN_OUT="$(
  # Файл створюється тут же, під час прогону — вирізається з живого doctor.sh,
  # тож статично його не існує і прочитати нема чого.
  # shellcheck disable=SC1091
  source "$ISOLATE_DIR/counting.sh"
  ok "перший"; ok "другий"; warn "третій"; err "четвертий"; note "пʼятий"
  printf 'COUNTS %d %d %d\n' "$OK_COUNT" "$WARN_COUNT" "$ERR_COUNT"
)"
expect_eq "ізольовано: два ok()+один warn()+один err() -> лічильники 2/1/1" \
  "COUNTS 2 1 1" "$(printf '%s\n' "$FN_OUT" | grep '^COUNTS ')"
expect_ok "ізольовано: ok() друкує рядок із ✔ і текстом повідомлення" \
  bash -c 'printf "%s\n" "$1" | grep -qF "  ✔  перший"' _ "$FN_OUT"
expect_ok "ізольовано: err() друкує рядок із ✘ і текстом повідомлення" \
  bash -c 'printf "%s\n" "$1" | grep -qF "  ✘  четвертий"' _ "$FN_OUT"
expect_ok "ізольовано: note() друкує рядок із · і НЕ рахується в жоден лічильник" \
  bash -c 'printf "%s\n" "$1" | grep -qF "  ·  пʼятий"' _ "$FN_OUT"

test_summary 37
