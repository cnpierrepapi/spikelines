-- Daily reward engine for Spikelines.
-- spk_daily   : per-player, per-day snapshot of the all-time cumulative score.
-- spk_rewards : admin-set USDC pool per calendar day (set in advance, revealed on day, distributed EOD).
-- spk_reward_grants : audit ledger of what each player was credited for a day (also gives idempotency).

create table if not exists public.spk_daily (
  device_id  text not null,
  day        date not null,
  score      integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (device_id, day)
);
create index if not exists spk_daily_day_idx on public.spk_daily (day);

create table if not exists public.spk_rewards (
  day            date primary key,
  pool_usdc      numeric(12,6) not null,
  status         text not null default 'set',   -- set | distributed
  distributed_at timestamptz,
  created_at     timestamptz not null default now()
);

create table if not exists public.spk_reward_grants (
  day        date not null,
  device_id  text not null,
  top_usdc   numeric(12,6) not null default 0,
  pb_usdc    numeric(12,6) not null default 0,
  total_usdc numeric(12,6) not null default 0,
  created_at timestamptz not null default now(),
  primary key (day, device_id)
);

alter table public.spk_daily         enable row level security;
alter table public.spk_rewards       enable row level security;
alter table public.spk_reward_grants enable row level security;

-- Upsert today's cumulative-score snapshot for a player (monotonic — keeps the
-- highest value seen that day, which for a cumulative score is the latest).
create or replace function public.spk_snapshot_daily(p_device text, p_day date, p_score integer)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.spk_daily (device_id, day, score, updated_at)
  values (p_device, p_day, greatest(coalesce(p_score,0),0), now())
  on conflict (device_id, day) do update set
    score = greatest(excluded.score, public.spk_daily.score),
    updated_at = now();
end $$;

-- Compute (and optionally commit) the reward split for a day.
--   30% of pool split EQUALLY among the top 10% by that day's score.
--   70% of pool split by improvement share (today - yesterday, floored at 0).
-- p_commit=false → dry-run preview (no writes). p_commit=true → persist grants,
-- credit players' rewards_usdc, and mark the day distributed (idempotent: errors
-- if the day has no pool set or is already distributed).
create or replace function public.spk_compute_day(p_day date, p_pool numeric, p_commit boolean)
returns table(device_id text, today integer, improve integer, top_usdc numeric, pb_usdc numeric, total_usdc numeric)
language plpgsql security definer set search_path = public, pg_temp as $$
-- output names collide with table columns; resolve bare refs to columns.
#variable_conflict use_column
declare
  v_n int; v_topk int; v_top_pool numeric; v_pb_pool numeric; v_total_improve numeric; v_status text;
begin
  if p_commit then
    select status into v_status from public.spk_rewards where day = p_day for update;
    if v_status is null then raise exception 'no reward pool set for %', p_day; end if;
    if v_status = 'distributed' then raise exception 'day % already distributed', p_day; end if;
  end if;

  v_top_pool := round(coalesce(p_pool,0) * 0.30, 6);
  v_pb_pool  := round(coalesce(p_pool,0) * 0.70, 6);

  create temp table _d on commit drop as
  select t.device_id, t.score as today,
         greatest(t.score - coalesce(y.score,0), 0) as improve
  from public.spk_daily t
  left join public.spk_daily y on y.device_id = t.device_id and y.day = p_day - 1
  where t.day = p_day;

  select count(*) into v_n from _d;
  if v_n = 0 then return; end if;

  v_topk := greatest(ceil(v_n * 0.10)::int, 1);
  select coalesce(sum(_d.improve),0) into v_total_improve from _d;

  create temp table _top on commit drop as
  select _d.device_id from _d order by _d.today desc, _d.device_id asc limit v_topk;

  create temp table _g on commit drop as
  select d.device_id, d.today, d.improve,
         case when d.device_id in (select t.device_id from _top t) then round(v_top_pool / v_topk, 6) else 0 end as top_usdc,
         case when v_total_improve > 0 then round(v_pb_pool * d.improve / v_total_improve, 6) else 0 end as pb_usdc
  from _d d;

  if p_commit then
    insert into public.spk_reward_grants (day, device_id, top_usdc, pb_usdc, total_usdc)
    select p_day, g.device_id, g.top_usdc, g.pb_usdc, g.top_usdc + g.pb_usdc from _g g
    on conflict (day, device_id) do update set
      top_usdc=excluded.top_usdc, pb_usdc=excluded.pb_usdc, total_usdc=excluded.total_usdc;

    update public.spk_players p
    set rewards_usdc = p.rewards_usdc + g.top_usdc + g.pb_usdc, updated_at = now()
    from _g g where p.device_id = g.device_id and (g.top_usdc + g.pb_usdc) > 0;

    update public.spk_rewards set status='distributed', distributed_at = now() where day = p_day;
  end if;

  return query
    select g.device_id, g.today, g.improve, g.top_usdc, g.pb_usdc, (g.top_usdc + g.pb_usdc)
    from _g g order by (g.top_usdc + g.pb_usdc) desc, g.today desc;
end $$;

-- Lock these down: server-side (service role) only, like the other spk_ RPCs.
revoke execute on function public.spk_snapshot_daily(text,date,integer)       from public, anon, authenticated;
revoke execute on function public.spk_compute_day(date,numeric,boolean)        from public, anon, authenticated;
grant  execute on function public.spk_snapshot_daily(text,date,integer)        to service_role;
grant  execute on function public.spk_compute_day(date,numeric,boolean)        to service_role;
