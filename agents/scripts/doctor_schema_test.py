"""doctor_schema_test.py — тести для doctor_schema.py: розбір shared/schema.sql,
звірка з фейковою "базою" (без мережі!) і контракт виводу "рівень<TAB>повідомлення".

Жоден тест не має ходити в мережу чи торкатись Supabase. fetch_db_tables у
кожному тесті, що його викликає, отримує змокані _load_creds і
urllib.request.urlopen — навіть якщо на машині лежить реальний
~/.config/ideas-scout/env із робочими SUPABASE_URL/SUPABASE_SERVICE_KEY (він
тут є), випадковий виклик без мока не повинен піти в прод.

Деякі тести нижче позначені "ВІДОМИЙ ДЕФЕКТ" — вони фіксують ФАКТИЧНУ (а не
бажану) поведінку doctor_schema.py, знайдену під час написання цих тестів.
doctor_schema.py навмисно не змінювався (правило чесності завдання).
"""

from __future__ import annotations

import importlib
import json
import os
import tempfile
import unittest
import urllib.error
from unittest import mock

import doctor_schema as ds

KNOWN_LEVELS = {"ok", "err", "warn", "note"}
REAL_SCHEMA_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "shared", "schema.sql",
)


def _clear_lines():
    ds.lines.clear()


# ---------------------------------------------------------------------------
# 0. Низькорівневі хелпери розбору — гілки, які через parse_schema/
#    _count_unrecognized_statements не завжди легко довести до потрібного
#    стану (екранована лапка ''  всередині рядкового літералу, коментар без
#    завершального переносу рядка).
# ---------------------------------------------------------------------------

class StripCommentsTest(unittest.TestCase):
    def test_doubled_quote_escape_inside_string_preserved(self):
        # 'it''s ok' — стандартне SQL-екранування лапки подвоєнням; парсер
        # рядкового стану має лишитись "усередині рядка" після ''.
        text = "default 'it''s ok'"
        self.assertEqual(ds._strip_comments(text), text)

    def test_line_comment_without_trailing_newline_is_dropped_to_end(self):
        # "--"-коментар, що йде до самого кінця файлу без \n після себе:
        # nl == -1 -> break, а не нескінченний цикл чи IndexError.
        text = "select 1 -- trailing comment with no newline"
        self.assertEqual(ds._strip_comments(text), "select 1 ")


class FindMatchingParenTest(unittest.TestCase):
    def test_doubled_quote_inside_string_does_not_confuse_paren_depth(self):
        text = "(id text default 'it''s', name text)"
        end = ds._find_matching_paren(text, 0)
        self.assertEqual(end, len(text) - 1)


class SplitTopLevelTest(unittest.TestCase):
    def test_doubled_quote_inside_default_value_does_not_split_column(self):
        body = "id text default 'it''s ok', name text"
        parts = ds._split_top_level(body)
        self.assertEqual(len(parts), 2)
        self.assertIn("it''s ok", parts[0])

    def test_trailing_comma_does_not_yield_empty_trailing_part(self):
        parts = ds._split_top_level("id text, name text,")
        self.assertEqual(parts, ["id text", " name text"])


class SplitStatementsTest(unittest.TestCase):
    def test_doubled_quote_inside_string_does_not_split_statement(self):
        text = "insert into t values ('it''s ok');"
        self.assertEqual(ds._split_statements(text), [text])


# ---------------------------------------------------------------------------
# 1. Розбір shared/schema.sql — базові форми CREATE TABLE / ALTER TABLE
# ---------------------------------------------------------------------------

class ParseSchemaCreateTableForms(unittest.TestCase):
    def setUp(self):
        _clear_lines()

    def test_simple_create_table(self):
        sql = "create table ideas (id text primary key, title text not null);"
        tables, unparsed = ds.parse_schema(sql)
        self.assertEqual(tables, {"ideas": {"id", "title"}})
        self.assertEqual(unparsed, 0)

    def test_if_not_exists(self):
        sql = "CREATE TABLE IF NOT EXISTS ideas (id text primary key);"
        tables, unparsed = ds.parse_schema(sql)
        self.assertEqual(tables, {"ideas": {"id"}})
        self.assertEqual(unparsed, 0)

    def test_multiline_with_check_constraint_inside_column(self):
        sql = (
            "create table ideas (\n"
            "  id text primary key,\n"
            "  status text not null default 'new' check (status in ('new', 'done')),\n"
            "  title text\n"
            ");"
        )
        tables, unparsed = ds.parse_schema(sql)
        self.assertEqual(tables, {"ideas": {"id", "status", "title"}})
        self.assertEqual(unparsed, 0)

    def test_default_with_comma_and_paren_inside_string_literal(self):
        # Кома й дужка ВСЕРЕДИНІ 'a, b(c)' не повинні розбивати межу колонки.
        sql = "create table t (id text default 'a, b(c)', name text);"
        tables, unparsed = ds.parse_schema(sql)
        self.assertEqual(tables, {"t": {"id", "name"}})
        self.assertEqual(unparsed, 0)

    def test_line_comment_with_paren_and_comma_inside_definition(self):
        sql = (
            "create table t (\n"
            "  id text, -- коментар із ) і , всередині (PI-0001, APP-0013)\n"
            "  name text\n"
            ");"
        )
        tables, unparsed = ds.parse_schema(sql)
        self.assertEqual(tables, {"t": {"id", "name"}})
        self.assertEqual(unparsed, 0)

    def test_table_level_check_constraint_not_counted_as_column(self):
        sql = "create table t (\n  id text,\n  check (id <> '')\n);"
        tables, unparsed = ds.parse_schema(sql)
        self.assertEqual(tables, {"t": {"id"}})
        self.assertEqual(unparsed, 0)

    def test_alter_table_add_single_column(self):
        sql = "create table ideas (id text primary key);\nalter table ideas add column extra_col text;"
        tables, unparsed = ds.parse_schema(sql)
        self.assertEqual(tables, {"ideas": {"id", "extra_col"}})
        self.assertEqual(unparsed, 0)

    def test_alter_table_add_multiple_columns_in_one_statement(self):
        sql = "alter table x add column y text, add column z integer default 0;"
        tables, unparsed = ds.parse_schema(sql)
        self.assertEqual(tables, {"x": {"y", "z"}})
        self.assertEqual(unparsed, 0)


# ---------------------------------------------------------------------------
# 2. Конструкції, які НЕ таблиці — не мають потрапити ні в tables, ні в unparsed
# ---------------------------------------------------------------------------

class ParseSchemaNonTableStatements(unittest.TestCase):
    def setUp(self):
        _clear_lines()

    def test_create_index_ignored(self):
        sql = "create table t (id text primary key);\ncreate index idx_t_id on t(id);"
        tables, unparsed = ds.parse_schema(sql)
        self.assertEqual(tables, {"t": {"id"}})
        self.assertEqual(unparsed, 0)

    def test_create_unique_index_ignored(self):
        sql = "create unique index idx_x on t(id);"
        tables, unparsed = ds.parse_schema(sql)
        self.assertEqual(tables, {})
        self.assertEqual(unparsed, 0)

    def test_create_trigger_ignored(self):
        sql = (
            "create table t (id text primary key);\n"
            "create trigger trg before insert on t for each row execute function f();"
        )
        tables, unparsed = ds.parse_schema(sql)
        self.assertEqual(tables, {"t": {"id"}})
        self.assertEqual(unparsed, 0)

    def test_create_policy_ignored(self):
        sql = (
            "create table t (id text primary key);\n"
            "create policy p on t for all to authenticated using (true);"
        )
        tables, unparsed = ds.parse_schema(sql)
        self.assertEqual(tables, {"t": {"id"}})
        self.assertEqual(unparsed, 0)

    def test_alter_publication_ignored(self):
        sql = (
            "create table t (id text primary key);\n"
            "alter publication supabase_realtime add table t;"
        )
        tables, unparsed = ds.parse_schema(sql)
        self.assertEqual(tables, {"t": {"id"}})
        self.assertEqual(unparsed, 0)

    def test_single_well_formed_function_recognized_and_not_unparsed(self):
        sql = (
            "create or replace function f()\n"
            "returns trigger as $$\n"
            "begin\n"
            "  return new;\n"
            "end;\n"
            "$$ language plpgsql;"
        )
        tables, unparsed = ds.parse_schema(sql)
        self.assertEqual(tables, {})
        self.assertEqual(unparsed, 0)


# ---------------------------------------------------------------------------
# 3. "Нерозпізнане" має потрапляти в unparsed, а не зникати мовчки
# ---------------------------------------------------------------------------

class ParseSchemaUnparsedBucket(unittest.TestCase):
    def setUp(self):
        _clear_lines()

    def test_genuinely_unknown_statement_lands_in_unparsed(self):
        sql = "drop table this_is_not_recognized_by_anything;"
        tables, unparsed = ds.parse_schema(sql)
        self.assertEqual(tables, {})
        self.assertEqual(unparsed, 1)

    def test_dangling_paren_in_create_table_reported_as_err_and_excluded(self):
        # Дужки не збалансовані навмисно: _find_matching_paren поверне None.
        sql = "create table broken (id text primary key"
        tables, unparsed = ds.parse_schema(sql)
        self.assertEqual(tables, {})
        self.assertEqual(len(ds.lines), 1)
        level, message = ds.lines[0].split("\t", 1)
        self.assertEqual(level, "err")
        self.assertIn("broken", message)
        # unparsed = 2, не 1: незакрита CREATE TABLE не потрапляє в `consumed`
        # (early continue на err), тож увесь її текст лишається і в
        # remainder — там немає ';', тому _split_statements віддає його як
        # ОДНЕ "неповне" висловлювання, яке теж не проходить
        # _RECOGNIZED_STATEMENT і рахується вдруге. Одна й та сама поломка
        # рахується двічі: раз явним err, раз загальним підрахунком.
        self.assertEqual(unparsed, 2)

    def test_KNOWN_DEFECT_quoted_table_name_disappears_without_a_named_trace(self):
        """ВІДОМИЙ ДЕФЕКТ: create table "ideas" (лапки навколо імені) не
        відповідає регексу `create table\\s+(?:if not exists\\s+)?(\\w+)\\s*\\(`
        (\\w+ не матчить лапку) — уся таблиця, з усіма колонками, зникає з
        tables. unparsed при цьому таки зростає на 1 (через
        _count_unrecognized_statements), тож факт "щось не розпізнано" не
        губиться зовсім — але жодне повідомлення НЕ називає, яку саме таблицю
        загубили: параметр name у той момент ще не існує (регекс на CREATE
        TABLE не спрацював), кажучи лише сумарну цифру."""
        sql = 'create table "ideas" (id text primary key, title text not null);'
        tables, unparsed = ds.parse_schema(sql)
        self.assertEqual(tables, {})
        self.assertEqual(unparsed, 1)
        self.assertEqual(ds.lines, [])  # немає жодного err/note із назвою "ideas" тут

    def test_empty_segment_from_double_comma_is_skipped_without_crash(self):
        sql = "create table t (id text,, name text);"
        tables, unparsed = ds.parse_schema(sql)
        self.assertEqual(tables, {"t": {"id", "name"}})
        self.assertEqual(unparsed, 0)

    def test_segment_not_starting_with_identifier_counts_as_unparsed(self):
        # "123abc" не матчить `([A-Za-z_][A-Za-z0-9_]*)` — колонка не додається,
        # але й не зникає мовчки: рахується в unparsed.
        sql = "create table t (id text, 123abc text);"
        tables, unparsed = ds.parse_schema(sql)
        self.assertEqual(tables, {"t": {"id"}})
        self.assertEqual(unparsed, 1)

    def test_alter_table_with_empty_body_is_skipped_silently(self):
        # "alter table foo ;" збігається з регексом ALTER-циклу (група ADD
        # COLUMN порожня), але body.strip() порожній -> continue ДО
        # consumed.append: інструкція лишається нерозпізнаною в remainder.
        sql = "alter table foo ;"
        tables, unparsed = ds.parse_schema(sql)
        self.assertEqual(tables, {})
        self.assertEqual(unparsed, 1)

    def test_alter_table_add_column_without_name_yields_no_column(self):
        sql = "alter table foo add column ;"
        tables, unparsed = ds.parse_schema(sql)
        self.assertEqual(tables, {})
        self.assertEqual(unparsed, 0)


# ---------------------------------------------------------------------------
# 4. ВІДОМИЙ ДЕФЕКТ: надто жадібне вирізання тіла CREATE FUNCTION у
#    _count_unrecognized_statements ковтає все між двома функціями
# ---------------------------------------------------------------------------

class ParseSchemaFunctionStripSwallowsBetweenFunctions(unittest.TestCase):
    def setUp(self):
        _clear_lines()

    def test_KNOWN_DEFECT_unknown_statement_between_two_functions_is_swallowed(self):
        """ВІДОМИЙ ДЕФЕКТ. Регекс у _count_unrecognized_statements:
        `create (?:or replace )?function.*?\\$\\$.*?\\$\\$ language \\w+\\s*;`
        нежадібний, але не прив'язаний до ОДНІЄЇ функції: якщо перша функція
        закривається як `$$;` (без "language ..." одразу після, бо
        `language plpgsql` стоїть ПЕРЕД `as $$`, як у claim_next_job у
        реальному shared/schema.sql), пошук .*? тягнеться далі — аж до
        `$$ language ...;` НАСТУПНОЇ функції. Весь текст між ними (тут —
        свідомо зіпсована інструкція `drop table ...`) вирізається одним
        шматком і ніколи не потрапляє під перевірку _RECOGNIZED_STATEMENT.

        Наслідок: якщо між двома CREATE FUNCTION у shared/schema.sql
        з'явиться справді нерозпізнана конструкція, unparsed про це
        промовчить. У реальному файлі це поки не шкодить (там між функціями
        лежать лише CREATE INDEX/ALTER ADD CONSTRAINT, які й так були б
        визнані) — але це випадковість розташування, а не гарантія розбору."""
        sql = (
            "create or replace function f1(p integer)\n"
            "returns void\n"
            "language plpgsql\n"
            "as $$\n"
            "begin\n"
            "  perform 1;\n"
            "end;\n"
            "$$;\n"
            "\n"
            "drop table this_should_have_been_flagged_as_unparsed;\n"
            "\n"
            "create or replace function f2()\n"
            "returns trigger as $$\n"
            "begin\n"
            "  return new;\n"
            "end;\n"
            "$$ language plpgsql;\n"
        )
        tables, unparsed = ds.parse_schema(sql)
        self.assertEqual(tables, {})
        # Мало б бути 1 (drop table нерозпізнаний) — фактично 0, бо його
        # проковтнуло разом із тілами функцій.
        self.assertEqual(unparsed, 0)


# ---------------------------------------------------------------------------
# 5. Регресія на РЕАЛЬНОМУ shared/schema.sql
# ---------------------------------------------------------------------------

class ParseSchemaRealFileRegression(unittest.TestCase):
    def setUp(self):
        _clear_lines()

    def test_real_schema_sql_table_and_column_counts(self):
        with open(REAL_SCHEMA_FILE, encoding="utf-8") as handle:
            text = handle.read()
        tables, unparsed = ds.parse_schema(text)
        self.assertEqual(len(tables), 9, f"таблиці: {sorted(tables)}")
        total_columns = sum(len(cols) for cols in tables.values())
        self.assertEqual(total_columns, 135)
        # 0 тут "правильний за випадковим збігом" — див.
        # ParseSchemaFunctionStripSwallowsBetweenFunctions вище: реальний
        # файл має функцію claim_next_job із тим самим "$$;" без "language"
        # одразу після, і між нею та наступною функцією (set_updated_at)
        # лежать лише CREATE INDEX/ALTER ADD CONSTRAINT — вони й так були б
        # визнані розпізнаними, тож ковтання їх не змінює результат.
        self.assertEqual(unparsed, 0)


# ---------------------------------------------------------------------------
# 2'. Порівняння зі "схемою з бази" — через main() з підміненими
#     SCHEMA_FILE і fetch_db_tables (жодного мережевого виклику).
# ---------------------------------------------------------------------------

class CompareWithDbSchema(unittest.TestCase):
    def setUp(self):
        _clear_lines()
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)

    def _run_main(self, schema_sql, db_tables):
        schema_path = os.path.join(self._tmpdir.name, "schema.sql")
        with open(schema_path, "w", encoding="utf-8") as handle:
            handle.write(schema_sql)
        with mock.patch.object(ds, "SCHEMA_FILE", schema_path), \
             mock.patch.object(ds, "fetch_db_tables", return_value=db_tables):
            ds.main()
        return list(ds.lines)

    @staticmethod
    def _levels(lines):
        return [line.split("\t", 1)[0] for line in lines]

    def test_missing_table_in_db_is_err(self):
        schema_sql = "create table ideas (id text primary key);"
        db_tables = {}
        lines = self._run_main(schema_sql, db_tables)
        err_lines = [line for line in lines if line.startswith("err\t")]
        self.assertEqual(len(err_lines), 1)
        self.assertIn("ideas", err_lines[0])
        self.assertNotIn("ok\t", "\n".join(lines))

    def test_extra_table_in_db_is_warn(self):
        schema_sql = "create table ideas (id text primary key);"
        db_tables = {"ideas": {"id"}, "legacy": {"col"}}
        lines = self._run_main(schema_sql, db_tables)
        warn_lines = [line for line in lines if line.startswith("warn\t")]
        self.assertEqual(len(warn_lines), 1)
        self.assertIn("legacy", warn_lines[0])
        self.assertFalse(any(line.startswith("err\t") for line in lines))
        self.assertFalse(any(line.startswith("ok\t") for line in lines))

    def test_missing_column_in_db_is_err(self):
        schema_sql = "create table ideas (id text primary key, title text not null);"
        db_tables = {"ideas": {"id"}}  # title відсутня в базі
        lines = self._run_main(schema_sql, db_tables)
        err_lines = [line for line in lines if line.startswith("err\t")]
        self.assertEqual(len(err_lines), 1)
        self.assertIn("ideas(title)", err_lines[0])

    def test_extra_column_in_db_is_warn(self):
        schema_sql = "create table ideas (id text primary key);"
        db_tables = {"ideas": {"id", "legacy_col"}}
        lines = self._run_main(schema_sql, db_tables)
        warn_lines = [line for line in lines if line.startswith("warn\t")]
        self.assertEqual(len(warn_lines), 1)
        self.assertIn("ideas(legacy_col)", warn_lines[0])

    def test_full_match_is_ok(self):
        schema_sql = "create table ideas (id text primary key, title text not null);"
        db_tables = {"ideas": {"id", "title"}}
        lines = self._run_main(schema_sql, db_tables)
        ok_lines = [line for line in lines if line.startswith("ok\t")]
        self.assertEqual(len(ok_lines), 1)
        self.assertIn("1 таблиць", ok_lines[0])
        self.assertIn("2 колонок", ok_lines[0])
        self.assertFalse(any(line.startswith("err\t") for line in lines))
        self.assertFalse(any(line.startswith("warn\t") for line in lines))

    def test_db_unreachable_prints_partial_lines_and_stops_before_comparison(self):
        # fetch_db_tables повертає None (недоступна база чи зіпсована
        # відповідь) — main() друкує вже накопичені рядки (тут — жодного) і
        # виходить ДО будь-якої звірки таблиць/колонок.
        schema_sql = "create table ideas (id text primary key);"
        lines = self._run_main(schema_sql, None)
        self.assertEqual(lines, [])

    def test_missing_schema_file_is_err(self):
        with mock.patch.object(ds, "SCHEMA_FILE", os.path.join(self._tmpdir.name, "nope.sql")):
            ds.main()
        self.assertEqual(len(ds.lines), 1)
        level, message = ds.lines[0].split("\t", 1)
        self.assertEqual(level, "err")
        self.assertIn("nope.sql", message)


# ---------------------------------------------------------------------------
# 3. _load_creds — інші тести підміняють цю функцію цілком, тут вона
#    викликається напряму. Свій env-файл підмінюється через ds.ENV_FILE,
#    SUPABASE_URL/SUPABASE_SERVICE_KEY з оточення прибираються на час тесту,
#    щоб не залежати від того, що реально лежить у середовищі.
# ---------------------------------------------------------------------------

class LoadCredsTest(unittest.TestCase):
    def setUp(self):
        _clear_lines()
        self._saved_environ = {}
        for key in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY"):
            self._saved_environ[key] = os.environ.pop(key, None)

    def tearDown(self):
        for key, value in self._saved_environ.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    @staticmethod
    def _safe_remove(path: str) -> None:
        if os.path.exists(path):
            os.remove(path)

    def _write_env_file(self, content: str) -> str:
        fd, path = tempfile.mkstemp()
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        return path

    def test_env_vars_take_priority_and_skip_file_entirely(self):
        os.environ["SUPABASE_URL"] = "https://env-var.supabase.co"
        os.environ["SUPABASE_SERVICE_KEY"] = "env-var-key"
        with mock.patch.object(ds, "ENV_FILE", "/nonexistent/path/env"):
            result = ds._load_creds()
        self.assertEqual(result, ("https://env-var.supabase.co", "env-var-key"))
        self.assertEqual(ds.lines, [])

    def test_missing_env_file_notes_and_returns_none(self):
        missing_path = "/nonexistent/path/does-not-exist/env"
        with mock.patch.object(ds, "ENV_FILE", missing_path):
            result = ds._load_creds()
        self.assertIsNone(result)
        self.assertEqual(len(ds.lines), 1)
        level, message = ds.lines[0].split("\t", 1)
        self.assertEqual(level, "note")
        self.assertIn(missing_path, message)

    def test_env_file_missing_required_key_notes_and_returns_none(self):
        path = self._write_env_file("SUPABASE_URL=https://x.co\n")
        self.addCleanup(self._safe_remove, path)
        with mock.patch.object(ds, "ENV_FILE", path):
            result = ds._load_creds()
        self.assertIsNone(result)
        self.assertEqual(len(ds.lines), 1)
        level, message = ds.lines[0].split("\t", 1)
        self.assertEqual(level, "note")
        self.assertIn(path, message)

    def test_env_file_valid_is_parsed_with_comments_and_quotes(self):
        path = self._write_env_file(
            "# коментар\n\nSUPABASE_URL=\"https://x.co\"\nSUPABASE_SERVICE_KEY=key123\n"
        )
        self.addCleanup(self._safe_remove, path)
        with mock.patch.object(ds, "ENV_FILE", path):
            result = ds._load_creds()
        self.assertEqual(result, ("https://x.co", "key123"))
        self.assertEqual(ds.lines, [])


# ---------------------------------------------------------------------------
# 3'. Розбір OpenAPI-відповіді PostgREST (fetch_db_tables) — БЕЗ мережі:
#     _load_creds і urllib.request.urlopen завжди змокані.
# ---------------------------------------------------------------------------

class _FakeHttpResponse:
    def __init__(self, payload_bytes):
        self._payload_bytes = payload_bytes

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return self._payload_bytes


class FetchDbTablesOpenApiParsing(unittest.TestCase):
    def setUp(self):
        _clear_lines()
        self._creds_patch = mock.patch.object(ds, "_load_creds", return_value=("http://fake.invalid", "key"))
        self._creds_patch.start()
        self.addCleanup(self._creds_patch.stop)

    def _mock_urlopen_returning(self, doc):
        payload = json.dumps(doc).encode("utf-8")
        return mock.patch("urllib.request.urlopen", return_value=_FakeHttpResponse(payload))

    def test_valid_structure(self):
        doc = {"definitions": {"ideas": {"properties": {"id": {}, "title": {}}}}}
        with self._mock_urlopen_returning(doc):
            result = ds.fetch_db_tables()
        self.assertEqual(result, {"ideas": {"id", "title"}})

    def test_missing_definitions_key_warns_and_returns_none(self):
        doc = {"paths": {}}
        with self._mock_urlopen_returning(doc):
            result = ds.fetch_db_tables()
        self.assertIsNone(result)
        self.assertEqual(len(ds.lines), 1)
        level, message = ds.lines[0].split("\t", 1)
        self.assertEqual(level, "warn")
        self.assertIn("definitions", message)

    def test_definitions_not_a_dict_warns_and_returns_none(self):
        doc = {"definitions": ["not", "a", "dict"]}
        with self._mock_urlopen_returning(doc):
            result = ds.fetch_db_tables()
        self.assertIsNone(result)
        self.assertEqual(len(ds.lines), 1)
        self.assertTrue(ds.lines[0].startswith("warn\t"))

    def test_empty_properties_yields_empty_column_set_without_crash(self):
        doc = {"definitions": {"empty_table": {"properties": {}}}}
        with self._mock_urlopen_returning(doc):
            result = ds.fetch_db_tables()
        self.assertEqual(result, {"empty_table": set()})
        self.assertEqual(ds.lines, [])

    def test_properties_key_missing_entirely_yields_empty_set(self):
        doc = {"definitions": {"table_without_properties": {}}}
        with self._mock_urlopen_returning(doc):
            result = ds.fetch_db_tables()
        self.assertEqual(result, {"table_without_properties": set()})

    def test_non_dict_definition_entry_is_skipped(self):
        doc = {"definitions": {"weird": "not-a-dict", "ideas": {"properties": {"id": {}}}}}
        with self._mock_urlopen_returning(doc):
            result = ds.fetch_db_tables()
        self.assertEqual(result, {"ideas": {"id"}})
        self.assertNotIn("weird", result)

    def test_KNOWN_DEFECT_properties_as_a_list_crashes_instead_of_being_reported(self):
        """ВІДОМИЙ ДЕФЕКТ: `(props or {}).get("properties", {}).keys()`
        припускає, що "properties" — завжди dict. Якщо PostgREST (чи
        зіпсована відповідь) віддасть "properties" як список чи будь-що без
        .keys(), fetch_db_tables впаде необробленим AttributeError замість
        say("warn", ...) — на відміну від гілки "немає definitions" вище, тут
        немає жодного захисту, і виклик з main() впаде з traceback, а не
        видасть рівень/повідомлення в очікуваному контракті."""
        doc = {"definitions": {"ideas": {"properties": ["id", "title"]}}}
        with self._mock_urlopen_returning(doc), self.assertRaises(AttributeError):
            ds.fetch_db_tables()

    def test_KNOWN_DEFECT_properties_explicit_null_crashes(self):
        """Той самий дефект, інший тригер: properties: null у JSON стає
        Python None, і `.get("properties", {})` повертає саме None (ключ
        присутній), а не {} — .keys() падає так само."""
        doc = {"definitions": {"ideas": {"properties": None}}}
        with self._mock_urlopen_returning(doc), self.assertRaises(AttributeError):
            ds.fetch_db_tables()

    def test_http_error_warns_and_returns_none(self):
        with mock.patch(
            "urllib.request.urlopen",
            side_effect=urllib.error.HTTPError("http://fake.invalid", 500, "boom", None, None),
        ):
            result = ds.fetch_db_tables()
        self.assertIsNone(result)
        self.assertTrue(ds.lines[0].startswith("warn\t"))

    def test_url_error_warns_and_returns_none(self):
        with mock.patch("urllib.request.urlopen", side_effect=urllib.error.URLError("unreachable")):
            result = ds.fetch_db_tables()
        self.assertIsNone(result)
        self.assertTrue(ds.lines[0].startswith("warn\t"))

    def test_generic_os_error_warns_and_returns_none(self):
        # TimeoutError — підклас OSError, але НЕ urllib.error.URLError:
        # окрема except-гілка нижче за HTTPError/URLError.
        with mock.patch("urllib.request.urlopen", side_effect=TimeoutError("timed out")):
            result = ds.fetch_db_tables()
        self.assertIsNone(result)
        self.assertEqual(len(ds.lines), 1)
        level, message = ds.lines[0].split("\t", 1)
        self.assertEqual(level, "warn")
        self.assertIn("timed out", message)

    def test_non_json_response_warns_and_returns_none(self):
        with mock.patch("urllib.request.urlopen", return_value=_FakeHttpResponse(b"<html>not json</html>")):
            result = ds.fetch_db_tables()
        self.assertIsNone(result)
        self.assertTrue(ds.lines[0].startswith("warn\t"))

    def test_no_credentials_available_returns_none_without_any_urlopen_call(self):
        # Патч ds._load_creds із setUp тимчасово перекривається вкладеним —
        # по виходу з `with` відновлюється версія із setUp, addCleanup лишається коректним.
        with mock.patch.object(ds, "_load_creds", return_value=None), \
             mock.patch("urllib.request.urlopen", side_effect=AssertionError("мережевий виклик без креденшелів")):
            result = ds.fetch_db_tables()
        self.assertIsNone(result)


# ---------------------------------------------------------------------------
# 4'. Контракт виводу: кожен рядок — рівно "рівень<TAB>повідомлення",
#     рівень з відомого набору, повідомлення без символу табуляції всередині.
# ---------------------------------------------------------------------------

class OutputContract(unittest.TestCase):
    def setUp(self):
        _clear_lines()
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)

    def _run_main(self, schema_sql, db_tables):
        schema_path = os.path.join(self._tmpdir.name, "schema.sql")
        with open(schema_path, "w", encoding="utf-8") as handle:
            handle.write(schema_sql)
        with mock.patch.object(ds, "SCHEMA_FILE", schema_path), \
             mock.patch.object(ds, "fetch_db_tables", return_value=db_tables):
            ds.main()
        return list(ds.lines)

    def _assert_contract(self, lines):
        self.assertTrue(lines, "сценарій не згенерував жодного рядка — тест нічого не перевіряє")
        for line in lines:
            self.assertEqual(line.count("\t"), 1, f"рядок має рівно один TAB: {line!r}")
            level, message = line.split("\t")
            self.assertIn(level, KNOWN_LEVELS, f"невідомий рівень {level!r} у {line!r}")
            self.assertNotIn("\t", message, f"TAB усередині повідомлення: {line!r}")

    def test_contract_missing_table_scenario(self):
        _clear_lines()
        lines = self._run_main("create table ideas (id text primary key);", {})
        self._assert_contract(lines)

    def test_contract_extra_table_scenario(self):
        _clear_lines()
        lines = self._run_main(
            "create table ideas (id text primary key);",
            {"ideas": {"id"}, "legacy": {"col1", "col2"}},
        )
        self._assert_contract(lines)

    def test_contract_missing_and_extra_columns_scenario(self):
        _clear_lines()
        lines = self._run_main(
            "create table ideas (id text primary key, title text not null, gone text);",
            {"ideas": {"id", "title", "surprise_col"}},
        )
        self._assert_contract(lines)

    def test_contract_full_match_scenario(self):
        _clear_lines()
        lines = self._run_main(
            "create table ideas (id text primary key, title text not null);",
            {"ideas": {"id", "title"}},
        )
        self._assert_contract(lines)

    def test_contract_missing_schema_file_scenario(self):
        _clear_lines()
        with mock.patch.object(ds, "SCHEMA_FILE", os.path.join(self._tmpdir.name, "does-not-exist.sql")):
            ds.main()
        self._assert_contract(list(ds.lines))

    def test_contract_unparsed_note_scenario(self):
        _clear_lines()
        # drop table лишається нерозпізнаним -> рядок "note" із кількістю.
        schema_sql = "create table ideas (id text primary key);\ndrop table something_odd;"
        lines = self._run_main(schema_sql, {"ideas": {"id"}})
        self._assert_contract(lines)
        self.assertTrue(any(line.startswith("note\t") and "1 конструкц" in line for line in lines))


# ---------------------------------------------------------------------------
# Безпека на рівні модуля: жодного мережевого виклику чи читання файлів
# просто від import doctor_schema.
# ---------------------------------------------------------------------------

class ModuleImportIsSafe(unittest.TestCase):
    def test_reimport_does_not_touch_network(self):
        with mock.patch(
            "urllib.request.urlopen",
            side_effect=AssertionError("import doctor_schema не має ходити в мережу"),
        ):
            importlib.reload(ds)
        # main() і fetch_db_tables лишаються функціями, що самі нічого не
        # виконали під час імпорту — перевіряємо, що модуль досі робочий.
        self.assertTrue(callable(ds.main))
        self.assertTrue(callable(ds.fetch_db_tables))
        self.assertEqual(ds.lines, [])


if __name__ == "__main__":
    unittest.main()
