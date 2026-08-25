-- ELMEKINA — social layer: persistent profiles, trophy scores, friends.
-- Profiles + friendships are written by the client (RLS-guarded to own rows).
-- Trophy scores are written ONLY by the game Edge Function (service role) via bump_score(),
-- so a player can never inflate their own trophies. Everything is public-read for leaderboards.

-- ── Profiles: a persistent identity (survives across devices once you sign in with Google) ──
create table if not exists public.profiles (
  user_id     uuid primary key,                       -- = auth.uid()
  name        text not null default 'Player',
  avatar      text,                                    -- avatar id (e.g. 'boy-1') or 'custom'
  avatar_data text,                                    -- data URL when avatar = 'custom'
  is_guest    boolean not null default true,           -- false once linked to a real (Google) identity
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── Scores: trophies + record. Service-role writes only (via bump_score). Public read. ──
create table if not exists public.scores (
  user_id    uuid primary key,
  trophies   integer not null default 0,              -- floored at 0 by bump_score
  games      integer not null default 0,
  wins       integer not null default 0,
  updated_at timestamptz not null default now()
);

-- ── Friendships: one row per pair, directional request that becomes accepted ──
create table if not exists public.friendships (
  id         uuid primary key default gen_random_uuid(),
  requester  uuid not null,
  addressee  uuid not null,
  status     text not null default 'pending',          -- pending | accepted
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester <> addressee),
  unique (requester, addressee)
);
create index if not exists friendships_addressee_idx on public.friendships (addressee);
create index if not exists friendships_requester_idx on public.friendships (requester);

-- ── Atomic trophy update (service role only). Floors trophies at 0. ──
create or replace function public.bump_score(p_uid uuid, p_delta integer, p_win boolean)
returns void language sql as $$
  insert into public.scores as s (user_id, trophies, games, wins, updated_at)
  values (p_uid, greatest(0, p_delta), 1, case when p_win then 1 else 0 end, now())
  on conflict (user_id) do update
    set trophies   = greatest(0, s.trophies + p_delta),
        games      = s.games + 1,
        wins       = s.wins + (case when p_win then 1 else 0 end),
        updated_at = now();
$$;
revoke execute on function public.bump_score(uuid, integer, boolean) from public, anon, authenticated;

-- ── Row Level Security ──
alter table public.profiles    enable row level security;
alter table public.scores      enable row level security;
alter table public.friendships enable row level security;

-- profiles: anyone signed in can read any profile (names/avatars on leaderboards & friends); edit only your own
drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles for select to authenticated using (true);
drop policy if exists "insert own profile" on public.profiles;
create policy "insert own profile" on public.profiles for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- scores: public read for leaderboards; no client writes (service role bypasses RLS)
drop policy if exists "scores readable" on public.scores;
create policy "scores readable" on public.scores for select to authenticated using (true);

-- friendships: see/act only on rows you're part of
drop policy if exists "read own friendships" on public.friendships;
create policy "read own friendships" on public.friendships for select to authenticated
  using (requester = auth.uid() or addressee = auth.uid());
drop policy if exists "send friend request" on public.friendships;
create policy "send friend request" on public.friendships for insert to authenticated
  with check (requester = auth.uid());
drop policy if exists "respond to request" on public.friendships;
create policy "respond to request" on public.friendships for update to authenticated
  using (addressee = auth.uid() or requester = auth.uid())
  with check (addressee = auth.uid() or requester = auth.uid());
drop policy if exists "remove friendship" on public.friendships;
create policy "remove friendship" on public.friendships for delete to authenticated
  using (requester = auth.uid() or addressee = auth.uid());

-- ── Realtime: live friend requests/acceptances ──
alter publication supabase_realtime add table public.friendships;
alter table public.friendships replica identity full;
