-- Історія прогонів глибокого дослідження замість перезапису.
--
-- Дотепер повторна консолідація тієї ж ідеї стирала попередню: unique-ключі
-- (idea_id, stage, kind, provider[, criterion_key]) допускали рівно один рядок
-- на модель, тому і портал, і синтез перед записом робили DELETE. Відколи в
-- research_reports/criteria_verdicts фіксується конкретна модель (колонка
-- model), сенс має саме порівняння прогонів між собою («старіший робила
-- GPT-5.2, новіший — GPT-6») — а порівнювати нема з чим, якщо попередній
-- прогін зникає. У events лишався тільки факт події, без вмісту.
--
-- Тепер старі рядки не видаляються, а позначаються витісненими:
-- superseded_at is null = поточні дані, not null = історія. Уся логіка читання
-- (сторінка ідеї, load_model_reports у синтезі, health у db.sh) фільтрує
-- superseded_at is null; unique-ключі стають ЧАСТКОВИМИ і діють лише на
-- поточних рядках, інакше другий прогін не зміг би записатись поряд з першим.
--
-- Міграція не видаляє й не змінює жодного рядка: наявні дані автоматично
-- лишаються поточними (superseded_at за замовчуванням null), а часткові
-- унікальні індекси на них виконуються — стару унікальність гарантували ті
-- самі колонки.

begin;

alter table criteria_verdicts add column if not exists superseded_at timestamptz;
alter table research_reports  add column if not exists superseded_at timestamptz;
alter table competitors       add column if not exists superseded_at timestamptz;

comment on column criteria_verdicts.superseded_at is
  'null = поточний рядок; заповнено = витіснено пізнішим прогоном, лишається лише як історія для порівняння моделей.';
comment on column research_reports.superseded_at is
  'null = поточний рядок; заповнено = витіснено пізнішим прогоном, лишається лише як історія для порівняння моделей.';
comment on column competitors.superseded_at is
  'null = поточний рядок; заповнено = витіснено пізнішим прогоном, лишається лише як історія для порівняння моделей.';

-- Констрейнти створювались інлайновим `unique (...)` у CREATE TABLE, тож імена
-- їм дав Postgres: criteria_verdicts_idea_id_stage_kind_provider_criterion_key_key
-- і research_reports_idea_id_stage_kind_provider_key. Знімаємо їх за типом, а
-- не за іменем: якщо ім'я в живій базі виявиться іншим, `drop ... if exists`
-- мовчки нічого не зробив би — і повторний прогін падав би на вставці.
do $$
declare
  con record;
begin
  for con in
    select conrelid::regclass as tbl, conname
    from pg_constraint
    where contype = 'u'
      and conrelid in ('criteria_verdicts'::regclass, 'research_reports'::regclass)
  loop
    execute format('alter table %s drop constraint %I', con.tbl, con.conname);
  end loop;
end
$$;

create unique index if not exists uq_criteria_verdicts_current
  on criteria_verdicts (idea_id, stage, kind, provider, criterion_key)
  where superseded_at is null;

create unique index if not exists uq_research_reports_current
  on research_reports (idea_id, stage, kind, provider)
  where superseded_at is null;

-- Читання завжди йде по одній ідеї серед поточних рядків. Для перших двох
-- таблиць це покривають часткові унікальні індекси вище (idea_id — перша
-- колонка); competitors унікального ключа не має, тож потрібен свій.
create index if not exists idx_competitors_current
  on competitors (idea_id)
  where superseded_at is null;

commit;
