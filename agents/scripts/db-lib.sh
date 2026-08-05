# shellcheck shell=bash
# db-lib.sh — чисті функції з db.sh, винесені для юніт-тестів.
#
# Файл призначений ЛИШЕ для source, не для запуску: без `set -uo pipefail`,
# без виконуваного біта, без коду поза визначеннями функцій — сорсинг сам по
# собі не має жодних побічних ефектів (тест сорсить цей файл і викликає
# функції напряму, без curl/мережі/env, якими живе db.sh).
#
# Головне правило: нову чисту функцію db.sh (без curl, без читання env, без
# запису в базу — яку можна покрити тестом без бойового Supabase) додавай
# СЮДИ, а не в тіло db.sh.

# _json_arg <arg> — повертає JSON-текст: сам рядок, вміст stdin (arg="-"), або
# вміст файлу, якщо arg — шлях до наявного файлу.
_json_arg() {
  local arg="${1:-}"
  if [ "$arg" = "-" ]; then
    cat
  elif [ -f "$arg" ]; then
    cat "$arg"
  else
    printf '%s' "$arg"
  fi
}

_urlenc() {
  python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"
}
