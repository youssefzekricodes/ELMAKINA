/* Accounts (Google sign-in over Supabase), persistent profiles, trophies, friends and the leaderboard.
   Everything degrades gracefully: guests (anonymous auth) still get a profile row and can earn trophies. */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { store, type Account, type Friend } from './store';
import { track } from './analytics';
import { pushOnline } from './push';

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
  // Take the Google account's name as the display name — but only where it is actually wanted:
  // the moment you sign in (signInWithGoogle leaves the flag), or when there is no name at all.
  // Re-adopting on every session restore would undo a rename every time the page reloaded.
  const asked = (() => { try { return localStorage.getItem('mekina.adoptName') === '1'; } catch { return false; } })();
  if (!isGuest && account.name && (asked || !store.get().name.trim())) {
    const nm = account.name.trim().replace(/\s+/g, ' ').slice(0, 16);
    if (nm) { store.set({ name: nm }); try { localStorage.setItem('mekina.name', nm); } catch { /* private mode */ } }
  }
  try { localStorage.removeItem('mekina.adoptName'); } catch { /* ignore */ }
  await syncProfile();
  await Promise.all([loadTrophies(), loadFriends()]);
  subscribeFriends();
  subscribeInvites();
  // Refresh the push subscription and announce that we are here — which is what makes a friend's
  // phone light up. Only ever for a player who already granted permission; it never asks.
  pushOnline();
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
export async function dismissInvite() {
  const inv = store.get().invite; store.set({ invite: null });
  if (supabase && inv) { try { await supabase.from('room_invites').delete().eq('id', inv.id); } catch { /* ignore */ } }
}

// ── actions ──
export async function signInWithGoogle() {
  // Consumed by initSocial after the round trip: signing in is the one moment the account's own
  // name should win over whatever was typed at the front door.
  try { localStorage.setItem('mekina.adoptName', '1'); } catch { /* private mode */ }
  if (!supabase) return;
  track('sign_in', { method: 'google' }); // the event only — the account's email is never sent to GA
  await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
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

export async function loadLeaderboard(): Promise<LeaderRow[]> {
  if (!supabase) return [];
  const { data: sc } = await supabase.from('scores').select('user_id,trophies,wins,games').order('trophies', { ascending: false }).limit(50);
  const rows = sc || [];
  const ids = rows.map((r: any) => r.user_id);
  const profs: Record<string, any> = {};
  if (ids.length) { const { data: ps } = await supabase.from('profiles').select('user_id,name,avatar,avatar_data').in('user_id', ids); for (const p of ps || []) profs[p.user_id] = p; }
  return rows.map((r: any) => { const p = profs[r.user_id] || {}; return { uid: r.user_id, name: p.name || 'Player', avatar: p.avatar || null, avatarData: p.avatar_data || null, trophies: r.trophies, wins: r.wins, games: r.games, me: r.user_id === curUid }; });
}
