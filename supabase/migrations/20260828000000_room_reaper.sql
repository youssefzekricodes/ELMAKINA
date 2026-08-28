-- ELMAKINA — automatic room reaping (see REAP_* constants in supabase/functions/game/room.mjs).
-- The Edge Function sweeps dead rooms on every `tick_all` (service role, cron). It finds candidates
-- with two cheap range scans; these indexes are what keep them cheap as the tables grow.

-- (a) rooms nothing has written to in a while → idle lobbies, finished games, orphans.
create index if not exists rooms_updated_at_idx on public.rooms (updated_at);

-- (b) memberships whose heartbeat went stale → abandoned rooms, including solo/vs-bot games whose
--     bots keep bumping rooms.updated_at forever and would therefore never look "idle".
create index if not exists room_members_last_seen_idx on public.room_members (last_seen);

-- Deleting a room already cascades to room_members / game_state / game_views (FKs in the initial
-- migration), so the reaper only has to delete the rooms row — the rest goes with it.

-- ── Cron ──────────────────────────────────────────────────────────────────────────────────────
-- ONE schedule is enough: `tick_all` reaps dead rooms first, then ticks the ones that are due.
-- Requires pg_cron + pg_net (Database → Extensions) and your project URL / service-role key.
--
-- create extension if not exists pg_cron;  create extension if not exists pg_net;
-- select cron.schedule('elmakina-tick', '10 seconds', $$
--   select net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/game',
--     headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
--     body := '{"op":"tick_all"}'::jsonb);
-- $$);
--
-- Last-resort SQL backstop, in case the Edge Function is down for a long time (thresholds here are
-- deliberately far looser than the ones in room.mjs, so they can never race the real reaper):
-- select cron.schedule('elmakina-cleanup', '17 * * * *', $$
--   delete from public.rooms where updated_at < now() - interval '1 day';
-- $$);
