#!/usr/bin/env python3
"""telegram-bot.py — одноразовий обробник подій Telegram на M1.

Telegram надсилає webhook у dashboard на Vercel, той кладе update у Supabase jobs,
а постійний M1-worker запускає цей файл рівно для однієї події. Сам скрипт не слухає
Telegram і не має довгоживучого циклу. Обробляє рівно один chat_id — свій, з Keychain.

Межа безпеки (дзеркалить runner.sh): бот не оцінює нічого сам і не має справи з git.
Він збирає повідомлення в чернетку, за твоїм підтвердженням кладе її в таблицю inbox
у Supabase (через db.py; Фаза 4 міграції — раніше файлом inbox/.../idea.md) і кличе
runner.sh --agent triage. Уся оцінка — той самий `claude -p`, тепер із доступом лише
до agents/scripts/db.sh (жодного іншого Bash); коміт коду/каталогів робить runner.
Текст повідомлень, вміст сторінок і текст на скріншотах — недовірені дані.

Стан бота (поточна чернетка, завантажені файли до підтвердження) навмисно
ЗОВНІ репозиторію: guard runner.sh відкочує будь-який шлях поза allowlist, а гігієна
на старті прогону робить stash — рантайм-стан бота всередині репо не пережив би
нічний прогін. Зв'язок «повідомлення з вердиктом → картка» стану не потребує: id
картки читається з тексту цитованого повідомлення.
"""

import html
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import db  # agents/scripts/db.py — доступ до Supabase (Фаза 4 міграції)
from doctor_report import run_doctor  # спільний із monitor.sh формат звіту

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STATE_DIR = os.path.expanduser("~/Library/Application Support/ideas-scout")
STATE_FILE = os.path.join(STATE_DIR, "telegram-state.json")
DRAFT_DIR = os.path.join(STATE_DIR, "draft")

API = "https://api.telegram.org"
DRAFT_WINDOW_S = 600
NUDGE_AFTER_S = DRAFT_WINDOW_S
FETCH_TIMEOUT_S = 15
FETCH_MAX_BYTES = 400_000
TG_TEXT_LIMIT = 4096

TRACKS = {"app-ideas": "📱 Апка", "passive-income": "💰 Дохід"}
DEFAULT_TRACK = "app-ideas"
CARD_ID_RE = re.compile(r"\b(AI|PI)-\d{3,5}\b")

_run_lock = threading.Lock()


def log(msg):
    print(f"{datetime.now(timezone.utc).strftime('%FT%TZ')} {msg}", flush=True)


# ---------------------------------------------------------------------------
# Секрети: лише Keychain, як у monitor.sh. Ніколи з репо чи env.
# ---------------------------------------------------------------------------

def keychain(service):
    try:
        out = subprocess.run(
            ["security", "find-generic-password", "-s", service, "-w"],
            capture_output=True, text=True, timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return out.stdout.strip() if out.returncode == 0 else ""


TOKEN = keychain("ideas-scout-telegram")
CHAT_ID = keychain("ideas-scout-telegram-chat")

if not TOKEN or not CHAT_ID.isdigit():
    sys.exit(
        "telegram-bot.py: немає валідних токена/chat_id у Keychain "
        "(ideas-scout-telegram / ideas-scout-telegram-chat). Див. docs/operations.md."
    )


# ---------------------------------------------------------------------------
# Telegram API
# ---------------------------------------------------------------------------

def api(method, _http_timeout=30, **params):
    """Викликає один метод Telegram Bot API з обмеженим HTTP-таймаутом."""
    url = f"{API}/bot{TOKEN}/{method}"
    data = json.dumps(params).encode()
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=_http_timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:300]
        log(f"api {method}: HTTP {e.code} {body}")
    except (urllib.error.URLError, OSError, json.JSONDecodeError, TimeoutError) as e:
        log(f"api {method}: {e}")
    return None


def send(text, buttons=None, reply_to=None):
    params = {"chat_id": int(CHAT_ID), "text": clip(text), "parse_mode": "HTML",
              "disable_web_page_preview": True}
    if buttons:
        params["reply_markup"] = {"inline_keyboard": buttons}
    if reply_to:
        params["reply_to_message_id"] = reply_to
    r = api("sendMessage", **params)
    return r["result"]["message_id"] if r and r.get("ok") else None


def edit(message_id, text, buttons=None):
    params = {"chat_id": int(CHAT_ID), "message_id": message_id, "text": clip(text),
              "parse_mode": "HTML", "disable_web_page_preview": True}
    params["reply_markup"] = {"inline_keyboard": buttons or []}
    api("editMessageText", **params)


def react(message_id, emoji):
    api("setMessageReaction", chat_id=int(CHAT_ID), message_id=message_id,
        reaction=[{"type": "emoji", "emoji": emoji}])


def ack(callback_id, text=None):
    api("answerCallbackQuery", callback_query_id=callback_id, text=text or "")


def clip(text):
    return text if len(text) <= TG_TEXT_LIMIT else text[: TG_TEXT_LIMIT - 20] + "\n…(обрізано)"


def esc(s):
    return html.escape(str(s), quote=False)


# ---------------------------------------------------------------------------
# Стан
# ---------------------------------------------------------------------------

def load_state():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {"draft": None}


def save_state(state):
    os.makedirs(STATE_DIR, exist_ok=True)
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
    os.replace(tmp, STATE_FILE)


STATE = load_state()


def draft():
    return STATE.get("draft")


def new_draft(track=DEFAULT_TRACK, first_msg_id=None, msg_time=None):
    shutil.rmtree(DRAFT_DIR, ignore_errors=True)
    os.makedirs(DRAFT_DIR, exist_ok=True)
    STATE["draft"] = {
        "id": datetime.now().strftime("%Y%m%d-%H%M%S"),
        "track": track,
        "state": "open",
        "fragments": [],
        "panel_msg_id": None,
        "first_msg_id": first_msg_id,
        "last_msg_time": msg_time or int(time.time()),
        "nudged": False,
        "target_card": None,
        "mode": "new",
    }
    return STATE["draft"]


def drop_draft():
    STATE["draft"] = None
    shutil.rmtree(DRAFT_DIR, ignore_errors=True)
    save_state(STATE)


# ---------------------------------------------------------------------------
# Перевірка посилання: одразу при отриманні, поки ти ще в чаті.
# ---------------------------------------------------------------------------

PAYWALL_MARKERS = ("subscribe to continue", "this post is for paid", "paid subscribers",
                   "become a member to read", "підпис", "for subscribers only",
                   "you've reached your limit", "metered paywall")
LOGIN_MARKERS = ("sign in to continue", "log in to continue", "please log in",
                 "create an account to", "увійдіть, щоб")

TAG_RE = re.compile(r"<(script|style)[^>]*>.*?</\1>", re.S | re.I)
STRIP_RE = re.compile(r"<[^>]+>")
TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.S | re.I)


def fetch_url(url):
    """Повертає (стан, деталі, заголовок, текст). Стан: ok | paywall | login |
    empty | blocked | missing | error."""
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "uk,en;q=0.8",
    })
    try:
        with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT_S) as resp:
            raw = resp.read(FETCH_MAX_BYTES)
            charset = resp.headers.get_content_charset() or "utf-8"
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            return "blocked", f"сайт відповів {e.code} — блокує роботів або треба вхід", "", ""
        if e.code == 404:
            return "missing", "сторінки не існує (404)", "", ""
        if e.code == 402:
            return "paywall", "платний доступ (402)", "", ""
        return "error", f"HTTP {e.code}", "", ""
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        return "error", f"не достукався: {e}", "", ""

    body = raw.decode(charset, errors="replace")
    m = TITLE_RE.search(body)
    title = STRIP_RE.sub("", m.group(1)).strip()[:200] if m else ""
    text = STRIP_RE.sub(" ", TAG_RE.sub(" ", body))
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    low = text.lower()

    if any(k in low for k in PAYWALL_MARKERS):
        return "paywall", "потрібна платна підписка", title, text
    if any(k in low for k in LOGIN_MARKERS):
        return "login", "потрібен вхід в акаунт", title, text
    if len(text) < 400:
        return "empty", "сторінка порожня без скриптів", title, text
    return "ok", f"прочитав, {len(text.split())} слів", title, text


# ---------------------------------------------------------------------------
# Панель чернетки
# ---------------------------------------------------------------------------

def panel_text(d):
    lines = []
    if d["mode"] == "append":
        lines.append(f"↩️ <b>Доповнюю {esc(d['target_card'])}</b>")
    else:
        lines.append("<b>Чернетка</b>")
    lines.append("")
    for fr in d["fragments"]:
        if fr["kind"] == "url":
            head = esc(fr.get("title") or fr["value"])[:120]
            lines.append(f"🔗 {head}")
            mark = "📄" if fr["fetch"] == "ok" else "⚠️"
            lines.append(f"   {mark} {esc(fr['detail'])}")
        elif fr["kind"] == "photo":
            lines.append(f"🖼 зображення ({esc(fr['value'])})")
        else:
            lines.append(f"💬 {esc(fr['value'][:200])}")
    if d["state"] == "awaiting_material":
        lines.append("")
        lines.append("Скинь текст або скріншот — і оцінюю.")
    return "\n".join(lines)


def panel_buttons(d):
    if d["state"] == "running":
        return []
    if d["mode"] == "append":
        return [[
            {"text": "Додати й переоцінити", "callback_data": "eval"},
            {"text": "Просто дописати", "callback_data": "append_only"},
        ], [{"text": "Викинути", "callback_data": "drop"}]]

    row = []
    if d["state"] == "awaiting_material":
        row.append({"text": "Оцінити як є", "callback_data": "eval"})
    else:
        row.append({"text": "Оцінити", "callback_data": "eval"})
    row.append({"text": "Викинути", "callback_data": "drop"})

    tracks = [{"text": (("✓ " if t == d["track"] else "") + label),
               "callback_data": f"track:{t}"} for t, label in TRACKS.items()]
    return [row, tracks]


def render(d):
    text, buttons = panel_text(d), panel_buttons(d)
    if d["panel_msg_id"]:
        edit(d["panel_msg_id"], text, buttons)
    else:
        d["panel_msg_id"] = send(text, buttons)
    save_state(STATE)


# ---------------------------------------------------------------------------
# Прийом повідомлень
# ---------------------------------------------------------------------------

URL_RE = re.compile(r"https?://\S+")


PASTED_ARTICLE_MIN = 400


def add_fragment(d, fr):
    d["fragments"].append(fr)
    # Чернетку, що чекає на матеріал, «розблоковує» лише сам матеріал: скріншот або
    # вставлений текст статті. Короткий коментар поруч із непрочитаним лінком —
    # це ще не заміна статті, і кнопка «Оцінити» не має від нього повертатись.
    if d["state"] != "awaiting_material":
        return
    if fr["kind"] == "photo" or (fr["kind"] == "text" and len(fr["value"]) >= PASTED_ARTICLE_MIN):
        d["state"] = "open"


def handle_text(d, text):
    urls = URL_RE.findall(text)
    rest = URL_RE.sub("", text).strip()
    for u in urls:
        state, detail, title, body = fetch_url(u)
        if body:
            path = os.path.join(DRAFT_DIR, f"source-{len(d['fragments'])+1}.txt")
            with open(path, "w", encoding="utf-8") as f:
                f.write(body[:200_000])
        add_fragment(d, {"kind": "url", "value": u, "fetch": state,
                         "detail": detail, "title": title})
        if state != "ok":
            d["state"] = "awaiting_material"
    if rest:
        add_fragment(d, {"kind": "text", "value": rest})


def handle_photo(d, file_id, caption):
    r = api("getFile", file_id=file_id)
    if not (r and r.get("ok")):
        return
    fp = r["result"]["file_path"]
    name = f"photo-{len([f for f in d['fragments'] if f['kind']=='photo'])+1}{os.path.splitext(fp)[1] or '.jpg'}"
    dest = os.path.join(DRAFT_DIR, name)
    try:
        urllib.request.urlretrieve(f"{API}/file/bot{TOKEN}/{fp}", dest)
    except (urllib.error.URLError, OSError) as e:
        log(f"getFile download: {e}")
        return
    add_fragment(d, {"kind": "photo", "value": name})
    if caption:
        add_fragment(d, {"kind": "text", "value": caption})


def is_substantive(msg):
    if msg.get("photo") or msg.get("document"):
        return True
    t = (msg.get("text") or msg.get("caption") or "").strip()
    return bool(URL_RE.search(t)) or len(t) >= 25


def on_message(msg):
    mid = msg["message_id"]
    text = (msg.get("text") or msg.get("caption") or "").strip()
    msg_time = msg.get("date", int(time.time()))

    if text.startswith("/"):
        on_command(text.split()[0].lstrip("/").split("@")[0], mid)
        return

    reply = msg.get("reply_to_message") or {}
    card = CARD_ID_RE.search(reply.get("text") or "")
    d = draft()

    if d and d["state"] == "running":
        send("Зараз іде оцінка — почекай, потім кину сюди ж.", reply_to=mid)
        return

    if not is_substantive(msg) and not card:
        react(mid, "🤔")
        return

    if card and (not d or d["mode"] != "append" or d["target_card"] != card.group(0)):
        d = new_draft(first_msg_id=mid, msg_time=msg_time)
        d["mode"] = "append"
        d["target_card"] = card.group(0)
    elif not d or msg_time - d["last_msg_time"] > DRAFT_WINDOW_S:
        d = new_draft(first_msg_id=mid, msg_time=msg_time)

    d["last_msg_time"] = msg_time
    d["nudged"] = False
    react(mid, "👀")

    if msg.get("photo"):
        handle_photo(d, msg["photo"][-1]["file_id"], text)
    elif msg.get("document") and (msg["document"].get("mime_type") or "").startswith("image/"):
        handle_photo(d, msg["document"]["file_id"], text)
    elif text:
        handle_text(d, text)

    react(mid, "✍️")
    render(d)


# ---------------------------------------------------------------------------
# Кнопки
# ---------------------------------------------------------------------------

def on_callback(cb):
    data = cb.get("data") or ""
    d = draft()
    if not d:
        ack(cb["id"], "Чернетки вже немає")
        return

    if data.startswith("track:"):
        d["track"] = data.split(":", 1)[1]
        ack(cb["id"], TRACKS[d["track"]])
        render(d)
        return

    if data == "drop":
        ack(cb["id"], "Викинув")
        if d["panel_msg_id"]:
            edit(d["panel_msg_id"], "Чернетку викинуто.")
        drop_draft()
        return

    if data in ("eval", "append_only"):
        if d["state"] == "running":
            ack(cb["id"], "Уже працюю")
            return
        ack(cb["id"], "Поїхали")
        d["mode_flag"] = "append_only" if data == "append_only" else d["mode"]
        d["state"] = "running"
        render(d)
        # Webhook уже підтверджений Vercel-ом, а цей одноразовий процес живе всередині
        # queue job. Тріаж мусить завершитись до виходу процесу, інакше daemon-thread
        # обірветься разом із ним і worker помилково позначить job успішним.
        run_triage(dict(d))
        return

    ack(cb["id"])


# ---------------------------------------------------------------------------
# Запуск тріажу
# ---------------------------------------------------------------------------

def write_inbox(d):
    """Копіює вкладення (скріншоти, збережений текст сторінок) у inbox/<id>-<track>/ —
    для них немає колонки в Supabase, агент-тріаж читає їх з диска як файли. Сам текст
    чернетки (raw_text) і metadata (submitted_at, mode, target_card_id тощо) йдуть у
    таблицю inbox через db.py — Фаза 4 міграції, раніше все це було в idea.md."""
    box = os.path.join(REPO_ROOT, "inbox", f"{d['id']}-{d['track']}")
    os.makedirs(box, exist_ok=True)
    for name in os.listdir(DRAFT_DIR):
        shutil.copy2(os.path.join(DRAFT_DIR, name), os.path.join(box, name))

    body = []
    for fr in d["fragments"]:
        if fr["kind"] == "url":
            body.append(f"## Посилання\n{fr['value']}\n\nСтан читання: {fr['fetch']} — {fr['detail']}")
            if fr.get("title"):
                body.append(f"Заголовок: {fr['title']}")
        elif fr["kind"] == "photo":
            body.append(f"## Зображення\n`{fr['value']}` (у теці inbox/{d['id']}-{d['track']}/ — прочитай його)")
        else:
            body.append(f"## Коментар власника\n{fr['value']}")
    saved = sorted(n for n in os.listdir(box) if n.startswith("source-"))
    if saved:
        body.append("## Збережений текст сторінок\n" + "\n".join(f"`{n}`" for n in saved))

    raw_text = "\n\n".join(body) + "\n"
    target_card = d["target_card"] or None
    db.insert_inbox(
        draft_id=d["id"],
        submitted_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        raw_text=raw_text,
        source="telegram",
        track=d["track"],
        mode=d.get("mode_flag") or d["mode"],
        target_card_id=target_card,
    )
    return os.path.relpath(box, REPO_ROOT)


def progress_watcher(d, stop, started):
    pfile = os.path.join(REPO_ROOT, "logs", "triage", f"{d['id']}.progress")
    last = ""
    while not stop.is_set():
        stage = ""
        try:
            with open(pfile, encoding="utf-8") as f:
                lines = [l.strip() for l in f if l.strip()]
            stage = lines[-1] if lines else ""
        except OSError:
            pass
        mins = int((time.time() - started) // 60)
        text = panel_text(d) + "\n\n⏳ " + esc(stage or "Оцінюю…")
        if mins:
            text += f" ({mins} хв)"
        if text != last:
            edit(d["panel_msg_id"], text)
            last = text
        stop.wait(20)


RUN_FAILURE_HINTS = {
    "skipped": "Прогін пропущено — лок зайнятий іншим прогоном. Спробуй ще раз за кілька хвилин.",
    "skipped_work_hours": "Прогін пропущено захистом робочих годин (для тріажу так не має бути — перевір runner.sh).",
    "error": "Прогін завершився помилкою.",
    "blocked_paths": "Агент спробував записати щось поза дозволеними теками — зміни відкочено. Подивись logs/quarantine/.",
    "dry_run": "runner.sh відпрацював у режимі dry-run — реальної оцінки не було.",
    "": "runner.sh не дійшов навіть до запису статусу — швидше за все впав на старті (перевір logs/launchd/).",
}


def read_run_status(track):
    """Чому прогін не дав вердикту. runner.sh виходить з кодом 0 і на ранніх обривах
    (лок зайнятий, HEAD не на main, немає claude в PATH, немає промпту) — сам по собі
    код повернення про причину не каже нічого, вона лежить у записі runs (Фаза 4:
    раніше — logs/status/<track>-triage.json)."""
    try:
        s = db.get_last_run("triage", track)
    except db.DbError as e:
        log(f"read_run_status: {e}")
        return "", ""
    if not s:
        return "", ""
    errors = s.get("errors") or []
    error_tail = str(errors[0]) if errors else ""
    return s.get("status", "") or "", error_tail.strip()


def read_verdict(draft_id):
    """Вердикт тріажу тепер живе в inbox.triage_verdict/.triage_status/.idea_id
    (Фаза 4 міграції — раніше файл logs/triage/<draft_id>.md)."""
    try:
        row = db.get_inbox(draft_id)
    except db.DbError as e:
        log(f"read_verdict: {e}")
        return None
    if not row or not row.get("triage_verdict"):
        return None
    return {
        "card_id": row.get("idea_id") or "—",
        "status": row.get("triage_status") or "",
        "score": str(row["triage_score"]) if row.get("triage_score") is not None else "",
        "body": (row.get("triage_verdict") or "").strip(),
    }


def run_triage(d):
    if not _run_lock.acquire(blocking=False):
        edit(d["panel_msg_id"], panel_text(d) + "\n\n⏳ Чекаю, зайнято іншим прогоном…")
        _run_lock.acquire()
    started = time.time()
    stop = threading.Event()
    watcher = None
    try:
        rel = write_inbox(d)
        env = dict(os.environ)
        env["IDEAS_SCOUT_INBOX_DIR"] = rel
        env["IDEAS_SCOUT_DRAFT_ID"] = d["id"]
        watcher = threading.Thread(target=progress_watcher, args=(d, stop, started), daemon=True)
        watcher.start()

        proc = subprocess.run(
            [os.path.join(REPO_ROOT, "agents", "scripts", "runner.sh"),
             "--track", d["track"], "--agent", "triage", "--provider", "claude"],
            cwd=REPO_ROOT, env=env, capture_output=True, text=True, timeout=1800,
        )
        rc = proc.returncode
        tail = ((proc.stdout or "") + (proc.stderr or "")).strip().splitlines()[-25:]
        log(f"run_triage rc={rc}\n" + "\n".join(tail))
    except subprocess.TimeoutExpired:
        rc = -1
        log("run_triage: таймаут очікування runner.sh")
    except OSError as e:
        log(f"run_triage: {e}")
        rc = -2
    except db.DbError as e:
        log(f"run_triage: не вдалось записати чернетку в БД (inbox): {e}")
        rc = -3
    finally:
        stop.set()
        if watcher:
            watcher.join(timeout=5)
        _run_lock.release()

    v = read_verdict(d["id"])
    if v:
        head = f"<b>{esc(v.get('card_id', '—'))}</b>"
        if v.get("score"):
            head += f" · {esc(v['score'])}/10"
        if v.get("status"):
            head += f" · {esc(v['status'])}"
        text = panel_text(d) + "\n\n" + head + "\n" + esc(v["body"])
        edit(d["panel_msg_id"], text)
        if d.get("first_msg_id"):
            react(d["first_msg_id"], "👎" if v.get("status", "").startswith("rejected") else "👍")
    else:
        status, err = read_run_status(d["track"])
        why = RUN_FAILURE_HINTS.get(status)
        if not why:
            why = ("Прогін відпрацював, але агент не записав вердикт"
                   if status == "ok" else f"runner.sh: {status or f'код {rc}'}")
        note = f"\n\n❌ {esc(why)}"
        if err:
            note += f"\n<code>{esc(err[:400])}</code>"
        note += "\nМатеріал збережено — натисни, щоб повторити."
        edit(d["panel_msg_id"], panel_text(d) + note,
             [[{"text": "Повторити", "callback_data": "eval"},
               {"text": "Викинути", "callback_data": "drop"}]])

    cur = draft()
    if not cur or cur["id"] != d["id"]:
        return
    if v:
        drop_draft()
    else:
        # Кнопка «Повторити» має що запускати лише поки чернетка жива: інакше
        # обіцянка «матеріал збережено» ламається об «чернетки вже немає».
        # nudged — щоб питання «Оцінювати?» не затерло текст помилки в панелі.
        cur["state"] = "open"
        cur["nudged"] = True
        save_state(STATE)


# ---------------------------------------------------------------------------
# Команди
# ---------------------------------------------------------------------------

COMMANDS = [
    ("new", "закрити чернетку і почати нову"),
    ("cancel", "викинути чернетку"),
    ("status", "що зараз відбувається і що зламано"),
    ("last", "п'ять останніх карток"),
    ("help", "як користуватись ботом"),
]

HELP = """<b>Як цим користуватись</b>

Кидай сюди посилання, думку або скріншот. Нічого не стає ідеєю саме по собі — спершу
збирається <b>чернетка</b>, і лише коли ти тиснеш «Оцінити», агент починає роботу.

<b>Чернетка</b>
Усе, що ти надішлеш протягом 10 хвилин, злипається в один пакет: лінк, коментар до
нього, ще один лінк. Бот тримає одне повідомлення-панель і переписує його на місці —
чат не засмічується. Хочеш почати нову тему раніше — <code>/new</code>.

<b>Кнопки</b>
• <b>Оцінити</b> — запустити агента (3–5 хв)
• <b>Викинути</b> — стерти чернетку
• <b>📱 Апка / 💰 Дохід</b> — трек, за критеріями якого оцінювати. Перемикається до самої оцінки.

<b>Якщо посилання не відкрилось</b>
Бот перевіряє лінк одразу і скаже причину: платна підписка, потрібен вхід, сторінка
порожня без скриптів, сайт блокує роботів. Чернетка при цьому не закривається — скинь
скріншот або скопійований текст, вони приліплюються до неї. Кнопка «Оцінити як є» —
якщо вважаєш, що назви й твого коментаря досить.

<b>Доповнити готову ідею</b>
Відповідай (reply) на повідомлення з вердиктом — бот бачить id картки в ньому.
• <b>Просто дописати</b> — новий матеріал стає ще одним джерелом, оцінка лишається
• <b>Додати й переоцінити</b> — агент перечитує все разом, оцінка може змінитись

<b>Реакції на твої повідомлення</b>
👀 побачив · ✍️ взяв у пакет · 🤔 не зрозумів, що з цим робити ·
👍 ідея прийнята · 👎 відхилена
Прокруткою чату видно, що вижило.

<b>Команди</b>
<code>/new</code> — закрити чернетку і почати нову
<code>/cancel</code> — викинути чернетку
<code>/status</code> — повний звіт <code>doctor.sh</code> з M1: машина й сон, launchd-джоби,
воркер і черга, Supabase, прогони агентів, секрети, webhook, логіни, репозиторій.
✅ норма · 🟡 глянути · 🔴 зламано зараз · ⚪ довідка. Живого виклику до LLM не
робить, щоб не їсти ліміт підписки — для нього є <code>doctor.sh --llm</code> у терміналі
<code>/last</code> — п'ять останніх карток
<code>/help</code> — це повідомлення

<b>Що варто знати</b>
Кожне посилання агент піде відкривати — приватні URL сюди краще не слати. Повний
вердикт завжди лишається карткою в репозиторії; у чат іде витяг."""


def cmd_status():
    # Стан прогонів /status більше не перелічує сам: doctor.sh дивиться на ті самі
    # рядки, але каже, які з них уже протухли. Про чернетку — лише коли вона є:
    # «чернетки немає» щоразу відсувало вниз те, заради чого команду й тиснуть.
    out = []
    d = draft()
    if d and d["state"] == "running":
        out.append(f"✍️ Іде оцінка чернетки {d['id']}.\n")
    elif d:
        n = len(d["fragments"])
        left = max(0, DRAFT_WINDOW_S - (int(time.time()) - d["last_msg_time"])) // 60
        out.append(f"✍️ Відкрита чернетка: {n} фрагмент(ів), трек {TRACKS[d['track']]}, ~{left} хв до питання.\n")
    out.append(run_doctor())
    return "\n".join(out)


def cmd_last():
    try:
        ideas = db.get_recent_ideas(limit=5)
    except db.DbError as e:
        return f"Не вдалось прочитати ideas з БД: {esc(str(e))}"
    if not ideas:
        return "Карток ще немає."
    out = []
    for r in ideas:
        out.append(f"• <b>{esc(r.get('id'))}</b> {esc(r.get('title'))} — {esc(r.get('status'))}")
    return "\n".join(out)


def on_command(cmd, mid):
    if cmd in ("help", "start"):
        send(HELP)
    elif cmd == "status":
        send(cmd_status())
    elif cmd == "last":
        send(cmd_last())
    elif cmd == "cancel":
        d = draft()
        if d and d["state"] == "running":
            send("Оцінка вже йде — скасувати не можу.")
        elif d:
            if d["panel_msg_id"]:
                edit(d["panel_msg_id"], "Чернетку викинуто.")
            drop_draft()
            send("Викинув.")
        else:
            send("Чернетки й так немає.")
    elif cmd == "new":
        d = draft()
        if d and d["state"] == "running":
            send("Зачекай, іде оцінка.")
        else:
            if d and d["panel_msg_id"]:
                edit(d["panel_msg_id"], panel_text(d) + "\n\n(чернетку закрито без оцінки)")
            drop_draft()
            send("Готово — наступне повідомлення почне нову чернетку.")
    else:
        react(mid, "🤔")


# ---------------------------------------------------------------------------
# Одноразова обробка webhook-job
# ---------------------------------------------------------------------------

def nudge_if_idle():
    d = draft()
    if not d or d["state"] != "open" or d["nudged"] or not d["panel_msg_id"]:
        return
    if int(time.time()) - d["last_msg_time"] < NUDGE_AFTER_S:
        return
    d["nudged"] = True
    edit(d["panel_msg_id"], panel_text(d) + "\n\nОцінювати?", panel_buttons(d))
    save_state(STATE)


def recover_interrupted_triage():
    """Після аварії одноразового процесу чернетка не має назавжди лишатись running."""
    d = draft()
    if not d or d["state"] != "running":
        return
    d["state"] = "open"
    if d["panel_msg_id"]:
        edit(d["panel_msg_id"],
             panel_text(d) + "\n\n⚠️ Попередня оцінка урвалась — натисни, щоб повторити.",
             panel_buttons(d))
    save_state(STATE)


def process_update(upd):
    if not isinstance(upd, dict) or not isinstance(upd.get("update_id"), int):
        raise ValueError("очікував Telegram update з цілим update_id")

    if "message" in upd:
        msg = upd["message"]
        if str(msg.get("chat", {}).get("id")) == CHAT_ID:
            on_message(msg)
    elif "callback_query" in upd:
        cb = upd["callback_query"]
        if str(cb.get("message", {}).get("chat", {}).get("id")) == CHAT_ID:
            on_callback(cb)


def main():
    os.makedirs(STATE_DIR, exist_ok=True)
    os.makedirs(os.path.join(REPO_ROOT, "logs", "triage"), exist_ok=True)
    recover_interrupted_triage()

    mode = sys.argv[1] if len(sys.argv) == 2 else ""
    if mode == "--nudge":
        nudge_if_idle()
        log("telegram-bot: перевірку нагадування завершено")
        return
    if mode != "--process-update":
        sys.exit("Використання: telegram-bot.py --process-update | --nudge")

    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        raise ValueError(f"job payload не є валідним JSON: {e}") from e
    if not isinstance(payload, dict) or "update" not in payload:
        raise ValueError("у job payload немає поля update")
    process_update(payload["update"])
    log(f"telegram-bot: update {payload['update']['update_id']} оброблено")


if __name__ == "__main__":
    main()
