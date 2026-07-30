# ideas-scout · dashboard

Особистий веб-дашборд власника системи `ideas-scout`. Next.js (App Router,
TypeScript, Tailwind v4), деплой на Vercel. Дані читаються з Supabase виключно
server-side (service key ніколи не потрапляє в клієнтський бандл). Вхід —
GitHub OAuth через Auth.js, обмежений одним GitHub-акаунтом.

Схема БД і словники статусів — `../shared/schema.sql` і `../shared/contracts.md`.

## Локальний запуск

Найпростіше — скриптом з кореня репозиторію: `../dev.sh` (dev) і `../dev.sh prod`
(прод-збірка локально). Він сам підтягує секрети з `~/.config/ideas-scout/env`
і ставить залежності на першому запуску — деталі в кореневому README.

Вручну, якщо потрібен саме npm:

```bash
npm install
cp .env.example .env.local   # заповнити значення
npm run dev
```

Локальний дашборд читає **бойовий** Supabase — той самий, що й прод. Читання
безпечне, але рішення власника на `/decisions` пишуться в ту саму базу.

Сторінка `/config` має два джерела: робочу копію репозиторію (`CONFIG_SOURCE=local`,
типово в dev) і GitHub API гілки `main` (`CONFIG_SOURCE=github`, типово в проді).
Локальне джерело показує ще не закомічені правки критеріїв і промптів і не
потребує `GITHUB_TOKEN`; без токена в режимі `github` сторінка показує пояснення,
які env відсутні, замість падіння.

## Авторизація

Гейт живе у `src/proxy.ts` і закриває всі маршрути, крім `/login` та
`/api/auth/*`. Сесія — JWT у httpOnly-cookie, без таблиць у базі; allow-list
звіряється двічі: у `signIn`-колбеці (`src/auth.ts`) на видачі сесії і в
`src/proxy.ts` на кожному запиті, щоб зміна `ALLOWED_GITHUB_LOGIN` гасила вже
видані сесії одразу. Server action рішень власника перевіряє те саме окремо
(`src/lib/actions/decisions.ts`) — це публічний POST-endpoint, і покладатись на
proxy там не можна.

Рішення власника доступні і для вже ухвалених статусів: панель на картці ідеї
показується для `approved_pending`, `accepted` і `rejected`, тож вердикт
можна переглянути, не чекаючи ревізора. Правила такої зміни (обов'язкова
причина, слід у `events`, обнуління полів відмови) — у `../shared/contracts.md`.

Allow-list звіряється з GitHub **username**, а не email: email у профілі GitHub
може бути приватним і приходити `null`.

Поведінка без заповнених `AUTH_*`:

| | dev | production |
| --- | --- | --- |
| Доступ | пускає всіх, у сайдбарі банер «Авторизація вимкнена (dev)» | закрито все, крім `/login` |
| `/login` | — | перелічує, яких env бракує |

Налаштування OAuth-застосунку: GitHub → Settings → Developer settings → OAuth
Apps; callback URL — `https://<домен>/api/auth/callback/github` (для локальної
перевірки входу потрібен окремий застосунок з `http://localhost:3000/...`).
`AUTH_SECRET` генерується через `npx auth secret`.

Два підводні камені, які вже коштували часу:

- `proxy.ts` мусить лежати в `src/` — на одному рівні з `app/`. У корені
  проєкту Next його не реєструє **без жодної помилки**: збірка проходить, у
  виводі просто немає рядка `ƒ Proxy (Middleware)`, і гейт не виконується.
- `trustHost: true` у `src/auth.ts` обов'язковий: інакше production-збірка
  відкидає кожен запит до `/api/auth/*` як `UntrustedHost`, поки не заданий
  `AUTH_URL`.

## Env-змінні

| Змінна | Призначення |
| --- | --- |
| `SUPABASE_URL` | URL проєкту Supabase — читання даних (server-only) |
| `SUPABASE_SERVICE_KEY` | Service-role ключ Supabase — читання даних (server-only, ніколи не в клієнті) |
| `AUTH_SECRET` | Ключ шифрування сесійного JWT (`npx auth secret`) |
| `AUTH_GITHUB_ID` | Client ID GitHub OAuth-застосунку |
| `AUTH_GITHUB_SECRET` | Client secret GitHub OAuth-застосунку |
| `ALLOWED_GITHUB_LOGIN` | Єдиний GitHub-username, якому дозволено вхід |
| `GITHUB_TOKEN` | Токен з доступом read-only до приватного репозиторію `tknysh-dev/ideas-scout` — для сторінки `/config` у режимі `github` |
| `CONFIG_SOURCE` | Джерело `/config`: `local` (робоча копія) або `github`. Типово: `local` у dev, `github` у проді |
| `CONFIG_LOCAL_ROOT` | Корінь робочої копії для `CONFIG_SOURCE=local`. Типово — батьківська директорія `dashboard/` |

## Структура

- `src/proxy.ts` — гейт авторизації (Next.js 16: `middleware.ts` перейменовано на `proxy.ts`)
- `src/auth.ts` — конфіг Auth.js: GitHub-провайдер, allow-list, сесія в JWT
- `src/app/` — сторінки: дошка (`/`), картка ідеї (`/ideas/[id]`), прогони (`/runs`), вхідні (`/inbox`), конфігурація (`/config`)
- `src/lib/supabase/` — service-клієнт для читання даних
- `src/lib/config-files.ts` — джерело файлів для `/config`: робоча копія або GitHub
- `src/lib/github.ts` — читання файлів репозиторію через GitHub API, кеш ~300с
- `src/lib/status.ts` — людські назви й кольори словників статусів (джерело: `shared/contracts.md`)
