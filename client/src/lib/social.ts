/* Accounts (Google sign-in over Supabase), persistent profiles, trophies, friends and the leaderboard.
   Everything degrades gracefully: guests (anonymous auth) still get a profile row and can earn trophies. */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { store, type Account, type Friend } from './store';

export interface LeaderRow { uid: string; name: string; avatar: string | null; avatarData: string | null; trophies: number; wins: number; games: number; me: boolean }

let curUid: string | null = null;
let friendsChannel: RealtimeChannel | null = null;

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
  if (!isGuest && !store.get().name.trim()) store.set({ name: account.name });
  await syncProfile();
  await Promise.all([loadTrophies(), loadFriends()]);
  subscribeFriends();
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

// ── actions ──
export async function signInWithGoogle() {
  if (!supabase) return;
  await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
}

export async function signOutAccount() {
  if (!supabase) return;
  try { if (friendsChannel) { supabase.removeChannel(friendsChannel); friendsChannel = null; } await supabase.auth.signOut(); } catch { /* ignore */ }
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
