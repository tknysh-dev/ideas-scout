"""digest.py — тіло щоденного дайджесту: знахідки за добу + що зламалось.

Друкує JSON {"text": "<html>", "created": N, "updated": N} — monitor.sh бере
text і шле в Telegram, а числа кладе в meta прогону.

Порядок навмисний: спершу те, заради чого система існує (нові картки, згруповані
за треком і статусом, кожна — посилання на свою сторінку в dashboard), і лише
під ними технічний стан. Причому зі стану — тільки не зелене: перелік з тридцяти
✅ щодня привчає гортати дайджест не читаючи, а тоді єдиний 🔴 у ньому не помічають.
"""

from __future__ import annotations

import html
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import db
from doctor_report import TG_TEXT_LIMIT, run_doctor

WINDOW_H = 24

# Треки заводяться в системі, а не тут: невідомий трек показуємо як є, аби нова
# гілка досліджень не зникала з дайджесту мовчки до правки цього файлу.
TRACK_LABELS = {
    "passive-income": "💰 Пасивний дохід",
    "app-ideas": "📱 Мобільні застосунки",
}

# Прийняті зверху, відхилені знизу; невідомі статуси — між ними, перед відхиленими.
STATUS_ORDER = ["accepted", "approved_pending", "new", "analyzing", "transferred", "rejected"]
STATUS_LABELS = {
    "accepted": "✅ Прийняті",
    "approved_pending": "⏳ Очікують рішення",
    "new": "🆕 Нові, ще без аналізу",
    "analyzing": "🔍 В аналізі",
    "transferred": "↗️ Перенесені в інший трек",
    "rejected": "❌ Відхилені",
}


def esc(s) -> str:
    return html.escape(str(s), quote=False)


def dashboard_base_url() -> str:
    """Звідки взяти адресу порталу, не заводячи ще один секрет.

    Vercel-домен уже відомий Telegram — там зареєстрований webhook саме на
    нього. Читаємо його звідти, щоб адреса не роз'їхалась із реальністю після
    переїзду на інший домен. IDEAS_SCOUT_DASHBOARD_URL перекриває, якщо треба.
    """
    override = os.environ.get("IDEAS_SCOUT_DASHBOARD_URL", "").strip()
    if override:
        return override.rstrip("/")
    try:
        # "security" — стандартна утиліта macOS у системному PATH.
        token = subprocess.run(
            ["security", "find-generic-password", "-s", "ideas-scout-telegram", "-w"],  # noqa: S607
            capture_output=True, text=True, timeout=10, check=False,
        )
        if token.returncode != 0:
            return ""
        url = f"https://api.telegram.org/bot{token.stdout.strip()}/getWebhookInfo"
        with urllib.request.urlopen(url, timeout=15) as resp:
            info = json.loads(resp.read().decode()).get("result") or {}
    except (OSError, subprocess.SubprocessError, urllib.error.URLError,
            json.JSONDecodeError, TimeoutError):
        return ""
    hook = info.get("url") or ""
    return hook.split("/api/telegram/webhook")[0].rstrip("/") if hook else ""


def idea_line(idea: dict, base_url: str) -> str:
    title = esc(idea.get("title") or "(без назви)")
    ident = esc(idea.get("id") or "?")
    if not base_url:
        return f"• {ident} — {title}"
    href = f"{base_url}/ideas/{urllib.parse.quote(str(idea.get('id') or ''), safe='')}"
    return f'• <a href="{esc(href)}">{ident} — {title}</a>'


def findings_section(ideas: list[dict], base_url: str, per_group: int | None = None) -> list[str]:
    if not ideas:
        return ["<b>Знахідки за добу</b>", "Нових карток немає."]

    by_track: dict[str, dict[str, list[dict]]] = {}
    for idea in ideas:
        track = idea.get("track") or "—"
        by_track.setdefault(track, {}).setdefault(idea.get("status") or "—", []).append(idea)

    out = [f"<b>Знахідки за добу — {len(ideas)}</b>"]
    for track in sorted(by_track, key=lambda t: (t not in TRACK_LABELS, t)):
        groups = by_track[track]
        out.append(f"\n<b>{esc(TRACK_LABELS.get(track, track))}</b>")
        known = [s for s in STATUS_ORDER if s in groups]
        unknown = sorted(s for s in groups if s not in STATUS_ORDER)
        # Невідомий статус ставимо перед «Відхилені», щоб низ повідомлення
        # лишався тим, чим його звикли читати.
        order = [s for s in known if s != "rejected"] + unknown + [s for s in known if s == "rejected"]
        for status in order:
            rows = groups[status]
            shown = rows if per_group is None else rows[:per_group]
            # Порожній рядок перед кожною групою: на телефоні заголовки
            # переносяться, і без розриву статусні групи злипаються в суцільний
            # список, де межу видно гірше, ніж будь-який відступ.
            out.append(f"\n{STATUS_LABELS.get(status, esc(status))}")
            out.extend(idea_line(i, base_url) for i in shown)
            if len(shown) < len(rows):
                out.append(f"  …ще {len(rows) - len(shown)} — решта в порталі")
    return out


def build() -> dict:
    since = (datetime.now(timezone.utc) - timedelta(hours=WINDOW_H)).strftime("%Y-%m-%dT%H:%M:%SZ")
    errors = []
    try:
        ideas = db.get_ideas_created_since(since)
    except db.DbError as e:
        ideas, errors = [], [f"не вдалось прочитати ideas: {e}"]
    try:
        updated = db.count_ideas_updated_since(since)
    except db.DbError:
        updated = -1

    base_url = dashboard_base_url()
    health = run_doctor(warnings_only=True)
    tail = []
    if updated > 0:
        tail.append(f"\n⚪ Оновлено вже наявних карток: {updated}")
    tail += [f"\n🔴 {esc(e)}" for e in errors]

    # Урожайна доба здатна не влізти в ліміт Telegram. Ріжемо саме списки
    # карток — вони мають продовження в порталі; блок «на що глянути» не має.
    for per_group in (None, 10, 5, 3, 1):
        lines = [f"<b>Ideas-scout — дайджест за {WINDOW_H} год</b>", ""]
        lines += findings_section(ideas, base_url, per_group)
        lines += tail + ["", health]
        text = "\n".join(lines)
        if len(text) <= TG_TEXT_LIMIT:
            break
    return {"text": text, "created": len(ideas), "updated": max(updated, 0)}


if __name__ == "__main__":
    print(json.dumps(build(), ensure_ascii=False))
