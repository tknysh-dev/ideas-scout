#!/usr/bin/env python3
"""deep-research.py — оркестратор глибокого дослідження ідеї.

Запускається воркером через deep-research.sh (stdin: {"idea_id": "PI-0013"}).

Стадія deep_criteria (дефолт): незалежні моделі-дослідники (llm-invoke.sh)
паралельно перевіряють критерії свіжим веб-пошуком → опційний крос-допит
розбіжностей DeepSeek-ом → синтез Claude → структуровані вердикти в
criteria_verdicts, звіти в research_reports, перезапис полів вердикту картки
ideas. Якщо всі фатальні критерії пройдено — сама ставить у чергу джоб
deep_research_competitors.

Стадія competitors (--stage competitors): ті самі моделі паралельно шукають
конкурентів ніші → синтез Claude зводить у канонічний список → таблиця
competitors + розділ «Конкуренти» в body; суперечність щойно пройденому
критерію насиченості не перевертає вердикт, а піднімає ceiling_flag=review.

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
from concurrent.futures import ThreadPoolExecutor
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

RESEARCH_TIMEOUT_S = int(os.environ.get("IDEAS_SCOUT_RESEARCH_TIMEOUT_S", "1800"))
SYNTHESIS_TIMEOUT_S = int(os.environ.get("IDEAS_SCOUT_SYNTHESIS_TIMEOUT_S", "1800"))
CROSS_EXAM_TIMEOUT_S = int(os.environ.get("IDEAS_SCOUT_CROSS_EXAM_TIMEOUT_S", "900"))


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


def find_disputes(model_rows: dict[str, dict[str, dict]]) -> list[str]:
    """Фатальні базові критерії, де успішні дослідники розійшлись pass/fail."""
    disputes = []
    for key in sorted(FATAL_KEYS):
        verdicts = {rows[key]["verdict"] for rows in model_rows.values()
                    if key in rows and rows[key]["verdict"] in ("passed", "failed")}
        if verdicts == {"passed", "failed"}:
            disputes.append(key)
    return disputes


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


def run_researchers(prompt: str) -> dict[str, tuple[int, str]]:
    providers = [p.strip() for p in
                 os.environ.get("IDEAS_SCOUT_RESEARCH_PROVIDERS", "codex,gemini").split(",") if p.strip()]
    log(f"дослідники: {', '.join(providers)} (таймаут {RESEARCH_TIMEOUT_S}с кожному, паралельно)")
    with ThreadPoolExecutor(max_workers=len(providers)) as pool:
        futures = {p: pool.submit(run_llm, p, prompt, RESEARCH_TIMEOUT_S) for p in providers}
        return {p: f.result() for p, f in futures.items()}


def enqueue_competitors(idea_id: str, run_id: str | None) -> None:
    job = {
        "type": "deep_research_competitors",
        "payload": {"idea_id": idea_id},
        "requested_by": "m1:deep-research",
        # run_id у ключі: повторне глибоке дослідження має право на новий
        # конкурентний етап, а повторний клейм того самого прогону — ні.
        "idempotency_key": f"deep-research-competitors:{idea_id}:"
                           + (run_id or datetime.now(timezone.utc).strftime("%Y%m%d%H%M")),
    }
    try:
        db._request("POST", "/jobs", job)
        log("усі фатальні критерії пройдено — етап конкурентів поставлено в чергу")
    except db.DbError as error:
        if "409" in str(error) or "23505" in str(error):
            log("етап конкурентів уже в черзі (idempotency)")
        else:
            raise


def run_deep_stage(idea_id: str, run_id: str | None, today: str) -> None:
    idea, track, sources = load_idea(idea_id)

    criteria_doc = read_file(os.path.join(REPO_ROOT, "agents/criteria", f"criteria-{track}.md"))
    deep_doc = read_file(os.path.join(REPO_ROOT, "agents/criteria/deep-research.md"))
    base_keys = BASE_KEYS_BY_TRACK[track]
    allowed_keys = set(base_keys) | set(DEEP_KEYS)

    researcher_template = read_file(os.path.join(REPO_ROOT, "agents/prompts/deep-research-researcher.md"))
    researcher_prompt = render(researcher_template, {
        "IDEA_ID": idea_id,
        "TRACK": track,
        "TODAY": today,
        "IDEA_CONTEXT": build_idea_context(idea, sources),
        "CRITERIA_DOC": criteria_doc,
        "DEEP_DOC": deep_doc,
        "MAX_BASE_KEY": base_keys[-1],
        "EXPECTED_COUNT": str(len(base_keys) + len(DEEP_KEYS)),
    })

    raw_results = run_researchers(researcher_prompt)

    report_rows: list[dict] = []
    model_rows: dict[str, dict[str, dict]] = {}
    for provider, (exit_code, output) in raw_results.items():
        parsed = extract_json_block(output) if exit_code == 0 else None
        rows = sanitize_criteria(parsed.get("criteria"), allowed_keys, require_resolution=False) if parsed else {}
        status = "ok" if rows else ("timeout" if exit_code == 124 else "error")
        if rows:
            model_rows[provider] = rows
        log(f"{provider}: exit={exit_code}, критеріїв розпізнано {len(rows)}, статус {status}")
        report_rows.append({
            "idea_id": idea_id, "run_id": run_id, "stage": "deep_criteria",
            "kind": "model", "provider": provider, "model": None,
            "status": status, "report_md": output[:200_000],
        })

    if not model_rows:
        # Звіти про провал все одно зберігаємо — інакше діагностика лише по stdout-хвосту.
        db._request("DELETE", f"/research_reports?idea_id=eq.{urllib.parse.quote(idea_id, safe='')}&stage=eq.deep_criteria")
        db._request("POST", "/research_reports", report_rows)
        raise SystemExit("deep-research: жоден дослідник не повернув валідних даних — синтез неможливий")

    # Крос-допит: лише для розбіжностей по фатальних критеріях і лише якщо є ключ.
    cross_exam_text = ""
    disputes = find_disputes(model_rows)
    if disputes and os.environ.get("DEEPSEEK_API_KEY"):
        log(f"розбіжності по критеріях {', '.join(disputes)} — крос-допит deepseek")
        positions = {
            provider: {key: rows[key] for key in disputes if key in rows}
            for provider, rows in model_rows.items()
        }
        cross_exam_prompt = (
            "Ти — арбітр без доступу до вебу. Незалежні дослідники розійшлись у вердиктах "
            f"по критеріях {', '.join(disputes)} для ідеї заробітку. Нижче їхні позиції з доказами "
            "(JSON). Оціни СИЛУ ДОКАЗІВ кожної сторони: конкретність, датованість, релевантність "
            "цитат — і для кожного спірного критерію скажи, чия позиція краще підкріплена і чому. "
            "Не додавай власних фактів (у тебе немає вебу) — лише аналіз наведених доказів. "
            "Відповідай українською.\n\n```json\n"
            + json.dumps(positions, ensure_ascii=False, indent=1) + "\n```"
        )
        exit_code, output = run_llm("deepseek", cross_exam_prompt, CROSS_EXAM_TIMEOUT_S)
        if exit_code == 0 and output.strip():
            cross_exam_text = output.strip()[:30_000]
        else:
            log(f"крос-допит не вдався (exit={exit_code}) — синтез працює без арбітра")

    synthesis_template = read_file(os.path.join(REPO_ROOT, "agents/prompts/deep-research-synthesis.md"))
    initial_section, _ = split_section(idea.get("body"), "Аналіз за критеріями")
    snapshot_fields = {k: idea.get(k) for k in (
        "id", "title", "type", "track", "status", "signal_type", "rejection_code",
        "rejection_detail", "rejection_codes_extra", "confidence", "ceiling_estimate",
        "launch_effort_hours", "ceiling_flag", "claimed_revenue", "mechanic_summary",
        "monetization_hypothesis", "criteria_version")}
    idea_snapshot = (
        "Поля картки (початковий вердикт):\n```json\n"
        + json.dumps(snapshot_fields, ensure_ascii=False, indent=1)
        + "\n```\n\nПочатковий «Аналіз за критеріями» (проза попереднього аналітика):\n\n"
        + (initial_section or "(розділ відсутній)")
    )
    model_results_md = "\n\n".join(
        f"### Дослідник: {provider}\n```json\n"
        + json.dumps({"criteria": list(rows.values())}, ensure_ascii=False, indent=1) + "\n```"
        for provider, rows in model_rows.items()
    )
    synthesis_prompt = render(synthesis_template, {
        "IDEA_ID": idea_id,
        "TRACK": track,
        "TODAY": today,
        "IDEA_SNAPSHOT": idea_snapshot,
        "MODEL_RESULTS": model_results_md,
        "CROSS_EXAM_SECTION": (
            "## Аналіз арбітра (крос-допит розбіжностей, модель без веб-доступу)\n\n" + cross_exam_text
            if cross_exam_text else ""
        ),
        "CRITERIA_DOC": criteria_doc,
        "DEEP_DOC": deep_doc,
        "ALLOWED_CODES": " | ".join(f'"{c}"' for c in sorted(REJECTION_CODES)),
    })

    log(f"синтез claude (таймаут {SYNTHESIS_TIMEOUT_S}с)")
    exit_code, output = run_llm("claude", synthesis_prompt, SYNTHESIS_TIMEOUT_S)
    synthesis = extract_json_block(output) if exit_code == 0 else None
    synth_rows = sanitize_criteria(synthesis.get("criteria"), allowed_keys, require_resolution=True) if synthesis else {}
    report_rows.append({
        "idea_id": idea_id, "run_id": run_id, "stage": "deep_criteria",
        "kind": "synthesis", "provider": "claude", "model": os.environ.get("RUNNER_CLAUDE_MODEL"),
        "status": "ok" if synth_rows else "error", "report_md": output[:200_000],
    })

    quoted_id = urllib.parse.quote(idea_id, safe="")
    db._request("DELETE", f"/research_reports?idea_id=eq.{quoted_id}&stage=eq.deep_criteria")
    db._request("POST", "/research_reports", report_rows)

    if not synth_rows:
        raise SystemExit(f"deep-research: синтез не повернув валідного JSON (exit={exit_code}) — "
                         "звіти збережено в research_reports, картку не змінено")

    criteria_version = criteria_version_of(criteria_doc)
    verdict_rows = []
    for provider, rows in model_rows.items():
        for row in rows.values():
            verdict_rows.append({**row, "idea_id": idea_id, "run_id": run_id, "stage": "deep",
                                 "kind": "model", "provider": provider,
                                 "criteria_version": criteria_version})
    for row in synth_rows.values():
        verdict_rows.append({**row, "idea_id": idea_id, "run_id": run_id, "stage": "deep",
                             "kind": "synthesis", "provider": "claude",
                             "criteria_version": criteria_version})
    db._request("DELETE", f"/criteria_verdicts?idea_id=eq.{quoted_id}&stage=eq.deep")
    db._request("POST", "/criteria_verdicts", verdict_rows)
    log(f"criteria_verdicts: записано {len(verdict_rows)} рядків (stage=deep)")

    # ---- Перезапис картки: рішення про статус приймає скрипт, не модель. ----
    failed_fatal = [k for k in sorted(FATAL_KEYS)
                    if k in synth_rows and synth_rows[k]["verdict"] == "failed"]
    all_fatal_passed = not failed_fatal

    updates_raw = synthesis.get("idea_updates") if isinstance(synthesis.get("idea_updates"), dict) else {}
    updates: dict = {}
    code = updates_raw.get("rejection_code")
    if failed_fatal:
        if code not in REJECTION_CODES:
            code = CODE_BY_CRITERION[track][failed_fatal[0]]
        updates["rejection_code"] = code
        updates["status"] = "rejected"
    else:
        updates["rejection_code"] = None
        updates["rejection_detail"] = None
        # accepted лишається рішенням власника; rejected після повного проходу
        # повертається на його ж розгляд.
        updates["status"] = "accepted" if idea["status"] == "accepted" else "approved_pending"
    if isinstance(updates_raw.get("rejection_detail"), str) and failed_fatal:
        updates["rejection_detail"] = updates_raw["rejection_detail"][:5000]
    extra = updates_raw.get("rejection_codes_extra")
    if isinstance(extra, list):
        updates["rejection_codes_extra"] = [c for c in extra if c in REJECTION_CODES and c != updates.get("rejection_code")]
    if updates_raw.get("confidence") in ("high", "medium", "low"):
        updates["confidence"] = updates_raw["confidence"]
    if isinstance(updates_raw.get("ceiling_estimate"), str):
        updates["ceiling_estimate"] = updates_raw["ceiling_estimate"][:500]
    if isinstance(updates_raw.get("launch_effort_hours"), (int, float)):
        updates["launch_effort_hours"] = updates_raw["launch_effort_hours"]
    updates["ceiling_flag"] = "review" if updates_raw.get("ceiling_flag") == "review" else None
    if isinstance(updates_raw.get("review_condition"), str):
        updates["review_condition"] = updates_raw["review_condition"][:2000]

    section_md = synthesis.get("criteria_section_md")
    if isinstance(section_md, str) and section_md.strip():
        updates["body"] = replace_section(idea.get("body"), "Аналіз за критеріями", section_md)

    updates.update({
        "research_depth": "deep",
        "deep_researched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "deep_research_run_id": run_id,
        "verdict_provider": "multi",
        "verdict_model": "synthesis:claude+" + "+".join(sorted(model_rows)),
        "verdict_run_id": run_id,
        "criteria_version": criteria_version or idea.get("criteria_version"),
    })
    db._request("PATCH", f"/ideas?id=eq.{quoted_id}", updates)

    summary = synthesis.get("summary")
    summary = summary[:2000] if isinstance(summary, str) else "глибоке дослідження завершено"
    change = f"research_depth: initial -> deep; status: {idea['status']} -> {updates['status']}"
    event = {"idea_id": idea_id, "actor": "deep-research", "change": change, "reason": summary}
    if run_id:
        event["run_id"] = run_id
    db._request("POST", "/events", event)

    log(f"картку оновлено: {change}")
    log(f"підсумок синтезу: {summary}")
    if all_fatal_passed:
        enqueue_competitors(idea_id, run_id)
    else:
        log(f"фатальні провали: критерії {', '.join(failed_fatal)} (код {updates['rejection_code']})")


# ---------------------------------------------------------------------------
# Стадія competitors
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


def run_competitors_stage(idea_id: str, run_id: str | None, today: str) -> None:
    idea, track, sources = load_idea(idea_id)
    deep_doc = read_file(os.path.join(REPO_ROOT, "agents/criteria/deep-research.md"))

    researcher_template = read_file(os.path.join(REPO_ROOT, "agents/prompts/deep-research-competitors-researcher.md"))
    researcher_prompt = render(researcher_template, {
        "IDEA_ID": idea_id,
        "TRACK": track,
        "TODAY": today,
        "IDEA_CONTEXT": build_idea_context(idea, sources),
    })

    raw_results = run_researchers(researcher_prompt)

    report_rows: list[dict] = []
    model_lists: dict[str, list[dict]] = {}
    for provider, (exit_code, output) in raw_results.items():
        parsed = extract_json_block(output) if exit_code == 0 else None
        rows = sanitize_competitors(parsed.get("competitors")) if parsed else []
        status = "ok" if rows else ("timeout" if exit_code == 124 else "error")
        if rows:
            model_lists[provider] = rows
        log(f"{provider}: exit={exit_code}, конкурентів розпізнано {len(rows)}, статус {status}")
        report_rows.append({
            "idea_id": idea_id, "run_id": run_id, "stage": "competitors",
            "kind": "model", "provider": provider, "model": None,
            "status": status, "report_md": output[:200_000],
        })

    quoted_id = urllib.parse.quote(idea_id, safe="")
    if not model_lists:
        db._request("DELETE", f"/research_reports?idea_id=eq.{quoted_id}&stage=eq.competitors")
        db._request("POST", "/research_reports", report_rows)
        raise SystemExit("deep-research: жоден дослідник не повернув конкурентів — синтез неможливий")

    synthesis_template = read_file(os.path.join(REPO_ROOT, "agents/prompts/deep-research-competitors-synthesis.md"))
    model_results_md = "\n\n".join(
        f"### Дослідник: {provider}\n```json\n"
        + json.dumps({"competitors": rows}, ensure_ascii=False, indent=1) + "\n```"
        for provider, rows in model_lists.items()
    )
    saturation_context, _ = split_section(idea.get("body"), "Аналіз за критеріями")
    synthesis_prompt = render(synthesis_template, {
        "IDEA_ID": idea_id,
        "TRACK": track,
        "TODAY": today,
        "IDEA_CONTEXT": build_idea_context(idea, sources),
        "CRITERIA_SECTION": saturation_context or "(розділ відсутній)",
        "MODEL_RESULTS": model_results_md,
        "DEEP_DOC": deep_doc,
    })

    log(f"синтез конкурентів claude (таймаут {SYNTHESIS_TIMEOUT_S}с)")
    exit_code, output = run_llm("claude", synthesis_prompt, SYNTHESIS_TIMEOUT_S)
    synthesis = extract_json_block(output) if exit_code == 0 else None
    final_rows = sanitize_competitors(synthesis.get("competitors")) if synthesis else []
    report_rows.append({
        "idea_id": idea_id, "run_id": run_id, "stage": "competitors",
        "kind": "synthesis", "provider": "claude", "model": os.environ.get("RUNNER_CLAUDE_MODEL"),
        "status": "ok" if final_rows else "error", "report_md": output[:200_000],
    })
    db._request("DELETE", f"/research_reports?idea_id=eq.{quoted_id}&stage=eq.competitors")
    db._request("POST", "/research_reports", report_rows)

    if not final_rows:
        raise SystemExit(f"deep-research: синтез конкурентів не повернув валідного JSON (exit={exit_code}) — "
                         "звіти збережено, картку не змінено")

    for row in final_rows:
        row.update({"idea_id": idea_id, "run_id": run_id})
    db._request("DELETE", f"/competitors?idea_id=eq.{quoted_id}")
    db._request("POST", "/competitors", final_rows)
    log(f"competitors: записано {len(final_rows)} рядків")

    updates: dict = {}
    section_md = synthesis.get("competitors_section_md")
    if isinstance(section_md, str) and section_md.strip():
        updates["body"] = replace_section(idea.get("body"), "Конкуренти", section_md)

    # Насиченість, що суперечить щойно пройденому критерію, не перевертає
    # вердикт мовчки — лише піднімає прапорець ручного розгляду власником.
    saturation_alert = synthesis.get("saturation_alert") is True
    if saturation_alert:
        updates["ceiling_flag"] = "review"
        note = synthesis.get("saturation_note")
        if isinstance(note, str) and note.strip():
            updates["review_condition"] = note.strip()[:2000]

    if updates:
        db._request("PATCH", f"/ideas?id=eq.{quoted_id}", updates)

    summary = synthesis.get("summary")
    summary = summary[:2000] if isinstance(summary, str) else "дослідження конкурентів завершено"
    change = f"конкуренти: {len(final_rows)} у реєстрі" + ("; ceiling_flag -> review" if saturation_alert else "")
    event = {"idea_id": idea_id, "actor": "deep-research", "change": change, "reason": summary}
    if run_id:
        event["run_id"] = run_id
    db._request("POST", "/events", event)

    log(f"готово: {change}")
    log(f"підсумок синтезу: {summary}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", choices=["deep_criteria", "competitors"], default="deep_criteria")
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

    if args.stage == "competitors":
        run_competitors_stage(idea_id, run_id, today)
    else:
        run_deep_stage(idea_id, run_id, today)


if __name__ == "__main__":
    main()
