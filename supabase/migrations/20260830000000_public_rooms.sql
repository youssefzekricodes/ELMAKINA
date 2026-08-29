-- Public rooms: a lobby anyone can find, so meeting people no longer depends on passing a 4-letter
-- code around. Private stays the default — a room is only listed if its host opts in.

alter table public.rooms add column if not exists is_public boolean not null default false;

-- Only open public lobbies are ever browsed, so index exactly that slice.
create index if not exists rooms_public_idx
  on public.rooms (created_at)
  where is_public and phase = 'lobby';

-- Browsing must NOT be a widened RLS policy on `rooms`: that row carries the full `players` jsonb
-- (names, avatars, ready flags, last-seen) and a lobby list has no business reading it. This
-- function returns the four columns a browser needs and nothing else.
create or replace function public.public_rooms(p_limit integer default 30)
returns table (code text, host_name text, n integer, max_players integer, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select r.code,
         coalesce(r.players -> 0 ->> 'name', 'Player') as host_name,
         jsonb_array_length(r.players)                 as n,
         6                                             as max_players,
         r.created_at
    from public.rooms r
   where r.is_public
     and r.phase = 'lobby'
     and jsonb_array_length(r.players) < 6
     and r.updated_at > now() - interval '30 minutes'   -- don't advertise a lobby nobody is sitting in
   order by r.created_at desc
   limit greatest(1, least(coalesce(p_limit, 30), 50));
$$;

revoke all on function public.public_rooms(integer) from public;
grant execute on function public.public_rooms(integer) to authenticated;
