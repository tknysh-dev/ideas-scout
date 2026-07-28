---
schema_version: 3
criteria_version: "v0.3"

id: PI-0012
parent_id: PI-0011
title: "AI re-engagement холодних лідів на OLX"
type: niche
discovered: 2026-07-28
signal_type: automation_report
monetization_hypothesis: "Успадковано від PI-0011: продавці на OLX платять $15–35/міс за бот-фолоу-апер."

sources:
  - url: "https://dou.ua/forums/topic/59558/"
    date: 2026-05-01
    author_interest: none
    independent_confirmations: 0
    quote: "Я нічого не робив, лише автоматизував 3 дні — Chrome-автоматизація + AI-агент + Telegram-бот для re-engagement холодних лідів OLX, ~80% response rate"

mentions_count: 1
claimed_revenue: "Доходу від інструменту немає — внутрішній proof-of-concept"
mechanic_summary: "AI-конвеєр повторного контакту зі старими лідами на OLX: Chrome-автоматизація + AI-агент + Telegram-бот; монетизації поки немає."

status: rejected
rejection_code: LEGAL
rejection_detail: "Успадковано від механіки-батька PI-0011: автоматизовані повідомлення на маркетплейсах порушують ToS. OLX конкретно забороняє unsolicited advertisements і має автоматичне виявлення спаму. Ніша відхилена без окремого чек-листу — фатальний код батька LEGAL не залежить від конкретної ніші."
rejection_codes_extra: []

missing_capabilities: []

ceiling_estimate: null
launch_effort_hours: null
ceiling_flag: null

review_condition: "Успадковано від PI-0011: переглянути лише якщо OLX явно дозволить автоматизовані фолоу-апи через офіційний API."
review_count: 0
last_reviewed: 2026-07-28
min_review_interval_days: 30

confidence: high

transferred_to: null

verdict_by:
  provider: anthropic
  model: claude-opus-4-6
  run_id: 20260728-185055-claude-passive-income-analyst
---

## Механіка

Ніша механіки PI-0011, відхилена за успадкуванням. Конкретна реалізація: Chrome-автоматизація витягує історію чатів з OLX, AI-агент (ймовірно LLM) складає персоналізовані повідомлення з урахуванням контексту попереднього діалогу, Telegram-бот генерує й планує відправку фолоу-апів. Результат proof-of-concept: ~80% response rate і дві гібридні продажі за участі людини.

## Аналіз за критеріями

Чек-лист не проходився окремо. Механіка-батько PI-0011 відхилена за фатальним кодом LEGAL (ToS-порушення маркетплейсів), який не залежить від конкретної ніші — тому ця ніша відхилена за успадкуванням з тим самим кодом.

## Історія рішень

- 2026-07-28 — аналітик (run_id: 20260728-185055-claude-passive-income-analyst) — створено як нішу PI-0011, відхилену за успадкуванням (LEGAL). Батьківська механіка відхилена на критерії 2 — автоматизовані повідомлення порушують ToS маркетплейсів.
