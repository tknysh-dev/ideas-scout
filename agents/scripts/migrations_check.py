"""migrations_check.py — статична звірка shared/migrations/ зі shared/schema.sql
і перевірка того, що кожну міграцію можна накотити повторно без шкоди.

Дрейф тут тихий так само, як і в doctor_schema.py: apply.sh накочує міграцію
на бойову базу вручну, а schema.sql — файл, написаний людиною, який після
цього треба оновити окремим редагуванням. Ніщо не примушує це зробити.
Реальний випадок: список кодів rejection_code у 2026-08-03-no-market-
rejection-code.sql отримав NO_MARKET, а десь поруч (портал) лишався старий
перелік, і розсинхрон виявили лише вручну.

Живої бази тут немає (на відміну від doctor_schema.py) — усе нижче звіряє
самі файли між собою:

1. Кожна таблиця/колонка, яку вводить чи додає міграція (CREATE TABLE /
   ALTER TABLE ... ADD COLUMN), має бути присутня в schema.sql — розбір тексту
   перевикористовується з doctor_schema.parse_schema (той самий регекс-парсер,
   а не другий).
2. Кожен перелік значень CHECK-констрейнта, що його вводить чи змінює
   міграція, має символ-у-символ збігатися з переліком у schema.sql.
3. Імена файлів міграцій — формат 'YYYY-MM-DD-опис.sql', і сортування за
   іменем збігається з хронологією застосування.
4. Ідемпотентність: чи можна накотити ту саму міграцію двічі. Справжня
   перевірка потребує бази (psql/pg_ctl доступні на цій машині, але
   міграції розраховані на інфраструктуру Supabase — ролі authenticated/
   service_role, публікація supabase_realtime — яких на голому Postgres
   нема, і відтворювати їх тут означало б тестувати вигадану обв'язку, а не
   реальний накат). Замість цього — статичний розбір: конструкції, що
   безумовно валяться при повторному запуску (CREATE TABLE, ALTER TABLE ...
   ADD COLUMN, CREATE INDEX без IF NOT EXISTS; CREATE POLICY/TRIGGER, для
   яких Postgres такого синтаксису взагалі не має) дають warn з поясненням,
   яка саме інструкція небезпечна.

Конструкції, які не вдалось розпізнати жодним із правил вище, друкуються як
note, а не зникають мовчки.

Викликається з doctor.sh; друкує рядки "рівень<TAB>повідомлення".
"""

from __future__ import annotations

import os
import re

import doctor_schema as ds

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MIGRATIONS_DIR = os.path.join(REPO_ROOT, "shared", "migrations")
SCHEMA_FILE = os.path.join(REPO_ROOT, "shared", "schema.sql")

FILENAME_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*\.sql$")

Message = tuple[str, str]  # (рівень, повідомлення)


# ---------------------------------------------------------------------------
# Розбір переліків значень CHECK-констрейнтів
# ---------------------------------------------------------------------------
# doctor_schema.parse_schema навмисно не розбирає CHECK (там сказано прямо:
# типи й констрейнти звіряти не варте регекс-парсера на весь файл), тому тут
# — окремий, вузько прицільний розбір саме `<col> in (<список>)`, з тими
# самими хелперами (_find_matching_paren), щоб не плодити свій алгоритм
# балансування дужок.

_CHECK_IN_RE = re.compile(r"check\s*\(\s*(\w+)\s+in\s*\(([^()]+)\)\s*\)", re.IGNORECASE)
_ALTER_ADD_CONSTRAINT_CHECK_RE = re.compile(
    r"alter\s+table\s+(\w+)\s+add\s+constraint\s+\w+\s+check\s*\(\s*(\w+)\s+in\s*\(([^()]+)\)\s*\)",
    re.IGNORECASE,
)


def _parse_value_list(raw: str) -> frozenset[str]:
    return frozenset(v.strip().strip("'") for v in raw.split(",") if v.strip())


def extract_value_checks(text: str) -> dict[tuple[str, str], frozenset[str]]:
    """Повертає {(таблиця, колонка): {дозволені значення}} — з CREATE TABLE
    inline `col ... check (col in (...))` і з `ALTER TABLE ... ADD CONSTRAINT
    ... CHECK (col in (...))`. Останній переможе, якщо обидві форми зустрілись
    для тієї самої (таблиця, колонка) в одному тексті — саме так і буває:
    ALTER йде пізніше в тому самому файлі, коли констрейнт спершу створили,
    а потім тут-таки замінили (2026-07-30-accepted-status.sql)."""
    text = ds._strip_comments(text)
    result: dict[tuple[str, str], frozenset[str]] = {}

    for m in re.finditer(r"create table\s+(?:if not exists\s+)?(\w+)\s*\(", text, re.IGNORECASE):
        table = m.group(1)
        open_idx = m.end() - 1
        end_idx = ds._find_matching_paren(text, open_idx)
        if end_idx is None:
            continue
        body = text[open_idx + 1 : end_idx]
        for cm in _CHECK_IN_RE.finditer(body):
            col, raw_vals = cm.group(1), cm.group(2)
            result[(table, col)] = _parse_value_list(raw_vals)

    for m in _ALTER_ADD_CONSTRAINT_CHECK_RE.finditer(text):
        table, col, raw_vals = m.group(1), m.group(2), m.group(3)
        result[(table, col)] = _parse_value_list(raw_vals)

    return result


def migration_files() -> list[str]:
    if not os.path.isdir(MIGRATIONS_DIR):
        return []
    return sorted(f for f in os.listdir(MIGRATIONS_DIR) if f.endswith(".sql"))


def read_text(path: str) -> str | None:
    try:
        with open(path, encoding="utf-8") as handle:
            return handle.read()
    except OSError:
        return None


# ---------------------------------------------------------------------------
# 1+2. Дрейф schema.sql від міграцій: таблиці/колонки і переліки CHECK
# ---------------------------------------------------------------------------

def check_schema_drift(schema_text: str, migrations: list[tuple[str, str]]) -> list[Message]:
    """migrations — [(ім'я_файлу, текст)] у хронологічному порядку (як
    застосовуються). Пізніша міграція, що чіпає ту саму (таблиця, колонка),
    переозначає очікуване значення — так само, як на реальній базі."""
    out: list[Message] = []

    schema_tables, _schema_unparsed = ds.parse_schema(schema_text)
    schema_checks = extract_value_checks(schema_text)

    expected_checks: dict[tuple[str, str], tuple[frozenset[str], str]] = {}
    for name, text in migrations:
        for (table, col), values in extract_value_checks(text).items():
            expected_checks[(table, col)] = (values, name)

        migration_tables, _migration_unparsed = ds.parse_schema(text)
        for table, cols in migration_tables.items():
            missing = sorted(cols - schema_tables.get(table, set()))
            if missing:
                out.append((
                    "err",
                    (f"{name}: {table}({', '.join(missing)}) додано міграцією, "
                    "але немає в shared/schema.sql — schema.sql відстав від міграцій"),
                ))

    for (table, col), (expected, source_migration) in expected_checks.items():
        actual = schema_checks.get((table, col))
        if actual is None:
            out.append((
                "err",
                (f"{source_migration}: CHECK на {table}.{col} задає перелік значень "
                f"({', '.join(sorted(expected))}), але в shared/schema.sql такого CHECK немає "
                "— schema.sql відстав від міграції"),
            ))
        elif actual != expected:
            missing_in_schema = sorted(expected - actual)
            extra_in_schema = sorted(actual - expected)
            detail = []
            if missing_in_schema:
                detail.append(f"немає в schema.sql: {', '.join(missing_in_schema)}")
            if extra_in_schema:
                detail.append(f"є в schema.sql, немає в міграції: {', '.join(extra_in_schema)}")
            out.append((
                "err",
                (f"{source_migration}: перелік CHECK на {table}.{col} розійшовся зі shared/schema.sql "
                f"({'; '.join(detail)}) — саме такий розсинхрон уже стався з rejection_code/NO_MARKET"),
            ))

    return out


# ---------------------------------------------------------------------------
# 3. Формат і хронологія імен файлів
# ---------------------------------------------------------------------------

def check_filenames(filenames: list[str]) -> list[Message]:
    out: list[Message] = []
    dated: list[tuple[str, str]] = []  # (YYYY-MM-DD, ім'я файлу)

    for name in filenames:
        m = FILENAME_RE.match(name)
        if not m:
            out.append((
                "err",
                (f"{name}: ім'я файлу не відповідає формату 'YYYY-MM-DD-опис.sql' "
                "— порядок застосування міграцій неоднозначний"),
            ))
            continue
        year, month, day = m.group(1), m.group(2), m.group(3)
        if not (1 <= int(month) <= 12 and 1 <= int(day) <= 31):
            out.append(("err", f"{name}: дата в імені файлу некоректна ({year}-{month}-{day})"))
            continue
        dated.append((f"{year}-{month}-{day}", name))

    if sorted(dated) != dated:
        out.append((
            "err",
            ("файли міграцій у shared/migrations/ не відсортовані за датою в імені "
            "— alphabetical-порядок каталогу розійшовся б із хронологією застосування"),
        ))

    seen_dates: dict[str, list[str]] = {}
    for date, name in dated:
        seen_dates.setdefault(date, []).append(name)
    for date, names in seen_dates.items():
        if len(names) > 1:
            out.append((
                "note",
                (f"кілька міграцій на одну дату {date}: {', '.join(names)} — порядок між ними "
                "визначає лише алфавіт назв, перевір вручну, що це не має значення"),
            ))

    return out


# ---------------------------------------------------------------------------
# 4. Статична ідемпотентність
# ---------------------------------------------------------------------------

_DANGEROUS_RULES = (
    # (регекс на весь statement, з якого дістаємо ім'я, шаблон повідомлення)
    (
        re.compile(r"^\s*create\s+table\s+(?!if\s+not\s+exists\b)(\w+)", re.IGNORECASE),
        ("CREATE TABLE {name} без IF NOT EXISTS — повторний накат впаде на "
        "'relation \"{name}\" already exists'"),
    ),
    (
        re.compile(
            r"^\s*create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?!if\s+not\s+exists\b)(\w+)",
            re.IGNORECASE,
        ),
        ("CREATE INDEX {name} без IF NOT EXISTS — повторний накат впаде на "
        "'relation \"{name}\" already exists'"),
    ),
    (
        re.compile(r"^\s*create\s+policy\s+(\w+)", re.IGNORECASE),
        ("CREATE POLICY {name} — у Postgres немає IF NOT EXISTS для policy; повторний "
        "накат впаде на 'policy already exists', якщо файл не робить DROP POLICY IF EXISTS перед цим"),
    ),
    (
        re.compile(r"^\s*create\s+trigger\s+(\w+)", re.IGNORECASE),
        ("CREATE TRIGGER {name} без CREATE OR REPLACE TRIGGER — повторний накат впаде на "
        "'trigger already exists', якщо файл не робить DROP TRIGGER IF EXISTS перед цим"),
    ),
    (
        re.compile(r"^\s*insert\s+into\s+(\w+)(?![\s\S]*\bon\s+conflict\b)", re.IGNORECASE),
        "INSERT INTO {name} без ON CONFLICT — повторний накат задублює рядки",
    ),
)


def _strip_dollar_quoted_bodies(text: str) -> str:
    """Прибирає тіла CREATE [OR REPLACE] FUNCTION/DO $$ ... $$ — усередині
    них повно ';', які інакше рвуть _split_statements на нерелевантні шматки,
    і сам вміст функції/DO-блоку — не top-level DDL, який тут перевіряється.

    LANGUAGE-клауза в Postgres може стояти як до 'as $$', так і після
    закриваючого '$$' — тому межа статичного вирізання не прив'язана до
    ключового слова 'language', а йде до першої ';' після закриваючого $$."""
    text = re.sub(
        r"create\s+(?:or\s+replace\s+)?function\b.*?\$\$.*?\$\$[^;]*;",
        "",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    return re.sub(r"\bdo\s*\$\$.*?\$\$[^;]*;", "", text, flags=re.IGNORECASE | re.DOTALL)


def check_idempotency(text: str, filename: str) -> list[Message]:
    out: list[Message] = []
    stripped = ds._strip_comments(text)
    stripped = _strip_dollar_quoted_bodies(stripped)

    # ALTER TABLE ... ADD COLUMN / ADD CONSTRAINT / DROP COLUMN розбираються
    # по клаузах (можуть бути в одному стейтменті через кому), тому окремо.
    for m in re.finditer(r"alter\s+table\s+(\w+)\s+([^;]*);", stripped, re.IGNORECASE):
        table, body = m.group(1), m.group(2)
        for raw_clause in ds._split_top_level(body):
            clause = raw_clause.strip()
            col = re.match(r"add\s+column\s+(?!if\s+not\s+exists\b)(\w+)", clause, re.IGNORECASE)
            if col:
                out.append((
                    "warn",
                    (f"{filename}: ALTER TABLE {table} ADD COLUMN {col.group(1)} без IF NOT EXISTS "
                    "— повторний накат впаде на 'column already exists'"),
                ))
            dropcol = re.match(r"drop\s+column\s+(?!if\s+exists\b)(\w+)", clause, re.IGNORECASE)
            if dropcol:
                out.append((
                    "warn",
                    (f"{filename}: ALTER TABLE {table} DROP COLUMN {dropcol.group(1)} без IF EXISTS "
                    "— повторний накат впаде на 'column does not exist'"),
                ))
            addcon = re.match(r"add\s+constraint\s+(\w+)", clause, re.IGNORECASE)
            if addcon:
                name = addcon.group(1)
                # drop-потім-add тим самим іменем в одному файлі — визнаний
                # безпечний патерн цього репозиторію (напр. 2026-08-03): після
                # першого накату констрейнт існує під тим самим іменем, тож
                # другий накат так само drop-не (успішно) і add-не (успішно).
                if not re.search(rf"drop\s+constraint\s+{re.escape(name)}\b", stripped, re.IGNORECASE):
                    out.append((
                        "warn",
                        (f"{filename}: ALTER TABLE {table} ADD CONSTRAINT {name} без відповідного "
                        "DROP CONSTRAINT цього ж імені в файлі — повторний накат впаде на "
                        "'constraint already exists'"),
                    ))

    for stmt in ds._split_statements(stripped):
        for rule_re, template in _DANGEROUS_RULES:
            rm = rule_re.match(stmt)
            if rm:
                out.append(("warn", f"{filename}: " + template.format(name=rm.group(1))))

    return out


# ---------------------------------------------------------------------------
# Нерозпізнані конструкції — щоб нічого не зникало мовчки
# ---------------------------------------------------------------------------

_RECOGNIZED_MIGRATION_STATEMENT = re.compile(
    r"^\s*("
    r"begin|commit|rollback|"
    r"create (or replace )?function|"
    r"create (unique )?index|"
    r"create trigger|"
    r"create policy|"
    r"create table|"
    r"alter table|"
    r"alter publication|"
    r"drop (table|function|trigger|policy|index)|"
    r"comment on|"
    r"update|insert|delete|"
    r"do\s*\$\$"
    r")",
    re.IGNORECASE,
)


def scan_unrecognized(text: str, filename: str) -> list[Message]:
    stripped = ds._strip_comments(text)
    stripped = _strip_dollar_quoted_bodies(stripped)
    out: list[Message] = []
    for stmt in ds._split_statements(stripped):
        s = stmt.strip()
        if not s:
            continue
        if not _RECOGNIZED_MIGRATION_STATEMENT.match(s):
            snippet = re.sub(r"\s+", " ", s)[:120]
            out.append(("note", f"{filename}: нерозпізнана конструкція — «{snippet}»"))
    return out


# ---------------------------------------------------------------------------

def run() -> list[Message]:
    out: list[Message] = []

    schema_text = read_text(SCHEMA_FILE)
    if schema_text is None:
        return [("err", f"немає {SCHEMA_FILE} — джерела правди про схему немає, звірку неможливо провести")]

    names = migration_files()
    if not names:
        out.append(("note", f"у {MIGRATIONS_DIR} немає файлів .sql — звіряти нічого"))
        return out

    out.extend(check_filenames(names))

    migrations: list[tuple[str, str]] = []
    for name in names:
        text = read_text(os.path.join(MIGRATIONS_DIR, name))
        if text is None:
            out.append(("err", f"{name}: не вдалось прочитати файл міграції"))
            continue
        migrations.append((name, text))

    drift = check_schema_drift(schema_text, migrations)
    out.extend(drift)
    if not drift:
        out.append(("ok", (
            f"schema.sql узгоджений з {len(migrations)} міграціями: "
            "усі додані таблиці/колонки й переліки CHECK збігаються"
        )))

    idempotency_warnings = 0
    for name, text in migrations:
        msgs = check_idempotency(text, name)
        idempotency_warnings += len(msgs)
        out.extend(msgs)
    if idempotency_warnings == 0:
        out.append(("ok", (
            f"статичний аналіз ідемпотентності: {len(migrations)} міграцій "
            "без явно небезпечних конструкцій (CREATE TABLE/ADD COLUMN/INDEX без "
            "IF NOT EXISTS, CREATE POLICY/TRIGGER без DROP IF EXISTS)"
        )))

    out.append(("note", (
        "справжня ідемпотентність (повторний накат на реальній базі) тут не "
        "перевіряється: міграції розраховані на інфраструктуру Supabase (ролі "
        "authenticated/service_role, публікація supabase_realtime), якої на голому "
        "локальному Postgres нема — psql/pg_ctl на цій машині є, але відтворення цієї "
        "обв'язки означало б тестувати вигадану інфраструктуру, а не реальний накат"
    )))

    for name, text in migrations:
        out.extend(scan_unrecognized(text, name))

    return out


def main() -> None:
    for level, message in run():
        print(f"{level}\t{message}")


if __name__ == "__main__":
    main()
