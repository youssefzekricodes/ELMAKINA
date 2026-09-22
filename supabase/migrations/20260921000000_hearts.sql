-- ELMEKINA — hearts: three games a day, and a rewarded video refills them.
--
-- A heart is spent when a game STARTS (not when a room is opened — a lobby nobody joined should
-- cost nothing). The day is the player's LOCAL day, the same clamped-offset idea the streak uses
-- (_local_day), so "three a day" turns over at the player's own midnight. No row, or a row from
-- an earlier day, simply reads as a full set: nothing has to run at midnight.
--
-- Like streak_save, the refill trusts the client to have shown the video first: there is no
-- server-side receipt for a rewarded ad on the web stack. What the server does guarantee is the
-- arithmetic — a heart cannot go below zero or above the daily maximum.
create table if not exists public.hearts (
  user_id    uuid primary key,
  day        date not null,
  left_count integer not null default 3,
  updated_at timestamptz not null default now()
);
alter table public.hearts enable row level security;
create policy hearts_read_own on public.hearts for select using (auth.uid() = user_id);
-- no insert/update policies: all writes go through the definer functions below.

create or replace function public._hearts_max() returns integer language sql immutable as $$ select 3 $$;

create or replace function public.hearts_peek(p_tz_offset_min integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); today date := public._local_day(p_tz_offset_min); r hearts;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select * into r from hearts where user_id = uid;
  if not found or r.day <> today then return jsonb_build_object('left', public._hearts_max(), 'max', public._hearts_max()); end if;
  return jsonb_build_object('left', r.left_count, 'max', public._hearts_max());
end $$;

-- One heart for one game. ok=false (and nothing written) when there is none left.
create or replace function public.hearts_spend(p_tz_offset_min integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); today date := public._local_day(p_tz_offset_min); r hearts; cur integer;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select * into r from hearts where user_id = uid for update;
  cur := case when not found or r.day <> today then public._hearts_max() else r.left_count end;
  if cur <= 0 then return jsonb_build_object('ok', false, 'left', 0, 'max', public._hearts_max()); end if;
  insert into hearts (user_id, day, left_count) values (uid, today, cur - 1)
  on conflict (user_id) do update set day = today, left_count = cur - 1, updated_at = now();
  return jsonb_build_object('ok', true, 'left', cur - 1, 'max', public._hearts_max());
end $$;

-- The rewarded refill: back to a full set. Caller runs the video FIRST.
create or replace function public.hearts_refill(p_tz_offset_min integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); today date := public._local_day(p_tz_offset_min);
begin
  if uid is null then raise exception 'not signed in'; end if;
  insert into hearts (user_id, day, left_count) values (uid, today, public._hearts_max())
  on conflict (user_id) do update set day = today, left_count = public._hearts_max(), updated_at = now();
  return jsonb_build_object('left', public._hearts_max(), 'max', public._hearts_max());
end $$;

revoke all on function public.hearts_peek(integer), public.hearts_spend(integer), public.hearts_refill(integer) from public, anon;
grant execute on function public.hearts_peek(integer), public.hearts_spend(integer), public.hearts_refill(integer) to authenticated;
