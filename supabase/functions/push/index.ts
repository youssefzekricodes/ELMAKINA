// ELMEKINA — Web Push sender.
//
// POST { op, ...payload } with the player's Supabase JWT, or with the service-role key for the
// cron ops. Standard VAPID Web Push: no Firebase, no SDK on the client, no second vendor — the
// browser already speaks this and the app already has a service worker to receive it.
//
// Secrets (supabase secrets set): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
// The PUBLIC key is also given to the browser as VITE_VAPID_PUBLIC_KEY — it is public by design.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { cronCheckIn, reportError } from '../_shared/sentry.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') || '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') || '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:contact@elmekina.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

if (VAPID_PUBLIC && VAPID_PRIVATE) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

/* ── copy ─────────────────────────────────────────────────────────────────────
   Two languages, kept here rather than imported from the client: a notification is written by the
   server hours after the app was last open, and the player's language is whatever they last had.
   Short on purpose — Android gives a notification about one line before it truncates. */
type Lang = 'tn' | 'en';
const COPY: Record<string, Record<Lang, (p: Record<string, string>) => { title: string; body: string }>> = {
  welcome: {
    tn: () => ({ title: 'أهلا بيك في المكينة 🎭', body: 'طاولتك جاهزة. العب، اكذب، و شوف شكون يصدّقك.' }),
    en: () => ({ title: 'Welcome to ELMEKINA 🎭', body: 'Your table is ready. Play, bluff, and see who believes you.' }),
  },
  daily: {
    tn: () => ({ title: 'المكينة تستنّى فيك', body: 'طاولة جديدة تبدا في ثانية. تعال شوف شكون يكذب اليوم.' }),
    en: () => ({ title: 'ELMEKINA is waiting', body: 'A new table starts in seconds. Come see who is lying today.' }),
  },
  friend: {
    tn: (p) => ({ title: `${p.name} ولّى أونلاين`, body: 'ادخل توّا و العبو مع بعضنا.' }),
    en: (p) => ({ title: `${p.name} is online`, body: 'Jump in now and play together.' }),
  },
  invite: {
    tn: (p) => ({ title: `${p.name} عزمك على طاولة`, body: `الكود ${p.code} — ادخل قبل ما تتعمّر.` }),
    en: (p) => ({ title: `${p.name} invited you`, body: `Room ${p.code} — join before it fills up.` }),
  },
};
const say = (kind: string, lang: string, p: Record<string, string> = {}) =>
  (COPY[kind][(lang === 'en' ? 'en' : 'tn') as Lang])(p);

interface Sub { endpoint: string; p256dh: string; auth: string; lang: string }

/**
 * Send one notification and clean up after it.
 *
 * A dead endpoint (app deleted, storage cleared, subscription rotated) answers 404 or 410 and will
 * answer that forever, so it is deleted on the spot — otherwise every send after this one carries
 * the same corpses and gets slower for it.
 */
async function send(sb: SupabaseClient, sub: Sub, payload: { title: string; body: string; url?: string; tag?: string }) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return false;
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 12 },
    );
    return true;
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) await sb.from('push_subs').delete().eq('endpoint', sub.endpoint);
    else console.error('[push] send failed', code, (e as Error).message);
    return false;
  }
}

/** Every live subscription for a player — one account can be installed in several places. */
async function subsFor(sb: SupabaseClient, uid: string): Promise<Sub[]> {
  const { data } = await sb.from('push_subs').select('endpoint,p256dh,auth,lang').eq('user_id', uid);
  return (data || []) as Sub[];
}

async function sendTo(sb: SupabaseClient, uid: string, kind: string, p: Record<string, string> = {}, url = '/') {
  const subs = await subsFor(sb, uid);
  if (!subs.length) return 0;
  let n = 0;
  for (const sub of subs) {
    const { title, body } = say(kind, sub.lang, p);
    if (await send(sb, sub, { title, body, url, tag: kind })) n++;
  }
  return n;
}

/** My accepted friends, in both directions — friendships stores one row per pair. */
async function friendsOf(sb: SupabaseClient, uid: string): Promise<string[]> {
  const { data } = await sb.from('friendships').select('requester,addressee')
    .eq('status', 'accepted').or(`requester.eq.${uid},addressee.eq.${uid}`);
  return (data || []).map((r: { requester: string; addressee: string }) => (r.requester === uid ? r.addressee : r.requester));
}

const HOURS = (n: number) => n * 3600_000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
  let opName: string | null = null;   // remembered for the error report: the body cannot be read twice
  try {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({}));
    const op = String(body.op || '');
    opName = op || null;
    const isService = !!token && token === SERVICE_KEY;

    let uid: string | null = null;
    if (!isService) {
      const { data, error } = await sb.auth.getUser(token);
      if (error || !data.user) return json({ ok: false, error: 'Not signed in' }, 401);
      uid = data.user.id;
    }
    const now = Date.now();

    // ── the player's own subscription ─────────────────────────────────────────
    if (op === 'subscribe' && uid) {
      const sub = body.sub || {};
      const keys = sub.keys || {};
      if (!sub.endpoint || !keys.p256dh || !keys.auth) return json({ ok: false, error: 'Bad subscription' }, 400);
      const lang = body.lang === 'en' ? 'en' : 'tn';
      await sb.from('push_subs').upsert({
        endpoint: sub.endpoint, user_id: uid, p256dh: keys.p256dh, auth: keys.auth, lang,
        last_seen: new Date(now).toISOString(),
      }, { onConflict: 'endpoint' });

      // Welcome, once per account and never again — the first thing a new player is sent should not
      // be the same thing a returning one gets every time they reinstall.
      const { data: st } = await sb.from('push_state').select('welcomed_at').eq('user_id', uid).maybeSingle();
      if (!st?.welcomed_at) {
        await sb.from('push_state').upsert({ user_id: uid, welcomed_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() }, { onConflict: 'user_id' });
        await sendTo(sb, uid, 'welcome');
        return json({ ok: true, welcomed: true });
      }
      return json({ ok: true });
    }

    if (op === 'unsubscribe' && uid) {
      if (body.endpoint) await sb.from('push_subs').delete().eq('endpoint', body.endpoint).eq('user_id', uid);
      else await sb.from('push_subs').delete().eq('user_id', uid);
      return json({ ok: true });
    }

    if (op === 'prefs' && uid) {
      const patch: Record<string, unknown> = { user_id: uid, updated_at: new Date(now).toISOString() };
      if (typeof body.daily === 'boolean') patch.daily = body.daily;
      if (typeof body.friends === 'boolean') patch.friends = body.friends;
      await sb.from('push_state').upsert(patch, { onConflict: 'user_id' });
      return json({ ok: true });
    }

    // ── "your friend just came online" ────────────────────────────────────────
    // Called when the app opens. Rate-limited per RECIPIENT, not per sender: with a dozen friends
    // opening the app through the evening this is the difference between one nudge and twelve.
    if (op === 'online' && uid) {
      await sb.from('push_subs').update({ last_seen: new Date(now).toISOString() }).eq('user_id', uid);
      const mates = await friendsOf(sb, uid);
      if (!mates.length) return json({ ok: true, sent: 0 });
      const { data: me } = await sb.from('profiles').select('name').eq('user_id', uid).maybeSingle();
      const name = me?.name || 'A friend';
      const { data: states } = await sb.from('push_state').select('user_id,last_friend_at,friends').in('user_id', mates);
      const seen = new Map((states || []).map((r: { user_id: string; last_friend_at: string | null; friends: boolean }) => [r.user_id, r]));
      let sent = 0;
      for (const mate of mates) {
        const st = seen.get(mate);
        if (st && st.friends === false) continue;
        if (st?.last_friend_at && now - new Date(st.last_friend_at).getTime() < HOURS(6)) continue;
        const n = await sendTo(sb, mate, 'friend', { name });
        if (n > 0) {
          sent += n;
          await sb.from('push_state').upsert({ user_id: mate, last_friend_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() }, { onConflict: 'user_id' });
        }
      }
      return json({ ok: true, sent });
    }

    // ── "come and join my room" ───────────────────────────────────────────────
    // The invite row already went in over Realtime for anyone with the app open; this is for
    // everyone else. No rate limit: a player asked for this one by name.
    if (op === 'invite' && uid) {
      const to = String(body.toUid || ''); const code = String(body.code || '').toUpperCase();
      if (!to || !/^[A-Z0-9]{4}$/.test(code)) return json({ ok: false, error: 'Bad invite' }, 400);
      const mates = await friendsOf(sb, uid);
      if (!mates.includes(to)) return json({ ok: false, error: 'Not friends' }, 403);   // no inviting strangers
      const { data: me } = await sb.from('profiles').select('name').eq('user_id', uid).maybeSingle();
      const sent = await sendTo(sb, to, 'invite', { name: me?.name || 'A friend', code }, `/?room=${code}`);
      return json({ ok: true, sent });
    }

    // ── the daily nudge (cron) ────────────────────────────────────────────────
    // Only players who have not opened the app today, and never twice in twenty hours. Anyone who
    // played today is skipped: a reminder to do the thing you just did is spam.
    if (op === 'daily' && isService) {
      // Tell Sentry the job started. If it ever stops starting, that silence is the alert — a cron
      // that quietly dies produces no error to catch.
      await cronCheckIn('elmekina-daily-push', 'in_progress');
      const cutoff = new Date(now - HOURS(20)).toISOString();
      const { data: rows } = await sb.from('push_subs').select('user_id').lt('last_seen', cutoff).limit(2000);
      const uids = [...new Set((rows || []).map((r: { user_id: string }) => r.user_id))];
      if (!uids.length) return json({ ok: true, sent: 0 });
      const { data: states } = await sb.from('push_state').select('user_id,last_daily_at,daily').in('user_id', uids);
      const seen = new Map((states || []).map((r: { user_id: string; last_daily_at: string | null; daily: boolean }) => [r.user_id, r]));
      let sent = 0;
      for (const u of uids) {
        const st = seen.get(u);
        if (st && st.daily === false) continue;
        if (st?.last_daily_at && now - new Date(st.last_daily_at).getTime() < HOURS(20)) continue;
        const n = await sendTo(sb, u, 'daily');
        if (n > 0) {
          sent += n;
          await sb.from('push_state').upsert({ user_id: u, last_daily_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() }, { onConflict: 'user_id' });
        }
      }
      await cronCheckIn('elmekina-daily-push', 'ok');
      return json({ ok: true, sent, considered: uids.length });
    }

    return json({ ok: false, error: 'Unknown op' }, 400);
  } catch (e) {
    console.error('[push]', e);
    if (opName === 'daily') await cronCheckIn('elmekina-daily-push', 'error');
    await reportError(e, { fn: 'push', op: opName });
    return json({ ok: false, error: 'Server error' }, 500);
  }
});
