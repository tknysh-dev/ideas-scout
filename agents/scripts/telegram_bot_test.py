"""telegram_bot_test.py — юніт-тести чистих функцій telegram-bot.py.

Мішень: clip/esc (обрізання й екранування для Telegram), panel_text/panel_buttons/
render (панель стану чернетки), add_fragment/handle_text (накопичення чернетки),
is_substantive (фільтр змістовних повідомлень), process_update (розбір вхідного
Telegram update — недовірений вхід з інтернету).

На рівні модуля telegram-bot.py читає Keychain (TOKEN/CHAT_ID через
`security find-generic-password`) і аварійно виходить, якщо кредів нема.
Щоб тести не чіпали реальний Keychain і не залежали від того, чи він
взагалі доступний у пісочниці, subprocess.run підмінюється фейковим на час
завантаження модуля — telegram-bot.py бачить готові рядки токена й chat_id,
жодного реального виклику `security` не відбувається.

Документує ФАКТИЧНУ поведінку (у т.ч. вже наявні дивацтва), а не бажану —
код telegram-bot.py тут не змінюється.
"""

from __future__ import annotations

import subprocess
import unittest
from unittest.mock import mock_open, patch

from test_support import load_script

FAKE_TOKEN = "111111:fake-token-for-tests"
FAKE_CHAT_ID = "555555555"


def _fake_security_run(cmd, *args, **kwargs):
    """Підміна subprocess.run для keychain(): жодного реального звернення
    до Keychain, лише розбір команди `security find-generic-password -s <service> -w`."""
    service = cmd[3] if len(cmd) > 3 else ""
    stdout = FAKE_CHAT_ID if service == "ideas-scout-telegram-chat" else FAKE_TOKEN
    return subprocess.CompletedProcess(cmd, 0, stdout=stdout, stderr="")


with patch("subprocess.run", side_effect=_fake_security_run):
    bot = load_script("telegram-bot.py")


def make_draft(**overrides):
    d = {
        "id": "20260101-000000",
        "track": "app-ideas",
        "state": "open",
        "fragments": [],
        "panel_msg_id": None,
        "first_msg_id": None,
        "last_msg_time": 0,
        "nudged": False,
        "target_card": None,
        "mode": "new",
    }
    d.update(overrides)
    return d


class ModuleLoadTest(unittest.TestCase):
    def test_fake_credentials_used_not_real_keychain(self):
        self.assertEqual(bot.TOKEN, FAKE_TOKEN)
        self.assertEqual(bot.CHAT_ID, FAKE_CHAT_ID)


class ClipTest(unittest.TestCase):
    def test_empty_string(self):
        self.assertEqual(bot.clip(""), "")

    def test_short_text_unchanged(self):
        self.assertEqual(bot.clip("привіт"), "привіт")

    def test_exactly_at_limit_unchanged(self):
        text = "a" * bot.TG_TEXT_LIMIT
        self.assertEqual(bot.clip(text), text)

    def test_limit_minus_one_unchanged(self):
        text = "a" * (bot.TG_TEXT_LIMIT - 1)
        self.assertEqual(bot.clip(text), text)

    def test_limit_plus_one_truncated(self):
        text = "a" * (bot.TG_TEXT_LIMIT + 1)
        result = bot.clip(text)
        suffix = "\n…(обрізано)"
        self.assertTrue(result.endswith(suffix))
        self.assertEqual(result, "a" * (bot.TG_TEXT_LIMIT - 20) + suffix)
        self.assertEqual(len(result), (bot.TG_TEXT_LIMIT - 20) + len(suffix))

    def test_truncated_prefix_matches_original_head(self):
        text = "".join(str(i % 10) for i in range(bot.TG_TEXT_LIMIT + 500))
        result = bot.clip(text)
        prefix_len = bot.TG_TEXT_LIMIT - 20
        self.assertEqual(result[:prefix_len], text[:prefix_len])

    def test_multibyte_cyrillic_not_cut_mid_character(self):
        text = "ї" * (bot.TG_TEXT_LIMIT + 100)
        result = bot.clip(text)
        prefix_len = bot.TG_TEXT_LIMIT - 20
        # Якщо різання відбулось по кодпоінту коректно, префікс — це рівно
        # prefix_len однакових символів "ї", без сирітських байтів.
        self.assertEqual(result[:prefix_len], "ї" * prefix_len)
        result[:prefix_len].encode("utf-8")  # не кине UnicodeEncodeError

    def test_multibyte_emoji_not_cut_mid_character(self):
        text = "🎉" * (bot.TG_TEXT_LIMIT + 100)
        result = bot.clip(text)
        prefix_len = bot.TG_TEXT_LIMIT - 20
        self.assertEqual(result[:prefix_len], "🎉" * prefix_len)
        result[:prefix_len].encode("utf-8")


class EscTest(unittest.TestCase):
    def test_ampersand(self):
        self.assertEqual(bot.esc("A & B"), "A &amp; B")

    def test_angle_brackets(self):
        self.assertEqual(bot.esc("<script>alert(1)</script>"),
                          "&lt;script&gt;alert(1)&lt;/script&gt;")

    def test_quotes_not_escaped(self):
        # quote=False у виклику html.escape — подвійні й одинарні лапки
        # навмисно НЕ екрануються.
        self.assertEqual(bot.esc('He said "hi"'), 'He said "hi"')
        self.assertEqual(bot.esc("it's fine"), "it's fine")

    def test_cyrillic_untouched(self):
        self.assertEqual(bot.esc("Привіт, світе!"), "Привіт, світе!")

    def test_empty_string(self):
        self.assertEqual(bot.esc(""), "")

    def test_already_escaped_text_gets_double_escaped(self):
        # Факт: esc не ідемпотентний. Повторний виклик на вже екранованому
        # тексті екранує "&" ще раз.
        self.assertEqual(bot.esc("&lt;b&gt;"), "&amp;lt;b&amp;gt;")

    def test_non_string_input_is_stringified(self):
        self.assertEqual(bot.esc(123), "123")
        self.assertEqual(bot.esc(None), "None")

    def test_mixed_html_and_cyrillic(self):
        self.assertEqual(bot.esc("<b>Ідея</b> & друге"),
                          "&lt;b&gt;Ідея&lt;/b&gt; &amp; друге")


class PanelTextTest(unittest.TestCase):
    def test_new_draft_header(self):
        d = make_draft(mode="new")
        text = bot.panel_text(d)
        self.assertTrue(text.startswith("<b>Чернетка</b>\n"))

    def test_append_mode_header_uses_target_card(self):
        d = make_draft(mode="append", target_card="AI-042")
        text = bot.panel_text(d)
        self.assertTrue(text.startswith("↩️ <b>Доповнюю AI-042</b>\n"))

    def test_append_mode_header_escapes_target_card(self):
        d = make_draft(mode="append", target_card="<AI-1>")
        text = bot.panel_text(d)
        self.assertIn("&lt;AI-1&gt;", text)

    def test_empty_fragments_only_header(self):
        d = make_draft(fragments=[])
        text = bot.panel_text(d)
        self.assertEqual(text, "<b>Чернетка</b>\n")

    def test_url_fragment_with_title_ok(self):
        d = make_draft(fragments=[
            {"kind": "url", "value": "http://x.test", "title": "Заголовок",
             "fetch": "ok", "detail": "прочитав, 10 слів"},
        ])
        text = bot.panel_text(d)
        self.assertIn("🔗 Заголовок", text)
        self.assertIn("📄 прочитав, 10 слів", text)

    def test_url_fragment_without_title_falls_back_to_value(self):
        d = make_draft(fragments=[
            {"kind": "url", "value": "http://x.test", "title": "",
             "fetch": "ok", "detail": "ok"},
        ])
        text = bot.panel_text(d)
        self.assertIn("🔗 http://x.test", text)

    def test_url_fragment_not_ok_shows_warning_mark(self):
        d = make_draft(fragments=[
            {"kind": "url", "value": "http://x.test", "title": "",
             "fetch": "paywall", "detail": "платний доступ"},
        ])
        text = bot.panel_text(d)
        self.assertIn("⚠️ платний доступ", text)

    def test_url_title_clipped_to_120_chars(self):
        long_title = "Т" * 300
        d = make_draft(fragments=[
            {"kind": "url", "value": "http://x.test", "title": long_title,
             "fetch": "ok", "detail": "ok"},
        ])
        text = bot.panel_text(d)
        line = next(line for line in text.splitlines() if line.startswith("🔗"))
        self.assertEqual(len(line), len("🔗 ") + 120)

    def test_photo_fragment(self):
        d = make_draft(fragments=[{"kind": "photo", "value": "photo-1.jpg"}])
        text = bot.panel_text(d)
        self.assertIn("🖼 зображення (photo-1.jpg)", text)

    def test_text_fragment(self):
        d = make_draft(fragments=[{"kind": "text", "value": "коментар власника"}])
        text = bot.panel_text(d)
        self.assertIn("💬 коментар власника", text)

    def test_text_fragment_clipped_to_200_chars(self):
        long_text = "x" * 500
        d = make_draft(fragments=[{"kind": "text", "value": long_text}])
        text = bot.panel_text(d)
        line = next(line for line in text.splitlines() if line.startswith("💬"))
        self.assertEqual(len(line), len("💬 ") + 200)

    def test_awaiting_material_appends_prompt(self):
        d = make_draft(state="awaiting_material")
        text = bot.panel_text(d)
        self.assertIn("Скинь текст або скріншот — і оцінюю.", text)

    def test_open_state_no_prompt(self):
        d = make_draft(state="open")
        text = bot.panel_text(d)
        self.assertNotIn("Скинь текст", text)


class PanelButtonsTest(unittest.TestCase):
    def test_running_state_no_buttons(self):
        d = make_draft(state="running")
        self.assertEqual(bot.panel_buttons(d), [])

    def test_running_state_wins_even_in_append_mode(self):
        d = make_draft(state="running", mode="append", target_card="AI-1")
        self.assertEqual(bot.panel_buttons(d), [])

    def test_append_mode_buttons(self):
        d = make_draft(mode="append", target_card="AI-1", state="open")
        buttons = bot.panel_buttons(d)
        self.assertEqual(buttons, [
            [{"text": "Додати й переоцінити", "callback_data": "eval"},
             {"text": "Просто дописати", "callback_data": "append_only"}],
            [{"text": "Викинути", "callback_data": "drop"}],
        ])

    def test_awaiting_material_button_label(self):
        d = make_draft(state="awaiting_material", mode="new")
        buttons = bot.panel_buttons(d)
        self.assertEqual(buttons[0][0], {"text": "Оцінити як є", "callback_data": "eval"})

    def test_open_state_button_label(self):
        d = make_draft(state="open", mode="new")
        buttons = bot.panel_buttons(d)
        self.assertEqual(buttons[0][0], {"text": "Оцінити", "callback_data": "eval"})
        self.assertEqual(buttons[0][1], {"text": "Викинути", "callback_data": "drop"})

    def test_track_row_marks_current_track(self):
        d = make_draft(track="passive-income")
        buttons = bot.panel_buttons(d)
        tracks_row = buttons[1]
        self.assertEqual(tracks_row, [
            {"text": "📱 Апка", "callback_data": "track:app-ideas"},
            {"text": "✓ 💰 Дохід", "callback_data": "track:passive-income"},
        ])

    def test_track_row_default_track_marked(self):
        d = make_draft(track="app-ideas")
        buttons = bot.panel_buttons(d)
        tracks_row = buttons[1]
        self.assertEqual(tracks_row[0]["text"], "✓ 📱 Апка")
        self.assertEqual(tracks_row[1]["text"], "💰 Дохід")


class RenderTest(unittest.TestCase):
    """render() ходить у Telegram API (send/edit) і пише стан на диск
    (save_state) — усі три підмінені моками, перевіряємо лише логіку вибору
    send-vs-edit і оновлення panel_msg_id."""

    def test_no_panel_yet_calls_send_and_stores_id(self):
        d = make_draft(panel_msg_id=None)
        with patch.object(bot, "send", return_value=4242) as mock_send, \
             patch.object(bot, "edit") as mock_edit, \
             patch.object(bot, "save_state") as mock_save:
            bot.render(d)
        mock_send.assert_called_once()
        mock_edit.assert_not_called()
        self.assertEqual(d["panel_msg_id"], 4242)
        mock_save.assert_called_once_with(bot.STATE)

    def test_existing_panel_calls_edit_not_send(self):
        d = make_draft(panel_msg_id=999)
        with patch.object(bot, "send") as mock_send, \
             patch.object(bot, "edit") as mock_edit, \
             patch.object(bot, "save_state") as mock_save:
            bot.render(d)
        mock_edit.assert_called_once()
        mock_send.assert_not_called()
        self.assertEqual(d["panel_msg_id"], 999)
        mock_save.assert_called_once_with(bot.STATE)

    def test_edit_called_with_panel_text_and_buttons(self):
        d = make_draft(panel_msg_id=999, fragments=[{"kind": "text", "value": "hi"}])
        with patch.object(bot, "send"), \
             patch.object(bot, "edit") as mock_edit, \
             patch.object(bot, "save_state"):
            bot.render(d)
        args, kwargs = mock_edit.call_args
        self.assertEqual(args[0], 999)
        self.assertEqual(args[1], bot.panel_text(d))
        self.assertEqual(args[2], bot.panel_buttons(d))


class AddFragmentTest(unittest.TestCase):
    def test_appends_without_losing_previous(self):
        d = make_draft(fragments=[{"kind": "text", "value": "перший"}])
        bot.add_fragment(d, {"kind": "text", "value": "другий"})
        self.assertEqual(len(d["fragments"]), 2)
        self.assertEqual(d["fragments"][0]["value"], "перший")
        self.assertEqual(d["fragments"][1]["value"], "другий")

    def test_open_state_untouched_by_append(self):
        d = make_draft(state="open")
        bot.add_fragment(d, {"kind": "text", "value": "x"})
        self.assertEqual(d["state"], "open")

    def test_awaiting_material_unlocked_by_photo(self):
        d = make_draft(state="awaiting_material")
        bot.add_fragment(d, {"kind": "photo", "value": "p.jpg"})
        self.assertEqual(d["state"], "open")

    def test_awaiting_material_unlocked_by_long_text(self):
        d = make_draft(state="awaiting_material")
        bot.add_fragment(d, {"kind": "text", "value": "a" * bot.PASTED_ARTICLE_MIN})
        self.assertEqual(d["state"], "open")

    def test_awaiting_material_not_unlocked_by_short_text(self):
        d = make_draft(state="awaiting_material")
        bot.add_fragment(d, {"kind": "text", "value": "a" * (bot.PASTED_ARTICLE_MIN - 1)})
        self.assertEqual(d["state"], "awaiting_material")

    def test_awaiting_material_not_unlocked_by_url(self):
        d = make_draft(state="awaiting_material")
        bot.add_fragment(d, {"kind": "url", "value": "http://x.test",
                              "fetch": "ok", "detail": "", "title": ""})
        self.assertEqual(d["state"], "awaiting_material")

    def test_boundary_exactly_min_unlocks(self):
        d = make_draft(state="awaiting_material")
        bot.add_fragment(d, {"kind": "text", "value": "a" * bot.PASTED_ARTICLE_MIN})
        self.assertEqual(d["state"], "open")


class HandleTextTest(unittest.TestCase):
    """handle_text ходить у мережу (fetch_url) і пише файл на диск (open) —
    обидві залежності підмінені моками; перевіряємо лише розбір тексту й
    накопичення фрагментів."""

    def test_plain_text_no_url(self):
        d = make_draft()
        with patch.object(bot, "fetch_url") as mock_fetch:
            bot.handle_text(d, "просто коментар без лінка")
        mock_fetch.assert_not_called()
        self.assertEqual(len(d["fragments"]), 1)
        self.assertEqual(d["fragments"][0], {"kind": "text", "value": "просто коментар без лінка"})

    def test_url_only_ok_fetch_no_text_fragment(self):
        d = make_draft()
        with patch.object(bot, "fetch_url", return_value=("ok", "прочитав", "Титул", "стаття" * 100)), \
             patch("builtins.open", mock_open()) as m_open:
            bot.handle_text(d, "http://x.test/a")
        self.assertEqual(len(d["fragments"]), 1)
        fr = d["fragments"][0]
        self.assertEqual(fr["kind"], "url")
        self.assertEqual(fr["fetch"], "ok")
        self.assertEqual(fr["title"], "Титул")
        self.assertEqual(d["state"], "open")
        m_open.assert_called_once()
        handle = m_open()
        handle.write.assert_called()

    def test_url_and_trailing_comment(self):
        d = make_draft()
        with patch.object(bot, "fetch_url", return_value=("ok", "ok", "", "")), \
             patch("builtins.open", mock_open()):
            bot.handle_text(d, "http://x.test/a круто, правда?")
        kinds = [fr["kind"] for fr in d["fragments"]]
        self.assertEqual(kinds, ["url", "text"])
        self.assertEqual(d["fragments"][1]["value"], "круто, правда?")

    def test_no_body_no_file_write(self):
        d = make_draft()
        with patch.object(bot, "fetch_url", return_value=("empty", "порожньо", "", "")), \
             patch("builtins.open", mock_open()) as m_open:
            bot.handle_text(d, "http://x.test/a")
        m_open.assert_not_called()

    def test_fetch_not_ok_sets_awaiting_material(self):
        d = make_draft(state="open")
        with patch.object(bot, "fetch_url", return_value=("paywall", "платний доступ", "", "")), \
             patch("builtins.open", mock_open()):
            bot.handle_text(d, "http://x.test/a")
        self.assertEqual(d["state"], "awaiting_material")

    def test_multiple_urls_processed_in_order(self):
        d = make_draft()
        responses = [
            ("ok", "перший", "T1", "стаття" * 100),
            ("ok", "другий", "T2", "стаття" * 100),
        ]
        with patch.object(bot, "fetch_url", side_effect=responses), \
             patch("builtins.open", mock_open()) as m_open:
            bot.handle_text(d, "http://a.test http://b.test")
        titles = [fr["title"] for fr in d["fragments"] if fr["kind"] == "url"]
        self.assertEqual(titles, ["T1", "T2"])
        self.assertEqual(m_open.call_count, 2)
        first_path = m_open.call_args_list[0].args[0]
        second_path = m_open.call_args_list[1].args[0]
        self.assertIn("source-1.txt", first_path)
        self.assertIn("source-2.txt", second_path)

    def test_only_whitespace_after_url_removed_adds_no_text_fragment(self):
        d = make_draft()
        with patch.object(bot, "fetch_url", return_value=("ok", "ok", "", "")), \
             patch("builtins.open", mock_open()):
            bot.handle_text(d, "   http://x.test/a   ")
        kinds = [fr["kind"] for fr in d["fragments"]]
        self.assertEqual(kinds, ["url"])


class IsSubstantiveTest(unittest.TestCase):
    def test_empty_message(self):
        self.assertFalse(bot.is_substantive({}))

    def test_photo_present_always_substantive(self):
        self.assertTrue(bot.is_substantive({"photo": [{"file_id": "x"}]}))

    def test_document_present_always_substantive(self):
        self.assertTrue(bot.is_substantive({"document": {"file_id": "x"}}))

    def test_empty_photo_list_is_falsy_falls_through_to_text(self):
        # Факт: [] є falsy в Python, тож порожній photo-список НЕ рахується
        # присутністю фото — перевірка провалюється до тексту.
        self.assertFalse(bot.is_substantive({"photo": [], "text": "коротко"}))

    def test_empty_document_dict_is_falsy_falls_through(self):
        self.assertFalse(bot.is_substantive({"document": {}, "text": "коротко"}))

    def test_short_text_not_substantive(self):
        self.assertFalse(bot.is_substantive({"text": "a" * 24}))

    def test_text_exactly_25_chars_is_substantive(self):
        self.assertTrue(bot.is_substantive({"text": "a" * 25}))

    def test_short_text_with_url_is_substantive(self):
        self.assertTrue(bot.is_substantive({"text": "http://x.test"}))

    def test_caption_used_when_no_text(self):
        self.assertTrue(bot.is_substantive({"caption": "a" * 25}))

    def test_whitespace_only_text_not_substantive(self):
        self.assertFalse(bot.is_substantive({"text": "   \n\t  "}))

    def test_missing_text_and_caption_not_substantive(self):
        self.assertFalse(bot.is_substantive({"foo": "bar"}))


class ProcessUpdateTest(unittest.TestCase):
    def test_non_dict_raises_type_error(self):
        for bad in (None, "string", 123, [1, 2], 1.5):
            with self.subTest(bad=bad):
                with self.assertRaises(TypeError):
                    bot.process_update(bad)

    def test_empty_dict_raises_type_error(self):
        with self.assertRaises(TypeError):
            bot.process_update({})

    def test_missing_update_id_raises_type_error(self):
        with self.assertRaises(TypeError):
            bot.process_update({"message": {}})

    def test_update_id_as_string_raises_type_error(self):
        with self.assertRaises(TypeError):
            bot.process_update({"update_id": "123"})

    def test_update_id_as_float_raises_type_error(self):
        with self.assertRaises(TypeError):
            bot.process_update({"update_id": 123.0})

    def test_update_id_bool_true_does_not_raise(self):
        # Факт: isinstance(True, int) є True в Python, тож update_id=True
        # проходить перевірку типу без винятку.
        with patch.object(bot, "on_message") as mock_msg, \
             patch.object(bot, "on_callback") as mock_cb:
            bot.process_update({"update_id": True})
        mock_msg.assert_not_called()
        mock_cb.assert_not_called()

    def test_update_id_bool_false_does_not_raise(self):
        with patch.object(bot, "on_message") as mock_msg, \
             patch.object(bot, "on_callback") as mock_cb:
            bot.process_update({"update_id": False})
        mock_msg.assert_not_called()
        mock_cb.assert_not_called()

    def test_valid_update_id_no_message_or_callback_noop(self):
        with patch.object(bot, "on_message") as mock_msg, \
             patch.object(bot, "on_callback") as mock_cb:
            bot.process_update({"update_id": 1})
        mock_msg.assert_not_called()
        mock_cb.assert_not_called()

    def test_message_for_our_chat_dispatched(self):
        upd = {"update_id": 1, "message": {"chat": {"id": int(bot.CHAT_ID)}, "text": "hi"}}
        with patch.object(bot, "on_message") as mock_msg:
            bot.process_update(upd)
        mock_msg.assert_called_once_with(upd["message"])

    def test_message_for_other_chat_ignored_silently(self):
        upd = {"update_id": 1, "message": {"chat": {"id": 1}, "text": "hi"}}
        with patch.object(bot, "on_message") as mock_msg:
            bot.process_update(upd)
        mock_msg.assert_not_called()

    def test_callback_query_for_our_chat_dispatched(self):
        upd = {"update_id": 1, "callback_query":
               {"message": {"chat": {"id": int(bot.CHAT_ID)}}, "data": "eval"}}
        with patch.object(bot, "on_callback") as mock_cb:
            bot.process_update(upd)
        mock_cb.assert_called_once_with(upd["callback_query"])

    def test_callback_query_for_other_chat_ignored(self):
        upd = {"update_id": 1, "callback_query": {"message": {"chat": {"id": 1}}}}
        with patch.object(bot, "on_callback") as mock_cb:
            bot.process_update(upd)
        mock_cb.assert_not_called()

    def test_message_not_a_dict_raises_attribute_error(self):
        # Факт: перевіряється лише тип верхнього рівня (update_id). Якщо
        # message виявляється не словником, падає AttributeError, а не
        # TypeError з єдиного вхідного бар'єра функції.
        upd = {"update_id": 1, "message": "oops"}
        with self.assertRaises(AttributeError):
            bot.process_update(upd)

    def test_message_chat_not_a_dict_raises_attribute_error(self):
        upd = {"update_id": 1, "message": {"chat": "oops"}}
        with self.assertRaises(AttributeError):
            bot.process_update(upd)

    def test_callback_query_not_a_dict_raises_attribute_error(self):
        upd = {"update_id": 1, "callback_query": "oops"}
        with self.assertRaises(AttributeError):
            bot.process_update(upd)

    def test_message_missing_chat_key_ignored_not_dispatched(self):
        # chat відсутній -> {}.get("id") -> None -> str(None) != CHAT_ID.
        upd = {"update_id": 1, "message": {"text": "hi"}}
        with patch.object(bot, "on_message") as mock_msg:
            bot.process_update(upd)
        mock_msg.assert_not_called()


if __name__ == "__main__":
    unittest.main()
