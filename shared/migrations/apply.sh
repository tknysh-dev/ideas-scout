#!/usr/bin/env bash
# Накат міграції на Supabase через psql.
#
#   shared/migrations/apply.sh shared/migrations/2026-07-30-accepted-status.sql
#
# PostgREST (тобто agents/scripts/db.sh) DDL не виконує — це прямий доступ до
# Postgres. Рядок підключення береться з SUPABASE_DB_URL у ~/.config/ideas-scout/env
# (Supabase → Project Settings → Database → Connection string → URI, з паролем).
set -euo pipefail

MIGRATION="${1:-}"
ENV_FILE="${IDEAS_SCOUT_ENV:-$HOME/.config/ideas-scout/env}"

if [[ -z "$MIGRATION" || ! -f "$MIGRATION" ]]; then
  echo "Вкажи файл міграції: $0 <шлях.sql>" >&2
  exit 2
fi

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  cat >&2 <<MSG
❌ Немає SUPABASE_DB_URL.

Варіант 1 — виконати міграцію руками: Supabase → SQL Editor, вставити вміст
  $MIGRATION і натиснути Run.

Варіант 2 — дати скрипту доступ: Supabase → Project Settings → Database →
  Connection string → URI, і додати рядком у $ENV_FILE:
  SUPABASE_DB_URL=postgresql://postgres.<ref>:<пароль>@<host>:5432/postgres
MSG
  exit 1
fi

# ON_ERROR_STOP: міграції в цьому проєкті обгорнуті в begin/commit, але без цього
# прапорця psql піде далі після провалу окремого стейтменту і закомітить пів-стану.
exec psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$MIGRATION"
