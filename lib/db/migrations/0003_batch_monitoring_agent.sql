-- =============================================================
-- Maverick Execution Platform — Migration 0003
-- Autonomous Batch Monitoring Agent
--
-- Adds the persistence + RPC layer the monitoring agent needs on
-- top of the existing agent_runs / agent_events / agent_tasks tables
-- from migration 0001:
--
--   * monitoring_alerts    — surfaced, human-visible alerts (batch + candidate)
--   * monitoring_email_log — every email the system tried to send
--   * monitoring_config    — singleton row holding the thresholds
--                            (so admins can change them without a code deploy)
--
-- Idempotent: safe to run twice. Re-running will NOT clobber config rows.
--
-- Apply with:
--   psql "$DATABASE_URL" -f lib/db/migrations/0003_batch_monitoring_agent.sql
-- =============================================================

-- =============================================================
-- monitoring_alerts
--
-- One row per *surfaced* issue. The agent's audit table is
-- agent_events; this table is the user-facing layer that the React
-- dashboard reads. We keep them separate because:
--   * agent_events stores every check the agent ran (including
--     no-action ones), useful for governance.
--   * monitoring_alerts is the "open inbox" — what humans see and
--     resolve.
--
-- alert_kind values:
--   attendance_not_uploaded   (batch-level)
--   attendance_drop           (batch-level, % over time)
--   low_attendance_pct        (batch-level absolute %)
--   continuous_absence        (candidate-level, 3+ consecutive days)
--   low_individual_attendance (candidate-level absolute %)
--   low_assessment_marks      (candidate-level, <40%)
--   low_clearance_rate        (batch-level)
--   assessment_overdue        (batch+assessment-level)
-- =============================================================
create table if not exists monitoring_alerts (
  id               bigserial primary key,
  run_id           uuid references agent_runs(id) on delete set null,
  batch_id         integer references batches(id) on delete cascade,
  candidate_id     integer references candidates(id) on delete cascade,
  assessment_id    integer references assessments(id) on delete set null,
  alert_kind       text not null,
  severity         severity_level not null,
  title            text not null,
  message          text not null,
  ai_summary       text,                 -- AI-generated natural-language summary
  metric_value     numeric(10,2),        -- the numeric trigger (% drop, score, etc.)
  threshold_value  numeric(10,2),
  status           text not null default 'open'
                   check (status in ('open','acknowledged','resolved','dismissed')),
  acknowledged_by  integer references users(id),
  acknowledged_at  timestamptz,
  resolved_by      integer references users(id),
  resolved_at      timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists idx_monitoring_alerts_batch    on monitoring_alerts(batch_id, created_at desc);
create index if not exists idx_monitoring_alerts_status   on monitoring_alerts(status, created_at desc);
create index if not exists idx_monitoring_alerts_kind     on monitoring_alerts(alert_kind);
create index if not exists idx_monitoring_alerts_severity on monitoring_alerts(severity);
-- Idempotency: don't double-create the same open alert on consecutive runs.
-- We dedupe on (batch_id, candidate_id, alert_kind, date(created_at)) at the
-- application layer; this index speeds that lookup.
create index if not exists idx_monitoring_alerts_dedupe
  on monitoring_alerts (batch_id, coalesce(candidate_id, 0), alert_kind, status, created_at desc);

-- =============================================================
-- monitoring_email_log
--
-- Mirror of every email we sent (or tried to send) on behalf of
-- the monitoring agent. notifications_log from migration 0001
-- already exists, but it was designed for the generic AI-notification
-- pipeline; this is a thinner table scoped to monitoring alerts so
-- admins can easily answer "what emails did the agent send today?"
-- =============================================================
create table if not exists monitoring_email_log (
  id              bigserial primary key,
  alert_id        bigint references monitoring_alerts(id) on delete set null,
  recipient_id    integer references users(id),
  recipient_email text not null,
  recipient_role  text,                  -- 'trainer' / 'coordinator' / 'admin'
  subject         text not null,
  body            text not null,
  status          text not null default 'sent'
                  check (status in ('sent','queued','failed')),
  provider        text,                  -- 'smtp', 'console' (dev), etc.
  error_message   text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_monitoring_email_log_alert  on monitoring_email_log(alert_id);
create index if not exists idx_monitoring_email_log_status on monitoring_email_log(status, created_at desc);

-- =============================================================
-- monitoring_config
--
-- Singleton row (id=1). Admins update via PATCH /api/monitoring/config.
-- Insert-only-on-fresh-install seeds the defaults.
-- =============================================================
create table if not exists monitoring_config (
  id                                serial primary key,
  attendance_batch_threshold_pct    numeric(5,2) not null default 75.0,
  attendance_drop_threshold_pct     numeric(5,2) not null default 10.0,
  attendance_candidate_threshold_pct numeric(5,2) not null default 70.0,
  assessment_pass_threshold_pct     numeric(5,2) not null default 40.0,
  clearance_threshold_pct           numeric(5,2) not null default 60.0,
  consecutive_absence_days          integer      not null default 3,
  assessment_overdue_days           integer      not null default 1,
  email_trainer                     boolean      not null default true,
  email_coordinator                 boolean      not null default true,
  email_admin                       boolean      not null default false,  -- per spec: admins see dashboards but don't get email
  scheduler_enabled                 boolean      not null default true,
  scheduler_cron                    text         not null default '0 11 * * *',   -- 11:00 daily
  updated_by                        integer references users(id),
  updated_at                        timestamptz  not null default now()
);

-- Seed singleton config if missing
insert into monitoring_config (id) values (1)
on conflict (id) do nothing;

-- =============================================================
-- RPCs needed by the agent's ScanBatchesTool (extended)
-- =============================================================

-- attendance percentage drop: last 7d vs prior 7d
create or replace function batch_attendance_drop_pct(b_id int) returns numeric
language sql stable as $$
  with recent as (
    select coalesce(round(100.0 * sum(case when status='present' then 1 else 0 end)::numeric
                          / nullif(count(*),0), 2), 0) as pct
    from attendance
    where batch_id = b_id
      and attend_date >= current_date - 7
      and attend_date <  current_date
  ),
  prior as (
    select coalesce(round(100.0 * sum(case when status='present' then 1 else 0 end)::numeric
                          / nullif(count(*),0), 2), 0) as pct
    from attendance
    where batch_id = b_id
      and attend_date >= current_date - 14
      and attend_date <  current_date - 7
  )
  select coalesce(prior.pct - recent.pct, 0) from recent, prior;
$$;

-- per-candidate attendance % across the last N days
create or replace function candidate_attendance_pct(c_id int, lookback_days int default 14) returns numeric
language sql stable as $$
  select coalesce(round(100.0 * sum(case when status='present' then 1 else 0 end)::numeric
                        / nullif(count(*),0), 2), 100)
  from attendance
  where candidate_id = c_id
    and attend_date >= current_date - lookback_days
$$;

-- candidates in a batch whose attendance is below `threshold_pct`
create or replace function batch_candidates_below_attendance(b_id int, threshold_pct numeric, lookback_days int default 14)
returns table(candidate_id int, full_name text, email text, attendance_pct numeric)
language sql stable as $$
  with att as (
    select c.id, c.full_name, c.email,
           coalesce(round(100.0 * sum(case when a.status='present' then 1 else 0 end)::numeric
                          / nullif(count(a.id),0), 2), 100) as pct
    from candidates c
    left join attendance a
      on a.candidate_id = c.id
     and a.attend_date >= current_date - lookback_days
    where c.batch_id = b_id and c.status = 'active'
    group by c.id, c.full_name, c.email
  )
  select id, full_name, email, pct from att where pct < threshold_pct
$$;

-- candidates in a batch whose latest assessment score is below `threshold_pct`
create or replace function batch_candidates_low_assessment(b_id int, threshold_pct numeric)
returns table(candidate_id int, assessment_id int, full_name text, email text, assessment_title text, score numeric, max_score numeric, pct numeric)
language sql stable as $$
  with latest as (
    select distinct on (a.candidate_id)
           a.candidate_id, a.id as aid, a.title, a.score, a.max_score
    from assessments a
    where a.batch_id = b_id
    order by a.candidate_id, a.scheduled_date desc, a.id desc
  )
  select c.id, l.aid, c.full_name, c.email, l.title, l.score, l.max_score,
         round(100.0 * l.score / nullif(l.max_score, 0), 2) as pct
  from latest l
  join candidates c on c.id = l.candidate_id
  where (100.0 * l.score / nullif(l.max_score, 0)) < threshold_pct
$$;

-- All trainers assigned to a batch (used by the email service to fan out)
create or replace function batch_trainer_emails(b_id int) returns table(user_id int, email text, full_name text)
language sql stable as $$
  select u.id, u.email, u.full_name
  from batch_trainers bt
  join users u on u.id = bt.trainer_id
  where bt.batch_id = b_id and u.is_active
$$;

-- =============================================================
-- A view powering the React batch-risk dashboard so the frontend
-- can pull one row per active batch in a single round-trip.
-- =============================================================
create or replace view batch_risk_summary as
  select
    b.id            as batch_id,
    b.batch_code,
    b.name          as batch_name,
    b.program,
    b.status,
    b.coordinator_id,
    -- counts
    (select count(*) from candidates c where c.batch_id = b.id and c.status = 'active') as active_candidates,
    -- metrics (default to neutral values if no data)
    coalesce(batch_attendance_pct(b.id, 14), 100)        as attendance_pct_14d,
    coalesce(batch_attendance_drop_pct(b.id), 0)         as attendance_drop_pct,
    coalesce(batch_clearance_rate(b.id), 100)            as clearance_pct,
    -- open alert breakdown
    (select count(*) from monitoring_alerts a where a.batch_id = b.id and a.status = 'open')               as open_alerts,
    (select count(*) from monitoring_alerts a where a.batch_id = b.id and a.status = 'open' and a.severity = 'CRITICAL') as critical_alerts,
    (select count(*) from monitoring_alerts a where a.batch_id = b.id and a.status = 'open' and a.severity = 'HIGH')     as high_alerts
  from batches b;

-- =============================================================
-- RLS — admins see everything, coordinators see their batches.
-- =============================================================
alter table monitoring_alerts    enable row level security;
alter table monitoring_email_log enable row level security;
alter table monitoring_config    enable row level security;

drop policy if exists monitoring_alerts_admin on monitoring_alerts;
create policy monitoring_alerts_admin on monitoring_alerts for all
  using (current_user_role() = 'admin');

drop policy if exists monitoring_alerts_coord on monitoring_alerts;
create policy monitoring_alerts_coord on monitoring_alerts for select
  using (
    current_user_role() = 'coordinator'
    and exists (select 1 from batches b
                 where b.id = monitoring_alerts.batch_id
                   and b.coordinator_id = current_user_id())
  );

drop policy if exists monitoring_alerts_trainer on monitoring_alerts;
create policy monitoring_alerts_trainer on monitoring_alerts for select
  using (
    current_user_role() = 'trainer'
    and trainer_has_batch(monitoring_alerts.batch_id)
  );

drop policy if exists monitoring_email_log_admin on monitoring_email_log;
create policy monitoring_email_log_admin on monitoring_email_log for all
  using (current_user_role() = 'admin');

drop policy if exists monitoring_config_admin on monitoring_config;
create policy monitoring_config_admin on monitoring_config for all
  using (current_user_role() = 'admin');

drop policy if exists monitoring_config_read on monitoring_config;
create policy monitoring_config_read on monitoring_config for select
  using (current_user_role() in ('admin','coordinator'));
