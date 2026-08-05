"""Розбір і ремонт JSON-блока з відповіді моделі: extract_json_block та її
приватні помічники (_as_object, _balance_brackets, _slice_object,
_parse_candidate). Фіксує фактичну поведінку на реальних поломках моделей
(незакрита огорожа, зайва кома, обрив на півслові, типографські лапки,
кілька блоків, проза навколо JSON) і на ворожих входах (порожній рядок,
масив замість обʼєкта, дужки/бектики всередині рядкових значень).

_slice_object рахує глибину дужок поза рядками (лапки й екранування
враховуються), тож "}" усередині значення чи в прозі після обʼєкта більше не
переважує справжнє закриття. Одна відома вада лишається в _balance_brackets
(різ по останній комі в усьому тексті на обриві всередині рядка) — вона
позначена коментарем "СУМНІВНО" на місці, deep-research.py в цій частині не
змінювався: обрив однаково рятує попередній крок (_slice_object), тож
до _balance_brackets ця вада на практиці не доходить.
"""
import json
import unittest

from test_support import load_script

dr = load_script("deep-research.py")


class ExtractJsonBlock(unittest.TestCase):
    """Щасливий шлях: чисті форми блока."""

    def test_clean_fenced_json_block(self):
        text = '```json\n{"criteria": [{"criterion_key": "0", "verdict": "passed"}]}\n```'
        self.assertEqual(
            dr.extract_json_block(text),
            {"criteria": [{"criterion_key": "0", "verdict": "passed"}]},
        )

    def test_fence_without_language_tag(self):
        text = '```\n{"criteria": []}\n```'
        self.assertEqual(dr.extract_json_block(text), {"criteria": []})

    def test_fence_language_tag_is_case_insensitive(self):
        text = '```JSON\n{"criteria": []}\n```'
        self.assertEqual(dr.extract_json_block(text), {"criteria": []})

    def test_bare_object_without_any_fence(self):
        text = '{"criteria": []}'
        self.assertEqual(dr.extract_json_block(text), {"criteria": []})

    def test_json_amid_prose_before_and_after(self):
        text = 'Ось звіт:\n{"criteria": [], "note": "ok"}\nДякую за увагу.'
        self.assertEqual(dr.extract_json_block(text), {"criteria": [], "note": "ok"})

    def test_prose_wrapped_object_without_recognised_key_is_rejected(self):
        # _slice_object лагодить прозу навколо блока лише якщо в ньому є
        # один з очікуваних ключів (criteria/competitors/idea_updates) —
        # це навмисний запобіжник від ремонту довільного сміття в текст.
        text = 'Ось звіт:\n{"foo": 1, "bar": 2}\nДякую.'
        self.assertIsNone(dr.extract_json_block(text))

    # --- поломки, які реально трапляються в проді (див. 4bc3da5) -------

    def test_unclosed_fence_is_recovered(self):
        text = '```json\n{"criteria": []}'
        self.assertEqual(dr.extract_json_block(text), {"criteria": []})

    def test_trailing_comma_before_bracket_and_brace(self):
        text = '```json\n{"criteria": [1, 2,],}\n```'
        self.assertEqual(dr.extract_json_block(text), {"criteria": [1, 2]})

    def test_object_truncated_mid_string_drops_incomplete_record(self):
        # Обрив на півслові в другому записі: перший повний запис лишається,
        # другий (недописаний) відкидається цілком — саме так, як описано
        # в коміті 4bc3da5 ("замість нуля вердиктів лишаються ті, що були
        # повними").
        text = (
            '```json\n{"criteria": ['
            '{"criterion_key": "0", "verdict": "passed"}, '
            '{"criterion_key": "1", "verdict": "fail\n```'
        )
        self.assertEqual(
            dr.extract_json_block(text),
            {"criteria": [{"criterion_key": "0", "verdict": "passed"}]},
        )

    def test_smart_quotes_are_normalised(self):
        text = '```json\n{“criteria”: []}\n```'
        self.assertEqual(dr.extract_json_block(text), {"criteria": []})

    def test_all_smart_quote_variants_together(self):
        text = '```json\n{«criteria»: [], „note“: “ok”}\n```'
        self.assertEqual(dr.extract_json_block(text), {"criteria": [], "note": "ok"})

    def test_comment_lines_are_stripped(self):
        text = '```json\n{\n  // коментар моделі\n  "criteria": []\n}\n```'
        self.assertEqual(dr.extract_json_block(text), {"criteria": []})

    def test_multiple_blocks_last_valid_one_wins(self):
        # Кандидати перебираються від останнього блока до першого (саме
        # ваду з протилежним порядком і виправляв 4bc3da5).
        text = '```json\n{invalid}\n```\nпроза між блоками\n```json\n{"criteria": []}\n```'
        self.assertEqual(dr.extract_json_block(text), {"criteria": []})

    def test_nested_objects_and_arrays_round_trip(self):
        text = (
            '```json\n{"criteria": [{"criterion_key": "0", "verdict": "passed", '
            '"evidence": [{"url": "a", "nested": {"a": [1, 2, [3, 4]]}}]}]}\n```'
        )
        self.assertEqual(
            dr.extract_json_block(text),
            {
                "criteria": [
                    {
                        "criterion_key": "0",
                        "verdict": "passed",
                        "evidence": [{"url": "a", "nested": {"a": [1, 2, [3, 4]]}}],
                    }
                ]
            },
        )

    def test_backtick_inside_quoted_string_still_recovered(self):
        # Огорожа-регекс зупиняється на першому "```", що трапиться в
        # рядковому значенні (тут — усередині "detail"), тож фрагмент,
        # знайдений по огорожі, обривається на півслові. Рятує кандидат
        # "увесь текст": там _slice_object шукає першу "{" і останню "}" і
        # саме тут останньою дужкою є справжнє закриття обʼєкта (після
        # огорожі більше "}" немає), тож блок відновлюється повністю.
        text = (
            '```json\n{"criteria": [{"criterion_key": "0", "verdict": "passed", '
            '"detail": "see ``` example"}]}\n```'
        )
        self.assertEqual(
            dr.extract_json_block(text),
            {
                "criteria": [
                    {"criterion_key": "0", "verdict": "passed", "detail": "see ``` example"}
                ]
            },
        )

    def test_brace_inside_quoted_string_does_not_confuse_direct_parse(self):
        text = '{"criteria": [{"criterion_key": "0", "verdict": "passed", "detail": "text with } inside quotes"}]}'
        self.assertEqual(
            dr.extract_json_block(text),
            {
                "criteria": [
                    {"criterion_key": "0", "verdict": "passed", "detail": "text with } inside quotes"}
                ]
            },
        )

    def test_stray_unquoted_brace_after_object_is_ignored(self):
        # _slice_object рахує глибину дужок поза рядками і зупиняється, щойно
        # перший обʼєкт справді закрився — "зайва" `}` у прозі ПІСЛЯ нього
        # більше не переважує справжню закривну дужку.
        text = 'Ось результат:\n{"criteria": []}\nа ще один } десь у тексті.'
        self.assertEqual(dr.extract_json_block(text), {"criteria": []})

    def test_prose_after_object_with_both_braces_is_ignored(self):
        text = 'Результат: {"criteria": []} Далі шаблон {ключ} і ще } десь.'
        self.assertEqual(dr.extract_json_block(text), {"criteria": []})

    def test_brace_inside_string_value_survives_prose_after(self):
        text = '{"criteria": [{"criterion_key": "0", "verdict": "passed", "detail": "шаблон {x}"}]} а ще проза.'
        self.assertEqual(
            dr.extract_json_block(text),
            {"criteria": [{"criterion_key": "0", "verdict": "passed", "detail": "шаблон {x}"}]},
        )

    def test_escaped_quote_before_brace_in_value_survives(self):
        text = r'{"criteria": [{"criterion_key": "0", "verdict": "passed", "detail": "він сказав \"тут}\" і все"}]}'
        self.assertEqual(
            dr.extract_json_block(text),
            {"criteria": [{"criterion_key": "0", "verdict": "passed",
                           "detail": 'він сказав "тут}" і все'}]},
        )

    def test_two_objects_in_a_row_first_one_wins(self):
        text = '{"criteria": []}{"competitors": [{"name": "X"}]}'
        self.assertEqual(dr.extract_json_block(text), {"criteria": []})

    def test_truncated_json_still_recovers_via_balance_brackets(self):
        # Обірваний на півслові вхід має лишитись відновним через
        # _slice_object -> _balance_brackets, попри те, що _slice_object
        # тепер коректно ігнорує "}" усередині рядків.
        text = (
            '```json\n{"criteria": ['
            '{"criterion_key": "0", "verdict": "passed"}, '
            '{"criterion_key": "1", "verdict": "fail\n```'
        )
        self.assertEqual(
            dr.extract_json_block(text),
            {"criteria": [{"criterion_key": "0", "verdict": "passed"}]},
        )

    # --- межові та ворожі входи ----------------------------------------

    def test_text_without_any_json(self):
        self.assertIsNone(dr.extract_json_block("Просто текст без жодного JSON."))

    def test_empty_string(self):
        self.assertIsNone(dr.extract_json_block(""))

    def test_fence_with_no_content(self):
        self.assertIsNone(dr.extract_json_block("```json\n```"))

    def test_top_level_array_is_not_an_object(self):
        # extract_json_block контрактно повертає dict | None: валідний, але
        # НЕ-словниковий JSON (голий масив) відкидається, ремонт його не
        # обгортає в обʼєкт.
        self.assertIsNone(dr.extract_json_block("[1, 2, 3]"))

    def test_deeply_nested_object_round_trip(self):
        depth = 60
        text = "```json\n" + '{"a":' * depth + "1" + "}" * depth + "\n```"
        parsed = dr.extract_json_block(text)
        node = parsed
        for _ in range(depth - 1):
            node = node["a"]
        self.assertEqual(node["a"], 1)


class AsObject(unittest.TestCase):
    def test_valid_object(self):
        self.assertEqual(dr._as_object('{"a": 1}'), {"a": 1})

    def test_valid_array_is_rejected(self):
        self.assertIsNone(dr._as_object("[1, 2]"))

    def test_invalid_json(self):
        self.assertIsNone(dr._as_object("{bad json"))


class BalanceBrackets(unittest.TestCase):
    def test_already_balanced_is_unchanged(self):
        self.assertEqual(dr._balance_brackets('{"a": 1}'), '{"a": 1}')

    def test_closes_single_missing_curly(self):
        self.assertEqual(dr._balance_brackets('{"a": {"b": 1}'), '{"a": {"b": 1}}')

    def test_closes_missing_curly_and_square(self):
        self.assertEqual(
            dr._balance_brackets('{"a": [1, 2, {"b": 1}'),
            '{"a": [1, 2, {"b": 1}]}',
        )

    def test_brace_inside_string_value_is_not_counted(self):
        text = '{"a": "text } with } braces { inside"}'
        self.assertEqual(dr._balance_brackets(text), text)

    def test_escaped_quote_inside_string_keeps_string_open(self):
        text = r'{"a": "she said \"hi\" and left"'
        self.assertEqual(dr._balance_brackets(text), text + "}")

    def test_escaped_backslash_before_closing_quote(self):
        # Подвоєний "\\" перед лапкою — це екранований бекслеш, а не
        # екранування лапки: рядок закривається нормально, друге поле
        # парситься коректно, дозакривається лише зовнішня фігурна дужка.
        text = r'{"a": "path\\", "b": 1'
        self.assertEqual(dr._balance_brackets(text), text + "}")

    def test_cut_mid_string_uses_last_comma_anywhere_in_text(self):
        # СУМНІВНО: коли рядок обривається всередині значення, код ріже по
        # ОСТАННІЙ комі в усьому тексті (raw.rfind(","), без огляду на
        # глибину вкладеності), а дужки, що дозакриваються, полічені по
        # ВСЬОМУ вихідному тексту (до різання). Якщо в недописаному записі
        # вже була своя внутрішня кома (тут — між "criterion_key" і
        # "verdict" другого запису), різ відбувається ПІСЛЯ неї, а не на
        # межі записів масиву. Результат — синтаксично невалідний JSON:
        # другий запис лишається без власної закривної "}" перед "]".
        text = '{"a": [{"criterion_key": "0"}, {"criterion_key": "1", "verdict": "fail'
        result = dr._balance_brackets(text)
        self.assertEqual(result, '{"a": [{"criterion_key": "0"}, {"criterion_key": "1"]}}')
        with self.assertRaises(ValueError):
            json.loads(result)


class SliceObject(unittest.TestCase):
    def test_extracts_object_surrounded_by_prose(self):
        self.assertEqual(dr._slice_object('text {"criteria": []} more text'), '{"criteria": []}')

    def test_no_braces_returns_none(self):
        self.assertIsNone(dr._slice_object("no braces here"))

    def test_no_recognised_key_returns_none(self):
        self.assertIsNone(dr._slice_object('text {"foo": 1} more text'))

    def test_only_opening_brace_returns_none(self):
        self.assertIsNone(dr._slice_object('pre {"criteria": [] no close'))

    def test_stray_unquoted_brace_after_object_does_not_extend_slice(self):
        # Глибина дужок рахується від першого "{"; щойно вона повертається
        # до нуля, обʼєкт вважається закритим — "чужа" `}` у прозі після
        # нього більше не потрапляє у зріз.
        self.assertEqual(
            dr._slice_object('pre {"criteria": []} post } stray'),
            '{"criteria": []}',
        )

    def test_stray_brace_inside_quotes_after_object_is_ignored(self):
        # Те саме, навіть якщо "чужа" `}` сама лежить усередині рядка в
        # прозі після обʼєкта — вона взагалі не бачиться скануванням,
        # оскільки скан зупиняється раніше, на справжньому закритті.
        self.assertEqual(
            dr._slice_object('pre {"criteria": []} post "quoted }" stray'),
            '{"criteria": []}',
        )

    def test_brace_inside_quoted_value_does_not_affect_depth(self):
        text = '{"criteria": [], "note": "шаблон {x}"}'
        self.assertEqual(dr._slice_object(text), text)

    def test_escaped_quote_before_brace_in_value(self):
        text = r'{"criteria": [], "note": "він сказав \"тут}\" і все"}'
        self.assertEqual(dr._slice_object(text), text)

    def test_two_objects_in_a_row_takes_first(self):
        self.assertEqual(
            dr._slice_object('{"criteria": []}{"competitors": []}'),
            '{"criteria": []}',
        )

    def test_truncated_object_slices_to_last_real_closing_brace(self):
        # Обрив усередині другого запису масиву: жодна "}" усередині обірваного
        # рядкового значення не рахується, тож зріз доходить до останньої
        # СПРАВЖНЬОЇ закривної дужки — кінця першого повного запису.
        text = '{"criteria": [{"criterion_key": "0", "verdict": "passed"}, {"criterion_key": "1", "verdict": "fail'
        self.assertEqual(
            dr._slice_object(text),
            '{"criteria": [{"criterion_key": "0", "verdict": "passed"}',
        )


if __name__ == "__main__":
    unittest.main()
