-- ELMAKINA — Supabase schema. Everything is written by the `game` Edge Function (service role);
-- clients only READ their own rows (RLS) and receive changes through Realtime.

-- Rooms: lobby info + public bookkeeping (players list, phase, when something is next due).
create table if not exists public.rooms (
  code        text primary key,
  host_id     uuid not null,
  phase       text not null default 'lobby',          -- lobby | playing | ended
  players     jsonb not null default '[]'::jsonb,     -- [{id,name,ready,connected,isBot,avatar,avatarData,color,lastSeen}]
  next_due    timestamptz,                            -- next moment the engine/bots need a tick
  version     integer not null default 0,             -- optimistic concurrency
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists rooms_next_due_idx on public.rooms (next_due) where next_due is not null;

-- Membership (one room per user). last_seen = presence heartbeat.
create table if not exists public.room_members (
  user_id    uuid primary key,
  code       text not null references public.rooms(code) on delete cascade,
  last_seen  timestamptz not null default now()
);
create index if not exists room_members_code_idx on public.room_members (code);

-- Hidden game state (hands, deck, continuations). Service role only — NO client policies.
create table if not exists public.game_state (
  code        text primary key references public.rooms(code) on delete cascade,
  state       jsonb,
  version     integer not null default 0,
  updated_at  timestamptz not null default now()
);

-- Per-player views: what each player is allowed to see (own hand + public info). Pushed via Realtime.
create table if not exists public.game_views (
  id          text primary key,                       -- "<code>:<user_id>"
  code        text not null references public.rooms(code) on delete cascade,
  user_id     uuid not null,
  view        jsonb,
  updated_at  timestamptz not null default now()
);
create index if not exists game_views_code_idx on public.game_views (code);

-- ── Row Level Security ───────────────────────────────────────────────────────────────────────
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.game_state enable row level security;
alter table public.game_views enable row level security;

drop policy if exists "members read their room" on public.rooms;
create policy "members read their room" on public.rooms for select to authenticated
  using (exists (select 1 from public.room_members m where m.code = rooms.code and m.user_id = auth.uid()));

drop policy if exists "read own membership" on public.room_members;
create policy "read own membership" on public.room_members for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "read own view" on public.game_views;
create policy "read own view" on public.game_views for select to authenticated
  using (user_id = auth.uid());
-- game_state: no policies → only the service role can read/write it.

-- ── Realtime ─────────────────────────────────────────────────────────────────────────────────
-- Clients subscribe to postgres_changes on rooms (filter code=eq.X) and game_views (filter id=eq.X:uid).
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.game_views;
alter table public.rooms replica identity full;
alter table public.game_views replica identity full;

-- ── Optional: cron backstop so timeouts/bots advance even when no client is ticking ───────────
-- Requires the pg_cron + pg_net extensions (Database → Extensions) and your project URL / service key.
-- Clients already call `tick` exactly when something is due, so this is only a safety net.
--
-- create extension if not exists pg_cron;  create extension if not exists pg_net;
-- select cron.schedule('elmakina-tick', '10 seconds', $$
--   select net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/game',
--     headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
--     body := '{"op":"tick_all"}'::jsonb);
-- $$);
-- select cron.schedule('elmakina-cleanup', '0 * * * *', $$ delete from public.rooms where updated_at < now() - interval '1 day'; $$);
