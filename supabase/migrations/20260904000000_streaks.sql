-- ELMEKINA — daily play streaks, the freeze that saves one, and the rewarded trophy boost.

-- ── Streaks ──────────────────────────────────────────────────────────────────
-- One row per player. A streak is a LOCAL-midnight concept — "I played today" means the player's
-- today, not UTC's — so every function takes the client's timezone offset in minutes and derives
-- the day from it. The server still owns the arithmetic: the client can lie about its clock by a
-- few hours at most, never rewind a lost streak.
create table if not exists public.streaks (
  user_id    uuid primary key,
  count      integer not null default 0,
  best       integer not null default 0,
  last_day   date,
  freezes    integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.streaks enable row level security;
create policy streaks_read_own on public.streaks for select using (auth.uid() = user_id);
-- no insert/update policies: all writes go through the definer functions below.

create or replace function public._local_day(p_tz_offset_min integer)
returns date language sql stable as
$$ select ((now() at time zone 'utc') + make_interval(mins => coalesce(p_tz_offset_min, 0)))::date $$;

-- Called once per finished game. Extends, holds, spends a freeze, or resets — and says which.
create or replace function public.streak_tick(p_tz_offset_min integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  today date := public._local_day(p_tz_offset_min);
  r streaks;
  extended boolean := false; froze boolean := false; was_reset boolean := false; lost integer := 0;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select * into r from streaks where user_id = uid for update;
  if not found then
    insert into streaks (user_id, count, best, last_day) values (uid, 1, 1, today) returning * into r;
    extended := true;
  elsif r.last_day = today then
    null; -- already played today; nothing changes
  elsif r.last_day = today - 1 then
    r.count := r.count + 1; extended := true;
  elsif r.last_day = today - 2 and r.freezes > 0 then
    -- the freeze covers exactly the one missed day, and is consumed by doing so
    r.count := r.count + 1; r.freezes := r.freezes - 1; extended := true; froze := true;
  else
    lost := r.count; was_reset := r.count > 0; r.count := 1; extended := true;
  end if;
  r.best := greatest(r.best, r.count);
  update streaks set count = r.count, best = r.best, last_day = today, freezes = r.freezes, updated_at = now()
   where user_id = uid;
  return jsonb_build_object('count', r.count, 'best', r.best, 'freezes', r.freezes,
                            'extended', extended, 'froze', froze, 'reset', was_reset, 'lost', lost);
end $$;

-- What the home screen shows on open, WITHOUT writing anything. at_risk means: broken by exactly
-- one missed day and not yet lazily reset — the one state a rewarded freeze can still save.
create or replace function public.streak_peek(p_tz_offset_min integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  today date := public._local_day(p_tz_offset_min);
  r streaks;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select * into r from streaks where user_id = uid;
  if not found then return jsonb_build_object('count', 0, 'best', 0, 'freezes', 0, 'today', false, 'at_risk', false); end if;
  return jsonb_build_object(
    'count',  case when r.last_day >= today - 1 or (r.last_day = today - 2 and r.freezes > 0) then r.count else 0 end,
    'best', r.best, 'freezes', r.freezes,
    'today', r.last_day = today,
    'at_risk', r.last_day = today - 2 and r.freezes = 0 and r.count > 0);
end $$;

-- The rewarded save: grants the ONE freeze that at_risk needs, and only in that exact state — any
-- other moment returns false and grants nothing, so replaying the call cannot stockpile freezes.
create or replace function public.streak_save(p_tz_offset_min integer default 0)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  today date := public._local_day(p_tz_offset_min);
  n integer;
begin
  if uid is null then raise exception 'not signed in'; end if;
  update streaks set freezes = 1, updated_at = now()
   where user_id = uid and last_day = today - 2 and freezes = 0 and count > 0;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- ── Rewarded trophy boost ────────────────────────────────────────────────────
-- bump_score (the game function's only score writer) now leaves a claim ticket: the delta it just
-- applied. claim_trophy_boost spends the ticket exactly once. The bonus mirrors the end screen's
-- offer: a win doubles, a 0 becomes +1, a -1 is refunded.
alter table public.scores add column if not exists last_delta integer;
alter table public.scores add column if not exists boost_used boolean not null default true;

create or replace function public.bump_score(p_uid uuid, p_delta integer, p_win boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into scores (user_id, trophies, games, wins, last_delta, boost_used)
  values (p_uid, greatest(p_delta, 0), 1, case when p_win then 1 else 0 end, p_delta, false)
  on conflict (user_id) do update set
    trophies = greatest(scores.trophies + p_delta, 0),
    games = scores.games + 1,
    wins = scores.wins + case when p_win then 1 else 0 end,
    last_delta = p_delta,
    boost_used = false,
    updated_at = now();
end $$;

create or replace function public.claim_trophy_boost()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r scores;
  bonus integer;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select * into r from scores where user_id = uid for update;
  if not found or r.boost_used or r.last_delta is null then return jsonb_build_object('ok', false); end if;
  bonus := case when r.last_delta > 0 then r.last_delta else 1 end;
  update scores set trophies = trophies + bonus, boost_used = true, updated_at = now() where user_id = uid;
  return jsonb_build_object('ok', true, 'bonus', bonus, 'trophies', r.trophies + bonus);
end $$;

revoke all on function public.streak_tick(integer), public.streak_peek(integer), public.streak_save(integer), public.claim_trophy_boost() from public, anon;
grant execute on function public.streak_tick(integer), public.streak_peek(integer), public.streak_save(integer), public.claim_trophy_boost() to authenticated;
-- bump_score stays service-role only, as before.
revoke all on function public.bump_score(uuid, integer, boolean) from public, anon, authenticated;
grant execute on function public.bump_score(uuid, integer, boolean) to service_role;
