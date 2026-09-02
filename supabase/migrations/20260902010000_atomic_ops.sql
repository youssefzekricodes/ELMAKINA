-- ELMEKINA — the game op becomes two database calls instead of six.
--
-- PostgREST is HTTP: every query the function makes is its own request with its own overhead. A
-- move used to READ with three calls (room, members, state — already parallel) and WRITE with three
-- more in single file (room CAS → state CAS → views). These two functions collapse each side into
-- one call — and the commit becomes atomic, which closes a real seam: before, a room update could
-- land while the state CAS failed, leaving a half-commit the retry logic had to tolerate. Now a
-- conflict rolls the whole thing back and a retry starts perfectly clean.

-- ── read side: everything a move needs, in one round trip ────────────────────
create or replace function public.game_load(p_code text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'room', (select to_jsonb(r) from rooms r where r.code = p_code),
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'last_seen', m.last_seen))
                           from room_members m where m.code = p_code), '[]'::jsonb),
    'state', (select jsonb_build_object('state', g.state, 'version', g.version)
                from game_state g where g.code = p_code)
  );
$$;

-- ── write side: both CAS writes and the views, one transaction ───────────────
-- Raises 'mekina_conflict' if either compare-and-swap loses; the adapter maps that to a retry.
-- Raising (rather than returning false) is the point: it aborts the transaction, so a lost race
-- writes nothing at all.
create or replace function public.game_commit(
  p_code text, p_room jsonb, p_room_version integer,
  p_state jsonb, p_state_version integer, p_views jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update rooms set
    host_id    = (p_room->>'host_id')::uuid,
    phase      = p_room->>'phase',
    players    = coalesce(p_room->'players', '[]'::jsonb),
    settings   = coalesce(p_room->'settings', '{}'::jsonb),
    is_public  = coalesce((p_room->>'is_public')::boolean, false),
    next_due   = case when p_room->>'next_due' is null then null else (p_room->>'next_due')::timestamptz end,
    version    = p_room_version + 1,
    updated_at = coalesce((p_room->>'updated_at')::timestamptz, now())
  where code = p_code and version = p_room_version;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'mekina_conflict'; end if;

  -- mirrors the adapter's saveState: version 0 means "first write", which may be an insert
  if p_state_version = 0 then
    insert into game_state (code, state, version) values (p_code, p_state, 1)
    on conflict (code) do nothing;
    get diagnostics n = row_count;
    if n = 0 then
      update game_state set state = p_state, version = 1, updated_at = now()
       where code = p_code and version = 0;
      get diagnostics n = row_count;
      if n = 0 then raise exception 'mekina_conflict'; end if;
    end if;
  else
    update game_state set state = p_state, version = p_state_version + 1, updated_at = now()
     where code = p_code and version = p_state_version;
    get diagnostics n = row_count;
    if n = 0 then raise exception 'mekina_conflict'; end if;
  end if;

  insert into game_views (id, code, user_id, view, updated_at)
  select v->>'id', v->>'code', (v->>'user_id')::uuid, v->'view', now()
    from jsonb_array_elements(coalesce(p_views, '[]'::jsonb)) v
  on conflict (id) do update set view = excluded.view, updated_at = excluded.updated_at;
end $$;

-- Service role only: these bypass RLS by design and no browser has any business calling them.
revoke all on function public.game_load(text) from public, anon, authenticated;
revoke all on function public.game_commit(text, jsonb, integer, jsonb, integer, jsonb) from public, anon, authenticated;
grant execute on function public.game_load(text) to service_role;
grant execute on function public.game_commit(text, jsonb, integer, jsonb, integer, jsonb) to service_role;

-- ── write amplification ──────────────────────────────────────────────────────
-- These two indexes taxed EVERY move to serve the reaper's hourly sweep: rooms.updated_at changes
-- on every commit and room_members.last_seen on every heartbeat, so each was a fresh index entry
-- per click — for tables the reaper itself keeps down to the handful of live rooms, where a
-- sequential scan costs nothing. The usual advice is "add the index"; here the audit says take it
-- away.
drop index if exists public.rooms_updated_at_idx;
drop index if exists public.room_members_last_seen_idx;

-- And leave slack in the pages of the update-churned tables so rewrites stay local (HOT) where the
-- indexed columns allow it, instead of migrating rows and bloating pages on every move.
alter table public.game_state  set (fillfactor = 70);
alter table public.game_views  set (fillfactor = 70);
alter table public.rooms       set (fillfactor = 80);
alter table public.room_members set (fillfactor = 80);
