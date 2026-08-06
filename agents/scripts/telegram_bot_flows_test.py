"""telegram_bot_flows_test.py — юніт-тести побічних ефектів telegram-bot.py.

Доповнює telegram_bot_test.py (там — чисті функції: esc/clip/panel_text/...).
Тут — усе, що раніше не мало прийому: маршрутизація вхідних подій
(on_message/on_callback/on_command), запуск тріажу (run_triage), запис у
Supabase (write_inbox), мережевий читач посилань (fetch_url — HTTP-коди,
маркери paywall/login), фото (handle_photo), команди читання (cmd_status/
cmd_last/read_run_status/read_verdict), фонові нагадування
(nudge_if_idle/recover_interrupted_triage) і файл стану
(load_state/save_state/new_draft/drop_draft).

Той самий прийом підміни subprocess.run на час завантаження модуля, що й у
telegram_bot_test.py (Keychain). Жоден тест не ходить у мережу, не пише в
реальний Supabase, не запускає runner.sh і не чіпає
~/Library/Application Support/ideas-scout — шляхи стану підмінені тимчасовими
каталогами через BotStateTestCase.

Документує ФАКТИЧНУ поведінку, код telegram-bot.py тут не змінюється.
"""

from __future__ import annotations

import importlib.util
import inspect
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
from unittest import mock

import test_support
from test_support import load_script

FAKE_TOKEN = "111111:fake-token-for-tests"  # noqa: S105 — фейковий токен для тестів, не секрет
FAKE_CHAT_ID = "555555555"


def _fake_security_run(cmd, *args, **kwargs):
    service = cmd[3] if len(cmd) > 3 else ""
    stdout = FAKE_CHAT_ID if service == "ideas-scout-telegram-chat" else FAKE_TOKEN
    return subprocess.CompletedProcess(cmd, 0, stdout=stdout, stderr="")


with mock.patch("subprocess.run", side_effect=_fake_security_run):
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


class BotStateTestCase(unittest.TestCase):
    """STATE_DIR/STATE_FILE/DRAFT_DIR/REPO_ROOT підмінені тимчасовими шляхами
    на час тесту — жоден тест не торкається ~/Library/Application Support/
    ideas-scout чи реального репозиторію. STATE скидається до порожньої
    чернетки перед кожним тестом і повертається до попереднього значення
    після нього."""

    def setUp(self):
        self._tmpdir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self._tmpdir, ignore_errors=True)
        self._state_dir = os.path.join(self._tmpdir, "state")
        self._state_file = os.path.join(self._state_dir, "telegram-state.json")
        self._draft_dir = os.path.join(self._state_dir, "draft")
        self._repo_root = os.path.join(self._tmpdir, "repo")
        os.makedirs(self._repo_root, exist_ok=True)
        for attr, value in (
            ("STATE_DIR", self._state_dir),
            ("STATE_FILE", self._state_file),
            ("DRAFT_DIR", self._draft_dir),
            ("REPO_ROOT", self._repo_root),
        ):
            patcher = mock.patch.object(bot, attr, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self._orig_state = bot.STATE
        bot.STATE = {"draft": None}
        self.addCleanup(self._restore_state)

    def _restore_state(self):
        bot.STATE = self._orig_state


# ---------------------------------------------------------------------------
# fetch_url — HTTP-коди, маркери paywall/login, обмеження розміру відповіді
# ---------------------------------------------------------------------------

class FetchUrlHttpErrorsTest(unittest.TestCase):
    def _http_error(self, code, body=b""):
        err = urllib.error.HTTPError(url="https://x.test", code=code, msg="err", hdrs=None,
                                      fp=io.BytesIO(body))
        self.addCleanup(err.close)
        return err

    def test_401_is_blocked(self):
        with mock.patch.object(bot.urllib.request, "urlopen", side_effect=self._http_error(401)):
            state, detail, _t, _b = bot.fetch_url("https://x.test/a")
        self.assertEqual(state, "blocked")
        self.assertIn("401", detail)

    def test_403_is_blocked(self):
        with mock.patch.object(bot.urllib.request, "urlopen", side_effect=self._http_error(403)):
            state, _d, _t, _b = bot.fetch_url("https://x.test/a")
        self.assertEqual(state, "blocked")

    def test_404_is_missing(self):
        with mock.patch.object(bot.urllib.request, "urlopen", side_effect=self._http_error(404)):
            state, _d, _t, _b = bot.fetch_url("https://x.test/a")
        self.assertEqual(state, "missing")

    def test_402_is_paywall(self):
        with mock.patch.object(bot.urllib.request, "urlopen", side_effect=self._http_error(402)):
            state, _d, _t, _b = bot.fetch_url("https://x.test/a")
        self.assertEqual(state, "paywall")

    def test_other_http_code_is_generic_error(self):
        with mock.patch.object(bot.urllib.request, "urlopen", side_effect=self._http_error(500)):
            state, detail, _t, _b = bot.fetch_url("https://x.test/a")
        self.assertEqual(state, "error")
        self.assertIn("500", detail)

    def test_url_error_is_generic_error(self):
        with mock.patch.object(bot.urllib.request, "urlopen",
                                side_effect=urllib.error.URLError("мережа лежить")):
            state, detail, _t, _b = bot.fetch_url("https://x.test/a")
        self.assertEqual(state, "error")
        self.assertIn("мережа лежить", detail)

    def test_oserror_is_generic_error(self):
        with mock.patch.object(bot.urllib.request, "urlopen", side_effect=OSError("зламано")):
            state, _d, _t, _b = bot.fetch_url("https://x.test/a")
        self.assertEqual(state, "error")

    def test_timeout_error_is_generic_error(self):
        with mock.patch.object(bot.urllib.request, "urlopen", side_effect=TimeoutError("тайм-аут")):
            state, _d, _t, _b = bot.fetch_url("https://x.test/a")
        self.assertEqual(state, "error")


class FetchUrlContentTest(unittest.TestCase):
    def _response(self, body: bytes, charset="utf-8"):
        response = mock.MagicMock()
        response.read.side_effect = lambda n=None: body[:n] if n is not None else body
        response.headers.get_content_charset.return_value = charset
        response.__enter__.return_value = response
        return response

    def test_reads_at_most_fetch_max_bytes(self):
        huge = b"<html><body>" + b"a" * 450_000 + b"</body></html>"
        response = self._response(huge)
        with mock.patch.object(bot.urllib.request, "urlopen", return_value=response):
            bot.fetch_url("https://x.test/a")
        response.read.assert_called_once_with(bot.FETCH_MAX_BYTES)

    def test_paywall_marker_detected_even_when_short(self):
        body = "<html><body>Оформіть підписку, щоб читати цю статтю.</body></html>".encode()
        response = self._response(body)
        with mock.patch.object(bot.urllib.request, "urlopen", return_value=response):
            state, _d, _t, _b = bot.fetch_url("https://x.test/a")
        self.assertEqual(state, "paywall")

    def test_login_marker_detected(self):
        body = b"<html><body>Please log in to continue reading.</body></html>"
        response = self._response(body)
        with mock.patch.object(bot.urllib.request, "urlopen", return_value=response):
            state, _d, _t, _b = bot.fetch_url("https://x.test/a")
        self.assertEqual(state, "login")

    def test_short_plain_text_is_empty(self):
        body = "<html><body>коротко</body></html>".encode()
        response = self._response(body)
        with mock.patch.object(bot.urllib.request, "urlopen", return_value=response):
            state, _d, _t, _b = bot.fetch_url("https://x.test/a")
        self.assertEqual(state, "empty")

    def test_text_length_399_chars_is_empty(self):
        body = ("<html><body>" + "a" * 399 + "</body></html>").encode()
        response = self._response(body)
        with mock.patch.object(bot.urllib.request, "urlopen", return_value=response):
            state, _d, _t, text_out = bot.fetch_url("https://x.test/a")
        self.assertEqual(len(text_out), 399)
        self.assertEqual(state, "empty")

    def test_text_length_400_chars_is_ok(self):
        body = ("<html><body>" + "a" * 400 + "</body></html>").encode()
        response = self._response(body)
        with mock.patch.object(bot.urllib.request, "urlopen", return_value=response):
            state, _d, _t, text_out = bot.fetch_url("https://x.test/a")
        self.assertEqual(len(text_out), 400)
        self.assertEqual(state, "ok")

    def test_title_extracted_and_tags_stripped(self):
        body = ("<html><head><title>Моя <b>Стаття</b></title></head><body>"
                 + "текст " * 100 + "</body></html>").encode()
        response = self._response(body)
        with mock.patch.object(bot.urllib.request, "urlopen", return_value=response):
            _s, _d, title, _b = bot.fetch_url("https://x.test/a")
        self.assertEqual(title, "Моя Стаття")

    def test_script_content_excluded_from_paywall_check(self):
        body = ("<html><body><script>subscribe to continue</script>"
                 + "текст " * 100 + "</body></html>").encode()
        response = self._response(body)
        with mock.patch.object(bot.urllib.request, "urlopen", return_value=response):
            state, _d, _t, _b = bot.fetch_url("https://x.test/a")
        self.assertEqual(state, "ok")

    def test_missing_charset_defaults_to_utf8(self):
        body = ("<html><body>" + "приваблива стаття " * 40 + "</body></html>").encode("utf-8")
        response = self._response(body, charset=None)
        with mock.patch.object(bot.urllib.request, "urlopen", return_value=response):
            state, _d, _t, body_out = bot.fetch_url("https://x.test/a")
        self.assertEqual(state, "ok")
        self.assertIn("приваблива", body_out)


# ---------------------------------------------------------------------------
# handle_photo
# ---------------------------------------------------------------------------

class HandlePhotoTest(BotStateTestCase):
    def test_get_file_failure_no_download_no_fragment(self):
        d = make_draft()
        with mock.patch.object(bot, "api", return_value={"ok": False}) as mock_api, \
             mock.patch.object(bot.urllib.request, "urlretrieve") as mock_retrieve:
            bot.handle_photo(d, "file1", "")
        mock_api.assert_called_once_with("getFile", file_id="file1")
        mock_retrieve.assert_not_called()
        self.assertEqual(d["fragments"], [])

    def test_get_file_returns_none_no_download(self):
        d = make_draft()
        with mock.patch.object(bot, "api", return_value=None), \
             mock.patch.object(bot.urllib.request, "urlretrieve") as mock_retrieve:
            bot.handle_photo(d, "file1", "")
        mock_retrieve.assert_not_called()

    def test_download_failure_urlerror_no_fragment(self):
        d = make_draft()
        os.makedirs(self._draft_dir, exist_ok=True)
        api_resp = {"ok": True, "result": {"file_path": "photos/x.jpg"}}
        with mock.patch.object(bot, "api", return_value=api_resp), \
             mock.patch.object(bot.urllib.request, "urlretrieve",
                                side_effect=urllib.error.URLError("мережа лежить")):
            bot.handle_photo(d, "file1", "")
        self.assertEqual(d["fragments"], [])

    def test_download_failure_oserror_no_fragment(self):
        d = make_draft()
        os.makedirs(self._draft_dir, exist_ok=True)
        api_resp = {"ok": True, "result": {"file_path": "photos/x.jpg"}}
        with mock.patch.object(bot, "api", return_value=api_resp), \
             mock.patch.object(bot.urllib.request, "urlretrieve", side_effect=OSError("диск повний")):
            bot.handle_photo(d, "file1", "")
        self.assertEqual(d["fragments"], [])

    def test_success_adds_photo_fragment(self):
        d = make_draft()
        os.makedirs(self._draft_dir, exist_ok=True)
        api_resp = {"ok": True, "result": {"file_path": "photos/x.jpg"}}
        with mock.patch.object(bot, "api", return_value=api_resp), \
             mock.patch.object(bot.urllib.request, "urlretrieve") as mock_retrieve:
            bot.handle_photo(d, "file1", "")
        self.assertEqual(d["fragments"], [{"kind": "photo", "value": "photo-1.jpg"}])
        dest = mock_retrieve.call_args.args[1]
        self.assertEqual(dest, os.path.join(self._draft_dir, "photo-1.jpg"))

    def test_success_with_caption_adds_text_fragment_too(self):
        d = make_draft()
        os.makedirs(self._draft_dir, exist_ok=True)
        api_resp = {"ok": True, "result": {"file_path": "photos/x.jpg"}}
        with mock.patch.object(bot, "api", return_value=api_resp), \
             mock.patch.object(bot.urllib.request, "urlretrieve"):
            bot.handle_photo(d, "file1", "підпис")
        kinds = [fr["kind"] for fr in d["fragments"]]
        self.assertEqual(kinds, ["photo", "text"])
        self.assertEqual(d["fragments"][1]["value"], "підпис")

    def test_no_extension_defaults_to_jpg(self):
        d = make_draft()
        os.makedirs(self._draft_dir, exist_ok=True)
        api_resp = {"ok": True, "result": {"file_path": "photos/noext"}}
        with mock.patch.object(bot, "api", return_value=api_resp), \
             mock.patch.object(bot.urllib.request, "urlretrieve"):
            bot.handle_photo(d, "file1", "")
        self.assertEqual(d["fragments"][0]["value"], "photo-1.jpg")

    def test_extension_preserved(self):
        d = make_draft()
        os.makedirs(self._draft_dir, exist_ok=True)
        api_resp = {"ok": True, "result": {"file_path": "photos/pic.png"}}
        with mock.patch.object(bot, "api", return_value=api_resp), \
             mock.patch.object(bot.urllib.request, "urlretrieve"):
            bot.handle_photo(d, "file1", "")
        self.assertEqual(d["fragments"][0]["value"], "photo-1.png")

    def test_numbering_continues_from_existing_photos(self):
        d = make_draft(fragments=[{"kind": "photo", "value": "photo-1.jpg"}])
        os.makedirs(self._draft_dir, exist_ok=True)
        api_resp = {"ok": True, "result": {"file_path": "photos/x.jpg"}}
        with mock.patch.object(bot, "api", return_value=api_resp), \
             mock.patch.object(bot.urllib.request, "urlretrieve"):
            bot.handle_photo(d, "file1", "")
        self.assertEqual(d["fragments"][1]["value"], "photo-2.jpg")

    def test_downloaded_url_uses_token_and_file_path(self):
        d = make_draft()
        os.makedirs(self._draft_dir, exist_ok=True)
        api_resp = {"ok": True, "result": {"file_path": "photos/x.jpg"}}
        with mock.patch.object(bot, "api", return_value=api_resp), \
             mock.patch.object(bot.urllib.request, "urlretrieve") as mock_retrieve:
            bot.handle_photo(d, "file1", "")
        url = mock_retrieve.call_args.args[0]
        self.assertEqual(url, f"{bot.API}/file/bot{bot.TOKEN}/photos/x.jpg")


# ---------------------------------------------------------------------------
# on_message
# ---------------------------------------------------------------------------

class OnMessageTest(BotStateTestCase):
    def setUp(self):
        super().setUp()
        self._patches = {
            "send": mock.patch.object(bot, "send", return_value=1),
            "react": mock.patch.object(bot, "react"),
            "render": mock.patch.object(bot, "render"),
            "handle_text": mock.patch.object(bot, "handle_text"),
            "handle_photo": mock.patch.object(bot, "handle_photo"),
            "on_command": mock.patch.object(bot, "on_command"),
        }
        self.mocks = {name: p.start() for name, p in self._patches.items()}
        for p in self._patches.values():
            self.addCleanup(p.stop)

    def test_command_dispatches_and_returns_early(self):
        bot.on_message({"message_id": 1, "text": "/help"})
        self.mocks["on_command"].assert_called_once_with("help", 1)
        self.mocks["react"].assert_not_called()
        self.mocks["render"].assert_not_called()

    def test_command_with_args_extracts_bare_command(self):
        bot.on_message({"message_id": 1, "text": "/status extra args here"})
        self.mocks["on_command"].assert_called_once_with("status", 1)

    def test_command_with_bot_username_suffix_stripped(self):
        bot.on_message({"message_id": 1, "text": "/help@MyIdeasBot"})
        self.mocks["on_command"].assert_called_once_with("help", 1)

    def test_command_dispatched_even_while_draft_running(self):
        # Факт: перевірка "/" йде РАНІШЕ перевірки d["state"]=="running" —
        # команда проходить навіть коли триває оцінка.
        bot.STATE["draft"] = make_draft(state="running")
        bot.on_message({"message_id": 1, "text": "/new"})
        self.mocks["on_command"].assert_called_once_with("new", 1)
        self.mocks["send"].assert_not_called()

    def test_running_draft_blocks_and_replies(self):
        bot.STATE["draft"] = make_draft(state="running")
        bot.on_message({"message_id": 9, "text": "звичайне повідомлення завдовжки понад 25 символів"})
        self.mocks["send"].assert_called_once()
        args, kwargs = self.mocks["send"].call_args
        self.assertIn("почекай", args[0])
        self.assertEqual(kwargs.get("reply_to"), 9)
        self.mocks["handle_text"].assert_not_called()

    def test_empty_message_reacts_confused(self):
        bot.on_message({"message_id": 4})
        self.mocks["react"].assert_called_once_with(4, "🤔")

    def test_non_substantive_no_card_reacts_confused(self):
        bot.on_message({"message_id": 5, "text": "коротко"})
        self.mocks["react"].assert_called_once_with(5, "🤔")
        self.mocks["render"].assert_not_called()

    def test_card_reply_starts_append_draft(self):
        msg = {
            "message_id": 10, "text": "ще матеріал",
            "reply_to_message": {"text": "Вердикт по AI-042"},
        }
        with mock.patch.object(bot, "new_draft", wraps=bot.new_draft) as spy_new:
            bot.on_message(msg)
        spy_new.assert_called_once()
        d = bot.STATE["draft"]
        self.assertEqual(d["mode"], "append")
        self.assertEqual(d["target_card"], "AI-042")
        self.mocks["handle_text"].assert_called_once_with(d, "ще матеріал")

    def test_card_reply_matching_existing_append_draft_reuses_it(self):
        existing = bot.new_draft()
        existing["mode"] = "append"
        existing["target_card"] = "AI-042"
        existing["last_msg_time"] = 100
        msg = {
            "message_id": 11, "text": "ще матеріал",
            "reply_to_message": {"text": "AI-042"}, "date": 150,
        }
        with mock.patch.object(bot, "new_draft", wraps=bot.new_draft) as spy_new:
            bot.on_message(msg)
        spy_new.assert_not_called()
        self.assertIs(bot.STATE["draft"], existing)
        self.assertEqual(existing["last_msg_time"], 150)
        self.assertFalse(existing["nudged"])

    def test_card_reply_different_card_than_active_append_creates_new_draft(self):
        existing = bot.new_draft()
        existing["mode"] = "append"
        existing["target_card"] = "AI-001"
        msg = {"message_id": 12, "text": "матеріал", "reply_to_message": {"text": "AI-002"}}
        with mock.patch.object(bot, "new_draft", wraps=bot.new_draft) as spy_new:
            bot.on_message(msg)
        spy_new.assert_called_once()
        self.assertEqual(bot.STATE["draft"]["target_card"], "AI-002")

    def test_window_expired_creates_new_draft(self):
        # msg_time=1, не 0: new_draft() робить "msg_time or int(time.time())",
        # і 0 — falsy, тож підмінився б реальним часом.
        old = bot.new_draft(msg_time=1)
        msg = {"message_id": 13, "text": "звичайний текст без посилання але довгий",
               "date": 1 + bot.DRAFT_WINDOW_S + 1}
        with mock.patch.object(bot, "new_draft", wraps=bot.new_draft) as spy_new:
            bot.on_message(msg)
        spy_new.assert_called_once()
        self.assertIsNot(bot.STATE["draft"], old)

    def test_within_window_reuses_draft(self):
        existing = bot.new_draft(msg_time=100)
        msg = {"message_id": 14, "text": "звичайний текст без посилання але довгий",
               "date": 100 + bot.DRAFT_WINDOW_S}
        with mock.patch.object(bot, "new_draft", wraps=bot.new_draft) as spy_new:
            bot.on_message(msg)
        spy_new.assert_not_called()
        self.assertIs(bot.STATE["draft"], existing)

    def test_photo_message_calls_handle_photo_with_last_size(self):
        bot.STATE["draft"] = make_draft()
        msg = {"message_id": 15, "photo": [{"file_id": "small"}, {"file_id": "big"}], "text": ""}
        bot.on_message(msg)
        self.mocks["handle_photo"].assert_called_once_with(bot.STATE["draft"], "big", "")
        self.mocks["handle_text"].assert_not_called()

    def test_image_document_calls_handle_photo(self):
        bot.STATE["draft"] = make_draft()
        msg = {"message_id": 16, "document": {"file_id": "doc1", "mime_type": "image/png"},
               "caption": "капшн"}
        bot.on_message(msg)
        self.mocks["handle_photo"].assert_called_once_with(bot.STATE["draft"], "doc1", "капшн")

    def test_non_image_document_with_no_text_neither_handler_called(self):
        # Факт: непідтримуваний тип документа (не картинка) без тексту не
        # потрапляє ні в handle_photo, ні в handle_text — фрагмент не
        # додається, хоча is_substantive(msg) визнав повідомлення змістовним
        # (є document).
        bot.STATE["draft"] = make_draft()
        msg = {"message_id": 17, "document": {"file_id": "doc1", "mime_type": "application/pdf"}}
        bot.on_message(msg)
        self.mocks["handle_photo"].assert_not_called()
        self.mocks["handle_text"].assert_not_called()
        self.mocks["render"].assert_called_once()

    def test_text_message_calls_handle_text(self):
        bot.STATE["draft"] = make_draft()
        msg = {"message_id": 18, "text": "http://x.test якийсь текст"}
        bot.on_message(msg)
        self.mocks["handle_text"].assert_called_once_with(bot.STATE["draft"], "http://x.test якийсь текст")

    def test_reaction_sequence_seen_then_taken(self):
        bot.STATE["draft"] = make_draft()
        msg = {"message_id": 19, "text": "звичайний текст без посилання але довгий"}
        bot.on_message(msg)
        calls = [c.args for c in self.mocks["react"].call_args_list]
        self.assertEqual(calls, [(19, "👀"), (19, "✍️")])

    def test_render_called_with_current_draft(self):
        bot.STATE["draft"] = make_draft()
        msg = {"message_id": 20, "text": "звичайний текст без посилання але довгий"}
        bot.on_message(msg)
        self.mocks["render"].assert_called_once_with(bot.STATE["draft"])


# ---------------------------------------------------------------------------
# on_callback
# ---------------------------------------------------------------------------

class OnCallbackTest(BotStateTestCase):
    def setUp(self):
        super().setUp()
        self._patches = {
            "ack": mock.patch.object(bot, "ack"),
            "edit": mock.patch.object(bot, "edit"),
            "render": mock.patch.object(bot, "render"),
            "run_triage": mock.patch.object(bot, "run_triage"),
            "drop_draft": mock.patch.object(bot, "drop_draft", wraps=bot.drop_draft),
        }
        self.mocks = {name: p.start() for name, p in self._patches.items()}
        for p in self._patches.values():
            self.addCleanup(p.stop)

    def test_no_draft_acks_and_returns(self):
        bot.on_callback({"id": "cb1", "data": "eval"})
        self.mocks["ack"].assert_called_once_with("cb1", "Чернетки вже немає")
        self.mocks["render"].assert_not_called()
        self.mocks["run_triage"].assert_not_called()

    def test_track_switch_updates_and_renders(self):
        bot.STATE["draft"] = make_draft(track="app-ideas")
        bot.on_callback({"id": "cb2", "data": "track:passive-income"})
        d = bot.STATE["draft"]
        self.assertEqual(d["track"], "passive-income")
        self.mocks["ack"].assert_called_once_with("cb2", bot.TRACKS["passive-income"])
        self.mocks["render"].assert_called_once_with(d)

    def test_drop_with_panel_edits_then_drops(self):
        bot.STATE["draft"] = make_draft(panel_msg_id=42)
        bot.on_callback({"id": "cb3", "data": "drop"})
        self.mocks["ack"].assert_called_once_with("cb3", "Викинув")
        self.mocks["edit"].assert_called_once_with(42, "Чернетку викинуто.")
        self.mocks["drop_draft"].assert_called_once()
        self.assertIsNone(bot.STATE["draft"])

    def test_drop_without_panel_skips_edit(self):
        bot.STATE["draft"] = make_draft(panel_msg_id=None)
        bot.on_callback({"id": "cb4", "data": "drop"})
        self.mocks["edit"].assert_not_called()
        self.mocks["drop_draft"].assert_called_once()

    def test_eval_while_running_acks_busy_no_run(self):
        bot.STATE["draft"] = make_draft(state="running")
        bot.on_callback({"id": "cb5", "data": "eval"})
        self.mocks["ack"].assert_called_once_with("cb5", "Уже працюю")
        self.mocks["run_triage"].assert_not_called()

    def test_eval_starts_run_triage_with_independent_copy(self):
        bot.STATE["draft"] = make_draft(state="open", mode="new")
        bot.on_callback({"id": "cb6", "data": "eval"})
        d = bot.STATE["draft"]
        self.assertEqual(d["state"], "running")
        self.assertEqual(d["mode_flag"], "new")
        self.mocks["ack"].assert_called_once_with("cb6", "Поїхали")
        self.mocks["render"].assert_called_once_with(d)
        self.mocks["run_triage"].assert_called_once()
        passed = self.mocks["run_triage"].call_args.args[0]
        self.assertEqual(passed, d)
        self.assertIsNot(passed, d)

    def test_append_only_sets_mode_flag_regardless_of_mode(self):
        bot.STATE["draft"] = make_draft(state="open", mode="append", target_card="AI-1")
        bot.on_callback({"id": "cb7", "data": "append_only"})
        self.assertEqual(bot.STATE["draft"]["mode_flag"], "append_only")

    def test_unknown_data_just_acks(self):
        bot.STATE["draft"] = make_draft()
        bot.on_callback({"id": "cb8", "data": "whatever"})
        self.mocks["ack"].assert_called_once_with("cb8")
        self.mocks["render"].assert_not_called()
        self.mocks["run_triage"].assert_not_called()

    def test_missing_data_key_treated_as_unknown(self):
        bot.STATE["draft"] = make_draft()
        bot.on_callback({"id": "cb9"})
        self.mocks["ack"].assert_called_once_with("cb9")


# ---------------------------------------------------------------------------
# on_command
# ---------------------------------------------------------------------------

class OnCommandTest(BotStateTestCase):
    def setUp(self):
        super().setUp()
        self._patches = {
            "send": mock.patch.object(bot, "send"),
            "edit": mock.patch.object(bot, "edit"),
            "react": mock.patch.object(bot, "react"),
            "drop_draft": mock.patch.object(bot, "drop_draft", wraps=bot.drop_draft),
            "cmd_status": mock.patch.object(bot, "cmd_status", return_value="STATUS-TEXT"),
            "cmd_last": mock.patch.object(bot, "cmd_last", return_value="LAST-TEXT"),
        }
        self.mocks = {name: p.start() for name, p in self._patches.items()}
        for p in self._patches.values():
            self.addCleanup(p.stop)

    def test_help_sends_help_text(self):
        bot.on_command("help", 1)
        self.mocks["send"].assert_called_once_with(bot.HELP)

    def test_start_alias_sends_help_text(self):
        bot.on_command("start", 1)
        self.mocks["send"].assert_called_once_with(bot.HELP)

    def test_status_sends_cmd_status_result(self):
        bot.on_command("status", 1)
        self.mocks["send"].assert_called_once_with("STATUS-TEXT")

    def test_last_sends_cmd_last_result(self):
        bot.on_command("last", 1)
        self.mocks["send"].assert_called_once_with("LAST-TEXT")

    def test_cancel_while_running_does_not_drop(self):
        bot.STATE["draft"] = make_draft(state="running")
        bot.on_command("cancel", 1)
        self.mocks["send"].assert_called_once_with("Оцінка вже йде — скасувати не можу.")
        self.mocks["drop_draft"].assert_not_called()

    def test_cancel_open_draft_with_panel(self):
        bot.STATE["draft"] = make_draft(panel_msg_id=7)
        bot.on_command("cancel", 1)
        self.mocks["edit"].assert_called_once_with(7, "Чернетку викинуто.")
        self.mocks["drop_draft"].assert_called_once()
        self.mocks["send"].assert_called_once_with("Викинув.")
        self.assertIsNone(bot.STATE["draft"])

    def test_cancel_open_draft_without_panel(self):
        bot.STATE["draft"] = make_draft(panel_msg_id=None)
        bot.on_command("cancel", 1)
        self.mocks["edit"].assert_not_called()
        self.mocks["drop_draft"].assert_called_once()

    def test_cancel_no_draft(self):
        bot.on_command("cancel", 1)
        self.mocks["send"].assert_called_once_with("Чернетки й так немає.")
        self.mocks["drop_draft"].assert_not_called()

    def test_new_while_running(self):
        bot.STATE["draft"] = make_draft(state="running")
        bot.on_command("new", 1)
        self.mocks["send"].assert_called_once_with("Зачекай, іде оцінка.")
        self.mocks["drop_draft"].assert_not_called()

    def test_new_with_panel_edits_before_dropping(self):
        bot.STATE["draft"] = make_draft(panel_msg_id=8)
        bot.on_command("new", 1)
        self.mocks["edit"].assert_called_once()
        args = self.mocks["edit"].call_args.args
        self.assertEqual(args[0], 8)
        self.assertIn("(чернетку закрито без оцінки)", args[1])
        self.mocks["drop_draft"].assert_called_once()
        self.mocks["send"].assert_called_once_with("Готово — наступне повідомлення почне нову чернетку.")

    def test_new_without_panel_skips_edit(self):
        bot.STATE["draft"] = make_draft(panel_msg_id=None)
        bot.on_command("new", 1)
        self.mocks["edit"].assert_not_called()
        self.mocks["drop_draft"].assert_called_once()

    def test_new_no_draft_still_calls_drop_draft(self):
        # Факт: у else-гілці "new" drop_draft() викликається завжди, навіть
        # якщо чернетки не було (d is None) — без перевірки "if d".
        bot.on_command("new", 1)
        self.mocks["drop_draft"].assert_called_once()
        self.mocks["send"].assert_called_once_with("Готово — наступне повідомлення почне нову чернетку.")

    def test_unknown_command_reacts_confused(self):
        bot.on_command("frobnicate", 42)
        self.mocks["react"].assert_called_once_with(42, "🤔")
        self.mocks["send"].assert_not_called()


# ---------------------------------------------------------------------------
# process_update — доповнення до ProcessUpdateTest у telegram_bot_test.py
# ---------------------------------------------------------------------------

class ProcessUpdateCallbackNoMessageTest(unittest.TestCase):
    def test_callback_without_message_key_ignored(self):
        upd = {"update_id": 1, "callback_query": {"data": "eval", "id": "cb1"}}
        with mock.patch.object(bot, "on_callback") as mock_cb:
            bot.process_update(upd)
        mock_cb.assert_not_called()


# ---------------------------------------------------------------------------
# cmd_status / cmd_last / read_run_status / read_verdict
# ---------------------------------------------------------------------------

class CmdStatusTest(BotStateTestCase):
    def test_no_draft_only_doctor_report(self):
        with mock.patch.object(bot, "run_doctor", return_value="ЗВІТ"):
            result = bot.cmd_status()
        self.assertEqual(result, "ЗВІТ")

    def test_running_draft_prefixed(self):
        bot.STATE["draft"] = make_draft(id="20260101-000000", state="running")
        with mock.patch.object(bot, "run_doctor", return_value="ЗВІТ"):
            result = bot.cmd_status()
        self.assertIn("Іде оцінка чернетки 20260101-000000.", result)
        self.assertTrue(result.endswith("ЗВІТ"))

    def test_open_draft_shows_fragment_count_and_track(self):
        bot.STATE["draft"] = make_draft(
            state="open", track="passive-income",
            fragments=[{"kind": "text", "value": "a"}, {"kind": "text", "value": "b"}],
            last_msg_time=1000,
        )
        with mock.patch.object(bot, "run_doctor", return_value="ЗВІТ"), \
             mock.patch.object(bot.time, "time", return_value=1000 + 60):
            result = bot.cmd_status()
        self.assertIn("2 фрагмент(ів)", result)
        self.assertIn(bot.TRACKS["passive-income"], result)
        left = (bot.DRAFT_WINDOW_S - 60) // 60
        self.assertIn(f"~{left} хв", result)


class CmdLastTest(unittest.TestCase):
    def test_no_ideas(self):
        with mock.patch.object(bot.db, "get_recent_ideas", return_value=[]):
            self.assertEqual(bot.cmd_last(), "Карток ще немає.")

    def test_formats_rows(self):
        rows = [{"id": "AI-1", "title": "Ідея", "status": "new"}]
        with mock.patch.object(bot.db, "get_recent_ideas", return_value=rows):
            result = bot.cmd_last()
        self.assertEqual(result, "• <b>AI-1</b> Ідея — new")

    def test_title_escaped(self):
        rows = [{"id": "AI-1", "title": "<b>x</b>", "status": "new"}]
        with mock.patch.object(bot.db, "get_recent_ideas", return_value=rows):
            result = bot.cmd_last()
        self.assertIn("&lt;b&gt;x&lt;/b&gt;", result)

    def test_dberror_reported(self):
        with mock.patch.object(bot.db, "get_recent_ideas", side_effect=bot.db.DbError("недоступно")):
            result = bot.cmd_last()
        self.assertIn("Не вдалось прочитати ideas з БД: недоступно", result)


class ReadRunStatusTest(unittest.TestCase):
    def test_no_run_found(self):
        with mock.patch.object(bot.db, "get_last_run", return_value=None):
            self.assertEqual(bot.read_run_status("app-ideas"), ("", ""))

    def test_status_and_first_error(self):
        row = {"status": "error", "errors": ["бум", "друге"]}
        with mock.patch.object(bot.db, "get_last_run", return_value=row):
            status, err = bot.read_run_status("app-ideas")
        self.assertEqual(status, "error")
        self.assertEqual(err, "бум")

    def test_no_errors_key_empty_tail(self):
        row = {"status": "ok"}
        with mock.patch.object(bot.db, "get_last_run", return_value=row):
            status, err = bot.read_run_status("app-ideas")
        self.assertEqual(status, "ok")
        self.assertEqual(err, "")

    def test_dberror_returns_empty_tuple(self):
        with mock.patch.object(bot.db, "get_last_run", side_effect=bot.db.DbError("х")):
            self.assertEqual(bot.read_run_status("app-ideas"), ("", ""))

    def test_error_tail_stripped(self):
        row = {"status": "error", "errors": ["  пробіли  "]}
        with mock.patch.object(bot.db, "get_last_run", return_value=row):
            _status, err = bot.read_run_status("app-ideas")
        self.assertEqual(err, "пробіли")


class ReadVerdictTest(unittest.TestCase):
    def test_no_row_returns_none(self):
        with mock.patch.object(bot.db, "get_inbox", return_value=None):
            self.assertIsNone(bot.read_verdict("d1"))

    def test_row_without_verdict_returns_none(self):
        with mock.patch.object(bot.db, "get_inbox", return_value={"triage_verdict": ""}):
            self.assertIsNone(bot.read_verdict("d1"))

    def test_full_row_parsed(self):
        row = {"idea_id": "AI-042", "triage_status": "accepted", "triage_score": 8,
               "triage_verdict": "  добра ідея  "}
        with mock.patch.object(bot.db, "get_inbox", return_value=row):
            v = bot.read_verdict("d1")
        self.assertEqual(v, {"card_id": "AI-042", "status": "accepted", "score": "8",
                              "body": "добра ідея"})

    def test_missing_idea_id_defaults_dash(self):
        row = {"triage_verdict": "текст"}
        with mock.patch.object(bot.db, "get_inbox", return_value=row):
            v = bot.read_verdict("d1")
        self.assertEqual(v["card_id"], "—")

    def test_missing_score_is_empty_string(self):
        row = {"triage_verdict": "текст"}
        with mock.patch.object(bot.db, "get_inbox", return_value=row):
            v = bot.read_verdict("d1")
        self.assertEqual(v["score"], "")

    def test_score_zero_not_treated_as_missing(self):
        # Факт: перевірка "is not None", тож score=0 коректно рендериться
        # "0", а не пропускається як «немає оцінки».
        row = {"triage_verdict": "текст", "triage_score": 0}
        with mock.patch.object(bot.db, "get_inbox", return_value=row):
            v = bot.read_verdict("d1")
        self.assertEqual(v["score"], "0")

    def test_dberror_returns_none(self):
        with mock.patch.object(bot.db, "get_inbox", side_effect=bot.db.DbError("х")):
            self.assertIsNone(bot.read_verdict("d1"))


# ---------------------------------------------------------------------------
# nudge_if_idle / recover_interrupted_triage
# ---------------------------------------------------------------------------

class NudgeIfIdleTest(BotStateTestCase):
    def test_no_draft_noop(self):
        with mock.patch.object(bot, "edit") as mock_edit:
            bot.nudge_if_idle()
        mock_edit.assert_not_called()

    def test_not_open_state_noop(self):
        bot.STATE["draft"] = make_draft(state="running", panel_msg_id=1)
        with mock.patch.object(bot, "edit") as mock_edit:
            bot.nudge_if_idle()
        mock_edit.assert_not_called()

    def test_already_nudged_noop(self):
        bot.STATE["draft"] = make_draft(state="open", nudged=True, panel_msg_id=1, last_msg_time=0)
        with mock.patch.object(bot, "edit") as mock_edit, \
             mock.patch.object(bot.time, "time", return_value=bot.NUDGE_AFTER_S + 100):
            bot.nudge_if_idle()
        mock_edit.assert_not_called()

    def test_no_panel_yet_noop(self):
        bot.STATE["draft"] = make_draft(state="open", panel_msg_id=None, last_msg_time=0)
        with mock.patch.object(bot, "edit") as mock_edit, \
             mock.patch.object(bot.time, "time", return_value=bot.NUDGE_AFTER_S + 100):
            bot.nudge_if_idle()
        mock_edit.assert_not_called()

    def test_still_within_window_noop(self):
        bot.STATE["draft"] = make_draft(state="open", panel_msg_id=1, last_msg_time=1000)
        with mock.patch.object(bot, "edit") as mock_edit, \
             mock.patch.object(bot.time, "time", return_value=1000 + bot.NUDGE_AFTER_S - 1):
            bot.nudge_if_idle()
        mock_edit.assert_not_called()

    def test_idle_beyond_window_nudges(self):
        d = make_draft(state="open", panel_msg_id=5, last_msg_time=1000, nudged=False)
        bot.STATE["draft"] = d
        with mock.patch.object(bot, "edit") as mock_edit, \
             mock.patch.object(bot.time, "time", return_value=1000 + bot.NUDGE_AFTER_S):
            bot.nudge_if_idle()
        mock_edit.assert_called_once()
        args = mock_edit.call_args.args
        self.assertEqual(args[0], 5)
        self.assertIn("Оцінювати?", args[1])
        self.assertEqual(args[2], bot.panel_buttons(d))
        self.assertTrue(d["nudged"])


class RecoverInterruptedTriageTest(BotStateTestCase):
    def test_no_draft_noop(self):
        with mock.patch.object(bot, "edit") as mock_edit:
            bot.recover_interrupted_triage()
        mock_edit.assert_not_called()

    def test_not_running_noop(self):
        bot.STATE["draft"] = make_draft(state="open")
        with mock.patch.object(bot, "edit") as mock_edit:
            bot.recover_interrupted_triage()
        mock_edit.assert_not_called()

    def test_running_with_panel_resets_state_and_warns(self):
        d = make_draft(state="running", panel_msg_id=9)
        bot.STATE["draft"] = d
        with mock.patch.object(bot, "edit") as mock_edit:
            bot.recover_interrupted_triage()
        self.assertEqual(d["state"], "open")
        mock_edit.assert_called_once()
        args = mock_edit.call_args.args
        self.assertEqual(args[0], 9)
        self.assertIn("Попередня оцінка урвалась", args[1])

    def test_running_without_panel_still_resets_state(self):
        d = make_draft(state="running", panel_msg_id=None)
        bot.STATE["draft"] = d
        with mock.patch.object(bot, "edit") as mock_edit:
            bot.recover_interrupted_triage()
        self.assertEqual(d["state"], "open")
        mock_edit.assert_not_called()

    def test_state_persisted_to_disk(self):
        d = make_draft(state="running", panel_msg_id=None)
        bot.STATE["draft"] = d
        with mock.patch.object(bot, "edit"):
            bot.recover_interrupted_triage()
        with open(self._state_file, encoding="utf-8") as f:
            saved = json.load(f)
        self.assertEqual(saved["draft"]["state"], "open")


# ---------------------------------------------------------------------------
# load_state / save_state / new_draft / drop_draft
# ---------------------------------------------------------------------------

class LoadStateSaveStateTest(BotStateTestCase):
    def test_missing_file_returns_default(self):
        self.assertFalse(os.path.exists(self._state_file))
        self.assertEqual(bot.load_state(), {"draft": None})

    def test_round_trip(self):
        bot.save_state({"draft": {"id": "x"}})
        self.assertEqual(bot.load_state(), {"draft": {"id": "x"}})

    def test_invalid_json_returns_default(self):
        os.makedirs(self._state_dir, exist_ok=True)
        with open(self._state_file, "w", encoding="utf-8") as f:
            f.write("{не json")
        self.assertEqual(bot.load_state(), {"draft": None})

    def test_save_state_creates_state_dir(self):
        self.assertFalse(os.path.isdir(self._state_dir))
        bot.save_state({"draft": None})
        self.assertTrue(os.path.isdir(self._state_dir))

    def test_save_state_no_leftover_tmp_file(self):
        bot.save_state({"draft": None})
        self.assertFalse(os.path.exists(self._state_file + ".tmp"))

    def test_save_state_unicode_not_escaped(self):
        bot.save_state({"draft": None, "note": "чернетка"})
        with open(self._state_file, encoding="utf-8") as f:
            raw = f.read()
        self.assertIn("чернетка", raw)


class NewDraftDropDraftTest(BotStateTestCase):
    def test_new_draft_default_fields(self):
        d = bot.new_draft()
        self.assertEqual(d["track"], bot.DEFAULT_TRACK)
        self.assertEqual(d["state"], "open")
        self.assertEqual(d["fragments"], [])
        self.assertIsNone(d["panel_msg_id"])
        self.assertIsNone(d["first_msg_id"])
        self.assertFalse(d["nudged"])
        self.assertIsNone(d["target_card"])
        self.assertEqual(d["mode"], "new")
        self.assertIs(bot.STATE["draft"], d)

    def test_new_draft_id_format(self):
        d = bot.new_draft()
        self.assertRegex(d["id"], r"^\d{8}-\d{6}$")

    def test_new_draft_custom_track_and_ids(self):
        d = bot.new_draft(track="passive-income", first_msg_id=7, msg_time=12345)
        self.assertEqual(d["track"], "passive-income")
        self.assertEqual(d["first_msg_id"], 7)
        self.assertEqual(d["last_msg_time"], 12345)

    def test_new_draft_msg_time_defaults_to_now(self):
        with mock.patch.object(bot.time, "time", return_value=999.0):
            d = bot.new_draft()
        self.assertEqual(d["last_msg_time"], 999)

    def test_new_draft_recreates_draft_dir_empty(self):
        os.makedirs(self._draft_dir, exist_ok=True)
        with open(os.path.join(self._draft_dir, "stale.txt"), "w") as f:
            f.write("x")
        bot.new_draft()
        self.assertTrue(os.path.isdir(self._draft_dir))
        self.assertEqual(os.listdir(self._draft_dir), [])

    def test_drop_draft_clears_state_and_dir(self):
        bot.new_draft()
        os.makedirs(self._draft_dir, exist_ok=True)
        bot.drop_draft()
        self.assertIsNone(bot.STATE["draft"])
        self.assertFalse(os.path.isdir(self._draft_dir))

    def test_drop_draft_persists_state_file(self):
        bot.new_draft()
        bot.drop_draft()
        with open(self._state_file, encoding="utf-8") as f:
            saved = json.load(f)
        self.assertIsNone(saved["draft"])

    def test_drop_draft_safe_when_no_draft(self):
        bot.STATE = {"draft": None}
        bot.drop_draft()  # не мусить кинути
        self.assertIsNone(bot.STATE["draft"])


# ---------------------------------------------------------------------------
# write_inbox
# ---------------------------------------------------------------------------

class WriteInboxTest(BotStateTestCase):
    def setUp(self):
        super().setUp()
        # write_inbox() робить os.listdir(DRAFT_DIR) безумовно, навіть коли
        # чернетка без вкладень — теці має існувати.
        os.makedirs(self._draft_dir, exist_ok=True)

    def test_payload_and_return_path(self):
        d = make_draft(id="20260101-000000", track="app-ideas", mode="new",
                        fragments=[{"kind": "text", "value": "коментар власника"}])
        with mock.patch.object(bot.db, "insert_inbox", return_value={}) as mock_insert:
            rel = bot.write_inbox(d)
        self.assertEqual(rel, os.path.join("inbox", "20260101-000000-app-ideas"))
        mock_insert.assert_called_once()
        kwargs = mock_insert.call_args.kwargs
        self.assertEqual(kwargs["draft_id"], "20260101-000000")
        self.assertEqual(kwargs["track"], "app-ideas")
        self.assertEqual(kwargs["source"], "telegram")
        self.assertEqual(kwargs["mode"], "new")
        self.assertIsNone(kwargs["target_card_id"])
        self.assertIn("коментар власника", kwargs["raw_text"])
        self.assertRegex(kwargs["submitted_at"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

    def test_mode_flag_overrides_mode(self):
        d = make_draft(mode="append", fragments=[])
        d["mode_flag"] = "append_only"
        with mock.patch.object(bot.db, "insert_inbox", return_value={}) as mock_insert:
            bot.write_inbox(d)
        self.assertEqual(mock_insert.call_args.kwargs["mode"], "append_only")

    def test_target_card_passed_when_present(self):
        d = make_draft(target_card="AI-042", fragments=[])
        with mock.patch.object(bot.db, "insert_inbox", return_value={}) as mock_insert:
            bot.write_inbox(d)
        self.assertEqual(mock_insert.call_args.kwargs["target_card_id"], "AI-042")

    def test_empty_target_card_becomes_none(self):
        d = make_draft(target_card="", fragments=[])
        with mock.patch.object(bot.db, "insert_inbox", return_value={}) as mock_insert:
            bot.write_inbox(d)
        self.assertIsNone(mock_insert.call_args.kwargs["target_card_id"])

    def test_copies_draft_files_into_inbox_box(self):
        os.makedirs(self._draft_dir, exist_ok=True)
        with open(os.path.join(self._draft_dir, "photo-1.jpg"), "wb") as f:
            f.write(b"jpegdata")
        d = make_draft(id="d1", track="app-ideas",
                        fragments=[{"kind": "photo", "value": "photo-1.jpg"}])
        with mock.patch.object(bot.db, "insert_inbox", return_value={}):
            bot.write_inbox(d)
        box = os.path.join(self._repo_root, "inbox", "d1-app-ideas")
        dest = os.path.join(box, "photo-1.jpg")
        self.assertTrue(os.path.isfile(dest))
        with open(dest, "rb") as f:
            self.assertEqual(f.read(), b"jpegdata")

    def test_raw_text_includes_url_photo_and_text_sections(self):
        os.makedirs(self._draft_dir, exist_ok=True)
        with open(os.path.join(self._draft_dir, "source-1.txt"), "w") as f:
            f.write("текст статті")
        d = make_draft(id="d1", track="app-ideas", fragments=[
            {"kind": "url", "value": "http://x.test", "fetch": "ok", "detail": "прочитав",
             "title": "Заголовок"},
            {"kind": "photo", "value": "photo-1.jpg"},
            {"kind": "text", "value": "коментар"},
        ])
        with mock.patch.object(bot.db, "insert_inbox", return_value={}) as mock_insert:
            bot.write_inbox(d)
        raw = mock_insert.call_args.kwargs["raw_text"]
        self.assertIn("## Посилання\nhttp://x.test", raw)
        self.assertIn("Заголовок: Заголовок", raw)
        self.assertIn("## Зображення\n`photo-1.jpg`", raw)
        self.assertIn("## Коментар власника\nкоментар", raw)
        self.assertIn("## Збережений текст сторінок\n`source-1.txt`", raw)

    def test_url_fragment_without_title_omits_heading_line(self):
        d = make_draft(id="d1", track="app-ideas", fragments=[
            {"kind": "url", "value": "http://x.test", "fetch": "ok", "detail": "ok", "title": ""},
        ])
        with mock.patch.object(bot.db, "insert_inbox", return_value={}) as mock_insert:
            bot.write_inbox(d)
        raw = mock_insert.call_args.kwargs["raw_text"]
        self.assertNotIn("Заголовок:", raw)

    def test_dberror_from_insert_propagates(self):
        d = make_draft(fragments=[])
        with mock.patch.object(bot.db, "insert_inbox", side_effect=bot.db.DbError("недоступно")), \
             self.assertRaises(bot.db.DbError):
            bot.write_inbox(d)


# ---------------------------------------------------------------------------
# run_triage
# ---------------------------------------------------------------------------

class RunTriageTest(BotStateTestCase):
    def setUp(self):
        super().setUp()
        self._patches = {
            "edit": mock.patch.object(bot, "edit"),
            "react": mock.patch.object(bot, "react"),
            "write_inbox": mock.patch.object(bot, "write_inbox", return_value="inbox/x"),
            # progress_watcher — окремий фоновий потік, що теж кличе edit()
            # (див. ProgressWatcherTest нижче); тут його вимикаємо, щоб
            # рахунок викликів edit() у run_triage лишався детермінованим.
            "progress_watcher": mock.patch.object(bot, "progress_watcher"),
        }
        self.mocks = {name: p.start() for name, p in self._patches.items()}
        for p in self._patches.values():
            self.addCleanup(p.stop)

    @staticmethod
    def _completed(rc=0):
        return subprocess.CompletedProcess(args=["runner.sh"], returncode=rc, stdout="", stderr="")

    def test_success_edits_verdict_and_drops_draft(self):
        d = make_draft(id="d1", track="app-ideas", panel_msg_id=1, first_msg_id=9, state="running")
        bot.STATE["draft"] = d
        verdict = {"card_id": "AI-1", "status": "accepted", "score": "8", "body": "гарна ідея"}
        with mock.patch.object(bot.subprocess, "run", return_value=self._completed(0)), \
             mock.patch.object(bot, "read_verdict", return_value=verdict):
            bot.run_triage(dict(d))
        self.mocks["edit"].assert_called_once()
        text = self.mocks["edit"].call_args.args[1]
        self.assertIn("AI-1", text)
        self.assertIn("8/10", text)
        self.assertIn("гарна ідея", text)
        self.mocks["react"].assert_called_once_with(9, "👍")
        self.assertIsNone(bot.STATE["draft"])

    def test_success_without_first_msg_id_skips_reaction(self):
        d = make_draft(id="d1", track="app-ideas", panel_msg_id=1, first_msg_id=None, state="running")
        bot.STATE["draft"] = d
        verdict = {"card_id": "AI-1", "status": "accepted", "score": "8", "body": "ідея"}
        with mock.patch.object(bot.subprocess, "run", return_value=self._completed(0)), \
             mock.patch.object(bot, "read_verdict", return_value=verdict):
            bot.run_triage(dict(d))
        self.mocks["react"].assert_not_called()

    def test_rejected_status_reacts_thumbs_down(self):
        d = make_draft(id="d1", track="app-ideas", panel_msg_id=1, first_msg_id=9, state="running")
        bot.STATE["draft"] = d
        verdict = {"card_id": "AI-1", "status": "rejected_low_score", "score": "2", "body": "слабко"}
        with mock.patch.object(bot.subprocess, "run", return_value=self._completed(0)), \
             mock.patch.object(bot, "read_verdict", return_value=verdict):
            bot.run_triage(dict(d))
        self.mocks["react"].assert_called_once_with(9, "👎")

    def test_verdict_without_score_or_status_omits_them_from_head(self):
        d = make_draft(id="d1", track="app-ideas", panel_msg_id=1, first_msg_id=None, state="running")
        bot.STATE["draft"] = d
        verdict = {"card_id": "AI-1", "status": "", "score": "", "body": "ідея"}
        with mock.patch.object(bot.subprocess, "run", return_value=self._completed(0)), \
             mock.patch.object(bot, "read_verdict", return_value=verdict):
            bot.run_triage(dict(d))
        text = self.mocks["edit"].call_args.args[1]
        self.assertNotIn("/10", text)
        self.assertIn("<b>AI-1</b>\nідея", text)

    def test_oserror_from_subprocess_treated_as_failed_run(self):
        d = make_draft(id="d1", track="app-ideas", panel_msg_id=1, state="running")
        bot.STATE["draft"] = d
        with mock.patch.object(bot.subprocess, "run", side_effect=OSError("немає такого файлу")), \
             mock.patch.object(bot, "read_verdict", return_value=None), \
             mock.patch.object(bot, "read_run_status", return_value=("", "")):
            bot.run_triage(dict(d))
        text = self.mocks["edit"].call_args.args[1]
        self.assertIn("runner.sh не дійшов навіть до запису статусу", text)

    def test_no_verdict_known_status_hint_shown_and_state_reopened(self):
        d = make_draft(id="d1", track="app-ideas", panel_msg_id=1, state="running")
        bot.STATE["draft"] = d
        with mock.patch.object(bot.subprocess, "run", return_value=self._completed(1)), \
             mock.patch.object(bot, "read_verdict", return_value=None), \
             mock.patch.object(bot, "read_run_status", return_value=("skipped", "")):
            bot.run_triage(dict(d))
        text = self.mocks["edit"].call_args.args[1]
        self.assertIn("Прогін пропущено — лок зайнятий іншим прогоном.", text)
        self.assertEqual(d["state"], "open")
        self.assertTrue(d["nudged"])

    def test_no_verdict_unknown_status_falls_back_to_generic_hint(self):
        d = make_draft(id="d1", track="app-ideas", panel_msg_id=1, state="running")
        bot.STATE["draft"] = d
        with mock.patch.object(bot.subprocess, "run", return_value=self._completed(3)), \
             mock.patch.object(bot, "read_verdict", return_value=None), \
             mock.patch.object(bot, "read_run_status", return_value=("weird_status", "")):
            bot.run_triage(dict(d))
        text = self.mocks["edit"].call_args.args[1]
        self.assertIn("runner.sh: weird_status", text)

    def test_generic_hint_source_has_no_dead_rc_fallback(self):
        # "" завжди перехоплений RUN_FAILURE_HINTS[""] раніше, тож у момент
        # побудови generic-підказки status непорожній і "status or f'код {rc}'"
        # — мертвий код, який ніколи не спрацьовує. Перевіряємо, що його
        # прибрано з джерела, а не лише що поточний тест-кейс його не зачіпає.
        source = inspect.getsource(bot.run_triage)
        self.assertNotIn("код {rc}", source)

    def test_no_verdict_status_ok_reports_agent_silent(self):
        d = make_draft(id="d1", track="app-ideas", panel_msg_id=1, state="running")
        bot.STATE["draft"] = d
        with mock.patch.object(bot.subprocess, "run", return_value=self._completed(0)), \
             mock.patch.object(bot, "read_verdict", return_value=None), \
             mock.patch.object(bot, "read_run_status", return_value=("ok", "")):
            bot.run_triage(dict(d))
        text = self.mocks["edit"].call_args.args[1]
        self.assertIn("Прогін відпрацював, але агент не записав вердикт", text)

    def test_error_tail_appended_when_present(self):
        d = make_draft(id="d1", track="app-ideas", panel_msg_id=1, state="running")
        bot.STATE["draft"] = d
        with mock.patch.object(bot.subprocess, "run", return_value=self._completed(1)), \
             mock.patch.object(bot, "read_verdict", return_value=None), \
             mock.patch.object(bot, "read_run_status", return_value=("error", "Traceback: бум")):
            bot.run_triage(dict(d))
        text = self.mocks["edit"].call_args.args[1]
        self.assertIn("<code>Traceback: бум</code>", text)

    def test_timeout_treated_as_failed_run(self):
        d = make_draft(id="d1", track="app-ideas", panel_msg_id=1, state="running")
        bot.STATE["draft"] = d
        with mock.patch.object(bot.subprocess, "run",
                                side_effect=subprocess.TimeoutExpired(cmd=["runner.sh"], timeout=1800)), \
             mock.patch.object(bot, "read_verdict", return_value=None), \
             mock.patch.object(bot, "read_run_status", return_value=("", "")):
            bot.run_triage(dict(d))
        self.mocks["edit"].assert_called_once()
        text = self.mocks["edit"].call_args.args[1]
        self.assertIn("runner.sh не дійшов навіть до запису статусу", text)

    def test_dberror_from_write_inbox_still_reaches_hint(self):
        d = make_draft(id="d1", track="app-ideas", panel_msg_id=1, state="running")
        bot.STATE["draft"] = d
        self.mocks["write_inbox"].side_effect = bot.db.DbError("недоступно")
        with mock.patch.object(bot.subprocess, "run") as mock_run, \
             mock.patch.object(bot, "read_verdict", return_value=None), \
             mock.patch.object(bot, "read_run_status", return_value=("", "")):
            bot.run_triage(dict(d))
        mock_run.assert_not_called()
        self.mocks["edit"].assert_called_once()

    def test_subprocess_command_includes_track_and_agent(self):
        d = make_draft(id="d1", track="passive-income", panel_msg_id=1, state="running")
        bot.STATE["draft"] = d
        with mock.patch.object(bot.subprocess, "run", return_value=self._completed(0)) as mock_run, \
             mock.patch.object(bot, "read_verdict", return_value=None), \
             mock.patch.object(bot, "read_run_status", return_value=("", "")):
            bot.run_triage(dict(d))
        cmd = mock_run.call_args.args[0]
        self.assertIn("--track", cmd)
        self.assertIn("passive-income", cmd)
        self.assertIn("--agent", cmd)
        self.assertIn("triage", cmd)

    def test_lock_busy_waits_then_proceeds(self):
        d = make_draft(id="d1", track="app-ideas", panel_msg_id=1, state="running")
        bot.STATE["draft"] = d
        fake_lock = mock.MagicMock()
        fake_lock.acquire.side_effect = [False, True]
        with mock.patch.object(bot, "_run_lock", fake_lock), \
             mock.patch.object(bot.subprocess, "run", return_value=self._completed(0)), \
             mock.patch.object(bot, "read_verdict", return_value=None), \
             mock.patch.object(bot, "read_run_status", return_value=("", "")):
            bot.run_triage(dict(d))
        self.assertEqual(fake_lock.acquire.call_count, 2)
        fake_lock.release.assert_called_once()
        self.assertEqual(self.mocks["edit"].call_count, 2)
        first_text = self.mocks["edit"].call_args_list[0].args[1]
        self.assertIn("зайнято іншим прогоном", first_text)

    def test_race_draft_dropped_during_run_no_further_writes(self):
        d = make_draft(id="d1", track="app-ideas", panel_msg_id=1, state="running")
        bot.STATE["draft"] = d
        verdict = {"card_id": "AI-1", "status": "accepted", "score": "8", "body": "ідея"}

        def _drop_mid_run(*_a, **_kw):
            bot.STATE["draft"] = None
            return self._completed(0)

        with mock.patch.object(bot.subprocess, "run", side_effect=_drop_mid_run), \
             mock.patch.object(bot, "read_verdict", return_value=verdict), \
             mock.patch.object(bot, "drop_draft") as mock_drop:
            bot.run_triage(dict(d))
        mock_drop.assert_not_called()


# ---------------------------------------------------------------------------
# progress_watcher — фоновий потік, який run_triage запускає окремо;
# у RunTriageTest підмінений заглушкою, тут перевіряємо його власну поведінку.
# ---------------------------------------------------------------------------

class ProgressWatcherTest(BotStateTestCase):
    @staticmethod
    def _run_once(target, args, settle=0.05):
        stop = args[1]
        t = threading.Thread(target=target, args=args)
        t.start()
        time.sleep(settle)
        stop.set()
        t.join(timeout=5)

    def test_reads_progress_file_and_shows_elapsed_minutes(self):
        d = make_draft(id="d1", panel_msg_id=3)
        os.makedirs(os.path.join(self._repo_root, "logs", "triage"), exist_ok=True)
        pfile = os.path.join(self._repo_root, "logs", "triage", "d1.progress")
        with open(pfile, "w", encoding="utf-8") as f:
            f.write("аналізую джерела\n")
        stop = threading.Event()
        started = time.time() - 125
        with mock.patch.object(bot, "edit") as mock_edit:
            self._run_once(bot.progress_watcher, (d, stop, started))
        mock_edit.assert_called()
        text = mock_edit.call_args.args[1]
        self.assertEqual(mock_edit.call_args.args[0], 3)
        self.assertIn("аналізую джерела", text)
        self.assertIn("(2 хв)", text)

    def test_missing_progress_file_uses_default_stage_text(self):
        d = make_draft(id="d1", panel_msg_id=3)
        stop = threading.Event()
        with mock.patch.object(bot, "edit") as mock_edit:
            self._run_once(bot.progress_watcher, (d, stop, time.time()))
        mock_edit.assert_called()
        self.assertIn("Оцінюю…", mock_edit.call_args.args[1])

    def test_zero_minutes_elapsed_no_minute_suffix(self):
        d = make_draft(id="d1", panel_msg_id=3)
        stop = threading.Event()
        with mock.patch.object(bot, "edit") as mock_edit:
            self._run_once(bot.progress_watcher, (d, stop, time.time()))
        self.assertNotIn("хв)", mock_edit.call_args.args[1])

    def test_stop_set_before_start_skips_body_entirely(self):
        d = make_draft(id="d1", panel_msg_id=3)
        stop = threading.Event()
        stop.set()
        with mock.patch.object(bot, "edit") as mock_edit:
            bot.progress_watcher(d, stop, time.time())
        mock_edit.assert_not_called()

    def test_unchanged_text_skips_repeated_edit(self):
        # Факт: edit() кличеться лише коли text != last — якщо між ітераціями
        # нічого не змінилось (файл прогресу той самий, ті самі хвилини),
        # другий edit() не летить.
        d = make_draft(id="d1", panel_msg_id=3)
        fake_stop = mock.MagicMock()
        fake_stop.is_set.side_effect = [False, False, True]
        fake_stop.wait.return_value = None
        with mock.patch.object(bot, "edit") as mock_edit:
            bot.progress_watcher(d, fake_stop, time.time())
        self.assertEqual(mock_edit.call_count, 1)


# ---------------------------------------------------------------------------
# api / send / edit / react / ack — межа з мережею Telegram
# ---------------------------------------------------------------------------

class ApiTest(unittest.TestCase):
    @staticmethod
    def _response(payload):
        response = mock.MagicMock()
        response.read.return_value = json.dumps(payload).encode()
        response.__enter__.return_value = response
        return response

    def test_builds_url_and_returns_parsed_json(self):
        response = self._response({"ok": True, "result": {"message_id": 5}})
        with mock.patch.object(bot.urllib.request, "urlopen", return_value=response) as urlopen:
            result = bot.api("sendMessage", chat_id=1, text="hi")
        self.assertEqual(result, {"ok": True, "result": {"message_id": 5}})
        request = urlopen.call_args[0][0]
        self.assertEqual(request.full_url, f"{bot.API}/bot{bot.TOKEN}/sendMessage")
        body = json.loads(request.data.decode())
        self.assertEqual(body, {"chat_id": 1, "text": "hi"})

    def test_http_error_logged_returns_none(self):
        err = urllib.error.HTTPError(url="x", code=400, msg="err", hdrs=None,
                                      fp=io.BytesIO(b"bad request"))
        self.addCleanup(err.close)
        with mock.patch.object(bot.urllib.request, "urlopen", side_effect=err):
            result = bot.api("sendMessage")
        self.assertIsNone(result)

    def test_url_error_returns_none(self):
        with mock.patch.object(bot.urllib.request, "urlopen",
                                side_effect=urllib.error.URLError("мережа лежить")):
            result = bot.api("sendMessage")
        self.assertIsNone(result)

    def test_oserror_returns_none(self):
        with mock.patch.object(bot.urllib.request, "urlopen", side_effect=OSError("зламано")):
            self.assertIsNone(bot.api("sendMessage"))

    def test_bad_json_returns_none(self):
        response = mock.MagicMock()
        response.read.return_value = "не json".encode()
        response.__enter__.return_value = response
        with mock.patch.object(bot.urllib.request, "urlopen", return_value=response):
            self.assertIsNone(bot.api("sendMessage"))

    def test_timeout_error_returns_none(self):
        with mock.patch.object(bot.urllib.request, "urlopen", side_effect=TimeoutError("тайм-аут")):
            self.assertIsNone(bot.api("sendMessage"))


class SendEditReactAckTest(unittest.TestCase):
    def test_send_minimal(self):
        with mock.patch.object(bot, "api", return_value={"ok": True, "result": {"message_id": 42}}) as mock_api:
            result = bot.send("привіт")
        self.assertEqual(result, 42)
        mock_api.assert_called_once_with(
            "sendMessage", chat_id=int(bot.CHAT_ID), text="привіт",
            parse_mode="HTML", disable_web_page_preview=True,
        )

    def test_send_with_buttons_and_reply_to(self):
        buttons = [[{"text": "Ок", "callback_data": "ok"}]]
        with mock.patch.object(bot, "api", return_value={"ok": True, "result": {"message_id": 7}}) as mock_api:
            bot.send("текст", buttons=buttons, reply_to=99)
        kwargs = mock_api.call_args.kwargs
        self.assertEqual(kwargs["reply_markup"], {"inline_keyboard": buttons})
        self.assertEqual(kwargs["reply_to_message_id"], 99)

    def test_send_clips_text(self):
        long_text = "a" * (bot.TG_TEXT_LIMIT + 10)
        with mock.patch.object(bot, "api", return_value={"ok": True, "result": {"message_id": 1}}) as mock_api:
            bot.send(long_text)
        self.assertEqual(mock_api.call_args.kwargs["text"], bot.clip(long_text))

    def test_send_api_failure_returns_none(self):
        with mock.patch.object(bot, "api", return_value=None):
            self.assertIsNone(bot.send("x"))

    def test_send_ok_false_returns_none(self):
        with mock.patch.object(bot, "api", return_value={"ok": False}):
            self.assertIsNone(bot.send("x"))

    def test_edit_calls_api_with_empty_buttons_default(self):
        with mock.patch.object(bot, "api") as mock_api:
            bot.edit(5, "текст")
        self.assertEqual(mock_api.call_args.args[0], "editMessageText")
        kwargs = mock_api.call_args.kwargs
        self.assertEqual(kwargs["reply_markup"], {"inline_keyboard": []})
        self.assertEqual(kwargs["message_id"], 5)

    def test_edit_passes_through_buttons(self):
        buttons = [[{"text": "Ок", "callback_data": "ok"}]]
        with mock.patch.object(bot, "api") as mock_api:
            bot.edit(5, "текст", buttons)
        self.assertEqual(mock_api.call_args.kwargs["reply_markup"], {"inline_keyboard": buttons})

    def test_react_calls_api_with_emoji_reaction(self):
        with mock.patch.object(bot, "api") as mock_api:
            bot.react(5, "👍")
        self.assertEqual(mock_api.call_args.args[0], "setMessageReaction")
        kwargs = mock_api.call_args.kwargs
        self.assertEqual(kwargs["reaction"], [{"type": "emoji", "emoji": "👍"}])

    def test_ack_default_empty_text(self):
        with mock.patch.object(bot, "api") as mock_api:
            bot.ack("cb1")
        self.assertEqual(mock_api.call_args.args[0], "answerCallbackQuery")
        self.assertEqual(mock_api.call_args.kwargs["text"], "")

    def test_ack_with_text(self):
        with mock.patch.object(bot, "api") as mock_api:
            bot.ack("cb1", "Готово")
        self.assertEqual(mock_api.call_args.kwargs["text"], "Готово")


# ---------------------------------------------------------------------------
# keychain() — власна поведінка функції (не лише креденшели, підмінені при
# завантаженні модуля на початку файлу)
# ---------------------------------------------------------------------------

class KeychainDirectTest(unittest.TestCase):
    def test_oserror_returns_empty_string(self):
        with mock.patch.object(bot.subprocess, "run", side_effect=OSError("no security binary")):
            self.assertEqual(bot.keychain("svc"), "")

    def test_subprocess_error_returns_empty_string(self):
        with mock.patch.object(bot.subprocess, "run", side_effect=subprocess.SubprocessError("бум")):
            self.assertEqual(bot.keychain("svc"), "")

    def test_nonzero_returncode_returns_empty_string(self):
        completed = subprocess.CompletedProcess(args=["security"], returncode=1, stdout="", stderr="")
        with mock.patch.object(bot.subprocess, "run", return_value=completed):
            self.assertEqual(bot.keychain("svc"), "")

    def test_success_returns_stripped_stdout(self):
        completed = subprocess.CompletedProcess(args=["security"], returncode=0, stdout="  tok  \n", stderr="")
        with mock.patch.object(bot.subprocess, "run", return_value=completed):
            self.assertEqual(bot.keychain("svc"), "tok")


# ---------------------------------------------------------------------------
# Модульний захист відсутніх креденшелів (TOKEN/CHAT_ID) — окреме, ізольоване
# завантаження модуля з фейковим subprocess.run, що повертає порожній
# результат. Не через test_support.load_script: той кешує за іменем файлу, а
# тут навмисно потрібне НЕ кешоване, друге завантаження.
# ---------------------------------------------------------------------------

class ModuleGuardMissingCredentialsTest(unittest.TestCase):
    @staticmethod
    def _empty_security_run(cmd, *_a, **_kw):
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    def _load_fresh(self, side_effect):
        path = os.path.join(test_support.SCRIPT_DIR, "telegram-bot.py")
        spec = importlib.util.spec_from_file_location("_script_telegram_bot_badcreds", path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        self.addCleanup(sys.modules.pop, spec.name, None)
        with mock.patch("subprocess.run", side_effect=side_effect):
            spec.loader.exec_module(module)

    def test_missing_token_and_chat_id_exits(self):
        with self.assertRaises(SystemExit) as ctx:
            self._load_fresh(self._empty_security_run)
        self.assertIn("немає валідних токена/chat_id", str(ctx.exception))

    def test_non_numeric_chat_id_exits(self):
        def _bad_chat_id(cmd, *_a, **_kw):
            service = cmd[3] if len(cmd) > 3 else ""
            stdout = "not-a-number" if service == "ideas-scout-telegram-chat" else FAKE_TOKEN
            return subprocess.CompletedProcess(cmd, 0, stdout=stdout, stderr="")

        with self.assertRaises(SystemExit) as ctx:
            self._load_fresh(_bad_chat_id)
        self.assertIn("немає валідних токена/chat_id", str(ctx.exception))


# ---------------------------------------------------------------------------
# main() — точка входу CLI: аргументи, stdin, диспетчеризація
# ---------------------------------------------------------------------------

class MainTest(BotStateTestCase):
    def setUp(self):
        super().setUp()
        self._patches = {
            "recover": mock.patch.object(bot, "recover_interrupted_triage"),
            "nudge": mock.patch.object(bot, "nudge_if_idle"),
            "process_update": mock.patch.object(bot, "process_update"),
        }
        self.mocks = {name: p.start() for name, p in self._patches.items()}
        for p in self._patches.values():
            self.addCleanup(p.stop)

    def test_nudge_mode_calls_nudge_if_idle_only(self):
        with mock.patch.object(bot.sys, "argv", ["telegram-bot.py", "--nudge"]):
            bot.main()
        self.mocks["nudge"].assert_called_once()
        self.mocks["process_update"].assert_not_called()
        self.mocks["recover"].assert_called_once()

    def test_makes_state_and_logs_dirs(self):
        with mock.patch.object(bot.sys, "argv", ["telegram-bot.py", "--nudge"]):
            bot.main()
        self.assertTrue(os.path.isdir(self._state_dir))
        self.assertTrue(os.path.isdir(os.path.join(self._repo_root, "logs", "triage")))

    def test_no_args_fails_usage(self):
        with mock.patch.object(bot.sys, "argv", ["telegram-bot.py"]), \
             self.assertRaises(SystemExit) as ctx:
            bot.main()
        self.assertIn("Використання:", str(ctx.exception))

    def test_unknown_mode_fails_usage(self):
        with mock.patch.object(bot.sys, "argv", ["telegram-bot.py", "--bogus"]), \
             self.assertRaises(SystemExit):
            bot.main()

    def test_process_update_invalid_json_raises_value_error(self):
        with mock.patch.object(bot.sys, "argv", ["telegram-bot.py", "--process-update"]), \
             mock.patch.object(bot.sys, "stdin", io.StringIO("не json")), \
             self.assertRaises(ValueError) as ctx:
            bot.main()
        self.assertIn("job payload не є валідним JSON", str(ctx.exception))

    def test_process_update_missing_update_key_raises(self):
        with mock.patch.object(bot.sys, "argv", ["telegram-bot.py", "--process-update"]), \
             mock.patch.object(bot.sys, "stdin", io.StringIO('{"foo": 1}')), \
             self.assertRaises(ValueError) as ctx:
            bot.main()
        self.assertIn("немає поля update", str(ctx.exception))

    def test_process_update_non_dict_payload_raises(self):
        with mock.patch.object(bot.sys, "argv", ["telegram-bot.py", "--process-update"]), \
             mock.patch.object(bot.sys, "stdin", io.StringIO("[1, 2]")), \
             self.assertRaises(ValueError):
            bot.main()

    def test_process_update_valid_payload_dispatches(self):
        payload = {"update": {"update_id": 1, "message": {}}}
        with mock.patch.object(bot.sys, "argv", ["telegram-bot.py", "--process-update"]), \
             mock.patch.object(bot.sys, "stdin", io.StringIO(json.dumps(payload))):
            bot.main()
        self.mocks["process_update"].assert_called_once_with(payload["update"])


if __name__ == "__main__":
    unittest.main()
