"""doctor_prompt_contract.py — перевірка контракту промптів глибокого дослідження.

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
print("\n".join(lines))
