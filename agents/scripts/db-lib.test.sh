#!/usr/bin/env bash
# Юніт-тести чистих функцій db-lib.sh: _urlenc, _json_arg.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_NAME="db-lib"
# shellcheck source=agents/scripts/test-lib.sh
source "$SCRIPT_DIR/test-lib.sh"
# shellcheck source=agents/scripts/db-lib.sh
source "$SCRIPT_DIR/db-lib.sh"

# ---------------------------------------------------------------------------
# _urlenc <value> — межа проти PostgREST query-ін'єкції: значення фільтра має
# піти в один query-параметр, а не підмішати власний "&param=" збоку.
# ---------------------------------------------------------------------------

expect_eq "_urlenc: звичайний рядок без спецсимволів не міняється" \
  "hello" "$(_urlenc "hello")"
expect_eq "_urlenc: пробіли -> %20" \
  "a%20b" "$(_urlenc "a b")"
expect_eq "_urlenc: кирилиця -> percent-encoded UTF-8" \
  "%D0%9F%D1%80%D0%B8%D0%B2%D1%96%D1%82" "$(_urlenc "Привіт")"
expect_eq "_urlenc: порожній рядок" \
  "" "$(_urlenc "")"

# спецсимволи URL/query-рядка
expect_eq "_urlenc: & -> %26" "%26" "$(_urlenc "&")"
expect_eq "_urlenc: = -> %3D" "%3D" "$(_urlenc "=")"
expect_eq "_urlenc: ? -> %3F" "%3F" "$(_urlenc "?")"
expect_eq "_urlenc: # -> %23" "%23" "$(_urlenc "#")"
expect_eq "_urlenc: / -> %2F" "%2F" "$(_urlenc "/")"
expect_eq "_urlenc: + -> %2B" "%2B" "$(_urlenc "+")"
expect_eq "_urlenc: % -> %25 (сам символ екранування теж екранується)" \
  "%25" "$(_urlenc "%")"

# лапки й апострофи
expect_eq "_urlenc: подвійна лапка -> %22" '%22' "$(_urlenc '"')"
expect_eq "_urlenc: апостроф -> %27" '%27' "$(_urlenc "'")"

# найважливіше: значення, яке спробувало б підмішати новий query-параметр
# (аналог SQL-ін'єкції для PostgREST) лишається ОДНИМ безпечним токеном —
# і "&", і "=" всередині нього екрановані, тож "status=eq.<це>" не може
# розпастись на два фільтри.
expect_eq "_urlenc: спроба підмішати &status=eq.approved лишається одним токеном" \
  "x%26status%3Deq.approved" "$(_urlenc "x&status=eq.approved")"
expect_eq "_urlenc: спроба вийти в інший шлях через / та ? лишається одним токеном" \
  "..%2F..%2Fideas%3Fdelete" "$(_urlenc "../../ideas?delete")"

# ---------------------------------------------------------------------------
# _json_arg <arg> — резолвер джерела JSON (літерал / stdin "-" / файл), НЕ
# екранувальник: повертає вміст як є, без json.dumps-подібної обробки.
# ---------------------------------------------------------------------------

expect_eq "_json_arg: звичайне значення повертається як є" \
  '{"a":1}' "$(_json_arg '{"a":1}')"
expect_eq "_json_arg: лапки всередині не чіпаються (очікує вже валідний JSON)" \
  '{"a":"he said \"hi\""}' "$(_json_arg '{"a":"he said \"hi\""}')"
expect_eq "_json_arg: зворотний слеш проходить без змін" \
  '{"a":"x\\y"}' "$(_json_arg '{"a":"x\\y"}')"
expect_eq "_json_arg: кирилиця проходить без змін" \
  '{"a":"Привіт"}' "$(_json_arg '{"a":"Привіт"}')"
expect_eq "_json_arg: порожній рядок -> порожній вивід" \
  "" "$(_json_arg '')"
expect_eq "_json_arg: значення, схоже на вкладений JSON, теж проходить як є" \
  '{"a":{"b":[1,2,3]}}' "$(_json_arg '{"a":{"b":[1,2,3]}}')"

# перевід рядка: аргумент з \n (можливий лише через змінну/підстановку, не
# через прямий CLI-виклик) проходить наскрізь, символи не втрачаються.
expect_eq "_json_arg: перевід рядка в значенні-аргументі лишається" \
  "$(printf 'line1\nline2')" "$(_json_arg "$(printf 'line1\nline2')")"

# arg="-" читає JSON з stdin (heredoc з CLI-агента)
expect_eq "_json_arg: \"-\" читає з stdin" \
  '{"y":3}' "$(printf '%s' '{"y":3}' | _json_arg -)"

# arg — шлях до наявного файлу
DBTEST_TMP="$(mktemp -d)"
printf '%s' '{"x":2}' > "$DBTEST_TMP/payload.json"
expect_eq "_json_arg: шлях до наявного файлу читає його вміст" \
  '{"x":2}' "$(_json_arg "$DBTEST_TMP/payload.json")"

# дефект 21: якщо ЛІТЕРАЛЬНИЙ рядок JSON випадково збігається з іменем
# наявного файлу в поточній директорії, _json_arg МАЄ повернути літерал, а не
# мовчки прочитати чужий файл з диска. Розпізнавання "це JSON" (перший
# непробільний символ { або [) іде ПЕРЕД перевіркою [ -f "$arg" ].
( cd "$DBTEST_TMP" && printf '%s' '{"from":"file"}' > '{"literal":true}' )
expect_eq "_json_arg: збіг літералу з іменем наявного файлу все одно повертає літерал" \
  '{"literal":true}' "$(cd "$DBTEST_TMP" && _json_arg '{"literal":true}')"

rm -rf "$DBTEST_TMP"

test_summary 25
