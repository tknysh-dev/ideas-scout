"""deep_research_text_test.py — юніт-тести чистих текстових функцій deep-research.py.

Мішень: section_bounds/split_section/replace_section (різання й зшивання
розділів картки ідеї — помилка тут тихо затирає чужий текст власника),
render (підстановка плейсхолдерів у промпт), criteria_version_of,
criteria_doc_path, build_idea_context.

Документує ФАКТИЧНУ поведінку (у т.ч. вже наявні дивацтва), а не бажану —
код deep-research.py тут не змінюється.
"""

from __future__ import annotations

import os
import unittest

from test_support import load_script

dr = load_script("deep-research.py")


class SectionBoundsTest(unittest.TestCase):
    def test_title_at_start(self):
        body = "## A\n\na-content\n\n## B\n\nb-content"
        bounds = dr.section_bounds(body, "A")
        self.assertIsNotNone(bounds)
        start, end = bounds
        self.assertEqual(body[start:end], "## A\n\na-content\n\n")

    def test_title_in_middle(self):
        body = "## A\n\na-content\n\n## B\n\nb-content\n\n## C\n\nc-content"
        bounds = dr.section_bounds(body, "B")
        start, end = bounds
        self.assertEqual(body[start:end], "## B\n\nb-content\n\n")

    def test_title_at_end_no_next_heading(self):
        body = "## A\n\na-content\n\n## B\n\nb-content"
        bounds = dr.section_bounds(body, "B")
        start, end = bounds
        self.assertEqual(end, len(body))
        self.assertEqual(body[start:end], "## B\n\nb-content")

    def test_title_absent(self):
        body = "## A\n\na-content"
        self.assertIsNone(dr.section_bounds(body, "Z"))

    def test_empty_body(self):
        self.assertIsNone(dr.section_bounds("", "A"))

    def test_two_sections_same_title_returns_only_first(self):
        """ФАКТИЧНА поведінка: re.search знаходить лише ПЕРШИЙ заголовок, а
        "кінець розділу" — це найближчий наступний "## " — тобто СВОЮ ж
        дублікатну шапку. Друга секція лишається повністю поза межами й не
        зачіпається."""
        body = "## Дубль\n\nfirst\n\n## Дубль\n\nsecond\n\n## Кінець\n\nend"
        start, end = dr.section_bounds(body, "Дубль")
        self.assertEqual(body[start:end], "## Дубль\n\nfirst\n\n")
        # друга "## Дубль" лишається одразу за межею — не поглинута.
        self.assertTrue(body[end:].startswith("## Дубль\n\nsecond"))

    def test_title_substring_of_longer_title_not_confused(self):
        """"Аналіз" не має збігтись із рядком "## Аналіз за критеріями" —
        рятує $ (кінець рядка) в regex."""
        body = "## Аналіз\n\nc1\n\n## Аналіз за критеріями\n\nc2\n\n## Інше\n\nc3"
        short_bounds = dr.section_bounds(body, "Аналіз")
        long_bounds = dr.section_bounds(body, "Аналіз за критеріями")
        self.assertEqual(body[short_bounds[0]:short_bounds[1]], "## Аналіз\n\nc1\n\n")
        self.assertEqual(body[long_bounds[0]:long_bounds[1]],
                         "## Аналіз за критеріями\n\nc2\n\n")

    def test_heading_level_mismatch_not_found(self):
        """Заголовок рівня ### не збігається з патерном "## <title>": після
        літерального "##" у regex йде \\s+, а третій "#" — не пробіл."""
        body = "### Заголовок\n\ncontent"
        self.assertIsNone(dr.section_bounds(body, "Заголовок"))


class SplitSectionTest(unittest.TestCase):
    def test_body_none(self):
        self.assertEqual(dr.split_section(None, "A"), (None, ""))

    def test_body_empty_string(self):
        self.assertEqual(dr.split_section("", "A"), (None, ""))

    def test_title_absent_returns_body_unchanged(self):
        body = "## A\n\ncontent"
        content, rest = dr.split_section(body, "Z")
        self.assertIsNone(content)
        self.assertEqual(rest, body)

    def test_section_at_start(self):
        body = "## A\n\na-content\n\n## B\n\nb-content"
        content, rest = dr.split_section(body, "A")
        self.assertEqual(content, "a-content")
        self.assertEqual(rest, "## B\n\nb-content")

    def test_section_in_middle_neighbors_intact(self):
        body = "## A\n\na-content\n\n## B\n\nb-content\n\n## C\n\nc-content"
        content, rest = dr.split_section(body, "B")
        self.assertEqual(content, "b-content")
        self.assertIn("## A\n\na-content", rest)
        self.assertIn("## C\n\nc-content", rest)
        self.assertNotIn("b-content", rest)

    def test_section_at_end(self):
        body = "## A\n\na-content\n\n## B\n\nb-content"
        content, rest = dr.split_section(body, "B")
        self.assertEqual(content, "b-content")
        self.assertEqual(rest, "## A\n\na-content")

    def test_two_sections_same_title_second_left_intact(self):
        body = "## Дубль\n\nfirst\n\n## Дубль\n\nsecond\n\n## Кінець\n\nend"
        content, rest = dr.split_section(body, "Дубль")
        self.assertEqual(content, "first")
        # друга секція з тим самим заголовком лишається в "решті" повністю.
        self.assertIn("## Дубль\n\nsecond", rest)
        self.assertIn("## Кінець\n\nend", rest)


class ReplaceSectionTest(unittest.TestCase):
    def test_replace_existing_middle_neighbors_untouched(self):
        body = "## A\n\na-content\n\n## B\n\nb-content\n\n## C\n\nc-content"
        out = dr.replace_section(body, "B", "new-b-content")
        self.assertEqual(out, "## A\n\na-content\n\n## B\n\nnew-b-content\n\n## C\n\nc-content")
        self.assertIn("a-content", out)
        self.assertIn("c-content", out)

    def test_append_when_section_absent(self):
        out = dr.replace_section("## A\n\na-content", "Z", "z-content")
        self.assertEqual(out, "## A\n\na-content\n\n## Z\n\nz-content")

    def test_append_when_body_none(self):
        out = dr.replace_section(None, "Z", "z-content")
        self.assertEqual(out, "## Z\n\nz-content")

    def test_replace_with_empty_string(self):
        body = "## A\n\na-content\n\n## B\n\nb-content\n\n## C\n\nc-content"
        out = dr.replace_section(body, "B", "")
        self.assertEqual(out, "## A\n\na-content\n\n## B\n\n\n\n## C\n\nc-content")
        self.assertIn("## A\n\na-content", out)
        self.assertIn("## C\n\nc-content", out)

    def test_replace_first_section_neighbors_untouched(self):
        body = "## A\n\na-content\n\n## B\n\nb-content"
        out = dr.replace_section(body, "A", "new-a")
        self.assertEqual(out, "## A\n\nnew-a\n\n## B\n\nb-content")


class RenderTest(unittest.TestCase):
    def test_all_placeholders_replaced(self):
        out = dr.render("Hi {{NAME}}, track={{TRACK}}", {"NAME": "world", "TRACK": "app-ideas"})
        self.assertEqual(out, "Hi world, track=app-ideas")

    def test_unfilled_placeholder_left_verbatim(self):
        """ФАКТИЧНА поведінка: render лише замінює ключі з mapping, нічого не
        валідує — плейсхолдер без значення так і лишається "{{NAME}}" у
        тексті, що піде в модель дослівно (саме цю дірку ловить
        doctor_prompt_contract.py на рівні відповідності шаблон/код, а не
        render сам по собі)."""
        out = dr.render("Hi {{NAME}}, unknown={{OTHER}}", {"NAME": "world"})
        self.assertEqual(out, "Hi world, unknown={{OTHER}}")

    def test_empty_mapping_leaves_template_unchanged(self):
        template = "Hi {{NAME}}"
        self.assertEqual(dr.render(template, {}), template)

    def test_value_containing_placeholder_syntax_may_be_reinterpreted(self):
        """ФАКТИЧНИЙ БАГ: render ітерує mapping.items() і .replace()-ить у той
        самий template послідовно, тому значення, яке саме містить "{{...}}",
        може отримати повторну підстановку — залежно від ПОРЯДКУ ключів у
        mapping (у Python dict зберігає порядок вставки).

        Якщо ключ "A" (значення якого — "{{B}}") обробляється РАНІШЕ за "B",
        новоприлеглий "{{B}}" встигає потрапити в template до того, як цикл
        дійде до "B", і теж заміниться — подвійна інтерпретація."""
        template = "X={{A}} Y={{B}}"
        out_a_first = dr.render(template, {"A": "{{B}}", "B": "REPLACED"})
        self.assertEqual(out_a_first, "X=REPLACED Y=REPLACED")

        # Той самий mapping, зворотний порядок ключів — інший результат:
        # "{{B}}" з значення A підставляється вже ПІСЛЯ обробки ключа B,
        # тож лишається нерозгорнутим у виводі.
        out_b_first = dr.render(template, {"B": "REPLACED", "A": "{{B}}"})
        self.assertEqual(out_b_first, "X={{B}} Y=REPLACED")


class CriteriaVersionOfTest(unittest.TestCase):
    def test_version_present(self):
        self.assertEqual(dr.criteria_version_of("Версія: 3.2\n\nдеталі"), "3.2")

    def test_version_absent(self):
        self.assertIsNone(dr.criteria_version_of("Немає рядка версії тут"))

    def test_version_colon_then_eof_is_none(self):
        self.assertIsNone(dr.criteria_version_of("Версія:"))
        self.assertIsNone(dr.criteria_version_of("Версія:   "))

    def test_version_not_at_line_start_is_none(self):
        """^ у MULTILINE вимагає початку рядка — "Версія:" посеред рядка не
        рахується."""
        self.assertIsNone(dr.criteria_version_of("текст Версія: 1.0"))

    def test_version_corrupted_colon_no_value_swallows_next_word(self):
        """ФАКТИЧНИЙ дивний випадок: "Версія:" без значення на тому самому
        рядку, але з текстом далі в документі — \\s* у regex жадібно
        поглинає порожні рядки, і (\\S+) хапає перше непробільне слово
        НАСТУПНОГО рядка, як версію. Це не крах, а тиха хибна відповідь."""
        self.assertEqual(dr.criteria_version_of("Версія:\n\nдеталі"), "деталі")


class CriteriaDocPathTest(unittest.TestCase):
    def test_passive_income(self):
        self.assertEqual(
            dr.criteria_doc_path("passive-income"),
            os.path.join(dr.REPO_ROOT, "agents/criteria/criteria-passive-income.md"),
        )

    def test_app_ideas(self):
        self.assertEqual(
            dr.criteria_doc_path("app-ideas"),
            os.path.join(dr.REPO_ROOT, "agents/criteria/criteria-apps.md"),
        )

    def test_unknown_track_raises_system_exit(self):
        with self.assertRaises(SystemExit):
            dr.criteria_doc_path("unknown-track")


class BuildIdeaContextTest(unittest.TestCase):
    def _idea(self, **overrides):
        idea = {
            "id": "PI-0013", "title": "Назва", "type": "passive-income",
            "track": "passive-income", "signal_type": "reddit",
            "claimed_revenue": "$500/mo", "mechanic_summary": "механіка",
            "monetization_hypothesis": "гіпотеза",
            "body": "## Аналіз за критеріями\n\nстарий аналіз\n\n## Інше\n\nінший текст",
        }
        idea.update(overrides)
        return idea

    def test_typical_idea_with_sources(self):
        sources = [{"url": "https://a.com", "published_date": "2026-01-01", "author_interest": "high"}]
        ctx = dr.build_idea_context(self._idea(), sources)
        self.assertIn("id: PI-0013, назва: Назва", ctx)
        self.assertIn("джерела знахідки:", ctx)
        self.assertIn("https://a.com (дата: 2026-01-01, інтерес автора: high)", ctx)
        # початковий "Аналіз за критеріями" вирізаний, лишився лише "Інше".
        self.assertNotIn("старий аналіз", ctx)
        self.assertIn("## Інше\n\nінший текст", ctx)

    def test_empty_sources_no_sources_block(self):
        ctx = dr.build_idea_context(self._idea(), [])
        self.assertNotIn("джерела знахідки:", ctx)

    def test_none_fields_use_placeholders(self):
        idea = {
            "id": "PI-0014", "title": None, "type": None, "track": None,
            "signal_type": None, "claimed_revenue": None, "mechanic_summary": None,
            "monetization_hypothesis": None, "body": None,
        }
        ctx = dr.build_idea_context(idea, [])
        self.assertIn("заявлений дохід: не заявлено", ctx)
        self.assertIn("суть механіки: —", ctx)
        self.assertIn("гіпотеза монетизації: —", ctx)
        # body=None -> split_section дає ("", None) без "Опис механіки з картки".
        self.assertNotIn("Опис механіки з картки", ctx)


if __name__ == "__main__":
    unittest.main()
