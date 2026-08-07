#!/usr/bin/env bash
# Накат міграції на Supabase через psql.
#
#   shared/migrations/apply.sh shared/migrations/2026-07-30-accepted-status.sql
#
# PostgREST (тобто agents/scripts/db.sh) DDL не виконує — це прямий доступ до
# Postgres. Рядок підключення береться з SUPABASE_DB_URL у зашифрованому
# .encrypted.env (Supabase → Project Settings → Database → Connection string →
# URI, з паролем); кожен накат вимагає підтвердження Touch ID.
set -euo pipefail

MIGRATION="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPER="$SCRIPT_DIR/psql-apply.sh"
ENCRYPTED_ENV="${IDEAS_SCOUT_ENCRYPTED_ENV:-$SCRIPT_DIR/../../.encrypted.env}"

if [[ -z "$MIGRATION" || ! -f "$MIGRATION" ]]; then
  echo "Вкажи файл міграції: $0 <шлях.sql>" >&2
  exit 2
fi

if ! command -v sops >/dev/null 2>&1; then
  echo "❌ Немає sops: brew install sops age age-plugin-se" >&2
  exit 1
fi

if [[ ! -f "$ENCRYPTED_ENV" ]]; then
  cat >&2 <<MSG
❌ Немає $ENCRYPTED_ENV.

Варіант 1 — виконати міграцію руками: Supabase → SQL Editor, вставити вміст
  $MIGRATION і натиснути Run.

Варіант 2 — завести сховище: Supabase → Project Settings → Database →
  Connection string → URI, і покласти рядком у зашифрований файл:
  sops edit .encrypted.env
  SUPABASE_DB_URL=postgresql://postgres.<ref>:<пароль>@<host>:5432/postgres
MSG
  exit 1
fi

echo "→ Міграція: $MIGRATION"
echo "  sha256:   $(shasum -a 256 "$MIGRATION" | awk '{print $1}')"

# Секрет живе лише в середовищі дочірнього процесу: у argv його не видно
# (розкладання на PG*-змінні — у psql-apply.sh), у файл на диск він не лягає.
sops exec-env "$ENCRYPTED_ENV" \
  "$(printf '%q %q' "$HELPER" "$MIGRATION")"
