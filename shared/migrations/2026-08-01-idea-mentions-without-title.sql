-- Згадка ідеї в тексті — тільки id, без назви поруч (правило в shared/contracts.md).
-- Портал сам знаходить кожен id у будь-якому тексті картки й підставляє назву,
-- статус і опис у пігулку з тултіпом, тож копія назви в самому абзаці дублює
-- те, що видно й так, і розповзається з `title` після перейменування.
--
-- Міграція разова й точкова: на момент написання дублювання назви трапилось у
-- двох місцях бази. Пошук робився повним перебором ideas/events/runs/inbox на
-- збіг `title` поруч зі згадкою id, тому інші тексти чіпати нема чого.
--
-- Виконати: shared/migrations/apply.sh shared/migrations/2026-08-01-idea-mentions-without-title.sql
-- Ідемпотентно: replace() на вже виправленому тексті нічого не знаходить.

begin;

-- PI-0006: назва механіки-батька PI-0001 дублювалась у лапках одразу за id.
update ideas
set body = replace(
  body,
  'Від механіки PI-0001 («Нішевий платний API») відрізняється',
  'Від механіки PI-0001 відрізняється'
)
where id = 'PI-0006';

-- Дайджест прогону аналітика: колонка «назва» прибрана з переліку оброблених
-- записів (формат дайджесту в agents/prompts/analyst.md змінено відповідно).
update runs
set notes = replace(
  replace(
    replace(
      replace(
        replace(
          replace(
            notes,
            'ОБРОБЛЕНІ ЗАПИСИ (id, назва, статус, код, confidence):',
            'ОБРОБЛЕНІ ЗАПИСИ (id, статус, код, confidence):'
          ),
          'PI-0014, Developer tools як freemium SaaS (WakaTime / HTTP Toolkit-тип), rejected',
          'PI-0014, rejected'
        ),
        'PI-0015, Newsletter-платформа як SaaS (Buttondown-тип), rejected',
        'PI-0015, rejected'
      ),
      'PI-0016, Вертикальний SaaS для інді-музикантів (SongBox-тип), rejected',
      'PI-0016, rejected'
    ),
    'PI-0017, Безкоштовний продукт як магніт органічного трафіку, монетизований рекламою на лендингу (нова механіка), rejected',
    'PI-0017 (нова механіка), rejected'
  ),
  'PI-0018, Застосунок за одноразову ліцензію на чужій ОС-платформі (нова механіка), rejected',
  'PI-0018 (нова механіка), rejected'
)
where run_id = '20260730-050004-claude-passive-income-analyst';

-- Окремим стейтментом: рядок PI-0006 у тому ж дайджесті має після назви ще й
-- уточнення в дужках, яке треба зберегти.
update runs
set notes = replace(
  notes,
  'PI-0006, Indie SaaS-продукт (без зміни статусу), approved_pending',
  'PI-0006 (без зміни статусу), approved_pending'
)
where run_id = '20260730-050004-claude-passive-income-analyst';

commit;
