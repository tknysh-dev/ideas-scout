"""doctor_report_test.py — юніт-тести для doctor_report.py.

doctor_report.py має __main__-захист, тож звичайний import безпечний.
run_doctor() ганяє doctor.sh через subprocess.run — цей виклик завжди
підмінений mock.patch.object(doctor_report.subprocess, "run", ...), жоден
тест не запускає реальний doctor.sh.

Основна мішень — format_doctor_report/_render_warnings_only: рівень (маркер
✔/▲/✘/·, який транслюється в EMOJI) визначає, яку emoji-«температуру» й код
виходу побачить власник у Telegram. Контракт документується за фактичною
поведінкою, включно з дивацтвами (позначені коментарем нижче).
"""

from __future__ import annotations

import subprocess
import unittest
from unittest import mock

import doctor_report
from doctor_report import DOCTOR_TIMEOUT_S, TG_TEXT_LIMIT, format_doctor_report


class EscTest(unittest.TestCase):
    def test_ampersand_and_angle_brackets_escaped(self):
        self.assertEqual(doctor_report._esc("<b>&x</b>"), "&lt;b&gt;&amp;x&lt;/b&gt;")

    def test_quotes_not_escaped(self):
        # quote=False: HTML-повідомлення Telegram не потребує &quot;/&#x27;.
        self.assertEqual(doctor_report._esc('a "b" \'c\''), 'a "b" \'c\'')

    def test_non_string_input_stringified(self):
        self.assertEqual(doctor_report._esc(42), "42")

    def test_cyrillic_untouched(self):
        self.assertEqual(doctor_report._esc("привіт"), "привіт")


class FormatDoctorReportFullTest(unittest.TestCase):
    """Повний (не --warnings-only) прогін на невеликому, детермінованому вводі."""

    STDOUT = (
        "Doctor звіт\n"
        "✔ перевірка A\n"
        "▲ перевірка B\n"
        "  ↳ підказка\n"
        "✘ перевірка C\n"
        "· інформаційний рядок\n"
        "Підсумок\n"
        "дивись рядки з ✘ вище\n"
        "3 ок · 1 попереджень · 1 проблем\n"
    )

    def test_exact_output(self):
        text = format_doctor_report(self.STDOUT, 0)
        expected = (
            "🔴 <b>Doctor звіт</b>\n"
            "✅ перевірка A\n"
            "🟡 перевірка B\n"
            "   ↳ <code>підказка</code>\n"
            "🔴 перевірка C\n"
            "⚪ інформаційний рядок\n"
            "\n<b>Підсумок</b>\n"
            "дивись рядки з 🔴 вище\n"
            "3 ок · 1 попереджень · 1 проблем"
        )
        self.assertEqual(text, expected)

    def test_empty_stdout_falls_back_to_doctor_header(self):
        text = format_doctor_report("", 0)
        self.assertEqual(text, "✅ <b>doctor</b>")

    def test_blank_lines_between_content_skipped(self):
        stdout = "Заголовок\n\n✔ пункт\n\n\n"
        text = format_doctor_report(stdout, 0)
        self.assertEqual(text, "✅ <b>Заголовок</b>\n✅ пункт")

    def test_indented_line_without_marker_becomes_plain_tail(self):
        stdout = "Заголовок\n  просто текст з відступом\n"
        text = format_doctor_report(stdout, 0)
        self.assertIn("просто текст з відступом", text)

    def test_head_red_when_errors_present(self):
        stdout = "Заголовок\n5 ок · 2 попереджень · 1 проблем\n"
        text = format_doctor_report(stdout, 0)
        self.assertTrue(text.startswith("🔴"))

    def test_head_yellow_when_only_warnings(self):
        stdout = "Заголовок\n5 ок · 2 попереджень · 0 проблем\n"
        text = format_doctor_report(stdout, 0)
        self.assertTrue(text.startswith("🟡"))

    def test_head_green_when_all_zero(self):
        stdout = "Заголовок\n5 ок · 0 попереджень · 0 проблем\n"
        text = format_doctor_report(stdout, 0)
        self.assertTrue(text.startswith("✅"))

    def test_summary_regex_accepts_declined_suffix(self):
        stdout = "Заголовок\n2 ок · 1 попередження · 0 проблем\n"
        text = format_doctor_report(stdout, 0)
        self.assertIn("2 ок · 1 попереджень · 0 проблем", text)


class FormatDoctorReportErrorPathTest(unittest.TestCase):
    def test_unexpected_returncode_without_counts_short_circuits(self):
        text = format_doctor_report("щось пішло не так", 127, stderr="boom")
        self.assertEqual(text, "❔ <b>Здоров'я системи</b>\ndoctor.sh упав (код 127): boom")

    def test_unexpected_returncode_stderr_whitespace_collapsed_and_truncated(self):
        stderr = ("рядок1\n рядок2   з   пробілами\n" ) + ("x" * 400)
        text = format_doctor_report("", 130, stderr=stderr)
        body = text.split(": ", 1)[1]
        self.assertNotIn("\n", body)
        self.assertLessEqual(len(body), 300)

    def test_unexpected_returncode_empty_stderr_shows_dash(self):
        text = format_doctor_report("", 130, stderr="")
        self.assertTrue(text.endswith("): —"))

    def test_unexpected_returncode_but_counts_present_processed_normally(self):
        # Незвичний код виходу не обриває обробку, якщо підсумок таки знайдено —
        # рахуємо це фактичною поведінкою, а не свідомим рішенням.
        stdout = "Заголовок\n1 ок · 0 попереджень · 0 проблем\n"
        text = format_doctor_report(stdout, 127, stderr="боком")
        self.assertTrue(text.startswith("✅ <b>Заголовок</b>"))

    def test_known_returncode_1_processed_normally_even_without_counts(self):
        text = format_doctor_report("Заголовок\n✔ ок\n", 1)
        self.assertTrue(text.startswith("✅"))

    def test_known_returncode_2_processed_normally_even_without_counts(self):
        text = format_doctor_report("Заголовок\n✔ ок\n", 2)
        self.assertTrue(text.startswith("✅"))


class FormatDoctorReportTrimmingTest(unittest.TestCase):
    """Довгий звіт: спершу ріжуться · (quiet), потім ✔, підсумок лишається завжди."""

    @staticmethod
    def _make_stdout(quiet_count: int, ok_count: int, tail_note: str = "") -> str:
        lines = ["Заголовок"]
        lines += [f"· інфо-рядок номер {i} " + "x" * 60 for i in range(quiet_count)]
        lines += [f"✔ ок-рядок номер {i} " + "x" * 60 for i in range(ok_count)]
        if tail_note:
            lines.append(tail_note)
        lines.append("1 ок · 0 попереджень · 0 проблем")
        return "\n".join(lines)

    def test_fits_without_dropping_when_short(self):
        stdout = self._make_stdout(1, 1)
        text = format_doctor_report(stdout, 0)
        self.assertIn("· інфо-рядок", text.replace("⚪", "·"))

    def test_drops_quiet_markers_first_when_too_long(self):
        stdout = self._make_stdout(80, 0)
        text = format_doctor_report(stdout, 0)
        self.assertLessEqual(len(text), TG_TEXT_LIMIT)
        self.assertNotIn("⚪", text)

    def test_drops_ok_markers_when_dropping_quiet_not_enough(self):
        stdout = self._make_stdout(80, 80)
        text = format_doctor_report(stdout, 0)
        self.assertLessEqual(len(text), TG_TEXT_LIMIT)
        self.assertNotIn("⚪", text)
        self.assertNotIn("✅ ок-рядок", text)
        # Підсумок — те єдине, що ніколи не ріжеться.
        self.assertIn("1 ок · 0 попереджень · 0 проблем", text)

    def test_can_still_exceed_limit_if_errors_alone_are_huge(self):
        # ✘-рядки ніколи не фільтруються жодним drop-набором, тож якщо саме
        # їх дуже багато, функція поверне текст, що й далі перевищує ліміт —
        # найгіршого сценарію останній прохід циклу не рятує.
        stdout = "Заголовок\n" + "\n".join(
            f"✘ помилка номер {i} " + "x" * 80 for i in range(80)
        ) + "\n1 ок · 0 попереджень · 80 проблем"
        text = format_doctor_report(stdout, 0)
        self.assertGreater(len(text), TG_TEXT_LIMIT)


class RenderWarningsOnlyTest(unittest.TestCase):
    def test_no_warnings_or_errors_shows_clean_message(self):
        items = [("check", "✔", "✅ усе ок"), ("check", "·", "⚪ інфо")]
        text = doctor_report._render_warnings_only("✅", ("2", "0", "0"), items)
        self.assertEqual(text, "✅ <b>Здоров'я системи</b>\nЗауважень немає.")

    def test_keeps_warn_and_err_drops_quiet(self):
        items = [
            ("check", "✔", "✅ ок"),
            ("check", "▲", "🟡 warn"),
            ("check", "✘", "🔴 err"),
            ("check", "·", "⚪ quiet"),
        ]
        text = doctor_report._render_warnings_only("🔴", ("1", "1", "1"), items)
        self.assertNotIn("ок", text.split("\n", 2)[-1].split("warn")[0])
        self.assertIn("🟡 warn", text)
        self.assertIn("🔴 err", text)
        self.assertNotIn("⚪ quiet", text)

    def test_hint_kept_only_right_after_kept_check(self):
        items = [
            ("check", "▲", "🟡 warn"),
            ("hint", "", "   ↳ <code>підказка</code>"),
        ]
        text = doctor_report._render_warnings_only("🟡", ("1", "1", "0"), items)
        self.assertIn("↳ <code>підказка</code>", text)

    def test_hint_dropped_after_quiet_check(self):
        items = [
            ("check", "✔", "✅ ок"),
            ("hint", "", "   ↳ <code>не має зʼявитись</code>"),
            ("check", "▲", "🟡 warn"),
        ]
        text = doctor_report._render_warnings_only("🟡", ("1", "1", "0"), items)
        self.assertNotIn("не має зʼявитись", text)

    def test_section_shown_once_before_first_kept_check(self):
        items = [
            ("section", "", "\n<b>Секція</b>"),
            ("check", "✘", "🔴 err"),
        ]
        text = doctor_report._render_warnings_only("🔴", ("0", "0", "1"), items)
        self.assertEqual(text.count("<b>Секція</b>"), 1)

    def test_trailing_section_with_no_following_check_silently_dropped(self):
        # Секція без жодної не-quiet перевірки після себе просто зникає:
        # обробляється лише при виводі check-елемента (out.append(pending_section)).
        items = [
            ("check", "✘", "🔴 err"),
            ("section", "", "\n<b>Порожня секція</b>"),
            ("tail", "", "рядок з підсумком, який теж ігнорується"),
        ]
        text = doctor_report._render_warnings_only("🔴", ("0", "0", "1"), items)
        self.assertNotIn("Порожня секція", text)
        self.assertNotIn("рядок з підсумком", text)

    def test_tail_items_never_shown(self):
        # kind "tail" не обробляється жодною гілкою _render_warnings_only —
        # підсумковий рядок doctor.sh у --warnings-only не потрапляє нікуди.
        items = [
            ("check", "✘", "🔴 err"),
            ("tail", "", "3 ок · 1 попереджень · 1 проблем"),
        ]
        text = doctor_report._render_warnings_only("🔴", ("3", "1", "1"), items)
        self.assertNotIn("3 ок", text)

    def test_title_includes_counts_line(self):
        items = [("check", "✘", "🔴 err")]
        text = doctor_report._render_warnings_only("🔴", ("5", "2", "3"), items)
        self.assertIn("2 попереджень · 3 проблем", text)

    def test_title_without_counts_when_none(self):
        items = [("check", "✘", "🔴 err")]
        text = doctor_report._render_warnings_only("🔴", None, items)
        self.assertEqual(text.split("\n")[0], "🔴 <b>На що глянути</b>")


class RunDoctorTest(unittest.TestCase):
    def test_success_delegates_to_format_doctor_report(self):
        completed = subprocess.CompletedProcess(
            args=["doctor.sh"], returncode=0, stdout="Заголовок\n✔ ок\n", stderr=""
        )
        with mock.patch.object(doctor_report.subprocess, "run", return_value=completed) as run:
            text = doctor_report.run_doctor()
        expected = format_doctor_report("Заголовок\n✔ ок\n", 0, "", warnings_only=False)
        self.assertEqual(text, expected)
        args, kwargs = run.call_args
        self.assertTrue(args[0][0].endswith("agents/scripts/doctor.sh"))
        self.assertEqual(kwargs["cwd"], doctor_report.REPO_ROOT)
        self.assertEqual(kwargs["env"]["NO_COLOR"], "1")
        self.assertEqual(kwargs["timeout"], DOCTOR_TIMEOUT_S)
        self.assertFalse(kwargs["check"])
        self.assertTrue(kwargs["capture_output"])
        self.assertTrue(kwargs["text"])

    def test_warnings_only_passed_through(self):
        completed = subprocess.CompletedProcess(
            args=["doctor.sh"], returncode=0, stdout="Заголовок\n▲ warn\n1 ок · 1 попереджень · 0 проблем\n", stderr=""
        )
        with mock.patch.object(doctor_report.subprocess, "run", return_value=completed):
            text = doctor_report.run_doctor(warnings_only=True)
        self.assertIn("На що глянути", text)

    def test_timeout_returns_placeholder(self):
        with mock.patch.object(
            doctor_report.subprocess, "run",
            side_effect=subprocess.TimeoutExpired(cmd="doctor.sh", timeout=DOCTOR_TIMEOUT_S),
        ):
            text = doctor_report.run_doctor()
        self.assertEqual(
            text,
            f"❔ <b>Здоров'я системи</b>\ndoctor.sh не вклався в {DOCTOR_TIMEOUT_S} с — "
            "швидше за все висить мережева перевірка.",
        )

    def test_oserror_returns_placeholder_with_escaped_message(self):
        with mock.patch.object(
            doctor_report.subprocess, "run", side_effect=OSError("немає прав <b>")
        ):
            text = doctor_report.run_doctor()
        self.assertTrue(text.startswith("❔ <b>Здоров'я системи</b>\nне вдалось запустити doctor.sh:"))
        self.assertIn("&lt;b&gt;", text)


if __name__ == "__main__":
    unittest.main()
