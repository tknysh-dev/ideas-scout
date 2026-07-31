#!/usr/bin/env bash
# install-launchd.sh — рендерить шаблони agents/launchd/*.plist (підставляє __REPO__)
# і встановлює їх у ~/Library/LaunchAgents через launchctl bootstrap.
#
# Використання: install-launchd.sh [--uninstall]
#
# ЦЕЙ СКРИПТ НІЧОГО НЕ РОБИТЬ САМ ПО СОБІ, ПОКИ ЙОГО НЕ ЗАПУСТИТИ ВРУЧНУ.
# Призначений для запуску на M1 (постійний воркер, PLAN.md Фаза 6) — не на
# випадковій робочій машині, інакше джоби намагатимуться виконуватись там,
# де репозиторію/оточення може не бути.

set -uo pipefail

echo "install-launchd.sh: це має виконуватись на M1 (постійний воркер) — переконайся, що ти саме там."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LAUNCHD_SRC_DIR="$REPO_ROOT/agents/launchd"
LAUNCHD_DEST_DIR="$HOME/Library/LaunchAgents"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

UNINSTALL=0
case "${1:-}" in
  --uninstall) UNINSTALL=1 ;;
  "") ;;
  *) echo "Використання: install-launchd.sh [--uninstall]" >&2; exit 2 ;;
esac

UID_NUM="$(id -u)"
DOMAIN="gui/${UID_NUM}"

mkdir -p "$LAUNCHD_DEST_DIR"

shopt -s nullglob
PLISTS=("$LAUNCHD_SRC_DIR"/*.plist)
shopt -u nullglob

if [ "${#PLISTS[@]}" -eq 0 ]; then
  echo "install-launchd.sh: у $LAUNCHD_SRC_DIR немає *.plist" >&2
  exit 1
fi

if [ "$UNINSTALL" -eq 0 ] && { ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; }; then
  echo "install-launchd.sh: для job-worker потрібні node і npm." >&2
  if [ -x /opt/homebrew/bin/brew ]; then
    echo "Встанови: /opt/homebrew/bin/brew install node" >&2
  else
    echo "Встанови Node.js LTS, потім повтори цей скрипт." >&2
  fi
  exit 1
fi

if [ "$UNINSTALL" -eq 0 ] && [ ! -d "$REPO_ROOT/agents/worker/node_modules/@supabase/supabase-js" ]; then
  echo "install-launchd.sh: встановлюю залежності job-worker"
  if ! npm ci --omit=dev --prefix "$REPO_ROOT/agents/worker"; then
    echo "install-launchd.sh: не вдалося встановити залежності job-worker" >&2
    exit 1
  fi
fi

for src in "${PLISTS[@]}"; do
  base="$(basename "$src")"
  label="${base%.plist}"
  dest="$LAUNCHD_DEST_DIR/$base"

  if [ "$UNINSTALL" -eq 1 ]; then
    echo "install-launchd.sh: bootout ${DOMAIN}/${label}"
    launchctl bootout "${DOMAIN}/${label}" 2>/dev/null || echo "  (не було завантажено — ок)"
    rm -f "$dest"
    echo "  видалено $dest"
    continue
  fi

  echo "install-launchd.sh: рендер $base -> $dest"
  sed "s#__REPO__#${REPO_ROOT}#g" "$src" > "$dest"

  if ! plutil -lint "$dest" >/dev/null 2>&1; then
    echo "install-launchd.sh: ПОМИЛКА — $dest не пройшов plutil -lint, не завантажую" >&2
    continue
  fi

  # Уже завантажений — спершу bootout, щоб bootstrap не впав на дублі.
  launchctl bootout "${DOMAIN}/${label}" 2>/dev/null || true
  echo "install-launchd.sh: bootstrap ${DOMAIN} $dest"
  launchctl bootstrap "$DOMAIN" "$dest"
done

if [ "$UNINSTALL" -eq 1 ]; then
  echo "install-launchd.sh: усі джоби ideas-scout знято."
else
  echo "install-launchd.sh: усі джоби ideas-scout встановлено; постійні worker-и запущені."
  echo "Перевірити: launchctl print ${DOMAIN}/com.ideas-scout.passive-income-collector"
fi
