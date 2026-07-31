# ideas-scout

Багатоагентна система автономного пошуку та оцінки можливостей заробітку: моніторить джерела в інтернеті, знаходить ідеї пасивного доходу та (окремим треком) ідеї мобільних застосунків, дедуплікує їх, аналізує за формалізованими критеріями і веде реєстр рішень з умовами повторного перегляду.

Повний план системи — у [`PLAN.md`](./PLAN.md), включно з розділом «Рекомендації рецензії», що коригує структуру нижче.

## Структура репозиторію

**Фаза 4 завершена: дані (ideas/sources/runs/events/inbox) живуть у Supabase (Postgres), не в Git.** Репозиторій далі тримає код, конфігурацію й «поведінкові» файли (критерії, каталог можливостей, журнали рішень без власної таблиці) — `agents/` виконується на M1, `dashboard/` — веб-дашборд, `shared/` — контракти БД, спільні для обох.

```
agents/
  catalogs/
    ai-capabilities.md        # актуальні можливості AI-провайдерів (веде агент-ревізор)
  criteria/
    criteria-passive-income.md # версіонований чек-лист оцінки для треку доходу
    criteria-apps.md            # чек-лист оцінки для треку застосунків (заглушка)
    availability.md              # ручний сигнал власника: скільки часу/тиждень готовий інвестувати
    taxonomy.md                  # платформний drill-down (трек passive-income)
    search-queries.md            # пакети пошукових запитів
  prompts/                     # провайдер-нейтральні промпти агентів (пишуть у БД через db.sh)
  scripts/                     # спільні скрипти прогонів, параметризовані треком і провайдером
    db.sh                       # доступ до Supabase з bash (runner.sh/monitor.sh; CLI-агенти — Bash(agents/scripts/db.sh:*))
    db.py                       # те саме для одноразового Telegram webhook-handler-а
    migrate-to-db.sh            # разовий скрипт міграції Git→Supabase (вже відпрацьований)
    runner.sh                   # єдина точка запуску одного прогону агента
    monitor.sh                  # щоденний дайджест у Telegram
    telegram-bot.py             # одноразова обробка Telegram update/nudge на M1
    configure-telegram-webhook.py # реєстрація Vercel webhook у Telegram
    job-worker.sh               # Supabase Realtime → дозволений локальний скрипт
    infrastructure-dry-run.sh   # 10-секундний тест наскрізного виконання
  worker/                       # окремий Node runtime постійного M1-worker-а
  launchd/                     # шаблони launchd-плістів (рендеряться install-launchd.sh)
dashboard/                     # веб-дашборд, читає Supabase напряму; вхід — GitHub OAuth (Auth.js)
shared/                        # спільні контракти БД для agents/ і dashboard/
  schema.sql                    # DDL: ideas, sources, runs, events, inbox, jobs
  contracts.md                  # людський опис полів/статусів/кодів — що означає кожна колонка
templates/
  idea.md                       # історичний шаблон запису ідеї (frontmatter) — джерело стилю тіла (body), формат уже не файловий
dev.sh                           # локальний запуск дашборда проти того самого Supabase
PLAN.md                          # повний план системи
```

`registries/`, `logs/runs/`, `logs/status/`, `inbox/`, `logs/triage/` лишаються на диску як **історичний слід і рантайм-кеш**, а не джерело правди:
- `registries/*/ideas/*.md`, `logs/runs/*.md`, `logs/status/*.json`, `inbox/*/idea.md`, `logs/triage/*.md` — це стан ДО міграції (перенесений у Supabase скриптом `agents/scripts/migrate-to-db.sh`); прогони більше їх не пишуть і не читають. Директорії свідомо не видалені — власник звірить дашборд і прибере їх окремо.
- `inbox/<draft_id>-<track>/` далі отримує вкладення (скріншоти, збережений текст сторінок) від `telegram-bot.py` — для бінарних файлів немає колонки в БД, агент-тріаж читає їх з диска; сам текст чернетки й вердикт живуть у таблиці `inbox`.
- `logs/triage/<draft_id>.progress` — живий прогрес-індикатор для чату під час прогону тріажу (рантайм, не дані).
- `logs/decisions.md`, `logs/dedup-decisions.md` — прозові журнали рішень без власної таблиці в схемі; і далі комітяться в Git.

## Локальний запуск дашборда

Щоб перевіряти зміни до пушу й деплою у Vercel, дашборд піднімається на
localhost і дивиться в **той самий Supabase**, що й прод — окремої локальної бази
немає, і дані на екрані бойові:

```bash
./dev.sh          # http://localhost:3000, гаряче перезавантаження
./dev.sh prod     # прод-збірка локально: увімкнений гейт авторизації
PORT=3100 ./dev.sh
```

Скрипт бере `SUPABASE_URL` і `SUPABASE_SERVICE_KEY` з `~/.config/ideas-scout/env`
— з того самого файлу, що й агенти, тому ключ не доводиться дублювати в
`dashboard/.env.local`; якщо файла немає, скрипт мовчки покладається на
`.env.local` і зупиняється з поясненням, коли ключів немає ніде. Залежності
ставляться самі на першому запуску.

Чим два режими відрізняються:

- **dev** — авторизація вимкнена (у сайдбарі банер «Авторизація вимкнена (dev)»),
  сторінка `/config` читає **робочу копію** репозиторію, тож незакомічені правки
  критеріїв і промптів видно одразу. Це режим на кожен день.
- **prod** — повна збірка (`next build && next start`): вмикається гейт
  авторизації і той самий рендер, що у Vercel. Потрібен, коли зміна стосується
  входу або кешування сторінок. Без заповнених `AUTH_*` гейт закриє все, крім
  `/login` (як і в проді), тому для перевірки входу заведи окремий GitHub OAuth
  App із callback `http://localhost:3000/api/auth/callback/github` і додай
  `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `ALLOWED_GITHUB_LOGIN` у
  `dashboard/.env.local`. Скрипт попереджає, якщо їх немає.

Що варто пам'ятати: читання з бази безпечне, але рішення власника на
`/decisions` (активувати / відкласти / відхилити) пишуться в бойову таблицю
`ideas` і додають запис у `events` — локальний запуск не пісочниця.

## Примітки

1. Доступ до БД — лише через `agents/scripts/db.sh` (bash) або `agents/scripts/db.py` (python), обидва читають `~/.config/ideas-scout/env` (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`) і говорять з PostgREST. CLI-агентам (`claude -p` у `runner.sh`) дають доступ рівно до одного скрипта — `Bash(agents/scripts/db.sh:*)` — жодного іншого Bash/curl/git; це звужена, але еквівалентна за суттю версія попереднього інваріанту «агент без Bash узагалі» (детальніше — коментар у `runner.sh`).
2. `runner.sh`/`monitor.sh` більше не комітять дані (`registries/`, `logs/runs/`, `logs/status/`, `inbox/`, вердикти `logs/triage/`) — лише код і поведінкові файли (`agents/catalogs/`, `agents/criteria/*`, `logs/decisions.md`, `logs/dedup-decisions.md`). Реєстрація прогону і статус — записи в таблиці `runs` через `db.sh register-run-start`/`register-run-finish`; ідемпотентність збирача — `db.sh check-url-processed`/`check-url-in-sources`.
3. Секрети (Telegram-токен і webhook secret, API-ключі, `SUPABASE_SERVICE_KEY`, `AUTH_SECRET`/`AUTH_GITHUB_SECRET` дашборда) у репозиторії **заборонені** — зберігати поза Git (Keychain / `~/.config/ideas-scout/env` / Vercel Environment Variables), недосяжними для агента.
