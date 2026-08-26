-- ELMEKINA — room invites: send a friend a live "join my room" push.
-- The recipient's client subscribes via Realtime and pops a Join prompt.
create table if not exists public.room_invites (
  id         uuid primary key default gen_random_uuid(),
  from_uid   uuid not null,
  to_uid     uuid not null,
  from_name  text not null default 'A friend',
  code       text not null,
  created_at timestamptz not null default now()
);
create index if not exists room_invites_to_idx on public.room_invites (to_uid);

alter table public.room_invites enable row level security;

-- you only see invites addressed to you; you can only send as yourself; either party can clear one
drop policy if exists "read my invites" on public.room_invites;
create policy "read my invites" on public.room_invites for select to authenticated using (to_uid = auth.uid());
drop policy if exists "send invite" on public.room_invites;
create policy "send invite" on public.room_invites for insert to authenticated with check (from_uid = auth.uid());
drop policy if exists "clear invite" on public.room_invites;
create policy "clear invite" on public.room_invites for delete to authenticated using (to_uid = auth.uid() or from_uid = auth.uid());

alter publication supabase_realtime add table public.room_invites;
alter table public.room_invites replica identity full;
