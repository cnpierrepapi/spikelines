-- Availability polling for the /proof ledger (applied 2026-07-01).
--
-- A bet settles BEFORE TxLINE has built its Merkle proof / posted the interval
-- root on-chain, so it lands 'pending'/'unprovable' (greyed Verify button) and
-- only becomes anchorable minutes later once the root is available. Nothing used
-- to notice that transition automatically — a human had to tap each greyed button.
--
-- These two columns let a background sweep (/api/proof/sweep) poll for
-- availability with backoff instead of hammering the 404-ing endpoint:
--   next_check_at  : when this bet is next eligible for a re-check. Defaults to
--                    now() so a freshly settled bet is checked promptly. A sweep
--                    that finds the root still absent pushes it out (exponential
--                    backoff); a terminal outcome (root posted but won't reconcile,
--                    or gave up) sets it to 'infinity' so we never poll it again.
--   check_attempts : how many times we've re-checked (drives the backoff curve).
alter table public.spk_bets add column if not exists next_check_at  timestamptz not null default now();
alter table public.spk_bets add column if not exists check_attempts smallint    not null default 0;

comment on column public.spk_bets.next_check_at  is 'When the availability sweep may next re-check this bet; ''infinity'' = terminal (verified elsewhere, or won''t reconcile — stop polling).';
comment on column public.spk_bets.check_attempts is 'Availability re-check count; drives exponential backoff in /api/proof/sweep.';

-- The sweep selects on (proof_status IN pending/unprovable) AND next_check_at <= now.
create index if not exists spk_bets_sweep_idx on public.spk_bets (next_check_at)
  where proof_status in ('pending', 'unprovable');
