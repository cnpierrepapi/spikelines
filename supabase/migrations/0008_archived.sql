-- Durable archive of finished World Cup matches.
--
-- WHY: Live + Archived were both derived on-the-fly from TxLINE's
-- /api/fixtures/snapshot, which is a SHORT rolling window (~a handful of
-- fixtures). A match only landed in Archived during the brief overlap when it
-- was still in the snapshot AND flagged game_finalised — once it rolled off the
-- snapshot it vanished from both Live and Archived with no record. This table is
-- the source of truth for Archived: the moment a match is seen finished (by the
-- live OR archived route) it's upserted here and stays forever, even after it
-- ages out of the feed. Replay still works by fixture id via /api/scores/updates.
--
-- ISOLATED like the rest of Spikelines: spk_ prefix, RLS on with NO policies, so
-- the anon key (shared with Foil) can never read or write it. Reached ONLY by the
-- service-role key from server routes — same footprint as spk_bets / spk_deposits.

create table if not exists public.spk_archived (
  fixture_id  bigint primary key,          -- TxLINE FixtureId
  p1          text    not null,             -- participant 1 display name
  p2          text    not null,             -- participant 2 display name
  iso1        text    not null,             -- flag code for p1
  iso2        text    not null,             -- flag code for p2
  goals       integer not null default 0,   -- final combined goals (drives 🔥 thriller)
  minutes     integer not null default 0,   -- full-time clock minutes
  finished_at timestamptz not null default now(), -- first time we saw it finalised
  updated_at  timestamptz not null default now()  -- last goals/minutes refresh
);

create index if not exists spk_archived_finished_idx on public.spk_archived (finished_at desc);

alter table public.spk_archived enable row level security;
