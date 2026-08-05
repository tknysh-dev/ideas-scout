"""docs_links_check.py — перевірка посилань на шляхи в документації і кількох
фактичних тверджень `shared/contracts.md` проти коду, який їх насправді визначає.

Два незалежних розділи, обидва працюють з тим самим набором файлів
(README.md, AGENTS.md, docs/**/*.md, shared/contracts.md):

1. **Гниття посилань.** Markdown-лінки `[текст](шлях)` і згадки шляхів у
   backticks мають вказувати на файли/каталоги, що існують у репозиторії.
   Перейменування файлу лишає такі посилання мовчки битими — ніщо інше в
   check.sh цього не ловить. Зовнішні URL (http/https/mailto) не чіпаємо —
   це мережа, тут її свідомо немає.

2. **Дрейф фактів у contracts.md.** Частина тексту contracts.md — не проза, а
   переказ конкретних CHECK-констрейнтів `shared/schema.sql` і allowlist-у
   типів job у `agents/worker/job-worker.mjs` людськими словами. Обидва
   редагуються окремо від тексту, тож розходяться тихо — так само, як
   schema.sql і shared/migrations/ (див. migrations_check.py). Тут — вузько
   прицільні регекси, по одному на кожне конкретне формулювання в
   contracts.md (той самий підхід, що migrations_check._CHECK_IN_RE): коли
   формулювання зміниться, регекс перестане знаходити текст і check поверне
   note "не знайшов формулювання", а не мовчки замовкне.

Викликається з doctor.sh/check.sh; друкує рядки "рівень<TAB>повідомлення".
"""

from __future__ import annotations

import os
import re

import doctor_schema as ds
import migrations_check as mc

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCHEMA_FILE = os.path.join(REPO_ROOT, "shared", "schema.sql")
WORKER_FILE = os.path.join(REPO_ROOT, "agents", "worker", "job-worker.mjs")
README_FILE = os.path.join(REPO_ROOT, "README.md")
CONTRACTS_FILE = os.path.join(REPO_ROOT, "shared", "contracts.md")

Message = tuple[str, str]  # (рівень, повідомлення)

# Документи, які реально звіряємо. Зумисно не всі *.md репозиторію (PLAN.md чи
# templates/idea.md — історичний опис, не контракт, що дрейфує з кодом) — лише
# ті, що задача явно називає джерелом посилань на шляхи.
DOC_FILES = ["README.md", "AGENTS.md", "shared/contracts.md"]


def read_text(path: str) -> str | None:
    try:
        with open(path, encoding="utf-8") as handle:
            return handle.read()
    except OSError:
        return None


def doc_files() -> list[str]:
    """Шляхи (відносно REPO_ROOT) усіх файлів документації, що перевіряємо."""
    out = list(DOC_FILES)
    docs_dir = os.path.join(REPO_ROOT, "docs")
    for root, _dirs, files in os.walk(docs_dir):
        out.extend(
            os.path.relpath(os.path.join(root, name), REPO_ROOT)
            for name in sorted(files)
            if name.endswith(".md")
        )
    return sorted(out)


# ---------------------------------------------------------------------------
# 1. Гниття посилань: markdown-лінки і шляхи в backticks
# ---------------------------------------------------------------------------

_MD_LINK_RE = re.compile(r"\[([^\]]*)\]\(([^)\s]+)\)")
_BACKTICK_RE = re.compile(r"`([^`]+)`")
# Кандидат на шлях усередині backtick-фрагмента: або відомий розширювач файлу,
# або каталог, що явно закінчується на '/'. Без розширювача/слеша занадто
# легко зачепити код-ідентифікатор чи назву колонки (rejection_code,
# SUPABASE_URL) — вони так само в backticks, але шляхами не є.
_KNOWN_EXT = (
    "sh|py|md|sql|json|plist|mjs|mts|ts|tsx|js|jsx|yml|yaml|toml|cfg|env"
)
_PATH_SEGMENT = r"[A-Za-z0-9_.\-<>{}*]+"
_PATH_WITH_EXT_RE = re.compile(
    rf"(?<![\w/])((?:{_PATH_SEGMENT}/)*{_PATH_SEGMENT}\.(?:{_KNOWN_EXT}))(?![A-Za-z0-9])"
)
_DIR_PATH_RE = re.compile(rf"(?<![\w/:])((?:{_PATH_SEGMENT}/)+)(?![A-Za-z0-9_.\-<>{{}}*])")

TEMPLATE_CHARS = "<>*{}"

_FENCE_RE = re.compile(r"```.*?```", re.DOTALL)
_SEGMENT_WITH_EXT_RE = re.compile(rf"^{_PATH_SEGMENT}\.(?:{_KNOWN_EXT})$")


def _strip_fences(text: str) -> str:
    """Прибирає код-блоки в потрійних backticks. Наївний парний regex на
    одинарний backtick інакше рахує кожен ``` як півтора зайвої пари й
    зсуває межі всіх фрагментів до кінця файлу — саме так одного разу
    прозовий рядок після блоку command-line прикладів опинився "у
    фрагменті" і потрапив у кандидати на шлях."""
    return _FENCE_RE.sub("", text)


def _is_templated(path: str) -> bool:
    return any(c in path for c in TEMPLATE_CHARS)


def _strip_trailing_punct(path: str) -> str:
    return path.rstrip(".,;:)")


def _split_ext_chain(path: str) -> list[str]:
    """"runner.sh/monitor.sh" у прозі означає "runner.sh або monitor.sh", не
    вкладений шлях — типовий стиль коментарів у цьому репозиторії
    (README.md: "db.sh # доступ ... (runner.sh/monitor.sh; ...)"). Розпізнаємо
    це, коли КОЖЕН сегмент між '/' сам собою схожий на файл із розширенням —
    справжній вкладений шлях так не виглядає (проміжні сегменти без крапки)."""
    parts = path.split("/")
    if len(parts) >= 2 and all(_SEGMENT_WITH_EXT_RE.match(p) for p in parts):
        return parts
    return [path]


def extract_path_candidates(text: str) -> list[str]:
    """Кандидати на шлях із усіх backtick-фрагментів тексту. Зовнішні URL
    (весь фрагмент містить '://') і фрагменти з пробілом (команди на кшталт
    `launchctl bootstrap gui/$UID <plist>` — не шлях, а приклад команди)
    пропускаємо."""
    out: list[str] = []
    for frag in _BACKTICK_RE.findall(text):
        if "://" in frag or " " in frag:
            continue
        for m in _PATH_WITH_EXT_RE.finditer(frag):
            out.extend(_split_ext_chain(_strip_trailing_punct(m.group(1))))
        for m in _DIR_PATH_RE.finditer(frag):
            candidate = _strip_trailing_punct(m.group(1))
            # _DIR_PATH_RE вже зловив би і файлові шляхи (вони теж містять
            # '/'), тому додаємо лише те, що справді виглядає як каталог —
            # закінчується на '/', а не на розширення файлу.
            if candidate.endswith("/"):
                out.append(candidate)
    return out


def extract_md_links(text: str) -> list[str]:
    out = []
    for _label, raw_target in _MD_LINK_RE.findall(text):
        target = raw_target.strip()
        if target.startswith(("http://", "https://", "mailto:", "#")):
            continue
        target = target.split("#", 1)[0].strip()
        if target:
            out.append(target)
    return out


def _resolve_link(path: str, base_dir: str) -> str:
    """Для href справжніх markdown-лінків [текст](шлях) — звичайна відносна
    семантика: рахуємо від каталогу файлу, що містить посилання."""
    if path.startswith(("./", "../")):
        return os.path.normpath(os.path.join(base_dir, path))
    return os.path.normpath(os.path.join(REPO_ROOT, path))


def _resolve_repo_root(path: str) -> str:
    """Для згадок шляху в backticks — тут конвенція репозиторію інша: шлях
    пишуть від кореня незалежно від того, який файл документації його
    згадує (типово: `agents/scripts/db.sh` однаково і в README.md, і в
    docs/operations.md). Провідний './' тут — не markdown-відносність, а
    просто стиль команди для копіювання (`./agents/scripts/doctor.sh`)."""
    path = path.removeprefix("./")
    return os.path.normpath(os.path.join(REPO_ROOT, path))


_IGNORED_DIRS = (".git", ".claude", "node_modules", "__pycache__", ".next")
# Шляхи в docs/ часто називають файли дашборда без префікса src-кореня
# Next.js (`lib/deep-research.ts` замість `dashboard/src/lib/deep-research.ts`)
# — це реальна конвенція планів (`docs/plans/`), не помилка.
DASHBOARD_SRC_PREFIX = "dashboard/src/"


def _find_by_basename(basename: str) -> list[str]:
    matches = []
    for root, dirs, files in os.walk(REPO_ROOT):
        dirs[:] = [d for d in dirs if d not in _IGNORED_DIRS]
        if basename in files:
            matches.append(os.path.relpath(os.path.join(root, basename), REPO_ROOT))
    return matches


def check_path(rel_doc: str, raw_path: str, resolved: str) -> Message | None:
    """None = усе гаразд (не друкуємо кожен ok окремо — їх забагато)."""
    if _is_templated(raw_path):
        literal_prefix = raw_path
        for ch in TEMPLATE_CHARS:
            literal_prefix = literal_prefix.split(ch, 1)[0]
        prefix_dir = os.path.dirname(literal_prefix)
        base_exists = os.path.isdir(os.path.join(REPO_ROOT, prefix_dir)) if prefix_dir else True
        return (
            "note",
            f"{rel_doc}: шаблонний шлях «{raw_path}» — не звіряється буквально, перевір вручну"
            + ("" if base_exists else f" (каталог {prefix_dir or '.'} теж не знайдено)"),
        )
    if os.path.exists(resolved):
        return None
    if raw_path.endswith("/"):
        # Відсутній каталог частіше означає "зарезервований префікс" чи
        # ілюстрація шаблону (напр. `.github/` у переліку шляхів, які агенту
        # заборонено чіпати; `logs/runs/reddit-cache/` — рантайм-каталог у
        # .gitignore, якого може не бути на цій машині), ніж биту згадку —
        # err тут був би галасливим хибним спрацюванням. Лишаємо note.
        return (
            "note",
            f"{rel_doc}: каталог «{raw_path}» не знайдено — перевір вручну (можливо, зарезервований шлях або приклад шаблону)",
        )
    if "/" not in raw_path:
        # Ім'я без каталогу — і справжній файл (`check.sh`), і назва
        # продукту/бібліотеки, що випадково має вигляд шляху (Auth.js,
        # Node.js). Різнити їх текстом ненадійно, тож завжди note, ніколи err.
        matches = _find_by_basename(raw_path)
        if len(matches) == 1:
            return (
                "note",
                f"{rel_doc}: «{raw_path}» без каталогу, у репозиторії є лише {matches[0]} — перевір, чи це малось на увазі",
            )
        if len(matches) > 1:
            return (
                "note",
                f"{rel_doc}: «{raw_path}» без каталогу неоднозначний — збігається з {', '.join(matches)}",
            )
        return (
            "note",
            f"{rel_doc}: «{raw_path}» без каталогу ніде в репозиторії не знайдено — можливо, це не шлях (назва продукту/бібліотеки), перевір вручну",
        )
    if not raw_path.startswith(DASHBOARD_SRC_PREFIX):
        under_dashboard = os.path.join(REPO_ROOT, DASHBOARD_SRC_PREFIX, raw_path)
        if os.path.exists(under_dashboard):
            return (
                "note",
                f"{rel_doc}: «{raw_path}» знайдено лише під {DASHBOARD_SRC_PREFIX}{raw_path} — перевір, чи доречно опускати префікс",
            )
    return ("err", f"{rel_doc}: посилання на неіснуючий шлях «{raw_path}»")


def check_links(files: list[str]) -> list[Message]:
    out: list[Message] = []
    notes: list[Message] = []
    checked = 0
    broken = 0
    for rel_doc in files:
        abs_doc = os.path.join(REPO_ROOT, rel_doc)
        text = read_text(abs_doc)
        if text is None:
            out.append(("err", f"{rel_doc}: не вдалось прочитати файл документації"))
            continue
        text = _strip_fences(text)
        base_dir = os.path.dirname(abs_doc)

        # Дві різні семантики резолву (див. докстрінги _resolve_link/
        # _resolve_repo_root), тому не зливаємо в один список кандидатів.
        typed_candidates: list[tuple[str, str]] = []
        typed_candidates.extend((p, "link") for p in extract_md_links(text))
        typed_candidates.extend((p, "mention") for p in extract_path_candidates(text))

        seen = set()
        for raw_path, kind in typed_candidates:
            if (raw_path, kind) in seen:
                continue
            seen.add((raw_path, kind))
            resolved = _resolve_link(raw_path, base_dir) if kind == "link" else _resolve_repo_root(raw_path)
            checked += 1
            result = check_path(rel_doc, raw_path, resolved)
            if result is not None:
                if result[0] == "err":
                    broken += 1
                    out.append(result)
                else:
                    notes.append(result)

    if broken == 0:
        out.insert(0, ("ok", f"посилання на шляхи: {checked} перевірено в {len(files)} документах, битих не знайдено"))

    # check.sh (run_contract_check) згортає лише "warn" у підсумок — тут той
    # самий клас проблеми (ok/err, а не noise), тому note-и згортаємо самі,
    # інакше 50+ окремих рядків неоднозначних шляхів щодня привчають їх не
    # читати (той самий аргумент, що й у коментарі run_contract_check).
    if len(notes) <= 3:
        out.extend(notes)
    elif notes:
        out.append((
            "note",
            (f"{len(notes)} неоднозначних шляхів (шаблонні/без каталогу/під dashboard/src/ без префікса) — "
            f"перше: {notes[0][1]}; повний список: python3 agents/scripts/docs_links_check.py"),
        ))
    return out


# ---------------------------------------------------------------------------
# 2. Дрейф фактів у contracts.md проти schema.sql / job-worker.mjs
# ---------------------------------------------------------------------------


def _normalize_ws(text: str) -> str:
    return re.sub(r"\s+", " ", text)


def _extract_section(text: str, start_re: str, end_level: int) -> str | None:
    m = re.search(start_re, text, re.MULTILINE)
    if not m:
        return None
    rest = text[m.end():]
    end = re.search(rf"\n#{{1,{end_level}}}\s", rest)
    return rest[:end.start()] if end else rest


_BULLET_TOKEN_RE = re.compile(r"^-\s+\*{0,2}`([a-z_]+)`\*{0,2}", re.MULTILINE)


def _bullet_enum(text: str, start_re: str, end_level: int = 2) -> frozenset[str] | None:
    section = _extract_section(text, start_re, end_level)
    if section is None:
        return None
    found = frozenset(_BULLET_TOKEN_RE.findall(section))
    return found or None


def _check_enum(
    label: str,
    found: frozenset[str] | None,
    expected: frozenset[str] | None,
    where: str,
) -> Message:
    if found is None:
        return ("note", f"{label}: не знайшов очікуваного формулювання в contracts.md — перевір вручну")
    if expected is None:
        return ("note", f"{label}: у {where} немає CHECK-переліку для звірки — контракт лише в тексті")
    if found == expected:
        return ("ok", f"{label}: перелік у contracts.md збігається з {where} ({len(found)} значень)")
    missing = sorted(expected - found)
    extra = sorted(found - expected)
    detail = []
    if missing:
        detail.append(f"немає в contracts.md: {', '.join(missing)}")
    if extra:
        detail.append(f"є в contracts.md, немає в {where}: {', '.join(extra)}")
    return ("err", f"{label}: перелік у contracts.md розійшовся з {where} ({'; '.join(detail)})")


def check_enum_claims(contracts_text: str, schema_text: str) -> list[Message]:
    out: list[Message] = []
    checks = mc.extract_value_checks(schema_text)

    out.append(_check_enum(
        "ideas.status",
        _bullet_enum(contracts_text, r"^## Статуси ідеї"),
        checks.get(("ideas", "status")),
        "shared/schema.sql",
    ))
    out.append(_check_enum(
        "ideas.type",
        _bullet_enum(contracts_text, r"^## Що таке"),
        checks.get(("ideas", "type")),
        "shared/schema.sql",
    ))
    out.append(_check_enum(
        "ideas.signal_type",
        _bullet_enum(contracts_text, r"^## Звідки береться нова ідея"),
        checks.get(("ideas", "signal_type")),
        "shared/schema.sql",
    ))
    out.append(_check_enum(
        "sources.author_interest",
        _bullet_enum(contracts_text, r"^## Заявник зацікавленості джерела"),
        checks.get(("sources", "author_interest")),
        "shared/schema.sql",
    ))
    out.append(_check_enum(
        "ideas.confidence",
        _bullet_enum(contracts_text, r"^### Рівень впевненості", end_level=3),
        checks.get(("ideas", "confidence")),
        "shared/schema.sql",
    ))

    # rejection_code: ALL-CAPS backtick-токени в межах саме секції чек-листа —
    # інакше зачепили б і незв'язані ALL_CAPS-згадки на кшталт
    # IDEAS_SCOUT_DEEP_RESEARCH_DRY_RUN з іншої секції документа.
    section = _extract_section(contracts_text, r"^## Чек-лист оцінки і коди відмов", end_level=2)
    rej_found = frozenset(re.findall(r"`([A-Z][A-Z_]+)`", section)) if section is not None else None
    out.append(_check_enum(
        "ideas.rejection_code",
        rej_found,
        checks.get(("ideas", "rejection_code")),
        "shared/schema.sql",
    ))

    # jobs.status: "Шлях станів: `pending` → ... `cancelled` зарезервований…"
    m = re.search(r"Шлях станів:(.*?)зарезервований для майбутнього", contracts_text, re.DOTALL)
    jobs_status_found = frozenset(re.findall(r"`([a-z_]+)`", m.group(1))) if m else None
    out.append(_check_enum(
        "jobs.status",
        jobs_status_found,
        checks.get(("jobs", "status")),
        "shared/schema.sql",
    ))

    norm = _normalize_ws(contracts_text)

    m = re.search(r"`stage` — `([a-z]+)` або `([a-z]+)`", norm)
    stage_found = frozenset(m.groups()) if m else None
    out.append(_check_enum(
        "criteria_verdicts.stage",
        stage_found,
        checks.get(("criteria_verdicts", "stage")),
        "shared/schema.sql",
    ))

    m = re.search(r"`kind` — знову `([a-z]+)`/`([a-z]+)`", norm)
    kind_found = frozenset(m.groups()) if m else None
    out.append(_check_enum(
        "criteria_verdicts.kind",
        kind_found,
        checks.get(("criteria_verdicts", "kind")),
        "shared/schema.sql",
    ))

    m = re.search(r"`verdict` — одне з `([^`]+)`", norm)
    verdict_found = frozenset(t.strip() for t in m.group(1).split("|")) if m else None
    out.append(_check_enum(
        "criteria_verdicts.verdict",
        verdict_found,
        checks.get(("criteria_verdicts", "verdict")),
        "shared/schema.sql",
    ))

    m = re.search(
        r"`resolution`.*?:\s*`([a-z_]+)`[^`]*,\s*`([a-z_]+)`[^`]*або\s*`([a-z_]+)`",
        norm,
    )
    resolution_found = frozenset(m.groups()) if m else None
    out.append(_check_enum(
        "criteria_verdicts.resolution",
        resolution_found,
        checks.get(("criteria_verdicts", "resolution")),
        "shared/schema.sql",
    ))

    m = re.search(r"`stage` тепер завжди `([a-z_]+)`", norm)
    rr_stage_found = frozenset(m.groups()) if m else None
    out.append(_check_enum(
        "research_reports.stage",
        rr_stage_found,
        checks.get(("research_reports", "stage")),
        "shared/schema.sql",
    ))

    return out


_JOB_HANDLERS_BLOCK_RE = re.compile(r"const JOB_HANDLERS = Object\.freeze\(\{(.*?)\n\}\);", re.DOTALL)
_JOB_HANDLER_KEY_RE = re.compile(r"^\s{2}(\w+):\s*Object\.freeze\(\{", re.MULTILINE)


def extract_job_allowlist(worker_text: str) -> frozenset[str] | None:
    m = _JOB_HANDLERS_BLOCK_RE.search(worker_text)
    if not m:
        return None
    return frozenset(_JOB_HANDLER_KEY_RE.findall(m.group(1)))


def check_job_allowlist(contracts_text: str, worker_text: str | None) -> Message:
    documented = _bullet_enum(contracts_text, r"Дозволені типи:", end_level=2)
    if worker_text is None:
        return ("err", f"немає {WORKER_FILE} — job-типи в contracts.md звірити нема з чим")
    actual = extract_job_allowlist(worker_text)
    return _check_enum(
        "jobs.type allowlist",
        documented,
        actual,
        "agents/worker/job-worker.mjs (JOB_HANDLERS)",
    )


# ---------------------------------------------------------------------------
# 3. Перелік таблиць у README проти shared/schema.sql
# ---------------------------------------------------------------------------

_README_DDL_RE = re.compile(r"schema\.sql\s+#\s*DDL:\s*([a-z_, ]+)")


def check_readme_table_list(readme_text: str, schema_text: str) -> Message:
    m = _README_DDL_RE.search(readme_text)
    if not m:
        return ("note", "README.md: не знайшов рядка «schema.sql # DDL: …» — перевір вручну, чи перелік таблиць актуальний")
    documented = frozenset(t.strip() for t in m.group(1).split(",") if t.strip())
    actual_tables, _unparsed = ds.parse_schema(schema_text)
    actual = frozenset(actual_tables.keys())
    return _check_enum("README.md: перелік таблиць у DDL-коментарі", documented, actual, "shared/schema.sql")


# ---------------------------------------------------------------------------

def run() -> list[Message]:
    out: list[Message] = []

    files = doc_files()
    out.extend(check_links(files))

    contracts_text = read_text(CONTRACTS_FILE)
    schema_text = read_text(SCHEMA_FILE)
    readme_text = read_text(README_FILE)
    worker_text = read_text(WORKER_FILE)

    if contracts_text is None:
        out.append(("err", f"немає {CONTRACTS_FILE} — факти contracts.md звірити нема з чим"))
    elif schema_text is None:
        out.append(("err", f"немає {SCHEMA_FILE} — джерела правди про схему немає"))
    else:
        out.extend(check_enum_claims(contracts_text, schema_text))
        out.append(check_job_allowlist(contracts_text, worker_text))

    if readme_text is None:
        out.append(("err", f"немає {README_FILE}"))
    elif schema_text is not None:
        out.append(check_readme_table_list(readme_text, schema_text))

    return out


def main() -> None:
    for level, message in run():
        print(f"{level}\t{message}")


if __name__ == "__main__":
    main()
