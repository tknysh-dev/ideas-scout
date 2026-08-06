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
import tempfile
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


class ErrorBranchTest(unittest.TestCase):
    """Дев'ять err-гілок скрипта: усі спрацьовують лише на зламаному стані
    репозиторію, тож на справжньому дереві (OutputContractTest) недосяжні.

    Ні `test_support.load_script`, ні `import` тут не годяться: обидва
    прив'язують REPO_ROOT до реального шляху файлу (див. докстрінг файлу
    вище). Натомість тут беремо текст джерела як є (SOURCE, той самий файл,
    що й SCRIPT_PATH) і виконуємо його через compile()+exec() у просторі
    імен, де `__file__` — вигаданий шлях усередині tempfile-дерева на три
    рівні від кореня (agents/scripts/doctor_prompt_contract.py) — рівно
    стільки ж, скільки production-код знімає dirname() від REPO_ROOT. Це не
    вимагає жодної зміни production-файлу: `os.path.abspath` не звертається
    до диска, лише нормалізує рядок шляху, а reads() всередині скрипта вже
    йдуть у реальні файли, які ми заздалегідь кладемо в tempfile-дерево.

    Кожен тест будує здорове дерево (_baseline_files) і псує рівно одну
    річ — решта лишається робочою, щоб зламана гілка не тонула серед інших
    err-рядків.
    """

    SOURCE = SCRIPT_PATH.read_text(encoding="utf-8")

    def run_against(self, root: Path) -> list[str]:
        # Ім'я файлу навмисно НЕ "doctor_prompt_contract.py": coverage.py
        # (inorout.py, should_trace) звіряє basename __file__ з basename
        # co_filename і довіряє __file__ лише якщо вони збігаються — інакше
        # трактує це як типовий "exec перемістив файл" випадок і трасує
        # проти co_filename. Однакові basename тут зробили б coverage.py
        # звітною проти tmp-шляху, який зникає разом із tempdir ще до звіту.
        # REPO_ROOT рахується від __file__ (три dirname — та сама глибина,
        # незалежно від імені файлу), тому підміна імені REPO_ROOT не чіпає.
        fake_file = str(root / "agents" / "scripts" / "_doctor_prompt_contract_fixture.py")
        code = compile(self.SOURCE, str(SCRIPT_PATH), "exec")
        namespace = {"__file__": fake_file, "__name__": "_doctor_prompt_contract_fixture"}
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            exec(code, namespace)  # noqa: S102 — виконуємо те саме джерело, що й production-файл, лише з підміненим __file__
        return namespace["lines"]

    @staticmethod
    def err_text(lines: list[str]) -> str:
        errs = [msg for level, _, msg in (line.partition("\t") for line in lines) if level == "err"]
        return "\n".join(errs)

    @staticmethod
    def _write_tree(root: Path, files: dict[str, str]) -> None:
        for rel, content in files.items():
            path = root / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")

    @staticmethod
    def _baseline_files() -> dict[str, str]:
        # Мінімальне здорове дерево: усі дев'ять перевірок дають "ok".
        # Кожен тест бере цей словник і псує рівно один запис.
        return {
            "agents/prompts/deep-research-handoff.md": (
                "Дослідження за {{CRITERIA_DOC}} і додатковим блоком {{DEEP_DOC}}.\n\n"
                "Якщо пошук недоступний, напиши рівно: SEARCH UNAVAILABLE\n"
            ),
            "agents/prompts/deep-research-synthesis.md": "Синтезуй звіт: {{REPORT_TEXT}}\n",
            "agents/prompts/deep-research-card.md": "Склади картку: {{CARD_TEXT}}\n",
            "agents/prompts/collector.md": "Збирай дані по {{CRITERIA_DOC}} і {{SEARCH_QUERIES_DOC}}.\n",
            "agents/prompts/analyst.md": "Аналізуй чернетку.\n",
            "agents/prompts/revisor.md": "Перевір чернетку.\n",
            "agents/prompts/triage.md": "Сортуй чернетки.\n",
            "agents/criteria/deep-research.md": (
                "# Критерії deep\n## 1. Перший блок\nопис\n## d_extra. Додатковий блок\nопис\n"
            ),
            "agents/criteria/criteria-passive-income.md": (
                "# Критерії passive\n## 1. Перший критерій\nопис\n## 2. Другий критерій\nопис\n"
            ),
            "agents/criteria/criteria-apps.md": (
                "# Критерії apps\n## 1. Перший критерій\nопис\n## 2. Другий критерій\nопис\n"
            ),
            "agents/criteria/external/brief-deep-blocks.md": (
                "роль: зовнішній\n---\n## 1. Перший блок\nопис\n## d_extra. Додатковий блок\nопис\n"
            ),
            "agents/criteria/external/brief-passive-income.md": (
                "роль: зовнішній\n---\n## 1. Перший критерій\nопис\n## 2. Другий критерій\nопис\n"
            ),
            "agents/criteria/external/brief-apps.md": (
                "роль: зовнішній\n---\n## 1. Перший критерій\nопис\n## 2. Другий критерій\nопис\n"
            ),
            "agents/scripts/runner.sh": (
                "#!/bin/bash\n"
                'case "$TRACK" in\n'
                "  passive-income)\n"
                '    CRITERIA_DOC="agents/criteria/criteria-passive-income.md"\n'
                '    SEARCH_QUERIES_DOC="agents/criteria/criteria-passive-income.md"\n'
                "    ;;\n"
                "  apps)\n"
                '    CRITERIA_DOC="agents/criteria/criteria-apps.md"\n'
                "    ;;\n"
                "esac\n"
            ),
            "agents/scripts/deep-research.py": (
                'REPORT_TEXT = "report"\nCARD_TEXT = "card"\nREFUSAL = "SEARCH UNAVAILABLE"\n'
            ),
            "dashboard/src/lib/deep-research-prompt.ts": (
                'export const CRITERIA_DOC = "criteria";\nexport const DEEP_DOC = "deep";\n'
            ),
            "dashboard/src/lib/deep-research-reports.ts": ('export const REFUSAL_WORD = "SEARCH UNAVAILABLE";\n'),
        }

    def test_baseline_fixture_is_healthy(self):
        # Підстраховка від самих тестів: якщо фікстура зламана, усі наступні
        # тести тестували б не ту гілку. Жодного err на здоровому дереві бути
        # не повинно.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_tree(root, self._baseline_files())
            lines = self.run_against(root)
            self.assertEqual(self.err_text(lines), "")

    def test_missing_handoff_prompt(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = self._baseline_files()
            del files["agents/prompts/deep-research-handoff.md"]
            self._write_tree(root, files)
            errs = self.err_text(self.run_against(root))
            self.assertIn("немає промптів", errs)
            self.assertIn("deep-research-handoff.md (портал)", errs)

    def test_missing_synthesis_prompt(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = self._baseline_files()
            del files["agents/prompts/deep-research-synthesis.md"]
            self._write_tree(root, files)
            errs = self.err_text(self.run_against(root))
            self.assertIn("немає промптів", errs)
            self.assertIn("deep-research-synthesis.md (синтез, виклик A)", errs)

    def test_missing_card_prompt(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = self._baseline_files()
            del files["agents/prompts/deep-research-card.md"]
            self._write_tree(root, files)
            errs = self.err_text(self.run_against(root))
            self.assertIn("немає промптів", errs)
            self.assertIn("deep-research-card.md (синтез, виклик B)", errs)

    def test_missing_criteria_doc(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = self._baseline_files()
            del files["agents/criteria/criteria-apps.md"]
            self._write_tree(root, files)
            errs = self.err_text(self.run_against(root))
            self.assertIn("немає документів критеріїв", errs)
            self.assertIn("criteria-apps.md", errs)

    def test_missing_renderer_of_template(self):
        # Промпт є, а код, що мав би підставляти в нього плейсхолдери — ні.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = self._baseline_files()
            del files["dashboard/src/lib/deep-research-prompt.ts"]
            self._write_tree(root, files)
            errs = self.err_text(self.run_against(root))
            self.assertIn("немає dashboard/src/lib/deep-research-prompt.ts", errs)
            self.assertIn("deep-research-handoff.md", errs)

    def test_orphan_placeholder_in_template(self):
        # Плейсхолдер додано в шаблон, але жоден код його не підставляє.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = self._baseline_files()
            files["agents/prompts/deep-research-synthesis.md"] += "Ще: {{UNUSED_ORPHAN}}\n"
            self._write_tree(root, files)
            errs = self.err_text(self.run_against(root))
            self.assertIn("deep-research-synthesis.md: плейсхолдери {{UNUSED_ORPHAN}}", errs)
            self.assertIn("ніхто не підставляє", errs)

    def test_missing_runner_sh(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = self._baseline_files()
            del files["agents/scripts/runner.sh"]
            self._write_tree(root, files)
            errs = self.err_text(self.run_against(root))
            self.assertIn("немає agents/scripts/runner.sh", errs)

    def test_missing_agent_prompt(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = self._baseline_files()
            del files["agents/prompts/collector.md"]
            self._write_tree(root, files)
            errs = self.err_text(self.run_against(root))
            self.assertIn("немає промпта collector.md", errs)

    def test_agent_prompt_placeholder_not_in_runner(self):
        # Плейсхолдер у промпті нічного агента, якого runner.sh не підставляє.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = self._baseline_files()
            files["agents/prompts/analyst.md"] = "Аналізуй {{NOT_IN_RUNNER}}.\n"
            self._write_tree(root, files)
            errs = self.err_text(self.run_against(root))
            self.assertIn("плейсхолдери, яких не підставляє runner.sh", errs)
            self.assertIn("analyst.md: {{NOT_IN_RUNNER}}", errs)

    def test_prompt_derives_criteria_filename_from_track(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = self._baseline_files()
            files["agents/prompts/triage.md"] = "Критерії: agents/criteria/criteria-{{TRACK}}.md\n"
            self._write_tree(root, files)
            errs = self.err_text(self.run_against(root))
            self.assertIn("промпти складають ім'я файлу критеріїв із назви треку", errs)
            self.assertIn("triage.md", errs)

    def test_runner_has_no_track_mapping(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = self._baseline_files()
            # Слова CRITERIA_DOC/SEARCH_QUERIES_DOC лишаються (щоб не зачепити
            # перевірку плейсхолдерів collector.md), але без формату KEY="шлях".
            files["agents/scripts/runner.sh"] = (
                "#!/bin/bash\n# CRITERIA_DOC і SEARCH_QUERIES_DOC резолвляться десь-інде\necho \"$CRITERIA_DOC $SEARCH_QUERIES_DOC\"\n"
            )
            self._write_tree(root, files)
            errs = self.err_text(self.run_against(root))
            self.assertIn("не знайдено мапінгу треків", errs)

    def test_runner_mapped_doc_missing_on_disk(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = self._baseline_files()
            files["agents/scripts/runner.sh"] = files["agents/scripts/runner.sh"].replace(
                'CRITERIA_DOC="agents/criteria/criteria-apps.md"',
                'CRITERIA_DOC="agents/criteria/criteria-missing.md"',
            )
            self._write_tree(root, files)
            errs = self.err_text(self.run_against(root))
            self.assertIn("показує на неіснуючі документи", errs)
            self.assertIn("criteria-missing.md", errs)

    def test_refusal_word_missing_from_template(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = self._baseline_files()
            files["agents/prompts/deep-research-handoff.md"] = "Дослідження за {{CRITERIA_DOC}} і {{DEEP_DOC}}.\n"
            self._write_tree(root, files)
            errs = self.err_text(self.run_against(root))
            self.assertIn("слово відмови розійшлося", errs)
            self.assertIn("«SEARCH UNAVAILABLE» немає в шаблоні", errs)

    def test_refusal_word_missing_from_parser(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = self._baseline_files()
            files["dashboard/src/lib/deep-research-reports.ts"] = 'export const REFUSAL_WORD = "щось інше";\n'
            self._write_tree(root, files)
            errs = self.err_text(self.run_against(root))
            self.assertIn("слово відмови розійшлося", errs)
            self.assertIn("не знає dashboard/src/lib/deep-research-reports.ts", errs)

    def test_refusal_word_missing_from_synth(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = self._baseline_files()
            files["agents/scripts/deep-research.py"] = 'REPORT_TEXT = "report"\nCARD_TEXT = "card"\n'
            self._write_tree(root, files)
            errs = self.err_text(self.run_against(root))
            self.assertIn("слово відмови розійшлося", errs)
            self.assertIn("не знає agents/scripts/deep-research.py", errs)

    def test_missing_external_brief(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = self._baseline_files()
            del files["agents/criteria/external/brief-apps.md"]
            self._write_tree(root, files)
            errs = self.err_text(self.run_against(root))
            self.assertIn("немає зовнішніх брифів", errs)
            self.assertIn("brief-apps.md", errs)

    def test_brief_does_not_cover_all_criteria(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = self._baseline_files()
            files["agents/criteria/external/brief-passive-income.md"] = "роль: зовнішній\n---\n## 1. Перший критерій\nопис\n"
            self._write_tree(root, files)
            errs = self.err_text(self.run_against(root))
            self.assertIn("зовнішні брифи розійшлись із внутрішніми чек-листами", errs)
            self.assertIn("brief-passive-income.md: немає критеріїв 2", errs)

    def test_brief_leaks_internal_kitchen(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = self._baseline_files()
            files["agents/criteria/external/brief-apps.md"] = (
                "роль: зовнішній\n---\n## 1. Перший критерій\nВрахуй рівень AUTONOMY.\n## 2. Другий критерій\nопис\n"
            )
            self._write_tree(root, files)
            errs = self.err_text(self.run_against(root))
            self.assertIn("у зовнішні брифи просочилась внутрішня кухня", errs)
            self.assertIn("brief-apps.md: AUTONOMY", errs)


if __name__ == "__main__":
    unittest.main()
