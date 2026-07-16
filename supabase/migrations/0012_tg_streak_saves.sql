-- T8 economy: streak-save offers. When a player's streak breaks on a losing call,
-- they're offered a single-use, time-boxed chance to spend SPIKES to keep it. The
-- offer is a row (not a value in the button) so it can't be replayed or double-spent.
create table if not exists tg_streak_saves (
  id          bigint generated always as identity primary key,
  tg_id       bigint not null,
  chat_id     bigint not null,          -- the group whose board streak also gets restored
  prev_streak int    not null,          -- the streak being protected
  cost        int    not null,          -- SPIKES price, fixed at offer time
  used        boolean not null default false,
  created_at  timestamptz not null default now(),
  used_at     timestamptz
);

create index if not exists tg_streak_saves_tg_idx on tg_streak_saves (tg_id, created_at desc);

-- Service-role only (the bot). RLS on with no policy = no anon/authenticated access,
-- matching every other tg_ table.
alter table tg_streak_saves enable row level security;
