# Analyst run — 20260728-185055-claude-passive-income-analyst

Run date: 2026-07-28
Трек: passive-income
Модель: claude-opus-4-6 (Anthropic)
Criteria version: v0.3

---

## Вхідні дані

- **Збирач:** `logs/runs/20260728-183147-claude-passive-income-collector.md` — 11 знахідок (8 основних + 3 підзнахідки).
- **Записи зі status: new у реєстрі:** 0.
- **Оброблено:** 5 знахідок (ліміт прогону).
- **Лишилося необроблених:** 6 знахідок у лозі збирача (WakaTime, Buttondown, HTTP Toolkit, get-notes.com, SongBox, Ask HN 2010 thread).

---

## Дайджест

| ID | Назва | Статус | Код | Confidence |
|---|---|---|---|---|
| PI-0005 | Web-scraping API (ScrapingFish-тип) | rejected | AUTONOMY | medium |
| PI-0006 | Indie SaaS-продукт (механіка) | approved_pending | — | medium |
| PI-0007 | Email-alias сервіс (33mail-тип) | rejected | SATURATED | high |
| PI-0008 | Трекер калорій з AI (Calorize-тип) | rejected | AUTONOMY | medium |
| PI-0009 | Самовидання цифрового контенту (механіка) | approved_pending | — | medium |
| PI-0010 | Нішева нон-фікшн книга на Amazon KDP | approved_pending | — | medium |
| PI-0011 | AI-автоматизація повідомлень на маркетплейсах (механіка) | rejected | LEGAL | high |
| PI-0012 | AI OLX lead re-engagement | rejected | LEGAL (усп.) | high |

---

## Записи approved_pending (на ручну оцінку власника)

- **PI-0006** — механіка-контейнер «Indie SaaS-продукт». Критерії 1–2 пройдено. Чекає на оцінку конкретних ніш.
- **PI-0009** — механіка-контейнер «Самовидання цифрового контенту». Критерії 1–2 пройдено.
- **PI-0010** — нішева нон-фікшн книга на Amazon KDP. Усі критерії 1–5 пройдено. **ceiling_flag: review** — стеля ~€200–350/міс за одну книгу, запуск ~100 годин. Чи варта гра свічок — рішення за тобою.

## Записи з ceiling_flag: review

- **PI-0010** — Amazon KDP: €200–350/міс, 100 годин запуску. Аналогічно до PI-0002 (Zestful): стеля низька, але автономність 5/5 (нуль годин підтримки після публікації).

---

## Підсумок

Із 5 оброблених знахідок — 5 відхилень на рівні ніш (AUTONOMY ×2, SATURATED ×1, LEGAL ×2) і 1 нішевий approved_pending (PI-0010 KDP). Дві нові механіки-контейнери (PI-0006, PI-0009) пройшли критерії 1–2 і чекають на конкретні ніші. Одна механіка (PI-0011 AI marketplace messaging) відхилена на рівні механіки (LEGAL), що автоматично закриває всі ніші під нею.

Загалом у реєстрі тепер 12 записів: 4 approved_pending (PI-0001, PI-0002, PI-0006, PI-0009 — контейнери; PI-0010 — ніша), 8 rejected. Серед ніш із реальним вердиктом: PI-0002 і PI-0010 — approved_pending, решта — відхилені.
