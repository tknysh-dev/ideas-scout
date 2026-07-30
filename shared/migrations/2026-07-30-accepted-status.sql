-- Статуси-рішення власника: замість трьох (active / parked / rejected) — два.
-- Система оцінює ідеї, а не веде їхній прогрес: «прийнята» означає лише, що ідея
-- варта уваги і збирач може шукати схожі; чи і коли її реалізують — поза системою.
--
-- Виконати в Supabase → SQL Editor (PostgREST не пропускає DDL).
-- Ідемпотентність: повторний запуск впаде на drop constraint — це навмисно,
-- міграція разова, і мовчазний повтор гірший за явну помилку.

begin;

alter table ideas drop constraint ideas_status_check;

-- active → accepted: рівно те саме рішення власника під новим іменем.
update ideas set status = 'accepted' where status = 'active';

-- parked означало «рішення ще не ухвалене», тож записи повертаються в чергу
-- власника, а не в «прийняті». На момент міграції таких записів немає — рядок
-- лишається на випадок, якщо агент проставить статус між правкою і запуском.
update ideas set status = 'approved_pending' where status = 'parked';

alter table ideas add constraint ideas_status_check check (
  status in ('new', 'analyzing', 'rejected', 'approved_pending', 'accepted', 'transferred')
);

commit;

-- Перевірка після виконання:
--   select status, count(*) from ideas group by status order by 2 desc;
