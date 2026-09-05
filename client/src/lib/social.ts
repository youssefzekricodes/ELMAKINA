/* Accounts (Google sign-in over Supabase), persistent profiles, trophies, friends and the leaderboard.
   Everything degrades gracefully: guests (anonymous auth) still get a profile row and can earn trophies. */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { store, type Account, type Friend } from './store';
import { track } from './analytics';
import { pushOnline } from './push';
import { setMonitorUser } from './monitor';
import { initStreaks } from './streaks';
import { isNative } from './platform';

export interface LeaderRow { uid: string; name: string; avatar: string | null; avatarData: string | null; trophies: number; wins: number; games: number; me: boolean }

let curUid: string | null = null;
let friendsChannel: RealtimeChannel | null = null;
let invitesChannel: RealtimeChannel | null = null;

/** Called once we know the auth uid (guest or Google). Builds the account, syncs the profile, loads social data. */
export async function initSocial(uid: string) {
  if (!supabase || !uid) return;
  curUid = uid;
  const { data: { user } } = await supabase.auth.getUser();
  const meta: any = user?.user_metadata || {};
  const isGuest = !!(user as any)?.is_anonymous || (!user?.email && !meta.full_name && !meta.name);
  const account: Account = {
    uid,
    name: meta.full_name || meta.name || store.get().name || 'Player',
    email: user?.email || null,
    avatarUrl: meta.avatar_url || meta.picture || null,
    isGuest,
  };
  store.set({ account });
  // Sentry gets the account id and nothing else — no email, no name. Enough to tell one player's
  // crashes from another's, which is all a bug report needs.
  setMonitorUser(uid);
  // Take the Google account's name as the display name — but only where it is actually wanted:
  // the moment you sign in (signInWithGoogle leaves the flag), or when there is no name at all.
  // Re-adopting on every session restore would undo a rename every time the page reloaded.
  const asked = (() => { try { return localStorage.getItem('mekina.adoptName') === '1'; } catch { return false; } })();
  if (!isGuest && account.name && (asked || !store.get().name.trim())) {
    const nm = account.name.trim().replace(/\s+/g, ' ').slice(0, 16);
    if (nm) { store.set({ name: nm }); try { localStorage.setItem('mekina.name', nm); } catch { /* private mode */ } }
  }
  try { localStorage.removeItem('mekina.adoptName'); } catch { /* ignore */ }
  if (!isGuest) await adoptProfile();
  await syncProfile();
  await Promise.all([loadTrophies(), loadFriends(), initStreaks()]);
  subscribeFriends();
  subscribeInvites();
  // Refresh the push subscription and announce that we are here — which is what makes a friend's
  // phone light up. Only ever for a player who already granted permission; it never asks.
  pushOnline();
}

/**
 * A signed-in account carries its face and name with it.
 *
 * The profile row used to be write-only from the device: sign in on a second phone and
 * syncProfile pushed THAT phone's fresh random avatar over the one chosen on the first, so the
 * account looked different everywhere and the leaderboard showed whichever device spoke last.
 * For a Google account the row is the source of truth: read it first and wear it here, and only
 * then let syncProfile write. Guests are still device-bound — there is no account to follow.
 */
async function adoptProfile() {
  if (!supabase || !curUid) return;
  try {
    const { data } = await supabase.from('profiles').select('name,avatar,avatar_data').eq('user_id', curUid).maybeSingle();
    if (!data || !data.avatar) return;   // first sign-in anywhere: nothing to adopt, this device's choice becomes the account's
    const cur = store.get().profile;
    const next = { ...cur, avatar: data.avatar, avatarData: data.avatar === 'custom' ? data.avatar_data || null : null };
    store.set({ profile: next });
    try { localStorage.setItem('mekina.profile', JSON.stringify(next)); } catch { /* private mode */ }
    const nm = (data.name || '').trim().replace(/\s+/g, ' ').slice(0, 16);
    if (nm) { store.set({ name: nm }); try { localStorage.setItem('mekina.name', nm); } catch { /* private mode */ } }
  } catch { /* the row is a nicety; the game does not wait on it */ }
}

/** Upsert my public profile row (name + avatar) so friends and leaderboards can show me. */
export async function syncProfile() {
  if (!supabase || !curUid) return;
  const s = store.get();
  const acc = s.account;
  const name = ((acc && !acc.isGuest ? acc.name : s.name) || acc?.name || 'Player').trim() || 'Player';
  await supabase.from('profiles').upsert({
    user_id: curUid, name,
    avatar: s.profile.avatar, avatar_data: s.profile.avatar === 'custom' ? s.profile.avatarData : null,
    is_guest: acc ? acc.isGuest : true, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
}

export async function loadTrophies() {
  if (!supabase || !curUid) return;
  const { data } = await supabase.from('scores').select('trophies').eq('user_id', curUid).maybeSingle();
  store.set({ trophies: data?.trophies ?? 0 });
}

export async function loadFriends() {
  if (!supabase || !curUid) return;
  const { data: rows } = await supabase.from('friendships').select('*').or(`requester.eq.${curUid},addressee.eq.${curUid}`);
  const list = rows || [];
  const otherIds = [...new Set(list.map((r: any) => (r.requester === curUid ? r.addressee : r.requester)))];
  const profs: Record<string, any> = {};
  if (otherIds.length) {
    const { data: ps } = await supabase.from('profiles').select('user_id,name,avatar,avatar_data').in('user_id', otherIds as string[]);
    for (const p of ps || []) profs[p.user_id] = p;
  }
  const friends: Friend[] = []; const reqs: Friend[] = [];
  for (const r of list as any[]) {
    const otherUid = r.requester === curUid ? r.addressee : r.requester;
    const p = profs[otherUid] || {};
    const f: Friend = { id: r.id, uid: otherUid, name: p.name || 'Player', avatar: p.avatar || null, avatarData: p.avatar_data || null, status: r.status, incoming: r.addressee === curUid };
    if (r.status === 'accepted') friends.push(f);
    else if (f.incoming) reqs.push(f);       // someone asked to be my friend
    else friends.push(f);                    // my outgoing request (shown as pending)
  }
  store.set({ friends, friendReqs: reqs });
}

function subscribeFriends() {
  if (!supabase || !curUid || friendsChannel) return;
  friendsChannel = supabase.channel('friends-' + curUid)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, () => { loadFriends(); })
    .subscribe();
}

// ── room invites (live "join my room" push to a friend) ──
function subscribeInvites() {
  if (!supabase || !curUid || invitesChannel) return;
  invitesChannel = supabase.channel('invites-' + curUid)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_invites', filter: `to_uid=eq.${curUid}` }, ({ new: r }: any) => {
      if (!r || !r.code) return;
      // Show it at once with what the row already carries, then put a face on it. An invitation
      // that waits on a round-trip before appearing is an invitation to a table that has started.
      const known = store.get().friends.find((f) => f.uid === r.from_uid);
      store.set({ invite: { id: r.id, fromUid: r.from_uid, fromName: r.from_name || 'A friend', code: r.code,
        avatar: known?.avatar || null, avatarData: known?.avatarData || null } });
      if (!known) faceFor(r.id, r.from_uid);
    })
    .subscribe();
}
/**
 * Fill in the sender's face after the fact.
 *
 * Invites usually come from a friend, whose avatar is already loaded — this is for the ones that do
 * not, and it patches the banner in place rather than holding it back. Ignored if the player has
 * already dealt with the invite by the time it lands.
 */
async function faceFor(inviteId: string, uid: string) {
  if (!supabase || !uid) return;
  try {
    const { data } = await supabase.from('profiles').select('name,avatar,avatar_data').eq('user_id', uid).maybeSingle();
    if (!data) return;
    const inv = store.get().invite;
    if (!inv || inv.id !== inviteId) return;
    store.set({ invite: { ...inv, avatar: data.avatar || null, avatarData: data.avatar_data || null, fromName: inv.fromName || data.name } });
  } catch { /* a nameless face is still an invitation */ }
}

export async function inviteToRoom(toUid: string, code: string): Promise<{ ok: boolean }> {
  if (!supabase || !curUid || !code) return { ok: false };
  const name = (store.get().account?.name || store.get().name || 'A friend').trim() || 'A friend';
  const { error } = await supabase.from('room_invites').insert({ from_uid: curUid, to_uid: toUid, from_name: name, code });
  // The row above only reaches a friend who has the app open. The push reaches the rest of them —
  // and an invitation nobody sees is the same as no invitation. Fire and forget: whether their
  // phone can be reached is not something the sender should have to wait on.
  if (!error) supabase.functions.invoke('push', { body: { op: 'invite', toUid, code } }).catch(() => {});
  return { ok: !error };
}
/**
 * Find players by name, to send a friend request to somebody you are not at a table with.
 *
 * Anyone already in your friends list (accepted OR pending) is dropped here rather than in the UI,
 * so the results are only people you can actually act on — and you are never in your own results.
 */
export async function searchPlayers(q: string): Promise<{ uid: string; name: string; avatar: string | null; avatarData: string | null }[]> {
  const term = q.trim();
  if (!supabase || !curUid || term.length < 2) return [];
  // escape the LIKE wildcards, or a name with % in it searches for everything
  const safe = term.replace(/[%_]/g, (m) => '\\' + m);
  const { data } = await supabase.from('profiles').select('user_id,name,avatar,avatar_data')
    .ilike('name', `%${safe}%`).neq('user_id', curUid).limit(20);
  const known = new Set(store.get().friends.map((f) => f.uid));
  return (data || [])
    .filter((p: { user_id: string }) => !known.has(p.user_id))
    .map((p: { user_id: string; name: string; avatar: string | null; avatar_data: string | null }) =>
      ({ uid: p.user_id, name: p.name || 'Player', avatar: p.avatar, avatarData: p.avatar_data }));
}

export async function dismissInvite() {
  const inv = store.get().invite; store.set({ invite: null });
  if (supabase && inv) { try { await supabase.from('room_invites').delete().eq('id', inv.id); } catch { /* ignore */ } }
}

// ── actions ──
/** Where Google sends the app back to. Must be on the Supabase redirect allow-list. */
const NATIVE_REDIRECT = 'com.elmekina.game://auth/callback';

export async function signInWithGoogle() {
  // Consumed by initSocial after the round trip: signing in is the one moment the account's own
  // name should win over whatever was typed at the front door.
  try { localStorage.setItem('mekina.adoptName', '1'); } catch { /* private mode */ }
  if (!supabase) return;
  track('sign_in', { method: 'google' }); // the event only — the account's email is never sent to GA
  if (!isNative()) {
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
    return;
  }
  // In the shell the round trip cannot happen in the WebView: Google refuses to sign in inside
  // one ("disallowed_useragent"), and a redirect to https://localhost would land on the web site.
  // So: build the URL without following it, open it in the system's Custom Tab, and let Supabase
  // send the phone back to our own scheme (see the intent-filter in AndroidManifest.xml). The
  // code arrives in appUrlOpen below and is exchanged here, where the PKCE verifier lives.
  const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: NATIVE_REDIRECT, skipBrowserRedirect: true } });
  if (error || !data?.url) return;
  const { Browser } = await import('@capacitor/browser');
  await Browser.open({ url: data.url, presentationStyle: 'popover' });
}

/**
 * The way back in from the Custom Tab. Registered once at startup on native; a no-op elsewhere.
 * Exchanging the code signs the session in; a reload then does what a fresh start does — the
 * profile, trophies, friends and streak of the account, not of the guest it replaced.
 */
export async function listenForAuthReturn() {
  if (!isNative() || !supabase) return;
  try {
    const { App } = await import('@capacitor/app');
    App.addListener('appUrlOpen', async ({ url }) => {
      if (!url || !url.startsWith(NATIVE_REDIRECT)) return;
      try { const { Browser } = await import('@capacitor/browser'); await Browser.close(); } catch { /* already closed */ }
      const code = new URL(url).searchParams.get('code');
      if (!code) return;
      const { error } = await supabase!.auth.exchangeCodeForSession(code);
      if (!error) location.reload();
    });
  } catch { /* plugin missing: the web sign-in path still works */ }
}

export async function signOutAccount() {
  if (!supabase) return;
  try { if (friendsChannel) { supabase.removeChannel(friendsChannel); friendsChannel = null; } if (invitesChannel) { supabase.removeChannel(invitesChannel); invitesChannel = null; } await supabase.auth.signOut(); } catch { /* ignore */ }
  location.reload(); // reconnect() will start a fresh guest session
}

export async function sendFriendRequest(otherUid: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase || !curUid || otherUid === curUid) return { ok: false };
  if (store.get().friends.some((f) => f.uid === otherUid)) return { ok: false, error: 'already' };
  const { error } = await supabase.from('friendships').insert({ requester: curUid, addressee: otherUid, status: 'pending' });
  if (!error) loadFriends();
  return { ok: !error, error: error?.message };
}

export async function acceptFriend(id: string) {
  if (!supabase) return;
  await supabase.from('friendships').update({ status: 'accepted', updated_at: new Date().toISOString() }).eq('id', id);
  loadFriends();
}

export async function removeFriend(id: string) {
  if (!supabase) return;
  await supabase.from('friendships').delete().eq('id', id);
  loadFriends();
}

/** How many leaderboard rows arrive at a time — see LeaderboardPage, which asks for the next page
    as the last one comes into view. */
export const LB_PAGE = 25;

/**
 * Where you actually stand, whether or not you are on a page that has been loaded.
 *
 * The list pages in twenty-fives, so somebody sitting at 400th would have to scroll for a minute to
 * find out. This asks the database instead: count everyone ordered ABOVE you, add one.
 *
 * "Above" has to mean the same thing here as it does in the list, or the number would disagree with
 * the position you would scroll to. The list orders by (trophies desc, user_id asc), so a player
 * outranks you if they have more trophies, OR the same trophies and a lower id — the tiebreak the
 * paging already relies on. head:true means the rows are counted server-side and never sent.
 */
export async function loadMyRank(): Promise<{ rank: number; row: LeaderRow } | null> {
  if (!supabase || !curUid) return null;
  const { data: mine } = await supabase.from('scores').select('user_id,trophies,wins,games').eq('user_id', curUid).maybeSingle();
  if (!mine) return null;                       // never played a scoring game — no rank to pin
  const [{ count }, { data: prof }] = await Promise.all([
    supabase.from('scores').select('user_id', { count: 'exact', head: true })
      .or(`trophies.gt.${mine.trophies},and(trophies.eq.${mine.trophies},user_id.lt.${curUid})`),
    supabase.from('profiles').select('name,avatar,avatar_data').eq('user_id', curUid).maybeSingle(),
  ]);
  return {
    rank: (count || 0) + 1,
    row: { uid: curUid, name: prof?.name || 'Player', avatar: prof?.avatar || null, avatarData: prof?.avatar_data || null,
           trophies: mine.trophies, wins: mine.wins, games: mine.games, me: true },
  };
}

export async function loadLeaderboard(offset = 0, limit = LB_PAGE): Promise<LeaderRow[]> {
  if (!supabase) return [];
  const { data: sc } = await supabase.from('scores').select('user_id,trophies,wins,games')
    .order('trophies', { ascending: false }).order('user_id', { ascending: true })   // a stable tiebreak, or paging repeats rows
    .range(offset, offset + limit - 1);
  const rows = sc || [];
  const ids = rows.map((r: any) => r.user_id);
  const profs: Record<string, any> = {};
  if (ids.length) { const { data: ps } = await supabase.from('profiles').select('user_id,name,avatar,avatar_data').in('user_id', ids); for (const p of ps || []) profs[p.user_id] = p; }
  return rows.map((r: any) => { const p = profs[r.user_id] || {}; return { uid: r.user_id, name: p.name || 'Player', avatar: p.avatar || null, avatarData: p.avatar_data || null, trophies: r.trophies, wins: r.wins, games: r.games, me: r.user_id === curUid }; });
}
