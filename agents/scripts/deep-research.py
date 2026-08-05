"""deep-research.py — синтез глибокого дослідження ідеї.

Запускається воркером через deep-research.sh (stdin: {"idea_id": "PI-0013"})
як job deep_research_synthesis.

Дослідників цей скрипт більше не запускає: автоматичний мульти-CLI конвеєр
виявився неживучим (повноцінний веб-пошук з CLI має лише codex), тому звіти
зовнішніх моделей власник збирає руками в браузерних deep-research UI за
промптом agents/prompts/deep-research-handoff.md і вставляє їх на порталі.
Дашборд кладе вербатим-звіти в research_reports (stage=deep_criteria,
kind=model) і ставить у чергу job deep_research_synthesis.

Стадія synthesis читає ці звіти з БД і робить два послідовні виклики Claude:
A — власне веб-дослідження d_-блоків (початковий аналіз їх не покривав) плюс
адʼюдикація чужих вердиктів по базових критеріях; B — повний текст розділів
картки і зведення конкурентів у канонічний список. Розділено на два виклики
тому, що одна відповідь із дослідженням, вердиктами, прозою картки і
конкурентами обривається на півслові.

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

# agents/scripts/db.py — той самий PostgREST-шар, що в telegram-bot.py; імпорт
# навмисно після sys.path.insert вище, інакше модуль db не знайдеться.
import db  # noqa: E402

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
RESOLUTIONS = {"consensus", "evidence", "pessimistic_default"}
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

# Виклик A сам ходить у веб по семи d_-блоках, тому його дефолт більший за
# виклик B, який лише переписує вже готові дані в прозу.
SYNTHESIS_TIMEOUT_S = int(os.environ.get("IDEAS_SCOUT_SYNTHESIS_TIMEOUT_S", "2700"))
CARD_TIMEOUT_S = int(os.environ.get("IDEAS_SCOUT_SYNTHESIS_CARD_TIMEOUT_S", "1800"))

SEARCH_UNAVAILABLE = "SEARCH UNAVAILABLE"


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


def read_prompt(name: str) -> str:
    """Шаблон промпта без шапки до першого `---`: вона адресована супровіднику
    репозиторію і в контексті моделі читалась би як частина завдання."""
    text = read_file(os.path.join(REPO_ROOT, "agents/prompts", name))
    match = re.search(r"^---\s*$", text, re.MULTILINE)
    return text[match.end():].lstrip() if match else text


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


SMART_QUOTES = str.maketrans({"\u201c": '"', "\u201d": '"', "\u201e": '"', "\u00ab": '"', "\u00bb": '"'})


def _as_object(raw: str) -> dict | None:
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _balance_brackets(raw: str) -> str:
    """Дозакриває дужки блока, обірваного на півслові."""
    curly = square = 0
    in_string = escaped = False
    for char in raw:
        if escaped:
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if char == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        curly += char == "{"
        curly -= char == "}"
        square += char == "["
        square -= char == "]"
    if curly <= 0 and square <= 0:
        return raw
    text = raw
    if in_string:
        # Обрив усередині значення: відрізаємо недописаний запис цілком.
        comma = text.rfind(",")
        if comma > 0:
            text = text[:comma]
    return text + "]" * max(0, square) + "}" * max(0, curly)


def _slice_object(raw: str) -> str | None:
    """Обʼєкт від першого `{` до дужки, що його СПРАВДІ закриває.

    Глибина рахується лише по `{`/`}` поза рядковими літералами (лапки й
    екранування — як у _balance_brackets), тож "}" усередині значення чи в
    прозі після обʼєкта більше не переважує справжнє закриття. Якщо обʼєкт
    до кінця тексту так і не закрився (обрив на півслові), зрізаємо до
    останньої СПРАВЖНЬОЇ закривної дужки, яку встигли побачити, — так само,
    як робив старий наївний rfind("}") у типовому випадку обриву всередині
    масиву записів, — щоб _balance_brackets далі міг дозакрити решту.
    """
    first = raw.find("{")
    if first == -1:
        return None
    depth = 0
    in_string = escaped = False
    last_close = None
    for i in range(first, len(raw)):
        char = raw[i]
        if escaped:
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if char == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            last_close = i
            if depth == 0:
                break
    if last_close is None:
        return None
    sliced = raw[first:last_close + 1]
    return sliced if re.search(r'"(criteria|competitors|idea_updates)"', sliced) else None


def _parse_candidate(raw: str) -> tuple[dict | None, list[str]]:
    data = _as_object(raw)
    if data is not None:
        return data, []

    repairs: list[str] = []
    text = raw

    sliced = _slice_object(text)
    if sliced and sliced != text:
        text = sliced
        repairs.append("зайва проза в блоці")
        data = _as_object(text)
        if data is not None:
            return data, repairs

    if any(q in text for q in "\u201c\u201d\u201e\u00ab\u00bb"):
        text = text.translate(SMART_QUOTES)
        repairs.append("типографські лапки")
        data = _as_object(text)
        if data is not None:
            return data, repairs

    if re.search(r"^\s*//", text, re.MULTILINE):
        text = re.sub(r"^\s*//.*$", "", text, flags=re.MULTILINE)
        repairs.append("рядки-коментарі")
        data = _as_object(text)
        if data is not None:
            return data, repairs

    if re.search(r",\s*[}\]]", text):
        text = re.sub(r",(\s*[}\]])", r"\1", text)
        repairs.append("зайві коми")
        data = _as_object(text)
        if data is not None:
            return data, repairs

    balanced = _balance_brackets(text)
    if balanced != text:
        repairs.append("обрив на півслові")
        data = _as_object(balanced)
        if data is not None:
            return data, repairs

    return None, []


def extract_json_block(text: str) -> dict | None:
    """Машиночитний підсумок із відповіді моделі, з поблажливістю до форми.

    Моделі ламають JSON передбачувано: інший регістр огорожі, обрив на
    півслові, кома перед дужкою, коментар, проза всередині блока. Лагодимо
    лише форму, ніколи не зміст: якщо після ремонту в блоці не виявиться
    впізнаних ключів, санітизація його однаково відкине — тобто ремонт не може
    протягти в базу те, чого модель не казала. Дзеркалить extractJsonBlock()
    у dashboard/src/lib/deep-research-reports.ts.
    """
    fenced = re.findall(r"```[ \t]*json[ \t]*\r?\n(.*?)```", text, re.DOTALL | re.IGNORECASE)
    notes: list[str] = []
    # Порядок пошуку — від найнадійнішого джерела до найвідчайдушнішого:
    # правильна огорожа, потім незакрита, потім огорожа без мови, і лише в
    # кінці — весь текст. Інакше цілий блок «лагодився» б через сирий текст.
    candidates = list(reversed(fenced))
    if not fenced:
        unclosed = re.search(r"```[ \t]*json[ \t]*\r?\n(.*)$", text, re.DOTALL | re.IGNORECASE)
        if unclosed:
            candidates.append(unclosed.group(1))
            notes.append("незакрита огорожа")
    candidates += list(reversed(
        re.findall(r"```[ \t]*[a-z]*[ \t]*\r?\n(.*?)```", text, re.DOTALL | re.IGNORECASE)))
    candidates.append(text)

    for raw in candidates:
        data, repairs = _parse_candidate(raw)
        if data is not None:
            if notes or repairs:
                log(f"json-блок прочитано з ремонтом: {', '.join(notes + repairs)}")
            return data
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
            timeout=timeout_s + 120, check=False,
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
    """Однопрохідна підстановка: `{{...}}` у ЗНАЧЕННІ одного плейсхолдера не
    підставляється повторно, і результат не залежить від порядку ключів у
    mapping. Незнайдений плейсхолдер лишається дослівно — контракт
    шаблон↔код звіряє doctor_prompt_contract.py."""
    if not mapping:
        return template
    placeholders = {f"{{{{{key}}}}}": value for key, value in mapping.items()}
    pattern = re.compile("|".join(re.escape(p) for p in placeholders))
    return pattern.sub(lambda m: placeholders[m.group(0)], template)


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


def supersede(path: str) -> None:
    """Позначає поточні рядки витісненими замість того, щоб їх видаляти.

    Прогони глибокого дослідження порівнюють між собою (та сама модель у новій
    версії), тому попередні вердикти, звіти й конкуренти лишаються в тих самих
    таблицях; поточні дані — це рядки з superseded_at is null.
    """
    db._request(
        "PATCH",
        f"{path}&superseded_at=is.null",
        {"superseded_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")},
    )


def load_model_reports(idea_id: str) -> list[dict]:
    """Вербатим-звіти зовнішніх моделей, які власник вставив на порталі."""
    quoted_id = urllib.parse.quote(idea_id, safe="")
    rows = db._request(
        "GET",
        f"/research_reports?idea_id=eq.{quoted_id}&stage=eq.deep_criteria&kind=eq.model"
        "&superseded_at=is.null"
        "&select=provider,model,status,report_md&order=provider.asc",
    ) or []
    return [row for row in rows
            if row.get("status") == "ok" and isinstance(row.get("report_md"), str)]


def parse_model_reports(reports: list[dict], allowed_keys: set[str]) -> tuple[dict, dict, dict]:
    """({provider: критерії}, {provider: конкуренти}, {provider: проза}).

    Звіт без валідного json-блока більше не пропадає: його текст іде в синтез
    прозою — година ручної роботи власника не має згорати через одну кому.
    Втрачається лише структура: у вкладці такого провайдера не буде вердиктів
    по критеріях. Відмова SEARCH UNAVAILABLE у синтез не йде взагалі, бо це
    свідома відповідь «пошуку не було», а не дані.
    """
    criteria_by_provider: dict[str, dict[str, dict]] = {}
    competitors_by_provider: dict[str, list[dict]] = {}
    prose_by_provider: dict[str, str] = {}
    for row in reports:
        provider = str(row.get("provider") or "unknown").strip()[:100] or "unknown"
        report_md = row.get("report_md") or ""
        if re.search(rf"^\s*{SEARCH_UNAVAILABLE}\s*$", report_md, re.MULTILINE):
            log(f"звіт «{provider}»: модель відповіла {SEARCH_UNAVAILABLE} — у синтез не йде")
            continue
        parsed = extract_json_block(report_md)
        rows = sanitize_criteria(parsed.get("criteria"), allowed_keys,
                                 require_resolution=False) if parsed else {}
        competitors = sanitize_competitors(parsed.get("competitors")) if parsed else []
        if rows:
            criteria_by_provider[provider] = rows
        if competitors:
            competitors_by_provider[provider] = competitors
        if not rows and not competitors:
            prose_by_provider[provider] = report_md
            log(f"звіт «{provider}»: без структурованих даних — іде в синтез прозою")
        else:
            log(f"звіт «{provider}»: критеріїв {len(rows)}, конкурентів {len(competitors)}")
    return criteria_by_provider, competitors_by_provider, prose_by_provider


def save_synthesis_report(idea_id: str, run_id: str | None, status: str, report_md: str,
                          report_id: str | None = None) -> str | None:
    """Обидва виклики синтезу — в одному рядку research_reports: unique-індекс
    таблиці (idea_id, stage, kind, provider) не дає завести два рядки claude.

    Рядок попереднього прогону витісняється, а не видаляється. Але рядок, який
    цей же прогін уже завів (виклик A), доповнюється на місці: історією має
    бути завершений прогін, а не його проміжний стан, тож id рядка передається
    назад у наступний виклик.
    """
    payload = {"status": status, "report_md": report_md[:200_000]}
    if report_id:
        db._request("PATCH", f"/research_reports?id=eq.{urllib.parse.quote(report_id, safe='')}",
                    payload)
        return report_id
    quoted_id = urllib.parse.quote(idea_id, safe="")
    supersede(f"/research_reports?idea_id=eq.{quoted_id}&stage=eq.deep_criteria&kind=eq.synthesis")
    rows = db._request("POST", "/research_reports", [{
        "idea_id": idea_id, "run_id": run_id, "stage": "deep_criteria",
        "kind": "synthesis", "provider": "claude",
        "model": os.environ.get("RUNNER_CLAUDE_MODEL"),
        **payload,
    }])
    return rows[0].get("id") if isinstance(rows, list) and rows else None


def build_idea_updates(track: str, idea: dict, synth_rows: dict, updates_raw) -> tuple[dict, list[str]]:
    """Поля картки за вердиктами синтезу. Статус і код відхилення вирішує цей
    код, а не модель: її `idea_updates` — лише пропозиція, звірена з білими
    списками."""
    if not isinstance(updates_raw, dict):
        updates_raw = {}
    failed_fatal = [k for k in sorted(FATAL_KEYS)
                    if k in synth_rows and synth_rows[k]["verdict"] == "failed"]

    updates: dict = {}
    code = updates_raw.get("rejection_code")
    if failed_fatal:
        if code not in REJECTION_CODES:
            code = CODE_BY_CRITERION[track][failed_fatal[0]]
        updates["rejection_code"] = code
        updates["status"] = "rejected"
        if isinstance(updates_raw.get("rejection_detail"), str):
            updates["rejection_detail"] = updates_raw["rejection_detail"][:5000]
    else:
        updates["rejection_code"] = None
        updates["rejection_detail"] = None
        # accepted лишається рішенням власника; rejected після повного проходу
        # повертається на його ж розгляд.
        updates["status"] = "accepted" if idea["status"] == "accepted" else "approved_pending"
    extra = updates_raw.get("rejection_codes_extra")
    if isinstance(extra, list):
        updates["rejection_codes_extra"] = [c for c in extra
                                            if c in REJECTION_CODES and c != updates.get("rejection_code")]
    if updates_raw.get("confidence") in ("high", "medium", "low"):
        updates["confidence"] = updates_raw["confidence"]
    if isinstance(updates_raw.get("ceiling_estimate"), str):
        updates["ceiling_estimate"] = updates_raw["ceiling_estimate"][:500]
    if isinstance(updates_raw.get("launch_effort_hours"), (int, float)):
        updates["launch_effort_hours"] = updates_raw["launch_effort_hours"]
    updates["ceiling_flag"] = "review" if updates_raw.get("ceiling_flag") == "review" else None
    if isinstance(updates_raw.get("review_condition"), str):
        updates["review_condition"] = updates_raw["review_condition"][:2000]
    return updates, failed_fatal


def write_event(idea_id: str, run_id: str | None, change: str, reason: str) -> None:
    event = {"idea_id": idea_id, "actor": "deep-research", "change": change, "reason": reason[:2000]}
    if run_id:
        event["run_id"] = run_id
    db._request("POST", "/events", event)


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

    base_keys = BASE_KEYS_BY_TRACK[track]
    allowed_keys = set(base_keys) | set(DEEP_KEYS)
    criteria_doc = read_file(criteria_doc_path(track))
    deep_doc = read_file(os.path.join(REPO_ROOT, "agents/criteria/deep-research.md"))

    model_criteria, model_competitors, model_prose = parse_model_reports(reports, allowed_keys)
    if not model_criteria and not model_competitors and not model_prose:
        raise SystemExit(
            "deep-research: жоден зі збережених звітів не дав придатних даних "
            "(див. рядки вище) — картку не змінено"
        )
    contributors = sorted(set(model_criteria) | set(model_competitors) | set(model_prose))

    quoted_id = urllib.parse.quote(idea_id, safe="")
    criteria_version = criteria_version_of(criteria_doc)

    # ---- Виклик A: власне дослідження d_-блоків + адʼюдикація критеріїв ----
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
        f"### Модель: {provider}\n```json\n"
        + json.dumps({"criteria": list(rows.values())}, ensure_ascii=False, indent=1) + "\n```"
        for provider, rows in model_criteria.items()
    )
    prose_md = "\n\n".join(
        f"### Модель: {provider} (без машиночитного підсумку — читай прозою)\n\n{text[:60000]}"
        for provider, text in model_prose.items()
    )
    model_results_md = "\n\n".join(x for x in (model_results_md, prose_md) if x) \
        or "(жодна модель не дала придатних результатів)"

    prompt_a = render(read_prompt("deep-research-synthesis.md"), {
        "IDEA_ID": idea_id,
        "TRACK": track,
        "TODAY": today,
        "IDEA_SNAPSHOT": idea_snapshot,
        "MODEL_RESULTS": model_results_md,
        "CRITERIA_DOC": criteria_doc,
        "DEEP_DOC": deep_doc,
        "MAX_BASE_KEY": base_keys[-1],
        "EXPECTED_COUNT": str(len(base_keys) + len(DEEP_KEYS)),
        "ALLOWED_CODES": " | ".join(f'"{c}"' for c in sorted(REJECTION_CODES)),
    })

    log(f"виклик A (прогалини + адʼюдикація), таймаут {SYNTHESIS_TIMEOUT_S}с")
    exit_a, output_a = run_llm("claude", prompt_a, SYNTHESIS_TIMEOUT_S)
    parsed_a = extract_json_block(output_a) if exit_a == 0 else None
    synth_rows = sanitize_criteria(parsed_a.get("criteria"), allowed_keys,
                                   require_resolution=True) if parsed_a else {}
    if not synth_rows:
        save_synthesis_report(idea_id, run_id, "timeout" if exit_a == 124 else "error", output_a)
        raise SystemExit(
            f"deep-research: виклик A не повернув валідних вердиктів (exit={exit_a}) — "
            "повний вивід збережено в research_reports, картку не змінено"
        )
    report_id = save_synthesis_report(idea_id, run_id, "ok", output_a)
    missing = sorted(allowed_keys - set(synth_rows))
    log(f"виклик A: вердиктів {len(synth_rows)} з {len(allowed_keys)}"
        + (f"; без вердикту лишились: {', '.join(missing)}" if missing else ""))

    verdict_rows = [{**row, "idea_id": idea_id, "run_id": run_id, "stage": "deep",
                     "kind": "synthesis", "provider": "claude",
                     "model": os.environ.get("RUNNER_CLAUDE_MODEL"),
                     "criteria_version": criteria_version}
                    for row in synth_rows.values()]
    supersede(f"/criteria_verdicts?idea_id=eq.{quoted_id}&stage=eq.deep&kind=eq.synthesis")
    db._request("POST", "/criteria_verdicts", verdict_rows)
    log(f"criteria_verdicts: записано {len(verdict_rows)} рядків синтезу")

    updates, failed_fatal = build_idea_updates(track, idea, synth_rows, parsed_a.get("idea_updates"))
    updates.update({
        "research_depth": "deep",
        "deep_researched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "deep_research_run_id": run_id,
        "verdict_provider": "multi",
        "verdict_model": ("synthesis:claude+" + "+".join(contributors))[:200],
        "verdict_run_id": run_id,
        "criteria_version": criteria_version or idea.get("criteria_version"),
    })
    db._request("PATCH", f"/ideas?id=eq.{quoted_id}", updates)

    change = f"research_depth: {idea.get('research_depth') or 'initial'} -> deep; " \
             f"status: {idea['status']} -> {updates['status']}"
    if failed_fatal:
        reason = (f"Провалено фатальні критерії {', '.join(failed_fatal)} "
                  f"(код {updates['rejection_code']}); зведено звіти: {', '.join(contributors)}.")
        log(f"фатальні провали: критерії {', '.join(failed_fatal)} (код {updates['rejection_code']})")
    else:
        reason = f"Усі фатальні критерії пройдено; зведено звіти: {', '.join(contributors)}."
    write_event(idea_id, run_id, change, reason)
    log(f"картку оновлено: {change}")

    # ---- Виклик B: текст картки + конкуренти ------------------------------
    # Виконується завжди, навіть після провалу фатальних критеріїв: власнику
    # потрібен повний пакет (конкуренти, економіка), а не лише код відхилення.
    competitors_md = "\n\n".join(
        f"### Модель: {provider}\n```json\n"
        + json.dumps({"competitors": rows}, ensure_ascii=False, indent=1) + "\n```"
        for provider, rows in model_competitors.items()
    ) or "(жодна модель не дала розібраного списку конкурентів)"
    current_competitors, _ = split_section(idea.get("body"), "Конкуренти")

    prompt_b = render(read_prompt("deep-research-card.md"), {
        "IDEA_ID": idea_id,
        "TRACK": track,
        "TODAY": today,
        "IDEA_CONTEXT": build_idea_context(idea, sources),
        "SYNTHESIS_CRITERIA": "```json\n" + json.dumps(
            {"criteria": list(synth_rows.values()), "idea_updates": {
                "rejection_code": updates.get("rejection_code"),
                "confidence": updates.get("confidence"),
                "ceiling_estimate": updates.get("ceiling_estimate"),
            }}, ensure_ascii=False, indent=1) + "\n```",
        "MODEL_COMPETITORS": competitors_md,
        "CURRENT_CRITERIA_SECTION": initial_section or "(розділ відсутній)",
        "CURRENT_COMPETITORS_SECTION": current_competitors or "(розділ відсутній)",
    })

    log(f"виклик B (текст картки + конкуренти), таймаут {CARD_TIMEOUT_S}с")
    exit_b, output_b = run_llm("claude", prompt_b, CARD_TIMEOUT_S)
    parsed_b = extract_json_block(output_b) if exit_b == 0 else None
    save_synthesis_report(
        idea_id, run_id, "ok" if parsed_b else ("timeout" if exit_b == 124 else "error"),
        "## Виклик A: прогалини та адʼюдикація\n\n" + output_a
        + "\n\n## Виклик B: текст картки та конкуренти\n\n" + output_b,
        report_id,
    )
    if not parsed_b:
        raise SystemExit(
            f"deep-research: виклик B не повернув валідного JSON (exit={exit_b}) — "
            "вердикти синтезу вже записані, але текст картки і конкуренти лишились старими"
        )

    final_competitors = sanitize_competitors(parsed_b.get("competitors"))
    if final_competitors:
        for row in final_competitors:
            row.update({"idea_id": idea_id, "run_id": run_id})
        supersede(f"/competitors?idea_id=eq.{quoted_id}")
        db._request("POST", "/competitors", final_competitors)
        log(f"competitors: записано {len(final_competitors)} рядків")
    else:
        log("виклик B не дав жодного конкурента — старий список лишено недоторканим")

    card_updates: dict = {}
    body = idea.get("body")
    criteria_section = parsed_b.get("criteria_section_md")
    if isinstance(criteria_section, str) and criteria_section.strip():
        body = replace_section(body, "Аналіз за критеріями", criteria_section)
    competitors_section = parsed_b.get("competitors_section_md")
    if isinstance(competitors_section, str) and competitors_section.strip():
        body = replace_section(body, "Конкуренти", competitors_section)
    if body != idea.get("body"):
        card_updates["body"] = body

    # Картина конкурентів, що суперечить щойно винесеному вердикту насиченості,
    # не перевертає його мовчки — лише піднімає прапорець ручного розгляду.
    saturation_alert = parsed_b.get("saturation_alert") is True
    if saturation_alert:
        card_updates["ceiling_flag"] = "review"
        note = parsed_b.get("saturation_note")
        if isinstance(note, str) and note.strip():
            card_updates["review_condition"] = note.strip()[:2000]

    if card_updates:
        db._request("PATCH", f"/ideas?id=eq.{quoted_id}", card_updates)

    summary = parsed_b.get("summary")
    summary = summary[:2000] if isinstance(summary, str) else "глибоке дослідження завершено"
    change_b = (f"конкуренти: {len(final_competitors)} у реєстрі; текст картки переписано"
                + ("; ceiling_flag -> review" if saturation_alert else ""))
    write_event(idea_id, run_id, change_b, summary)
    log(f"готово: {change_b}")
    log(f"підсумок синтезу: {summary}")


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
