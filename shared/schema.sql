-- Схема Supabase (Postgres) для ideas-scout.
-- Джерело правди для полів: templates/idea.md (frontmatter, schema_version 3),
-- звірено з реальними записами registries/passive-income/ideas/*.md,
-- logs/status/*.json, logs/runs/*.md, inbox/*, logs/triage/*, PLAN.md.
--
-- Enum-подібні поля навмисно НЕ Postgres enum-типи, а CHECK-констрейнти на text —
-- легше додати нове значення (ALTER TABLE ... DROP/ADD CONSTRAINT) без блокування
-- всієї бази на зміну типу, як буває з ALTER TYPE.

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
    status in ('new', 'analyzing', 'rejected', 'approved_pending', 'active', 'parked', 'transferred')
  ),
  rejection_code text check (
    rejection_code in (
      'NO_MONETIZATION', 'SOURCE_SUSPECT', 'LEGAL', 'CAPABILITY_GAP',
      'CAPITAL', 'AUTONOMY', 'SATURATED'
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

alter table ideas
  add constraint ideas_verdict_run_id_fkey
  foreign key (verdict_run_id) references runs(run_id);

-- ============================================================================
-- EVENTS — журнал змін ідеї: заміна секції "## Історія рішень" тіла Markdown-файлу.
-- ============================================================================

create table events (
  id serial primary key,
  idea_id text not null references ideas(id) on delete cascade,
  happened_at timestamptz not null default now(),
  run_id text references runs(run_id),   -- nullable: ручні втручання власника не завжди прив'язані до прогону
  actor text not null,                    -- 'collector' | 'analyst' | 'revisor' | 'triage' | 'owner' тощо (джоб або людина)
  change text not null,                   -- що саме змінилось (напр. "status: parked -> approved_pending")
  reason text                             -- обґрунтування
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
