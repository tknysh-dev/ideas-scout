"""Тести санітизаторів і збірки змін ідеї з deep-research.py.

Мішень — усе, що перетворює сире від моделі на рядки для БД: sanitize_evidence,
sanitize_criteria, sanitize_competitors, parse_model_reports, build_idea_updates.
Модуль завантажується через test_support.load_script (звичайний import ламає
дефіс у назві файлу); саме завантаження безпечне — deep-research.py має
`if __name__ == "__main__"`, тож імпорт нічого не виконує й нікуди не ходить.

Правило чесності: тести документують ФАКТИЧНУ поведінку, включно з тим, що
виглядає як вада (напр. sanitize_competitors не дає однорідного набору ключів
сам по собі — це вирівнює db._align_bulk, а не санітизатор). Такі місця
позначені коментарем "СУМНІВНО" і названі в звіті.
"""

from __future__ import annotations

import copy
import unittest

from test_support import load_script

dr = load_script("deep-research.py")


# ---------------------------------------------------------------------------
# sanitize_evidence
# ---------------------------------------------------------------------------

class SanitizeEvidenceTest(unittest.TestCase):
    def test_valid_entry(self):
        raw = [{"url": "https://example.com/a", "published_date": "2026-07-01", "quote": "цитата"}]
        result = dr.sanitize_evidence(raw)
        self.assertEqual(result, [{
            "url": "https://example.com/a",
            "published_date": "2026-07-01",
            "quote": "цитата",
        }])

    def test_non_list_raw_returns_empty(self):
        self.assertEqual(dr.sanitize_evidence(None), [])
        self.assertEqual(dr.sanitize_evidence("https://example.com"), [])
        self.assertEqual(dr.sanitize_evidence({"url": "https://example.com"}), [])

    def test_missing_url_drops_item(self):
        raw = [{"published_date": "2026-07-01"}, {"url": 5}, {"url": None}]
        self.assertEqual(dr.sanitize_evidence(raw), [])

    def test_bad_date_dropped_but_url_kept(self):
        raw = [{"url": "https://example.com", "published_date": "07/01/2026"}]
        result = dr.sanitize_evidence(raw)
        self.assertEqual(result, [{"url": "https://example.com"}])
        self.assertNotIn("published_date", result[0])

    def test_non_string_quote_dropped(self):
        raw = [{"url": "https://example.com", "quote": 12345}]
        result = dr.sanitize_evidence(raw)
        self.assertNotIn("quote", result[0])

    def test_truncates_long_fields(self):
        raw = [{"url": "https://x.test/" + "a" * 3000, "quote": "б" * 2000}]
        result = dr.sanitize_evidence(raw)
        self.assertEqual(len(result[0]["url"]), 2000)
        self.assertEqual(len(result[0]["quote"]), 1000)

    def test_caps_at_twenty_items(self):
        raw = [{"url": f"https://x.test/{i}"} for i in range(30)]
        result = dr.sanitize_evidence(raw)
        self.assertEqual(len(result), 20)


# ---------------------------------------------------------------------------
# sanitize_criteria
# ---------------------------------------------------------------------------

BASE_KEYS = set(dr.BASE_KEYS_BY_TRACK["passive-income"])
ALLOWED = BASE_KEYS | set(dr.DEEP_KEYS)


def valid_criterion(key="0", verdict="passed", **overrides):
    row = {
        "criterion_key": key,
        "verdict": verdict,
        "score": "B",
        "summary": "фінальний вердикт одним рядком",
        "detail": "докладне пояснення чому саме такий вердикт переміг",
        "resolution": "consensus",
        "evidence": [{"url": "https://example.com/src", "published_date": "2026-07-01"}],
    }
    row.update(overrides)
    return row


class SanitizeCriteriaTest(unittest.TestCase):
    def test_valid_input_require_resolution_true(self):
        raw = [valid_criterion("0"), valid_criterion("d_demand", verdict="failed", resolution="evidence")]
        rows = dr.sanitize_criteria(raw, ALLOWED, require_resolution=True)
        self.assertEqual(set(rows), {"0", "d_demand"})
        self.assertEqual(rows["0"]["resolution"], "consensus")
        self.assertEqual(rows["d_demand"]["resolution"], "evidence")
        self.assertEqual(rows["0"]["verdict"], "passed")
        self.assertEqual(rows["0"]["evidence"], [{"url": "https://example.com/src", "published_date": "2026-07-01"}])

    def test_valid_input_require_resolution_false_omits_key(self):
        raw = [valid_criterion("0")]
        rows = dr.sanitize_criteria(raw, ALLOWED, require_resolution=False)
        self.assertNotIn("resolution", rows["0"])

    def test_require_resolution_true_but_missing_becomes_none(self):
        raw = [valid_criterion("0")]
        del raw[0]["resolution"]
        rows = dr.sanitize_criteria(raw, ALLOWED, require_resolution=True)
        self.assertIn("resolution", rows["0"])
        self.assertIsNone(rows["0"]["resolution"])

    def test_require_resolution_true_invalid_value_becomes_none(self):
        """Модель могла написати щось поза RESOLUTIONS — тихо стає None, не падає."""
        raw = [valid_criterion("0", resolution="tie-break-by-vibes")]
        rows = dr.sanitize_criteria(raw, ALLOWED, require_resolution=True)
        self.assertIsNone(rows["0"]["resolution"])

    def test_raw_not_a_list_returns_empty_dict(self):
        for junk in (None, "criteria", 42, {"0": valid_criterion("0")}):
            self.assertEqual(dr.sanitize_criteria(junk, ALLOWED, require_resolution=True), {})

    def test_items_not_dicts_are_dropped(self):
        raw = ["критерій 0 passed", 42, None, valid_criterion("1")]
        rows = dr.sanitize_criteria(raw, ALLOWED, require_resolution=True)
        self.assertEqual(set(rows), {"1"})

    def test_verdict_outside_whitelist_dropped_silently(self):
        """СУМНІВНО: модель могла вигадати вердикт (напр. "probably"), і рядок
        просто зникає без сліду в rows — виклик, що читає rows, побачить лише
        відсутність критерію, не побачить, що модель щось про нього казала."""
        raw = [valid_criterion("0", verdict="probably"), valid_criterion("1", verdict=None),
               valid_criterion("2", verdict="")]
        rows = dr.sanitize_criteria(raw, ALLOWED, require_resolution=True)
        self.assertEqual(rows, {})

    def test_criterion_key_outside_allowed_dropped(self):
        raw = [valid_criterion("99"), valid_criterion("d_unknown_block")]
        rows = dr.sanitize_criteria(raw, ALLOWED, require_resolution=True)
        self.assertEqual(rows, {})

    def test_missing_criterion_key_dropped(self):
        row = valid_criterion("0")
        del row["criterion_key"]
        rows = dr.sanitize_criteria([row], ALLOWED, require_resolution=True)
        self.assertEqual(rows, {})

    def test_empty_list_returns_empty_dict(self):
        self.assertEqual(dr.sanitize_criteria([], ALLOWED, require_resolution=True), {})

    def test_non_string_optional_fields_become_none(self):
        raw = [valid_criterion("0", score=99, summary=None, detail=["not", "a", "string"])]
        rows = dr.sanitize_criteria(raw, ALLOWED, require_resolution=True)
        self.assertIsNone(rows["0"]["score"])
        self.assertIsNone(rows["0"]["summary"])
        self.assertIsNone(rows["0"]["detail"])

    def test_evidence_not_a_list_becomes_empty_list_not_dropped(self):
        raw = [valid_criterion("0", evidence="джерело: довіряй мені")]
        rows = dr.sanitize_criteria(raw, ALLOWED, require_resolution=True)
        self.assertEqual(rows["0"]["evidence"], [])

    def test_duplicate_criterion_key_last_wins(self):
        raw = [valid_criterion("0", verdict="passed"), valid_criterion("0", verdict="failed")]
        rows = dr.sanitize_criteria(raw, ALLOWED, require_resolution=True)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows["0"]["verdict"], "failed")

    def test_truncation_limits(self):
        raw = [valid_criterion("0", score="X" * 500, summary="Y" * 1000, detail="Z" * 8000)]
        rows = dr.sanitize_criteria(raw, ALLOWED, require_resolution=True)
        self.assertEqual(len(rows["0"]["score"]), 100)
        self.assertEqual(len(rows["0"]["summary"]), 500)
        self.assertEqual(len(rows["0"]["detail"]), 5000)

    # -- однорідність ключів ------------------------------------------------

    def test_output_rows_share_identical_key_set(self):
        """sanitize_criteria завжди задає всі поля явно (None замість пропуску),
        тож на відміну від sanitize_competitors тут немає ризику PGRST102 —
        набір ключів однаковий незалежно від того, що саме модель заповнила."""
        sparse = {"criterion_key": "0", "verdict": "passed"}  # без score/summary/detail/evidence/resolution
        full = valid_criterion("1")
        rows = dr.sanitize_criteria([sparse, full], ALLOWED, require_resolution=True)
        key_sets = [frozenset(row) for row in rows.values()]
        self.assertEqual(len(set(key_sets)), 1, f"набори ключів розійшлись: {key_sets}")
        self.assertEqual(key_sets[0], frozenset({
            "criterion_key", "verdict", "score", "summary", "detail", "resolution", "evidence",
        }))

    def test_output_rows_share_identical_key_set_without_resolution(self):
        sparse = {"criterion_key": "0", "verdict": "passed"}
        full = valid_criterion("1")
        rows = dr.sanitize_criteria([sparse, full], ALLOWED, require_resolution=False)
        key_sets = [frozenset(row) for row in rows.values()]
        self.assertEqual(len(set(key_sets)), 1, f"набори ключів розійшлись: {key_sets}")
        self.assertNotIn("resolution", key_sets[0])


# ---------------------------------------------------------------------------
# sanitize_competitors
# ---------------------------------------------------------------------------

def valid_competitor(name="Acme Widgets", **overrides):
    row = {
        "name": name,
        "url": "https://acme.example.com",
        "pricing": "$9/міс",
        "liveness": "active",
        "last_activity": "2026-06-15",
        "strengths": "великий трафік з SEO",
        "weaknesses": "дорога інтеграція",
        "differentiation": "нема нішевого фокусу",
        "evidence": [{"url": "https://acme.example.com/about", "published_date": "2026-06-01"}],
    }
    row.update(overrides)
    return row


class SanitizeCompetitorsTest(unittest.TestCase):
    def test_valid_input(self):
        rows = dr.sanitize_competitors([valid_competitor()])
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["name"], "Acme Widgets")
        self.assertEqual(row["liveness"], "active")
        self.assertEqual(row["last_activity"], "2026-06-15")
        self.assertEqual(row["evidence"], [{"url": "https://acme.example.com/about", "published_date": "2026-06-01"}])

    def test_raw_not_a_list_returns_empty(self):
        for junk in (None, "конкурент Acme", 7, {"name": "Acme"}):
            self.assertEqual(dr.sanitize_competitors(junk), [])

    def test_items_not_dicts_dropped(self):
        rows = dr.sanitize_competitors(["Acme", 5, None, valid_competitor("Beta")])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["name"], "Beta")

    def test_missing_or_blank_name_dropped(self):
        raw = [{"name": None}, {"name": ""}, {"name": "   "}, {}]
        self.assertEqual(dr.sanitize_competitors(raw), [])

    def test_name_is_stripped_and_truncated(self):
        rows = dr.sanitize_competitors([{"name": "  Long Co  " + "x" * 400}])
        self.assertFalse(rows[0]["name"].startswith(" "))
        self.assertFalse(rows[0]["name"].endswith(" "))
        self.assertEqual(len(rows[0]["name"]), 300)

    def test_liveness_outside_whitelist_key_absent(self):
        rows = dr.sanitize_competitors([valid_competitor(liveness="zombie")])
        self.assertNotIn("liveness", rows[0])

    def test_liveness_missing_key_absent(self):
        row = valid_competitor()
        del row["liveness"]
        rows = dr.sanitize_competitors([row])
        self.assertNotIn("liveness", rows[0])

    def test_bad_last_activity_date_key_absent(self):
        rows = dr.sanitize_competitors([valid_competitor(last_activity="minulого тижня")])
        self.assertNotIn("last_activity", rows[0])

    def test_optional_text_fields_only_added_when_string(self):
        row = valid_competitor()
        del row["pricing"]
        row["strengths"] = None
        row["weaknesses"] = 42
        rows = dr.sanitize_competitors([row])
        result = rows[0]
        self.assertNotIn("pricing", result)
        self.assertNotIn("strengths", result)
        self.assertNotIn("weaknesses", result)
        self.assertIn("differentiation", result)

    def test_truncation_limits(self):
        rows = dr.sanitize_competitors([valid_competitor(
            url="https://x.test/" + "a" * 3000,
            pricing="p" * 900,
            strengths="s" * 3000,
            weaknesses="w" * 3000,
            differentiation="d" * 3000,
        )])
        row = rows[0]
        self.assertEqual(len(row["url"]), 2000)
        self.assertEqual(len(row["pricing"]), 500)
        self.assertEqual(len(row["strengths"]), 2000)
        self.assertEqual(len(row["weaknesses"]), 2000)
        self.assertEqual(len(row["differentiation"]), 2000)

    def test_caps_at_forty_items(self):
        raw = [valid_competitor(name=f"Co {i}") for i in range(60)]
        rows = dr.sanitize_competitors(raw)
        self.assertEqual(len(rows), 40)

    # -- однорідність ключів (СУМНІВНО — задокументована відома поведінка) --

    def test_output_rows_do_NOT_share_identical_key_set(self):
        """sanitize_competitors сам по собі НЕ дає однорідного набору ключів:
        опційні поля (url/pricing/strengths/weaknesses/differentiation/
        liveness/last_activity) додаються лише коли модель дала валідне
        значення для конкретного рядка. Один конкурент без last_activity —
        і другий рядок отримує інший набір ключів, ніж перший.

        Це точний сценарій, що ламав пакетну вставку в /competitors до
        db._align_bulk (git show 9ae435f, 8a73d57): PostgREST відхиляв увесь
        пакет з HTTP 400 PGRST102 "All object keys must match". Зараз це
        лагодить транспорт (db._align_bulk у agents/scripts/db.py), а не цей
        санітизатор — тест фіксує факт, не вимагає виправлення тут.
        """
        rich = valid_competitor("Rich Co")
        sparse = {"name": "Sparse Co"}  # жодного опційного поля
        rows = dr.sanitize_competitors([rich, sparse])
        key_sets = [frozenset(row) for row in rows]
        self.assertNotEqual(key_sets[0], key_sets[1],
                             "якщо це стало рівним — санітизатор змінили, оновіть тест і звіт")
        self.assertTrue(key_sets[1].issubset(key_sets[0]))

    def test_align_bulk_restores_homogeneity_downstream(self):
        """Документує, що db._align_bulk (де насправді живе вирівнювання)
        компенсує неоднорідність sanitize_competitors перед POST-ом."""
        rich = valid_competitor("Rich Co")
        sparse = {"name": "Sparse Co"}
        rows = dr.sanitize_competitors([rich, sparse])
        aligned = dr.db._align_bulk(copy.deepcopy(rows))
        key_sets = [frozenset(row) for row in aligned]
        self.assertEqual(key_sets[0], key_sets[1])


# ---------------------------------------------------------------------------
# parse_model_reports
# ---------------------------------------------------------------------------

def report(provider, report_md, status="ok"):
    return {"provider": provider, "model": "gpt", "status": status, "report_md": report_md}


def json_report_md(payload_json: str) -> str:
    return f"Робочі нотатки дослідника.\n\n```json\n{payload_json}\n```\n"


CRITERIA_BLOCK_0_PASSED = json_report_md(
    '{"criteria": [{"criterion_key": "0", "verdict": "passed", "score": "B", '
    '"summary": "ок", "detail": "деталі", "evidence": []}]}'
)
CRITERIA_BLOCK_0_FAILED = json_report_md(
    '{"criteria": [{"criterion_key": "0", "verdict": "failed", "score": "D", '
    '"summary": "ні", "detail": "деталі", "evidence": []}]}'
)


class ParseModelReportsTest(unittest.TestCase):
    def test_multiple_reports_with_structured_criteria_and_competitors(self):
        md = json_report_md(
            '{"criteria": [{"criterion_key": "0", "verdict": "passed", "evidence": []}], '
            '"competitors": [{"name": "Acme"}]}'
        )
        reports = [report("chatgpt", md), report("gemini", CRITERIA_BLOCK_0_PASSED)]
        criteria, competitors, prose = dr.parse_model_reports(reports, ALLOWED)
        self.assertEqual(set(criteria), {"chatgpt", "gemini"})
        self.assertEqual(set(competitors), {"chatgpt"})
        self.assertEqual(prose, {})

    def test_empty_reports_list(self):
        criteria, competitors, prose = dr.parse_model_reports([], ALLOWED)
        self.assertEqual((criteria, competitors, prose), ({}, {}, {}))

    def test_report_without_json_goes_to_prose(self):
        md = "Провів дослідження, ось висновки прозою без жодного json-блоку."
        reports = [report("perplexity", md)]
        criteria, competitors, prose = dr.parse_model_reports(reports, ALLOWED)
        self.assertEqual(criteria, {})
        self.assertEqual(competitors, {})
        self.assertEqual(prose, {"perplexity": md})

    def test_report_with_json_but_no_recognizable_keys_goes_to_prose(self):
        """json-блок валідний, але жодного критерію в ALLOWED і жодного
        конкурента — sanitize_criteria/sanitize_competitors повертають
        порожньо, і звіт трактується як не структурований."""
        md = json_report_md('{"criteria": [{"criterion_key": "999", "verdict": "passed"}]}')
        reports = [report("grok", md)]
        criteria, competitors, prose = dr.parse_model_reports(reports, ALLOWED)
        self.assertEqual(criteria, {})
        self.assertEqual(competitors, {})
        self.assertEqual(prose, {"grok": md})

    def test_search_unavailable_report_excluded_entirely(self):
        reports = [report("chatgpt", "SEARCH UNAVAILABLE"), report("gemini", CRITERIA_BLOCK_0_PASSED)]
        criteria, _competitors, prose = dr.parse_model_reports(reports, ALLOWED)
        self.assertNotIn("chatgpt", criteria)
        self.assertNotIn("chatgpt", prose)
        self.assertEqual(set(criteria), {"gemini"})

    def test_rows_with_non_ok_status_are_prefiltered_by_load_model_reports_not_here(self):
        """parse_model_reports сам не фільтрує за status — це робить
        load_model_reports (query до БД). Якщо викликати напряму з
        status != "ok", звіт усе одно розбирається."""
        reports = [report("chatgpt", CRITERIA_BLOCK_0_PASSED, status="error")]
        criteria, _, _ = dr.parse_model_reports(reports, ALLOWED)
        self.assertIn("chatgpt", criteria)

    def test_missing_or_non_string_provider_defaults_to_unknown(self):
        rows = [{"provider": None, "status": "ok", "report_md": CRITERIA_BLOCK_0_PASSED},
                {"report_md": CRITERIA_BLOCK_0_FAILED}]
        criteria, _, _ = dr.parse_model_reports(rows, ALLOWED)
        # Обидва звіти без імені провайдера мапляться в один і той самий ключ
        # "unknown" — другий тихо перезаписує перший (dict-присвоєння).
        self.assertEqual(set(criteria), {"unknown"})
        self.assertEqual(criteria["unknown"]["0"]["verdict"], "failed")

    def test_conflicting_verdicts_from_different_models_both_kept_verbatim(self):
        """parse_model_reports нічого не адʼюдикує — це задача виклику A
        (LLM), не цієї функції. Якщо ChatGPT каже passed, а Gemini failed по
        тому самому критерію, обидва вердикти просто лежать під своїми
        ключами провайдера; жодного зведення тут немає."""
        reports = [report("chatgpt", CRITERIA_BLOCK_0_PASSED), report("gemini", CRITERIA_BLOCK_0_FAILED)]
        criteria, _, _ = dr.parse_model_reports(reports, ALLOWED)
        self.assertEqual(criteria["chatgpt"]["0"]["verdict"], "passed")
        self.assertEqual(criteria["gemini"]["0"]["verdict"], "failed")


# ---------------------------------------------------------------------------
# build_idea_updates
# ---------------------------------------------------------------------------

def idea(status="approved_pending", **overrides):
    row = {"id": "PI-0001", "status": status}
    row.update(overrides)
    return row


def synth_row(key, verdict, **overrides):
    row = {"criterion_key": key, "verdict": verdict, "score": None, "summary": None,
           "detail": None, "resolution": "consensus", "evidence": []}
    row.update(overrides)
    return row


class BuildIdeaUpdatesTest(unittest.TestCase):
    def test_full_success_passive_income(self):
        synth = {k: synth_row(k, "passed") for k in dr.BASE_KEYS_BY_TRACK["passive-income"]}
        updates, failed_fatal = dr.build_idea_updates("passive-income", idea(), synth, {"confidence": "high"})
        self.assertEqual(failed_fatal, [])
        self.assertEqual(updates["status"], "approved_pending")
        self.assertIsNone(updates["rejection_code"])
        self.assertIsNone(updates["rejection_detail"])
        self.assertEqual(updates["confidence"], "high")

    def test_full_success_app_ideas(self):
        synth = {k: synth_row(k, "passed") for k in dr.BASE_KEYS_BY_TRACK["app-ideas"]}
        updates, failed_fatal = dr.build_idea_updates("app-ideas", idea(), synth, {})
        self.assertEqual(failed_fatal, [])
        self.assertEqual(updates["status"], "approved_pending")

    def test_status_accepted_stays_accepted_on_success(self):
        synth = {k: synth_row(k, "passed") for k in dr.BASE_KEYS_BY_TRACK["passive-income"]}
        updates, _ = dr.build_idea_updates("passive-income", idea(status="accepted"), synth, {})
        self.assertEqual(updates["status"], "accepted")

    def test_fatal_criterion_failed_passive_income(self):
        synth = {"3": synth_row("3", "failed")}
        updates, failed_fatal = dr.build_idea_updates("passive-income", idea(), synth, {})
        self.assertEqual(failed_fatal, ["3"])
        self.assertEqual(updates["status"], "rejected")
        self.assertEqual(updates["rejection_code"], dr.CODE_BY_CRITERION["passive-income"]["3"])
        self.assertEqual(updates["rejection_code"], "CAPABILITY_GAP")

    def test_fatal_criterion_failed_app_ideas_uses_track_specific_code(self):
        """Ключ 4 має РІЗНИЙ код у двох треках — AUTONOMY у passive-income,
        NO_MARKET у app-ideas — тому мапа саме track-специфічна."""
        synth = {"4": synth_row("4", "failed")}
        updates, failed_fatal = dr.build_idea_updates("app-ideas", idea(), synth, {})
        self.assertEqual(failed_fatal, ["4"])
        self.assertEqual(updates["rejection_code"], "NO_MARKET")

    def test_multiple_fatal_failures_uses_first_by_sorted_key(self):
        synth = {"5": synth_row("5", "failed"), "1": synth_row("1", "failed")}
        updates, failed_fatal = dr.build_idea_updates("passive-income", idea(), synth, {})
        self.assertEqual(failed_fatal, ["1", "5"])
        self.assertEqual(updates["rejection_code"], dr.CODE_BY_CRITERION["passive-income"]["1"])

    def test_non_fatal_failure_does_not_reject(self):
        base = dr.BASE_KEYS_BY_TRACK["passive-income"]
        non_fatal = next(k for k in base if k not in dr.FATAL_KEYS)
        synth = {k: synth_row(k, "passed") for k in dr.FATAL_KEYS} | {non_fatal: synth_row(non_fatal, "failed")}
        updates, failed_fatal = dr.build_idea_updates("passive-income", idea(), synth, {})
        self.assertEqual(failed_fatal, [])
        self.assertEqual(updates["status"], "approved_pending")
        self.assertIsNone(updates["rejection_code"])

    def test_model_supplied_valid_rejection_code_is_respected(self):
        synth = {"2": synth_row("2", "failed")}
        updates, _ = dr.build_idea_updates("passive-income", idea(), synth, {"rejection_code": "SATURATED"})
        self.assertEqual(updates["rejection_code"], "SATURATED")

    def test_model_supplied_invalid_rejection_code_falls_back_to_criterion_map(self):
        synth = {"2": synth_row("2", "failed")}
        updates, _ = dr.build_idea_updates("passive-income", idea(), synth, {"rejection_code": "TOTALLY_MADE_UP"})
        self.assertEqual(updates["rejection_code"], dr.CODE_BY_CRITERION["passive-income"]["2"])

    def test_rejection_codes_extra_filters_unknown_and_duplicate_of_primary(self):
        synth = {"0": synth_row("0", "failed")}
        primary_code = dr.CODE_BY_CRITERION["passive-income"]["0"]
        updates, _ = dr.build_idea_updates(
            "passive-income", idea(), synth,
            {"rejection_codes_extra": ["LEGAL", "NOT_A_REAL_CODE", primary_code]},
        )
        self.assertEqual(updates["rejection_codes_extra"], ["LEGAL"])
        self.assertNotIn(primary_code, updates["rejection_codes_extra"])

    def test_rejection_codes_extra_non_list_ignored(self):
        synth = {"0": synth_row("0", "failed")}
        updates, _ = dr.build_idea_updates("passive-income", idea(), synth, {"rejection_codes_extra": "LEGAL"})
        self.assertNotIn("rejection_codes_extra", updates)

    def test_garbage_updates_raw_not_a_dict(self):
        synth = {k: synth_row(k, "passed") for k in dr.BASE_KEYS_BY_TRACK["passive-income"]}
        for junk in (None, "нема пропозицій", 42, ["a", "b"]):
            updates, failed_fatal = dr.build_idea_updates("passive-income", idea(), synth, junk)
            self.assertEqual(failed_fatal, [])
            self.assertEqual(updates["status"], "approved_pending")

    def test_confidence_outside_whitelist_dropped(self):
        synth = {}
        updates, _ = dr.build_idea_updates("passive-income", idea(), synth, {"confidence": "super sure"})
        self.assertNotIn("confidence", updates)

    def test_launch_effort_hours_non_numeric_dropped(self):
        synth = {}
        updates, _ = dr.build_idea_updates("passive-income", idea(), synth, {"launch_effort_hours": "багато"})
        self.assertNotIn("launch_effort_hours", updates)

    def test_launch_effort_hours_numeric_kept(self):
        synth = {}
        updates, _ = dr.build_idea_updates("passive-income", idea(), synth, {"launch_effort_hours": 12.5})
        self.assertEqual(updates["launch_effort_hours"], 12.5)

    def test_ceiling_flag_only_review_string_accepted(self):
        synth = {}
        updates, _ = dr.build_idea_updates("passive-income", idea(), synth, {"ceiling_flag": "review"})
        self.assertEqual(updates["ceiling_flag"], "review")
        updates2, _ = dr.build_idea_updates("passive-income", idea(), synth, {"ceiling_flag": "urgent"})
        self.assertIsNone(updates2["ceiling_flag"])
        updates3, _ = dr.build_idea_updates("passive-income", idea(), synth, {})
        self.assertIsNone(updates3["ceiling_flag"])

    def test_model_cannot_set_status_directly(self):
        """build_idea_updates НЕ читає updates_raw["status"] узагалі — статус
        завжди computed з failed_fatal і idea["status"]. Спроба моделі
        нав'язати довільний статус (напр. поза OWNER_DECIDABLE) просто
        ігнорується мовчки: ключа "status" з входу немає в жодній гілці коду."""
        synth = {k: synth_row(k, "passed") for k in dr.BASE_KEYS_BY_TRACK["passive-income"]}
        updates, _ = dr.build_idea_updates(
            "passive-income", idea(), synth, {"status": "deleted_forever"}
        )
        self.assertEqual(updates["status"], "approved_pending")
        self.assertIn(updates["status"], dr.OWNER_DECIDABLE)

    def test_computed_statuses_are_always_owner_decidable(self):
        """Усі три статуси, які build_idea_updates взагалі здатен виставити
        (rejected / accepted / approved_pending), лежать в OWNER_DECIDABLE —
        це властивість коду за побудовою, перевіряємо явно, а не за довірою."""
        possible = set()
        synth_pass = {k: synth_row(k, "passed") for k in dr.BASE_KEYS_BY_TRACK["passive-income"]}
        synth_fail = {"0": synth_row("0", "failed")}
        for status_in, synth in (
            ("approved_pending", synth_pass), ("accepted", synth_pass),
            ("rejected", synth_pass), ("approved_pending", synth_fail),
        ):
            updates, _ = dr.build_idea_updates("passive-income", idea(status=status_in), synth, {})
            possible.add(updates["status"])
        self.assertTrue(possible.issubset(dr.OWNER_DECIDABLE))

    def test_rejection_detail_truncated(self):
        synth = {"0": synth_row("0", "failed")}
        updates, _ = dr.build_idea_updates("passive-income", idea(), synth, {"rejection_detail": "д" * 8000})
        self.assertEqual(len(updates["rejection_detail"]), 5000)

    def test_review_condition_truncated(self):
        synth = {}
        updates, _ = dr.build_idea_updates("passive-income", idea(), synth, {"review_condition": "у" * 3000})
        self.assertEqual(len(updates["review_condition"]), 2000)

    def test_ceiling_estimate_non_string_dropped(self):
        synth = {}
        updates, _ = dr.build_idea_updates("passive-income", idea(), synth, {"ceiling_estimate": 100000})
        self.assertNotIn("ceiling_estimate", updates)


if __name__ == "__main__":
    unittest.main()
