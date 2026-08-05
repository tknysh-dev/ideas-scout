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

import unittest

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
        self.assertIn("NO_MARKET", message)
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
