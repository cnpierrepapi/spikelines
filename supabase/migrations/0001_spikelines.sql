-- Spikelines persistence — ISOLATED from anything Foil. All objects are
-- prefixed spk_ and live in their own footprint inside the shared project.
-- Accessed ONLY via the service-role key from server API routes; RLS is on with
-- no policies, so the anon key (used by Foil) can never read or write these.

-- Players: one row per device (localStorage id), optional linked wallet.
create table if not exists public.spk_players (
  device_id    text primary key,
  username     text,
  wallet       text,
  spikes       integer        not null default 0,
  score        integer        not null default 0,
  rewards_usdc numeric(12,6)  not null default 0,
  created_at   timestamptz    not null default now(),
  updated_at   timestamptz    not null default now()
);
-- Case-insensitive unique usernames.
create unique index if not exists spk_players_username_uniq on public.spk_players (lower(username)) where username is not null;
create index if not exists spk_players_score_idx on public.spk_players (score desc);

-- Pack purchases (USDC -> SPIKES). signature PK = idempotent crediting.
create table if not exists public.spk_deposits (
  signature  text primary key,
  device_id  text not null,
  wallet     text,
  usdc       numeric(12,6) not null,
  spikes     integer not null,
  created_at timestamptz not null default now()
);

-- Reward withdrawals. The payout script pulls status='pending' rows and pays.
create table if not exists public.spk_payouts (
  id         bigint generated always as identity primary key,
  device_id  text not null,
  wallet     text not null,
  usdc       numeric(12,6) not null,
  status     text not null default 'pending',  -- pending | paid | failed
  signature  text,
  error      text,
  created_at timestamptz not null default now(),
  paid_at    timestamptz
);
create index if not exists spk_payouts_status_idx on public.spk_payouts (status);

alter table public.spk_players  enable row level security;
alter table public.spk_deposits enable row level security;
alter table public.spk_payouts  enable row level security;

-- Upsert a player's leaderboard/profile state (score & spikes are SET, not added).
create or replace function public.spk_sync_player(
  p_device text, p_username text, p_score integer, p_spikes integer, p_wallet text
) returns public.spk_players language plpgsql security definer as $$
declare r public.spk_players;
begin
  insert into public.spk_players as p (device_id, username, score, spikes, wallet, updated_at)
  values (p_device, nullif(p_username,''), coalesce(p_score,0), coalesce(p_spikes,0), nullif(p_wallet,''), now())
  on conflict (device_id) do update set
    username   = coalesce(nullif(excluded.username,''), p.username),
    score      = greatest(excluded.score, 0),
    spikes     = greatest(excluded.spikes, 0),
    wallet     = coalesce(nullif(excluded.wallet,''), p.wallet),
    updated_at = now()
  returning * into r;
  return r;
end $$;

-- Atomically credit SPIKES from a verified pack purchase; returns new balance.
create or replace function public.spk_credit_spikes(
  p_device text, p_username text, p_wallet text, p_spikes integer
) returns integer language plpgsql security definer as $$
declare new_balance integer;
begin
  insert into public.spk_players as p (device_id, username, wallet, spikes, updated_at)
  values (p_device, nullif(p_username,''), nullif(p_wallet,''), p_spikes, now())
  on conflict (device_id) do update set
    spikes     = p.spikes + p_spikes,
    wallet     = coalesce(nullif(excluded.wallet,''), p.wallet),
    updated_at = now()
  returning spikes into new_balance;
  return new_balance;
end $$;

-- Move a player's whole rewards_usdc balance into a pending payout. Returns the
-- amount queued (0 if nothing owed or no wallet linked).
create or replace function public.spk_request_withdraw(p_device text)
returns numeric language plpgsql security definer as $$
declare amt numeric; w text;
begin
  select rewards_usdc, wallet into amt, w from public.spk_players where device_id = p_device for update;
  if amt is null or amt <= 0 or w is null then return 0; end if;
  update public.spk_players set rewards_usdc = 0, updated_at = now() where device_id = p_device;
  insert into public.spk_payouts (device_id, wallet, usdc) values (p_device, w, amt);
  return amt;
end $$;

-- Operator credits a reward (e.g. weekly leaderboard pool share) to a player.
create or replace function public.spk_credit_reward(p_device text, p_usdc numeric)
returns numeric language plpgsql security definer as $$
declare bal numeric;
begin
  update public.spk_players set rewards_usdc = rewards_usdc + p_usdc, updated_at = now()
  where device_id = p_device returning rewards_usdc into bal;
  return bal;
end $$;
