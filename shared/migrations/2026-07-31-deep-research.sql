-- Глибоке дослідження (мульти-LLM): структуровані вердикти по критеріях,
-- повні звіти моделей і реєстр конкурентів.
--
-- Дотепер вердикти по критеріях існували лише прозою в ideas.body
-- («## Аналіз за критеріями») і відновлювались на дашборді regex-парсером
-- (dashboard/src/lib/criteria.ts). Синтез кількох незалежних моделей потребує
-- машиночитного джерела правди, яке можна порівнювати і перезаписувати —
-- проза в body лишається людською випискою, а не носієм даних.

begin;

create table criteria_verdicts (
  id uuid primary key default gen_random_uuid(),
  idea_id text not null references ideas(id) on delete cascade,
  run_id text references runs(run_id),
  stage text not null check (stage in ('initial', 'deep')),
  kind text not null check (kind in ('model', 'synthesis')),
  provider text not null,          -- 'claude' | 'codex' | 'gemini' | 'deepseek' | … — без CHECK, список провайдерів еволюціонує
  model text,
  -- Критерії базового чеклиста мають ключі '0'..'7' (номери з
  -- agents/criteria/criteria-<track>.md); додаткові блоки глибокого
  -- дослідження — префікс 'd_': 'd_demand', 'd_unit_econ', 'd_channels',
  -- 'd_graveyard', 'd_dependencies', 'd_mvp', 'd_legal'.
  criterion_key text not null,
  verdict text not null check (
    verdict in ('passed', 'failed', 'owner', 'skipped', 'not_applicable', 'noted')
  ),
  score text,                      -- шкали окремих критеріїв: 'B' (довіра до джерела), '4/5' (автономність)
  summary text,                    -- вердикт одним рядком — пігулка на дашборді
  detail text,                     -- обґрунтування прозою
  evidence jsonb not null default '[]'::jsonb,  -- [{url, published_date, quote}]; факти без датованого url синтез не враховує
  resolution text check (
    resolution in ('consensus', 'evidence', 'cross_exam', 'pessimistic_default')
  ),                               -- лише для kind='synthesis': як розвʼязано розбіжність моделей
  criteria_version text,
  created_at timestamptz not null default now(),
  -- Повторний прогін тієї ж стадії перезаписує свої рядки upsert-ом; історія
  -- прогонів лишається в runs/events, а не тут.
  unique (idea_id, stage, kind, provider, criterion_key)
);

comment on column criteria_verdicts.resolution is
  'consensus = моделі зійшлись; evidence = перемогла сторона з верифікованими джерелами; cross_exam = після раунду спростувань; pessimistic_default = докази не розвʼязали суперечку, взято найгірший вердикт.';

create table research_reports (
  id uuid primary key default gen_random_uuid(),
  idea_id text not null references ideas(id) on delete cascade,
  run_id text references runs(run_id),
  stage text not null check (stage in ('deep_criteria', 'competitors')),
  kind text not null check (kind in ('model', 'synthesis')),
  provider text not null,
  model text,
  status text not null default 'ok' check (status in ('ok', 'error', 'timeout', 'skipped')),
  report_md text,                  -- повний Markdown-звіт; runs.meta тримає лише 64 КБ хвоста stdout, тому звіти живуть тут
  created_at timestamptz not null default now(),
  unique (idea_id, stage, kind, provider)
);

create table competitors (
  id uuid primary key default gen_random_uuid(),
  idea_id text not null references ideas(id) on delete cascade,
  run_id text references runs(run_id),
  name text not null,
  url text,
  pricing text,                    -- цінова модель вільним текстом ("$9/міс", "freemium")
  liveness text check (liveness in ('active', 'stale', 'dead')),  -- dead = кладовище ніші; причина смерті — у weaknesses
  last_activity date,              -- остання ознака життя (реліз, пост, оновлення)
  strengths text,
  weaknesses text,
  differentiation text,            -- кут відриву, який реально втримати соло-розробнику
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table ideas
  add column research_depth text not null default 'initial'
    check (research_depth in ('initial', 'deep')),
  add column deep_researched_at timestamptz,
  add column deep_research_run_id text references runs(run_id);

comment on column ideas.research_depth is
  'deep = поля вердикту (rejection_code, confidence, ceiling_estimate, …) перезаписані синтезом глибокого дослідження; структуровані вердикти — у criteria_verdicts.';

create index idx_criteria_verdicts_idea_id on criteria_verdicts(idea_id);
create index idx_research_reports_idea_id on research_reports(idea_id);
create index idx_competitors_idea_id on competitors(idea_id);

alter table criteria_verdicts enable row level security;
alter table research_reports enable row level security;
alter table competitors enable row level security;

create policy criteria_verdicts_full_access on criteria_verdicts
  for all
  to authenticated, service_role
  using (true)
  with check (true);

create policy research_reports_full_access on research_reports
  for all
  to authenticated, service_role
  using (true)
  with check (true);

create policy competitors_full_access on competitors
  for all
  to authenticated, service_role
  using (true)
  with check (true);

commit;
