-- ELMEKINA — performance pass. Findings from reading every query the app makes against the schema.
--
-- Most of the hot path was already right: every game-op query is a primary-key hit, the reaper's
-- range scans have their indexes, and public_rooms browses a partial index of exactly its slice.
-- Two queries had nothing to stand on:

-- (1) The leaderboard pages with ORDER BY trophies DESC, user_id ASC + a range. Without a matching
--     index that is a full sort of the table on every page fetch, on every player's screen.
create index if not exists scores_leaderboard_idx
  on public.scores (trophies desc, user_id asc);

-- (2) Friend search is name ILIKE '%term%' — a leading wildcard, which no btree can serve, so every
--     debounced keystroke was a sequential scan of profiles. Trigram GIN is the index built for
--     exactly this shape, and it keeps working as the table grows past the point where a scan hurts.
create extension if not exists pg_trgm;
create index if not exists profiles_name_trgm_idx
  on public.profiles using gin (name gin_trgm_ops);
