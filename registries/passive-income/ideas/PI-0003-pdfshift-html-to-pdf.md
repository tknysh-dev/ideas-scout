---
schema_version: 2
criteria_version: "v0.2"

id: PI-0003
parent_id: PI-0001
title: "HTML→PDF API (PDFShift-тип)"
type: niche
discovered: 2026-07-15

sources:
  - url: "https://news.ycombinator.com/item?id=44200762"
    date: 2025-05-31
    author_interest: tool_vendor
    independent_confirmations: 0
    quote: "I've been running PDFShift.io... for seven years now. It's profitable (around $12K MRR) and still growing."

mentions_count: 1
claimed_revenue: "~$12k MRR (PDFShift, за словами оператора cx42net)"
mechanic_summary: "API-конвертер HTML→PDF на базі headless-Chromium, підписка за лімітом документів; AI не задіяний."

status: rejected
rejection_code: SATURATED
rejection_detail: "HTML→PDF як API — зрілий товарний ринок з десятками прямих конкурентів (DocRaptor, api2pdf, Urlbox, APITemplate, CraftMyPDF, PdfBroker, IronPDF) + тривіальний self-host (Puppeteer/Gotenberg). Множина листиклів «Best HTML to PDF API 2026» — сама по собі ознака перенасичення. Реалістичного вікна 6–12 міс для нового входу з нуля немає; ціни здавлені ($9/міс стартові тарифи, безкоштовні тіри 50/міс)."
rejection_codes_extra: []

missing_capabilities: []

ceiling_estimate: null           # не оцінювалось — зупинка на критерії 5 (SATURATED), критерій 6 не досягається
launch_effort_hours: null
ceiling_flag: null

review_condition: "Переглянути лише за появи вузького піддиференціатора (специфічний вертикальний формат/комплаєнс, якого не покривають наявні гравці) — а не як загальний HTML→PDF. Інакше ніша закрита."
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

Ніша механіки PI-0001: API, що приймає HTML/URL і повертає PDF, рендер через headless-Chromium. Монетизація — підписка за лімітом документів/паралельних конверсій. AI не задіяний. PDFShift знайшов перших клієнтів через IndieHackers/Quora/ProductHunt і працює 7 років.

## Аналіз за критеріями

**1. Довіра до джерела — PASS (B).** Першоособовий звіт оператора у відповідь на пряме питання; продукт живий 7 років (підтверджено пошуком: PDFShift активний, від $9/міс, free 50/міс). 0 прямих підтверджень $12k MRR, але довгострокова публічна присутність — непряма ознака достовірності.

**2. Легальність (фатальний) — PASS.** Успадковує від PI-0001: легально, ToS ок. Не фатально. Податковий статус власника критерієм не є (v0.2).

**3. Реалізовність наявними засобами — PASS (умовно).** Рендер через headless-Chromium будується власними засобами; стартовий хостинг <€100. Застереження: рендер-at-scale має реальну серверну вартість (пам'ять, шрифти/CSS edge-cases, зловживання), що росте з обсягом — але для запуску поріг €100 не перетнуто. Критерій пройдено.

**4. Автономність — PASS (умовно, ~4/5).** 7 років прибуткової роботи доводять досяжність, але рендер-сервіс потребує більше нагляду за Zestful (краші браузера, пам'ять, крайні випадки CSS, антиабьюз). На межі порогу ≥4. Припущення: `availability.md` порожній, дефолт-поріг застосовано.

**5. Насиченість ринку — FATAL → `SATURATED`.** Перший фатальний провал у послідовному чек-листі (критерій 2 пройдено, не фатально; 3–4 пройдено). Ринок HTML→PDF API — зрілий товар: прямі конкуренти DocRaptor, api2pdf, Urlbox, APITemplate.io, CraftMyPDF, PdfBroker.io, IronPDF, HTML2PDFAPI; плюс безкоштовний self-host (Puppeteer, Gotenberg). Наявність десятків порівняльних листиклів «Best HTML to PDF API 2026» — прямий сигнал перенасичення. Стартові тарифи здавлені до $9/міс і безкоштовних тірів. Вікна 6–12 міс для недиференційованого входу з нуля немає. Зупинка чек-листа тут.

## Історія рішень

- 2026-07-15 — аналітик (run_id: manual-20260715-analyst) — створено як нішу PI-0001 (див. `logs/dedup-decisions.md`). Критерії 1,3,4 пройдено; критерій 2 = park; критерій 5 = фатальний `SATURATED` (зрілий товарний ринок, десятки конкурентів + self-host, здавлені ціни). Відхилено. confidence `medium`: насиченість добре підтверджена зовнішнім пошуком; сама цифра $12k MRR self-reported.
- 2026-07-15 — оркестратор (run_id: manual-20260715-criteria-v02) — переоцінено за критеріями v0.2. Критерій 2 (легальність + ToS) — PASS, не фатально (податковий гейт прибрано з критеріїв, рішення власника). Критерій 5 `SATURATED` підтверджено без змін — вердикт `rejected` зберігається. `rejection_codes_extra: []` (супутнього коду немає). Критерій 6 не оцінювався — зупинка на першому фатальному провалі (критерій 5) настала раніше.
