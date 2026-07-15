-- Telegram bot tables. ISOLATED like the rest of Spikelines: tg_ prefix, RLS on
-- with NO policies, so the anon key (shared with Foil) can never read or write
-- them. Reached ONLY by the service-role key from the bot worker + server routes.
--
-- Model:
--   tg_users        one row per Telegram user: identity, server-side SPIKES
--                   balance (chat play has no browser localStorage), linked wallet.
--   tg_chats        every chat the bot serves (DM or group) + the /quiet toggle.
--   tg_calls        one in-chat call (the shared message). Group calls are answered
--                   by many users, so the per-user picks live in tg_call_answers.
--   tg_call_answers each tapper's YES/NO on a call + their settled outcome.
--   tg_group_scores per-group-per-user leaderboard (correct/total/streak).
--
-- All call state lives here (not in worker memory) so a watcher restart resumes.

create table if not exists public.tg_users (
  tg_id        bigint primary key,               -- Telegram user id
  handle       text    not null,                 -- auto-assigned Spikelines handle
  username     text,                             -- Telegram @username (display)
  first_name   text,
  spikes       integer not null default 0,       -- server-side SPIKES balance (chat)
  wallet       text,                             -- linked Solana wallet (base58)
  streak       integer not null default 0,       -- current overall call streak
  best_streak  integer not null default 0,
  calls        integer not null default 0,       -- total calls made
  correct      integer not null default 0,       -- total correct calls
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.tg_chats (
  chat_id     bigint primary key,                -- Telegram chat id (group = negative)
  type        text    not null,                  -- private | group | supergroup
  title       text,                              -- group title / user handle
  quiet       boolean not null default false,    -- /quiet pauses calls in this chat
  active      boolean not null default true,     -- false once the bot is removed
  added_at    timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.tg_calls (
  id           bigint generated always as identity primary key,
  chat_id      bigint  not null,
  message_id   bigint,                            -- the message to edit (null until sent)
  fixture_id   bigint  not null,
  match        text    not null,                  -- "Panama-England" (display)
  market       text    not null,                  -- goal | corner | yellow | red
  side         smallint not null,                 -- 1 | 2 (attacking participant)
  team         text    not null,                  -- attacking team display name
  mins         integer not null,                  -- window length (minutes)
  open_sec     integer not null,                  -- match second at open
  deadline_sec integer not null,                  -- open_sec + mins*60 (settlement bound)
  base_ts      bigint,                            -- feed Ts at open (proof window start)
  settle_ts    bigint,                            -- feed Ts at settle (proof window end)
  closes_at    timestamptz not null,              -- decision window end (~30s of tapping)
  status       text    not null default 'open',   -- open | locked | settled | void
  result       text,                              -- yes | no (did the market hit in window)
  created_at   timestamptz not null default now(),
  settled_at   timestamptz
);

create index if not exists tg_calls_fixture_idx on public.tg_calls (fixture_id, status);
create index if not exists tg_calls_chat_idx    on public.tg_calls (chat_id, status);
create index if not exists tg_calls_status_idx  on public.tg_calls (status);

create table if not exists public.tg_call_answers (
  call_id    bigint  not null references public.tg_calls (id) on delete cascade,
  tg_id      bigint  not null,
  choice     text    not null,                    -- YES | NO
  outcome    text,                                -- won | lost (set at settle)
  reward     integer not null default 0,          -- SPIKES paid on a win
  created_at timestamptz not null default now(),
  primary key (call_id, tg_id)
);

create index if not exists tg_call_answers_user_idx on public.tg_call_answers (tg_id);

create table if not exists public.tg_group_scores (
  chat_id     bigint  not null,
  tg_id       bigint  not null,
  correct     integer not null default 0,
  total       integer not null default 0,
  streak      integer not null default 0,
  best_streak integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (chat_id, tg_id)
);

create index if not exists tg_group_scores_board_idx on public.tg_group_scores (chat_id, correct desc);

alter table public.tg_users        enable row level security;
alter table public.tg_chats        enable row level security;
alter table public.tg_calls        enable row level security;
alter table public.tg_call_answers enable row level security;
alter table public.tg_group_scores enable row level security;
