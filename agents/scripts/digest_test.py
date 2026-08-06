"""digest_test.py — юніт-тести для digest.py (тіло нічного дайджесту).

digest.py має __main__-захист — звичайний import безпечний. Усе зовнішнє
підмінене: db.* (Supabase), dashboard_base_url (Keychain + мережа) і
run_doctor (запускає doctor.sh) — mock.patch.object на самому модулі
digest, а не на джерельних модулях, бо digest імпортує їх іменами у свій
namespace (`from doctor_report import run_doctor`, `import db`).
"""

from __future__ import annotations

import json
import os
import subprocess
import unittest
import urllib.error
from datetime import datetime, timezone
from unittest import mock

import digest


def _urlopen_ctx(payload: dict) -> mock.MagicMock:
    response = mock.MagicMock()
    response.read.return_value = json.dumps(payload).encode()
    response.__enter__.return_value = response
    return response


class EscTest(unittest.TestCase):
    def test_ampersand_and_angle_brackets_escaped(self):
        self.assertEqual(digest.esc("<b>&x</b>"), "&lt;b&gt;&amp;x&lt;/b&gt;")

    def test_quotes_not_escaped(self):
        self.assertEqual(digest.esc('a "b"'), 'a "b"')

    def test_non_string_stringified(self):
        self.assertEqual(digest.esc(7), "7")


class DashboardBaseUrlTest(unittest.TestCase):
    def setUp(self):
        self._saved_env = os.environ.pop("IDEAS_SCOUT_DASHBOARD_URL", None)
        self.addCleanup(self._restore)

    def _restore(self):
        if self._saved_env is None:
            os.environ.pop("IDEAS_SCOUT_DASHBOARD_URL", None)
        else:
            os.environ["IDEAS_SCOUT_DASHBOARD_URL"] = self._saved_env

    def test_env_override_used_without_touching_network(self):
        os.environ["IDEAS_SCOUT_DASHBOARD_URL"] = "https://override.example/"
        with mock.patch.object(digest.subprocess, "run") as run, \
             mock.patch.object(digest.urllib.request, "urlopen") as urlopen:
            result = digest.dashboard_base_url()
        run.assert_not_called()
        urlopen.assert_not_called()
        self.assertEqual(result, "https://override.example")

    def test_env_override_whitespace_only_falls_back(self):
        os.environ["IDEAS_SCOUT_DASHBOARD_URL"] = "   "
        completed = subprocess.CompletedProcess(args=["security"], returncode=1, stdout="", stderr="")
        with mock.patch.object(digest.subprocess, "run", return_value=completed):
            result = digest.dashboard_base_url()
        self.assertEqual(result, "")

    def test_keychain_nonzero_returncode_returns_empty(self):
        completed = subprocess.CompletedProcess(args=["security"], returncode=1, stdout="", stderr="err")
        with mock.patch.object(digest.subprocess, "run", return_value=completed):
            result = digest.dashboard_base_url()
        self.assertEqual(result, "")

    def test_webhook_url_stripped_to_base(self):
        completed = subprocess.CompletedProcess(args=["security"], returncode=0, stdout="tok123\n", stderr="")
        response = _urlopen_ctx({"result": {"url": "https://foo.vercel.app/api/telegram/webhook"}})
        with mock.patch.object(digest.subprocess, "run", return_value=completed), \
             mock.patch.object(digest.urllib.request, "urlopen", return_value=response):
            result = digest.dashboard_base_url()
        self.assertEqual(result, "https://foo.vercel.app")

    def test_missing_url_key_in_result_returns_empty(self):
        completed = subprocess.CompletedProcess(args=["security"], returncode=0, stdout="tok123\n", stderr="")
        response = _urlopen_ctx({"result": {}})
        with mock.patch.object(digest.subprocess, "run", return_value=completed), \
             mock.patch.object(digest.urllib.request, "urlopen", return_value=response):
            result = digest.dashboard_base_url()
        self.assertEqual(result, "")

    def test_missing_result_key_entirely_returns_empty(self):
        completed = subprocess.CompletedProcess(args=["security"], returncode=0, stdout="tok123\n", stderr="")
        response = _urlopen_ctx({})
        with mock.patch.object(digest.subprocess, "run", return_value=completed), \
             mock.patch.object(digest.urllib.request, "urlopen", return_value=response):
            result = digest.dashboard_base_url()
        self.assertEqual(result, "")

    def test_url_error_returns_empty(self):
        completed = subprocess.CompletedProcess(args=["security"], returncode=0, stdout="tok123\n", stderr="")
        with mock.patch.object(digest.subprocess, "run", return_value=completed), \
             mock.patch.object(digest.urllib.request, "urlopen", side_effect=urllib.error.URLError("boom")):
            result = digest.dashboard_base_url()
        self.assertEqual(result, "")

    def test_bad_json_returns_empty(self):
        completed = subprocess.CompletedProcess(args=["security"], returncode=0, stdout="tok123\n", stderr="")
        response = mock.MagicMock()
        response.read.return_value = "не json".encode()
        response.__enter__.return_value = response
        with mock.patch.object(digest.subprocess, "run", return_value=completed), \
             mock.patch.object(digest.urllib.request, "urlopen", return_value=response):
            result = digest.dashboard_base_url()
        self.assertEqual(result, "")

    def test_subprocess_oserror_returns_empty(self):
        with mock.patch.object(digest.subprocess, "run", side_effect=OSError("no security binary")):
            result = digest.dashboard_base_url()
        self.assertEqual(result, "")

    def test_hook_without_expected_suffix_returns_empty(self):
        # РАНІШЕ (ВІДОМИЙ ДЕФЕКТ): split() на відсутньому маркері не різав
        # нічого — повертався ВЕСЬ hook як "базова адреса", хоча "/other/path"
        # тут явно не /api/telegram/webhook і не має жодного стосунку до
        # порталу. Тепер відсутність очікуваного суфіксу — сигнал "не той
        # хук", і функція повертає "" (посилання в дайджесті просто пропустяться).
        completed = subprocess.CompletedProcess(args=["security"], returncode=0, stdout="tok123\n", stderr="")
        response = _urlopen_ctx({"result": {"url": "https://foo.vercel.app/other/path/"}})
        with mock.patch.object(digest.subprocess, "run", return_value=completed), \
             mock.patch.object(digest.urllib.request, "urlopen", return_value=response):
            result = digest.dashboard_base_url()
        self.assertEqual(result, "")


class IdeaLineTest(unittest.TestCase):
    def test_no_base_url_plain_bullet(self):
        line = digest.idea_line({"id": "42", "title": "Ідея"}, "")
        self.assertEqual(line, "• 42 — Ідея")

    def test_with_base_url_produces_link(self):
        line = digest.idea_line({"id": "42", "title": "Ідея"}, "https://dash.example")
        self.assertEqual(line, '• <a href="https://dash.example/ideas/42">42 — Ідея</a>')

    def test_missing_title_placeholder(self):
        line = digest.idea_line({"id": "1"}, "")
        self.assertEqual(line, "• 1 — (без назви)")

    def test_missing_id_placeholder(self):
        line = digest.idea_line({"title": "Х"}, "")
        self.assertEqual(line, "• ? — Х")

    def test_title_html_escaped(self):
        line = digest.idea_line({"id": "1", "title": "<b>жирний</b>"}, "")
        self.assertIn("&lt;b&gt;жирний&lt;/b&gt;", line)

    def test_id_with_slash_percent_quoted_in_href(self):
        line = digest.idea_line({"id": "a/b", "title": "Т"}, "https://d.example")
        self.assertIn("/ideas/a%2Fb", line)


class FindingsSectionTest(unittest.TestCase):
    def test_empty_ideas(self):
        out = digest.findings_section([], "")
        self.assertEqual(out, ["<b>Знахідки за добу</b>", "Нових карток немає."])

    def test_known_tracks_sorted_before_unknown(self):
        ideas = [
            {"id": "1", "title": "T1", "track": "unknown-track", "status": "new"},
            {"id": "2", "title": "T2", "track": "app-ideas", "status": "new"},
        ]
        out = digest.findings_section(ideas, "")
        joined = "\n".join(out)
        self.assertLess(joined.index("Мобільні застосунки"), joined.index("unknown-track"))

    def test_rejected_pushed_to_end(self):
        ideas = [
            {"id": "1", "title": "T1", "track": "app-ideas", "status": "rejected"},
            {"id": "2", "title": "T2", "track": "app-ideas", "status": "new"},
        ]
        out = digest.findings_section(ideas, "")
        joined = "\n".join(out)
        self.assertLess(joined.index("Нові, ще без аналізу"), joined.index("Відхилені"))

    def test_unknown_status_placed_before_rejected(self):
        ideas = [
            {"id": "1", "title": "T1", "track": "app-ideas", "status": "rejected"},
            {"id": "2", "title": "T2", "track": "app-ideas", "status": "totally-unknown"},
        ]
        out = digest.findings_section(ideas, "")
        joined = "\n".join(out)
        self.assertLess(joined.index("totally-unknown"), joined.index("Відхилені"))

    def test_missing_track_and_status_default_to_dash(self):
        ideas = [{"id": "1", "title": "T1"}]
        out = digest.findings_section(ideas, "")
        joined = "\n".join(out)
        self.assertIn("—", joined)

    def test_per_group_truncates_and_reports_remainder(self):
        ideas = [
            {"id": str(i), "title": f"T{i}", "track": "app-ideas", "status": "new"}
            for i in range(5)
        ]
        out = digest.findings_section(ideas, "", per_group=2)
        joined = "\n".join(out)
        self.assertIn("…ще 3 — решта в порталі", joined)
        self.assertEqual(sum(1 for line in out if line.startswith("• ")), 2)

    def test_per_group_none_shows_all(self):
        ideas = [
            {"id": str(i), "title": f"T{i}", "track": "app-ideas", "status": "new"}
            for i in range(5)
        ]
        out = digest.findings_section(ideas, "", per_group=None)
        joined = "\n".join(out)
        self.assertNotIn("решта в порталі", joined)
        self.assertEqual(sum(1 for line in out if line.startswith("• ")), 5)

    def test_header_includes_total_count(self):
        ideas = [{"id": "1", "title": "T", "track": "app-ideas", "status": "new"}]
        out = digest.findings_section(ideas, "")
        self.assertEqual(out[0], "<b>Знахідки за добу — 1</b>")


class BuildWindowBoundaryTest(unittest.TestCase):
    """Межі 24-годинного вікна: since обчислюється як now - WINDOW_H."""

    def test_since_is_window_hours_before_now(self):
        fixed_now = datetime(2026, 8, 5, 12, 0, 0, tzinfo=timezone.utc)

        class _FixedDatetime(datetime):
            @classmethod
            def now(cls, tz=None):
                return fixed_now

        with mock.patch.object(digest, "datetime", _FixedDatetime), \
             mock.patch.object(digest.db, "get_ideas_created_since", return_value=[]) as get_ideas, \
             mock.patch.object(digest.db, "count_ideas_updated_since", return_value=0), \
             mock.patch.object(digest, "dashboard_base_url", return_value=""), \
             mock.patch.object(digest, "run_doctor", return_value="✅ <b>Здоров'я системи</b>"):
            digest.build()
        get_ideas.assert_called_once_with("2026-08-04T12:00:00Z")


class BuildTest(unittest.TestCase):
    def test_empty_period_no_ideas_no_updates(self):
        with mock.patch.object(digest.db, "get_ideas_created_since", return_value=[]), \
             mock.patch.object(digest.db, "count_ideas_updated_since", return_value=0), \
             mock.patch.object(digest, "dashboard_base_url", return_value=""), \
             mock.patch.object(digest, "run_doctor", return_value="✅ <b>Здоров'я системи</b>"):
            result = digest.build()
        self.assertEqual(result["created"], 0)
        self.assertEqual(result["updated"], 0)
        self.assertIn("Нових карток немає.", result["text"])

    def test_missing_data_get_ideas_dberror_reported_in_tail(self):
        with mock.patch.object(digest.db, "get_ideas_created_since", side_effect=digest.db.DbError("недоступно")), \
             mock.patch.object(digest.db, "count_ideas_updated_since", return_value=0), \
             mock.patch.object(digest, "dashboard_base_url", return_value=""), \
             mock.patch.object(digest, "run_doctor", return_value="✅ <b>Здоров'я системи</b>"):
            result = digest.build()
        self.assertEqual(result["created"], 0)
        self.assertIn("не вдалось прочитати ideas: недоступно", result["text"])

    def test_missing_data_count_updated_dberror_yields_zero_not_negative(self):
        with mock.patch.object(digest.db, "get_ideas_created_since", return_value=[]), \
             mock.patch.object(digest.db, "count_ideas_updated_since", side_effect=digest.db.DbError("х")), \
             mock.patch.object(digest, "dashboard_base_url", return_value=""), \
             mock.patch.object(digest, "run_doctor", return_value="✅ <b>Здоров'я системи</b>"):
            result = digest.build()
        # count_ideas_updated_since впав -> updated = -1 усередині, але назовні max(updated, 0).
        self.assertEqual(result["updated"], 0)
        self.assertNotIn("Оновлено вже наявних карток", result["text"])

    def test_updated_positive_shown_in_tail(self):
        with mock.patch.object(digest.db, "get_ideas_created_since", return_value=[]), \
             mock.patch.object(digest.db, "count_ideas_updated_since", return_value=7), \
             mock.patch.object(digest, "dashboard_base_url", return_value=""), \
             mock.patch.object(digest, "run_doctor", return_value="✅ <b>Здоров'я системи</b>"):
            result = digest.build()
        self.assertEqual(result["updated"], 7)
        self.assertIn("Оновлено вже наявних карток: 7", result["text"])

    def test_created_count_matches_full_ideas_list_even_if_trimmed(self):
        ideas = [
            {"id": str(i), "title": f"T{i}", "track": "app-ideas", "status": "new", "created_at": "x"}
            for i in range(50)
        ]
        with mock.patch.object(digest.db, "get_ideas_created_since", return_value=ideas), \
             mock.patch.object(digest.db, "count_ideas_updated_since", return_value=0), \
             mock.patch.object(digest, "dashboard_base_url", return_value=""), \
             mock.patch.object(digest, "run_doctor", return_value="✅ <b>Здоров'я системи</b>"):
            result = digest.build()
        self.assertEqual(result["created"], 50)

    def test_huge_report_trimmed_to_telegram_limit(self):
        ideas = [
            {
                "id": f"idea-{i:04d}-" + "x" * 40,
                "title": "Дуже довга назва картки " + "x" * 60,
                "track": "app-ideas",
                "status": "new",
            }
            for i in range(200)
        ]
        with mock.patch.object(digest.db, "get_ideas_created_since", return_value=ideas), \
             mock.patch.object(digest.db, "count_ideas_updated_since", return_value=0), \
             mock.patch.object(digest, "dashboard_base_url", return_value=""), \
             mock.patch.object(digest, "run_doctor", return_value="✅ <b>Здоров'я системи</b>"):
            result = digest.build()
        self.assertLessEqual(len(result["text"]), digest.TG_TEXT_LIMIT)
        self.assertEqual(result["created"], 200)

    def test_health_block_appended_at_end(self):
        with mock.patch.object(digest.db, "get_ideas_created_since", return_value=[]), \
             mock.patch.object(digest.db, "count_ideas_updated_since", return_value=0), \
             mock.patch.object(digest, "dashboard_base_url", return_value=""), \
             mock.patch.object(digest, "run_doctor", return_value="🔴 <b>На що глянути</b>\nпроблема") as run_doctor:
            result = digest.build()
        run_doctor.assert_called_once_with(warnings_only=True)
        self.assertTrue(result["text"].rstrip().endswith("проблема"))


if __name__ == "__main__":
    unittest.main()
