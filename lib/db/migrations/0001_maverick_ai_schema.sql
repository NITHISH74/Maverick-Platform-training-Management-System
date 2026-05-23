-- =============================================================
-- Maverick Execution Platform — Supabase schema
-- Migration 0001: core tables + AI layer + RLS + RPCs
-- =============================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";
create extension if not exists "vector";

-- =============================================================
-- ENUMS
-- =============================================================
do $$ begin
  create type user_role         as enum ('admin','coordinator','trainer');
exception when duplicate_object then null; end $$;
do $$ begin
  create type batch_status      as enum ('planned','running','completed','closed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type attendance_status as enum ('present','absent','leave','holiday');
exception when duplicate_object then null; end $$;
do $$ begin
  create type assessment_type   as enum ('sprint','api','project');
exception when duplicate_object then null; end $$;
do $$ begin
  create type severity_level    as enum ('LOW','MEDIUM','HIGH','CRITICAL');
exception when duplicate_object then null; end $$;
do $$ begin
  create type agent_action      as enum ('reminder','escalation','coordinator_task','no_action');
exception when duplicate_object then null; end $$;
do $$ begin
  create type task_status       as enum ('open','in_progress','resolved','dismissed');
exception when duplicate_object then null; end $$;

-- =============================================================
-- USERS
-- =============================================================
create table if not exists users (
  id              serial primary key,
  auth0_sub       text unique not null,
  email           text unique not null,
  full_name       text not null,
  role            user_role not null,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  modified_by     integer references users(id)
);
create index if not exists idx_users_role on users(role);

-- =============================================================
-- BATCHES
-- =============================================================
create table if not exists batches (
  id                       serial primary key,
  batch_code               text unique not null,
  name                     text not null,
  program                  text not null,
  start_date               date not null,
  end_date                 date not null,
  status                   batch_status not null default 'planned',
  capacity                 integer not null default 30,
  coordinator_id           integer references users(id),
  attendance_cutoff_time   time not null default '10:00',
  attendance_threshold_pct numeric(5,2) not null default 75.0,
  clearance_threshold_pct  numeric(5,2) not null default 60.0,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  modified_by              integer references users(id)
);
create index if not exists idx_batches_status on batches(status);
create index if not exists idx_batches_coordinator on batches(coordinator_id);

create table if not exists batch_trainers (
  id          serial primary key,
  batch_id    integer not null references batches(id) on delete cascade,
  trainer_id  integer not null references users(id),
  created_at  timestamptz not null default now(),
  unique(batch_id, trainer_id)
);
create index if not exists idx_batch_trainers_trainer on batch_trainers(trainer_id);
create index if not exists idx_batch_trainers_batch   on batch_trainers(batch_id);

-- =============================================================
-- CANDIDATES
-- =============================================================
create table if not exists candidates (
  id              serial primary key,
  employee_id     text unique not null,
  full_name       text not null,
  email           text unique not null,
  phone           text,
  batch_id        integer references batches(id),
  status          text not null default 'active',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  modified_by     integer references users(id)
);
create index if not exists idx_candidates_batch  on candidates(batch_id);
create index if not exists idx_candidates_status on candidates(status);
create index if not exists idx_candidates_name_trgm on candidates using gin (full_name gin_trgm_ops);

-- =============================================================
-- ATTENDANCE
-- =============================================================
create table if not exists attendance (
  id            bigserial primary key,
  candidate_id  integer not null references candidates(id) on delete cascade,
  batch_id      integer not null references batches(id) on delete cascade,
  attend_date   date not null,
  status        attendance_status not null,
  marked_by     integer references users(id),
  source        text not null default 'manual',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique(candidate_id, attend_date)
);
create index if not exists idx_attendance_batch_date on attendance(batch_id, attend_date);
create index if not exists idx_attendance_candidate_date on attendance(candidate_id, attend_date desc);
create index if not exists idx_attendance_date on attendance(attend_date);

-- =============================================================
-- ASSESSMENTS
-- =============================================================
create table if not exists assessments (
  id              bigserial primary key,
  candidate_id    integer not null references candidates(id) on delete cascade,
  batch_id        integer not null references batches(id) on delete cascade,
  assessment_type assessment_type not null,
  title           text not null,
  score           numeric(5,2) not null,
  max_score       numeric(5,2) not null default 100,
  passed          boolean generated always as (score >= (max_score * 0.6)) stored,
  scheduled_date  date not null,
  uploaded_date   date,
  uploaded_by     integer references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_assessments_batch_type on assessments(batch_id, assessment_type);
create index if not exists idx_assessments_candidate on assessments(candidate_id);
create index if not exists idx_assessments_scheduled on assessments(scheduled_date);

-- =============================================================
-- FEEDBACK + AI ANALYSIS
-- =============================================================
create table if not exists feedback (
  id            bigserial primary key,
  batch_id      integer not null references batches(id) on delete cascade,
  candidate_id  integer references candidates(id),
  trainer_id    integer references users(id),
  response_text text not null,
  rating        integer check (rating between 1 and 5),
  created_at    timestamptz not null default now()
);
create index if not exists idx_feedback_batch on feedback(batch_id);

create table if not exists feedback_analysis (
  id                          bigserial primary key,
  batch_id                    integer not null references batches(id) on delete cascade,
  analyzed_at                 timestamptz not null default now(),
  sentiment_positive_pct      numeric(5,2) not null,
  sentiment_neutral_pct       numeric(5,2) not null,
  sentiment_negative_pct      numeric(5,2) not null,
  top_complaints              text[] not null,
  improvement_requests        text[] not null,
  quality_insights            text not null,
  trainer_effectiveness_score numeric(4,2) not null,
  responses_analyzed          integer not null,
  model_version               text not null default 'gemini-2.5-flash'
);
create index if not exists idx_feedback_analysis_batch on feedback_analysis(batch_id, analyzed_at desc);

-- =============================================================
-- NOTIFICATIONS
-- =============================================================
create table if not exists notifications_log (
  id                bigserial primary key,
  recipient_id      integer references users(id),
  recipient_email   text not null,
  notif_type        text not null,
  subject           text not null,
  body              text not null,
  urgency_level     smallint not null default 1,
  ai_generated      boolean not null default false,
  status            text not null default 'queued',
  related_batch     integer references batches(id),
  related_candidate integer references candidates(id),
  sent_at           timestamptz,
  error_message     text,
  created_at        timestamptz not null default now()
);
create index if not exists idx_notifications_status on notifications_log(status);
create index if not exists idx_notifications_batch on notifications_log(related_batch);

-- =============================================================
-- TOPPER CONFIG
-- =============================================================
create table if not exists topper_config (
  id                serial primary key,
  batch_id          integer references batches(id) on delete cascade,
  attendance_weight numeric(5,2) not null default 20,
  sprint_weight     numeric(5,2) not null default 25,
  api_weight        numeric(5,2) not null default 25,
  project_weight    numeric(5,2) not null default 30,
  updated_at        timestamptz not null default now(),
  modified_by       integer references users(id),
  check (attendance_weight + sprint_weight + api_weight + project_weight = 100)
);

-- =============================================================
-- AUDIT
-- =============================================================
create table if not exists audit_log (
  id            bigserial primary key,
  actor_id      integer references users(id),
  actor_name    text,
  action        text not null,
  entity_type   text not null,
  entity_id     text not null,
  description   text,
  metadata      jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists idx_audit_entity on audit_log(entity_type, entity_id);
create index if not exists idx_audit_created on audit_log(created_at desc);

-- =============================================================
-- AGENT TABLES (Batch Monitoring Agent — Feature 4)
-- =============================================================
create table if not exists agent_runs (
  id              uuid primary key default uuid_generate_v4(),
  triggered_by    text not null,
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  status          text not null default 'running',
  batches_scanned int default 0,
  issues_found    int default 0,
  actions_taken   int default 0,
  error_message   text
);

create table if not exists agent_events (
  id              bigserial primary key,
  run_id          uuid not null references agent_runs(id) on delete cascade,
  batch_id        integer references batches(id),
  candidate_id    integer references candidates(id),
  issue_type      text not null,
  severity        severity_level not null,
  action_taken    agent_action not null,
  agent_name      text not null,
  llm_rationale   text,
  payload         jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists idx_agent_events_run on agent_events(run_id);
create index if not exists idx_agent_events_batch on agent_events(batch_id, created_at desc);
create unique index if not exists uniq_agent_event_window on agent_events (
  batch_id,
  coalesce(candidate_id, 0),
  issue_type,
  date_trunc('hour', created_at) + (extract(minute from created_at)::int / 30) * interval '30 minutes'
) where action_taken <> 'no_action';

create table if not exists agent_tasks (
  id                       bigserial primary key,
  run_id                   uuid references agent_runs(id),
  batch_id                 integer references batches(id),
  task_description         text not null,
  priority                 severity_level not null,
  status                   task_status not null default 'open',
  created_by_agent         text not null,
  assigned_to_coordinator  integer references users(id),
  resolved_by              integer references users(id),
  resolved_at              timestamptz,
  created_at               timestamptz not null default now()
);
create index if not exists idx_agent_tasks_status on agent_tasks(status);
create index if not exists idx_agent_tasks_coord  on agent_tasks(assigned_to_coordinator, status);

create table if not exists agent_daily_digest (
  id              bigserial primary key,
  run_date        date not null unique,
  digest_text     text not null,
  batches_scanned int not null,
  issues_found    int not null,
  actions_taken   int not null,
  created_at      timestamptz not null default now()
);

create table if not exists agent_memory (
  id          bigserial primary key,
  key         text unique not null,
  value       jsonb not null,
  expires_at  timestamptz,
  updated_at  timestamptz not null default now()
);

-- =============================================================
-- RAG store
-- =============================================================
create table if not exists rag_documents (
  id          bigserial primary key,
  doc_type    text not null,
  ref_id      text,
  content     text not null,
  embedding   vector(768) not null,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_rag_docs_embed on rag_documents using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index if not exists idx_rag_docs_type  on rag_documents(doc_type);

-- =============================================================
-- RPCs
-- =============================================================
create or replace function current_user_id() returns int language sql stable as $$
  select id from users where auth0_sub = auth.jwt() ->> 'sub'
$$;

create or replace function current_user_role() returns user_role language sql stable as $$
  select role from users where auth0_sub = auth.jwt() ->> 'sub'
$$;

create or replace function trainer_has_batch(b_id int) returns boolean language sql stable as $$
  select exists (
    select 1 from batch_trainers bt
    where bt.batch_id = b_id and bt.trainer_id = current_user_id()
  )
$$;

create or replace function absent_3plus_days(b_id int) returns jsonb
language sql stable as $$
  with d as (
    select candidate_id, attend_date, status,
           row_number() over (partition by candidate_id order by attend_date desc) rn
    from attendance where batch_id = b_id and attend_date >= current_date - 4
  )
  select coalesce(jsonb_agg(jsonb_build_object('candidate_id', candidate_id)), '[]'::jsonb)
  from (
    select candidate_id from d where rn <= 3 and status = 'absent'
    group by candidate_id having count(*) = 3
  ) x
$$;

create or replace function batch_attendance_pct(b_id int, lookback_days int) returns numeric
language sql stable as $$
  select coalesce(round(100.0 * sum(case when status='present' then 1 else 0 end)::numeric
                        / nullif(count(*),0), 2), 100)
  from attendance
  where batch_id = b_id and attend_date >= current_date - lookback_days
$$;

create or replace function batch_clearance_rate(b_id int) returns numeric
language sql stable as $$
  select coalesce(round(100.0 * sum(case when passed then 1 else 0 end)::numeric
                        / nullif(count(*),0), 2), 100)
  from assessments where batch_id = b_id
$$;

create or replace function agent_run_counts(r_id uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'batches_scanned', count(distinct batch_id),
    'issues_found',    count(*) filter (where action_taken <> 'no_action'),
    'actions_taken',   count(*) filter (where action_taken in ('reminder','escalation','coordinator_task'))
  )
  from agent_events where run_id = r_id
$$;

create or replace function match_rag(query_embedding vector(768), match_count int)
returns table(content text, similarity float) language sql stable as $$
  select content, 1 - (embedding <=> query_embedding) as similarity
  from rag_documents
  order by embedding <=> query_embedding
  limit match_count
$$;

create or replace function execute_safe_select(q text) returns setof jsonb
language plpgsql security definer as $$
begin
  if upper(trim(leading from q)) not like 'SELECT%' then
    raise exception 'only SELECT allowed';
  end if;
  return query execute format('select to_jsonb(t) from (%s) t', q);
end$$;

-- =============================================================
-- RLS
-- =============================================================
alter table batches            enable row level security;
alter table candidates         enable row level security;
alter table attendance         enable row level security;
alter table assessments        enable row level security;
alter table feedback           enable row level security;
alter table feedback_analysis  enable row level security;
alter table agent_tasks        enable row level security;
alter table agent_events       enable row level security;

drop policy if exists admin_all_batches on batches;
create policy admin_all_batches on batches for all
  using (current_user_role() = 'admin') with check (current_user_role() = 'admin');

drop policy if exists coord_own_batches on batches;
create policy coord_own_batches on batches for all
  using (current_user_role() = 'coordinator' and coordinator_id = current_user_id())
  with check (coordinator_id = current_user_id());

drop policy if exists trainer_read_batches on batches;
create policy trainer_read_batches on batches for select
  using (current_user_role() = 'trainer' and trainer_has_batch(id));

drop policy if exists trainer_read_candidates on candidates;
create policy trainer_read_candidates on candidates for select
  using (current_user_role() = 'trainer' and trainer_has_batch(batch_id));

drop policy if exists coord_admin_candidates on candidates;
create policy coord_admin_candidates on candidates for all
  using (current_user_role() in ('admin','coordinator'));

drop policy if exists trainer_attendance on attendance;
create policy trainer_attendance on attendance for all
  using (
    current_user_role() = 'admin'
    or current_user_role() = 'coordinator'
    or (current_user_role() = 'trainer' and trainer_has_batch(batch_id))
  );

drop policy if exists assessments_rbac on assessments;
create policy assessments_rbac on assessments for all
  using (
    current_user_role() in ('admin','coordinator')
    or (current_user_role() = 'trainer' and trainer_has_batch(batch_id))
  );

drop policy if exists feedback_rbac on feedback;
create policy feedback_rbac on feedback for all
  using (
    current_user_role() in ('admin','coordinator')
    or (current_user_role() = 'trainer' and trainer_has_batch(batch_id))
  );

drop policy if exists feedback_analysis_rbac on feedback_analysis;
create policy feedback_analysis_rbac on feedback_analysis for select
  using (current_user_role() in ('admin','coordinator'));

drop policy if exists coord_read_events on agent_events;
create policy coord_read_events on agent_events for select
  using (
    current_user_role() = 'admin'
    or (current_user_role() = 'coordinator'
        and exists (select 1 from batches b where b.id = agent_events.batch_id and b.coordinator_id = current_user_id()))
  );

drop policy if exists agent_tasks_rbac on agent_tasks;
create policy agent_tasks_rbac on agent_tasks for all
  using (
    current_user_role() = 'admin'
    or (current_user_role() = 'coordinator' and assigned_to_coordinator = current_user_id())
  );
