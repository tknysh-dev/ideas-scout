"""doctor_prompt_contract_test.py — юніт-тести для doctor_prompt_contract.py.

doctor_prompt_contract.py не має `if __name__ == "__main__"` — уся його робота
(читання промптів, збір `lines`, друк) виконується на рівні модуля. Тому
звичайний `import` одразу її запускає, і немає окремих функцій-точок входу, які
можна викликати з різними вхідними даними: увесь скрипт — це один прогін проти
REPO_ROOT, обчисленого з __file__. Підмінити REPO_ROOT постфактум не можна —
на момент виконання exec_module усі читання файлів і побудова `lines` уже
відбулись з реальним REPO_ROOT, а `__file__` (і, відповідно, REPO_ROOT) для
завантаженого модуля прив'язаний до фактичного розташування файлу.

Тому контракт цього скрипта перевіряємо так, як з ним працює doctor.sh: як
підпроцес, аналізуючи stdout рядок за рядком (OutputContractTest). Це не
торкається мережі, диска (лише читання) чи Supabase/Telegram — лише читає
файли самого репозиторію, які й так є вхідними даними скрипта.

Додатково — дві чисті функції (`body_of`, `keys_of`) не залежать від
REPO_ROOT, лише від переданого тексту, тож їх ізольовано тестуємо напряму
через test_support.load_script (PureFunctionsTest). Вони й лежать в основі
перевірки «зовнішні брифи покривають внутрішні критерії» — саме тут
проходить основна логіка, яку варто перевірити на синтетичних, а не лише
реальних текстах.
"""

from __future__ import annotations

import contextlib
import io
import subprocess
import sys
import unittest
from pathlib import Path

from test_support import load_script

SCRIPT_PATH = Path(__file__).resolve().parent / "doctor_prompt_contract.py"
# doctor.sh (case-гілка з level) знає ok/warn/err; сам скрипт сьогодні
# емітить лише ok/err — жодного say("warn", ...) у файлі немає.
KNOWN_LEVELS = {"ok", "warn", "err"}


def run_script() -> subprocess.CompletedProcess:
    return subprocess.run(  # noqa: S603
        [sys.executable, str(SCRIPT_PATH)],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )


class OutputContractTest(unittest.TestCase):
    """Контракт doctor.sh: кожен рядок stdout — рівно 'рівень<TAB>повідомлення'."""

    @classmethod
    def setUpClass(cls):
        cls.result = run_script()
        cls.lines = cls.result.stdout.splitlines()

    def test_exits_zero(self):
        self.assertEqual(self.result.returncode, 0)

    def test_no_stderr(self):
        self.assertEqual(self.result.stderr, "")

    def test_produces_output(self):
        self.assertTrue(self.lines)

    def test_every_line_has_exactly_one_tab(self):
        for line in self.lines:
            self.assertEqual(line.count("\t"), 1, f"рядок без рівно одного табу: {line!r}")

    def test_every_level_known(self):
        for line in self.lines:
            level, _, _message = line.partition("\t")
            self.assertIn(level, KNOWN_LEVELS, f"невідомий рівень у рядку: {line!r}")

    def test_message_has_no_embedded_tab(self):
        for line in self.lines:
            _level, _, message = line.partition("\t")
            self.assertNotIn("\t", message)

    def test_message_non_empty(self):
        for line in self.lines:
            _level, _, message = line.partition("\t")
            self.assertTrue(message.strip(), f"порожнє повідомлення: {line!r}")

    def test_real_repo_reports_all_ok(self):
        # Фіксує факт: на момент написання тестів усі промпти, документи
        # критеріїв і зовнішні брифи узгоджені. Якщо контракт колись
        # розійдеться — тест впаде і покаже конкретний err-рядок.
        levels = {line.partition("\t")[0] for line in self.lines}
        self.assertEqual(levels, {"ok"}, f"неочікувані рівні у реальному репозиторії: {self.result.stdout}")

    def test_expected_number_of_checks(self):
        # 9 перевірок сьогодні: три промпти deep-research, документи критеріїв,
        # плейсхолдери×3 (handoff/synthesis/card), промпти нічних агентів,
        # слово відмови, зовнішні брифи.
        self.assertEqual(len(self.lines), 9)


class PureFunctionsTest(unittest.TestCase):
    """body_of/keys_of — єдина логіка скрипта, не прив'язана до REPO_ROOT.

    Завантаження модуля виконує весь скрипт (реальні читання файлів
    репозиторію, без мережі й без записів), тож stdout глушимо, щоб не
    засмічувати вивід тестового прогону.
    """

    @classmethod
    def setUpClass(cls):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            cls.mod = load_script("doctor_prompt_contract.py")

    def test_body_of_strips_header_before_dashes(self):
        # match.end() зупиняється перед символом переносу рядка (MULTILINE $
        # його не поглинає) — сам перенос лишається на початку тіла.
        text = "title: x\nrole: y\n---\nтіло брифа\nще рядок\n"
        self.assertEqual(self.mod.body_of(text), "\nтіло брифа\nще рядок\n")

    def test_body_of_no_dashes_returns_whole_text(self):
        text = "тіло без службової шапки"
        self.assertEqual(self.mod.body_of(text), text)

    def test_body_of_only_first_dashes_line_used(self):
        text = "a\n---\nb\n---\nc\n"
        self.assertEqual(self.mod.body_of(text), "\nb\n---\nc\n")

    def test_body_of_dashes_must_be_whole_line(self):
        # "----" (чотири риски) не збігається з рівно трьома — рядок лишається як є.
        text = "a\n----\nb\n"
        self.assertEqual(self.mod.body_of(text), text)

    def test_body_of_dashes_with_trailing_spaces_still_match(self):
        text = "a\n---  \nb\n"
        self.assertEqual(self.mod.body_of(text), "\nb\n")

    def test_keys_of_dot_separator(self):
        text = "## 1. Перший\n## 2. Другий\n"
        self.assertEqual(self.mod.keys_of(text), {"1", "2"})

    def test_keys_of_space_separator(self):
        text = "## 3 Третій без крапки\n"
        self.assertEqual(self.mod.keys_of(text), {"3"})

    def test_keys_of_d_prefixed_key(self):
        text = "## d_extra. Додатковий блок\n"
        self.assertEqual(self.mod.keys_of(text), {"d_extra"})

    def test_keys_of_duplicates_collapse(self):
        text = "## 1. Перший\n## 1. Перший знову\n"
        self.assertEqual(self.mod.keys_of(text), {"1"})

    def test_keys_of_ignores_deeper_headings(self):
        # "###" — не "##\s+", тож підзаголовки в підрахунок критеріїв не потрапляють.
        text = "## 1. Верхній\n### 1.1 Підпункт\n"
        self.assertEqual(self.mod.keys_of(text), {"1"})

    def test_keys_of_no_matches_returns_empty_set(self):
        self.assertEqual(self.mod.keys_of("звичайний текст без заголовків"), set())

    def test_keys_of_requires_no_and_hash_prefix_before(self):
        # "не ## 1." — заголовок має починатись з початку рядка.
        text = "текст ## 1. не в лічильнику\n"
        self.assertEqual(self.mod.keys_of(text), set())


if __name__ == "__main__":
    unittest.main()
