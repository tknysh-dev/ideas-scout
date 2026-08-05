# shellcheck shell=bash
# runner-lib.sh — чисті функції з runner.sh, винесені для юніт-тестів.
#
# Файл призначений ЛИШЕ для source, не для запуску: без `set -euo pipefail`,
# без виконуваного біта, без коду поза визначеннями функцій — сорсинг сам по
# собі не має жодних побічних ефектів (тест сорсить цей файл і викликає
# функції напряму, без локів/git/мережі, якими живе runner.sh).
#
# Головне правило: нову чисту функцію runner.sh (без побічних ефектів, яку
# можна покрити тестом без нічного прогону) додавай СЮДИ, а не в тіло
# runner.sh.

json_escape() {
  # мінімальне екранування для рядкових полів (лапки, зворотні слеші, переводи рядків)
  printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().rstrip("\n")))' 2>/dev/null \
    || printf '"%s"' "$(printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\n' ' ')"
}

json_array_of_strings() {
  # json_array_of_strings a b c -> ["a","b","c"]; без аргументів -> []
  python3 -c 'import json,sys; print(json.dumps(sys.argv[1:]))' "$@"
}

# ---------------------------------------------------------------------------
# Захист робочих годин: launchd після сну доганяє пропущені розклади вдень —
# такий catch-up конкурує з власником за ліміт підписки. Реальний (не dry-run)
# прогін у робочому вікні пропускається. Overrides: IDEAS_SCOUT_WORK_DAYS
# (дефолт "1,2,3,4,5", 1=понеділок), IDEAS_SCOUT_WORK_HOURS (дефолт
# "09:00-19:00"; значення "none" вимикає захист), IDEAS_SCOUT_IGNORE_WORK_HOURS=1
# — разовий обхід для ручного запуску.
# ---------------------------------------------------------------------------

# within_work_window — чисте ядро (без виклику date), винесене окремо, щоб
# покрити тестом: приймає <dow 1-7> <hh> <mm> <days_csv> <hours_range>
# аргументами замість читання поточного часу. `10#` перед hh/mm і межами
# hours_range — захист від того, що "08"/"09" bash читає як вісімкові.
within_work_window() {
  local dow="$1" hh="$2" mm="$3" days="$4" hours="$5"
  [ "$hours" = "none" ] && return 1
  case ",$days," in
    *,"$dow",*) ;;
    *) return 1 ;;
  esac
  local now_min start end sm em
  now_min=$(( 10#$hh * 60 + 10#$mm ))
  start="${hours%-*}"
  end="${hours#*-}"
  sm=$(( 10#${start%:*} * 60 + 10#${start#*:} ))
  em=$(( 10#${end%:*} * 60 + 10#${end#*:} ))
  # sm > em -> вікно перетинає північ (напр. "19:00-09:00"): усередині, якщо
  # now_min ПІСЛЯ старту АБО ДО кінця (не "і"). sm == em навмисно НЕ отримує
  # окремої гілки: у нижній гілці (>=sm І <em) для рівних меж умова і так
  # завжди хибна (число не буває < самого себе) — вікно нульової довжини,
  # захист вимкнено для цього випадку так само, як і до цього фіксу, а не
  # трактується як цілодобове вікно (типова помилка "старт == кінець" не має
  # мовчки вимикати захист на всю добу в інший спосіб, ніж явний hours=none).
  if [ "$sm" -gt "$em" ]; then
    [ "$now_min" -ge "$sm" ] || [ "$now_min" -lt "$em" ]
  else
    [ "$now_min" -ge "$sm" ] && [ "$now_min" -lt "$em" ]
  fi
}

# in_work_hours — тонка обгортка: бере IDEAS_SCOUT_WORK_DAYS/IDEAS_SCOUT_WORK_HOURS
# і поточний час через date, делегує перевірку в within_work_window.
in_work_hours() {
  local days="${IDEAS_SCOUT_WORK_DAYS:-1,2,3,4,5}"
  local hours="${IDEAS_SCOUT_WORK_HOURS:-09:00-19:00}"
  within_work_window "$(date +%u)" "$(date +%H)" "$(date +%M)" "$days" "$hours"
}

# build_run_id: чиста побудова run_id з готової позначки часу аргументом
# (не викликає date сама) — щоб бути детермінованою й тестованою. Позначку
# часу runner.sh бере через `date +%Y%m%d-%H%M%S` БЕЗ -u (локальний час, не
# UTC) — не змінювати це тут, розсинхрон з UTC-мітками в БД існує, але це
# окреме питання, не цієї функції.
build_run_id() {
  local stamp="$1" provider="$2" track="$3" agent="$4"
  printf '%s-%s-%s-%s' "$stamp" "$provider" "$track" "$agent"
}

# ---------------------------------------------------------------------------
# Guard проти промпт-ін'єкції — ALLOWLIST: комітиться (і взагалі приймається)
# лише те, що агент має право міняти. БУДЬ-ЯКИЙ інший змінений/новий шлях
# (agents/scripts/, agents/prompts/, agents/launchd/, .gitignore, docs/, корінь, .github/ —
# будь-що) відкочується, потрапляє в blocked_paths і дає status=blocked_paths.
# Розбір порцеляну через -z/NUL — шляхи з пробілами та не-ASCII (git-лапки)
# не обходять детекцію.
#
# Фаза 4 (Supabase): ideas/sources/runs/events/inbox тепер пишуться в БД через
# db.sh, не файлами — тому registries/*, logs/runs/*, logs/status/*, logs/triage/*.md
# і вердикт-файли inbox прибрано з allowlist: якщо агент (чи промпт-ін'єкція)
# усе ж спробує писати туди по-старому, це тепер саме та аномалія, яку має
# ловити guard, а не тихо пропускати. inbox/ лишається дозволеним лише тому, що
# туди пише БОТ (вкладення для тріажу) ДО старту прогону — не сам агент.
# logs/triage/*.progress лишається — туди агент-тріаж пише живий прогрес для чату.
# ---------------------------------------------------------------------------

is_allowed_path() {
  # Перевірка ДО case-allowlist: `git status --porcelain -z` віддає лише
  # working-tree-relative шляхи без компонентів ".." і без ведучого "/" —
  # усе, що їх містить, не може бути легітимним porcelain-шляхом. Case-glob
  # нижче робить чисте зіставлення рядка без нормалізації, тож "agents/catalogs/*"
  # як патерн збігається і з "agents/catalogs/../../agents/scripts/runner.sh" —
  # цю дірку треба закрити ДО, а не всередині основного case.
  case "/$1/" in
    */../*) return 1 ;;
  esac
  case "$1" in
    /*) return 1 ;;
  esac
  case "$1" in
    agents/catalogs/*) return 0 ;;
    logs/decisions.md|logs/dedup-decisions.md) return 0 ;;
    # Вкладення ручного подання з Telegram: пише бот ДО старту прогону, не агент.
    inbox/*|inbox) return 0 ;;
    logs/triage/*.progress) return 0 ;;
    agents/criteria/criteria*.md|agents/criteria/search-queries-*.md|agents/criteria/search-queries.md|agents/criteria/taxonomy.md|agents/criteria/availability.md) return 0 ;;
    # Рантайм цього ж прогону (gitignored; тут — belt-and-braces на випадок
    # checkout без оновленого .gitignore): не блокувати самих себе.
    logs/locks/*|logs/launchd/*|logs/quarantine/*) return 0 ;;
    logs/locks|logs/launchd|logs/quarantine) return 0 ;;
    *) return 1 ;;
  esac
}

# ---------------------------------------------------------------------------
# Коміт: staging строго за allowlist (дзеркало is_allowed_path, мінус рантайм).
#
# Фаза 4 (Supabase): ideas/sources/runs/events/inbox — ДАНІ, вони більше не
# комітяться (registries/, logs/runs/, inbox/, logs/triage/ прибрано зі
# staging) — прогони пишуть їх у БД через db.sh. У Git далі комітяться лише
# код і "поведінкові" файли: каталог можливостей і критерії (правила, що їх
# тюнить ревізор/власник), плюс два прозові журнали рішень без власної таблиці
# в схемі (logs/decisions.md, logs/dedup-decisions.md).
# ---------------------------------------------------------------------------

stage_allowed_paths() {
  local p
  for p in agents/catalogs logs/decisions.md logs/dedup-decisions.md \
           agents/criteria/taxonomy.md agents/criteria/availability.md; do
    [ -e "$p" ] && git add -A -- "$p" 2>/dev/null
  done
  for p in agents/criteria/criteria*.md agents/criteria/search-queries*.md; do
    [ -e "$p" ] && git add -A -- "$p" 2>/dev/null
  done
}
