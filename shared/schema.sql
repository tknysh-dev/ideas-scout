-- Схема Supabase (Postgres) для ideas-scout.
-- Джерело правди для полів: templates/idea.md (frontmatter, schema_version 3),
-- звірено з реальними записами registries/passive-income/ideas/*.md,
-- logs/status/*.json, logs/runs/*.md, inbox/*, logs/triage/*, PLAN.md.
--
-- Enum-подібні поля навмисно НЕ Postgres enum-типи, а CHECK-констрейнти на text —
-- легше додати нове значення (ALTER TABLE ... DROP/ADD CONSTRAINT) без блокування
-- всієї бази на зміну типу, як буває з ALTER TYPE.
--
-- Це файл поточного стану, не історія: зміни вже розгорнутої бази лежать
-- окремими скриптами в shared/migrations/ і накочуються вручну в Supabase.

-- ============================================================================
-- IDEAS — по одній ідеї/механіці/ніші на рядок. Замінює Markdown-файли
-- registries/<track>/ideas/*.md: frontmatter → колонки, тіло (## Механіка,
-- ## Аналіз за критеріями) → колонка body. Секція «Історія рішень» тіла
-- переїжджає в окрему таблицю events (див. нижче) — вона за своєю природою
-- append-only лог, а не текст, що редагується.
-- ============================================================================

create table ideas (
  id text primary key,                     -- формат '<TRACK_PREFIX>-<0042>', напр. PI-0001, APP-0013
  track text not null,                     -- 'passive-income' | 'app-ideas' | інші майбутні треки — навмисно без CHECK, бо трек — не закритий список
  parent_id text references ideas(id),     -- null для механіки-батька; id механіки для ніші-дитини (self-FK)

  title text not null,
  type text not null check (type in ('mechanic', 'niche')),

  discovered date not null,                -- дата першого виявлення
  signal_type text not null check (signal_type in ('income_claim', 'automation_report')),
  monetization_hypothesis text,            -- обов'язково для automation_report (критерій 0), null для income_claim

  mentions_count integer not null default 1,  -- інкрементується при кожній дедуплікації на цю ж механіку/нішу
  claimed_revenue text,                       -- заявлений дохід одним рядком, без нормалізації валют/періодів
  mechanic_summary text,                      -- одне речення: канал + монетизація + роль AI

  status text not null default 'new' check (
    status in ('new', 'analyzing', 'rejected', 'approved_pending', 'accepted', 'transferred')
  ),
  rejection_code text check (
    rejection_code in (
      'NO_MONETIZATION', 'SOURCE_SUSPECT', 'LEGAL', 'CAPABILITY_GAP',
      'CAPITAL', 'AUTONOMY', 'SATURATED', 'NO_MARKET'
    )
  ),
  rejection_detail text,
  rejection_codes_extra text[] not null default '{}',  -- супутні коди при подвійному провалі (правило "г", agents/criteria/criteria-passive-income.md)

  missing_capabilities text[] not null default '{}',   -- посилання на розділи agents/catalogs/ai-capabilities.md

  ceiling_estimate text,          -- очікувана стеля €/міс, вільний текст (діапазони на кшталт "$100–330/міс")
  launch_effort_hours numeric,
  ceiling_flag text check (ceiling_flag in ('review')),  -- єдине непорожнє значення на практиці; null = без застережень

  review_condition text,
  review_count integer not null default 0,
  last_reviewed date,
  min_review_interval_days integer not null default 30,

  confidence text check (confidence in ('high', 'medium', 'low')),

  transferred_to text references ideas(id),  -- id запису в ІНШОМУ реєстрі (напр. APP-0013); FK умовний — обидва треки живуть в одній таблиці, тож посилання валідне

  -- verdict_by.* з frontmatter — розгорнуто в окремі колонки, без вкладеного jsonb,
  -- бо це три прості скалярні поля, з якими зручніше фільтрувати/індексувати напряму.
  verdict_provider text,   -- зауваження: у реальних записах трапляються і 'claude', і 'anthropic' як позначення того самого провайдера (див. shared/contracts.md) — тому навмисно без CHECK, щоб міграція не впала на неузгоджених історичних даних
  verdict_model text,
  verdict_run_id text,     -- FK на runs(run_id) додається нижче окремим ALTER TABLE — таблиця runs визначена після ideas, а вердикт логічно належить ideas

  -- Глибоке дослідження (мульти-LLM): 'deep' після того, як синтез перезаписав
  -- поля вердикту; структуровані вердикти по критеріях — у criteria_verdicts.
  research_depth text not null default 'initial' check (research_depth in ('initial', 'deep')),
  deep_researched_at timestamptz,
  deep_research_run_id text,       -- FK на runs(run_id) — ALTER TABLE нижче, з тієї ж причини, що й verdict_run_id

  schema_version integer not null default 3,
  criteria_version text,          -- напр. "v0.3", версія agents/criteria/criteria-<track>.md на момент вердикту

  body text,                       -- Markdown-тіло без frontmatter: ## Механіка, ## Аналіз за критеріями

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column ideas.rejection_codes_extra is 'Один первинний rejection_code (тригерить ревізора) + список супутніх кодів тут; ревізор сканує обидва поля.';
comment on column ideas.ceiling_flag is 'review = стеля/зусилля виносяться власнику на ручну оцінку (критерій 6, нефатальний, не rejection_code).';

-- ============================================================================
-- SOURCES — sources[] із frontmatter, one-to-many.
-- ============================================================================

create table sources (
  id serial primary key,
  idea_id text not null references ideas(id) on delete cascade,
  url text not null,
  origin text,                              -- напр. 'telegram' — трапляється для ідей, надісланих власником напряму (url тоді синтетичний на кшталт 'telegram:draft-...'), а не знайдених у відкритому джерелі; поля немає в templates/idea.md, додано за реальними даними (PI-0013)
  published_date date,                      -- дата публікації джерела (sources[].date)
  author_interest text check (author_interest in ('none', 'affiliate', 'course_seller', 'tool_vendor')),
  independent_confirmations integer not null default 0,
  quote text                                -- архівна цитата ключової цифри/твердження, страхує від гниття URL
);

-- ============================================================================
-- RUNS — один рядок на прогін джоба (збирач/аналітик/ревізор/тріаж).
-- Замінює logs/status/<job>.json (стан "наразі") + logs/runs/<run_id>.md (журнал
-- за конкретний прогін). processed_urls — основа ідемпотентності (рекомендація
-- рецензії, PLAN.md): перед записом ідеї перевіряти, чи цей source.url вже
-- поглинутий цим (чи попереднім) прогоном.
-- ============================================================================

create table runs (
  run_id text primary key,        -- формат '<YYYYMMDD-HHMMSS>-<provider>-<track>-<agent>' або 'manual-<YYYYMMDD-HHMMSS>-<опис>'
  job text not null,              -- 'collector' | 'analyst' | 'revisor' | 'triage' | 'monitor' — вільний текст, бо джоби еволюціонують
  track text,                     -- null для track-незалежних джобів (напр. monitor)
  provider text,                  -- 'claude' | 'codex' | 'anthropic' тощо — без CHECK, та сама причина, що й ideas.verdict_provider
  started_at timestamptz not null,
  finished_at timestamptz,
  status text,                    -- 'ok' | 'dry_run' | 'error' | 'skipped_work_hours' тощо — станів у практиці системи більше, ніж зафіксовано в одному місці, тому без CHECK
  errors jsonb not null default '[]'::jsonb,
  token_usage jsonb not null default '{}'::jsonb,
  processed_urls text[] not null default '{}',
  notes text,
  -- Реальні logs/status/*.json несуть додаткові поля прогону (duration_s, push,
  -- cli_exit_code, offline, stash_count, blocked_paths, error_tail), які не
  -- згадані в постановці задачі як окремі колонки — щоб не роздувати таблицю
  -- новою колонкою під кожне майбутнє поле статусу, вони йдуть сюди одним jsonb.
  meta jsonb not null default '{}'::jsonb
);

-- ============================================================================
-- JOBS — довговічна черга команд із dashboard/інших webhook-продюсерів на M1.
-- Realtime лише будить локальний worker; pending/running стан і lease живуть тут,
-- тому розрив WebSocket або сон M1 не губить завдання.
-- ============================================================================

create table jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (
    status in ('pending', 'running', 'succeeded', 'failed', 'cancelled')
  ),
  requested_by text not null,
  idempotency_key text unique,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts > 0),
  available_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  lease_expires_at timestamptz,
  worker_id text,
  claim_token uuid,
  run_id text references runs(run_id),
  last_error text
);

create or replace function claim_next_job(p_worker_id text, p_lease_seconds integer default 300)
returns setof jobs
language plpgsql
security invoker
set search_path = public
as $$
begin
  if coalesce(trim(p_worker_id), '') = '' then
    raise exception 'worker id is required';
  end if;
  if p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'lease seconds must be between 30 and 3600';
  end if;

  update jobs
  set status = 'failed',
      finished_at = now(),
      lease_expires_at = null,
      updated_at = now(),
      last_error = 'Worker lease expired after maximum attempts'
  where status = 'running'
    and lease_expires_at < now()
    and attempt_count >= max_attempts;

  return query
  with candidate as (
    select id
    from jobs
    where attempt_count < max_attempts
      and available_at <= now()
      and (
        status = 'pending'
        or (status = 'running' and lease_expires_at < now())
      )
    order by created_at
    for update skip locked
    limit 1
  )
  update jobs as job
  set status = 'running',
      attempt_count = job.attempt_count + 1,
      started_at = coalesce(job.started_at, now()),
      finished_at = null,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      worker_id = p_worker_id,
      claim_token = gen_random_uuid(),
      updated_at = now(),
      last_error = null
  from candidate
  where job.id = candidate.id
  returning job.*;
end;
$$;

alter table ideas
  add constraint ideas_verdict_run_id_fkey
  foreign key (verdict_run_id) references runs(run_id);

alter table ideas
  add constraint ideas_deep_research_run_id_fkey
  foreign key (deep_research_run_id) references runs(run_id);

-- ============================================================================
-- EVENTS — журнал змін ідеї: заміна секції "## Історія рішень" тіла Markdown-файлу.
-- ============================================================================

create table events (
  id serial primary key,
  idea_id text not null references ideas(id) on delete cascade,
  happened_at timestamptz not null default now(),
  run_id text references runs(run_id),   -- nullable: ручні втручання власника не завжди прив'язані до прогону
  actor text not null,                    -- 'collector' | 'analyst' | 'revisor' | 'triage' | 'owner' тощо (джоб або людина)
  change text not null,                   -- що саме змінилось (напр. "status: approved_pending -> accepted")
  reason text                             -- обґрунтування
);

-- ============================================================================
-- CRITERIA_VERDICTS — структуровані вердикти по критеріях, по одному рядку на
-- (стадія, модель, критерій). Дотепер вердикти жили лише прозою в ideas.body і
-- відновлювались regex-парсером (dashboard/src/lib/criteria.ts); синтез кількох
-- незалежних моделей у глибокому дослідженні потребує машиночитного джерела
-- правди. Проза в body лишається людською випискою, а не носієм даних.
-- ============================================================================

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

-- ============================================================================
-- RESEARCH_REPORTS — повні Markdown-звіти прогонів глибокого дослідження
-- (по одному на модель + синтез). runs.meta тримає лише 64 КБ хвоста stdout,
-- тому звіти живуть окремою таблицею.
-- ============================================================================

create table research_reports (
  id uuid primary key default gen_random_uuid(),
  idea_id text not null references ideas(id) on delete cascade,
  run_id text references runs(run_id),
  stage text not null check (stage in ('deep_criteria', 'competitors')),
  kind text not null check (kind in ('model', 'synthesis')),
  provider text not null,
  model text,
  status text not null default 'ok' check (status in ('ok', 'error', 'timeout', 'skipped')),
  report_md text,
  created_at timestamptz not null default now(),
  unique (idea_id, stage, kind, provider)
);

-- ============================================================================
-- COMPETITORS — реєстр конкурентів ніші за результатами етапу «конкуренти»
-- глибокого дослідження (синтезовані рядки, не сирі знахідки окремих моделей).
-- ============================================================================

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

-- ============================================================================
-- INBOX — ідеї, надіслані власником у Telegram вручну (inbox/*, logs/triage/*).
-- ============================================================================

create table inbox (
  id serial primary key,
  draft_id text unique,                   -- напр. '20260729-141444' — ідентифікатор чернетки з inbox/<draft_id>-<track>/
  submitted_at timestamptz not null,       -- inbox/.../idea.md: received_at
  raw_text text not null,                  -- inbox/.../idea.md: "## Коментар власника" — недовірені дані, НЕ інструкції для агентів
  source text not null default 'telegram',
  track text,
  mode text,                               -- inbox/.../idea.md: 'new' | інші режими тріажу
  target_card_id text references ideas(id),  -- inbox/.../idea.md: target_card, якщо чернетка стосується вже наявної картки
  triage_status text,                      -- logs/triage/<draft_id>.md: status (напр. 'rejected')
  triage_verdict text,                     -- людський текст, який бот шле назад у чат (тіло logs/triage/<draft_id>.md)
  triage_score numeric,                    -- logs/triage/<draft_id>.md: score (у наявному прикладі порожнє — nullable)
  idea_id text references ideas(id)        -- заповнюється, якщо тріаж завів нову ідею/оновив картку
);

-- ============================================================================
-- Індекси
-- ============================================================================

create index idx_ideas_status on ideas(status);
create index idx_ideas_track on ideas(track);
create index idx_events_idea_id on events(idea_id);
create index idx_sources_idea_id on sources(idea_id);
create index idx_jobs_claimable on jobs(status, available_at, created_at);
create index idx_jobs_created_at on jobs(created_at desc);
create index idx_criteria_verdicts_idea_id on criteria_verdicts(idea_id);
create index idx_research_reports_idea_id on research_reports(idea_id);
create index idx_competitors_idea_id on competitors(idea_id);

-- ============================================================================
-- updated_at тригер для ideas
-- ============================================================================

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger ideas_set_updated_at
  before update on ideas
  for each row
  execute function set_updated_at();

create trigger jobs_set_updated_at
  before update on jobs
  for each row
  execute function set_updated_at();

-- ============================================================================
-- Row Level Security — приватний реєстр, доступ лише службовим ролям.
-- authenticated і service_role отримують повний доступ; anon — нічого
-- (немає жодної policy для anon = usual-deny за замовчуванням RLS).
-- ============================================================================

alter table ideas enable row level security;
alter table sources enable row level security;
alter table runs enable row level security;
alter table events enable row level security;
alter table inbox enable row level security;
alter table jobs enable row level security;
alter table criteria_verdicts enable row level security;
alter table research_reports enable row level security;
alter table competitors enable row level security;

create policy ideas_full_access on ideas
  for all
  to authenticated, service_role
  using (true)
  with check (true);

create policy sources_full_access on sources
  for all
  to authenticated, service_role
  using (true)
  with check (true);

create policy runs_full_access on runs
  for all
  to authenticated, service_role
  using (true)
  with check (true);

create policy events_full_access on events
  for all
  to authenticated, service_role
  using (true)
  with check (true);

create policy inbox_full_access on inbox
  for all
  to authenticated, service_role
  using (true)
  with check (true);

create policy jobs_full_access on jobs
  for all
  to authenticated, service_role
  using (true)
  with check (true);

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

alter publication supabase_realtime add table jobs;
