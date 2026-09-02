// ELMAKINA — the whole game server as one Supabase Edge Function.
// POST { op, ...payload } with the player's (anonymous) Supabase JWT. See ./room.mjs for the ops.
// Cron backstop: POST { op: 'tick_all' } with the service-role key as Bearer token — it ticks every
// due room AND reaps dead ones (`{ op: 'reap' }` runs the sweep on its own).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { handleOp } from './room.mjs';
import { reportError } from '../_shared/sentry.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** Postgres adapter for room.mjs (service role — RLS bypassed; clients never reach these tables for writes). */
function makeDb(sb: SupabaseClient) {
  const one = async (q: any) => { const { data, error } = await q; if (error) throw error; return data; };
  const ts = (n: number | null) => (n == null ? null : new Date(n).toISOString());
  const ms = (s: string | null) => (s ? new Date(s).getTime() : null);
  const rowToRoom = (r: any) => r && ({ code: r.code, host_id: r.host_id, phase: r.phase, players: r.players || [], settings: r.settings || {}, is_public: !!r.is_public, next_due: ms(r.next_due), version: r.version, created_at: ms(r.created_at), updated_at: ms(r.updated_at) });
  const roomToRow = (room: any) => ({ code: room.code, host_id: room.host_id, phase: room.phase, players: room.players, settings: room.settings || {}, is_public: !!room.is_public, next_due: ts(room.next_due), version: room.version, updated_at: ts(room.updated_at) });
  return {
    async getRoom(code: string) { return rowToRoom(await one(sb.from('rooms').select('*').eq('code', code).maybeSingle())); },
    async insertRoom(room: any) { await one(sb.from('rooms').insert({ ...roomToRow(room), created_at: ts(room.created_at) })); },
    async updateRoom(code: string, room: any, expectedVersion: number) {
      const data = await one(sb.from('rooms').update(roomToRow(room)).eq('code', code).eq('version', expectedVersion).select('code'));
      return Array.isArray(data) && data.length > 0;
    },
    async deleteRoom(code: string) { await one(sb.from('rooms').delete().eq('code', code)); },
    /** Open public lobbies with room left, oldest-advertised first — see the public_rooms() SQL fn. */
    async listPublicRooms(limit = 30) {
      const rows = await one(sb.rpc('public_rooms', { p_limit: limit }));
      return (rows || []).map((r: any) => ({ code: r.code, host: r.host_name, n: r.n, max: r.max_players }));
    },
    async getMembership(uid: string) { const r = await one(sb.from('room_members').select('code').eq('user_id', uid).maybeSingle()); return r ? { code: r.code } : null; },
    async addMember(code: string, uid: string, now: number) { await one(sb.from('room_members').upsert({ user_id: uid, code, last_seen: ts(now) }, { onConflict: 'user_id' })); },
    async removeMember(code: string, uid: string) { await one(sb.from('room_members').delete().eq('user_id', uid)); },
    async touchMember(code: string, uid: string, now: number) { await one(sb.from('room_members').update({ last_seen: ts(now) }).eq('user_id', uid)); },
    async listMembers(code: string) { const rows = await one(sb.from('room_members').select('user_id,last_seen').eq('code', code)); return (rows || []).map((r: any) => ({ user_id: r.user_id, last_seen: ms(r.last_seen) })); },
    async getState(code: string) { const r = await one(sb.from('game_state').select('state,version').eq('code', code).maybeSingle()); return r ? { state: r.state, version: r.version } : null; },
    async saveState(code: string, state: any, expectedVersion: number) {
      if (expectedVersion === 0) {
        const { error } = await sb.from('game_state').insert({ code, state, version: 1 });
        if (!error) return true;
        if (error.code !== '23505') throw error; // exists → fall through to CAS update (row may exist with version 0 from a previous game? no: we never write version 0)
      }
      const data = await one(sb.from('game_state').update({ state, version: expectedVersion + 1, updated_at: new Date().toISOString() }).eq('code', code).eq('version', expectedVersion).select('code'));
      return Array.isArray(data) && data.length > 0;
    },
    async deleteState(code: string) { await one(sb.from('game_state').delete().eq('code', code)); },
    async upsertViews(rows: any[]) { if (!rows.length) return; await one(sb.from('game_views').upsert(rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })), { onConflict: 'id' })); },
    async deleteViews(code: string) { await one(sb.from('game_views').delete().eq('code', code)); },
    async deleteView(id: string) { await one(sb.from('game_views').delete().eq('id', id)); },
    async listDueRooms(now: number) { const rows = await one(sb.from('rooms').select('code').lte('next_due', ts(now)).limit(100)); return (rows || []).map((r: any) => r.code); },
    // ── reaper (see REAP_* in room.mjs) — both queries hit an index: rooms(updated_at), room_members(last_seen)
    async listIdleRooms(before: number, limit = 200) { const rows = await one(sb.from('rooms').select('code').lt('updated_at', ts(before)).limit(limit)); return (rows || []).map((r: any) => r.code); },
    async listStaleMemberRooms(before: number, limit = 200) { const rows = await one(sb.from('room_members').select('code').lt('last_seen', ts(before)).limit(limit)); return [...new Set((rows || []).map((r: any) => r.code))]; },
    async deleteMembers(code: string) { await one(sb.from('room_members').delete().eq('code', code)); },
    async bumpScore(uid: string, delta: number, win: boolean) { const { error } = await sb.rpc('bump_score', { p_uid: uid, p_delta: delta, p_win: win }); if (error) throw error; },
    // ── the two-call fast path (see migrations/20260902010000_atomic_ops.sql) ──
    // room.mjs feature-detects these; without them it falls back to the primitives above, which is
    // also the path the test suite's fake db drives.
    async loadBundle(code: string) {
      const b = await one(sb.rpc('game_load', { p_code: code }));
      return {
        room: rowToRoom(b?.room || null),
        members: (b?.members || []).map((m: any) => ({ user_id: m.user_id, last_seen: ms(m.last_seen) })),
        st: b?.state ? { state: b.state.state, version: b.state.version } : null,
      };
    },
    /** Both CAS writes and the views in one transaction. false = lost the race, nothing written. */
    async commitAll(room: any, expectedRoomVer: number, state: any, expectedStateVer: number, views: any[]) {
      const { error } = await sb.rpc('game_commit', {
        p_code: room.code, p_room: roomToRow(room), p_room_version: expectedRoomVer,
        p_state: state, p_state_version: expectedStateVer, p_views: views,
      });
      if (error) {
        if (String(error.message || '').includes('mekina_conflict')) return false;
        throw error;
      }
      return true;
    },
  };
}

/** The sub of a gateway-verified user JWT, or null for anything else (anon key, expired, garbage). */
function decodeUid(token: string): string | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.role !== 'authenticated' || !payload.sub) return null;
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null;
    return String(payload.sub);
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
  let op: string | null = null;   // remembered for the error report: the body cannot be read twice
  try {
    const auth = req.headers.get('Authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({}));
    op = typeof body?.op === 'string' ? body.op : null;
    let uid: string | null = null, isService = false;
    if (token && token === SERVICE_KEY) isService = true;
    else {
      // The platform already verified this JWT's signature before invoking us (verify_jwt = true in
      // config.toml — nothing unsigned gets this far). Asking the auth server to getUser() again was
      // a second HTTP hop on EVERY move a player makes, and it was the single largest share of a
      // click's latency. Decoding the payload locally is enough, with two checks the gateway does
      // not make for us: the role must be a signed-in user (the anon key is itself a valid project
      // JWT with role 'anon' and no sub) and the token must not have expired mid-session.
      uid = decodeUid(token);
      if (!uid) return json({ ok: false, error: 'Not signed in' }, 401);
    }
    const res = await handleOp({ db: makeDb(admin), uid, body, now: Date.now(), isService });
    return json(res);
  } catch (e) {
    console.error('[game]', e);
    // The log line stays — it is what you read while you are already looking. The report is what
    // tells you to look at all.
    await reportError(e, { fn: 'game', op });
    return json({ ok: false, error: 'Server error' }, 500);
  }
});
