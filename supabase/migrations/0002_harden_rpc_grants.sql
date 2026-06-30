-- Hardening for the spk_* SECURITY DEFINER functions (applied 2026-06-30).
-- Caught by the Supabase security advisor after 0001:
--   * 0011 function_search_path_mutable
--   * 0028/0029 anon/authenticated can execute SECURITY DEFINER function
-- These RPCs mint SPIKES, credit USDC rewards, queue payouts, and set scores, so
-- they MUST run only server-side via the service-role key. Left callable by the
-- public anon key (which ships in the client bundle), anyone could mint currency
-- or drain the treasury. Pin search_path, revoke from everyone, grant service_role.

alter function public.spk_sync_player(text,text,integer,integer,text) set search_path = public, pg_temp;
alter function public.spk_credit_spikes(text,text,text,integer)       set search_path = public, pg_temp;
alter function public.spk_request_withdraw(text)                      set search_path = public, pg_temp;
alter function public.spk_credit_reward(text,numeric)                 set search_path = public, pg_temp;

revoke execute on function public.spk_sync_player(text,text,integer,integer,text) from public, anon, authenticated;
revoke execute on function public.spk_credit_spikes(text,text,text,integer)       from public, anon, authenticated;
revoke execute on function public.spk_request_withdraw(text)                      from public, anon, authenticated;
revoke execute on function public.spk_credit_reward(text,numeric)                 from public, anon, authenticated;

grant execute on function public.spk_sync_player(text,text,integer,integer,text) to service_role;
grant execute on function public.spk_credit_spikes(text,text,text,integer)       to service_role;
grant execute on function public.spk_request_withdraw(text)                      to service_role;
grant execute on function public.spk_credit_reward(text,numeric)                 to service_role;
