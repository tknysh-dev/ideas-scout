"""db_test.py — юніт-тести для db.py (PostgREST-шар).

`db._request` завжди підмінений через unittest.mock.patch — жоден тест не
має права піти в реальний Supabase. Якщо колись з'явиться тест, що викликає
db._request без підміни, він впаде на DbError (немає env-файлу) чи піде в
мережу — обидва варіанти неприйнятні.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock

import db


class AlignBulkTest(unittest.TestCase):
    def test_homogeneous_rows_untouched(self):
        rows = [{"a": 1, "b": 2}, {"a": 3, "b": 4}]
        result = db._align_bulk(rows)
        self.assertEqual(result, rows)
        self.assertIs(result, rows)

    def test_different_key_sets_aligned_with_none(self):
        rows = [{"a": 1, "b": 2}, {"a": 3, "c": 5}]
        result = db._align_bulk(rows)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0], {"a": 1, "b": 2, "c": None})
        self.assertEqual(result[1], {"a": 3, "b": None, "c": 5})

    def test_missing_keys_filled_as_none(self):
        rows = [{"a": 1}, {"a": 2, "b": 3}]
        result = db._align_bulk(rows)
        self.assertEqual(result[0], {"a": 1, "b": None})
        self.assertEqual(result[1], {"a": 2, "b": 3})

    def test_single_row_untouched(self):
        rows = [{"a": 1, "b": 2}]
        result = db._align_bulk(rows)
        self.assertIs(result, rows)

    def test_empty_list_untouched(self):
        rows = []
        result = db._align_bulk(rows)
        self.assertIs(result, rows)

    def test_list_of_non_dicts_untouched(self):
        rows = ["a", "b"]
        result = db._align_bulk(rows)
        self.assertIs(result, rows)

    def test_mixed_dict_and_non_dict_untouched(self):
        # не-словник у пакеті — узгодження недоречне, функція здається
        rows = [{"a": 1}, "b"]
        result = db._align_bulk(rows)
        self.assertIs(result, rows)

    def test_nested_values_preserved(self):
        rows = [
            {"a": [1, 2], "b": {"x": 1}},
            {"a": [3, 4]},
        ]
        result = db._align_bulk(rows)
        self.assertEqual(result[0], {"a": [1, 2], "b": {"x": 1}})
        self.assertEqual(result[1], {"a": [3, 4], "b": None})

    def test_does_not_mutate_input_list_or_dicts(self):
        rows = [{"a": 1, "b": 2}, {"a": 3}]
        snapshot = [dict(r) for r in rows]
        result = db._align_bulk(rows)
        self.assertEqual(rows, snapshot)  # вхідні рядки не змінились
        self.assertIsNot(result, rows)  # повернуто новий список


class LoadEnvTest(unittest.TestCase):
    def setUp(self):
        db._env_cache = None
        self._saved_environ = {}
        for key in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY"):
            self._saved_environ[key] = os.environ.pop(key, None)

    def tearDown(self):
        db._env_cache = None
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
        self.addCleanup(self._safe_remove, path)
        return path

    def test_valid_file_parsed(self):
        path = self._write_env_file(
            "SUPABASE_URL=https://example.supabase.co\n"
            "SUPABASE_SERVICE_KEY=secret123\n"
        )
        with mock.patch.object(db, "ENV_FILE", path):
            env = db._load_env()
        self.assertEqual(env["SUPABASE_URL"], "https://example.supabase.co")
        self.assertEqual(env["SUPABASE_SERVICE_KEY"], "secret123")

    def test_missing_file_raises(self):
        missing_path = "/nonexistent/path/does-not-exist/env"
        with mock.patch.object(db, "ENV_FILE", missing_path), self.assertRaises(db.DbError) as ctx:
            db._load_env()
        self.assertIn(missing_path, str(ctx.exception))

    def test_empty_file_raises(self):
        path = self._write_env_file("")
        with mock.patch.object(db, "ENV_FILE", path), self.assertRaises(db.DbError):
            db._load_env()

    def test_comments_and_blank_lines_ignored(self):
        path = self._write_env_file(
            "# коментар\n"
            "\n"
            "SUPABASE_URL=https://example.supabase.co\n"
            "# ще коментар\n"
            "SUPABASE_SERVICE_KEY=secret123\n"
        )
        with mock.patch.object(db, "ENV_FILE", path):
            env = db._load_env()
        self.assertEqual(env["SUPABASE_URL"], "https://example.supabase.co")
        self.assertEqual(env["SUPABASE_SERVICE_KEY"], "secret123")

    def test_value_with_equals_sign_kept_whole(self):
        # partition() ріже по ПЕРШОМУ "=" — решта лишається у значенні
        path = self._write_env_file(
            "SUPABASE_URL=https://example.supabase.co\n"
            "SUPABASE_SERVICE_KEY=abc=def=123\n"
        )
        with mock.patch.object(db, "ENV_FILE", path):
            env = db._load_env()
        self.assertEqual(env["SUPABASE_SERVICE_KEY"], "abc=def=123")

    def test_quoted_values_unquoted(self):
        path = self._write_env_file(
            'SUPABASE_URL="https://example.supabase.co"\n'
            "SUPABASE_SERVICE_KEY='secret123'\n"
        )
        with mock.patch.object(db, "ENV_FILE", path):
            env = db._load_env()
        self.assertEqual(env["SUPABASE_URL"], "https://example.supabase.co")
        self.assertEqual(env["SUPABASE_SERVICE_KEY"], "secret123")

    def test_whitespace_around_key_and_value_stripped(self):
        path = self._write_env_file(
            "  SUPABASE_URL =  https://example.supabase.co  \n"
            "SUPABASE_SERVICE_KEY=secret123\n"
        )
        with mock.patch.object(db, "ENV_FILE", path):
            env = db._load_env()
        self.assertEqual(env["SUPABASE_URL"], "https://example.supabase.co")

    def test_missing_required_key_raises(self):
        path = self._write_env_file("SUPABASE_URL=https://example.supabase.co\n")
        with mock.patch.object(db, "ENV_FILE", path), self.assertRaises(db.DbError):
            db._load_env()

    def test_env_vars_take_priority_over_file(self):
        os.environ["SUPABASE_URL"] = "https://env-var.supabase.co"
        os.environ["SUPABASE_SERVICE_KEY"] = "env-var-key"
        path = self._write_env_file(
            "SUPABASE_URL=https://file.supabase.co\nSUPABASE_SERVICE_KEY=file-key\n"
        )
        with mock.patch.object(db, "ENV_FILE", path):
            env = db._load_env()
        self.assertEqual(env["SUPABASE_URL"], "https://env-var.supabase.co")
        self.assertEqual(env["SUPABASE_SERVICE_KEY"], "env-var-key")

    def test_result_is_cached_across_calls(self):
        path = self._write_env_file(
            "SUPABASE_URL=https://example.supabase.co\nSUPABASE_SERVICE_KEY=secret123\n"
        )
        with mock.patch.object(db, "ENV_FILE", path):
            env1 = db._load_env()
            self._safe_remove(path)  # файл зник, але кеш має вижити
            env2 = db._load_env()
        self.assertIs(env1, env2)


class InsertInboxTest(unittest.TestCase):
    @mock.patch.object(db, "_request")
    def test_minimal_payload(self, mock_request):
        mock_request.return_value = [{"draft_id": "d1"}]
        result = db.insert_inbox("d1", "2024-01-01T00:00:00Z", "текст ідеї")
        mock_request.assert_called_once_with(
            "POST",
            "/inbox",
            {
                "draft_id": "d1",
                "submitted_at": "2024-01-01T00:00:00Z",
                "raw_text": "текст ідеї",
                "source": "telegram",
            },
        )
        self.assertEqual(result, {"draft_id": "d1"})

    @mock.patch.object(db, "_request")
    def test_optional_fields_included_when_truthy(self, mock_request):
        mock_request.return_value = [{"draft_id": "d1"}]
        db.insert_inbox(
            "d1", "2024-01-01T00:00:00Z", "текст", source="manual",
            track="b2b", mode="quick", target_card_id="c1",
        )
        called_body = mock_request.call_args[0][2]
        self.assertEqual(called_body["source"], "manual")
        self.assertEqual(called_body["track"], "b2b")
        self.assertEqual(called_body["mode"], "quick")
        self.assertEqual(called_body["target_card_id"], "c1")

    @mock.patch.object(db, "_request")
    def test_falsy_optional_fields_omitted(self, mock_request):
        mock_request.return_value = [{"draft_id": "d1"}]
        db.insert_inbox("d1", "2024-01-01T00:00:00Z", "текст", track="", mode=None)
        called_body = mock_request.call_args[0][2]
        self.assertNotIn("track", called_body)
        self.assertNotIn("mode", called_body)

    @mock.patch.object(db, "_request")
    def test_returns_empty_dict_when_no_rows(self, mock_request):
        mock_request.return_value = []
        result = db.insert_inbox("d1", "2024-01-01T00:00:00Z", "текст")
        self.assertEqual(result, {})


class UpdateInboxTest(unittest.TestCase):
    @mock.patch.object(db, "_request")
    def test_builds_patch_request(self, mock_request):
        mock_request.return_value = [{"draft_id": "d1", "status": "done"}]
        result = db.update_inbox("d1", status="done")
        mock_request.assert_called_once_with(
            "PATCH", "/inbox?draft_id=eq.d1", {"status": "done"}
        )
        self.assertEqual(result, {"draft_id": "d1", "status": "done"})

    @mock.patch.object(db, "_request")
    def test_none_fields_filtered_out(self, mock_request):
        mock_request.return_value = [{"draft_id": "d1"}]
        db.update_inbox("d1", status="done", track=None)
        mock_request.assert_called_once_with(
            "PATCH", "/inbox?draft_id=eq.d1", {"status": "done"}
        )

    @mock.patch.object(db, "_request")
    def test_no_fields_skips_request_entirely(self, mock_request):
        result = db.update_inbox("d1")
        mock_request.assert_not_called()
        self.assertEqual(result, {})

    @mock.patch.object(db, "_request")
    def test_all_none_fields_skip_request(self, mock_request):
        result = db.update_inbox("d1", status=None, track=None)
        mock_request.assert_not_called()
        self.assertEqual(result, {})

    @mock.patch.object(db, "_request")
    def test_draft_id_is_url_quoted(self, mock_request):
        mock_request.return_value = []
        db.update_inbox("d/1 x", status="done")
        mock_request.assert_called_once_with(
            "PATCH", "/inbox?draft_id=eq.d%2F1%20x", {"status": "done"}
        )


class GetInboxTest(unittest.TestCase):
    @mock.patch.object(db, "_request")
    def test_builds_get_request(self, mock_request):
        mock_request.return_value = [{"draft_id": "d1"}]
        result = db.get_inbox("d1")
        mock_request.assert_called_once_with("GET", "/inbox?draft_id=eq.d1&select=*")
        self.assertEqual(result, {"draft_id": "d1"})

    @mock.patch.object(db, "_request")
    def test_returns_none_when_no_rows(self, mock_request):
        mock_request.return_value = []
        result = db.get_inbox("d1")
        self.assertIsNone(result)


class GetRecentIdeasTest(unittest.TestCase):
    @mock.patch.object(db, "_request")
    def test_default_limit(self, mock_request):
        mock_request.return_value = [{"id": 1}]
        result = db.get_recent_ideas()
        mock_request.assert_called_once_with(
            "GET",
            "/ideas?select=id,title,status,track,updated_at&order=updated_at.desc&limit=5",
        )
        self.assertEqual(result, [{"id": 1}])

    @mock.patch.object(db, "_request")
    def test_custom_limit(self, mock_request):
        mock_request.return_value = []
        db.get_recent_ideas(limit=10)
        mock_request.assert_called_once_with(
            "GET",
            "/ideas?select=id,title,status,track,updated_at&order=updated_at.desc&limit=10",
        )

    @mock.patch.object(db, "_request")
    def test_returns_empty_list_when_request_returns_none(self, mock_request):
        mock_request.return_value = None
        result = db.get_recent_ideas()
        self.assertEqual(result, [])


class GetIdeasCreatedSinceTest(unittest.TestCase):
    @mock.patch.object(db, "_request")
    def test_builds_request(self, mock_request):
        mock_request.return_value = [{"id": 1}]
        result = db.get_ideas_created_since("2024-01-01T00:00:00Z")
        mock_request.assert_called_once_with(
            "GET",
            "/ideas?select=id,title,status,track,created_at"
            "&created_at=gte.2024-01-01T00%3A00%3A00Z"
            "&order=track.asc,created_at.desc",
        )
        self.assertEqual(result, [{"id": 1}])

    @mock.patch.object(db, "_request")
    def test_returns_empty_list_when_none(self, mock_request):
        mock_request.return_value = None
        result = db.get_ideas_created_since("2024-01-01T00:00:00Z")
        self.assertEqual(result, [])


class CountIdeasUpdatedSinceTest(unittest.TestCase):
    @mock.patch.object(db, "_request")
    def test_builds_request_and_counts(self, mock_request):
        mock_request.return_value = [{"id": 1}, {"id": 2}]
        result = db.count_ideas_updated_since("2024-01-01T00:00:00Z")
        mock_request.assert_called_once_with(
            "GET",
            "/ideas?select=id"
            "&updated_at=gte.2024-01-01T00%3A00%3A00Z"
            "&created_at=lt.2024-01-01T00%3A00%3A00Z",
        )
        self.assertEqual(result, 2)

    @mock.patch.object(db, "_request")
    def test_returns_zero_when_none(self, mock_request):
        mock_request.return_value = None
        result = db.count_ideas_updated_since("2024-01-01T00:00:00Z")
        self.assertEqual(result, 0)


class GetLastRunsTest(unittest.TestCase):
    @mock.patch.object(db, "_request")
    def test_default_limit(self, mock_request):
        mock_request.return_value = [{"run_id": "r1"}]
        result = db.get_last_runs()
        mock_request.assert_called_once_with(
            "GET",
            "/runs?select=run_id,job,track,status,finished_at&order=started_at.desc&limit=20",
        )
        self.assertEqual(result, [{"run_id": "r1"}])

    @mock.patch.object(db, "_request")
    def test_custom_limit(self, mock_request):
        mock_request.return_value = []
        db.get_last_runs(limit=3)
        mock_request.assert_called_once_with(
            "GET",
            "/runs?select=run_id,job,track,status,finished_at&order=started_at.desc&limit=3",
        )

    @mock.patch.object(db, "_request")
    def test_returns_empty_list_when_none(self, mock_request):
        mock_request.return_value = None
        result = db.get_last_runs()
        self.assertEqual(result, [])


class GetLastRunTest(unittest.TestCase):
    @mock.patch.object(db, "_request")
    def test_without_track(self, mock_request):
        mock_request.return_value = [{"run_id": "r1"}]
        result = db.get_last_run("deep-research")
        mock_request.assert_called_once_with(
            "GET",
            "/runs?select=*&job=eq.deep-research&order=started_at.desc&limit=1",
        )
        self.assertEqual(result, {"run_id": "r1"})

    @mock.patch.object(db, "_request")
    def test_with_track(self, mock_request):
        mock_request.return_value = [{"run_id": "r1"}]
        db.get_last_run("deep-research", track="b2b")
        mock_request.assert_called_once_with(
            "GET",
            "/runs?select=*&job=eq.deep-research&track=eq.b2b&order=started_at.desc&limit=1",
        )

    @mock.patch.object(db, "_request")
    def test_returns_none_when_no_rows(self, mock_request):
        mock_request.return_value = []
        result = db.get_last_run("deep-research")
        self.assertIsNone(result)


class NowIsoTest(unittest.TestCase):
    def test_format_matches_pattern(self):
        result = db._now_iso()
        self.assertRegex(result, r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

    def test_uses_utc_and_exact_format(self):
        captured_tz = []

        class FixedDatetime(db.datetime):
            @classmethod
            def now(cls, tz=None):
                captured_tz.append(tz)
                return cls(2024, 3, 4, 5, 6, 7, tzinfo=tz)

        with mock.patch.object(db, "datetime", FixedDatetime):
            result = db._now_iso()
        self.assertEqual(result, "2024-03-04T05:06:07Z")
        self.assertEqual(captured_tz, [db.timezone.utc])


if __name__ == "__main__":
    unittest.main()
