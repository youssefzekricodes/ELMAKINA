-- ELMEKINA — the streak remembers WHICH days, not just how many.
--
-- The first cut stored count + last_day, which is all the arithmetic needs. The card in the app
-- now shows the current week as seven days, each one lit, frozen, missed, or still to come — and
-- that needs the actual dates. Two short date arrays on the same row, trimmed to a rolling window
-- so a two-year streak never grows the row: `played` is every local day a game was finished,
-- `frozen` every day the freeze covered.
--
-- Existing streaks are backfilled by walking back from last_day over count days. That paints any
-- freeze inside the old streak as a played day, which nobody can tell from here — an honest
-- approximation that only affects the week of the migration.

alter table public.streaks
  add column if not exists played date[] not null default '{}',
  add column if not exists frozen date[] not null default '{}';

update public.streaks
   set played = array(select d::date from generate_series(last_day - (count - 1), last_day, interval '1 day') d)
 where last_day is not null and count > 0 and played = '{}';

-- Keep only the dates the week view can ever show (this week plus a margin for timezone drift).
create or replace function public._recent_days(p_days date[], p_today date)
returns date[] language sql immutable as
$$ select coalesce(array(select d from unnest(p_days) d where d >= p_today - 21 order by d), '{}') $$;

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
    insert into streaks (user_id, count, best, last_day, played) values (uid, 1, 1, today, array[today]) returning * into r;
    extended := true;
  elsif r.last_day = today then
    null; -- already played today; nothing changes
  elsif r.last_day = today - 1 then
    r.count := r.count + 1; extended := true;
  elsif r.last_day = today - 2 and r.freezes > 0 then
    -- the freeze covers exactly the one missed day, and is consumed by doing so
    r.count := r.count + 1; r.freezes := r.freezes - 1; extended := true; froze := true;
    if not (today - 1 = any(r.frozen)) then r.frozen := array_append(r.frozen, today - 1); end if;
  else
    lost := r.count; was_reset := r.count > 0; r.count := 1; extended := true;
  end if;
  if extended and not (today = any(r.played)) then r.played := array_append(r.played, today); end if;
  r.played := public._recent_days(r.played, today);
  r.frozen := public._recent_days(r.frozen, today);
  r.best := greatest(r.best, r.count);
  update streaks set count = r.count, best = r.best, last_day = today, freezes = r.freezes,
                     played = r.played, frozen = r.frozen, updated_at = now()
   where user_id = uid;
  return jsonb_build_object('count', r.count, 'best', r.best, 'freezes', r.freezes,
                            'extended', extended, 'froze', froze, 'reset', was_reset, 'lost', lost,
                            'day', today, 'played', to_jsonb(r.played), 'frozen', to_jsonb(r.frozen));
end $$;

create or replace function public.streak_peek(p_tz_offset_min integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  today date := public._local_day(p_tz_offset_min);
  r streaks;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select * into r from streaks where user_id = uid;
  if not found then
    return jsonb_build_object('count', 0, 'best', 0, 'freezes', 0, 'today', false, 'at_risk', false,
                              'day', today, 'played', '[]'::jsonb, 'frozen', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'count',  case when r.last_day >= today - 1 or (r.last_day = today - 2 and r.freezes > 0) then r.count else 0 end,
    'best', r.best, 'freezes', r.freezes,
    'today', r.last_day = today,
    'at_risk', r.last_day = today - 2 and r.freezes = 0 and r.count > 0,
    'day', today, 'played', to_jsonb(r.played), 'frozen', to_jsonb(r.frozen));
end $$;

-- The save now also marks the day it rescued, so the week shows the ice the moment the video ends
-- rather than after the next game. The freeze itself is still consumed only by streak_tick.
create or replace function public.streak_save(p_tz_offset_min integer default 0)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  today date := public._local_day(p_tz_offset_min);
  n integer;
begin
  if uid is null then raise exception 'not signed in'; end if;
  update streaks set freezes = 1, frozen = public._recent_days(array_append(frozen, today - 1), today), updated_at = now()
   where user_id = uid and last_day = today - 2 and freezes = 0 and count > 0;
  get diagnostics n = row_count;
  return n > 0;
end $$;

revoke all on function public._recent_days(date[], date) from public, anon, authenticated;
