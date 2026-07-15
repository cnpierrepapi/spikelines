-- Telegram DM notifications: a per-user opt-out, plus a dedup table so a match is
-- only announced once (even across bot restarts). Same isolation as the other tg_
-- tables: RLS on, no policies, service-role only.

alter table public.tg_users add column if not exists notify boolean not null default true;

create table if not exists public.tg_match_notifs (
  fixture_id bigint primary key,
  created_at timestamptz not null default now()
);
alter table public.tg_match_notifs enable row level security;
