-- Per-room settings (host-configurable from the lobby).
--   settings.reactionSecs — how long every reaction window lasts (challenge + block), 5..60, default 12.
-- Old rooms simply have '{}' and fall back to the engine defaults.
alter table public.rooms add column if not exists settings jsonb not null default '{}'::jsonb;
