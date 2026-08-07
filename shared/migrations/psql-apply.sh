#!/usr/bin/env bash
# Внутрішній помічник apply.sh — самостійно не запускається: очікує
# SUPABASE_DB_URL у середовищі, куди його кладе `sops exec-env`.
#
# Рядок підключення не передається в psql аргументом навмисно: argv видно
# будь-якому процесу через ps, а от середовище процесу — ні. Тому URL
# розкладається на PG*-змінні, які libpq читає з середовища.
set -euo pipefail

MIGRATION="${1:-}"

if [[ -z "$MIGRATION" || ! -f "$MIGRATION" ]]; then
  echo "psql-apply.sh: вкажи файл міграції" >&2
  exit 2
fi

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "psql-apply.sh: у розшифрованому файлі немає SUPABASE_DB_URL" >&2
  exit 1
fi

# urllib робить percent-decoding (пароль у URI закодований), shlex.quote —
# екранування для eval; писати це на bash значило б зламатись на першому ж
# спецсимволі в паролі.
eval "$(python3 -c '
import os, shlex, urllib.parse as u

p = u.urlparse(os.environ["SUPABASE_DB_URL"])
env = {
    "PGHOST": p.hostname or "",
    "PGPORT": str(p.port or 5432),
    "PGUSER": u.unquote(p.username or ""),
    "PGPASSWORD": u.unquote(p.password or ""),
    "PGDATABASE": (p.path or "").lstrip("/") or "postgres",
}
sslmode = u.parse_qs(p.query).get("sslmode")
if sslmode:
    env["PGSSLMODE"] = sslmode[0]

for name, value in env.items():
    print("export %s=%s" % (name, shlex.quote(value)))
')"

unset SUPABASE_DB_URL

# ON_ERROR_STOP: міграції в цьому проєкті обгорнуті в begin/commit, але без цього
# прапорця psql піде далі після провалу окремого стейтменту і закомітить пів-стану.
# -X: без нього psql виконує ~/.psqlrc — файл поза репозиторієм, який не видно
# в git diff, тобто зручне місце, щоб дописати команду в чужу сесію з паролем.
exec psql -X -v ON_ERROR_STOP=1 -f "$MIGRATION"
