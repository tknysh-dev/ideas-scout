#!/usr/bin/env bash
# Локальний запуск дашборда проти бойового Supabase — щоб перевіряти зміни на
# localhost замість пушу і деплою у Vercel.
#
#   ./dev.sh          # next dev на http://localhost:3000 (авторизація вимкнена)
#   ./dev.sh prod     # прод-збірка локально: гейт авторизації увімкнений
#
# Секрети беруться з ~/.config/ideas-scout/env (те саме джерело, що й в агентів),
# тому дублювати SUPABASE_SERVICE_KEY у dashboard/.env.local не треба.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DASHBOARD="$REPO_ROOT/dashboard"
ENV_FILE="${IDEAS_SCOUT_ENV:-$HOME/.config/ideas-scout/env}"
MODE="${1:-dev}"
PORT="${PORT:-3000}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  echo "⚠️  Немає $ENV_FILE — покладаюсь на dashboard/.env.local" >&2
fi

if [[ -z "${SUPABASE_URL:-}" || -z "${SUPABASE_SERVICE_KEY:-}" ]] \
  && ! grep -qs '^SUPABASE_SERVICE_KEY=.' "$DASHBOARD/.env.local"; then
  echo "❌ Немає доступу до Supabase: заповни SUPABASE_URL і SUPABASE_SERVICE_KEY" >&2
  echo "   у $ENV_FILE або в $DASHBOARD/.env.local" >&2
  exit 1
fi

cd "$DASHBOARD"

if [[ ! -d node_modules ]]; then
  echo "→ npm install (перший запуск)"
  npm install
fi

case "$MODE" in
  dev)
    echo "→ dev-режим: http://localhost:$PORT (вхід через GitHub вимкнено, /config — з робочої копії)"
    exec npm run dev -- --port "$PORT"
    ;;
  prod)
    # Прод-збірка потрібна рівно для одного: перевірити те, що в dev не працює —
    # гейт авторизації і поведінку статичного/динамічного рендеру як у Vercel.
    missing=()
    for var in AUTH_SECRET AUTH_GITHUB_ID AUTH_GITHUB_SECRET ALLOWED_GITHUB_LOGIN; do
      [[ -n "${!var:-}" ]] || grep -qs "^$var=." "$DASHBOARD/.env.local" || missing+=("$var")
    done
    if ((${#missing[@]})); then
      echo "⚠️  Не заповнені ${missing[*]} — прод-режим закриє всі сторінки, крім /login." >&2
      echo "   Щоб перевірити вхід локально, заведи окремий GitHub OAuth App із" >&2
      echo "   callback http://localhost:$PORT/api/auth/callback/github і додай ці змінні" >&2
      echo "   у $DASHBOARD/.env.local (AUTH_SECRET — npx auth secret)." >&2
    fi
    # У прод-збірці джерело /config за замовчуванням — GitHub; локально нас
    # цікавить робоча копія, інакше перевіряти нічого.
    export CONFIG_SOURCE="${CONFIG_SOURCE:-local}"
    export CONFIG_LOCAL_ROOT="${CONFIG_LOCAL_ROOT:-$REPO_ROOT}"
    npm run build
    echo "→ прод-режим: http://localhost:$PORT"
    exec npm run start -- --port "$PORT"
    ;;
  *)
    echo "Невідомий режим «$MODE». Доступні: dev, prod" >&2
    exit 1
    ;;
esac
