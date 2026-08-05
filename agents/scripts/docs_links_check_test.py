"""docs_links_check_test.py — тести для docs_links_check.py.

Як і в migrations_check.py, більшість функцій — чисті (текст → результат),
тому основна маса тестів працює на синтетичних рядках і тимчасових каталогах,
без диску реального репозиторію. RealRepositoryTest — виняток, навмисний:
задача explicitly просить перевірити, що на справжніх README.md/AGENTS.md/
docs/*.md/shared/contracts.md результат чистий (без err).
"""

from __future__ import annotations

import os
import tempfile
import unittest

import docs_links_check as dlc

KNOWN_LEVELS = {"ok", "warn", "err", "note"}


def levels_of(messages):
    return [level for level, _ in messages]


# ---------------------------------------------------------------------------
# Гниття посилань — extract_*
# ---------------------------------------------------------------------------

class ExtractMdLinksTest(unittest.TestCase):
    def test_relative_link_extracted(self):
        self.assertEqual(dlc.extract_md_links("[план](./PLAN.md) і ще"), ["./PLAN.md"])

    def test_external_url_skipped(self):
        self.assertEqual(dlc.extract_md_links("[тут](https://example.com/x)"), [])

    def test_anchor_only_skipped(self):
        self.assertEqual(dlc.extract_md_links("[тут](#section)"), [])

    def test_anchor_suffix_stripped(self):
        self.assertEqual(dlc.extract_md_links("[тут](./PLAN.md#section)"), ["./PLAN.md"])

    def test_mailto_skipped(self):
        self.assertEqual(dlc.extract_md_links("[тут](mailto:a@b.com)"), [])


class ExtractPathCandidatesTest(unittest.TestCase):
    def test_file_with_known_extension(self):
        self.assertEqual(dlc.extract_path_candidates("рядок `agents/scripts/db.sh` тут"), ["agents/scripts/db.sh"])

    def test_directory_trailing_slash(self):
        self.assertEqual(dlc.extract_path_candidates("каталог `agents/scripts/` тут"), ["agents/scripts/"])

    def test_external_url_in_backticks_skipped(self):
        self.assertEqual(dlc.extract_path_candidates("`https://example.com/foo.sh`"), [])

    def test_fragment_with_space_skipped(self):
        # Приклад команди, не шлях: launchctl bootstrap gui/$UID <plist>
        self.assertEqual(dlc.extract_path_candidates("`launchctl bootstrap gui/$UID <plist>`"), [])

    def test_bare_identifier_without_extension_not_a_candidate(self):
        self.assertEqual(dlc.extract_path_candidates("поле `rejection_code` тут"), [])

    def test_ext_chain_shorthand_split_into_two(self):
        # "runner.sh/monitor.sh" у прозі — "runner.sh або monitor.sh", не
        # вкладений шлях.
        self.assertEqual(
            sorted(dlc.extract_path_candidates("`runner.sh`/`monitor.sh` більше не")),
            ["monitor.sh", "runner.sh"],
        )

    def test_permission_scope_suffix_stripped(self):
        self.assertEqual(
            dlc.extract_path_candidates("`Bash(agents/scripts/db.sh:*)`"),
            ["agents/scripts/db.sh"],
        )

    def test_trailing_punctuation_stripped(self):
        self.assertEqual(dlc.extract_path_candidates("див. `shared/schema.sql`."), ["shared/schema.sql"])

    def test_templated_path_kept_as_candidate(self):
        self.assertEqual(
            dlc.extract_path_candidates("`agents/criteria/criteria-<track>.md`"),
            ["agents/criteria/criteria-<track>.md"],
        )


class StripFencesTest(unittest.TestCase):
    def test_fenced_block_removed(self):
        text = "перед\n```\nagents/\n  db.sh   # (runner.sh/monitor.sh)\n```\nпісля `db.sh`"
        stripped = dlc._strip_fences(text)
        self.assertNotIn("runner.sh/monitor.sh", stripped)
        self.assertIn("після", stripped)

    def test_no_fence_unchanged(self):
        text = "рядок без жодного fence"
        self.assertEqual(dlc._strip_fences(text), text)


# ---------------------------------------------------------------------------
# check_links — на синтетичному тимчасовому дереві файлів
# ---------------------------------------------------------------------------

class CheckLinksTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = self._tmp.name
        self._orig_root = dlc.REPO_ROOT
        dlc.REPO_ROOT = self.root

    def tearDown(self):
        dlc.REPO_ROOT = self._orig_root

    def _write(self, rel_path: str, content: str) -> None:
        abs_path = os.path.join(self.root, rel_path)
        os.makedirs(os.path.dirname(abs_path), exist_ok=True)
        with open(abs_path, "w", encoding="utf-8") as handle:
            handle.write(content)

    def test_consistent_state_no_errors(self):
        self._write("agents/scripts/db.sh", "#!/usr/bin/env bash\n")
        self._write("README.md", "Дивись `agents/scripts/db.sh` — доступ до бази.\n")
        messages = dlc.check_links(["README.md"])
        self.assertNotIn("err", levels_of(messages))
        self.assertTrue(any(level == "ok" for level, _ in messages))

    def test_broken_link_is_err(self):
        self._write("README.md", "[план](./PLAN.md) — насправді файлу немає.\n")
        messages = dlc.check_links(["README.md"])
        self.assertIn("err", levels_of(messages))
        self.assertTrue(any("PLAN.md" in msg for level, msg in messages if level == "err"))

    def test_broken_backtick_file_path_is_err(self):
        self._write("README.md", "Читай `agents/scripts/ghost.sh` для деталей.\n")
        messages = dlc.check_links(["README.md"])
        self.assertIn("err", levels_of(messages))

    def test_ambiguous_bare_filename_is_note(self):
        self._write("agents/scripts/doctor.sh", "#!/usr/bin/env bash\n")
        self._write("AGENTS.md", "Запусти `doctor.sh` без каталогу.\n")
        messages = dlc.check_links(["AGENTS.md"])
        self.assertNotIn("err", levels_of(messages))
        self.assertIn("note", levels_of(messages))

    def test_missing_directory_is_note_not_err(self):
        self._write("README.md", "Каталог `logs/runs/reddit-cache/` — рантайм.\n")
        messages = dlc.check_links(["README.md"])
        self.assertNotIn("err", levels_of(messages))
        self.assertIn("note", levels_of(messages))

    def test_templated_path_is_note(self):
        self._write("shared/contracts.md", "Файл `agents/criteria/criteria-<track>.md` для треку.\n")
        messages = dlc.check_links(["shared/contracts.md"])
        self.assertNotIn("err", levels_of(messages))
        self.assertIn("note", levels_of(messages))

    def test_dashboard_src_prefix_fallback_is_note_not_err(self):
        self._write("dashboard/src/lib/deep-research.ts", "export {};\n")
        self._write("docs/plans/x.md", "Дивись `lib/deep-research.ts` тут.\n")
        messages = dlc.check_links(["docs/plans/x.md"])
        self.assertNotIn("err", levels_of(messages))
        self.assertTrue(any("dashboard/src/" in msg for level, msg in messages if level == "note"))

    def test_many_notes_collapsed_into_one(self):
        self._write("agents/scripts/a.sh", "")
        self._write("agents/scripts/b.sh", "")
        self._write("agents/scripts/c.sh", "")
        self._write("agents/scripts/d.sh", "")
        self._write(
            "README.md",
            "Читай `a.sh`, `b.sh`, `c.sh` і `d.sh` без каталогу.\n",
        )
        messages = dlc.check_links(["README.md"])
        note_lines = [msg for level, msg in messages if level == "note"]
        self.assertEqual(len(note_lines), 1)
        self.assertTrue(note_lines[0].startswith("4 "))

    def test_unreadable_doc_is_err(self):
        messages = dlc.check_links(["nonexistent.md"])
        self.assertIn("err", levels_of(messages))


# ---------------------------------------------------------------------------
# check_enum_claims — дрейф фактів contracts.md проти schema.sql
# ---------------------------------------------------------------------------

CONTRACTS_FIXTURE = """
## Статуси ідеї (`status`) і що вони означають практично

- **`new`** — щойно зібрана.
- **`accepted`** — власник визнав ідею годною.

## Що таке "ідея"

- **`mechanic`** — сама схема.
- **`niche`** — конкретна реалізація.

## Наступний розділ
"""

SCHEMA_FIXTURE = """
create table ideas (
  id text primary key,
  status text not null check (status in ('new', 'accepted')),
  type text not null check (type in ('mechanic', 'niche'))
);
"""


class CheckEnumClaimsTest(unittest.TestCase):
    def test_matching_enum_is_ok(self):
        messages = dlc.check_enum_claims(CONTRACTS_FIXTURE, SCHEMA_FIXTURE)
        by_label = {msg.split(":", 1)[0]: level for level, msg in messages}
        self.assertEqual(by_label["ideas.status"], "ok")
        self.assertEqual(by_label["ideas.type"], "ok")

    def test_mismatched_enum_is_err(self):
        schema = SCHEMA_FIXTURE.replace("'new', 'accepted'", "'new', 'accepted', 'rejected'")
        messages = dlc.check_enum_claims(CONTRACTS_FIXTURE, schema)
        status_msgs = [(level, msg) for level, msg in messages if msg.startswith("ideas.status")]
        self.assertEqual(len(status_msgs), 1)
        level, msg = status_msgs[0]
        self.assertEqual(level, "err")
        self.assertIn("rejected", msg)

    def test_missing_heading_is_note(self):
        messages = dlc.check_enum_claims("немає потрібного заголовка тут", SCHEMA_FIXTURE)
        status_msgs = [(level, msg) for level, msg in messages if msg.startswith("ideas.status")]
        self.assertEqual(status_msgs[0][0], "note")

    def test_no_check_in_schema_is_note(self):
        schema = "create table ideas (id text primary key, status text);"
        messages = dlc.check_enum_claims(CONTRACTS_FIXTURE, schema)
        status_msgs = [(level, msg) for level, msg in messages if msg.startswith("ideas.status")]
        self.assertEqual(status_msgs[0][0], "note")


class RejectionCodeSectionBoundaryTest(unittest.TestCase):
    """rejection_code — ALL-CAPS backtick-токени лише в межах секції
    чек-листа, а не будь-де в документі (regression-тест на реальний
    випадок: IDEAS_SCOUT_DEEP_RESEARCH_DRY_RUN в іншій секції не мав
    зіпсувати звірку)."""

    def test_out_of_section_all_caps_not_picked_up(self):
        contracts = """
## Чек-лист оцінки і коди відмов (`rejection_code`)

| # | Код відмови |
|---|---|
| 0 | `LEGAL` |

## Наступний розділ

Прапорець `SOME_OTHER_FLAG` тут не стосується rejection_code.
"""
        schema = """
create table ideas (
  id text primary key,
  rejection_code text check (rejection_code in ('LEGAL'))
);
"""
        messages = dlc.check_enum_claims(contracts, schema)
        rej_msgs = [(level, msg) for level, msg in messages if msg.startswith("ideas.rejection_code")]
        self.assertEqual(rej_msgs[0][0], "ok")


class JobAllowlistTest(unittest.TestCase):
    WORKER_FIXTURE = """
const JOB_HANDLERS = Object.freeze({
  infrastructure_dry_run: Object.freeze({
    executable: "x",
  }),
  telegram_update: Object.freeze({
    executable: "y",
  }),
});
"""

    CONTRACTS_FIXTURE = """
Дозволені типи:

- `infrastructure_dry_run` — тест;
- `telegram_update` — оновлення.

## Наступний розділ
"""

    def test_extracts_handler_keys(self):
        self.assertEqual(
            dlc.extract_job_allowlist(self.WORKER_FIXTURE),
            frozenset({"infrastructure_dry_run", "telegram_update"}),
        )

    def test_matching_allowlist_is_ok(self):
        level, _msg = dlc.check_job_allowlist(self.CONTRACTS_FIXTURE, self.WORKER_FIXTURE)
        self.assertEqual(level, "ok")

    def test_worker_has_undocumented_type_is_err(self):
        worker = self.WORKER_FIXTURE.replace(
            "telegram_update: Object.freeze({",
            "telegram_update: Object.freeze({\n  }),\n  telegram_nudge: Object.freeze({",
        )
        level, msg = dlc.check_job_allowlist(self.CONTRACTS_FIXTURE, worker)
        self.assertEqual(level, "err")
        self.assertIn("telegram_nudge", msg)

    def test_missing_worker_file_is_err(self):
        level, _msg = dlc.check_job_allowlist(self.CONTRACTS_FIXTURE, None)
        self.assertEqual(level, "err")


class ReadmeTableListTest(unittest.TestCase):
    def test_matching_list_is_ok(self):
        readme = "  schema.sql                    # DDL: ideas, sources\n"
        schema = "create table ideas (id text);\ncreate table sources (id text);\n"
        level, _msg = dlc.check_readme_table_list(readme, schema)
        self.assertEqual(level, "ok")

    def test_missing_table_in_readme_is_err(self):
        readme = "  schema.sql                    # DDL: ideas\n"
        schema = "create table ideas (id text);\ncreate table sources (id text);\n"
        level, msg = dlc.check_readme_table_list(readme, schema)
        self.assertEqual(level, "err")
        self.assertIn("sources", msg)

    def test_no_ddl_line_is_note(self):
        level, _msg = dlc.check_readme_table_list("нема такого рядка тут", "create table ideas (id text);")
        self.assertEqual(level, "note")


# ---------------------------------------------------------------------------
# run() — контракт рівнів
# ---------------------------------------------------------------------------

class RunContractTest(unittest.TestCase):
    def test_all_levels_known(self):
        messages = dlc.run()
        self.assertTrue(messages)
        for level, _msg in messages:
            self.assertIn(level, KNOWN_LEVELS)

    def test_no_tabs_or_newlines_inside_message(self):
        for _level, msg in dlc.run():
            self.assertNotIn("\t", msg)
            self.assertNotIn("\n", msg)


# ---------------------------------------------------------------------------
# Реальний репозиторій — задача explicitly просить перевірити його
# ---------------------------------------------------------------------------

class RealRepositoryTest(unittest.TestCase):
    def test_real_docs_have_no_broken_links(self):
        files = dlc.doc_files()
        messages = dlc.check_links(files)
        errors = [msg for level, msg in messages if level == "err"]
        self.assertEqual(errors, [], f"биті посилання в документації: {errors}")

    def test_real_contracts_facts_match_schema(self):
        contracts_text = dlc.read_text(dlc.CONTRACTS_FILE)
        schema_text = dlc.read_text(dlc.SCHEMA_FILE)
        self.assertIsNotNone(contracts_text)
        self.assertIsNotNone(schema_text)
        messages = dlc.check_enum_claims(contracts_text, schema_text)
        errors = [msg for level, msg in messages if level == "err"]
        self.assertEqual(errors, [], f"contracts.md розійшовся зі schema.sql: {errors}")

    def test_real_job_allowlist_matches(self):
        contracts_text = dlc.read_text(dlc.CONTRACTS_FILE)
        worker_text = dlc.read_text(dlc.WORKER_FILE)
        level, msg = dlc.check_job_allowlist(contracts_text, worker_text)
        self.assertEqual(level, "ok", msg)

    def test_real_readme_table_list_matches(self):
        readme_text = dlc.read_text(dlc.README_FILE)
        schema_text = dlc.read_text(dlc.SCHEMA_FILE)
        level, msg = dlc.check_readme_table_list(readme_text, schema_text)
        self.assertEqual(level, "ok", msg)


if __name__ == "__main__":
    unittest.main()
