---
# Схема запису ідеї. Джерело: PLAN.md, Фаза 1 + «Рекомендації рецензії» (прогалини схеми).
# Усі значення нижче — плейсхолдери. Замінити при створенні реального запису.

schema_version: 1              # версія цієї схеми frontmatter; підняти при зміні полів
criteria_version: "v0.1"       # версія config/criteria-<track>.md, за якою винесено вердикт

id: PI-0000                    # префікс треку (PI = passive-income, APP = app-ideas) + номер
parent_id: null                # null для механіки-батька; ID механіки для ніші-дитини
title: "..."
type: mechanic                 # mechanic | niche — дворівнева модель: механіка → ніші/варіації
discovered: 2026-07-20         # дата першого виявлення (YYYY-MM-DD)

sources:
  - url: "..."
    date: 2026-07-18           # дата публікації джерела (YYYY-MM-DD)
    author_interest: none       # none | affiliate | course_seller | tool_vendor
    independent_confirmations: 0 # кількість незалежних підтверджень цифр у коментарях/інших джерелах
    quote: "..."                # архівна цитата ключової цифри/твердження (страхує від гниття URL)

mentions_count: 1               # інкрементується при кожній дедуплікації на цю ж механіку/нішу
claimed_revenue: "..."          # заявлений дохід одним рядком, без нормалізації
mechanic_summary: "..."         # одне речення: канал + монетизація + роль AI

status: new                     # new | analyzing | rejected | approved_pending | active | parked | transferred
rejection_code: null             # SOURCE_SUSPECT | LEGAL | CAPABILITY_GAP | CAPITAL | AUTONOMY | SATURATED | null
rejection_detail: "..."          # людською мовою, чому саме цей код

missing_capabilities:            # посилання на розділи catalogs/ai-capabilities.md; порожньо, якщо немає
  - "anthropic/desktop/..."

review_condition: "..."          # людською мовою: за якої зміни переглянути цей запис
review_count: 0                  # скільки разів ревізор уже повертав запис у new
last_reviewed: 2026-07-20        # дата останнього перегляду (YYYY-MM-DD)
min_review_interval_days: 30     # захист від зациклення ревізора

confidence: low                  # high | medium | low — впевненість вердикту; low → ручна перевірка

transferred_to: null              # ID запису в іншому реєстрі, якщо перенесено (напр. APP-0013); інакше null

verdict_by:                       # провенанс вердикту — хто саме його виніс
  provider: null                  # claude | codex | null (якщо запис ще не проаналізовано)
  model: null                     # напр. claude-sonnet-5, gpt-5.4-mini
  run_id: null                    # ідентифікатор прогону (timestamp+провайдер), що виніс вердикт
---

## Механіка

<!-- Опис механіки одним-двома абзацами: канал доставки, спосіб монетизації, роль AI. -->

## Аналіз за критеріями

<!-- Прохід по чек-листу config/criteria-<track>.md: пункт за пунктом, з висновком по кожному до першого фатального провалу. -->

## Історія рішень

<!-- Хронологічний список: дата — хто/який джоб — що змінилось у статусі/вердикті — чому. -->
