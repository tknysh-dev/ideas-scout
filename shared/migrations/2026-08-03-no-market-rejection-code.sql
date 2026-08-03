-- NO_MARKET у CHECK-констрейнт ideas.rejection_code.
--
-- Критерій 4 треку app-ideas (agents/criteria/criteria-apps.md) призначає код
-- NO_MARKET, але CHECK на колонці його не знав — будь-який запис вердикту з цим
-- кодом (аналітиком чи глибоким дослідженням) падав би на констрейнті. Латентна
-- розбіжність: до першого провалу за критерієм 4 вона просто не стріляла.

begin;

alter table ideas drop constraint ideas_rejection_code_check;
alter table ideas add constraint ideas_rejection_code_check check (
  rejection_code in (
    'NO_MONETIZATION', 'SOURCE_SUSPECT', 'LEGAL', 'CAPABILITY_GAP',
    'CAPITAL', 'AUTONOMY', 'SATURATED', 'NO_MARKET'
  )
);

commit;
