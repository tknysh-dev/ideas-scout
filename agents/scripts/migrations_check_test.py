"""migrations_check_test.py — тести для migrations_check.py.

migrations_check.py, на відміну від doctor_prompt_contract.py, не виконує
роботу на рівні модуля: `run()` — чиста функція від файлової системи
(REPO_ROOT), а `check_schema_drift`/`check_filenames`/`check_idempotency`/
`scan_unrecognized`/`extract_value_checks` — чисті функції від переданого
тексту. Тому основна маса тестів нижче працює на синтетичних SQL-рядках, без
жодного диска чи мережі; лише RealRepositoryTest торкається реальних
shared/migrations/*.sql і shared/schema.sql — це навмисно (задача explicitly
просить перевірити, що на справжніх файлах репозиторію все чисто).
"""

from __future__ import annotations

import contextlib
import io
import os
import tempfile
import unittest
from unittest import mock

import migrations_check as mc

KNOWN_LEVELS = {"ok", "warn", "err", "note"}


def levels_of(messages):
    return [level for level, _ in messages]


# ---------------------------------------------------------------------------
# extract_value_checks — розбір переліків значень CHECK
# ---------------------------------------------------------------------------

class ExtractValueChecksTest(unittest.TestCase):
    def test_inline_create_table_check(self):
        sql = """
        create table ideas (
          id text primary key,
          status text not null check (status in ('new', 'accepted'))
        );
        """
        self.assertEqual(
            mc.extract_value_checks(sql),
            {("ideas", "status"): frozenset({"new", "accepted"})},
        )

    def test_alter_add_constraint_check(self):
        sql = """
        alter table ideas add constraint ideas_status_check check (
          status in ('new', 'accepted', 'rejected')
        );
        """
        self.assertEqual(
            mc.extract_value_checks(sql),
            {("ideas", "status"): frozenset({"new", "accepted", "rejected"})},
        )

    def test_later_alter_overrides_earlier_inline_in_same_text(self):
        sql = """
        create table ideas (
          id text primary key,
          status text not null check (status in ('new', 'old'))
        );
        alter table ideas drop constraint ideas_status_check;
        alter table ideas add constraint ideas_status_check check (
          status in ('new', 'accepted')
        );
        """
        self.assertEqual(
            mc.extract_value_checks(sql),
            {("ideas", "status"): frozenset({"new", "accepted"})},
        )

    def test_no_check_returns_empty(self):
        sql = "create table ideas (id text primary key, title text);"
        self.assertEqual(mc.extract_value_checks(sql), {})

    def test_unbalanced_create_table_parens_are_skipped_without_crash(self):
        # _find_matching_paren повертає None на незакритій CREATE TABLE.
        # Сам CHECK(...) тут ЗАКРИТИЙ навмисно: text[open_idx+1:None] у
        # Python — валідний зріз "до кінця рядка", а не помилка, тож якби
        # `continue` на end_idx is None прибрали, extract_value_checks
        # мовчки прочитав би CHECK через незакриту CREATE TABLE і повернув
        # би хибний запис — саме цю різницю тест і фіксує.
        sql = "create table broken (id text, status text check (status in ('a', 'b'))"
        self.assertEqual(mc.extract_value_checks(sql), {})

    def test_comment_with_parens_does_not_confuse_parser(self):
        # той самий клас проблем, що doctor_schema._strip_comments лікує для
        # schema.sql: коментар із комою й дужкою не має зсунути розбір.
        sql = """
        -- id формату 'PI-0001, (нова механіка)'
        create table ideas (
          id text primary key,
          status text not null check (status in ('new', 'accepted'))
        );
        """
        self.assertEqual(
            mc.extract_value_checks(sql),
            {("ideas", "status"): frozenset({"new", "accepted"})},
        )


# ---------------------------------------------------------------------------
# check_schema_drift — таблиці/колонки і переліки CHECK
# ---------------------------------------------------------------------------

class CheckSchemaDriftTest(unittest.TestCase):
    def test_consistent_state_is_clean(self):
        schema = "create table ideas (id text primary key, title text not null);"
        migration = "alter table ideas add column note text;"
        # у schema.sql нова колонка вже присутня — узгоджений стан
        schema = "create table ideas (id text primary key, title text not null, note text);"
        result = mc.check_schema_drift(schema, [("2026-01-01-add-note.sql", migration)])
        self.assertEqual(result, [])

    def test_added_column_missing_from_schema_is_err(self):
        schema = "create table ideas (id text primary key, title text not null);"
        migration = "alter table ideas add column note text;"
        result = mc.check_schema_drift(schema, [("2026-01-01-add-note.sql", migration)])
        self.assertEqual(len(result), 1)
        level, message = result[0]
        self.assertEqual(level, "err")
        self.assertIn("ideas(note)", message)
        self.assertIn("2026-01-01-add-note.sql", message)

    def test_added_table_missing_from_schema_is_err(self):
        schema = "create table ideas (id text primary key);"
        migration = "create table jobs (id uuid primary key, status text not null);"
        result = mc.check_schema_drift(schema, [("2026-01-01-jobs.sql", migration)])
        levels = levels_of(result)
        self.assertIn("err", levels)
        self.assertTrue(any("jobs" in msg for _, msg in result))

    def test_check_value_list_new_value_missing_from_schema_is_err(self):
        # це той самий клас розсинхрону, що стався з rejection_code/NO_MARKET:
        # міграція додає значення в CHECK, а schema.sql лишається зі старим переліком.
        #
        # РАНІШЕ (ВІДОМИЙ ДЕФЕКТ): assertIn("NO_MARKET", message) проходив
        # завжди, незалежно від того, чи check_schema_drift ЩОСЬ реально
        # порівняв — повідомлення й так містить хардкоджену згадку "уже
        # стався з rejection_code/NO_MARKET" наприкінці (посилання на цей
        # самий інцидент), тож тест не гарантував, що саме NO_MARKET
        # потрапив у ДИНАМІЧНУ частину (обчислений diff), а не в статичний
        # хвіст. Перевіряємо саме динамічний фрагмент "немає в schema.sql: …".
        schema = """
        create table ideas (
          id text primary key,
          rejection_code text check (rejection_code in ('LEGAL', 'CAPITAL'))
        );
        """
        migration = """
        alter table ideas drop constraint ideas_rejection_code_check;
        alter table ideas add constraint ideas_rejection_code_check check (
          rejection_code in ('LEGAL', 'CAPITAL', 'NO_MARKET')
        );
        """
        result = mc.check_schema_drift(schema, [("2026-08-03-no-market.sql", migration)])
        self.assertEqual(len(result), 1)
        level, message = result[0]
        self.assertEqual(level, "err")
        self.assertIn("немає в schema.sql: NO_MARKET", message)
        self.assertIn("ideas.rejection_code", message)

    def test_check_value_list_matching_is_clean(self):
        schema = """
        create table ideas (
          id text primary key,
          rejection_code text check (rejection_code in ('LEGAL', 'CAPITAL', 'NO_MARKET'))
        );
        """
        migration = """
        alter table ideas drop constraint ideas_rejection_code_check;
        alter table ideas add constraint ideas_rejection_code_check check (
          rejection_code in ('LEGAL', 'CAPITAL', 'NO_MARKET')
        );
        """
        result = mc.check_schema_drift(schema, [("2026-08-03-no-market.sql", migration)])
        self.assertEqual(result, [])

    def test_check_value_list_absent_from_schema_entirely_is_err(self):
        schema = "create table ideas (id text primary key, rejection_code text);"
        migration = """
        alter table ideas add constraint ideas_rejection_code_check check (
          rejection_code in ('LEGAL', 'CAPITAL')
        );
        """
        result = mc.check_schema_drift(schema, [("2026-01-01-add-check.sql", migration)])
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0][0], "err")

    def test_check_value_list_only_extra_in_schema_no_missing(self):
        # schema.sql — надмножина переліку з міграції (нічого не бракує,
        # лише зайве) -> гілка missing_in_schema порожня, extra_in_schema ні.
        schema = """
        create table ideas (
          id text primary key,
          status text check (status in ('a', 'b', 'c'))
        );
        """
        migration = """
        alter table ideas add constraint ideas_status_check check (
          status in ('a', 'b')
        );
        """
        result = mc.check_schema_drift(schema, [("2026-01-01-x.sql", migration)])
        self.assertEqual(len(result), 1)
        level, message = result[0]
        self.assertEqual(level, "err")
        self.assertIn("є в schema.sql, немає в міграції: c", message)
        self.assertNotIn("немає в schema.sql:", message)

    def test_chronological_order_matters_last_migration_wins(self):
        schema = """
        create table ideas (
          id text primary key,
          status text not null check (status in ('new', 'final'))
        );
        """
        old_migration = """
        alter table ideas add constraint ideas_status_check check (
          status in ('new', 'old')
        );
        """
        new_migration = """
        alter table ideas drop constraint ideas_status_check;
        alter table ideas add constraint ideas_status_check check (
          status in ('new', 'final')
        );
        """
        result = mc.check_schema_drift(
            schema,
            [
                ("2026-01-01-old.sql", old_migration),
                ("2026-01-02-new.sql", new_migration),
            ],
        )
        self.assertEqual(result, [])


# ---------------------------------------------------------------------------
# check_filenames — формат і хронологія
# ---------------------------------------------------------------------------

class CheckFilenamesTest(unittest.TestCase):
    def test_well_formed_names_are_clean(self):
        result = mc.check_filenames(["2026-07-30-accepted-status.sql", "2026-08-03-no-market.sql"])
        self.assertEqual(levels_of(result), [])

    def test_malformed_name_is_err(self):
        result = mc.check_filenames(["accepted_status.sql"])
        levels = levels_of(result)
        self.assertEqual(levels, ["err"])
        self.assertIn("accepted_status.sql", result[0][1])

    def test_missing_sql_extension_like_prefix_is_err(self):
        result = mc.check_filenames(["2026-07-30.sql"])
        self.assertEqual(levels_of(result), ["err"])

    def test_out_of_order_listing_is_err(self):
        # check_filenames отримує список як є (доктор.sh чи os.listdir можуть
        # віддати будь-який порядок) — перевірка сама сортує й порівнює.
        result = mc.check_filenames(["2026-08-03-b.sql", "2026-07-30-a.sql"])
        self.assertIn("err", levels_of(result))

    def test_same_date_multiple_migrations_is_note_not_err(self):
        result = mc.check_filenames(["2026-07-31-a.sql", "2026-07-31-b.sql"])
        self.assertEqual(levels_of(result), ["note"])

    def test_invalid_calendar_date_is_err(self):
        result = mc.check_filenames(["2026-13-40-bad-date.sql"])
        self.assertEqual(levels_of(result), ["err"])


# ---------------------------------------------------------------------------
# check_idempotency — статичні патерни небезпечних конструкцій
# ---------------------------------------------------------------------------

class CheckIdempotencyTest(unittest.TestCase):
    def test_create_table_without_if_not_exists_warns(self):
        result = mc.check_idempotency("create table jobs (id uuid primary key);", "m.sql")
        self.assertTrue(any("CREATE TABLE jobs" in msg for _, msg in result))
        self.assertTrue(all(level == "warn" for level, _ in result))

    def test_create_table_if_not_exists_is_clean(self):
        result = mc.check_idempotency("create table if not exists jobs (id uuid primary key);", "m.sql")
        self.assertEqual(result, [])

    def test_add_column_without_if_not_exists_warns(self):
        result = mc.check_idempotency("alter table ideas add column note text;", "m.sql")
        self.assertEqual(len(result), 1)
        self.assertIn("ADD COLUMN note", result[0][1])

    def test_add_column_if_not_exists_is_clean(self):
        result = mc.check_idempotency(
            "alter table ideas add column if not exists note text;", "m.sql"
        )
        self.assertEqual(result, [])

    def test_multiple_add_column_clauses_all_flagged(self):
        sql = "alter table ideas add column a text, add column b text;"
        result = mc.check_idempotency(sql, "m.sql")
        self.assertEqual(len(result), 2)

    def test_drop_column_without_if_exists_warns(self):
        result = mc.check_idempotency("alter table ideas drop column note;", "m.sql")
        self.assertEqual(len(result), 1)
        level, message = result[0]
        self.assertEqual(level, "warn")
        self.assertIn("DROP COLUMN note", message)
        self.assertIn("IF EXISTS", message)

    def test_drop_column_if_exists_is_clean(self):
        result = mc.check_idempotency("alter table ideas drop column if exists note;", "m.sql")
        self.assertEqual(result, [])

    def test_drop_then_add_constraint_same_name_is_recognized_safe(self):
        sql = """
        alter table ideas drop constraint ideas_status_check;
        alter table ideas add constraint ideas_status_check check (status in ('a'));
        """
        result = mc.check_idempotency(sql, "m.sql")
        self.assertEqual(result, [])

    def test_add_constraint_without_matching_drop_warns(self):
        sql = "alter table ideas add constraint ideas_new_check check (status in ('a'));"
        result = mc.check_idempotency(sql, "m.sql")
        self.assertTrue(any("ADD CONSTRAINT ideas_new_check" in msg for _, msg in result))

    def test_create_index_without_if_not_exists_warns(self):
        result = mc.check_idempotency("create index idx_x on ideas(status);", "m.sql")
        self.assertTrue(any("CREATE INDEX idx_x" in msg for _, msg in result))

    def test_create_index_if_not_exists_is_clean(self):
        result = mc.check_idempotency("create index if not exists idx_x on ideas(status);", "m.sql")
        self.assertEqual(result, [])

    def test_create_policy_always_warns_without_guard(self):
        sql = "create policy ideas_full_access on ideas for all to authenticated using (true);"
        result = mc.check_idempotency(sql, "m.sql")
        self.assertTrue(any("CREATE POLICY ideas_full_access" in msg for _, msg in result))

    def test_create_trigger_without_or_replace_warns(self):
        sql = "create trigger ideas_set_updated_at before update on ideas for each row execute function f();"
        result = mc.check_idempotency(sql, "m.sql")
        self.assertTrue(any("CREATE TRIGGER ideas_set_updated_at" in msg for _, msg in result))

    def test_function_body_is_not_scanned_for_dangerous_constructs(self):
        # тіло функції може містити 'insert into'/інші SQL-конструкції, які
        # семантично не top-level DDL цієї міграції.
        sql = """
        create or replace function f()
        returns void
        language plpgsql
        as $$
        begin
          insert into events (idea_id, actor, change) values ('X', 'system', 'noop');
        end;
        $$;
        """
        result = mc.check_idempotency(sql, "m.sql")
        self.assertEqual(result, [])

    def test_do_block_is_not_scanned_for_dangerous_constructs(self):
        sql = """
        do $$
        begin
          if not exists (select 1 from pg_publication_tables where pubname = 'x') then
            alter publication x add table jobs;
          end if;
        end
        $$;
        """
        result = mc.check_idempotency(sql, "m.sql")
        self.assertEqual(result, [])

    def test_insert_without_on_conflict_warns(self):
        result = mc.check_idempotency("insert into events (idea_id, actor) values ('X', 'system');", "m.sql")
        self.assertTrue(any("INSERT INTO events" in msg for _, msg in result))

    def test_insert_with_on_conflict_is_clean(self):
        sql = "insert into events (idea_id, actor) values ('X', 'system') on conflict do nothing;"
        result = mc.check_idempotency(sql, "m.sql")
        self.assertEqual(result, [])

    def test_plain_update_is_clean(self):
        result = mc.check_idempotency("update ideas set status = 'accepted' where status = 'active';", "m.sql")
        self.assertEqual(result, [])


# ---------------------------------------------------------------------------
# scan_unrecognized — нічого не зникає мовчки
# ---------------------------------------------------------------------------

class ScanUnrecognizedTest(unittest.TestCase):
    def test_ordinary_migration_statements_are_all_recognized(self):
        sql = """
        begin;
        create table ideas (id text primary key);
        alter table ideas add column note text;
        update ideas set note = 'x' where id = 'y';
        comment on column ideas.note is 'z';
        commit;
        """
        self.assertEqual(mc.scan_unrecognized(sql, "m.sql"), [])

    def test_unrecognized_construct_is_note(self):
        sql = "vacuum analyze ideas;"
        result = mc.scan_unrecognized(sql, "m.sql")
        self.assertEqual(len(result), 1)
        level, message = result[0]
        self.assertEqual(level, "note")
        self.assertIn("vacuum analyze ideas", message)

    def test_function_and_do_block_bodies_are_excluded_from_scan(self):
        sql = """
        create or replace function f()
        returns void
        language plpgsql
        as $$
        begin
          perform something_weird_the_scanner_would_not_know();
        end;
        $$;
        do $$
        begin
          raise notice 'irrelevant, stripped along with the block';
        end
        $$;
        """
        self.assertEqual(mc.scan_unrecognized(sql, "m.sql"), [])


# ---------------------------------------------------------------------------
# migration_files / read_text — файлова система, теж потребує гілок помилок
# ---------------------------------------------------------------------------

class MigrationFilesTest(unittest.TestCase):
    def test_missing_migrations_dir_returns_empty_list(self):
        with mock.patch.object(mc, "MIGRATIONS_DIR", "/nonexistent/migrations/dir"):
            self.assertEqual(mc.migration_files(), [])

    def test_only_sql_files_are_listed_and_sorted(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            for name in ("2026-01-02-b.sql", "2026-01-01-a.sql", "readme.md"):
                open(os.path.join(tmpdir, name), "w", encoding="utf-8").close()
            with mock.patch.object(mc, "MIGRATIONS_DIR", tmpdir):
                self.assertEqual(mc.migration_files(), ["2026-01-01-a.sql", "2026-01-02-b.sql"])


class ReadTextTest(unittest.TestCase):
    def test_nonexistent_file_returns_none(self):
        self.assertIsNone(mc.read_text("/nonexistent/path/file.sql"))

    def test_directory_instead_of_file_returns_none(self):
        # os.listdir у migration_files() не розрізняє файл/теку за розширенням
        # — тека з іменем "*.sql" пройде фільтр, а open() на ній впаде
        # IsADirectoryError (підклас OSError), і саме цю гілку тут і перевіряємо.
        with tempfile.TemporaryDirectory() as tmpdir:
            self.assertIsNone(mc.read_text(tmpdir))

    def test_existing_file_returns_contents(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "m.sql")
            with open(path, "w", encoding="utf-8") as f:
                f.write("select 1;")
            self.assertEqual(mc.read_text(path), "select 1;")


# ---------------------------------------------------------------------------
# run() — синтетичні файлові дерева для гілок помилок (без диска репозиторію)
# ---------------------------------------------------------------------------

class RunSyntheticTest(unittest.TestCase):
    def _write(self, path, content):
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)

    def test_missing_schema_file_is_err_and_run_stops_immediately(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            missing = os.path.join(tmpdir, "nope.sql")
            with mock.patch.object(mc, "SCHEMA_FILE", missing):
                result = mc.run()
        self.assertEqual(len(result), 1)
        level, message = result[0]
        self.assertEqual(level, "err")
        self.assertIn(missing, message)

    def test_no_migration_files_notes_and_stops(self):
        with tempfile.TemporaryDirectory() as schema_dir, tempfile.TemporaryDirectory() as empty_mig_dir:
            schema_path = os.path.join(schema_dir, "schema.sql")
            self._write(schema_path, "create table ideas (id text primary key);")
            with mock.patch.object(mc, "SCHEMA_FILE", schema_path), \
                 mock.patch.object(mc, "MIGRATIONS_DIR", empty_mig_dir):
                result = mc.run()
        self.assertEqual(len(result), 1)
        level, message = result[0]
        self.assertEqual(level, "note")
        self.assertIn("немає файлів .sql", message)

    def test_unreadable_migration_file_is_err_but_run_continues(self):
        with tempfile.TemporaryDirectory() as schema_dir, tempfile.TemporaryDirectory() as mig_dir:
            schema_path = os.path.join(schema_dir, "schema.sql")
            self._write(schema_path, "create table ideas (id text primary key);")
            # тека з іменем, що виглядає як файл міграції — потрапляє в
            # migration_files() (endswith '.sql'), але read_text() на ній впаде.
            os.mkdir(os.path.join(mig_dir, "2026-01-01-broken.sql"))
            with mock.patch.object(mc, "SCHEMA_FILE", schema_path), \
                 mock.patch.object(mc, "MIGRATIONS_DIR", mig_dir):
                result = mc.run()
        err_messages = [msg for level, msg in result if level == "err"]
        self.assertEqual(len(err_messages), 1)
        self.assertIn("2026-01-01-broken.sql", err_messages[0])
        self.assertIn("не вдалось прочитати файл міграції", err_messages[0])

    def test_schema_drift_present_suppresses_ok_drift_message(self):
        with tempfile.TemporaryDirectory() as schema_dir, tempfile.TemporaryDirectory() as mig_dir:
            schema_path = os.path.join(schema_dir, "schema.sql")
            self._write(schema_path, "create table ideas (id text primary key);")
            self._write(
                os.path.join(mig_dir, "2026-01-01-add-note.sql"),
                "alter table ideas add column note text;",
            )
            with mock.patch.object(mc, "SCHEMA_FILE", schema_path), \
                 mock.patch.object(mc, "MIGRATIONS_DIR", mig_dir):
                result = mc.run()
        self.assertTrue(any(level == "err" and "ideas(note)" in msg for level, msg in result))
        self.assertFalse(any(level == "ok" and "узгоджений" in msg for level, msg in result))

    def test_zero_idempotency_warnings_yields_ok_message(self):
        with tempfile.TemporaryDirectory() as schema_dir, tempfile.TemporaryDirectory() as mig_dir:
            schema_path = os.path.join(schema_dir, "schema.sql")
            self._write(schema_path, "create table ideas (id text primary key, note text);")
            self._write(
                os.path.join(mig_dir, "2026-01-01-add-note.sql"),
                "alter table ideas add column if not exists note text;",
            )
            with mock.patch.object(mc, "SCHEMA_FILE", schema_path), \
                 mock.patch.object(mc, "MIGRATIONS_DIR", mig_dir):
                result = mc.run()
        self.assertTrue(any(
            level == "ok" and "без явно небезпечних конструкцій" in msg for level, msg in result
        ))


class MainTest(unittest.TestCase):
    def test_prints_level_tab_message_for_each_run_result(self):
        buf = io.StringIO()
        with mock.patch.object(mc, "run", return_value=[("ok", "все гаразд"), ("warn", "обережно")]), \
             contextlib.redirect_stdout(buf):
            mc.main()
        self.assertEqual(buf.getvalue(), "ok\tвсе гаразд\nwarn\tобережно\n")


# ---------------------------------------------------------------------------
# run() — інтеграція на реальних файлах репозиторію
# ---------------------------------------------------------------------------

class RealRepositoryTest(unittest.TestCase):
    """Задача explicitly просить перевірити реальний стан репозиторію: чи
    schema.sql узгоджений з shared/migrations/*.sql. На момент написання
    цього тесту відомий результат — жодного err (schema.sql уже приведений
    у відповідність попереднім комітом), лише note про дві пари міграцій з
    однаковою датою в імені файлу і warn про відсутні IF NOT EXISTS у
    2026-07-31-deep-research.sql/2026-07-31-job-queue.sql."""

    def test_output_contract(self):
        result = mc.run()
        self.assertTrue(result)
        for level, message in result:
            self.assertIn(level, KNOWN_LEVELS)
            self.assertIsInstance(message, str)
            self.assertNotIn("\t", message)

    def test_no_schema_drift_currently(self):
        result = mc.run()
        drift_errors = [msg for level, msg in result if level == "err"]
        self.assertEqual(drift_errors, [], "реальний розсинхрон між міграціями і schema.sql")

    def test_known_idempotency_warnings_present(self):
        result = mc.run()
        warn_files = {msg.split(":", 1)[0] for level, msg in result if level == "warn"}
        self.assertIn("2026-07-31-deep-research.sql", warn_files)
        self.assertIn("2026-07-31-job-queue.sql", warn_files)


if __name__ == "__main__":
    unittest.main()
