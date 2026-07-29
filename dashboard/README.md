# ideas-scout · dashboard

Особистий веб-дашборд власника системи `ideas-scout`. Next.js (App Router,
TypeScript, Tailwind v4), деплой на Vercel. Дані читаються з Supabase виключно
server-side (service key ніколи не потрапляє в клієнтський бандл). Вхід —
Supabase Auth через magic link, обмежений одним email.

Схема БД і словники статусів — `../shared/schema.sql` і `../shared/contracts.md`.

## Локальний запуск

```bash
npm install
cp .env.example .env.local   # заповнити значення
npm run dev
```

Без `NEXT_PUBLIC_SUPABASE_ANON_KEY` авторизація в dev вимкнена (proxy пропускає
всіх). Без `GITHUB_TOKEN` сторінка `/config` показує пояснення, які env
відсутні, замість падіння.

## Env-змінні

| Змінна | Призначення |
| --- | --- |
| `SUPABASE_URL` | URL проєкту Supabase — читання даних (server-only) |
| `SUPABASE_SERVICE_KEY` | Service-role ключ Supabase — читання даних (server-only, ніколи не в клієнті) |
| `NEXT_PUBLIC_SUPABASE_URL` | URL проєкту Supabase — для Supabase Auth (публічний) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Анонімний ключ Supabase — для Supabase Auth (публічний) |
| `ALLOWED_EMAIL` | Єдиний email, якому дозволено вхід |
| `GITHUB_TOKEN` | Токен з доступом read-only до приватного репозиторію `tknysh-dev/ideas-scout` — для сторінки `/config` |

## Структура

- `proxy.ts` — гейт авторизації (Next.js 16: `middleware.ts` перейменовано на `proxy.ts`)
- `src/app/` — сторінки: дошка (`/`), картка ідеї (`/ideas/[id]`), прогони (`/runs`), вхідні (`/inbox`), конфігурація (`/config`)
- `src/lib/supabase/` — service-клієнт (дані) і SSR/browser-клієнти (авторизація)
- `src/lib/github.ts` — читання файлів репозиторію через GitHub API, кеш ~300с
- `src/lib/status.ts` — людські назви й кольори словників статусів (джерело: `shared/contracts.md`)
