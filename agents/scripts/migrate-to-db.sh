#!/usr/bin/env bash
# migrate-to-db.sh — РАЗОВИЙ скрипт: переносить дані з Git (Markdown/JSON) у Supabase.
#
#   registries/*/ideas/*.md   -> ideas (+ sources, + events із "## Історія рішень")
#   logs/runs/*.md             -> runs (один рядок на файл прогону; вільний текст -> meta)
#   logs/status/*.json         -> runs (те саме; monitor.json — job=monitor, синтетичний run_id)
#   inbox/*/idea.md + logs/triage/*.md -> inbox (об'єднано за draft_id)
#
# Ідемпотентний: ideas/runs/inbox — upsert за первинним ключем (on_conflict через
# db.sh upsert); sources/events для ідеї спершу видаляються й переписуються заново
# (у них немає природного унікального ключа — ці таблиці за задумом повністю
# похідні від файлу на кожен прогін міграції), тож повторний запуск не плодить дублів.
#
# Провайдер нормалізується: 'anthropic' -> 'claude' (розбіжність зафіксована в
# shared/contracts.md).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT" || exit 2

# shellcheck source=agents/scripts/db.sh
source "$SCRIPT_DIR/db.sh"

PARSE_PY="$(mktemp "${TMPDIR:-/tmp}/migrate-parse.XXXXXX.py")"
trap 'rm -f "$PARSE_PY"' EXIT

cat > "$PARSE_PY" <<'PYEOF'
import json
import re
import sys
import os
from datetime import datetime, timezone

def unquote(s):
    s = s.strip()
    if len(s) >= 2 and s[0] == '"' and s.rfind('"') > 0:
        return s[1:s.rfind('"')]
    return s

def parse_scalar(rest):
    rest = rest.strip()
    if rest == "":
        return None
    if rest.startswith('"'):
        end = rest.rfind('"')
        if end > 0:
            return rest[1:end]
        return rest.strip('"')
    if rest.startswith('['):
        end = rest.find(']')
        inner = rest[1:end] if end != -1 else ""
        if not inner.strip():
            return []
        return [unquote(x.strip()) for x in inner.split(',') if x.strip()]
    val = re.sub(r'\s+#.*$', '', rest).strip()
    if val in ("null", "~", ""):
        return None
    try:
        return int(val)
    except ValueError:
        pass
    try:
        return float(val)
    except ValueError:
        pass
    return val

def parse_kv_into(d, s):
    key, _, val = s.partition(":")
    d[key.strip()] = parse_scalar(val.strip())

def parse_frontmatter(lines):
    result = {}
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        if line.strip() == "" or (line.startswith((" ", "\t")) and line.strip().startswith("#")):
            i += 1
            continue
        if line.startswith((" ", "\t")):
            i += 1
            continue
        if ":" not in line:
            i += 1
            continue
        key, _, rest = line.partition(":")
        key = key.strip()
        rest = rest.strip()
        if key == "sources":
            sources = []
            i += 1
            cur = None
            while i < n and lines[i].startswith("  "):
                l = lines[i]
                stripped = l.strip()
                if stripped.startswith("- "):
                    if cur is not None:
                        sources.append(cur)
                    cur = {}
                    parse_kv_into(cur, stripped[2:])
                elif stripped and cur is not None:
                    parse_kv_into(cur, stripped)
                i += 1
            if cur is not None:
                sources.append(cur)
            result["sources"] = sources
            continue
        if key == "verdict_by":
            vb = {}
            i += 1
            while i < n and lines[i].startswith("  "):
                stripped = lines[i].strip()
                if stripped:
                    parse_kv_into(vb, stripped)
                i += 1
            result["verdict_by"] = vb
            continue
        if key == "missing_capabilities" and rest == "":
            items = []
            i += 1
            while i < n and lines[i].startswith("  -"):
                items.append(unquote(lines[i].strip()[1:].strip()))
                i += 1
            result[key] = items
            continue
        result[key] = parse_scalar(rest)
        i += 1
    return result

EVENT_RE = re.compile(
    r'^-\s*(\d{4}-\d{2}-\d{2})\s*—\s*([^(—]+?)\s*\(run_id:\s*([^)]+)\)\s*—\s*(.*)$'
)
EVENT_RE_NO_RUN = re.compile(r'^-\s*(\d{4}-\d{2}-\d{2})\s*—\s*([^—]+?)\s*—\s*(.*)$')

def parse_events(section_text):
    events = []
    for raw_line in section_text.splitlines():
        line = raw_line.strip()
        if not line.startswith("-"):
            continue
        m = EVENT_RE.match(line)
        if m:
            date, actor, run_id, change = m.groups()
            events.append({
                "happened_at": date + "T00:00:00Z",
                "actor": actor.strip(),
                "run_id": run_id.strip(),
                "change": change.strip(),
                "reason": None,
            })
            continue
        m = EVENT_RE_NO_RUN.match(line)
        if m:
            date, actor, change = m.groups()
            events.append({
                "happened_at": date + "T00:00:00Z",
                "actor": actor.strip(),
                "run_id": None,
                "change": change.strip(),
                "reason": None,
            })
            continue
        # Рядок не парсується форматом "- дата — актор (run_id: ...) — що" —
        # один event із сирим текстом, як вимагає завдання міграції.
        events.append({
            "happened_at": None,
            "actor": "migration",
            "run_id": None,
            "change": line.lstrip("- ").strip(),
            "reason": "рядок історії рішень не розпізнано форматом дата/актор/run_id — збережено як є",
        })
    return events

def normalize_provider(p):
    if p == "anthropic":
        return "claude"
    return p

def parse_idea_file(path, track):
    with open(path, encoding="utf-8") as f:
        text = f.read()
    parts = text.split("---\n", 2)
    # text починається з "---\n", тому parts = ["", frontmatter, body]
    if not text.startswith("---"):
        raise ValueError(f"{path}: немає frontmatter")
    fm_text, _, body = text.partition("---\n")[2].partition("\n---\n")
    fm = parse_frontmatter(fm_text.splitlines())

    history_marker = "## Історія рішень"
    if history_marker in body:
        body_wo_history, _, history_text = body.partition(history_marker)
    else:
        body_wo_history, history_text = body, ""
    events = parse_events(history_text)

    vb = fm.get("verdict_by") or {}
    idea = {
        "id": fm.get("id"),
        "track": track,
        "parent_id": fm.get("parent_id"),
        "title": fm.get("title"),
        "type": fm.get("type"),
        "discovered": fm.get("discovered"),
        "signal_type": fm.get("signal_type"),
        "monetization_hypothesis": fm.get("monetization_hypothesis"),
        "mentions_count": fm.get("mentions_count", 1),
        "claimed_revenue": fm.get("claimed_revenue"),
        "mechanic_summary": fm.get("mechanic_summary"),
        "status": fm.get("status"),
        "rejection_code": fm.get("rejection_code"),
        "rejection_detail": fm.get("rejection_detail"),
        "rejection_codes_extra": fm.get("rejection_codes_extra") or [],
        "missing_capabilities": fm.get("missing_capabilities") or [],
        "ceiling_estimate": fm.get("ceiling_estimate"),
        "launch_effort_hours": fm.get("launch_effort_hours"),
        "ceiling_flag": fm.get("ceiling_flag"),
        "review_condition": fm.get("review_condition"),
        "review_count": fm.get("review_count", 0),
        "last_reviewed": fm.get("last_reviewed"),
        "min_review_interval_days": fm.get("min_review_interval_days", 30),
        "confidence": fm.get("confidence"),
        "transferred_to": fm.get("transferred_to"),
        "verdict_provider": normalize_provider(vb.get("provider")),
        "verdict_model": vb.get("model"),
        "verdict_run_id": vb.get("run_id"),
        "schema_version": fm.get("schema_version", 3),
        "criteria_version": fm.get("criteria_version"),
        "body": body_wo_history.strip() + "\n",
    }
    sources = []
    for s in fm.get("sources") or []:
        sources.append({
            "url": s.get("url"),
            "origin": s.get("origin"),
            "published_date": s.get("date"),
            "author_interest": s.get("author_interest"),
            "independent_confirmations": s.get("independent_confirmations", 0),
            "quote": s.get("quote"),
        })
    return {"idea": idea, "sources": sources, "events": events}


def parse_run_md(path):
    with open(path, encoding="utf-8") as f:
        text = f.read()
    run_id = os.path.splitext(os.path.basename(path))[0]
    if "-collector" in run_id or run_id.endswith("collector"):
        job = "collector"
    elif "-analyst" in run_id or run_id.endswith("analyst"):
        job = "analyst"
    elif "-revisor" in run_id or run_id.endswith("revisor"):
        job = "revisor"
    elif "-triage" in run_id or run_id.endswith("triage"):
        job = "triage"
    elif "automation-test" in run_id or "lang-platform-test" in run_id:
        job = "collector"  # прогони калібрування патернів пошуку — та сама функція, що й збирач
    else:
        job = "manual"

    m = re.search(r'Трек:\s*(\S+)', text)
    track = m.group(1) if m else None
    if track not in ("passive-income", "app-ideas"):
        track = "passive-income" if "passive-income" in text else (
            "app-ideas" if "app-ideas" in text else None)

    provider = "claude"
    mprov = re.search(r'(Провайдер/модель|Модель):\s*([a-zA-Z0-9_.\-]+)', text)
    if mprov:
        candidate = mprov.group(2).strip().lower()
        if "claude" not in candidate and "anthropic" not in candidate and "opus" not in candidate:
            provider = candidate
    provider = normalize_provider(provider)

    m = re.match(r'^(\d{8})-(\d{6})-', run_id)
    if m:
        started_at = f"{m.group(1)[0:4]}-{m.group(1)[4:6]}-{m.group(1)[6:8]}T{m.group(2)[0:2]}:{m.group(2)[2:4]}:{m.group(2)[4:6]}Z"
    else:
        md = re.search(r'Run date:\s*(\d{4}-\d{2}-\d{2})', text)
        started_at = (md.group(1) + "T00:00:00Z") if md else datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    urls = sorted(set(re.findall(r'https?://[^\s\)\]\"\'>]+', text)))

    return {
        "run_id": run_id,
        "job": job,
        "track": track,
        "provider": provider,
        "started_at": started_at,
        "finished_at": None,
        "status": "ok",
        "errors": [],
        "token_usage": {},
        "processed_urls": urls,
        "notes": None,
        "meta": {"source_file": os.path.relpath(path, REPO_ROOT), "content": text},
    }


def parse_status_json(path):
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    base_name = os.path.splitext(os.path.basename(path))[0]
    if "run_id" in d and d["run_id"]:
        run_id = d["run_id"]
        job = d.get("agent") or base_name
        track = d.get("track")
        provider = normalize_provider(d.get("provider"))
        started_at = d.get("started_at")
        finished_at = d.get("finished_at")
        status = d.get("status")
    else:
        # monitor.json — немає run_id/agent, синтезуємо стабільний ключ з checked_at.
        checked_at = d.get("checked_at") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        run_id = "monitor-" + re.sub(r'[^0-9T]', '', checked_at)
        job = "monitor"
        track = None
        provider = None
        started_at = checked_at
        finished_at = checked_at
        status = d.get("status")
    meta = {k: v for k, v in d.items() if k not in ("run_id", "agent", "track", "provider", "started_at", "finished_at", "status")}
    meta["source_file"] = os.path.relpath(path, REPO_ROOT)
    return {
        "run_id": run_id,
        "job": job,
        "track": track,
        "provider": provider,
        "started_at": started_at,
        "finished_at": finished_at,
        "status": status,
        "errors": [],
        "token_usage": {},
        "processed_urls": [],
        "notes": None,
        "meta": meta,
    }


def parse_inbox(repo_root):
    inbox_dir = os.path.join(repo_root, "inbox")
    triage_dir = os.path.join(repo_root, "logs", "triage")
    rows = {}
    if os.path.isdir(inbox_dir):
        for name in sorted(os.listdir(inbox_dir)):
            box = os.path.join(inbox_dir, name)
            idea_path = os.path.join(box, "idea.md")
            if not os.path.isfile(idea_path):
                continue
            with open(idea_path, encoding="utf-8") as f:
                text = f.read()
            fm_text, _, body = text.partition("---\n")[2].partition("\n---\n")
            fm = {}
            for line in fm_text.splitlines():
                if ":" in line:
                    parse_kv_into(fm, line)
            draft_id = str(fm.get("draft_id") or name.split("-")[0])
            m = re.search(r'## Коментар власника\n(.*?)(?:\n## |\Z)', body, re.S)
            raw_text = (m.group(1).strip() if m else body.strip())
            target_card = fm.get("target_card")
            if target_card in (None, "null", ""):
                target_card = None
            rows[draft_id] = {
                "draft_id": draft_id,
                "submitted_at": fm.get("received_at"),
                "raw_text": raw_text,
                "source": fm.get("source") or "telegram",
                "track": fm.get("track"),
                "mode": fm.get("mode"),
                "target_card_id": target_card,
                "triage_status": None,
                "triage_verdict": None,
                "triage_score": None,
                "idea_id": None,
            }
    if os.path.isdir(triage_dir):
        for name in sorted(os.listdir(triage_dir)):
            if not name.endswith(".md"):
                continue
            draft_id = name[:-3]
            path = os.path.join(triage_dir, name)
            with open(path, encoding="utf-8") as f:
                text = f.read()
            fm_text, _, body = text.partition("---\n")[2].partition("\n---\n")
            fm = {}
            for line in fm_text.splitlines():
                if ":" in line:
                    parse_kv_into(fm, line)
            row = rows.get(draft_id)
            if row is None:
                row = {
                    "draft_id": draft_id, "submitted_at": None, "raw_text": "(вхідний inbox/-файл не знайдено, лише вердикт тріажу)",
                    "source": "telegram", "track": None, "mode": None, "target_card_id": None,
                    "triage_status": None, "triage_verdict": None, "triage_score": None, "idea_id": None,
                }
                rows[draft_id] = row
            row["triage_status"] = fm.get("status")
            row["triage_score"] = fm.get("score")
            row["idea_id"] = fm.get("card_id")
            row["triage_verdict"] = body.strip()
    return list(rows.values())


def main():
    global REPO_ROOT
    REPO_ROOT = sys.argv[1]
    out = {"ideas": [], "runs": [], "inbox": []}

    registries_dir = os.path.join(REPO_ROOT, "registries")
    for track in sorted(os.listdir(registries_dir)) if os.path.isdir(registries_dir) else []:
        ideas_dir = os.path.join(registries_dir, track, "ideas")
        if not os.path.isdir(ideas_dir):
            continue
        for name in sorted(os.listdir(ideas_dir)):
            if not name.endswith(".md"):
                continue
            out["ideas"].append(parse_idea_file(os.path.join(ideas_dir, name), track))

    runs_dir = os.path.join(REPO_ROOT, "logs", "runs")
    if os.path.isdir(runs_dir):
        for name in sorted(os.listdir(runs_dir)):
            if name.endswith(".md"):
                out["runs"].append(parse_run_md(os.path.join(runs_dir, name)))

    status_dir = os.path.join(REPO_ROOT, "logs", "status")
    if os.path.isdir(status_dir):
        for name in sorted(os.listdir(status_dir)):
            if name.endswith(".json"):
                out["runs"].append(parse_status_json(os.path.join(status_dir, name)))

    out["inbox"] = parse_inbox(REPO_ROOT)

    # ideas.verdict_run_id і events.run_id мають NOT VALID... насправді FK на runs(run_id):
    # деякі run_id, згадані в записах реєстру (ранні ручні прогони 2026-07-15, тріаж без
    # окремого logs/runs/*.md), не мають власного файлу логу. Без рядка-заглушки в runs
    # FK-обмеження заблокує міграцію ideas/events. Синтезуємо мінімальний рядок runs —
    # чесно позначений у meta як реконструйований, а не як фактичний лог прогону.
    known_run_ids = {r["run_id"] for r in out["runs"]}
    referenced = set()
    for rec in out["ideas"]:
        vrid = rec["idea"].get("verdict_run_id")
        if vrid:
            referenced.add(vrid)
        for ev in rec["events"]:
            if ev.get("run_id"):
                referenced.add(ev["run_id"])
    for run_id in sorted(referenced - known_run_ids):
        m = re.match(r'^(\d{8})-(\d{6})-', run_id)
        if m:
            started_at = f"{m.group(1)[0:4]}-{m.group(1)[4:6]}-{m.group(1)[6:8]}T{m.group(2)[0:2]}:{m.group(2)[2:4]}:{m.group(2)[4:6]}Z"
        else:
            m2 = re.match(r'^manual-(\d{4})(\d{2})(\d{2})-', run_id)
            started_at = f"{m2.group(1)}-{m2.group(2)}-{m2.group(3)}T00:00:00Z" if m2 else None
        if "triage" in run_id:
            job = "triage"
        elif "analyst" in run_id or "criteria" in run_id:
            job = "analyst"
        elif "collector" in run_id:
            job = "collector"
        elif "revisor" in run_id:
            job = "revisor"
        else:
            job = "manual"
        out["runs"].append({
            "run_id": run_id,
            "job": job,
            "track": "passive-income",
            "provider": "claude",
            "started_at": started_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "finished_at": None,
            "status": "ok",
            "errors": [],
            "token_usage": {},
            "processed_urls": [],
            "notes": None,
            "meta": {
                "reconstructed": True,
                "note": ("Синтетичний рядок: run_id згадується в ideas.verdict_run_id/events.run_id, "
                          "але власного файлу логу прогону (logs/runs/*.md) не існує в репозиторії — "
                          "рядок відновлено міграцією лише щоб задовольнити зовнішній ключ."),
            },
        })

    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
PYEOF

echo "migrate-to-db.sh: парсинг файлів репозиторію…"
PARSED_JSON="$(mktemp "${TMPDIR:-/tmp}/migrate-parsed.XXXXXX.json")"
trap 'rm -f "$PARSE_PY" "$PARSED_JSON"' EXIT
python3 "$PARSE_PY" "$REPO_ROOT" > "$PARSED_JSON" || { echo "migrate-to-db.sh: парсинг провалився" >&2; exit 1; }

N_IDEAS=$(jq '.ideas | length' "$PARSED_JSON")
N_RUNS=$(jq '.runs | length' "$PARSED_JSON")
N_INBOX=$(jq '.inbox | length' "$PARSED_JSON")
echo "migrate-to-db.sh: розпізнано ideas=$N_IDEAS runs=$N_RUNS inbox=$N_INBOX"

FAIL=0

# Порядок обов'язковий через зовнішні ключі: runs (на неї посилається
# ideas.verdict_run_id) -> ideas (на неї посилається inbox.idea_id) -> inbox.

echo "migrate-to-db.sh: --- runs ---"
jq -c '.runs[]' "$PARSED_JSON" | while IFS= read -r rec; do
  run_id="$(echo "$rec" | jq -r '.run_id')"
  echo "  upsert run $run_id"
  if ! ./agents/scripts/db.sh upsert runs run_id "$rec" >/dev/null; then
    echo "migrate-to-db.sh: ПОМИЛКА upsert run $run_id" >&2
    exit 1
  fi
done || FAIL=1

echo "migrate-to-db.sh: --- ideas + sources + events ---"
jq -c '.ideas[]' "$PARSED_JSON" | while IFS= read -r rec; do
  idea_id="$(echo "$rec" | jq -r '.idea.id')"
  idea_json="$(echo "$rec" | jq -c '.idea')"
  echo "  upsert idea $idea_id"
  if ! ./agents/scripts/db.sh upsert-idea "$idea_json" >/dev/null; then
    echo "migrate-to-db.sh: ПОМИЛКА upsert idea $idea_id" >&2
    exit 1
  fi

  # Ідемпотентність: sources/events цієї ідеї повністю похідні від файлу —
  # спершу очистити, потім переписати заново.
  ./agents/scripts/db.sh delete "/sources?idea_id=eq.$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$idea_id")" >/dev/null || true
  ./agents/scripts/db.sh delete "/events?idea_id=eq.$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$idea_id")" >/dev/null || true

  echo "$rec" | jq -c '.sources[]?' | while IFS= read -r src; do
    if ! ./agents/scripts/db.sh insert-source "$idea_id" "$src" >/dev/null; then
      echo "migrate-to-db.sh: ПОМИЛКА insert-source для $idea_id" >&2
      exit 1
    fi
  done || exit 1

  echo "$rec" | jq -c '.events[]?' | while IFS= read -r ev; do
    if ! ./agents/scripts/db.sh insert-event "$idea_id" "$(echo "$ev" | jq -r '.actor')" "$(echo "$ev" | jq -r '.change')" "$(echo "$ev" | jq -r '.reason // ""')" "$(echo "$ev" | jq -r '.run_id // ""')" >/dev/null; then
      echo "migrate-to-db.sh: ПОМИЛКА insert-event для $idea_id" >&2
      exit 1
    fi
  done || exit 1
done || FAIL=1

echo "migrate-to-db.sh: --- inbox ---"
jq -c '.inbox[]' "$PARSED_JSON" | while IFS= read -r rec; do
  draft_id="$(echo "$rec" | jq -r '.draft_id')"
  echo "  upsert inbox $draft_id"
  if ! ./agents/scripts/db.sh upsert inbox draft_id "$rec" >/dev/null; then
    echo "migrate-to-db.sh: ПОМИЛКА upsert inbox $draft_id" >&2
    exit 1
  fi
done || FAIL=1

if [ "$FAIL" != "0" ]; then
  echo "migrate-to-db.sh: завершено з помилками" >&2
  exit 1
fi

echo "migrate-to-db.sh: готово. ideas=$N_IDEAS runs=$N_RUNS inbox=$N_INBOX"
