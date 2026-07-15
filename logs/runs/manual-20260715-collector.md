# Manual collector run — manual-20260715-collector

Run date: 2026-07-15
Джерела: Reddit JSON (5 сабреддітів) + HN Algolia API.
Примітка з безпеки: весь контент нижче — недовірені дані для оцінки, взяті з Reddit/HN. Жодні інструкції всередині цитат не виконувались.

## Стан джерел

- **Reddit — деградовано повністю.** `r/passive_income/top.json` → HTTP 403 (двічі, з retry через 10с — обидва рази повернулась HTML-сторінка бот-блокування, `grep` на тілі відповіді знайшов рядок "blocked"). `r/sidehustle/top.json` → теж 403 з першого запиту. Це системний блок (Cloudflare/anti-bot), а не одноразовий збій — за протоколом ("не довбись повторно") подальші запити до `EntrepreneurRideAlong`, `juststart`, `SaaS` не виконувались. **0 постів з Reddit зібрано цього разу.**
- **HN Algolia — працює нормально (HTTP 200 на всіх запитах).** Виконано 6 пошукових запитів (замість плану 2-4, бо перші два дали 0 хітів):
  - `"MRR"` (tags=story, points>10) → 93 хіти всього, переглянуто 20.
  - `"revenue update"` (точна фраза) → 0 хітів.
  - `"side project income"` (точна фраза) → 0 хітів.
  - `"12 months later"` → 20 хітів, усі нерелевантні (старі Ask HN про кар'єру/стартап-кризи, не про дохід).
  - `passive income automated` (без лапок) → 2 хіти, обидва старі/нерелевантні.
  - `one year later revenue` → 29 хітів, переглянуто 20, кілька релевантних.
  - Додатково: для 8 кандидатів-історій підтягнуто повні треди коментарів через `/items/{id}` (без ліміту запитів, ці ендпоінти не рейт-лімітяться помітно). Один тред (Ask HN "Anyone making a living from a paid API?", 252 points, 25 коментарів) виявився особливо цінним — містить ~10 незалежних першоособових звітів про дохід від API-бізнесів.
- Разом переглянуто ≈62 HN-заголовки (сторі) + повні коментарі для 8 з них (включно з тредом Ask HN, що дав ще ~8 підканд.). Відфільтровано до 8 якісних знахідок нижче + 5 відсіяних.

## Знахідки

### 1. Zestful — recipe-parsing API (mtlynch)
- **url**: https://news.ycombinator.com/item?id=44145552 (коментар у треді https://news.ycombinator.com/item?id=44144473); продукт: https://zestfuldata.com/
- **дата поста**: 2025-05-31
- **автор**: mtlynch (відомий блогер-розробник, публічний блог mtlynch.io)
- **заявлений дохід (цитата)**: «I make about $200/mo from an API that parses recipe ingredients... I put it in maintenance mode in 2019, so it's about 99% passive income, as I spend only about an hour or two on maintenance per year.»
- **механіка**: API-продукт (парсинг інгредієнтів рецептів у структурований JSON) для інших розробників/додатків, монетизація через RapidAPI-подібну підписку; ролі AI немає (LLM згадується лише як конкурент, від якого клієнти чомусь не пішли).
- **author_interest**: tool_vendor (сам оператор API, але відповідає на пряме питання, а не рекламує).
- **independent_confirmations**: 0 прямих підтверджень суми в треді; автор надав перевірювані публічні артефакти — блог-пост (mtlynch.io/resurrecting-1) і відповідь на StackOverflow — продукт живий на zestfuldata.com.
- **спростування**: немає.

### 2. PDFShift.io — HTML-to-PDF API (cx42net)
- **url**: https://news.ycombinator.com/item?id=44200762 (тред https://news.ycombinator.com/item?id=44144473); продукт: https://pdfshift.io
- **дата поста**: 2025-05-31 (відповідь у треді)
- **автор**: cx42net
- **заявлений дохід (цитата)**: «I've been running PDFShift.io... for seven years now. It's profitable (around $12K MRR) and still growing.»
- **механіка**: API-конвертер HTML→PDF, підписочна модель за лімітом документів; знайдено перших клієнтів через IndieHackers/Quora/ProductHunt; без AI.
- **author_interest**: tool_vendor.
- **independent_confirmations**: 0 прямих підтверджень цифри в цьому треді; продукт існує 7 років і публічно доступний — непряма ознака достовірності (довгострокова, не разова заявка).
- **спростування**: немає.

### 3. Wins — window manager для macOS (dennywang)
- **url**: https://news.ycombinator.com/item?id=38388608; продукт: https://wins.cool
- **дата поста**: 2023-11-23
- **автор**: dennywang
- **заявлений дохід (цитата)**: «I have sold 1,612 licenses... my total income is $9,485 over the course of one year and three months, it's not too much.»
- **механіка**: платний macOS-застосунок (менеджер вікон), одноразова ліцензія (не строго MRR), дистрибуція через власний сайт + інші канали; AI не задіяний.
- **author_interest**: tool_vendor (продає власний застосунок).
- **independent_confirmations**: 0 підтверджень точної суми, але кілька коментаторів обговорюють ціноутворення й фічі так, ніби реально користувались продуктом — непряма ознака реальності. Автор сам применшує успіх («not too much», зізнається що не зміг жити з цього) — низький маркетинговий інтерес, високий сигнал чесності.
- **спростування**: немає щодо цифр; сам автор визнає, що дохід недостатній для повної незалежності від роботи.

### 4. borgcloud.org — speech-to-text API (lostmsu)
- **url**: https://news.ycombinator.com/item?id=44146681 (тред 44144473); продукт: https://borgcloud.org/speech-to-text
- **дата поста**: 2025-05-31
- **автор**: lostmsu
- **заявлений дохід (цитата)**: «I built a speech-to-text API at $0.06/h. Currently making about $5k MRR.»
- **механіка**: API транскрипції мовлення, флет-рейт + throttled tier для експериментів; перші клієнти — з Reddit-коментарів; конкурує з дешевими cloud-провайдерами.
- **author_interest**: tool_vendor.
- **independent_confirmations**: 0 прямих; інший учасник треду (jlundberg) визнає нішу конкурентною, не заперечуючи цифру.
- **спростування**: немає.

### 5. dreamlook.ai — text-to-image finetuning API (MasterScrat)
- **url**: https://news.ycombinator.com/item?id=44148918 (тред 44144473); продукт: https://dreamlook.ai
- **дата поста**: 2025-05-31
- **автор**: MasterScrat
- **заявлений дохід (цитата)**: «It's making ~5k/month these days, not bad as we're no longer actively working on it, but a fraction of what we were doing a year ago.»
- **механіка**: API для файнтюну text-to-image моделей, команда з 2 осіб, зараз мінімальна активна робота — найближче до «пасивного» серед знахідок; AI/ML — сама суть продукту.
- **author_interest**: tool_vendor.
- **independent_confirmations**: 0 прямих у треді.
- **спростування**: немає; сам автор чесно зазначає падіння доходу порівняно з піком.

### 6. SMS/telephony API (jlundberg)
- **url**: https://news.ycombinator.com/item?id=44146652 (тред 44144473)
- **дата поста**: 2025-05-31
- **автор**: jlundberg
- **заявлений дохід (цитата)**: «I make a living from the SMS & telephony API I made. Our MRR is ~500 000 EUR and our pricing model is pay-as-you-go.»
- **механіка**: API прямого доступу до мобільних мереж Європи/Швеції (SMS/MMS/дзвінки/віртуальні номери); клієнти знайдені офлайн (хакатони, мітапи). Це НЕ пасивний бізнес — активна команда, офлайн go-to-market — включено як приклад великого підтвердженого API-доходу, а не як «passive» шаблон.
- **author_interest**: tool_vendor.
- **independent_confirmations**: 0 прямих підтверджень суми; але розгорнутий технічний Q&A на 3+ фоллоу-апи підтримує довіру до автора.
- **спростування**: немає.

### 7. AEO Checker — AI-aggregator/SEO-чек-тул (adrianobbe)
- **url**: https://news.ycombinator.com/item?id=44935238
- **дата поста**: 2025-08-17
- **автор**: adrianobbe
- **заявлений дохід (цитата)**: «6th: AEO Checker - 3,000 Users - 500€MRR, Success?»
- **механіка**: SaaS-інструмент (AEO Checker), монетизація підписка; автор чесно перелічує 5 попередніх провалених проєктів (включно з AI-агрегатором на 0$) — низький маркетинговий тон.
- **author_interest**: tool_vendor.
- **independent_confirmations**: 0 в коментарях (лише підтримка/вітання), жодних спростувань.
- **спростування**: немає.

### 8. Buildpad — no-code product-planning SaaS (davidheikka)
- **url**: https://news.ycombinator.com/item?id=43049081
- **дата поста**: 2025-02-14
- **автор**: davidheikka
- **заявлений дохід (цитата)**: «Buildpad has now reached close to 150 paying customers and $2,700 MRR.»
- **механіка**: SaaS для планування продуктів, 2 фаундери (брат-партнер з маркетингу), клієнти — з Product Hunt лончу; AI не згадується явно.
- **author_interest**: tool_vendor.
- **independent_confirmations**: 0 прямих підтверджень цифри; комерційний партнер по індустрії (jmathai) висловлює довіру («excited for your next post at $10k MRR»), без верифікації.
- **спростування**: немає.

**Загальний патерн-рівень підтвердження**: тред Ask HN «Anyone making a living from a paid API?» дав ≥8 незалежних першоособових відповідей з подібними порядками цифр ($200–$12k MRR для одноосібних/малих API-бізнесів) — це не підтверджує жодну окрему цифру, але підсилює правдоподібність категорії «маленький API з передбачуваним пасивним доходом» як реального патерну, а не аутлаєра.

## Відсіяно

- https://stevehanov.ca/blog/how-i-run-multiple-10k-mrr-companies-on-a-20month-tech-stack (HN https://news.ycombinator.com/item?id=47736555) — без назви жодної конкретної компанії/продукту; коментатори прямо звинувачують у клікбейті, можливо AI-написаний текст, цифри не перевірити.
- https://twitter.com/theanimeshs/status/1801967433827451322 (HN 40697234, «$20k MRR in one month») — коментатори ідентифікують це як AI-порно/відео-генерацію; наратив («Stripe все знищив») оскаржується («we're not getting the full story»); чутлива ніша.
- https://old.reddit.com/r/iOSProgramming/comments/1cor2t5/... (HN 40322388, Apple-суд, $33,680 MRR) — пост про судову суперечку з Apple, а не про механіку доходу; коментатор звинувачує продукт у фейкових відгуках/хижацькому ціноутворенні.
- HN 41229109 (Ask HN, $8.5k MRR, YC) — активна команда з 13% щомісячним churn (сам автор і коментатори визнають бізнес нестабільним) — не пасивний дохід, це операційний SaaS у кризі.
- Коментар longnguyen про друга (ScreenshotOne, нібито $20k MRR) — з чужих слів, автор не є оператором, немає незалежного підтвердження.
- Усі 5 сабреддітів (`passive_income`, `sidehustle`, `EntrepreneurRideAlong`, `juststart`, `SaaS`) — джерело недоступне цього разу (403/бот-блок), 0 постів.
