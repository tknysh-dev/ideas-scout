"""configure_telegram_webhook_test.py — юніт-тести для configure-telegram-webhook.py.

Ім'я скрипта з дефісом — завантажуємо через test_support.load_script.
Скрипт має __main__-захист, тож сам import нічого не виконує.

Мішень: telegram_api (побудова запиту й розбір відповіді Telegram — успіх,
HTTP-помилка, мережева помилка, несподівана форма відповіді), read_env_value
і keychain (джерела креденшелів), і main() — наскрізна перевірка побудови
запитів (URL вебхука, валідація секрету/chat_id) з усіма залежностями
замоканими. Жодного реального запиту в Telegram, жодного звернення до
реального Keychain чи файлу ~/.config/ideas-scout/env.
"""

from __future__ import annotations

import io
import json
import os
import subprocess
import tempfile
import unittest
import urllib.error
from unittest import mock

from test_support import load_script

webhook = load_script("configure-telegram-webhook.py")

FAKE_TOKEN = "111111:fake-token-for-tests"  # noqa: S105 — фейковий токен для тестів, не секрет


def _http_error(code: int, body: bytes) -> urllib.error.HTTPError:
    # fp — реальний BytesIO, а не мок: HTTPError делегує read() у нього
    # напряму, а мок замість файлового об'єкта лишає ResourceWarning при GC.
    return urllib.error.HTTPError(
        url="https://api.telegram.org/x", code=code, msg="err", hdrs=None, fp=io.BytesIO(body)
    )


class TelegramApiTest(unittest.TestCase):
    def test_builds_correct_url_and_json_body(self):
        response = mock.MagicMock()
        response.read.return_value = json.dumps({"ok": True, "result": {"x": 1}}).encode()
        response.__enter__.return_value = response
        with mock.patch.object(webhook.urllib.request, "urlopen", return_value=response) as urlopen:
            result = webhook.telegram_api(FAKE_TOKEN, "setWebhook", url="https://d.example/hook", flag=True)
        self.assertEqual(result, {"x": 1})
        request = urlopen.call_args[0][0]
        self.assertEqual(request.full_url, f"https://api.telegram.org/bot{FAKE_TOKEN}/setWebhook")
        self.assertEqual(request.get_header("Content-type"), "application/json")
        body = json.loads(request.data.decode())
        self.assertEqual(body, {"url": "https://d.example/hook", "flag": True})

    def test_success_without_result_key_returns_none(self):
        response = mock.MagicMock()
        response.read.return_value = json.dumps({"ok": True}).encode()
        response.__enter__.return_value = response
        with mock.patch.object(webhook.urllib.request, "urlopen", return_value=response):
            result = webhook.telegram_api(FAKE_TOKEN, "deleteMyCommands")
        self.assertIsNone(result)

    def test_ok_false_triggers_fail_with_description(self):
        response = mock.MagicMock()
        response.read.return_value = json.dumps(
            {"ok": False, "description": "chat not found"}
        ).encode()
        response.__enter__.return_value = response
        with mock.patch.object(webhook.urllib.request, "urlopen", return_value=response), \
             self.assertRaises(SystemExit) as ctx:
            webhook.telegram_api(FAKE_TOKEN, "setWebhook")
        self.assertIn("chat not found", str(ctx.exception))

    def test_missing_ok_key_treated_as_failure(self):
        # Несподівана форма відповіді: немає "ok" зовсім -> .get("ok") None -> falsy -> fail().
        response = mock.MagicMock()
        response.read.return_value = json.dumps({"result": {}}).encode()
        response.__enter__.return_value = response
        with mock.patch.object(webhook.urllib.request, "urlopen", return_value=response), \
             self.assertRaises(SystemExit) as ctx:
            webhook.telegram_api(FAKE_TOKEN, "getWebhookInfo")
        self.assertIn("невідома помилка", str(ctx.exception))

    def test_http_error_reports_code_and_truncated_body(self):
        body = ("x" * 500).encode()
        error = _http_error(429, body)
        self.addCleanup(error.close)
        with mock.patch.object(webhook.urllib.request, "urlopen", side_effect=error), \
             self.assertRaises(SystemExit) as ctx:
            webhook.telegram_api(FAKE_TOKEN, "setWebhook")
        message = str(ctx.exception)
        self.assertIn("HTTP 429", message)
        self.assertIn("x" * 300, message)
        self.assertNotIn("x" * 301, message)

    def test_url_error_reports_reason(self):
        with mock.patch.object(
            webhook.urllib.request, "urlopen", side_effect=urllib.error.URLError("мережа лежить")
        ), self.assertRaises(SystemExit) as ctx:
            webhook.telegram_api(FAKE_TOKEN, "setWebhook")
        self.assertIn("мережа лежить", str(ctx.exception))

    def test_bad_json_response_reports_failure(self):
        response = mock.MagicMock()
        response.read.return_value = "не json".encode()
        response.__enter__.return_value = response
        with mock.patch.object(webhook.urllib.request, "urlopen", return_value=response), \
             self.assertRaises(SystemExit):
            webhook.telegram_api(FAKE_TOKEN, "setWebhook")

    def test_oserror_reports_failure(self):
        with mock.patch.object(webhook.urllib.request, "urlopen", side_effect=OSError("boom")), \
             self.assertRaises(SystemExit) as ctx:
            webhook.telegram_api(FAKE_TOKEN, "setWebhook")
        self.assertIn("boom", str(ctx.exception))


class ReadEnvValueTest(unittest.TestCase):
    @staticmethod
    def _safe_remove(path: str) -> None:
        if os.path.exists(path):
            os.remove(path)

    def _write_env_file(self, content: str) -> str:
        fd, path = tempfile.mkstemp()
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        self.addCleanup(self._safe_remove, path)
        return path

    def test_missing_file_fails(self):
        with mock.patch.object(webhook, "ENV_FILE", "/nonexistent/does/not/exist"), \
             self.assertRaises(SystemExit):
            webhook.read_env_value("TELEGRAM_WEBHOOK_SECRET")

    def test_key_not_found_returns_empty_string(self):
        path = self._write_env_file("OTHER_KEY=value\n")
        with mock.patch.object(webhook, "ENV_FILE", path):
            value = webhook.read_env_value("TELEGRAM_WEBHOOK_SECRET")
        self.assertEqual(value, "")

    def test_plain_value_parsed(self):
        path = self._write_env_file("TELEGRAM_WEBHOOK_SECRET=abc123\n")
        with mock.patch.object(webhook, "ENV_FILE", path):
            value = webhook.read_env_value("TELEGRAM_WEBHOOK_SECRET")
        self.assertEqual(value, "abc123")

    def test_export_prefix_stripped(self):
        path = self._write_env_file("export TELEGRAM_WEBHOOK_SECRET=abc123\n")
        with mock.patch.object(webhook, "ENV_FILE", path):
            value = webhook.read_env_value("TELEGRAM_WEBHOOK_SECRET")
        self.assertEqual(value, "abc123")

    def test_double_quoted_value_unquoted(self):
        path = self._write_env_file('TELEGRAM_WEBHOOK_SECRET="abc123"\n')
        with mock.patch.object(webhook, "ENV_FILE", path):
            value = webhook.read_env_value("TELEGRAM_WEBHOOK_SECRET")
        self.assertEqual(value, "abc123")

    def test_single_quoted_value_unquoted(self):
        path = self._write_env_file("TELEGRAM_WEBHOOK_SECRET='abc123'\n")
        with mock.patch.object(webhook, "ENV_FILE", path):
            value = webhook.read_env_value("TELEGRAM_WEBHOOK_SECRET")
        self.assertEqual(value, "abc123")

    def test_mismatched_quotes_kept_whole(self):
        path = self._write_env_file("TELEGRAM_WEBHOOK_SECRET='abc123\"\n")
        with mock.patch.object(webhook, "ENV_FILE", path):
            value = webhook.read_env_value("TELEGRAM_WEBHOOK_SECRET")
        self.assertEqual(value, "'abc123\"")

    def test_comments_and_blank_lines_skipped(self):
        path = self._write_env_file(
            "# коментар\n\nTELEGRAM_WEBHOOK_SECRET=abc123\n"
        )
        with mock.patch.object(webhook, "ENV_FILE", path):
            value = webhook.read_env_value("TELEGRAM_WEBHOOK_SECRET")
        self.assertEqual(value, "abc123")

    def test_value_with_equals_sign_kept_whole(self):
        path = self._write_env_file("TELEGRAM_WEBHOOK_SECRET=abc=def=123\n")
        with mock.patch.object(webhook, "ENV_FILE", path):
            value = webhook.read_env_value("TELEGRAM_WEBHOOK_SECRET")
        self.assertEqual(value, "abc=def=123")


class KeychainTest(unittest.TestCase):
    def test_success_returns_stripped_stdout(self):
        completed = subprocess.CompletedProcess(args=["security"], returncode=0, stdout="tok123\n", stderr="")
        with mock.patch.object(webhook.subprocess, "run", return_value=completed):
            result = webhook.keychain("ideas-scout-telegram")
        self.assertEqual(result, "tok123")

    def test_nonzero_returncode_fails(self):
        completed = subprocess.CompletedProcess(args=["security"], returncode=1, stdout="", stderr="not found")
        with mock.patch.object(webhook.subprocess, "run", return_value=completed), \
             self.assertRaises(SystemExit) as ctx:
            webhook.keychain("ideas-scout-telegram")
        self.assertIn("ideas-scout-telegram", str(ctx.exception))

    def test_empty_stdout_fails(self):
        completed = subprocess.CompletedProcess(args=["security"], returncode=0, stdout="   \n", stderr="")
        with mock.patch.object(webhook.subprocess, "run", return_value=completed), \
             self.assertRaises(SystemExit):
            webhook.keychain("ideas-scout-telegram")

    def test_oserror_fails(self):
        with mock.patch.object(webhook.subprocess, "run", side_effect=OSError("no security binary")), \
             self.assertRaises(SystemExit) as ctx:
            webhook.keychain("ideas-scout-telegram")
        self.assertIn("no security binary", str(ctx.exception))


class MainTest(unittest.TestCase):
    def _base_mocks(self, secret="a" * 10, token=FAKE_TOKEN, chat_id="555555",
                     webhook_info_url=None, pending=0):
        webhook_info_url = webhook_info_url or "https://dash.example/api/telegram/webhook"

        def fake_telegram_api(_token, method, **_params):
            if method == "getWebhookInfo":
                return {"url": webhook_info_url, "pending_update_count": pending}
            return {}

        return {
            "read_env_value": mock.patch.object(webhook, "read_env_value", return_value=secret),
            "keychain": mock.patch.object(webhook, "keychain", side_effect=[token, chat_id]),
            "telegram_api": mock.patch.object(webhook, "telegram_api", side_effect=fake_telegram_api),
        }

    def test_wrong_argv_count_fails(self):
        with mock.patch.object(webhook.sys, "argv", ["configure-telegram-webhook.py"]), \
             self.assertRaises(SystemExit) as ctx:
            webhook.main()
        self.assertIn("використання", str(ctx.exception))

    def test_non_https_scheme_fails(self):
        with mock.patch.object(webhook.sys, "argv", ["x", "http://dash.example"]), \
             self.assertRaises(SystemExit) as ctx:
            webhook.main()
        self.assertIn("HTTPS", str(ctx.exception))

    def test_missing_netloc_fails(self):
        with mock.patch.object(webhook.sys, "argv", ["x", "https:///path"]), \
             self.assertRaises(SystemExit):
            webhook.main()

    def test_query_string_rejected(self):
        with mock.patch.object(webhook.sys, "argv", ["x", "https://dash.example?a=1"]), \
             self.assertRaises(SystemExit):
            webhook.main()

    def test_fragment_rejected(self):
        with mock.patch.object(webhook.sys, "argv", ["x", "https://dash.example#frag"]), \
             self.assertRaises(SystemExit):
            webhook.main()

    def test_invalid_secret_fails_before_touching_keychain(self):
        mocks = self._base_mocks(secret="bad secret with spaces")  # noqa: S106 — тестове значення, не секрет
        with mock.patch.object(webhook.sys, "argv", ["x", "https://dash.example"]), \
             mocks["read_env_value"], \
             mock.patch.object(webhook, "keychain") as keychain_mock, \
             self.assertRaises(SystemExit) as ctx:
            webhook.main()
        keychain_mock.assert_not_called()
        self.assertIn("TELEGRAM_WEBHOOK_SECRET", str(ctx.exception))

    def test_empty_secret_fails(self):
        mocks = self._base_mocks(secret="")
        with mock.patch.object(webhook.sys, "argv", ["x", "https://dash.example"]), \
             mocks["read_env_value"], \
             self.assertRaises(SystemExit):
            webhook.main()

    def test_secret_over_256_chars_fails(self):
        mocks = self._base_mocks(secret="a" * 257)
        with mock.patch.object(webhook.sys, "argv", ["x", "https://dash.example"]), \
             mocks["read_env_value"], \
             self.assertRaises(SystemExit):
            webhook.main()

    def test_secret_exactly_256_chars_accepted(self):
        mocks = self._base_mocks(secret="a" * 256, webhook_info_url="https://dash.example/api/telegram/webhook")
        with mock.patch.object(webhook.sys, "argv", ["x", "https://dash.example"]), \
             mocks["read_env_value"], mocks["keychain"], mocks["telegram_api"], \
             mock.patch("builtins.print"):
            webhook.main()  # не мусить впасти

    def test_non_numeric_chat_id_fails(self):
        mocks = self._base_mocks(chat_id="not-a-number")
        with mock.patch.object(webhook.sys, "argv", ["x", "https://dash.example"]), \
             mocks["read_env_value"], mocks["keychain"], \
             self.assertRaises(SystemExit) as ctx:
            webhook.main()
        self.assertIn("не є числом", str(ctx.exception))

    def test_negative_chat_id_accepted(self):
        mocks = self._base_mocks(chat_id="-100555555")
        with mock.patch.object(webhook.sys, "argv", ["x", "https://dash.example"]), \
             mocks["read_env_value"], mocks["keychain"], mocks["telegram_api"], \
             mock.patch("builtins.print"):
            webhook.main()  # не мусить впасти

    def test_successful_run_prints_webhook_and_pending(self):
        mocks = self._base_mocks(pending=5)
        with mock.patch.object(webhook.sys, "argv", ["x", "https://dash.example/"]), \
             mocks["read_env_value"], mocks["keychain"], mocks["telegram_api"], \
             mock.patch("builtins.print") as mock_print:
            webhook.main()
        printed = "\n".join(str(c.args[0]) for c in mock_print.call_args_list)
        self.assertIn("Webhook зареєстровано: https://dash.example/api/telegram/webhook", printed)
        self.assertIn("Pending updates: 5", printed)

    def test_trailing_slash_stripped_from_base_url(self):
        mocks = self._base_mocks()
        with mock.patch.object(webhook.sys, "argv", ["x", "https://dash.example///"]), \
             mocks["read_env_value"], mocks["keychain"], mocks["telegram_api"] as api_mock, \
             mock.patch("builtins.print"):
            webhook.main()
        set_webhook_call = next(c for c in api_mock.call_args_list if c.args[1] == "setWebhook")
        self.assertEqual(set_webhook_call.kwargs["url"], "https://dash.example/api/telegram/webhook")

    def test_set_webhook_called_with_expected_params(self):
        mocks = self._base_mocks()
        with mock.patch.object(webhook.sys, "argv", ["x", "https://dash.example"]), \
             mocks["read_env_value"], mocks["keychain"], mocks["telegram_api"] as api_mock, \
             mock.patch("builtins.print"):
            webhook.main()
        call = next(c for c in api_mock.call_args_list if c.args[1] == "setWebhook")
        self.assertEqual(call.kwargs["secret_token"], "a" * 10)
        self.assertEqual(call.kwargs["allowed_updates"], ["message", "callback_query"])
        self.assertFalse(call.kwargs["drop_pending_updates"])

    def test_set_my_commands_scoped_to_own_chat(self):
        mocks = self._base_mocks(chat_id="555555")
        with mock.patch.object(webhook.sys, "argv", ["x", "https://dash.example"]), \
             mocks["read_env_value"], mocks["keychain"], mocks["telegram_api"] as api_mock, \
             mock.patch("builtins.print"):
            webhook.main()
        call = next(c for c in api_mock.call_args_list if c.args[1] == "setMyCommands")
        self.assertEqual(call.kwargs["scope"], {"type": "chat", "chat_id": 555555})
        commands = [c["command"] for c in call.kwargs["commands"]]
        self.assertEqual(commands, ["new", "cancel", "status", "last", "help"])

    def test_delete_my_commands_called_for_three_public_scopes(self):
        mocks = self._base_mocks()
        with mock.patch.object(webhook.sys, "argv", ["x", "https://dash.example"]), \
             mocks["read_env_value"], mocks["keychain"], mocks["telegram_api"] as api_mock, \
             mock.patch("builtins.print"):
            webhook.main()
        delete_calls = [c for c in api_mock.call_args_list if c.args[1] == "deleteMyCommands"]
        scopes = [c.kwargs["scope"]["type"] for c in delete_calls]
        self.assertEqual(scopes, ["default", "all_private_chats", "all_group_chats"])

    def test_webhook_info_url_mismatch_fails(self):
        mocks = self._base_mocks(webhook_info_url="https://different.example/api/telegram/webhook")
        with mock.patch.object(webhook.sys, "argv", ["x", "https://dash.example"]), \
             mocks["read_env_value"], mocks["keychain"], mocks["telegram_api"], \
             self.assertRaises(SystemExit) as ctx:
            webhook.main()
        self.assertIn("не підтвердив очікувану адресу", str(ctx.exception))

    def test_webhook_info_non_dict_fails(self):
        def fake_telegram_api(_token, method, **_params):
            return None if method == "getWebhookInfo" else {}

        with mock.patch.object(webhook.sys, "argv", ["x", "https://dash.example"]), \
             mock.patch.object(webhook, "read_env_value", return_value="a" * 10), \
             mock.patch.object(webhook, "keychain", side_effect=[FAKE_TOKEN, "555555"]), \
             mock.patch.object(webhook, "telegram_api", side_effect=fake_telegram_api), \
             self.assertRaises(SystemExit) as ctx:
            webhook.main()
        self.assertIn("не підтвердив очікувану адресу", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
