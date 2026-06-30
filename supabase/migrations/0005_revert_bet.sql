-- Dispute-resolution claw-back for the /proof ledger (applied 2026-06-30).
--
-- When a bet is re-checked on /proof and the on-chain validate_stat proof RECONCILES
-- to the daily-scores root but the proven stat delta CONTRADICTS a recorded win
-- (the live room mis-settled it — e.g. a running-max glitch or a VAR rollback), the
-- SPIKES it paid out were unearned. This migration:
--   * marks the bet (reverted + revert_reason) so the overturn is auditable, and
--   * provides an atomic, idempotent-by-caller RPC to deduct the clawed SPIKES from
--     the server-authoritative player balance (the copy the daily USDC split reads).
--
-- Same isolation + lockdown as the rest of spk_*: SECURITY DEFINER, pinned
-- search_path, executable ONLY by the service-role key (never anon/authenticated),
-- per the 0002 hardening pass.

alter table public.spk_bets add column if not exists reverted      boolean not null default false;
alter table public.spk_bets add column if not exists revert_reason text;

-- Atomically deduct clawed-back SPIKES from a player, flooring at 0 (a balance can
-- never go negative). Returns the new balance, or 0 if the player row is gone.
-- Idempotency is the CALLER's job: only invoke this once per bet, gated on the
-- bet's `reverted` flag still being false, so a double-tap of Verify can't
-- double-deduct.
create or replace function public.spk_revert_bet(p_device text, p_spikes integer)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare new_balance integer;
begin
  update public.spk_players as p
     set spikes     = greatest(p.spikes - greatest(coalesce(p_spikes, 0), 0), 0),
         updated_at = now()
   where p.device_id = p_device
   returning p.spikes into new_balance;
  return coalesce(new_balance, 0);
end $$;

revoke execute on function public.spk_revert_bet(text,integer) from public, anon, authenticated;
grant  execute on function public.spk_revert_bet(text,integer) to service_role;
