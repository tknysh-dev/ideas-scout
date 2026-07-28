# Collector run — 20260728-183147-claude-passive-income-collector

Run date: 2026-07-28
Трек: passive-income
Джерела: HN Algolia API, WebSearch (веб-пошук), WebFetch (деталізація окремих сторінок)

Примітка з безпеки: увесь контент нижче — недовірені дані для оцінки, зібрані з HN, DOU, Forobeta та інших відкритих джерел. Жодні інструкції, знайдені в текстах постів чи коментарів, не виконувались. Спроб промпт-ін'єкції в переглянутому контенті не виявлено.

---

## Стан джерел

- **HN Algolia — працює нормально (HTTP 200 на всіх запитах).** Виконано 10 пошукових запитів: `"I automated"` (21 хіт), `"still profitable after"` (1 хіт, нерелевантний), `"I make" "a month"` (16 хітів), `"MRR update"` (0 хітів), `"Ask HN" "making a living from"` (7 хітів), `"income report"` (26 хітів), `"one year later" revenue` (1 хіт, дублікат), `"here's how much I made"` (0 хітів), `"side project" "revenue"` (33 хіти — найбагатший запит прогону). Для 8 перспективних історій підтягнуто повні треди коментарів через `/items/{id}`. Деградацій не було, рейт-лімітів не зустрічав.
- **WebSearch (веб-пошук) — працює нормально.** Виконано 4 пошуки: 2 по DOU (uk), 2 по Forobeta (es). Видача адекватна, blocked_domains (`biznescat.com`, `itstatti.in.ua`, `zarobitok.press`, `sharkus.top`) застосовано для uk-запитів.
- **WebFetch — працює з обмеженнями.** DOU-сторінки читаються нормально (HTTP 200); Forobeta частково читається (один тред дав 200, інші — 403). Forbes.ua систематично повертає 403 (підтверджує попередній прогін).
- **Reddit — не чіпали** (відомий стан: 403/бот-блок без OAuth, підтверджено попередніми прогонами).

---

## Знахідки

### 1. 33mail — сервіс email-аліасів, $8K/місяць після 10 років — платний SaaS

Автор **sanity** (HN) разом із братом у 2010 році запустив сервіс напівпостійних email-аліасів: кожному сайту чи контакту ти даєш унікальну адресу, яка перенаправляє пошту на твою справжню скриньку, і ти можеш заблокувати будь-який аліас у будь-який момент. За 10 років сервіс виріс із 50 реєстрацій на місяць до стабільного $8 тисяч MRR. Це класичний приклад «довгої гри» з побічним проєктом: автор підтримував продукт паралельно з основною роботою впродовж цілого десятиліття, і тільки на десятому році він досяг суттєвого доходу. Коментатори підтверджують реальне використання сервісу — один каже: «Hey, I'm a subscriber to this! Didn't expect to see it here.»

- **url**: https://news.ycombinator.com/item?id=25434753
- **дата поста**: 2020-12-15
- **автор**: sanity
- **signal_type**: income_claim
- **заявлений дохід (цитата)**: «After 10 years my side project has hit $8k/mo in revenue» — $8K/місяць MRR, email forwarding/alias сервіс
- **механіка**: платний SaaS для створення й керування email-аліасами, підписка; AI не задіяний
- **author_interest**: tool_vendor (сам оператор сервісу, але в контексті Show HN, не реклами)
- **independent_confirmations**: 1 (коментатор StavrosK підтверджує, що є підписником)
- **пакет+патерн**: en / income_claim / «side project» + «revenue», джерело HN Algolia (search_by_date)

### 2. WakaTime — трекер часу кодування, $10K MRR — SaaS для розробників

Автор **welder** (HN) побудував WakaTime — плагін для IDE, який автоматично вимірює, скільки часу ти кодиш у різних проєктах, мовах і файлах, і показує це на дашборді. Запущений як побічний проєкт, дійшов до $10 тисяч MRR. Продукт досі живий і активний (wakatime.com), має плагіни для десятків IDE. На HN пост набрав 399 балів, коментатори хвалять продукт і цитують фрази автора на кшталт «The best startup book is one you never open because you're too busy marketing and building your product». Стаття з деталями — на IndieHackers.

- **url**: https://news.ycombinator.com/item?id=15593589
- **дата поста**: 2017-10-31
- **автор**: welder
- **signal_type**: income_claim
- **заявлений дохід (цитата)**: «Reaching $10k monthly revenue with WakaTime, my SaaS side project»
- **механіка**: SaaS-плагін для IDE — автоматичний трекінг часу кодування з дашбордом, підписка freemium; AI не задіяний
- **author_interest**: tool_vendor
- **independent_confirmations**: 0 прямих підтверджень суми, але продукт публічний і добре відомий у dev-спільноті
- **пакет+патерн**: en / income_claim / «income report», джерело HN Algolia

### 3. Self-publishing (nішеві книги) — $400/місяць пасивного доходу — книговидання

Автор **aayushu** (Medium), інженер у Google, самостійно видав книгу-гайд з вступу до коледжу й отримує з неї ~$400/місяць пасивного доходу через Amazon. Основна робота вже зроблена — книга написана; дохід приходить автоматично від продажів. У коментарях інший розробник **boyter** додає свій досвід: «I wrote a book about Decoding CAPTCHAs. I collect about $35 a month from it without spending any additional time on it» — підтверджує патерн. Коментатори справедливо зауважують, що для інженера Google це мізерні гроші порівняно з зарплатою, але як модель пасивного доходу — це працює: зусилля одноразові, дохід — довготривалий.

- **url**: https://news.ycombinator.com/item?id=12775969 (стаття: https://medium.com/@aayushu/how-i-make-400-a-month-in-passive-income-by-self-publishing-68fa948edff5)
- **дата поста**: 2016-10-23
- **автор**: aayushu (Medium) / BlackJack (HN submitter)
- **signal_type**: income_claim
- **заявлений дохід (цитата)**: «How I make $400 a month in Passive Income by Self-Publishing» + коментар boyter: «$35 a month from it without spending any additional time on it»
- **механіка**: самовидання нішевих книг через Amazon (KDP); дохід від роялті; AI не задіяний (2016 рік)
- **author_interest**: none (основна робота — Google, книга — побічний проєкт, не продає курс чи сервіс)
- **independent_confirmations**: 1 (boyter у коментарях підтверджує аналогічну модель зі своєю CAPTCHA-книгою)
- **пакет+патерн**: en / income_claim / «I make» + «a month», джерело HN Algolia

### 4. Ask HN: Side project >$2K monthly revenue — агрегаційний тред (83 відповіді)

Тред від квітня 2023 року (530 балів, 83 коментарі верхнього рівня), де десятки розробників діляться побічними проєктами, що приносять більше $2K/місяць. Це тред того ж формату, що й «Anyone making a living from a paid API?» (44144473), який дав PI-0001…PI-0004, але тематично ширший. Нижче — ключові окремі кандидати з цього треду, кожен із яких є незалежним першоособовим свідченням.

- **url**: https://news.ycombinator.com/item?id=35567822
- **дата поста**: 2023-04-14
- **автор**: max_ (ініціатор треду)
- **signal_type**: income_claim (агрегований)
- **механіка**: агрегаційний тред з десятками незалежних першоособових свідчень; механіки варіюються (SaaS, API, open-source з рекламою, ігрові платформи)
- **author_interest**: різні (переважно tool_vendor)
- **independent_confirmations**: перехресні — у самому треді ~83 незалежні відповіді; прямих верифікацій окремих сум немає
- **пакет+патерн**: en / income_claim / «side project» + «revenue», джерело HN Algolia (search_by_date)

#### 4a. ScrapingFish — API для веб-скрейпінгу, $2K/місяць за 5-6 місяців

Із агрегаційного треду (35567822). **mateuszbuda** разом із партнером побудували ScrapingFish (scrapingfish.com) — API для веб-скрейпінгу з обходом блокувань. Дійшли до $2K/місяць за 5-6 місяців від ідеї. Окремо цікаво, що це ніша механіки PI-0001 (платний API) — той самий канал доставки й монетизації, але в іншій предметній області (скрейпінг, а не парсинг рецептів чи PDF).

- **url**: https://news.ycombinator.com/item?id=35567822 (коментар mateuszbuda)
- **signal_type**: income_claim
- **заявлений дохід (цитата)**: «it took us about 5-6 months from idea to $2k/month. It's still not our main source of income»
- **механіка**: платний API для веб-скрейпінгу, usage-based; AI не згадується; включає роботу з апаратним забезпеченням
- **author_interest**: tool_vendor
- **independent_confirmations**: 0

#### 4b. Buttondown — сервіс email-розсилок, >$2K MRR

**jmduke** побудував Buttondown (buttondown.email) — сервіс для ведення email-розсилок як побічний проєкт, паралельно з основною роботою інженера. Дійшов до $2K MRR приблизно за 2.5 роки, зараз працює над ним full-time. Цікавий тим, що шлях до $2K був повільним — не «launch → PMF → boom», а поступове зростання.

- **url**: https://news.ycombinator.com/item?id=35567822 (коментар jmduke)
- **signal_type**: income_claim
- **заявлений дохід (цитата)**: «It took...around two and a half years, I think, to hit $2k/mo MRR»
- **механіка**: SaaS для email-розсилок (newsletter), підписка; AI не задіяний
- **author_interest**: tool_vendor
- **independent_confirmations**: 0

#### 4c. HTTP Toolkit — інструмент для перехоплення/дебагу HTTP, >$2K MRR

**pimterry** побудував HTTP Toolkit (httptoolkit.com) — інструмент для розробників, що дозволяє перехоплювати, переглядати й модифікувати HTTP-трафік. Перевищив $2K MRR і зараз дає достатньо, щоб працювати над ним full-time. One-person show, open-source з платним планом.

- **url**: https://news.ycombinator.com/item?id=35567822 (коментар pimterry)
- **signal_type**: income_claim
- **заявлений дохід (цитата)**: «passed $2k a couple of years back... it's made enough money for me to work on it full time for a fair while now»
- **механіка**: developer tool (HTTP proxy/debugger), freemium з платною підпискою; AI не задіяний
- **author_interest**: tool_vendor
- **independent_confirmations**: 0

#### 4d. get-notes.com — open-source нотатник, $2K/місяць із реклами

**rubymamis** побудував кросплатформний нотатник з відкритим кодом (Qt C++) і заробляє ~$2K/місяць лише від реклами на лендинг-сторінці через органічний SEO-трафік. Планує додати підписку на Pro-функції, хоча код залишиться відкритим.

- **url**: https://news.ycombinator.com/item?id=35567822 (коментар rubymamis)
- **signal_type**: income_claim
- **заявлений дохід (цитата)**: «I earn about $2000 a month from ads on the landing page (organic SEO)»
- **механіка**: open-source десктопний застосунок, монетизація через рекламу на лендингу (не в самому додатку); AI не задіяний
- **author_interest**: tool_vendor
- **independent_confirmations**: 0

### 5. SongBox — музична дистрибуція для інді-артистів, £500/місяць — SaaS

Автор **gigamick** (HN) два з половиною роки будував SongBox (songbox.rocks) — інструмент для незалежних музикантів, який допомагає організувати й поширювати їхню музику. Дійшов до £500/місяць MRR після того, як під час COVID-2020 присвятив кілька місяців виправленню UX і ціноутворення. Пост набрав 647 балів — це дуже високий показник для такого скромного доходу, що говорить про те, як HN-спільнота цінує чесні, «маленькі» звіти без перебільшень.

- **url**: https://news.ycombinator.com/item?id=25372464
- **дата поста**: 2020-12-10
- **автор**: gigamick
- **signal_type**: income_claim
- **заявлений дохід (цитата)**: «After 2.5 years on my side project, it has hit £500/month revenue»
- **механіка**: SaaS для інді-музикантів (організація, дистрибуція треків), підписка; AI не задіяний
- **author_interest**: tool_vendor
- **independent_confirmations**: 0
- **пакет+патерн**: en / income_claim / «side project» + «revenue», джерело HN Algolia (search_by_date)

### 6. Calorize — додаток для трекінгу харчування з AI, $2600/місяць — мобільний SaaS

Авторка **Lialia Sakhno** (DOU), Full Stack (Laravel) інженерка в Landscape VC (Лондон), десять років тому створила Calorize як особистий проєкт, бо існуючі трекери калорій її не влаштовували. Монетизувала чотири місяці тому, зараз отримує ~$2600/місяць нетто з майже 600 платних підписок. У додатку є AI-асистент «Mira» (DeepSeek V4, GPT-4.5 mini). Авторка все робить сама: код, дизайн, маркетинг (170+ відео), підтримку. Дохід реальний, але це не пасивний дохід у чистому вигляді — авторка активно працює над продуктом щодня.

- **url**: https://dou.ua/forums/topic/60830/
- **дата поста**: ~2026-07 (точну дату не вказано в заголовку)
- **автор**: Lialia Sakhno
- **signal_type**: income_claim
- **заявлений дохід (цитата)**: «$2600 на місяць на четвертому місяці стартапу» / «Calorize — мій перший продукт, який заробляє. Але цьому проєкту майже 10 років.»
- **механіка**: мобільний SaaS (трекер харчування) з AI-асистентом, підписка через App Store та Monobank; AI задіяний (DeepSeek, GPT-4.5 mini, GPT-4o-transcribe)
- **author_interest**: tool_vendor (оператор продукту, але в контексті DOU-статті, де ділиться досвідом, а не рекламує)
- **independent_confirmations**: 0 прямих підтверджень суми
- **пакет+патерн**: uk / income_claim / «заробляю» + «на місяць», джерело WebSearch → DOU

### 7. AI sales loop для OLX — автоматизація повторного залучення «холодних» лідів — automation_report

Автор **Taras Prystavskyi** (CEO Happyusers, DOU) описав тридобовий експеримент з AI-конвеєром для повторного контакту зі старими клієнтами OLX (тими, хто колись питав про товар, але не купив). Конвеєр: Chrome-автоматизація витягує історію чатів з OLX, AI-агент складає повідомлення для A/B-тестування двох гіпотез, Telegram-бот генерує й планує фолоу-апи. Результат: ~80% response rate на одній гіпотезі, дві гібридні продажі за участі людини. Доходу від самого інструменту немає — це внутрішній proof-of-concept, але механіка (AI-рівідженмент «мертвих» лідів) вже існує як платний SaaS в інших (наприклад, Regie.ai, Outreach).

- **url**: https://dou.ua/forums/topic/59558/
- **дата поста**: ~2026-05
- **автор**: Taras Prystavskyi (CEO Happyusers)
- **signal_type**: automation_report
- **опис автоматизації (цитата)**: «Я нічого не робив, лише автоматизував 3 дні» — Chrome-автоматизація + AI-агент + Telegram-бот для re-engagement холодних лідів OLX, ~80% response rate
- **механіка**: AI-конвеєр повторного контакту з неактивними лідами маркетплейсу (OLX); монетизації поки немає
- **author_interest**: none (CEO свого бізнесу, але описує внутрішній експеримент, не продає інструмент)
- **independent_confirmations**: 0
- **пакет+патерн**: uk / automation_report / «автоматизував» + «собі», джерело WebSearch → DOU

### 8. Ask HN: Anyone making a living from just 1 app? — агрегаційний тред (28 відповідей, 2010)

Тред від жовтня 2010 року (118 балів, 28 коментарів верхнього рівня), де розробники мобільних/десктопних додатків діляться досвідом заробітку з одного продукту. Серед відповідей: **woid** (binaryage.com) — TotalFinder для macOS, що «covering my living expenses soon» через тиждень після запуску; **luckydude** — BitKeeper (прототип Git/Mercurial), «happily supporting a bunch of people»; **jzting** — дохід від iAd у простому flashlight-додатку; **jordo** (noodlecake.com) — Stick Golf, iPhone/iPad гра, що за два місяці перевищила дохід від основної роботи. Тред старий (2010), і більшість продуктів, ймовірно, мертві, але він підтверджує стійкість патерну «один solo-developer продукт = стабільний дохід» через роки.

- **url**: https://news.ycombinator.com/item?id=1772199
- **дата поста**: 2010-10-08
- **автор**: SomeoneAtHN (ініціатор треду)
- **signal_type**: income_claim (агрегований)
- **заявлений дохід (цитата)**: множинні відповіді від tool_vendor'ів: TotalFinder «covering my living expenses soon», Stick Golf «making more from it the last two months than my 'real' job»
- **механіка**: десктопні/мобільні додатки, одноразові ліцензії / iAd реклама; AI не задіяний (2010)
- **author_interest**: tool_vendor (усі відповідачі)
- **independent_confirmations**: перехресні — 28 незалежних відповідей; прямих верифікацій немає
- **пакет+патерн**: en / income_claim / «Ask HN: Anyone making a living from», джерело HN Algolia

---

## Відсіяно

- https://news.ycombinator.com/item?id=14656945 («Is it unethical for me to not tell my employer I've automated my job?», 685pts, 2017) — корпоративна автоматизація власної посади під конкретного роботодавця, класичний наратив «я автоматизував свою роботу і тепер просто сиджу», жодної переносимості на сторонніх клієнтів чи продукт.
- https://news.ycombinator.com/item?id=4692858 («How I automated the boring parts of life», 294pts, 2012) — особисті лайфхаки (пральня, підписки Amazon, віртуальні асистенти), не бізнес і не дохід.
- https://news.ycombinator.com/item?id=3192192 («How I automated my writing career», 142pts, 2011) — про інституційну автоматизацію журналістики (Narrative Science-тип), не першоособовий звіт; коментатори скептичні щодо назви.
- https://news.ycombinator.com/item?id=13893290 («I Automated My Friends and Nobody Could Tell the Difference», 63pts, 2017) — соціальний експеримент (бот відповідає замість автора в чатах), не пов'язаний із доходом чи продуктом.
- https://news.ycombinator.com/item?id=15061635 («How I Make $26K+ a Month Selling Onions», 17pts, 2017) — Reddit-пост (видалений), фізична торгівля цибулею, без техно-автоматизаційної складової.
- https://news.ycombinator.com/item?id=511935 («How I make 15K a month at AdSense», 145pts, 2009) — занадто старий (2009), AdSense-арбітраж іншої епохи, коментатори обговорюють ціни на хостинг рівня $300/міс.
- https://news.ycombinator.com/item?id=27537536 («How I automated my dotfiles screenshots», 15pts, 2021) — суто побутова автоматизація скріншотів конфігурації, жодної монетизації.
- https://news.ycombinator.com/item?id=41317396 («LLM Vision automated bin night alerts», 13pts, 2024) — домашня IoT-автоматизація (нагадування про смітник), не бізнес.
- HN «MRR update» (0 хітів) — мертвий патерн на HN Algolia; не дав жодного результату.
- HN «still profitable after» (1 хіт: Powerball ticket, нерелевантний) — мертвий патерн на HN.
- HN «here's how much I made» (0 хітів) — мертвий патерн на HN Algolia.
- https://forobeta.com/temas/como-gano-800-cada-dia-con-amazon-kdp-usando-inteligencia-artificial-para-escribir-libros.1043175/ («Gano $800 cada día con Amazon KDP usando IA», 2025) — спільнота масово скептична: «Como exageran los vende humos, todavía es creíble que pongan 80 dólares pero ya 800» (juvesu); піксельований скріншот доходу, жодних конкретних назв книг, маркетинговий тон. Дисквалифіковано як ймовірний vende humo.
- https://forobeta.com/temas/gano-mas-en-forobeta-que-siendo-ingeniera-en-mi-pais.883371/ («Gano más en Forobeta que siendo ingeniera», 2022) — загальне обговорення рівня доходів латиноамериканських фрілансерів, без конкретної механіки чи продукту.
- https://forobeta.com/temas/a-que-te-dedicas-y-cuanto-ganas.989932/ («¿A qué te dedicas y cuanto ganas?», 2024) — загальний тред із самозвітами ($10K ecommerce, $2180 IT director, $1000 Twitter management), але без конкретних технічних механік чи автоматизації; більше про рівень зарплат, ніж про пасивний дохід.
- https://dou.ua/forums/topic/59636/ («Як ми зекономили compliance команді десятки годин», 2026) — корпоративна автоматизація в Genesis (TypeScript+PostgreSQL+Svelte, Claude Code); внутрішні інструменти для великої компанії, не персональний продукт для продажу.
- https://dou.ua/forums/topic/60675/ («Інженерія якості без поділу на ролі», 2026) — методологічна стаття про QA-автоматизацію, не першоособовий звіт із результатами.
- https://dou.ua/forums/topic/59269/ («Як я витратив 2 роки на власний task-менеджер, і чому він не полетів», 2026) — цінний як anti-pattern (невдалий solo-продукт), але сам заголовок каже, що продукт не злетів — не income_claim і не automation_report.
- https://dou.ua/forums/topic/16897/ та /36530/ (DOU-обговорення «пасивний прибуток/дохід», 2016/2019) — загальні дискусії про концепцію пасивного доходу, без конкретних першоособових кейсів із цифрами.
- Дублікати з попередніх прогонів: HN 37326870, 42531695, 29994776, 6790394, 17265458, 20381180, 18924750, 32532430, 23978664, 48651700, 38388608 — усі вже задокументовані в `logs/runs/manual-20260715-automation-test.md` або `manual-20260715-collector.md`.
- Дублікати з реєстру: HN 44144473, 44145552, 44200762, 44148918, 44146681, 44146652, 44935238, 43049081 — уже зафіксовані в PI-0001…PI-0004 або попередніх прогонах.
- DOU 58772, 59007 — дублікати з `logs/runs/manual-20260715-lang-platform-test.md`.

---

## Оцінка нових патернів (ще не тестовані раніше)

| Патерн | Джерело | Хітів | Якісних | Вердикт |
|---|---|---|---|---|
| `"I make" "a month"` | HN Algolia | 16 | 1 (self-publishing $400/mo) | ⚠️ помірний: більшість хітів — питання про кар'єру/зарплату, не про продукт |
| `"MRR update"` | HN Algolia | 0 | 0 | ❌ мертвий патерн на HN |
| `"still profitable after"` | HN Algolia | 1 | 0 | ❌ мертвий (єдиний хіт — про лотерею Powerball) |
| `"income report"` | HN Algolia | 26 | 2-3 (Android dev reports серія, Candy Japan) | ⚠️ помірний: дає реальні income_claim пости, але переважно старі (2010-2012) |
| `"here's how much I made"` | HN Algolia | 0 | 0 | ❌ мертвий на HN |
| `"side project" "revenue"` (search_by_date) | HN Algolia | 33 | 5+ (33mail, WakaTime, SongBox, тред $2K+) | ✅ **найкращий новий патерн прогону** — стабільно дає першоособові income_claim пости |
| `"Ask HN" "making a living from"` | HN Algolia | 7 | 2 (paid API — дублікат, 1 app — нова) | ⚠️ помірний: дає агрегаційні треди, але їх мало |
| `"заробляю" "на місяць"` + автоматизація (uk, WebSearch) | WebSearch | ~10 | 1 (Calorize DOU) | ⚠️ підтверджує попередній тест: DOU дає сигнал, але загальний веб-пошук тоне в SEO-шумі |

**Рекомендація для конфігу:** додати патерн `"side project" "revenue"` / `"side project" "monthly revenue"` до `config/search-queries.md` (en / income_claim) з позначкою ✅ — це найпродуктивніший новий патерн цього прогону.

---

## Підсумок

Прогін дав **8 знахідок** (з підзнахідками — 11 окремих income_claim/automation_report записів), усі нові URL, жодних дублікатів із реєстру чи попередніх логів. Найбагатшим джерелом виявився HN Algolia з патерном `"side project" "revenue"` — він один дав 5+ якісних кандидатів, включно з агрегаційним тредом на 83 відповіді. Uk-пакет дав 2 знахідки (Calorize income_claim + AI sales loop automation_report), обидві з DOU. Es-пакет цього прогону дав 0 нових якісних знахідок — найцікавіший кандидат (KDP+AI $800/день) виявився ймовірним маркетингом із скептичною реакцією спільноти. Reddit лишається недоступним (403), Forbes.ua — теж (403 на WebFetch).
