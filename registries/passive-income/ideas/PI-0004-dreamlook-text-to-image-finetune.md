---
schema_version: 2
criteria_version: "v0.2"

id: PI-0004
parent_id: PI-0001
title: "Text-to-image finetuning API (dreamlook-тип)"
type: niche
discovered: 2026-07-15

sources:
  - url: "https://news.ycombinator.com/item?id=44148918"
    date: 2025-05-31
    author_interest: tool_vendor
    independent_confirmations: 0
    quote: "It's making ~5k/month these days, not bad as we're no longer actively working on it, but a fraction of what we were doing a year ago."

mentions_count: 1
claimed_revenue: "~$5k/міс (dreamlook.ai, за словами співзасновника MasterScrat; знижується від піку)"
mechanic_summary: "API для файнтюну text-to-image моделей (Stable Diffusion/SDXL, LoRA), usage-based тариф за run/зображення; AI/ML — сама суть продукту."

status: rejected
rejection_code: CAPABILITY_GAP
rejection_detail: "Файнтюн і інференс дифузійних моделей вимагають GPU-інфраструктури (тренування SDXL-кроків, генерація зображень), якої немає в `ai-capabilities.md` і яку не покривають M1/M5 + підписки Claude/Codex. Хмарні GPU під навантаженням — регулярні витрати, що суттєво перевищують поріг €100 без погодження. Це одночасно брак можливості (CAPABILITY_GAP, первинний код) і капітальний бар'єр (CAPITAL, супутній код — див. rejection_codes_extra)."
rejection_codes_extra: [CAPITAL]

missing_capabilities:
  - "gpu/finetuning/stable-diffusion-sdxl-training"
  - "gpu/inference/text-to-image-generation"

ceiling_estimate: null           # не оцінювалось — зупинка на критерії 3 (CAPABILITY_GAP), критерій 6 не досягається
launch_effort_hours: null
ceiling_flag: null

review_condition: "Переглянути, якщо (а) провайдер додасть у `ai-capabilities.md` доступний GPU-файнтюн/інференс дифузійних моделей у межах підписки, АБО (б) власник погодить капітальний бюджет на хмарні GPU понад €100/міс, АБО (в) з'явиться керована API-абстракція, що прибирає інфра-шар за <€100. Ринок генеративного AI також швидко рухається — перевірити насиченість при поверненні."
review_count: 0
last_reviewed: 2026-07-15
min_review_interval_days: 30

confidence: medium

transferred_to: null

verdict_by:
  provider: claude
  model: claude-sonnet-5
  run_id: manual-20260715-criteria-v02
---

## Механіка

Ніша механіки PI-0001, де AI — сам продукт: API, що приймає навчальні дані й повертає зафайнтюнену text-to-image модель (Stable Diffusion 1.5 / SDXL, LoRA), плюс генерація зображень. Монетизація usage-based (за пошуком: файнтюн від $0.75–2.25/run, генерація від $0.01–0.02/зображення). Команда з 2 осіб, нині мінімальна активна робота — найближче до «пасивного» серед знахідок за поточним режимом, але це *знижуваний* актив («a fraction of what we were doing a year ago»).

## Аналіз за критеріями

**1. Довіра до джерела — PASS (B).** Першоособовий звіт співзасновника; продукт живий (підтверджено пошуком: dreamlook.ai операційний, SDXL/LoRA, документація, тарифи per-run). 0 прямих підтверджень $5k/міс; автор чесно зазначає падіння від піку — низький маркетинговий тон.

**2. Легальність (фатальний) — PASS.** Успадковує від PI-0001: легально, ToS ок. Не фатально. Податковий статус власника критерієм не є (v0.2). (Додатковий, не оцінюваний тут ризик: правовий статус навчальних даних/вихідних зображень у генеративному AI — сіра зона, яку варто підняти, якщо ніша колись повернеться до аналізу.)

**3. Реалізовність наявними засобами — FATAL → `CAPABILITY_GAP`.** Перший фатальний провал (критерій 2 пройдено, не фатально). Файнтюн дифузійних моделей (1500 SDXL-кроків за ~10 хв на run) і генерація зображень вимагають GPU-обчислень, яких: (а) немає в `ai-capabilities.md`; (б) не дають M1/M5 у продакшн-обсязі; (в) не покривають підписки Claude Code / Codex (це LLM-агенти для коду, не GPU-хостинг). Хмарний GPU під клієнтським навантаженням — регулярна витрата, що явно перевищує €100/міс. Це одночасно брак можливості й капітальний бар'єр; за правилом (г) v0.2 первинний код — `CAPABILITY_GAP` (можливості бракує по суті), супутній — `CAPITAL` (записано в `rejection_codes_extra`). Зупинка чек-листа тут; критерії 4–6 не оцінювались.

## Історія рішень

- 2026-07-15 — аналітик (run_id: manual-20260715-analyst) — створено як нішу PI-0001 (див. `logs/dedup-decisions.md`). Критерій 1 пройдено; критерій 2 = park; критерій 3 = фатальний `CAPABILITY_GAP` (GPU-інфраструктура поза наявними засобами + капітал понад €100 без погодження). Відхилено. confidence `medium`: інфра-реальність GPU однозначна й підтверджена пошуком; сам продукт живий, лише недосяжний власними засобами. Найчистіший приклад спрацювання дешевого критерію 3 до дорожчих 4–5.
- 2026-07-15 — оркестратор (run_id: manual-20260715-criteria-v02) — переоцінено за критеріями v0.2. Критерій 2 — PASS, не фатально (податковий гейт прибрано з критеріїв). Критерій 3 `CAPABILITY_GAP` підтверджено як первинний фатальний код без змін; додано `rejection_codes_extra: [CAPITAL]` за правилом (г) — капітальний бар'єр (>€100/міс на GPU) зафіксовано як супутній, вторинний код при подвійному провалі. Вердикт `rejected` без змін.
