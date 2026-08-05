"""doctor_report.py — вивід doctor.sh у вигляді Telegram-повідомлення.

Спільний код для двох споживачів: команди /status у telegram-bot.py (повний звіт)
і щоденного дайджесту monitor.sh (лише те, що не зелене). Формат навмисно
повторює термінал один-в-один — дві різні картини системи власник тримати в
голові не мусить; перекладаються тільки маркери на emoji.

CLI: doctor_report.py [--warnings-only] — друкує готовий HTML у stdout.
"""

from __future__ import annotations

import html
import os
import re
import subprocess
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DOCTOR_TIMEOUT_S = 180
TG_TEXT_LIMIT = 4096
SUMMARY_RE = re.compile(r"(\d+)\s+ок\s+·\s+(\d+)\s+попередж\w*\s+·\s+(\d+)\s+проблем")
EMOJI = {"✔": "✅", "▲": "🟡", "✘": "🔴", "·": "⚪"}
QUIET_MARKERS = ("✔", "·")


def _esc(s) -> str:
    return html.escape(str(s), quote=False)


def run_doctor(warnings_only: bool = False) -> str:
    """Ганяє doctor.sh і перекладає його вивід у Telegram-повідомлення.

    Без --llm: /status тиснуть будь-коли, а реальний виклик claude -p їв би
    ліміт підписки на кожне натискання.
    """
    script = os.path.join(REPO_ROOT, "agents/scripts/doctor.sh")
    try:
        # script зібраний із REPO_ROOT (шлях від __file__), не з вводу користувача.
        p = subprocess.run(  # noqa: S603
            [script],
            cwd=REPO_ROOT,
            env={**os.environ, "NO_COLOR": "1"},
            capture_output=True,
            text=True,
            timeout=DOCTOR_TIMEOUT_S,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return (f"❔ <b>Здоров'я системи</b>\ndoctor.sh не вклався в {DOCTOR_TIMEOUT_S} с — "
                "швидше за все висить мережева перевірка.")
    except OSError as e:
        return f"❔ <b>Здоров'я системи</b>\nне вдалось запустити doctor.sh: {_esc(e)}"
    return format_doctor_report(p.stdout, p.returncode, p.stderr, warnings_only=warnings_only)


def format_doctor_report(stdout, returncode, stderr="", warnings_only=False) -> str:
    """Вивід doctor.sh → HTML, структура один-в-один.

    warnings_only лишає тільки 🟡/🔴: у щоденному дайджесті тридцять зелених
    рядків ховають те єдине, заради чого його читають.
    """
    lines = stdout.splitlines()
    header = lines[0].strip() if lines else ""
    counts = None
    in_summary = False
    items = []  # (kind, marker, text)
    for raw in lines[1:]:
        line = raw.rstrip()
        if not line:
            continue
        body = line.strip()
        marker = EMOJI.get(body[:1])
        if marker:
            items.append(("check", body[:1], f"{marker} {body[1:].strip()}"))
        elif body.startswith("↳"):
            # Підказка стосується попереднього рядка — без неї попередження
            # часто не дає зрозуміти, що саме робити.
            items.append(("hint", "", f"   ↳ <code>{_esc(body[1:].strip())}</code>"))
        elif SUMMARY_RE.search(body):
            counts = SUMMARY_RE.search(body).groups()
            items.append(("tail", "", f"{counts[0]} ок · {counts[1]} попереджень · {counts[2]} проблем"))
        elif not line.startswith(" "):
            if in_summary:
                # «дивись рядки з ✘ вище» має вказувати на той значок, який
                # людина справді бачить у чаті.
                items.append(("tail", "", _esc(body).translate(str.maketrans(EMOJI))))
            else:
                in_summary = body.startswith("Підсумок")
                items.append(("section", "", f"\n<b>{_esc(body)}</b>"))
        else:
            items.append(("tail", "", _esc(body)))

    if returncode not in (0, 1, 2) and counts is None:
        stderr = " ".join(stderr.split())[:300]
        return f"❔ <b>Здоров'я системи</b>\ndoctor.sh упав (код {returncode}): {_esc(stderr or '—')}"

    head = "🔴" if counts and counts[2] != "0" else ("🟡" if counts and counts[1] != "0" else "✅")

    if warnings_only:
        return _render_warnings_only(head, counts, items)

    prefix = [f"{head} <b>{_esc(header)}</b>" if header else f"{head} <b>doctor</b>"]
    # Повний звіт зазвичай влазить у ліміт Telegram, але не гарантовано. Різати
    # хвіст не можна — там підсумок, найцінніше; тому спершу летять довідкові
    # рядки, потім успішні, і лише проблеми лишаються завжди.
    for drop in ((), ("·",), ("·", "✔")):
        text = "\n".join(
            prefix + [t for kind, m, t in items if not (kind == "check" and m in drop)]
        )
        if len(text) <= TG_TEXT_LIMIT:
            return text
    return text


def _render_warnings_only(head, counts, items) -> str:
    """Лише 🟡/🔴 зі своїми секціями й підказками, без підсумкового вироку."""
    out = []
    pending_section = None
    keep = False
    for kind, marker, text in items:
        if kind == "section":
            pending_section = text
            keep = False
        elif kind == "check":
            if marker in QUIET_MARKERS:
                keep = False
                continue
            if pending_section is not None:
                out.append(pending_section)
                pending_section = None
            out.append(text)
            keep = True
        elif kind == "hint" and keep:
            out.append(text)

    if not out:
        return "✅ <b>Здоров'я системи</b>\nЗауважень немає."
    counts_line = (f"{counts[1]} попереджень · {counts[2]} проблем" if counts else "")
    title = f"{head} <b>На що глянути</b>" + (f"\n{counts_line}" if counts_line else "")
    return "\n".join([title] + out)


if __name__ == "__main__":
    print(run_doctor(warnings_only="--warnings-only" in sys.argv[1:]))
