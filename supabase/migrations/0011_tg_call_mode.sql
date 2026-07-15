-- Group calls can now come from a live match OR an archived replay session, which
-- pay out differently and settle in different proof modes. Tag each call so settle
-- time knows which it was.
alter table public.tg_calls add column if not exists mode text not null default 'live';
