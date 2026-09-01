-- ELMEKINA — Web Push (VAPID). No Firebase.
--
-- The app is a PWA with a service worker already in front of it, so the browser's own Push API is
-- the whole client side of this: no SDK, no second vendor, nothing added to the bundle. What was
-- missing is a place to keep subscriptions and something that can sign and send — this table and
-- supabase/functions/push.
--
-- A subscription is keyed by its endpoint, not by the player: one account can be installed on a
-- phone and a laptop, and each install is its own endpoint. Endpoints die silently (app deleted,
-- browser storage cleared); the sender deletes any that answer 404 or 410.
create table if not exists public.push_subs (
  endpoint   text primary key,
  user_id    uuid not null,
  p256dh     text not null,
  auth       text not null,
  lang       text not null default 'tn',
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);
create index if not exists push_subs_user_idx on public.push_subs (user_id);
create index if not exists push_subs_seen_idx on public.push_subs (last_seen);

-- What a player has already been sent, so nothing repeats and nothing nags. `daily` and `friends`
-- are the player's own switches; the timestamps are the rate limits behind them.
create table if not exists public.push_state (
  user_id        uuid primary key,
  welcomed_at    timestamptz,
  last_daily_at  timestamptz,
  last_friend_at timestamptz,
  daily          boolean not null default true,
  friends        boolean not null default true,
  updated_at     timestamptz not null default now()
);

alter table public.push_subs  enable row level security;
alter table public.push_state enable row level security;

-- A subscription is yours alone: nobody reads anybody else's endpoint (it is a send-anything token).
-- The Edge Function uses the service role and bypasses all of this.
drop policy if exists "read own subs" on public.push_subs;
create policy "read own subs" on public.push_subs for select to authenticated using (user_id = auth.uid());
drop policy if exists "write own subs" on public.push_subs;
create policy "write own subs" on public.push_subs for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "drop own subs" on public.push_subs;
create policy "drop own subs" on public.push_subs for delete to authenticated using (user_id = auth.uid());

drop policy if exists "read own push state" on public.push_state;
create policy "read own push state" on public.push_state for select to authenticated using (user_id = auth.uid());
drop policy if exists "write own push state" on public.push_state;
create policy "write own push state" on public.push_state for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "update own push state" on public.push_state;
create policy "update own push state" on public.push_state for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── the daily reminder ───────────────────────────────────────────────────────
-- Needs pg_cron + pg_net (Database → Extensions), the same pair the room reaper uses. Once per day
-- is enough: the function itself decides who is actually due, and a player who opened the app today
-- is skipped. Run it at a civilised local hour rather than at 03:00 UTC.
--
-- create extension if not exists pg_cron;  create extension if not exists pg_net;
-- select cron.schedule('elmekina-daily-push', '0 18 * * *', $$
--   select net.http_post(
--     url     := 'https://<project-ref>.supabase.co/functions/v1/push',
--     headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <service-role-key>'),
--     body    := jsonb_build_object('op','daily')
--   );
-- $$);
