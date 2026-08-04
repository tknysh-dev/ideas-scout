#!/usr/bin/env python3
"""deep-research.py — синтез глибокого дослідження ідеї.

Запускається воркером через deep-research.sh (stdin: {"idea_id": "PI-0013"})
як job deep_research_synthesis.

Дослідників цей скрипт більше не запускає: автоматичний мульти-CLI конвеєр
виявився неживучим (повноцінний веб-пошук з CLI має лише codex), тому звіти
зовнішніх моделей власник збирає руками в браузерних deep-research UI за
промптом agents/prompts/deep-research-handoff.md і вставляє їх на порталі.
Дашборд кладе вербатим-звіти в research_reports (stage=deep_criteria,
kind=model) і ставить у чергу job deep_research_synthesis.

Стадія synthesis читає ці звіти з БД, доповнює їх власним дослідженням Claude
по d_-блоках і зводить усе в структуровані вердикти (criteria_verdicts),
конкурентів (competitors) і перезапис полів вердикту картки ideas. Наповнення
стадії — фаза 4 плану docs/plans/deep-research-handoff.md; поки що вона лише
перевіряє, що вхідні звіти на місці.

Уся недовірена творчість моделей проходить через санітизацію: у БД потрапляють
лише значення з білих списків (вердикти, ключі критеріїв, коди відхилення),
довільний текст — лише в текстові поля. Статусні переходи вирішує цей скрипт,
не модель.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.parse
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))
sys.path.insert(0, SCRIPT_DIR)

import db  # noqa: E402  (agents/scripts/db.py — той самий PostgREST-шар, що в telegram-bot.py)

LLM_INVOKE = os.path.join(SCRIPT_DIR, "llm-invoke.sh")

DEEP_KEYS = ["d_demand", "d_unit_econ", "d_channels", "d_graveyard", "d_dependencies", "d_mvp", "d_legal"]
BASE_KEYS_BY_TRACK = {
    "passive-income": [str(n) for n in range(7)],   # 0..6
    "app-ideas": [str(n) for n in range(8)],        # 0..7
}
# Ім'я файлу чек-листа не виводиться з назви треку: трек `app-ideas` лежить у
# criteria-apps.md.
CRITERIA_DOC_BY_TRACK = {
    "passive-income": "agents/criteria/criteria-passive-income.md",
    "app-ideas": "agents/criteria/criteria-apps.md",
}
FATAL_KEYS = {str(n) for n in range(6)}             # 0..5 фатальні в обох треках
VERDICTS = {"passed", "failed", "owner", "skipped", "not_applicable", "noted"}
RESOLUTIONS = {"consensus", "evidence", "cross_exam", "pessimistic_default"}
REJECTION_CODES = {
    "NO_MONETIZATION", "SOURCE_SUSPECT", "LEGAL", "CAPABILITY_GAP",
    "CAPITAL", "AUTONOMY", "SATURATED", "NO_MARKET",
}
# Первинний код, якщо синтез не дав валідного: за першим проваленим фатальним критерієм.
CODE_BY_CRITERION = {
    "passive-income": {"0": "NO_MONETIZATION", "1": "SOURCE_SUSPECT", "2": "LEGAL",
                        "3": "CAPABILITY_GAP", "4": "AUTONOMY", "5": "SATURATED"},
    "app-ideas": {"0": "NO_MONETIZATION", "1": "SOURCE_SUSPECT", "2": "LEGAL",
                   "3": "CAPABILITY_GAP", "4": "NO_MARKET", "5": "SATURATED"},
}
OWNER_DECIDABLE = {"approved_pending", "accepted", "rejected"}

LIVENESS = {"active", "stale", "dead"}

SYNTHESIS_TIMEOUT_S = int(os.environ.get("IDEAS_SCOUT_SYNTHESIS_TIMEOUT_S", "1800"))


def log(message: str) -> None:
    print(f"deep-research: {message}", flush=True)


def read_idea_id() -> str:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, OSError) as error:
        raise SystemExit(f"deep-research: payload не є валідним JSON: {error}")
    idea_id = payload.get("idea_id") if isinstance(payload, dict) else None
    if not isinstance(idea_id, str) or not re.fullmatch(r"[A-Z]{2,10}-[0-9]{3,8}", idea_id):
        raise SystemExit("deep-research: некоректний або відсутній idea_id")
    return idea_id


def read_file(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


def criteria_version_of(doc: str) -> str | None:
    match = re.search(r"^Версія:\s*(\S+)", doc, re.MULTILINE)
    return match.group(1) if match else None


def section_bounds(body: str, title: str) -> tuple[int, int] | None:
    """(start, end) розділу `## <title>` включно із заголовком, або None."""
    match = re.search(rf"^##\s+{re.escape(title)}\s*$", body, re.MULTILINE)
    if not match:
        return None
    after = match.end()
    next_heading = re.search(r"^##\s+", body[after:], re.MULTILINE)
    end = after + next_heading.start() if next_heading else len(body)
    return match.start(), end


def split_section(body: str | None, title: str) -> tuple[str | None, str]:
    """(вміст розділу, решта тіла) — та сама логіка, що в
    dashboard/src/lib/criteria.ts::splitCriteriaSection."""
    if not body:
        return None, ""
    bounds = section_bounds(body, title)
    if not bounds:
        return None, body
    start, end = bounds
    heading_end = body.index("\n", start) + 1 if "\n" in body[start:end] else end
    return body[heading_end:end].strip(), (body[:start] + "\n\n" + body[end:]).strip()


def replace_section(body: str | None, title: str, new_section: str) -> str:
    block = f"## {title}\n\n" + new_section.strip()
    bounds = section_bounds(body, title) if body else None
    if not bounds:
        return ((body or "").strip() + "\n\n" + block).strip()
    start, end = bounds
    return (body[:start] + block + "\n\n" + body[end:]).strip()


def extract_json_block(text: str) -> dict | None:
    """Останній fenced ```json блок відповіді моделі."""
    blocks = re.findall(r"```json\s*\n(.*?)```", text, re.DOTALL)
    for raw in reversed(blocks):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def sanitize_evidence(raw) -> list[dict]:
    result = []
    if not isinstance(raw, list):
        return result
    for item in raw[:20]:
        if not isinstance(item, dict) or not isinstance(item.get("url"), str):
            continue
        entry = {"url": item["url"][:2000]}
        date = item.get("published_date")
        if isinstance(date, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
            entry["published_date"] = date
        quote = item.get("quote")
        if isinstance(quote, str):
            entry["quote"] = quote[:1000]
        result.append(entry)
    return result


def sanitize_criteria(raw, allowed_keys: set[str], *, require_resolution: bool) -> dict[str, dict]:
    """{criterion_key: рядок для criteria_verdicts} — лише білі списки значень."""
    rows: dict[str, dict] = {}
    if not isinstance(raw, list):
        return rows
    for item in raw:
        if not isinstance(item, dict):
            continue
        key = item.get("criterion_key")
        verdict = item.get("verdict")
        if key not in allowed_keys or verdict not in VERDICTS:
            continue
        row = {
            "criterion_key": key,
            "verdict": verdict,
            "score": item["score"][:100] if isinstance(item.get("score"), str) else None,
            "summary": item["summary"][:500] if isinstance(item.get("summary"), str) else None,
            "detail": item["detail"][:5000] if isinstance(item.get("detail"), str) else None,
            "evidence": sanitize_evidence(item.get("evidence")),
        }
        if require_resolution:
            resolution = item.get("resolution")
            row["resolution"] = resolution if resolution in RESOLUTIONS else None
        rows[key] = row
    return rows


def run_llm(provider: str, prompt: str, timeout_s: int) -> tuple[int, str]:
    """(exit_code, stdout+stderr) виклику llm-invoke.sh run <provider>."""
    try:
        proc = subprocess.run(
            [LLM_INVOKE, "run", provider, "--timeout", str(timeout_s)],
            input=prompt, capture_output=True, text=True,
            timeout=timeout_s + 120,
        )
        output = proc.stdout + (("\n[stderr]\n" + proc.stderr) if proc.stderr.strip() else "")
        return proc.returncode, output
    except subprocess.TimeoutExpired:
        return 124, f"[оркестратор] {provider} перевищив жорсткий таймаут {timeout_s + 120}с"
    except OSError as error:
        return 127, f"[оркестратор] не вдалося запустити llm-invoke.sh: {error}"


def build_idea_context(idea: dict, sources: list[dict]) -> str:
    """Контекст для дослідника: механіка й факти БЕЗ початкового аналізу за
    критеріями — щоб не заякорювати незалежну оцінку."""
    _, body_rest = split_section(idea.get("body"), "Аналіз за критеріями")
    lines = [
        f"- id: {idea['id']}, назва: {idea.get('title')}",
        f"- тип: {idea.get('type')}, трек: {idea.get('track')}",
        f"- signal_type: {idea.get('signal_type')}",
        f"- заявлений дохід: {idea.get('claimed_revenue') or 'не заявлено'}",
        f"- суть механіки: {idea.get('mechanic_summary') or '—'}",
        f"- гіпотеза монетизації: {idea.get('monetization_hypothesis') or '—'}",
    ]
    if sources:
        lines.append("- джерела знахідки:")
        for s in sources[:10]:
            lines.append(f"  - {s.get('url')} (дата: {s.get('published_date') or '?'}, "
                         f"інтерес автора: {s.get('author_interest') or '?'})")
    context = "\n".join(lines)
    if body_rest:
        context += "\n\nОпис механіки з картки:\n\n" + body_rest
    return context


def render(template: str, mapping: dict[str, str]) -> str:
    for key, value in mapping.items():
        template = template.replace("{{" + key + "}}", value)
    return template


def criteria_doc_path(track: str) -> str:
    path = CRITERIA_DOC_BY_TRACK.get(track)
    if not path:
        raise SystemExit(f"deep-research: трек '{track}' не має чек-листа критеріїв")
    return os.path.join(REPO_ROOT, path)


def load_idea(idea_id: str) -> tuple[dict, str, list[dict]]:
    ideas = db._request("GET", f"/ideas?id=eq.{urllib.parse.quote(idea_id, safe='')}&select=*")
    if not ideas:
        raise SystemExit(f"deep-research: ідею {idea_id} не знайдено")
    idea = ideas[0]
    track = idea.get("track")
    if track not in BASE_KEYS_BY_TRACK:
        raise SystemExit(f"deep-research: трек '{track}' не має чек-листа критеріїв")
    if idea.get("status") not in OWNER_DECIDABLE:
        raise SystemExit(f"deep-research: статус '{idea.get('status')}' не підлягає глибокому дослідженню")
    sources = db._request("GET", f"/sources?idea_id=eq.{urllib.parse.quote(idea_id, safe='')}&select=*") or []
    return idea, track, sources


# ---------------------------------------------------------------------------
# Стадія synthesis: звіти зовнішніх моделей з БД → зведення Claude
# ---------------------------------------------------------------------------

def sanitize_competitors(raw) -> list[dict]:
    result = []
    if not isinstance(raw, list):
        return result
    for item in raw[:40]:
        if not isinstance(item, dict) or not isinstance(item.get("name"), str) or not item["name"].strip():
            continue
        row = {"name": item["name"].strip()[:300]}
        for field, limit in (("url", 2000), ("pricing", 500), ("strengths", 2000),
                             ("weaknesses", 2000), ("differentiation", 2000)):
            if isinstance(item.get(field), str):
                row[field] = item[field][:limit]
        if item.get("liveness") in LIVENESS:
            row["liveness"] = item["liveness"]
        date = item.get("last_activity")
        if isinstance(date, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
            row["last_activity"] = date
        row["evidence"] = sanitize_evidence(item.get("evidence"))
        result.append(row)
    return result


def load_model_reports(idea_id: str) -> list[dict]:
    """Вербатим-звіти зовнішніх моделей, які власник вставив на порталі."""
    quoted_id = urllib.parse.quote(idea_id, safe="")
    rows = db._request(
        "GET",
        f"/research_reports?idea_id=eq.{quoted_id}&stage=eq.deep_criteria&kind=eq.model"
        "&select=provider,model,status,report_md&order=provider.asc",
    ) or []
    return [row for row in rows
            if row.get("status") == "ok" and isinstance(row.get("report_md"), str)]


def run_synthesis_stage(idea_id: str, run_id: str | None, today: str) -> None:
    idea, track, sources = load_idea(idea_id)
    reports = load_model_reports(idea_id)
    if not reports:
        raise SystemExit(
            "deep-research: у research_reports немає жодного придатного звіту "
            f"({idea_id}, stage=deep_criteria, kind=model) — спершу вставте відповіді "
            "моделей на порталі, синтезувати нема з чого"
        )
    labels = ", ".join(str(row.get("provider")) for row in reports)
    log(f"{idea_id} ({track}), звітів моделей у базі: {len(reports)} — {labels}")

    # ---- Межа фази 4 ----------------------------------------------------
    # Далі — два послідовні виклики Claude (власне дослідження d_-блоків плюс
    # адʼюдикація чужих звітів; потім текст картки і зведення конкурентів) і
    # запис результатів у criteria_verdicts/competitors/ideas. Усе, що для цього
    # потрібно, уже є в цьому файлі: load_idea, звіти вище, sanitize_criteria,
    # sanitize_competitors, replace_section, run_llm.
    raise SystemExit(
        "deep-research: стадію synthesis ще не реалізовано (фаза 4 плану "
        "docs/plans/deep-research-handoff.md) — звіти лишились у базі, картку не змінено"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", choices=["synthesis"], default="synthesis")
    args = parser.parse_args()

    idea_id = read_idea_id()

    # Dry-run лишається для інфраструктурних перевірок ланцюжка кнопка→воркер.
    if os.environ.get("IDEAS_SCOUT_DEEP_RESEARCH_DRY_RUN") == "1":
        delay = int(os.environ.get("IDEAS_SCOUT_DEEP_RESEARCH_DRY_RUN_DELAY_SECONDS", "10"))
        log(f"dry run ({args.stage}) для {idea_id} стартував")
        import time
        time.sleep(min(delay, 30))
        log(f"dry run ({args.stage}) для {idea_id} успішно завершено")
        return

    run_id = os.environ.get("IDEAS_SCOUT_JOB_RUN_ID") or None
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    run_synthesis_stage(idea_id, run_id, today)


if __name__ == "__main__":
    main()
