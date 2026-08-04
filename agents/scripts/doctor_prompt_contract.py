"""doctor_prompt_contract.py — перевірка контракту промптів (нічні агенти + дослідження).

Промпти редагуються руками, а їхній контракт розподілений між трьома місцями:
сам шаблон, код, що підставляє в нього плейсхолдери, і розбирач відповіді на
порталі. Кожен розсинхрон тут тихий: файли лишаються валідними поокремо, але
разом уже не працюють — власник дізнається про це аж коли скопіює зіпсований
промпт у чуже вікно й витратить годину на дослідження, яке нікуди не запишеться.

Викликається з doctor.sh; друкує рядки "рівень<TAB>повідомлення".
"""

from __future__ import annotations

import os
import re

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PROMPTS = "agents/prompts"
CRITERIA = "agents/criteria"
# Хто підставляє плейсхолдери в який шаблон: порталу дістається handoff, а
# обидва промпти синтезу рендерить скрипт на M1.
RENDERED_BY = {
    "deep-research-handoff.md": ("dashboard/src/lib/deep-research-prompt.ts", "портал"),
    "deep-research-synthesis.md": ("agents/scripts/deep-research.py", "синтез, виклик A"),
    "deep-research-card.md": ("agents/scripts/deep-research.py", "синтез, виклик B"),
}
# Єдиний плейсхолдер, який лишається в тексті навмисно: його вписує власник.
OWNER_PLACEHOLDER = "RESEARCHER_LABEL"
PARSER = "dashboard/src/lib/deep-research-reports.ts"
SYNTH = "agents/scripts/deep-research.py"
# Промпти нічних агентів: усі чотири рендерить runner.sh перед викликом CLI.
RUNNER = "agents/scripts/runner.sh"
AGENT_PROMPTS = ["collector.md", "analyst.md", "revisor.md", "triage.md"]

lines = []
def say(level, message):
    lines.append(f"{level}\t{message}")

def read(path):
    try:
        with open(os.path.join(REPO_ROOT, path), encoding="utf-8") as handle:
            return handle.read()
    except OSError:
        return None

missing = []
texts = {}
for name, (renderer, role) in RENDERED_BY.items():
    text = read(os.path.join(PROMPTS, name))
    if text is None:
        missing.append(f"{name} ({role})")
    else:
        texts[name] = text
if missing:
    say("err", "немає промптів: " + ", ".join(missing)
        + " — без них ручний цикл обривається на першому ж кроці")
else:
    say("ok", "усі три промпти на місці: handoff для зовнішніх моделей, адʼюдикація і текст картки")

# Документи, що вклеюються в промпти замість {{CRITERIA_DOC}} і {{DEEP_DOC}}.
docs = ["deep-research.md", "criteria-passive-income.md", "criteria-apps.md"]
absent = [d for d in docs if not os.path.isfile(os.path.join(REPO_ROOT, CRITERIA, d))]
if absent:
    say("err", "немає документів критеріїв: " + ", ".join(absent)
        + " — промпт для цього треку не збереться ні на порталі, ні в синтезі")
else:
    say("ok", "чек-листи обох треків і опис додаткових блоків на місці")

for name, text in texts.items():
    renderer_path, role = RENDERED_BY[name]
    renderer = read(renderer_path)
    if renderer is None:
        say("err", f"немає {renderer_path} — підставляти плейсхолдери в {name} нікому")
        continue
    found = set(re.findall(r"\{\{([A-Z_]+)\}\}", text))
    # Ключ шукаємо як окреме слово: у Python це рядок у словнику, у TypeScript —
    # ім'я властивості без лапок.
    orphans = sorted(k for k in found
                     if k != OWNER_PLACEHOLDER and not re.search(rf"\b{k}\b", renderer))
    if orphans:
        say("err", f"{name}: плейсхолдери {', '.join('{{' + o + '}}' for o in orphans)}"
            f" ніхто не підставляє ({role}) — модель отримає їх дослівно замість даних")
    else:
        say("ok", f"{name}: усі плейсхолдери має хто підставити ({role})")

# ---------------------------------------------------------------------------
# Промпти нічних агентів. Той самий клас розсинхрону, що вище, але дорожчий:
# промпт із неіснуючим шляхом не валить прогін — агент просто не знаходить файл
# і мовчки працює без чек-листа чи без пакетів запитів, а результат виглядає як
# нормальний. Саме так трек app-ideas відпрацював два прогони по промпту, що
# просив criteria-app-ideas.md і search-queries-app-ideas.md — обох файлів нема.
# ---------------------------------------------------------------------------

runner = read(RUNNER)
if runner is None:
    say("err", f"немає {RUNNER} — рендерити промпти нічних агентів нікому")
else:
    orphans = {}
    derived = []
    for name in AGENT_PROMPTS:
        text = read(os.path.join(PROMPTS, name))
        if text is None:
            say("err", f"немає промпта {name} — відповідний агент не запуститься")
            continue
        found = set(re.findall(r"\{\{([A-Z_]+)\}\}", text))
        missing_keys = sorted(k for k in found if not re.search(rf"\b{k}\b", runner))
        if missing_keys:
            orphans[name] = missing_keys
        # Ім'я файлу критеріїв не виводиться з назви треку (app-ideas лежить у
        # criteria-apps.md) — промпт, що склеює його сам, гарантовано промахнеться.
        if re.search(r"agents/criteria/[a-z-]*\{\{TRACK\}\}", text):
            derived.append(name)
    if orphans:
        say("err", "плейсхолдери, яких не підставляє runner.sh: "
            + "; ".join(f"{n}: {', '.join('{{' + k + '}}' for k in ks)}"
                        for n, ks in sorted(orphans.items()))
            + " — агент отримає їх дослівно замість шляхів")
    elif not derived:
        say("ok", "промпти нічних агентів: усі плейсхолдери підставляє runner.sh")
    if derived:
        say("err", "промпти складають ім'я файлу критеріїв із назви треку: "
            + ", ".join(derived)
            + " — на app-ideas це неіснуючий шлях, агент мовчки працюватиме без документа")

    # Шляхи з мапінгу runner.sh мають існувати на диску: мапінг правильний рівно
    # доти, доки файли, на які він показує, ніхто не перейменував.
    mapped = re.findall(r'(?:CRITERIA_DOC|SEARCH_QUERIES_DOC)="(agents/criteria/[^"]+)"', runner)
    if not mapped:
        say("err", f"у {RUNNER} не знайдено мапінгу треків на документи критеріїв"
            " — промпти лишаться з нерозгорнутими плейсхолдерами")
    else:
        gone = [p for p in mapped if not os.path.isfile(os.path.join(REPO_ROOT, p))]
        if gone:
            say("err", "runner.sh показує на неіснуючі документи: " + ", ".join(gone)
                + " — прогін цього треку піде без них")
        else:
            say("ok", f"усі {len(set(mapped))} документ(и) з мапінгу треків у runner.sh на місці")

handoff = texts.get("deep-research-handoff.md")
if handoff is not None:
    if OWNER_PLACEHOLDER not in handoff:
        say("err", f"у handoff-промпті немає {{{{{OWNER_PLACEHOLDER}}}}}"
            " — власнику ніде вписати назву моделі, і звіти неможливо буде розрізнити")
    parser = read(PARSER)
    synth = read(SYNTH)
    if parser is None:
        say("err", f"немає {PARSER} — портал не розбере вставлені звіти")
    else:
        # Маркери й слово-відмова — це протокол між шаблоном, парсером порталу
        # і синтезом. Розходження ловиться лише тут: усі три файли валідні самі
        # по собі, але разом уже не працюють.
        drift = []
        for token in ("DEEP RESEARCH REPORT START", "DEEP RESEARCH REPORT END"):
            if token not in handoff:
                drift.append(f"«{token}» немає в шаблоні")
            elif token not in parser:
                drift.append(f"«{token}» є в шаблоні, але не в розбирачі")
        if "SEARCH UNAVAILABLE" not in handoff:
            drift.append("«SEARCH UNAVAILABLE» немає в шаблоні")
        else:
            for path, blob in ((PARSER, parser), (SYNTH, synth or "")):
                if "SEARCH UNAVAILABLE" not in blob:
                    drift.append(f"«SEARCH UNAVAILABLE» не знає {path}")
        if drift:
            say("err", "протокол звіту розійшовся: " + "; ".join(drift)
                + " — вставлені відповіді або не розріжуться на звіти, або відмова моделі"
                " буде прийнята за справжнє дослідження")
        else:
            say("ok", "протокол звіту збігається в шаблоні, розбирачі порталу і синтезі")

# ---------------------------------------------------------------------------
# Зовнішні брифи. Критерії існують у двох виглядах: внутрішній регламент для
# синтезу і бриф без внутрішньої кухні, який власник вставляє у вікно чужої
# моделі. Обидва редагуються руками, тому розходяться двома способами, і обидва
# тихі: у брифі бракує критерію — модель його просто не оцінить, а синтез
# порахує це «модель не відповіла»; у бриф просочився шлях чи назва поля бази —
# витік разом із падінням якості, бо це інструкція, яку модель не може виконати.
# ---------------------------------------------------------------------------

EXTERNAL = "agents/criteria/external"
BRIEFS = {
    "brief-passive-income.md": "agents/criteria/criteria-passive-income.md",
    "brief-apps.md": "agents/criteria/criteria-apps.md",
    "brief-deep-blocks.md": "agents/criteria/deep-research.md",
}
# Те, що не має шансу опинитись у тексті для сторонньої моделі: шляхи
# репозиторію, назви полів і значень БД, коди відхилення, назви треків.
FORBIDDEN = [
    "agents/", "shared/", "dashboard/", "PLAN.md", "logs/", "registries/",
    "rejection_code", "signal_type", "ceiling_flag", "research_depth",
    "criteria_version", "criterion_key", "approved_pending", "passive-income",
    "app-ideas", "automation_report", "income_claim",
    "NO_MONETIZATION", "SOURCE_SUSPECT", "CAPABILITY_GAP", "AUTONOMY",
    "SATURATED", "NO_MARKET",
]

def body_of(text):
    """Текст брифа без службової шапки — саме він потрапляє в чуже вікно."""
    match = re.search(r"^---\s*$", text, re.MULTILINE)
    return text[match.end():] if match else text

def keys_of(text):
    return set(re.findall(r"^##\s+(\d+|d_[a-z_]+)[.\s]", text, re.MULTILINE))

missing_briefs = [n for n in BRIEFS if read(os.path.join(EXTERNAL, n)) is None]
if missing_briefs:
    say("err", "немає зовнішніх брифів: " + ", ".join(missing_briefs)
        + " — портал не збере промпт для сторонніх моделей")
else:
    gaps, leaks = [], []
    for name, source in BRIEFS.items():
        brief = body_of(read(os.path.join(EXTERNAL, name)))
        internal = read(source)
        if internal is not None:
            lost = sorted(keys_of(internal) - keys_of(brief), key=str)
            if lost:
                gaps.append(f"{name}: немає критеріїв {', '.join(lost)} (є у {os.path.basename(source)})")
        found = sorted({w for w in FORBIDDEN if w in brief})
        if found:
            leaks.append(f"{name}: {', '.join(found)}")
    if gaps:
        say("err", "зовнішні брифи розійшлись із внутрішніми чек-листами: " + "; ".join(gaps)
            + " — цих критеріїв стороння модель не оцінить, а синтез порахує це відсутністю відповіді")
    if leaks:
        say("err", "у зовнішні брифи просочилась внутрішня кухня: " + "; ".join(leaks)
            + " — це і витік у чуже вікно, і інструкція, яку модель не може виконати")
    if not gaps and not leaks:
        say("ok", f"зовнішні брифи ({len(BRIEFS)}) покривають усі критерії й не містять внутрішньої кухні")

print("\n".join(lines))
