#!/usr/bin/env python3
"""Реєструє Vercel webhook у Telegram без виведення токена чи секрету."""

import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

ENV_FILE = os.path.expanduser("~/.config/ideas-scout/env")
SECRET_RE = re.compile(r"^[A-Za-z0-9_-]{1,256}$")
COMMANDS = [
    ("new", "закрити чернетку і почати нову"),
    ("cancel", "викинути чернетку"),
    ("status", "що зараз відбувається"),
    ("last", "п'ять останніх карток"),
    ("help", "як користуватись ботом"),
]


def fail(message):
    sys.exit(f"configure-telegram-webhook.py: {message}")


def read_env_value(name):
    try:
        with open(ENV_FILE, encoding="utf-8") as file:
            for raw_line in file:
                line = raw_line.strip()
                if not line or line.startswith("#"):
                    continue
                if line.startswith("export "):
                    line = line[7:].lstrip()
                key, separator, value = line.partition("=")
                if separator and key.strip() == name:
                    value = value.strip()
                    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
                        value = value[1:-1]
                    return value
    except OSError as error:
        fail(f"не вдалося прочитати {ENV_FILE}: {error}")
    return ""


def keychain(service):
    try:
        # service — літерал зі скрипту ("ideas-scout-telegram*"), не ввід ззовні;
        # "security" — стандартна утиліта macOS у системному PATH.
        result = subprocess.run(  # noqa: S603
            ["security", "find-generic-password", "-s", service, "-w"],  # noqa: S607
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as error:
        fail(f"не вдалося прочитати {service} із Keychain: {error}")
    if result.returncode != 0 or not result.stdout.strip():
        fail(f"у Keychain немає {service}")
    return result.stdout.strip()


def telegram_api(token, method, **params):
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/{method}",
        data=json.dumps(params).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        # URL зібраний з константи https://api.telegram.org, не з вводу користувача.
        with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
            result = json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        body = error.read().decode(errors="replace")[:300]
        fail(f"Telegram {method} відповів HTTP {error.code}: {body}")
    except (urllib.error.URLError, OSError, json.JSONDecodeError) as error:
        fail(f"Telegram {method}: {error}")
    if not result.get("ok"):
        fail(f"Telegram {method}: {result.get('description', 'невідома помилка')}")
    return result.get("result")


def main():
    if len(sys.argv) != 2:
        fail("використання: ./agents/scripts/configure-telegram-webhook.py https://<домен-vercel>")

    base_url = sys.argv[1].rstrip("/")
    parsed = urllib.parse.urlparse(base_url)
    if parsed.scheme != "https" or not parsed.netloc or parsed.query or parsed.fragment:
        fail("потрібна публічна HTTPS-адреса дашборда без query або fragment")
    webhook_url = f"{base_url}/api/telegram/webhook"

    secret = read_env_value("TELEGRAM_WEBHOOK_SECRET")
    if not SECRET_RE.fullmatch(secret):
        fail(
            f"додай TELEGRAM_WEBHOOK_SECRET у {ENV_FILE}; дозволено 1–256 символів A-Z, a-z, 0-9, _ і -"
        )
    token = keychain("ideas-scout-telegram")
    chat_id = keychain("ideas-scout-telegram-chat")
    if not re.fullmatch(r"-?[0-9]+", chat_id):
        fail("ideas-scout-telegram-chat у Keychain не є числом")

    telegram_api(
        token,
        "setWebhook",
        url=webhook_url,
        secret_token=secret,
        allowed_updates=["message", "callback_query"],
        drop_pending_updates=False,
    )
    # Меню команд видно тільки у власному чаті: чужий, що знайшов бота, не бачить
    # ні списку, ні натяку, що тут узагалі є що викликати.
    telegram_api(
        token,
        "setMyCommands",
        commands=[{"command": command, "description": description} for command, description in COMMANDS],
        scope={"type": "chat", "chat_id": int(chat_id)},
    )
    for scope in ({"type": "default"}, {"type": "all_private_chats"}, {"type": "all_group_chats"}):
        telegram_api(token, "deleteMyCommands", scope=scope)
    info = telegram_api(token, "getWebhookInfo")
    if not isinstance(info, dict) or info.get("url") != webhook_url:
        fail("Telegram прийняв запит, але getWebhookInfo не підтвердив очікувану адресу")

    print(f"Webhook зареєстровано: {webhook_url}")
    print(f"Pending updates: {info.get('pending_update_count', 0)}")


if __name__ == "__main__":
    main()
