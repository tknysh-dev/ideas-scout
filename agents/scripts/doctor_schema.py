"""doctor_schema.py — звірка shared/schema.sql з реальною схемою в Supabase.

shared/schema.sql — джерело правди про схему БД, а міграції в
shared/migrations/ накочуються вручну через apply.sh: ніщо не примушує
застосувати міграцію на кожній машині чи оновити schema.sql після того, як
її застосували. Дрейф тихий — до першого запису в невідому колонку вночі.

Реальну схему дістаємо з OpenAPI-опису, який PostgREST віддає на корені
REST-ендпоінта (GET $SUPABASE_URL/rest/v1/): ключ "definitions" містить по
одному об'єкту на таблицю з "properties" — назвами колонок. Той самий
SUPABASE_URL/SUPABASE_SERVICE_KEY і той самий env-файл, що й у db.sh/db.py.

Типи колонок навмисно НЕ звіряються: SQL-типи (text, timestamptz, jsonb) і
типи OpenAPI-схеми PostgREST мапляться неоднозначно (наприклад text[] і
jsonb в описі виглядають однаково), тож звірка обмежена існуванням таблиць і
назв колонок — це явно сказано в повідомленні нижче, щоб не створювати
хибного відчуття повноти.

shared/schema.sql — файл, написаний людиною, повного SQL-парсера він не
вартий. Таблиці й колонки витягуються регулярками з CREATE TABLE( ... ) та
ALTER TABLE ... ADD COLUMN; усе інше (індекси, policy, тригери, функції,
ALTER ... ADD CONSTRAINT/ENABLE RLS, коментарі) розпізнається і свідомо
ігнорується. Що лишилось нерозпізнаним — не мовчки відкидається, а йде в
окремий рядок note, бо мовчазний пропуск тут — та сама хвороба, яку ця
перевірка мала б лікувати.

Викликається з doctor.sh; друкує рядки "рівень<TAB>повідомлення".
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCHEMA_FILE = os.path.join(REPO_ROOT, "shared", "schema.sql")
ENV_FILE = os.environ.get("IDEAS_SCOUT_ENV_FILE", os.path.expanduser("~/.config/ideas-scout/env"))
REQUEST_TIMEOUT_S = 10

# Перший ідентифікатор top-level сегмента всередині CREATE TABLE(...), що
# означає табличний констрейнт, а не колонку (у поточній схемі таких немає,
# але вони можуть з'явитись).
TABLE_LEVEL_KEYWORDS = {"constraint", "check", "primary", "unique", "foreign", "exclude", "like"}

lines: list[str] = []


def say(level: str, message: str) -> None:
    lines.append(f"{level}\t{message}")


# ---------------------------------------------------------------------------
# Розбір shared/schema.sql
# ---------------------------------------------------------------------------

def _strip_comments(text: str) -> str:
    """Вирізає `-- ...` до кінця рядка, не займаючи лапок: коментарі в схемі
    самі містять коми й дужки ('PI-0001, APP-0013'), і якщо їх не прибрати
    заздалегідь, вони збивають підрахунок top-level ком і дужок нижче."""
    out = []
    in_str = False
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if in_str:
            out.append(ch)
            if ch == "'":
                if i + 1 < n and text[i + 1] == "'":
                    out.append(text[i + 1])
                    i += 1
                else:
                    in_str = False
        elif ch == "'":
            in_str = True
            out.append(ch)
        elif ch == "-" and i + 1 < n and text[i + 1] == "-":
            nl = text.find("\n", i)
            if nl == -1:
                break
            out.append("\n")
            i = nl + 1
            continue
        else:
            out.append(ch)
        i += 1
    return "".join(out)


def _find_matching_paren(text: str, open_idx: int) -> int | None:
    """Індекс дужки, що закриває text[open_idx] == '(', з урахуванням рядків
    у лапках (щоб дужка чи кома всередині '...' не збивали підрахунок)."""
    depth = 0
    in_str = False
    i = open_idx
    n = len(text)
    while i < n:
        ch = text[i]
        if in_str:
            if ch == "'":
                if i + 1 < n and text[i + 1] == "'":
                    i += 1
                else:
                    in_str = False
        elif ch == "'":
            in_str = True
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return None


def _split_top_level(body: str) -> list[str]:
    """Ділить тіло CREATE TABLE(...) на колонки/констрейнти по комах поза
    вкладеними дужками й рядковими літералами."""
    parts = []
    depth = 0
    in_str = False
    buf: list[str] = []
    i = 0
    n = len(body)
    while i < n:
        ch = body[i]
        if in_str:
            buf.append(ch)
            if ch == "'":
                if i + 1 < n and body[i + 1] == "'":
                    buf.append(body[i + 1])
                    i += 1
                else:
                    in_str = False
        elif ch == "'":
            in_str = True
            buf.append(ch)
        elif ch == "(":
            depth += 1
            buf.append(ch)
        elif ch == ")":
            depth -= 1
            buf.append(ch)
        elif ch == "," and depth == 0:
            parts.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
        i += 1
    if buf:
        parts.append("".join(buf))
    return parts


_RECOGNIZED_STATEMENT = re.compile(
    r"^\s*("
    r"comment on|"
    r"create (or replace )?function|"
    r"create (unique )?index|"
    r"create trigger|"
    r"create policy|"
    r"alter table\s+\w+\s+enable row level security|"
    r"alter table\s+\w+\s+add constraint|"
    r"alter table\s+\w+\s+drop constraint|"
    r"alter publication"
    r")",
    re.IGNORECASE,
)


def _split_statements(text: str) -> list[str]:
    """Ділить SQL на інструкції по ';' поза вкладеними дужками й рядками —
    та сама логіка, що й _split_top_level, але межа інструкції — крапка з
    комою, а не кома."""
    stmts = []
    depth = 0
    in_str = False
    buf: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if in_str:
            buf.append(ch)
            if ch == "'":
                if i + 1 < n and text[i + 1] == "'":
                    buf.append(text[i + 1])
                    i += 1
                else:
                    in_str = False
        elif ch == "'":
            in_str = True
            buf.append(ch)
        elif ch == "(":
            depth += 1
            buf.append(ch)
        elif ch == ")":
            depth -= 1
            buf.append(ch)
        elif ch == ";" and depth == 0:
            buf.append(ch)
            stmts.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
        i += 1
    if "".join(buf).strip():
        stmts.append("".join(buf))
    return stmts


def _count_unrecognized_statements(text: str) -> int:
    """Скільки інструкцій поза CREATE TABLE/ALTER ... ADD COLUMN лишились
    нерозпізнаними — функції з $$...$$ прибираємо окремо: усередині них теж є
    ';', і статистика по statements їх інакше порве на шматки."""
    text = re.sub(
        r"create (?:or replace )?function.*?\$\$.*?\$\$ language \w+\s*;",
        "",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    count = 0
    for stmt in _split_statements(text):
        if not stmt.strip():
            continue
        if not _RECOGNIZED_STATEMENT.match(stmt):
            count += 1
    return count


def parse_schema(text: str) -> tuple[dict[str, set[str]], int]:
    text = _strip_comments(text)
    tables: dict[str, set[str]] = {}
    unparsed = 0
    consumed: list[tuple[int, int]] = []

    for m in re.finditer(r"create table\s+(?:if not exists\s+)?(\w+)\s*\(", text, re.IGNORECASE):
        name = m.group(1)
        open_idx = m.end() - 1
        end_idx = _find_matching_paren(text, open_idx)
        if end_idx is None:
            say("err", f"не вдалося розпізнати CREATE TABLE {name} у shared/schema.sql"
                " — дужки не збалансовані, таблицю виключено зі звірки")
            unparsed += 1
            continue

        stmt_end = end_idx + 1
        semi = text.find(";", stmt_end)
        consumed.append((m.start(), (semi + 1) if semi != -1 and semi - stmt_end < 5 else stmt_end))

        body = text[open_idx + 1:end_idx]
        columns: set[str] = set()
        for segment in _split_top_level(body):
            seg = segment.strip()
            if not seg:
                continue
            tok = re.match(r"([A-Za-z_][A-Za-z0-9_]*)", seg)
            if not tok:
                unparsed += 1
                continue
            if tok.group(1).lower() in TABLE_LEVEL_KEYWORDS:
                continue
            columns.add(tok.group(1))
        tables[name] = columns

    # ALTER TABLE ... ADD COLUMN [IF NOT EXISTS] col ... — синтезована схема
    # часом лишає такі рядки поза CREATE TABLE, коли переносять міграцію.
    for m in re.finditer(r"alter table\s+(\w+)\s+((?:add column[^;]*)?);", text, re.IGNORECASE):
        name, body = m.group(1), m.group(2)
        if not body.strip():
            continue
        consumed.append((m.start(), m.end()))
        for clause in _split_top_level(body):
            col = re.match(r"\s*add\s+column\s+(?:if not exists\s+)?(\w+)", clause, re.IGNORECASE)
            if not col:
                continue
            tables.setdefault(name, set()).add(col.group(1))

    remainder = text
    for start, end in sorted(consumed, reverse=True):
        remainder = remainder[:start] + remainder[end:]
    unparsed += _count_unrecognized_statements(remainder)

    return tables, unparsed


# ---------------------------------------------------------------------------
# Реальна схема з Supabase
# ---------------------------------------------------------------------------

def _load_creds() -> tuple[str, str] | None:
    if os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_KEY"):
        return os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"]
    if not os.path.isfile(ENV_FILE):
        say("note", f"немає env-файла {ENV_FILE} — звірку схеми пропущено")
        return None
    env: dict[str, str] = {}
    with open(ENV_FILE, encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            env[key.strip()] = value.strip().strip('"').strip("'")
    url, key = env.get("SUPABASE_URL"), env.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        say("note", f"SUPABASE_URL/SUPABASE_SERVICE_KEY відсутні у {ENV_FILE} — звірку схеми пропущено")
        return None
    return url, key


def fetch_db_tables() -> dict[str, set[str]] | None:
    creds = _load_creds()
    if creds is None:
        return None
    url_base, key = creds
    url = url_base.rstrip("/") + "/rest/v1/"
    # url зібраний із SUPABASE_URL у власному env-файлі, не з вводу користувача.
    req = urllib.request.Request(url, headers={"apikey": key, "Authorization": f"Bearer {key}"})  # noqa: S310
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as resp:  # noqa: S310
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        say("warn", f"PostgREST GET /rest/v1/ -> HTTP {exc.code} — звірку схеми пропущено")
        return None
    except urllib.error.URLError as exc:
        say("warn", f"Supabase недосяжна для звірки схеми: {exc} — звірку пропущено")
        return None
    except OSError as exc:
        say("warn", f"мережева помилка при звірці схеми: {exc} — звірку пропущено")
        return None

    try:
        doc = json.loads(raw)
    except json.JSONDecodeError:
        say("warn", "PostgREST повернув не-JSON у відповідь на GET /rest/v1/ — звірку схеми пропущено")
        return None

    definitions = doc.get("definitions")
    if not isinstance(definitions, dict):
        say("warn", "у відповіді PostgREST немає ключа definitions — формат OpenAPI змінився, звірку пропущено")
        return None

    return {
        name: set((props or {}).get("properties", {}).keys())
        for name, props in definitions.items()
        if isinstance(props, dict)
    }


# ---------------------------------------------------------------------------

def main() -> None:
    if not os.path.isfile(SCHEMA_FILE):
        say("err", f"немає {SCHEMA_FILE} — джерела правди про схему немає, звірку неможливо провести")
        print("\n".join(lines))
        return

    with open(SCHEMA_FILE, encoding="utf-8") as handle:
        schema_text = handle.read()

    schema_tables, unparsed = parse_schema(schema_text)
    db_tables = fetch_db_tables()

    if db_tables is None:
        print("\n".join(lines))
        return

    say("note", "типи колонок не звіряються: SQL-типи й типи OpenAPI-опису PostgREST"
        " мапляться неоднозначно — порівнюються лише набори таблиць і назв колонок")

    missing_tables = sorted(set(schema_tables) - set(db_tables))
    extra_tables = sorted(set(db_tables) - set(schema_tables))
    if missing_tables:
        say("err", "таблиці зі shared/schema.sql відсутні в базі: " + ", ".join(missing_tables)
            + " — міграцію не накотили на цій базі, наступний запис у ці таблиці впаде")
    if extra_tables:
        say("warn", "таблиці в базі, яких немає у shared/schema.sql: " + ", ".join(extra_tables)
            + " — швидше за все, забули оновити shared/schema.sql після міграції")

    missing_cols, extra_cols = [], []
    for name in sorted(set(schema_tables) & set(db_tables)):
        miss = sorted(schema_tables[name] - db_tables[name])
        extra = sorted(db_tables[name] - schema_tables[name])
        if miss:
            missing_cols.append(f"{name}({', '.join(miss)})")
        if extra:
            extra_cols.append(f"{name}({', '.join(extra)})")

    if missing_cols:
        say("err", "колонки зі shared/schema.sql відсутні в базі: " + ", ".join(missing_cols)
            + " — не всі поля міграції накотились, запис у ці колонки впаде")
    if extra_cols:
        say("warn", "колонки в базі, яких немає у shared/schema.sql: " + ", ".join(extra_cols)
            + " — швидше за все, забули оновити shared/schema.sql після міграції")

    if not (missing_tables or extra_tables or missing_cols or extra_cols):
        total_cols = sum(len(cols) for cols in schema_tables.values())
        say("ok", f"схема бази збігається зі shared/schema.sql: {len(schema_tables)} таблиць,"
            f" {total_cols} колонок")

    if unparsed > 0:
        say("note", f"{unparsed} конструкцій(ю) у shared/schema.sql регулярка не розпізнала"
            " — перевір їх вручну, там могли лишитись таблиці чи колонки поза цим звіренням")

    print("\n".join(lines))


if __name__ == "__main__":
    main()
