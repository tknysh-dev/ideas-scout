-- Довговічна черга команд Vercel/Telegram -> M1.
-- Realtime є сигналом пробудження, а jobs — джерелом правди та відновлення.

begin;

create table jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (
    status in ('pending', 'running', 'succeeded', 'failed', 'cancelled')
  ),
  requested_by text not null,
  idempotency_key text unique,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts > 0),
  available_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  lease_expires_at timestamptz,
  worker_id text,
  claim_token uuid,
  run_id text references runs(run_id),
  last_error text
);

create index idx_jobs_claimable on jobs(status, available_at, created_at);
create index idx_jobs_created_at on jobs(created_at desc);

create trigger jobs_set_updated_at
  before update on jobs
  for each row
  execute function set_updated_at();

alter table jobs enable row level security;

create policy jobs_full_access on jobs
  for all
  to authenticated, service_role
  using (true)
  with check (true);

create or replace function claim_next_job(p_worker_id text, p_lease_seconds integer default 300)
returns setof jobs
language plpgsql
security invoker
set search_path = public
as $$
begin
  if coalesce(trim(p_worker_id), '') = '' then
    raise exception 'worker id is required';
  end if;
  if p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'lease seconds must be between 30 and 3600';
  end if;

  update jobs
  set status = 'failed',
      finished_at = now(),
      lease_expires_at = null,
      updated_at = now(),
      last_error = 'Worker lease expired after maximum attempts'
  where status = 'running'
    and lease_expires_at < now()
    and attempt_count >= max_attempts;

  return query
  with candidate as (
    select id
    from jobs
    where attempt_count < max_attempts
      and available_at <= now()
      and (
        status = 'pending'
        or (status = 'running' and lease_expires_at < now())
      )
    order by created_at
    for update skip locked
    limit 1
  )
  update jobs as job
  set status = 'running',
      attempt_count = job.attempt_count + 1,
      started_at = coalesce(job.started_at, now()),
      finished_at = null,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      worker_id = p_worker_id,
      claim_token = gen_random_uuid(),
      updated_at = now(),
      last_error = null
  from candidate
  where job.id = candidate.id
  returning job.*;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'jobs'
  ) then
    alter publication supabase_realtime add table jobs;
  end if;
end
$$;

commit;
