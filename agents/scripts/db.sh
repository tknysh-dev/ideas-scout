#!/usr/bin/env bash
# db.sh — доступ до Supabase (Postgres) через PostgREST замість Git/Markdown.
# Фаза 4 міграції: ideas/sources/runs/events/inbox тепер живуть у базі, не у
# registries/*.md, logs/runs/*.md, logs/status/*.json, inbox/*, logs/triage/*.
#
# Два режими використання:
#   1) source agents/scripts/db.sh   — функції db_* доступні у викликаючому скрипті
#      (так користується runner.sh/monitor.sh).
#   2) agents/scripts/db.sh <команда> [аргументи]  — CLI-режим: саме так це
#      викликають CLI-агенти (claude -p), яким свідомо НЕ дають загального Bash —
#      allowedTools у runner.sh дозволяє лише `Bash(agents/scripts/db.sh:*)`,
#      тобто агент може запускати рівно цей скрипт з фіксованим набором підкоманд
#      (жодного прямого curl/git/довільної команди). Це вужчий, але аналогічний
#      попередньому інваріант «агент не має довільного shell».
#
# Помилки не мовчазні: ненульовий exit code + повідомлення в stderr на будь-якому
# провалі curl (мережа) чи не-2xx відповіді PostgREST (дані/права).
#
# JSON-аргументи (payload) можна передавати трьома способами:
#   - літеральний рядок JSON;
#   - "-" — прочитати JSON з stdin (зручно для heredoc з CLI-агента);
#   - шлях до наявного файлу з JSON.

set -uo pipefail

DB_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_ENV_FILE="${IDEAS_SCOUT_ENV_FILE:-$HOME/.config/ideas-scout/env}"

db_die() {
  echo "db.sh: $*" >&2
  return 1
}

db_load_env() {
  if [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_SERVICE_KEY:-}" ]; then
    return 0
  fi
  if [ ! -f "$DB_ENV_FILE" ]; then
    db_die "env-файл не знайдено: $DB_ENV_FILE (потрібні SUPABASE_URL, SUPABASE_SERVICE_KEY)"
    return 1
  fi
  set -a
  # shellcheck disable=SC1090
  source "$DB_ENV_FILE"
  set +a
  if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_KEY:-}" ]; then
    db_die "SUPABASE_URL/SUPABASE_SERVICE_KEY відсутні у $DB_ENV_FILE"
    return 1
  fi
  return 0
}

# _json_arg <arg> — повертає JSON-текст: сам рядок, вміст stdin (arg="-"), або
# вміст файлу, якщо arg — шлях до наявного файлу.
_json_arg() {
  local arg="${1:-}"
  if [ "$arg" = "-" ]; then
    cat
  elif [ -f "$arg" ]; then
    cat "$arg"
  else
    printf '%s' "$arg"
  fi
}

# _db_request <method> <path-з-query> [body] — path вже містить query-рядок
# (без URL-кодування спецсимволів фільтрів — виклики нижче будують його самі
# або кодують значення окремо через _urlenc).
_db_request() {
  local method="$1" path="$2" body="${3:-}"
  db_load_env || return 1
  local url="${SUPABASE_URL%/}/rest/v1${path}"
  local -a curl_args=(-sS -w '\n%{http_code}' -X "$method"
    -H "apikey: ${SUPABASE_SERVICE_KEY}"
    -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}"
    -H "Content-Type: application/json")
  case "$method" in
    POST) curl_args+=(-H "Prefer: return=representation") ;;
    PATCH) curl_args+=(-H "Prefer: return=representation") ;;
  esac
  curl_args+=(--data-raw "${body:-}")
  local raw
  if ! raw="$(curl "${curl_args[@]}" "$url" 2>&1)"; then
    db_die "curl не зміг достукатись до $url: $raw"
    return 1
  fi
  local http_code body_out
  http_code="${raw##*$'\n'}"
  body_out="${raw%$'\n'*}"
  case "$http_code" in
    2??) printf '%s\n' "$body_out"; return 0 ;;
    *)
      db_die "PostgREST $method $path -> HTTP $http_code: $body_out"
      return 1
      ;;
  esac
}

# _db_get <path-з-query> — GET без тіла (шлях уже містить query-рядок).
_db_get() {
  local path="$1"
  db_load_env || return 1
  local url="${SUPABASE_URL%/}/rest/v1${path}"
  local raw http_code body_out
  if ! raw="$(curl -sS -w '\n%{http_code}' \
      -H "apikey: ${SUPABASE_SERVICE_KEY}" \
      -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
      "$url" 2>&1)"; then
    db_die "curl не зміг достукатись до $url: $raw"
    return 1
  fi
  http_code="${raw##*$'\n'}"
  body_out="${raw%$'\n'*}"
  case "$http_code" in
    2??) printf '%s\n' "$body_out"; return 0 ;;
    *) db_die "PostgREST GET $path -> HTTP $http_code: $body_out"; return 1 ;;
  esac
}

_urlenc() {
  python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"
}

# db_upsert <table> <on_conflict_col> <json|-|file> — POST з on_conflict, merge-duplicates.
# Спільна реалізація для upsert-idea/upsert-run/upsert-inbox (використовує міграція
# для ідемпотентних повторних прогонів).
db_upsert() {
  local table="$1" col="$2" payload
  [ -n "$table" ] && [ -n "$col" ] || { db_die "upsert: потрібні table, on_conflict_col"; return 2; }
  payload="$(_json_arg "${3:-}")"
  [ -n "$payload" ] || { db_die "upsert: порожній payload"; return 2; }
  db_load_env || return 1
  local url="${SUPABASE_URL%/}/rest/v1/${table}?on_conflict=${col}"
  local raw http_code body_out
  if ! raw="$(curl -sS -w '\n%{http_code}' -X POST \
      -H "apikey: ${SUPABASE_SERVICE_KEY}" \
      -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
      -H "Content-Type: application/json" \
      -H "Prefer: resolution=merge-duplicates,return=representation" \
      --data-raw "$payload" "$url" 2>&1)"; then
    db_die "curl не зміг достукатись до $url: $raw"
    return 1
  fi
  http_code="${raw##*$'\n'}"; body_out="${raw%$'\n'*}"
  case "$http_code" in
    2??) printf '%s\n' "$body_out"; return 0 ;;
    *) db_die "upsert $table -> HTTP $http_code: $body_out"; return 1 ;;
  esac
}

# db_delete <path-з-query> — напр. "/sources?idea_id=eq.PI-0001". Використовує
# міграція для ідемпотентного delete-then-insert sources/events на повторному прогоні.
db_delete() {
  local path="$1"
  [ -n "$path" ] || { db_die "delete: потрібен path"; return 2; }
  db_load_env || return 1
  local url="${SUPABASE_URL%/}/rest/v1${path}"
  local raw http_code body_out
  if ! raw="$(curl -sS -w '\n%{http_code}' -X DELETE \
      -H "apikey: ${SUPABASE_SERVICE_KEY}" \
      -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
      "$url" 2>&1)"; then
    db_die "curl не зміг достукатись до $url: $raw"
    return 1
  fi
  http_code="${raw##*$'\n'}"; body_out="${raw%$'\n'*}"
  case "$http_code" in
    2??) printf '%s\n' "$body_out"; return 0 ;;
    *) db_die "delete $path -> HTTP $http_code: $body_out"; return 1 ;;
  esac
}

# ---------------------------------------------------------------------------
# ideas
# ---------------------------------------------------------------------------

# db_get_ideas [--status X] [--track Y] [--id X] — GET, друкує JSON-масив у stdout.
db_get_ideas() {
  local status="" track="" id="" q="select=*"
  while [ $# -gt 0 ]; do
    case "$1" in
      --status) status="$2"; shift 2 ;;
      --track) track="$2"; shift 2 ;;
      --id) id="$2"; shift 2 ;;
      *) db_die "get_ideas: невідомий аргумент $1"; return 2 ;;
    esac
  done
  [ -n "$status" ] && q="${q}&status=eq.$(_urlenc "$status")"
  [ -n "$track" ] && q="${q}&track=eq.$(_urlenc "$track")"
  [ -n "$id" ] && q="${q}&id=eq.$(_urlenc "$id")"
  q="${q}&order=id.asc"
  _db_get "/ideas?${q}"
}

db_get_idea() {
  local id="$1"
  [ -n "$id" ] || { db_die "get_idea: потрібен id"; return 2; }
  _db_get "/ideas?id=eq.$(_urlenc "$id")&select=*"
}

# db_upsert_idea <json|- |file> — POST з on_conflict=id, merge-duplicates.
# payload — один об'єкт JSON з колонками ideas (id обов'язковий).
db_upsert_idea() {
  local payload
  payload="$(_json_arg "${1:-}")"
  [ -n "$payload" ] || { db_die "upsert_idea: порожній payload"; return 2; }
  db_load_env || return 1
  local url="${SUPABASE_URL%/}/rest/v1/ideas?on_conflict=id"
  local raw http_code body_out
  if ! raw="$(curl -sS -w '\n%{http_code}' -X POST \
      -H "apikey: ${SUPABASE_SERVICE_KEY}" \
      -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
      -H "Content-Type: application/json" \
      -H "Prefer: resolution=merge-duplicates,return=representation" \
      --data-raw "$payload" "$url" 2>&1)"; then
    db_die "curl не зміг достукатись до $url: $raw"
    return 1
  fi
  http_code="${raw##*$'\n'}"; body_out="${raw%$'\n'*}"
  case "$http_code" in
    2??) printf '%s\n' "$body_out"; return 0 ;;
    *) db_die "upsert_idea -> HTTP $http_code: $body_out"; return 1 ;;
  esac
}

# db_update_idea_status <id> <new_status> <actor> <reason> [run_id]
# Оновлює ideas.status і автоматично записує event ("status: OLD -> NEW").
db_update_idea_status() {
  local id="$1" new_status="$2" actor="$3" reason="$4" run_id="${5:-}"
  [ -n "$id" ] && [ -n "$new_status" ] && [ -n "$actor" ] || {
    db_die "update_idea_status: потрібні id, new_status, actor, reason"; return 2; }

  local old_status
  old_status="$(_db_get "/ideas?id=eq.$(_urlenc "$id")&select=status" | python3 -c \
    'import json,sys; d=json.load(sys.stdin); print(d[0]["status"] if d else "")' 2>/dev/null)"
  if [ -z "$old_status" ]; then
    db_die "update_idea_status: ідею $id не знайдено"
    return 1
  fi

  local body
  body="$(python3 -c 'import json,sys; print(json.dumps({"status": sys.argv[1]}))' "$new_status")"
  _db_request PATCH "/ideas?id=eq.$(_urlenc "$id")" "$body" >/dev/null || return 1

  local change
  change="status: ${old_status} -> ${new_status}"
  db_insert_event "$id" "$actor" "$change" "$reason" "$run_id"
}

# ---------------------------------------------------------------------------
# sources
# ---------------------------------------------------------------------------

# db_insert_source <idea_id> <json|-|file>
# payload — об'єкт з полями url (обов'язкове), origin, published_date,
# author_interest, independent_confirmations, quote.
db_insert_source() {
  local idea_id="$1" payload
  [ -n "$idea_id" ] || { db_die "insert_source: потрібен idea_id"; return 2; }
  payload="$(_json_arg "${2:-}")"
  [ -n "$payload" ] || { db_die "insert_source: порожній payload"; return 2; }
  local body
  body="$(python3 -c '
import json, sys
idea_id = sys.argv[1]
d = json.loads(sys.argv[2])
d["idea_id"] = idea_id
print(json.dumps(d))
' "$idea_id" "$payload")" || { db_die "insert_source: невалідний JSON payload"; return 2; }
  _db_request POST "/sources" "$body"
}

# ---------------------------------------------------------------------------
# events
# ---------------------------------------------------------------------------

# db_insert_event <idea_id> <actor> <change> <reason> [run_id]
db_insert_event() {
  local idea_id="$1" actor="$2" change="$3" reason="${4:-}" run_id="${5:-}"
  [ -n "$idea_id" ] && [ -n "$actor" ] && [ -n "$change" ] || {
    db_die "insert_event: потрібні idea_id, actor, change"; return 2; }
  local body
  body="$(python3 -c '
import json, sys
idea_id, actor, change, reason, run_id = sys.argv[1:6]
d = {"idea_id": idea_id, "actor": actor, "change": change}
if reason:
    d["reason"] = reason
if run_id:
    d["run_id"] = run_id
print(json.dumps(d))
' "$idea_id" "$actor" "$change" "$reason" "$run_id")"
  _db_request POST "/events" "$body"
}

# db_check_url_in_sources <url> — чи цей url вже є джерелом якоїсь ідеї; друкує
# idea_id (може бути кілька рядків), порожньо якщо ні. Замінює перевірку
# "чи є цей url у registries/*/ideas/*.md" з дореляційної Markdown-версії.
db_check_url_in_sources() {
  local url="$1"
  [ -n "$url" ] || { db_die "check_url_in_sources: потрібен url"; return 2; }
  _db_get "/sources?url=eq.$(_urlenc "$url")&select=idea_id" | python3 -c '
import json, sys
for r in json.load(sys.stdin):
    print(r["idea_id"])
'
}

# ---------------------------------------------------------------------------
# runs
# ---------------------------------------------------------------------------

# db_register_run_start <run_id> <job> [track] [provider]
db_register_run_start() {
  local run_id="$1" job="$2" track="${3:-}" provider="${4:-}"
  [ -n "$run_id" ] && [ -n "$job" ] || { db_die "register_run_start: потрібні run_id, job"; return 2; }
  local body
  body="$(python3 -c '
import json, sys
run_id, job, track, provider = sys.argv[1:5]
d = {"run_id": run_id, "job": job, "started_at": "now()"}
if track:
    d["track"] = track
if provider:
    d["provider"] = provider
print(json.dumps(d))
' "$run_id" "$job" "$track" "$provider")"
  # started_at: "now()" не валідний JSON-timestamp — підставляємо реальний UTC.
  body="$(printf '%s' "$body" | python3 -c '
import json, sys, datetime
d = json.load(sys.stdin)
d["started_at"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
print(json.dumps(d))
')"
  _db_request POST "/runs" "$body"
}

# db_register_run_finish <run_id> <status> [errors_json] [token_usage_json] [processed_urls_json] [notes] [meta_json]
# Порожні необов'язкові аргументи ('' або '-') не змінюють відповідне поле.
db_register_run_finish() {
  local run_id="$1" status="$2"
  local errors="${3:-}" token_usage="${4:-}" processed_urls="${5:-}" notes="${6:-}" meta="${7:-}"
  [ -n "$run_id" ] || { db_die "register_run_finish: потрібен run_id"; return 2; }
  local body
  body="$(python3 -c '
import json, sys, datetime
run_id, status, errors, token_usage, processed_urls, notes, meta = sys.argv[1:8]
d = {"finished_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
if status:
    d["status"] = status
def parse(name, raw):
    if raw and raw != "-":
        d[name] = json.loads(raw)
parse("errors", errors)
parse("token_usage", token_usage)
parse("processed_urls", processed_urls)
if notes and notes != "-":
    d["notes"] = notes
parse("meta", meta)
print(json.dumps(d))
' "$run_id" "$status" "$errors" "$token_usage" "$processed_urls" "$notes" "$meta")" || {
    db_die "register_run_finish: невалідний JSON у одному з полів"; return 2; }
  _db_request PATCH "/runs?run_id=eq.$(_urlenc "$run_id")" "$body"
}

# db_get_last_run <job> [track] — останній (за started_at) прогін джоба.
db_get_last_run() {
  local job="$1" track="${2:-}"
  [ -n "$job" ] || { db_die "get_last_run: потрібен job"; return 2; }
  local q="select=*&job=eq.$(_urlenc "$job")"
  [ -n "$track" ] && q="${q}&track=eq.$(_urlenc "$track")"
  q="${q}&order=started_at.desc&limit=1"
  _db_get "/runs?${q}"
}

# db_check_url_processed <url> [track] — друкує run_id прогону(ів), що вже
# поглинули цей url (порожньо, якщо жоден), exit 0 завжди (сам факт "не
# знайдено" — не помилка).
db_check_url_processed() {
  local url="$1" track="${2:-}"
  [ -n "$url" ] || { db_die "check_url_processed: потрібен url"; return 2; }
  # Postgres array-literal containment: processed_urls=cs.{url}. Кома/дужки в
  # url екрануємо, обгортаючи елемент у подвійні лапки (валідний array-literal
  # синтаксис), і URL-кодуємо весь query-параметр.
  local escaped elem q
  escaped="$(printf '%s' "$url" | sed 's/"/\\"/g')"
  elem="{\"${escaped}\"}"
  q="select=run_id&processed_urls=cs.$(_urlenc "$elem")"
  [ -n "$track" ] && q="${q}&track=eq.$(_urlenc "$track")"
  _db_get "/runs?${q}" | python3 -c '
import json, sys
rows = json.load(sys.stdin)
for r in rows:
    print(r["run_id"])
'
}

# ---------------------------------------------------------------------------
# inbox
# ---------------------------------------------------------------------------

# db_insert_inbox <json|-|file> — payload: draft_id, submitted_at, raw_text,
# source, track, mode, target_card_id (опційно).
db_insert_inbox() {
  local payload
  payload="$(_json_arg "${1:-}")"
  [ -n "$payload" ] || { db_die "insert_inbox: порожній payload"; return 2; }
  _db_request POST "/inbox" "$payload"
}

# db_update_inbox <draft_id> <json|-|file>
db_update_inbox() {
  local draft_id="$1" payload
  [ -n "$draft_id" ] || { db_die "update_inbox: потрібен draft_id"; return 2; }
  payload="$(_json_arg "${2:-}")"
  [ -n "$payload" ] || { db_die "update_inbox: порожній payload"; return 2; }
  _db_request PATCH "/inbox?draft_id=eq.$(_urlenc "$draft_id")" "$payload"
}

db_get_inbox() {
  local draft_id="$1"
  [ -n "$draft_id" ] || { db_die "get_inbox: потрібен draft_id"; return 2; }
  _db_get "/inbox?draft_id=eq.$(_urlenc "$draft_id")&select=*"
}

# ---------------------------------------------------------------------------
# статистика для monitor.sh
# ---------------------------------------------------------------------------

# db_ideas_activity_since <iso8601> — активність по ideas з моменту X одним JSON:
# created (картка з'явилась у цьому вікні) і updated (стара картка, якій лише
# змінили поля). Одне число на обидва випадки читалось як «стільки нових ідей»,
# хоча найчастіше це правки статусів уже наявних.
db_ideas_activity_since() {
  local since="$1"
  [ -n "$since" ] || { db_die "ideas_activity_since: потрібен iso8601 timestamp"; return 2; }
  _db_get "/ideas?select=created_at&updated_at=gte.$(_urlenc "$since")" | python3 -c '
import datetime, json, sys

# PostgREST віддає офсет як "+00:00", monitor.sh передає межу з "Z" — порівнювати
# їх як рядки не можна, тому обидва боки йдуть через fromisoformat.
since = datetime.datetime.fromisoformat(sys.argv[1].replace("Z", "+00:00"))
created = updated = 0
for row in json.load(sys.stdin):
    at = row.get("created_at")
    try:
        is_new = at is not None and datetime.datetime.fromisoformat(at) >= since
    except ValueError:
        is_new = False
    if is_new:
        created += 1
    else:
        updated += 1
print(json.dumps({"created": created, "updated": updated}))
' "$since"
}

# db_queue_health — стан черги jobs одним JSON-рядком: скільки подій уже мали
# бути обробленими (pending, у яких available_at у минулому — відкладені nudge
# сюди не рахуються), вік найстарішої з них і скільки running-джобів прострочили
# lease. Ненульовий oldest_due_pending_s — ознака, що воркер не забирає чергу.
#
# Окремо віддається busy_type/busy_s: воркер бере джоби по одному, тож довгий
# джоб (глибоке дослідження — до 90 хв) законно тримає чергу. Без цього поля
# черга за ним виглядає точно як мертвий воркер.
db_queue_health() {
  _db_get "/jobs?select=type,status,available_at,started_at,lease_expires_at&status=in.(pending,running)" | python3 -c '
import datetime, json, sys

now = datetime.datetime.now(datetime.timezone.utc)


def ts(value):
    if not value:
        return None
    try:
        return datetime.datetime.fromisoformat(value)
    except ValueError:
        return None


due = oldest = running = stale = 0
busy_type = ""
busy_s = 0
for row in json.load(sys.stdin):
    if row.get("status") == "pending":
        at = ts(row.get("available_at"))
        if at is None or at > now:
            continue
        due += 1
        oldest = max(oldest, int((now - at).total_seconds()))
    else:
        running += 1
        lease = ts(row.get("lease_expires_at"))
        if lease is None or lease < now:
            stale += 1
            continue
        started = ts(row.get("started_at"))
        age = int((now - started).total_seconds()) if started else 0
        # Найдовший із живих — саме він визначає, чи виправдане очікування черги.
        if age >= busy_s:
            busy_s = age
            busy_type = row.get("type") or ""

print(json.dumps({
    "due_pending": due,
    "oldest_due_pending_s": oldest,
    "running": running,
    "stale_running": stale,
    "busy_type": busy_type,
    "busy_s": busy_s,
}))
'
}

# db_deep_research_health — чи не сиплеться глибоке дослідження мовчки: останні
# звіти зі статусом error/timeout (у тому числі вставлені власником звіти
# зовнішніх моделей, позначені як відмова) і скільки джобів синтезу впало.
# Порожній JSON з нулями означає «нема на що дивитись», а не «нема таблиць» —
# відсутність таблиць видно окремою помилкою PostgREST у doctor.sh.
db_deep_research_health() {
  local since="${1:-}"
  [ -n "$since" ] || since="$(python3 -c '
import datetime
print((datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ"))
')"
  # Запит до research_reports служить і перевіркою, що міграція глибокого
  # дослідження накочена: без таблиці (чи без колонки superseded_at) PostgREST
  # відповідає помилкою, і це має долетіти до doctor.sh як окремий стан, а не
  # розчинитись у «даних немає».
  # Витіснені звіти (superseded_at не порожній) до health не беремо: питання
  # тут — «чи зараз щось зламано», а невдалий прогін, який власник уже
  # перекрив успішним, інакше тримав би тривогу ввімкненою цілий тиждень.
  local reports jobs tables_ok=true
  reports="$(_db_get "/research_reports?select=provider,stage,status,created_at&superseded_at=is.null&created_at=gte.$(_urlenc "$since")" 2>/dev/null)" || tables_ok=false
  jobs="$(_db_get "/jobs?select=type,status,last_error,finished_at&type=eq.deep_research_synthesis&status=eq.failed&finished_at=gte.$(_urlenc "$since")" 2>/dev/null || echo "[]")"
  python3 -c '
import json, sys

tables_ok = sys.argv[3] == "true"
try:
    reports = json.loads(sys.argv[1] or "[]")
except json.JSONDecodeError:
    reports, tables_ok = [], False
try:
    jobs = json.loads(sys.argv[2] or "[]")
except json.JSONDecodeError:
    jobs = []
if not isinstance(reports, list):
    reports = []
if not isinstance(jobs, list):
    jobs = []

bad = [r for r in reports if r.get("status") in ("error", "timeout")]
providers = sorted({r.get("provider") or "?" for r in bad})
last_error = ""
if jobs:
    newest = max(jobs, key=lambda j: j.get("finished_at") or "")
    last_error = " ".join(str(newest.get("last_error") or "").split())[:300]

print(json.dumps({
    "tables_ok": tables_ok,
    "reports_total": len(reports),
    "reports_failed": len(bad),
    "failed_providers": providers,
    "jobs_failed": len(jobs),
    "last_job_error": last_error,
}))
' "$reports" "$jobs" "$tables_ok"
}

# ---------------------------------------------------------------------------
# CLI dispatch — лише коли скрипт запущено напряму, не при source.
# ---------------------------------------------------------------------------

_db_usage() {
  cat >&2 <<'EOF'
Використання: db.sh <команда> [аргументи]

  get-ideas [--status X] [--track Y] [--id X]
  get-idea <id>
  upsert-idea <json|-|file>
  upsert <table> <on_conflict_col> <json|-|file>
  delete <path-з-query>   (напр. "/sources?idea_id=eq.PI-0001")
  update-idea-status <id> <new_status> <actor> <reason> [run_id]
  insert-source <idea_id> <json|-|file>
  insert-event <idea_id> <actor> <change> <reason> [run_id]
  register-run-start <run_id> <job> [track] [provider]
  register-run-finish <run_id> <status> [errors_json] [token_usage_json] [processed_urls_json] [notes] [meta_json]
  get-last-run <job> [track]
  check-url-processed <url> [track]
  check-url-in-sources <url>
  insert-inbox <json|-|file>
  update-inbox <draft_id> <json|-|file>
  get-inbox <draft_id>
  ideas-activity-since <iso8601>
  queue-health
  deep-research-health [iso8601-since]

JSON-аргументи: літеральний рядок, "-" (stdin), або шлях до файлу.
EOF
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  cmd="${1:-}"
  [ $# -gt 0 ] && shift
  case "$cmd" in
    get-ideas) db_get_ideas "$@" ;;
    get-idea) db_get_idea "$@" ;;
    upsert-idea) db_upsert_idea "$@" ;;
    upsert) db_upsert "$@" ;;
    delete) db_delete "$@" ;;
    update-idea-status) db_update_idea_status "$@" ;;
    insert-source) db_insert_source "$@" ;;
    insert-event) db_insert_event "$@" ;;
    register-run-start) db_register_run_start "$@" ;;
    register-run-finish) db_register_run_finish "$@" ;;
    get-last-run) db_get_last_run "$@" ;;
    check-url-processed) db_check_url_processed "$@" ;;
    check-url-in-sources) db_check_url_in_sources "$@" ;;
    insert-inbox) db_insert_inbox "$@" ;;
    update-inbox) db_update_inbox "$@" ;;
    get-inbox) db_get_inbox "$@" ;;
    ideas-activity-since) db_ideas_activity_since "$@" ;;
    queue-health) db_queue_health "$@" ;;
    deep-research-health) db_deep_research_health "$@" ;;
    -h|--help|"") _db_usage; [ "$cmd" = "" ] && exit 2 || exit 0 ;;
    *) echo "db.sh: невідома команда: $cmd" >&2; _db_usage; exit 2 ;;
  esac
  exit $?
fi
