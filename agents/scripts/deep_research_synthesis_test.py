"""Тести оркестрації синтезу з deep-research.py: run_synthesis_stage і все,
що навколо неї — run_llm, load_idea, load_model_reports, save_synthesis_report,
supersede, write_event.

Санітизатори й чисті функції (sanitize_*, extract_json_block, build_idea_updates
саму по собі) уже покриті deep_research_sanitize_test.py / deep_research_json_test.py
/ deep_research_text_test.py — тут не дублюємо, а перевіряємо, ЩО САМЕ
оркестрація передає в db._request (метод/шлях/тіло) і як стан ідеї в БД
реагує на кожен зі шляхів відмови LLM. db._request і run_llm завжди підмінені
через unittest.mock — жоден тест не ходить у мережу, у Supabase чи в
підпроцес (правило з deep_research_sanitize_test.py тримається і тут).

Модуль завантажується через test_support.load_script (дефіс у назві файлу
ламає звичайний import); саме завантаження безпечне — deep-research.py має
`if __name__ == "__main__"`.
"""

from __future__ import annotations

import io
import json
import subprocess
import unittest
from datetime import datetime, timezone
from unittest import mock

from test_support import load_script

dr = load_script("deep-research.py")

IDEA_ID = "PI-0013"
RUN_ID = "run-abc123"
TODAY = "2026-08-05"

ALL_APP_KEYS = dr.BASE_KEYS_BY_TRACK["app-ideas"] + dr.DEEP_KEYS


# ---------------------------------------------------------------------------
# Побудова вхідних даних
# ---------------------------------------------------------------------------

def base_idea(**overrides):
    row = {
        "id": IDEA_ID, "title": "Трекер підписок", "type": "app", "track": "app-ideas",
        "status": "approved_pending", "signal_type": "reddit",
        "rejection_code": None, "rejection_detail": None, "rejection_codes_extra": None,
        "confidence": None, "ceiling_estimate": None, "launch_effort_hours": None,
        "ceiling_flag": None, "claimed_revenue": None, "mechanic_summary": "механіка",
        "monetization_hypothesis": "гіпотеза", "criteria_version": "v0.0-old",
        "research_depth": None,
        "body": "## Аналіз за критеріями\n\nстарий аналіз\n\n## Конкуренти\n\nстарі конкуренти",
    }
    row.update(overrides)
    return row


def model_report(provider, criteria_keys=ALL_APP_KEYS, verdict="passed", status="ok"):
    criteria = [
        {"criterion_key": k, "verdict": verdict, "score": "B", "summary": "ок",
         "detail": "деталі", "evidence": []}
        for k in criteria_keys
    ]
    payload = json.dumps({"criteria": criteria}, ensure_ascii=False)
    return {"provider": provider, "model": "gpt-x", "status": status,
            "report_md": f"Нотатки дослідника.\n\n```json\n{payload}\n```\n"}


def synthesis_a_output(criteria_keys=ALL_APP_KEYS, verdict="passed", idea_updates=None):
    """Вивід виклику A (llm-invoke.sh), придатний для extract_json_block."""
    criteria = [
        {"criterion_key": k, "verdict": verdict, "score": "B", "summary": "фінальний вердикт",
         "detail": "деталі синтезу", "resolution": "consensus", "evidence": []}
        for k in criteria_keys
    ]
    payload = {"criteria": criteria, "idea_updates": idea_updates or {}}
    return "Дослідження прогалин виконано.\n\n```json\n" + json.dumps(payload, ensure_ascii=False) + "\n```\n"


def synthesis_b_output(competitors=None, criteria_section="## Аналіз за критеріями\n\nновий текст",
                        competitors_section="## Конкуренти\n\nновий текст",
                        saturation_alert=False, saturation_note=None, summary="глибоке дослідження завершено"):
    payload = {
        "competitors": competitors if competitors is not None else [{"name": "Acme"}],
        "criteria_section_md": criteria_section,
        "competitors_section_md": competitors_section,
        "saturation_alert": saturation_alert,
        "summary": summary,
    }
    if saturation_note is not None:
        payload["saturation_note"] = saturation_note
    return "Текст картки готовий.\n\n```json\n" + json.dumps(payload, ensure_ascii=False) + "\n```\n"


class FakeDb:
    """Маршрутизатор db._request за (метод, шлях) для тестів run_synthesis_stage.

    Не намагається бути повноцінною БД — лише повертає заготовлені відповіді
    й записує кожен виклик, щоб тест міг перевірити ЩО САМЕ (метод, шлях,
    тіло) оркестрація туди надіслала. Непередбачений виклик — це сигнал, що
    оркестрація почала ходити кудись, чого тест не очікував, тож падає гучно,
    а не повертає щось випадкове.
    """

    def __init__(self, idea=None, sources=None, reports=None,
                 research_report_id="rr-1", ideas_missing=False):
        self.calls: list[tuple[str, str, object]] = []
        self.idea = idea
        self.sources = sources if sources is not None else []
        self.reports = reports if reports is not None else []
        self.research_report_id = research_report_id
        self.ideas_missing = ideas_missing

    def __call__(self, method, path, body=None):
        self.calls.append((method, path, body))
        if method == "GET" and path.startswith("/ideas?id=eq."):
            return [] if self.ideas_missing else [self.idea]
        if method == "GET" and path.startswith("/sources?idea_id=eq."):
            return self.sources
        if method == "GET" and path.startswith("/research_reports?idea_id=eq.") and "kind=eq.model" in path:
            return self.reports
        if method == "PATCH" and path.startswith("/research_reports?idea_id=eq.") \
                and path.endswith("superseded_at=is.null"):
            return None
        if method == "POST" and path == "/research_reports":
            return [{"id": self.research_report_id}]
        if method == "PATCH" and path.startswith(f"/research_reports?id=eq.{self.research_report_id}"):
            return [{"id": self.research_report_id}]
        if method == "PATCH" and path.startswith("/criteria_verdicts?idea_id=eq.") \
                and path.endswith("superseded_at=is.null"):
            return None
        if method == "POST" and path == "/criteria_verdicts":
            return body
        if method == "PATCH" and path.startswith("/ideas?id=eq."):
            return [dict(self.idea or {}, **(body or {}))]
        if method == "POST" and path == "/events":
            return [{"id": "ev-1"}]
        if method == "PATCH" and path.startswith("/competitors?idea_id=eq.") \
                and path.endswith("superseded_at=is.null"):
            return None
        if method == "POST" and path == "/competitors":
            return body
        raise AssertionError(f"непередбачений виклик db._request: {method} {path} body={body}")

    def calls_for(self, method, path_prefix):
        return [(m, p, b) for m, p, b in self.calls if m == method and p.startswith(path_prefix)]


def patched(fake_db, llm_side_effect):
    """Контекст-менеджер: db._request і run_llm підмінені одним викликом."""
    return (
        mock.patch.object(dr.db, "_request", side_effect=fake_db),
        mock.patch.object(dr, "run_llm", side_effect=llm_side_effect),
    )


# ---------------------------------------------------------------------------
# run_synthesis_stage — щасливий шлях
# ---------------------------------------------------------------------------

class RunSynthesisStageHappyPathTest(unittest.TestCase):
    def setUp(self):
        self.fake = FakeDb(
            idea=base_idea(),
            reports=[model_report("chatgpt"), model_report("gemini")],
        )
        self.output_a = synthesis_a_output(idea_updates={
            "confidence": "high", "ceiling_estimate": "$5k/міс", "launch_effort_hours": 40,
        })
        self.output_b = synthesis_b_output(competitors=[
            {"name": "Rich Co", "url": "https://rich.example", "pricing": "$9/міс",
             "liveness": "active", "last_activity": "2026-06-01", "strengths": "трафік",
             "weaknesses": "ціна", "differentiation": "нема", "evidence": []},
            {"name": "Sparse Co"},  # навмисно без опційних полів
        ])
        patch_db, patch_llm = patched(self.fake, [(0, self.output_a), (0, self.output_b)])
        self.mock_db = patch_db.start()
        self.addCleanup(patch_db.stop)
        self.mock_llm = patch_llm.start()
        self.addCleanup(patch_llm.stop)
        env_patch = mock.patch.dict(dr.os.environ, {"RUNNER_CLAUDE_MODEL": "claude-opus-5"})
        env_patch.start()
        self.addCleanup(env_patch.stop)

        dr.run_synthesis_stage(IDEA_ID, RUN_ID, TODAY)

    def test_run_llm_called_twice_with_claude_provider_and_own_timeouts(self):
        self.assertEqual(self.mock_llm.call_count, 2)
        call_a, call_b = self.mock_llm.call_args_list
        self.assertEqual(call_a.args[0], "claude")
        self.assertEqual(call_a.args[2], dr.SYNTHESIS_TIMEOUT_S)
        self.assertEqual(call_b.args[0], "claude")
        self.assertEqual(call_b.args[2], dr.CARD_TIMEOUT_S)

    def test_criteria_verdicts_batch_has_uniform_key_set(self):
        """Ключовий ризик PGRST102: пакетний POST у /criteria_verdicts мусить
        мати ОДНАКОВИЙ набір ключів у кожному рядку."""
        posts = self.fake.calls_for("POST", "/criteria_verdicts")
        self.assertEqual(len(posts), 1)
        rows = posts[0][2]
        self.assertEqual(len(rows), len(ALL_APP_KEYS))
        key_sets = {frozenset(row) for row in rows}
        self.assertEqual(len(key_sets), 1, f"набори ключів розійшлись: {key_sets}")
        self.assertEqual(key_sets.pop(), {
            "criterion_key", "verdict", "score", "summary", "detail", "resolution", "evidence",
            "idea_id", "run_id", "stage", "kind", "provider", "model", "criteria_version",
        })
        self.assertTrue(all(row["idea_id"] == IDEA_ID and row["run_id"] == RUN_ID
                             and row["stage"] == "deep" and row["kind"] == "synthesis"
                             and row["provider"] == "claude" and row["model"] == "claude-opus-5"
                             for row in rows))

    def test_criteria_verdicts_superseded_before_insert(self):
        supersede_calls = self.fake.calls_for("PATCH", "/criteria_verdicts?idea_id=eq.")
        self.assertEqual(len(supersede_calls), 1)
        self.assertIn("stage=eq.deep", supersede_calls[0][1])
        self.assertIn("kind=eq.synthesis", supersede_calls[0][1])
        self.assertIn("superseded_at", supersede_calls[0][2])

    def test_competitors_batch_is_NOT_key_homogeneous_by_itself(self):
        """СУМНІВНО (документована відома поведінка, не лагодимо тут):
        run_synthesis_stage передає в db._request рядки конкурентів як є —
        вирівнювання ключів (db._align_bulk) живе всередині РЕАЛЬНОГО
        db._request, який у цьому тесті підмінений повністю. Тобто той самий
        сценарій, що двічі ламав PGRST102, і досі можливий на межі
        run_synthesis_stage -> db._request, якщо колись хтось замінить
        db._request на щось без вирівнювання."""
        posts = self.fake.calls_for("POST", "/competitors")
        self.assertEqual(len(posts), 1)
        rows = posts[0][2]
        self.assertEqual(len(rows), 2)
        key_sets = [frozenset(row) for row in rows]
        self.assertNotEqual(key_sets[0], key_sets[1])
        self.assertTrue(all(row["idea_id"] == IDEA_ID and row["run_id"] == RUN_ID for row in rows))

    def test_competitors_superseded_before_insert(self):
        supersede_calls = self.fake.calls_for("PATCH", "/competitors?idea_id=eq.")
        self.assertEqual(len(supersede_calls), 1)

    def test_ideas_patched_twice_first_after_call_a(self):
        patches = self.fake.calls_for("PATCH", "/ideas?id=eq.")
        self.assertEqual(len(patches), 2)
        first_body = patches[0][2]
        self.assertEqual(first_body["status"], "approved_pending")
        self.assertIsNone(first_body["rejection_code"])
        self.assertIsNone(first_body["rejection_detail"])
        self.assertEqual(first_body["confidence"], "high")
        self.assertEqual(first_body["ceiling_estimate"], "$5k/міс")
        self.assertEqual(first_body["launch_effort_hours"], 40)
        self.assertEqual(first_body["research_depth"], "deep")
        self.assertEqual(first_body["deep_research_run_id"], RUN_ID)
        self.assertEqual(first_body["verdict_provider"], "multi")
        self.assertEqual(first_body["verdict_model"], "synthesis:claude+chatgpt+gemini")
        self.assertEqual(first_body["verdict_run_id"], RUN_ID)
        self.assertEqual(first_body["criteria_version"], "v0.1")
        self.assertRegex(first_body["deep_researched_at"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

    def test_ideas_second_patch_carries_card_body_without_ceiling_flag(self):
        patches = self.fake.calls_for("PATCH", "/ideas?id=eq.")
        second_body = patches[1][2]
        self.assertIn("body", second_body)
        self.assertIn("новий текст", second_body["body"])
        self.assertNotIn("ceiling_flag", second_body)
        self.assertNotIn("review_condition", second_body)

    def test_events_written_twice_with_expected_reasons(self):
        posts = self.fake.calls_for("POST", "/events")
        self.assertEqual(len(posts), 2)
        first, second = (p[2] for p in posts)
        self.assertEqual(first["change"], "research_depth: initial -> deep; status: approved_pending -> approved_pending")
        self.assertEqual(first["reason"], "Усі фатальні критерії пройдено; зведено звіти: chatgpt, gemini.")
        self.assertEqual(first["run_id"], RUN_ID)
        self.assertEqual(second["reason"], "глибоке дослідження завершено")
        self.assertIn("конкуренти: 2 у реєстрі", second["change"])

    def test_research_report_created_then_updated_in_place(self):
        posts = self.fake.calls_for("POST", "/research_reports")
        self.assertEqual(len(posts), 1)
        # третій аргумент POST /research_reports — список з одного рядка (PostgREST body)
        self.assertEqual(posts[0][2][0]["status"], "ok")
        self.assertEqual(posts[0][2][0]["report_md"], self.output_a)
        patches = self.fake.calls_for("PATCH", "/research_reports?id=eq.rr-1")
        self.assertEqual(len(patches), 1)
        self.assertEqual(patches[0][2]["status"], "ok")
        self.assertIn(self.output_a, patches[0][2]["report_md"])
        self.assertIn(self.output_b, patches[0][2]["report_md"])

    def test_research_reports_superseded_before_first_insert(self):
        supersede_calls = self.fake.calls_for("PATCH", "/research_reports?idea_id=eq.")
        self.assertEqual(len(supersede_calls), 1)
        self.assertIn("kind=eq.synthesis", supersede_calls[0][1])


class RunSynthesisStageSaturationTest(unittest.TestCase):
    """saturation_alert з виклику B піднімає ceiling_flag, не перевертаючи вердикт."""

    def test_saturation_alert_sets_ceiling_flag_review_on_second_patch(self):
        fake = FakeDb(idea=base_idea(), reports=[model_report("chatgpt")])
        output_a = synthesis_a_output()
        output_b = synthesis_b_output(saturation_alert=True, saturation_note="зʼявився сильний конкурент")
        patch_db, patch_llm = patched(fake, [(0, output_a), (0, output_b)])
        with patch_db, patch_llm:
            dr.run_synthesis_stage(IDEA_ID, RUN_ID, TODAY)
        second_body = fake.calls_for("PATCH", "/ideas?id=eq.")[1][2]
        self.assertEqual(second_body["ceiling_flag"], "review")
        self.assertEqual(second_body["review_condition"], "зʼявився сильний конкурент")


class RunSynthesisStageFatalCriterionTest(unittest.TestCase):
    """build_idea_updates у зв'язці з фатальним критерієм — перевіряємо, як
    вердикт доїжджає саме до тіла PATCH /ideas і до тексту події."""

    def test_failed_fatal_criterion_rejects_idea_in_db_patch_and_event(self):
        fake = FakeDb(idea=base_idea(status="approved_pending"), reports=[model_report("chatgpt")])
        criteria = [{"criterion_key": k, "verdict": "failed" if k == "0" else "passed",
                     "score": "D", "summary": "ні", "detail": "деталі", "resolution": "consensus",
                     "evidence": []} for k in ALL_APP_KEYS]
        output_a = "```json\n" + json.dumps({"criteria": criteria, "idea_updates": {}}) + "\n```"
        output_b = synthesis_b_output()
        patch_db, patch_llm = patched(fake, [(0, output_a), (0, output_b)])
        with patch_db, patch_llm:
            dr.run_synthesis_stage(IDEA_ID, RUN_ID, TODAY)
        first_body = fake.calls_for("PATCH", "/ideas?id=eq.")[0][2]
        self.assertEqual(first_body["status"], "rejected")
        self.assertEqual(first_body["rejection_code"], "NO_MONETIZATION")
        first_event = fake.calls_for("POST", "/events")[0][2]
        self.assertIn("Провалено фатальні критерії 0 (код NO_MONETIZATION)", first_event["reason"])


# ---------------------------------------------------------------------------
# run_synthesis_stage — відмови: головне, ЩО СТАНЕТЬСЯ ЗІ СТАНОМ ІДЕЇ
# ---------------------------------------------------------------------------

class RunSynthesisStageFailureTest(unittest.TestCase):
    def test_idea_not_found_raises_before_any_other_query(self):
        fake = FakeDb(ideas_missing=True)
        patch_db, patch_llm = patched(fake, [])
        with patch_db, patch_llm as mock_llm, \
             self.assertRaises(SystemExit) as ctx:
            dr.run_synthesis_stage(IDEA_ID, RUN_ID, TODAY)
        self.assertIn(IDEA_ID, str(ctx.exception))
        mock_llm.assert_not_called()
        # лише один запит: GET /ideas — до sources/research_reports справа не дійшла
        self.assertEqual(len(fake.calls), 1)

    def test_empty_model_reports_raises_and_touches_nothing(self):
        fake = FakeDb(idea=base_idea(), reports=[])
        patch_db, patch_llm = patched(fake, [])
        with patch_db, patch_llm as mock_llm, self.assertRaises(SystemExit):
            dr.run_synthesis_stage(IDEA_ID, RUN_ID, TODAY)
        mock_llm.assert_not_called()
        self.assertEqual(fake.calls_for("PATCH", "/ideas?id=eq."), [])
        self.assertEqual(fake.calls_for("POST", "/events"), [])

    def test_all_reports_search_unavailable_raises_before_llm_call(self):
        fake = FakeDb(idea=base_idea(), reports=[
            {"provider": "chatgpt", "model": "gpt", "status": "ok", "report_md": "SEARCH UNAVAILABLE"},
        ])
        patch_db, patch_llm = patched(fake, [])
        with patch_db, patch_llm as mock_llm, self.assertRaises(SystemExit) as ctx:
            dr.run_synthesis_stage(IDEA_ID, RUN_ID, TODAY)
        self.assertIn("картку не змінено", str(ctx.exception))
        mock_llm.assert_not_called()
        self.assertEqual(fake.calls_for("PATCH", "/ideas?id=eq."), [])

    def test_call_a_garbage_without_json_saves_error_report_leaves_idea_untouched(self):
        fake = FakeDb(idea=base_idea(), reports=[model_report("chatgpt")])
        garbage = "Провів дослідження, але забув покласти JSON у відповідь."
        patch_db, patch_llm = patched(fake, [(0, garbage)])
        with patch_db, patch_llm, self.assertRaises(SystemExit) as ctx:
            dr.run_synthesis_stage(IDEA_ID, RUN_ID, TODAY)
        self.assertIn("виклик A не повернув валідних вердиктів", str(ctx.exception))
        posts = fake.calls_for("POST", "/research_reports")
        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0][2][0]["status"], "error")
        self.assertEqual(posts[0][2][0]["report_md"], garbage)
        # стан ідеї не чіпається взагалі: жодного PATCH, жодної події, жодних вердиктів
        self.assertEqual(fake.calls_for("PATCH", "/ideas?id=eq."), [])
        self.assertEqual(fake.calls_for("POST", "/events"), [])
        self.assertEqual(fake.calls_for("POST", "/criteria_verdicts"), [])

    def test_call_a_timeout_exit_code_saved_as_timeout_status(self):
        fake = FakeDb(idea=base_idea(), reports=[model_report("chatgpt")])
        patch_db, patch_llm = patched(fake, [(124, "[оркестратор] claude перевищив жорсткий таймаут 2820с")])
        with patch_db, patch_llm, self.assertRaises(SystemExit):
            dr.run_synthesis_stage(IDEA_ID, RUN_ID, TODAY)
        posts = fake.calls_for("POST", "/research_reports")
        self.assertEqual(posts[0][2][0]["status"], "timeout")

    def test_call_b_failure_leaves_verdicts_committed_but_card_untouched(self):
        """Найдорожчий сценарій: виклик A уже переписав вердикти й статус
        ідеї в базі, а виклик B провалився — картка (текст, конкуренти)
        лишається зі старими даними, але статус уже змінений."""
        fake = FakeDb(idea=base_idea(), reports=[model_report("chatgpt")])
        output_a = synthesis_a_output()
        patch_db, patch_llm = patched(fake, [(0, output_a), (124, "виклик B згорів на таймауті")])
        with patch_db, patch_llm, self.assertRaises(SystemExit) as ctx:
            dr.run_synthesis_stage(IDEA_ID, RUN_ID, TODAY)
        self.assertIn("вердикти синтезу вже записані", str(ctx.exception))
        # виклик A встиг: вердикти записані, ідея й подія оновлені один раз
        self.assertEqual(len(fake.calls_for("POST", "/criteria_verdicts")), 1)
        ideas_patches = fake.calls_for("PATCH", "/ideas?id=eq.")
        self.assertEqual(len(ideas_patches), 1)
        self.assertEqual(ideas_patches[0][2]["status"], "approved_pending")
        self.assertEqual(len(fake.calls_for("POST", "/events")), 1)
        # виклик B не встиг: жодних конкурентів, жодного другого PATCH /ideas
        self.assertEqual(fake.calls_for("POST", "/competitors"), [])
        report_patches = fake.calls_for("PATCH", "/research_reports?id=eq.rr-1")
        self.assertEqual(report_patches[0][2]["status"], "timeout")

    def test_call_b_returns_no_competitors_leaves_old_list_untouched(self):
        fake = FakeDb(idea=base_idea(), reports=[model_report("chatgpt")])
        output_a = synthesis_a_output()
        output_b = synthesis_b_output(competitors=[])
        patch_db, patch_llm = patched(fake, [(0, output_a), (0, output_b)])
        with patch_db, patch_llm:
            dr.run_synthesis_stage(IDEA_ID, RUN_ID, TODAY)
        self.assertEqual(fake.calls_for("POST", "/competitors"), [])
        self.assertEqual(fake.calls_for("PATCH", "/competitors?idea_id=eq."), [])
        second_event = fake.calls_for("POST", "/events")[1][2]
        self.assertIn("конкуренти: 0 у реєстрі", second_event["change"])


# ---------------------------------------------------------------------------
# run_llm
# ---------------------------------------------------------------------------

class RunLlmTest(unittest.TestCase):
    def test_success_no_stderr_returns_stdout_verbatim(self):
        completed = subprocess.CompletedProcess(args=["x"], returncode=0, stdout="усе добре", stderr="")
        with mock.patch.object(dr.subprocess, "run", return_value=completed):
            code, output = dr.run_llm("claude", "промпт", 600)
        self.assertEqual(code, 0)
        self.assertEqual(output, "усе добре")

    def test_nonempty_stderr_appended_after_stdout(self):
        completed = subprocess.CompletedProcess(args=["x"], returncode=0, stdout="вивід", stderr="попередження")
        with mock.patch.object(dr.subprocess, "run", return_value=completed):
            _, output = dr.run_llm("claude", "промпт", 600)
        self.assertEqual(output, "вивід\n[stderr]\nпопередження")

    def test_whitespace_only_stderr_not_appended(self):
        completed = subprocess.CompletedProcess(args=["x"], returncode=0, stdout="вивід", stderr="   \n")
        with mock.patch.object(dr.subprocess, "run", return_value=completed):
            _, output = dr.run_llm("claude", "промпт", 600)
        self.assertEqual(output, "вивід")

    def test_nonzero_exit_code_propagated(self):
        completed = subprocess.CompletedProcess(args=["x"], returncode=3, stdout="частковий вивід", stderr="")
        with mock.patch.object(dr.subprocess, "run", return_value=completed):
            code, output = dr.run_llm("claude", "промпт", 600)
        self.assertEqual(code, 3)
        self.assertEqual(output, "частковий вивід")

    def test_empty_stdout_and_stderr_returns_empty_string(self):
        completed = subprocess.CompletedProcess(args=["x"], returncode=0, stdout="", stderr="")
        with mock.patch.object(dr.subprocess, "run", return_value=completed):
            code, output = dr.run_llm("claude", "промпт", 600)
        self.assertEqual((code, output), (0, ""))

    def test_timeout_expired_returns_124_with_provider_and_deadline_in_message(self):
        with mock.patch.object(dr.subprocess, "run",
                                side_effect=subprocess.TimeoutExpired(cmd=["x"], timeout=720)):
            code, output = dr.run_llm("claude", "промпт", 600)
        self.assertEqual(code, 124)
        self.assertIn("claude", output)
        self.assertIn("720", output)  # timeout_s + 120

    def test_oserror_returns_127_with_error_in_message(self):
        with mock.patch.object(dr.subprocess, "run", side_effect=OSError("нема такого файлу")):
            code, output = dr.run_llm("claude", "промпт", 600)
        self.assertEqual(code, 127)
        self.assertIn("не вдалося запустити llm-invoke.sh", output)
        self.assertIn("нема такого файлу", output)

    def test_subprocess_invoked_with_expected_argv_and_kwargs(self):
        completed = subprocess.CompletedProcess(args=["x"], returncode=0, stdout="ok", stderr="")
        with mock.patch.object(dr.subprocess, "run", return_value=completed) as run:
            dr.run_llm("claude", "текст промпту", 600)
        run.assert_called_once_with(
            [dr.LLM_INVOKE, "run", "claude", "--timeout", "600"],
            input="текст промпту", capture_output=True, text=True, timeout=720, check=False,
        )


# ---------------------------------------------------------------------------
# load_idea
# ---------------------------------------------------------------------------

class LoadIdeaTest(unittest.TestCase):
    @mock.patch.object(dr.db, "_request")
    def test_success_returns_idea_track_and_sources(self, mock_request):
        idea_row = base_idea()
        mock_request.side_effect = [[idea_row], [{"url": "https://x.test"}]]
        idea, track, sources = dr.load_idea(IDEA_ID)
        self.assertEqual(idea, idea_row)
        self.assertEqual(track, "app-ideas")
        self.assertEqual(sources, [{"url": "https://x.test"}])
        mock_request.assert_any_call("GET", f"/ideas?id=eq.{IDEA_ID}&select=*")
        mock_request.assert_any_call("GET", f"/sources?idea_id=eq.{IDEA_ID}&select=*")

    @mock.patch.object(dr.db, "_request")
    def test_idea_not_found_raises_with_id_in_message(self, mock_request):
        mock_request.return_value = []
        with self.assertRaises(SystemExit) as ctx:
            dr.load_idea(IDEA_ID)
        self.assertIn(IDEA_ID, str(ctx.exception))
        mock_request.assert_called_once()  # sources GET не викликається

    @mock.patch.object(dr.db, "_request")
    def test_unknown_track_raises(self, mock_request):
        mock_request.return_value = [base_idea(track="totally-unknown-track")]
        with self.assertRaises(SystemExit) as ctx:
            dr.load_idea(IDEA_ID)
        self.assertIn("totally-unknown-track", str(ctx.exception))

    @mock.patch.object(dr.db, "_request")
    def test_status_not_owner_decidable_raises(self, mock_request):
        mock_request.return_value = [base_idea(status="new")]
        with self.assertRaises(SystemExit) as ctx:
            dr.load_idea(IDEA_ID)
        self.assertIn("new", str(ctx.exception))

    @mock.patch.object(dr.db, "_request")
    def test_sources_none_becomes_empty_list(self, mock_request):
        mock_request.side_effect = [[base_idea()], None]
        _, _, sources = dr.load_idea(IDEA_ID)
        self.assertEqual(sources, [])

    @mock.patch.object(dr.db, "_request")
    def test_idea_id_is_url_quoted(self, mock_request):
        mock_request.side_effect = [[base_idea(id="PI/0013 x")], []]
        dr.load_idea("PI/0013 x")
        mock_request.assert_any_call("GET", "/ideas?id=eq.PI%2F0013%20x&select=*")


# ---------------------------------------------------------------------------
# load_model_reports
# ---------------------------------------------------------------------------

class LoadModelReportsTest(unittest.TestCase):
    @mock.patch.object(dr.db, "_request")
    def test_builds_expected_query(self, mock_request):
        mock_request.return_value = []
        dr.load_model_reports(IDEA_ID)
        mock_request.assert_called_once_with(
            "GET",
            f"/research_reports?idea_id=eq.{IDEA_ID}&stage=eq.deep_criteria&kind=eq.model"
            "&superseded_at=is.null"
            "&select=provider,model,status,report_md&order=provider.asc",
        )

    @mock.patch.object(dr.db, "_request")
    def test_filters_out_non_ok_status_and_missing_report_md(self, mock_request):
        mock_request.return_value = [
            {"provider": "chatgpt", "status": "ok", "report_md": "текст"},
            {"provider": "gemini", "status": "error", "report_md": "текст"},
            {"provider": "grok", "status": "ok", "report_md": None},
            {"provider": "perplexity", "status": "ok"},
        ]
        rows = dr.load_model_reports(IDEA_ID)
        self.assertEqual([r["provider"] for r in rows], ["chatgpt"])

    @mock.patch.object(dr.db, "_request")
    def test_none_response_returns_empty_list(self, mock_request):
        mock_request.return_value = None
        self.assertEqual(dr.load_model_reports(IDEA_ID), [])

    @mock.patch.object(dr.db, "_request")
    def test_idea_id_is_url_quoted(self, mock_request):
        mock_request.return_value = []
        dr.load_model_reports("PI/0013")
        called_path = mock_request.call_args[0][1]
        self.assertIn("idea_id=eq.PI%2F0013", called_path)


# ---------------------------------------------------------------------------
# save_synthesis_report
# ---------------------------------------------------------------------------

class SaveSynthesisReportTest(unittest.TestCase):
    @mock.patch.object(dr.db, "_request")
    def test_new_report_supersedes_then_inserts_and_returns_new_id(self, mock_request):
        mock_request.side_effect = [None, [{"id": "rr-new"}]]
        result = dr.save_synthesis_report(IDEA_ID, RUN_ID, "ok", "звіт")
        self.assertEqual(result, "rr-new")
        supersede_call, insert_call = mock_request.call_args_list
        self.assertEqual(supersede_call.args[0], "PATCH")
        self.assertIn(f"idea_id=eq.{IDEA_ID}", supersede_call.args[1])
        self.assertIn("stage=eq.deep_criteria", supersede_call.args[1])
        self.assertIn("kind=eq.synthesis", supersede_call.args[1])
        self.assertTrue(supersede_call.args[1].endswith("superseded_at=is.null"))
        self.assertEqual(insert_call.args[0], "POST")
        self.assertEqual(insert_call.args[1], "/research_reports")
        body = insert_call.args[2][0]
        self.assertEqual(body["idea_id"], IDEA_ID)
        self.assertEqual(body["run_id"], RUN_ID)
        self.assertEqual(body["stage"], "deep_criteria")
        self.assertEqual(body["kind"], "synthesis")
        self.assertEqual(body["provider"], "claude")
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["report_md"], "звіт")

    @mock.patch.object(dr.db, "_request")
    def test_existing_report_id_patches_in_place_and_returns_same_id(self, mock_request):
        mock_request.return_value = [{"id": "rr-1"}]
        result = dr.save_synthesis_report(IDEA_ID, RUN_ID, "ok", "оновлений звіт", report_id="rr-1")
        self.assertEqual(result, "rr-1")
        mock_request.assert_called_once_with(
            "PATCH", "/research_reports?id=eq.rr-1", {"status": "ok", "report_md": "оновлений звіт"},
        )

    @mock.patch.object(dr.db, "_request")
    def test_insert_returning_empty_list_yields_none(self, mock_request):
        mock_request.side_effect = [None, []]
        result = dr.save_synthesis_report(IDEA_ID, RUN_ID, "error", "звіт")
        self.assertIsNone(result)

    @mock.patch.object(dr.db, "_request")
    def test_report_md_truncated_to_200000_chars(self, mock_request):
        mock_request.return_value = [{"id": "rr-1"}]
        huge = "д" * 250_000
        dr.save_synthesis_report(IDEA_ID, RUN_ID, "ok", huge, report_id="rr-1")
        sent_body = mock_request.call_args[0][2]
        self.assertEqual(len(sent_body["report_md"]), 200_000)


# ---------------------------------------------------------------------------
# supersede
# ---------------------------------------------------------------------------

class SupersedeTest(unittest.TestCase):
    @mock.patch.object(dr.db, "_request")
    def test_calls_patch_with_utc_timestamp_appended_filter(self, mock_request):
        fixed_now = datetime(2026, 8, 5, 12, 30, 45, tzinfo=timezone.utc)

        class FixedDatetime(dr.datetime):
            @classmethod
            def now(cls, tz=None):
                return fixed_now

        with mock.patch.object(dr, "datetime", FixedDatetime):
            dr.supersede(f"/competitors?idea_id=eq.{IDEA_ID}")
        mock_request.assert_called_once_with(
            "PATCH", f"/competitors?idea_id=eq.{IDEA_ID}&superseded_at=is.null",
            {"superseded_at": "2026-08-05T12:30:45Z"},
        )


# ---------------------------------------------------------------------------
# write_event
# ---------------------------------------------------------------------------

class WriteEventTest(unittest.TestCase):
    @mock.patch.object(dr.db, "_request")
    def test_includes_run_id_when_given(self, mock_request):
        dr.write_event(IDEA_ID, RUN_ID, "зміна", "причина")
        mock_request.assert_called_once_with("POST", "/events", {
            "idea_id": IDEA_ID, "actor": "deep-research", "change": "зміна",
            "reason": "причина", "run_id": RUN_ID,
        })

    @mock.patch.object(dr.db, "_request")
    def test_omits_run_id_when_none(self, mock_request):
        dr.write_event(IDEA_ID, None, "зміна", "причина")
        body = mock_request.call_args[0][2]
        self.assertNotIn("run_id", body)

    @mock.patch.object(dr.db, "_request")
    def test_reason_truncated_to_2000_chars(self, mock_request):
        dr.write_event(IDEA_ID, RUN_ID, "зміна", "п" * 3000)
        body = mock_request.call_args[0][2]
        self.assertEqual(len(body["reason"]), 2000)


# ---------------------------------------------------------------------------
# run_synthesis_stage — гілки хвоста виклику B, не зачеплені happy-path тестом
# ---------------------------------------------------------------------------

class RunSynthesisStageCallBEdgeBranchesTest(unittest.TestCase):
    def test_no_section_updates_and_no_saturation_skips_second_ideas_patch(self):
        """Якщо виклик B не дав ні criteria_section_md/competitors_section_md,
        ні saturation_alert, card_updates лишається порожнім — другого PATCH
        /ideas взагалі не відбувається (лише events і report)."""
        fake = FakeDb(idea=base_idea(), reports=[model_report("chatgpt")])
        output_a = synthesis_a_output()
        output_b = "```json\n" + json.dumps({
            "competitors": [], "summary": "готово без секцій",
        }) + "\n```"
        patch_db, patch_llm = patched(fake, [(0, output_a), (0, output_b)])
        with patch_db, patch_llm:
            dr.run_synthesis_stage(IDEA_ID, RUN_ID, TODAY)
        ideas_patches = fake.calls_for("PATCH", "/ideas?id=eq.")
        self.assertEqual(len(ideas_patches), 1)  # лише після виклику A
        second_event = fake.calls_for("POST", "/events")[1][2]
        self.assertEqual(second_event["reason"], "готово без секцій")

    def test_saturation_alert_without_note_sets_flag_but_no_review_condition(self):
        fake = FakeDb(idea=base_idea(), reports=[model_report("chatgpt")])
        output_a = synthesis_a_output()
        output_b = "```json\n" + json.dumps({
            "competitors": [], "saturation_alert": True,
        }) + "\n```"
        patch_db, patch_llm = patched(fake, [(0, output_a), (0, output_b)])
        with patch_db, patch_llm:
            dr.run_synthesis_stage(IDEA_ID, RUN_ID, TODAY)
        second_patch = fake.calls_for("PATCH", "/ideas?id=eq.")[1][2]
        self.assertEqual(second_patch["ceiling_flag"], "review")
        self.assertNotIn("review_condition", second_patch)


# ---------------------------------------------------------------------------
# read_idea_id
# ---------------------------------------------------------------------------

class ReadIdeaIdTest(unittest.TestCase):
    @staticmethod
    def _with_stdin(text):
        return mock.patch.object(dr.sys, "stdin", io.StringIO(text))

    def test_valid_payload_returns_idea_id(self):
        with self._with_stdin('{"idea_id": "PI-0013"}'):
            self.assertEqual(dr.read_idea_id(), "PI-0013")

    def test_invalid_json_raises(self):
        with self._with_stdin("це не json"), self.assertRaises(SystemExit) as ctx:
            dr.read_idea_id()
        self.assertIn("не є валідним JSON", str(ctx.exception))

    def test_missing_idea_id_key_raises(self):
        with self._with_stdin("{}"), self.assertRaises(SystemExit) as ctx:
            dr.read_idea_id()
        self.assertIn("idea_id", str(ctx.exception))

    def test_non_string_idea_id_raises(self):
        with self._with_stdin('{"idea_id": 13}'), self.assertRaises(SystemExit):
            dr.read_idea_id()

    def test_idea_id_not_matching_pattern_raises(self):
        with self._with_stdin('{"idea_id": "pi-13"}'), self.assertRaises(SystemExit):
            dr.read_idea_id()

    def test_top_level_json_not_an_object_raises(self):
        with self._with_stdin("[1, 2, 3]"), self.assertRaises(SystemExit):
            dr.read_idea_id()


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

class MainTest(unittest.TestCase):
    def test_dry_run_sleeps_and_never_calls_run_synthesis_stage(self):
        env = {"IDEAS_SCOUT_DEEP_RESEARCH_DRY_RUN": "1", "IDEAS_SCOUT_DEEP_RESEARCH_DRY_RUN_DELAY_SECONDS": "5"}
        with mock.patch.object(dr, "read_idea_id", return_value=IDEA_ID), \
             mock.patch.object(dr, "run_synthesis_stage") as mock_run, \
             mock.patch.object(dr.sys, "argv", ["deep-research.py"]), \
             mock.patch.dict(dr.os.environ, env, clear=True), \
             mock.patch("time.sleep") as mock_sleep:
            dr.main()
        mock_sleep.assert_called_once_with(5)
        mock_run.assert_not_called()

    def test_dry_run_delay_capped_at_30_seconds(self):
        env = {"IDEAS_SCOUT_DEEP_RESEARCH_DRY_RUN": "1", "IDEAS_SCOUT_DEEP_RESEARCH_DRY_RUN_DELAY_SECONDS": "9999"}
        with mock.patch.object(dr, "read_idea_id", return_value=IDEA_ID), \
             mock.patch.object(dr, "run_synthesis_stage"), \
             mock.patch.object(dr.sys, "argv", ["deep-research.py"]), \
             mock.patch.dict(dr.os.environ, env, clear=True), \
             mock.patch("time.sleep") as mock_sleep:
            dr.main()
        mock_sleep.assert_called_once_with(30)

    def test_normal_run_calls_synthesis_stage_with_idea_id_run_id_and_today(self):
        env = {"IDEAS_SCOUT_JOB_RUN_ID": RUN_ID}
        with mock.patch.object(dr, "read_idea_id", return_value=IDEA_ID), \
             mock.patch.object(dr, "run_synthesis_stage") as mock_run, \
             mock.patch.object(dr.sys, "argv", ["deep-research.py"]), \
             mock.patch.dict(dr.os.environ, env, clear=True):
            dr.main()
        mock_run.assert_called_once()
        args = mock_run.call_args[0]
        self.assertEqual(args[0], IDEA_ID)
        self.assertEqual(args[1], RUN_ID)
        self.assertRegex(args[2], r"^\d{4}-\d{2}-\d{2}$")

    def test_missing_job_run_id_env_becomes_none(self):
        with mock.patch.object(dr, "read_idea_id", return_value=IDEA_ID), \
             mock.patch.object(dr, "run_synthesis_stage") as mock_run, \
             mock.patch.object(dr.sys, "argv", ["deep-research.py"]), \
             mock.patch.dict(dr.os.environ, {}, clear=True):
            dr.main()
        self.assertIsNone(mock_run.call_args[0][1])


if __name__ == "__main__":
    unittest.main()
