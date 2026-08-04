-- Прибирання значень, що лишились від демонтованого автоматичного конвеєра
-- глибокого дослідження.
--
-- Обидва значення були дозволені заради історичних рядків єдиного прогону
-- старої реалізації (APP-0003). Ті рядки видалено разом із самим прогоном:
-- дослідники на M1, крос-допит DeepSeek-арбітром і окремий етап конкурентів
-- більше не існують, тож і результати їхньої роботи не мають на що спиратись.
-- Після цього CHECK-и лише дозволяли записати те, чого новий код не пише.
--
-- Міграція НЕ видаляє даних: якщо рядки з цими значеннями ще лишились,
-- ALTER впаде на валідації — і це правильна поведінка, бо мовчазна втрата
-- вердиктів гірша за помилку накату.

begin;

alter table criteria_verdicts drop constraint criteria_verdicts_resolution_check;
alter table criteria_verdicts add constraint criteria_verdicts_resolution_check check (
  resolution in ('consensus', 'evidence', 'pessimistic_default')
);

comment on column criteria_verdicts.resolution is
  'consensus = моделі зійшлись; evidence = перемогла сторона з верифікованими джерелами; pessimistic_default = докази не розвʼязали суперечку, взято найгірший вердикт.';

alter table research_reports drop constraint research_reports_stage_check;
alter table research_reports add constraint research_reports_stage_check check (
  stage in ('deep_criteria')
);

commit;
