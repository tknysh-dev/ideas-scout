-- Два коди відмови, які призначає лише власник, і поле під вільну причину для «Інше».
--
-- Досі всі коди в CHECK описували провал критерію чек-листа — їх ставив
-- аналітик або глибоке дослідження. Власнику бракувало способу сказати «ідея
-- валідна, але я нею не займатимусь»: NOT_INTERESTED — саме це, без прив'язки
-- до критеріїв. OTHER — те саме для причини, якої немає в словнику; сама
-- причина йде в rejection_other_reason коротким рядком (портал показує його в
-- дужках поряд із кодом і підказує раніше вжиті значення), тоді як
-- rejection_detail лишається довгим поясненням у хронологію подій.
--
-- Жоден із двох кодів не входить у словник промптів агентів (agents/criteria/*,
-- deep-research.py) — модель їх не призначає й не має підстав.

begin;

alter table ideas drop constraint ideas_rejection_code_check;
alter table ideas add constraint ideas_rejection_code_check check (
  rejection_code in (
    'NO_MONETIZATION', 'SOURCE_SUSPECT', 'LEGAL', 'CAPABILITY_GAP',
    'CAPITAL', 'AUTONOMY', 'SATURATED', 'NO_MARKET',
    'NOT_INTERESTED', 'OTHER'
  )
);

alter table ideas add column if not exists rejection_other_reason text;

comment on column ideas.rejection_other_reason is 'Коротка причина для rejection_code = OTHER; портал збирає з цієї ж колонки список раніше вжитих причин.';

commit;
