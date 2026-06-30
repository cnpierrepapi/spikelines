-- Per-bet ledger for the public /proof page. Every settled bet (from every
-- player) is persisted here with the data needed to prove it on-chain: which
-- fixture + stat + window it settled on, and (filled in by the verifier) the
-- TxLINE daily-scores Merkle root it was checked against via validate_stat.
--
-- ISOLATED like the rest of Spikelines: spk_ prefix, RLS on with NO policies, so
-- the anon key (shared with Foil) can never read or write it. Reached ONLY by the
-- service-role key from server routes — same footprint as spk_deposits.

create table if not exists public.spk_bets (
  id            bigint generated always as identity primary key,
  -- (device_id, client_bet_id) makes a settle retry idempotent: the room mints a
  -- stable per-bet id locally, so re-POSTing the same bet upserts instead of dup.
  device_id     text    not null,
  client_bet_id text    not null,
  username      text,
  fixture_id    bigint  not null,
  match         text    not null,                 -- "Brazil–Japan" (display)
  mode          text    not null default 'live',  -- live | archived
  market        text    not null,                 -- goal | corner | yellow | red
  side          smallint not null,                -- 1 | 2 (which participant)
  stat_key      integer not null,                 -- TxLINE per-side score stat key
  mins          integer not null,                 -- window length (minutes)
  choice        text    not null,                 -- YES | NO
  outcome       text    not null,                 -- won | lost
  reward        integer not null default 0,       -- SPIKES paid on a win
  -- The window the bet covered. Timestamps are the reliable key (the verifier
  -- maps ts -> TxLINE seq); seqs are cached once resolved.
  base_ts       bigint,                            -- window opened (ms)
  settle_ts     bigint,                            -- window closed / settling event (ms)
  base_seq      integer,
  settle_seq    integer,
  -- Proof state, filled inline at settle time by lib/proof.ts.
  --   pending    : not yet verified
  --   verified   : validate_stat view confirmed the settling stat vs the on-chain root
  --   failed     : proof did not reconcile (flag — should not happen for honest data)
  --   unprovable : the on-chain root for that slot is not posted yet (RootNotAvailable)
  proof_status  text    not null default 'pending',
  proof_root    text,                              -- daily_scores_roots PDA (base58)
  proof_json    jsonb,                             -- stat-validation bundle(s) + verdicts
  created_at    timestamptz not null default now(),
  verified_at   timestamptz,
  unique (device_id, client_bet_id)
);

create index if not exists spk_bets_fixture_idx on public.spk_bets (fixture_id);
create index if not exists spk_bets_created_idx on public.spk_bets (created_at desc);
create index if not exists spk_bets_proof_idx   on public.spk_bets (proof_status);

alter table public.spk_bets enable row level security;
