"""db.py — доступ до Supabase (Postgres) через PostgREST для telegram-bot.py.

Маленький python-аналог db.sh (той — для bash-скриптів runner.sh/monitor.sh,
цей — для telegram-bot.py, щоб не гонити shell-виклики з довгоживучого
python-процесу бота). Той самий набір операцій: inbox (ручні ідеї й вердикти
тріажу) та читання ideas/runs для команд /status, /last.

Помилки не мовчазні: будь-яка не-2xx відповідь або мережева помилка кидає
DbError з повідомленням, що містить метод/шлях/код/тіло відповіді.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ENV_FILE = os.environ.get(
    "IDEAS_SCOUT_ENV_FILE", os.path.expanduser("~/.config/ideas-scout/env")
)


class DbError(RuntimeError):
    pass


_env_cache: dict | None = None


def _load_env() -> dict:
    global _env_cache
    if _env_cache is not None:
        return _env_cache
    env = {}
    if os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_KEY"):
        env["SUPABASE_URL"] = os.environ["SUPABASE_URL"]
        env["SUPABASE_SERVICE_KEY"] = os.environ["SUPABASE_SERVICE_KEY"]
        _env_cache = env
        return env
    if not os.path.isfile(ENV_FILE):
        raise DbError(f"env-файл не знайдено: {ENV_FILE} (потрібні SUPABASE_URL, SUPABASE_SERVICE_KEY)")
    with open(ENV_FILE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip().strip('"').strip("'")
    if "SUPABASE_URL" not in env or "SUPABASE_SERVICE_KEY" not in env:
        raise DbError(f"SUPABASE_URL/SUPABASE_SERVICE_KEY відсутні у {ENV_FILE}")
    _env_cache = env
    return env


def _align_bulk(rows: list) -> list:
    """Однаковий набір ключів у всіх рядках пакета — вимога PostgREST.

    Пакетний POST з різними наборами ключів відхиляється цілком: HTTP 400,
    PGRST102 "All object keys must match". Санітизатори складають рядки з
    полів, які модель могла й не заповнити, тож набір ключів залежить від
    відповіді моделі — пакет ламається не завжди, а лише на певних даних, і
    завжди в кінці прогону, після години роботи моделей.

    Вирівнювання живе тут, на межі з базою, а не у викликах: обмеження
    належить транспорту, і новий пакетний POST отримує його задарма, замість
    покладатись на те, що про нього не забудуть. Відсутні ключі доливаються
    як None — нової поломки це не створює: рядок без NOT NULL-колонки впав би
    й без вирівнювання.
    """
    if len(rows) < 2 or not all(isinstance(row, dict) for row in rows):
        return rows
    keys = {key for row in rows for key in row}
    if all(len(row) == len(keys) for row in rows):
        return rows
    return [{key: row.get(key) for key in keys} for row in rows]


def _request(method: str, path: str, body=None, timeout: float = 20.0):
    env = _load_env()
    url = env["SUPABASE_URL"].rstrip("/") + "/rest/v1" + path
    headers = {
        "apikey": env["SUPABASE_SERVICE_KEY"],
        "Authorization": f"Bearer {env['SUPABASE_SERVICE_KEY']}",
        "Content-Type": "application/json",
    }
    if method in ("POST", "PATCH"):
        headers["Prefer"] = "return=representation"
    data = None
    if body is not None:
        if isinstance(body, list):
            body = _align_bulk(body)
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        raise DbError(f"PostgREST {method} {path} -> HTTP {e.code}: {raw}") from None
    except urllib.error.URLError as e:
        raise DbError(f"мережева помилка {method} {path}: {e}") from None


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# inbox
# ---------------------------------------------------------------------------

def insert_inbox(draft_id: str, submitted_at: str, raw_text: str, source: str = "telegram",
                  track: str | None = None, mode: str | None = None,
                  target_card_id: str | None = None) -> dict:
    payload = {
        "draft_id": draft_id,
        "submitted_at": submitted_at,
        "raw_text": raw_text,
        "source": source,
    }
    if track:
        payload["track"] = track
    if mode:
        payload["mode"] = mode
    if target_card_id:
        payload["target_card_id"] = target_card_id
    rows = _request("POST", "/inbox", payload)
    return rows[0] if rows else {}


def update_inbox(draft_id: str, **fields) -> dict:
    fields = {k: v for k, v in fields.items() if v is not None}
    if not fields:
        return {}
    rows = _request("PATCH", f"/inbox?draft_id=eq.{urllib.parse.quote(draft_id, safe='')}", fields)
    return rows[0] if rows else {}


def get_inbox(draft_id: str) -> dict | None:
    rows = _request("GET", f"/inbox?draft_id=eq.{urllib.parse.quote(draft_id, safe='')}&select=*")
    return rows[0] if rows else None


# ---------------------------------------------------------------------------
# ideas / runs (читання для /status, /last)
# ---------------------------------------------------------------------------

def get_recent_ideas(limit: int = 5) -> list[dict]:
    return _request(
        "GET",
        f"/ideas?select=id,title,status,track,updated_at&order=updated_at.desc&limit={int(limit)}",
    ) or []


def get_ideas_created_since(since_iso: str) -> list[dict]:
    """Картки, заведені після since_iso — саме «нові знахідки» для дайджесту.

    Фільтр по created_at, а не updated_at: правка статусу старої картки новою
    знахідкою не є, а раніше потрапляла в те саме число.
    """
    q = (
        "select=id,title,status,track,created_at"
        f"&created_at=gte.{urllib.parse.quote(since_iso, safe='')}"
        "&order=track.asc,created_at.desc"
    )
    return _request("GET", f"/ideas?{q}") or []


def count_ideas_updated_since(since_iso: str) -> int:
    """Скільки вже наявних карток лише змінились (без новостворених)."""
    q = (
        "select=id"
        f"&updated_at=gte.{urllib.parse.quote(since_iso, safe='')}"
        f"&created_at=lt.{urllib.parse.quote(since_iso, safe='')}"
    )
    return len(_request("GET", f"/ideas?{q}") or [])


def get_last_runs(limit: int = 20) -> list[dict]:
    return _request(
        "GET",
        f"/runs?select=run_id,job,track,status,finished_at&order=started_at.desc&limit={int(limit)}",
    ) or []


def get_last_run(job: str, track: str | None = None) -> dict | None:
    q = f"select=*&job=eq.{urllib.parse.quote(job, safe='')}"
    if track:
        q += f"&track=eq.{urllib.parse.quote(track, safe='')}"
    q += "&order=started_at.desc&limit=1"
    rows = _request("GET", f"/runs?{q}")
    return rows[0] if rows else None
