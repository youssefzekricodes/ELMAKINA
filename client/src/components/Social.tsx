/* Leaderboard + Friends full pages (reached from Home). Read/write the Supabase social tables via lib/social. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { t } from '../i18n';
import { useStore, store, type Snapshot } from '../lib/store';
import { acceptFriend, removeFriend, sendFriendRequest, loadLeaderboard, LB_PAGE, loadFriends, searchPlayers, inviteToRoom, dismissInvite, signInWithGoogle, signOutAccount, type LeaderRow, loadMyRank} from '../lib/social';
import { copyInvite, joinRoom, leaveRoom, listPublicRooms, notify, setLanguage, toggleSound, createRoom} from '../lib/net';
import { disablePush, enablePush, pushStatus } from '../lib/push';
import { navIconFor } from './NavBar';
import { Art, GoogleG, Icon, PlayerAvatar } from './ui';
import type { ArtName } from '../art';

const asPlayer = (uid: string, avatar: string | null, avatarData: string | null) => ({ id: uid, avatar: avatar || 'boy-1', avatarData, color: null });
const home = () => store.set({ screen: 'home' });
/** Dismiss a sheet. Without this, `close` fell through to window.close() and did nothing. */
const closeSheet = () => store.set({ modal: null });

/** `art` takes an illustrated mark from the set; `icon` falls back to the line glyphs. */
/**
 * A screen's own header — desktop only, since the tab bar names the screen on a phone.
 *
 * `screen` takes the mark straight from the tab bar's table rather than naming a second icon here:
 * the head and the header row sat side by side on a desktop showing two different pictures of the
 * same place, because they were drawing from two different sets.
 */
function PageHead({ screen, icon, art, title }: { screen?: Snapshot['screen']; icon?: string; art?: ArtName; title: string }) {
  const nav = screen ? navIconFor(screen) : undefined;
  return (
    <header className="page-head">
      <button type="button" className="page-back" onClick={home} aria-label={t('page.back')}>
        <Icon name="alt-arrow-left" className="size-5" />
      </button>
      <h1 className="page-title">
        {nav ? <img className="page-art" src={nav} alt="" draggable={false} />
          : art ? <Art name={art} className="page-art" /> : <Icon name={icon || 'system'} className="size-6" />}
        {title}
      </h1>
      <span className="page-head-sp" />
    </header>
  );
}

export function LeaderboardPage() {
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  const [more, setMore] = useState(true);
  const [mine, setMine] = useState<{ rank: number; row: LeaderRow } | null>(null);
  // Where my OWN row in the list currently is, relative to the scroller: below the fold, on screen,
  // or already scrolled past. Decides whether the pin has anything left to do.
  const [rowPos, setRowPos] = useState<'below' | 'visible' | 'above' | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const meRowRef = useRef<HTMLLIElement | null>(null);
  const sentinel = useRef<HTMLLIElement | null>(null);
  const busy = useRef(false);

  /**
   * One page at a time, fetched when the bottom of the list comes into view.
   *
   * Guarded by a ref rather than state: the observer can fire twice before React has re-rendered,
   * and two calls with the same offset would append the same twenty-five rows twice.
   */
  const loadMore = useCallback(async () => {
    if (busy.current || !more) return;
    busy.current = true;
    const offset = rows ? rows.length : 0;
    const page = await loadLeaderboard(offset);
    setRows((prev) => (prev && offset > 0 ? [...prev, ...page] : page));
    if (page.length < LB_PAGE) setMore(false);      // a short page is the last page
    busy.current = false;
  }, [rows, more]);

  useEffect(() => { setRows(null); setMore(true); busy.current = false; loadLeaderboard(0).then((r) => { setRows(r); if (r.length < LB_PAGE) setMore(false); }); }, []);

  // Your standing, fetched alongside the first page. It is a separate query on purpose: at 400th you
  // would have to page through sixteen screens before your own row appeared, and the whole point of
  // pinning it is not having to.
  useEffect(() => { loadMyRank().then(setMine); }, []);

  /**
   * Watch my own row in the list, so the pin can retire itself.
   *
   * The pin exists to answer "where am I?" without scrolling. The moment the real row is on screen
   * the answer is right there and the copy below it is noise — and once you have scrolled PAST it,
   * you have seen it, and the pin would only cover rows you are actually reading. So it shows only
   * while the row is still below the fold (or not even loaded yet, pages being twenty-five rows).
   *
   * The observer clips through the scroller (IntersectionObserver honours overflow ancestors), and
   * above-vs-below is judged against the scroller's own box rather than the viewport, because on a
   * phone the list starts 54px down and is masked at the edges.
   */
  useEffect(() => {
    const el = meRowRef.current, sc = bodyRef.current;
    if (!el || !sc) { setRowPos(null); return; }
    // One classifier, read from live geometry, fed by BOTH signals. The observer alone is not
    // enough: it fires only when the intersection CHANGES, and a hard fling can carry the row from
    // above the scroller to below it between two frames without ever intersecting — verified, the
    // state then sticks at 'above' and the pin stays retired when it should have come back. The
    // scroll listener closes that gap; the observer still covers what scrolling cannot see, like
    // the row arriving in a freshly loaded page.
    const classify = () => {
      const r = el.getBoundingClientRect(), b = sc.getBoundingClientRect();
      setRowPos(r.bottom <= b.top ? 'above' : r.top >= b.bottom ? 'below' : 'visible');
    };
    classify();
    const io = new IntersectionObserver(classify);
    io.observe(el);
    sc.addEventListener('scroll', classify, { passive: true });
    window.addEventListener('scroll', classify, { passive: true }); // desktop: the document scrolls, not .page-body
    return () => { io.disconnect(); sc.removeEventListener('scroll', classify); window.removeEventListener('scroll', classify); };
  }, [rows]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more) return;
    // rootMargin so the next page is already arriving before the last row is reached
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) loadMore(); }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, more, rows]);

  // If my row is among the loaded pages, the pin defers to the observer's verdict — including the
  // brief null before it speaks, so a top-ranked player never sees the pin flash on for a frame.
  // If my row has not even been loaded yet, it is by definition below everything on screen.
  const rowsHasMe = !!rows?.some((r) => r.me);
  const showPin = !!mine && (rowsHasMe ? rowPos === 'below' : true);
  return (
    <section className="screen page-screen">
      <div className="page-shell">
        <PageHead screen="leaderboard" title={t('lb.title')} />
        <div className={`page-body ${showPin ? 'with-pin' : ''}`} ref={bodyRef}>
          {rows === null ? <p className="sheet-empty">{t('lb.loading')}</p>
            : rows.length === 0 ? <p className="sheet-empty">{t('lb.empty')}</p>
              : <ol className="lb-list">
                {rows.map((r, i) => (
                  <li key={r.uid} className={`lb-row ${r.me ? 'me' : ''}`} ref={r.me ? meRowRef : undefined}>
                    <span className={`lb-rank r${i + 1}`}>{i + 1}</span>
                    <PlayerAvatar p={asPlayer(r.uid, r.avatar, r.avatarData)} size="sm" />
                    <span className="lb-name">{r.name}{r.me && <span className="lb-you">{t('lobby.you')}</span>}</span>
                    <span className="lb-stat">{t('lb.wins', { n: r.wins })}</span>
                    <span className="lb-trophies"><Art name="stars" className="size-3.5" />{r.trophies}</span>
                  </li>
                ))}
                {more && <li className="lb-more" ref={sentinel}><span className="lb-more-dot" /><span className="lb-more-dot" /><span className="lb-more-dot" /></li>}
              </ol>}
        </div>
        {/* Pinned outside .page-body, not sticky inside it. The leaderboard fades its own scroll
            edges with a mask, and a sticky child would be faded by it exactly where it matters —
            and would sit under the fixed tab bar besides. As a sibling it is simply always there. */}
        {showPin && (
          <div className="lb-pin">
            <span className={`lb-rank r${mine.rank}`}>{mine.rank}</span>
            <PlayerAvatar p={asPlayer(mine.row.uid, mine.row.avatar, mine.row.avatarData)} size="sm" />
            <span className="lb-name">{mine.row.name}<span className="lb-you">{t('lobby.you')}</span></span>
            <span className="lb-stat">{t('lb.wins', { n: mine.row.wins })}</span>
            <span className="lb-trophies"><Art name="stars" className="size-3.5" />{mine.row.trophies}</span>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Find somebody by name and ask to be friends.
 *
 * Until now the only way to add anyone was to be sitting at a table with them, which means you
 * could not add the friend who told you about the game. Two characters before it searches, and it
 * waits for a pause in the typing rather than querying on every keystroke.
 */
function FriendSearch() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ uid: string; name: string; avatar: string | null; avatarData: string | null }[] | null>(null);
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits(null); return; }
    setBusy(true);
    // Debounced, and the answer is dropped if the query moved on while it was in flight — otherwise
    // a slow response for "yo" can land on top of the results for "youssef".
    let live = true;
    const id = setTimeout(async () => {
      const r = await searchPlayers(term);
      if (live) { setHits(r); setBusy(false); }
    }, 280);
    return () => { live = false; clearTimeout(id); };
  }, [q]);

  const add = async (uid: string) => {
    const r = await sendFriendRequest(uid);
    if (r.ok) { setSent((m) => ({ ...m, [uid]: true })); notify(t('fr.sent'), true); }
    else notify(r.error || t('fr.addFail'));
  };

  return (
    <section className="fr-sec fr-find">
      <h3 className="fr-sec-h">{t('fr.find')}</h3>
      <label className="fr-search">
        <Icon name="users-group-rounded" className="size-4 fr-search-ic" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('fr.find.ph')}
          maxLength={24} autoComplete="off" aria-label={t('fr.find')} />
        {q && <button type="button" className="fr-search-x" onClick={() => setQ('')} aria-label={t('invite.dismiss')}><Icon name="close-circle" className="size-4" /></button>}
      </label>
      {q.trim().length >= 2 && (
        busy ? <p className="sheet-empty">{t('fr.searching')}</p>
          : hits && hits.length === 0 ? <p className="sheet-empty">{t('fr.noHits')}</p>
            : (hits || []).map((p) => (
              <div className="fr-row" key={p.uid}>
                <PlayerAvatar p={asPlayer(p.uid, p.avatar, p.avatarData)} size="sm" />
                <span className="fr-name">{p.name}</span>
                {sent[p.uid]
                  ? <span className="fr-pending">{t('fr.sent')}</span>
                  : <Button size="sm" variant="primary" onPress={() => add(p.uid)}>
                      <Icon name="user-plus-rounded" className="size-4" />{t('fr.addShort')}
                    </Button>}
              </div>
            ))
      )}
    </section>
  );
}

export function FriendsPage() {
  const s = useStore();
  useEffect(() => { loadFriends(); }, []);
  const accepted = s.friends.filter((f) => f.status === 'accepted');
  const outgoing = s.friends.filter((f) => f.status === 'pending' && !f.incoming);
  return (
    <section className="screen page-screen">
      <div className="page-shell">
        <PageHead screen="friends" title={t('fr.title')} />
        <div className="page-body">
          {s.account?.isGuest && <p className="fr-hint">{t('fr.guest')}</p>}
          <FriendSearch />

          {s.friendReqs.length > 0 && (
            <section className="fr-sec">
              <h3 className="fr-sec-h">{t('fr.requests')}</h3>
              {s.friendReqs.map((f) => (
                <div className="fr-row" key={f.id}>
                  <PlayerAvatar p={asPlayer(f.uid, f.avatar, f.avatarData)} size="sm" />
                  <span className="fr-name">{f.name}</span>
                  <Button size="sm" variant="primary" onPress={() => acceptFriend(f.id)}>{t('fr.accept')}</Button>
                  <Button size="sm" variant="tertiary" onPress={() => removeFriend(f.id)}>{t('fr.decline')}</Button>
                </div>
              ))}
            </section>
          )}

          <section className="fr-sec">
            <h3 className="fr-sec-h">{t('fr.yours', { n: accepted.length })}</h3>
            {accepted.length === 0 && outgoing.length === 0 ? <p className="sheet-empty">{t('fr.empty')}</p> : null}
            {accepted.map((f) => (
              <div className="fr-row" key={f.id}>
                <PlayerAvatar p={asPlayer(f.uid, f.avatar, f.avatarData)} size="sm" />
                <span className="fr-name">{f.name}</span>
                <Button isIconOnly size="sm" variant="tertiary" aria-label={t('fr.remove')} onPress={() => removeFriend(f.id)}><Icon name="user-minus-rounded" className="size-4" /></Button>
              </div>
            ))}
            {outgoing.map((f) => (
              <div className="fr-row pending" key={f.id}>
                <PlayerAvatar p={asPlayer(f.uid, f.avatar, f.avatarData)} size="sm" />
                <span className="fr-name">{f.name}</span>
                <span className="fr-pending">{t('fr.sent')}</span>
                <Button isIconOnly size="sm" variant="tertiary" aria-label={t('fr.cancel')} onPress={() => removeFriend(f.id)}><Icon name="close-circle" className="size-4" /></Button>
              </div>
            ))}
          </section>
        </div>
      </div>
    </section>
  );
}

/** Invite modal (opened from the lobby): pick friends to push a "join my room" invite. */
export function InviteModal() {
  const s = useStore();
  const [sent, setSent] = useState<Record<string, boolean>>({});
  if (s.modal !== 'invite') return null;
  const code = s.room?.code;
  const friends = s.friends.filter((f) => f.status === 'accepted');
  const invite = async (uid: string) => { if (!code) return; const r = await inviteToRoom(uid, code); if (r.ok) { setSent((m) => ({ ...m, [uid]: true })); notify(t('invite.sent'), true); } };
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label={t('invite.title')} onClick={closeSheet}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2 className="sheet-title"><Icon name="user-plus-rounded" className="size-5" />{t('invite.title')}</h2>
          <button type="button" className="sheet-x" onClick={closeSheet} aria-label={t('preview.cancel')}><Icon name="close-circle" className="size-5" /></button>
        </div>
        <div className="sheet-body">
          {/* The room comes first. Half of inviting somebody is sending them the code, and it used
              to be somewhere else entirely — you opened this, found no way to share a link, and
              closed it again. */}
          {code && (
            <div className="inv-room">
              <span className="inv-room-lbl">{t('invite.room')}</span>
              <b className="inv-code ltr" dir="ltr">{code}</b>
              <Button size="sm" variant="outline" className="inv-copy" onPress={() => copyInvite(code)}>
                <Icon name="copy" className="size-4" />{t('invite.share')}
              </Button>
            </div>
          )}
          <div className="inv-sep"><span>{t('invite.friends')}</span></div>
          {friends.length === 0 ? <p className="sheet-empty">{t('invite.none')}</p> : friends.map((f) => (
            <div className="fr-row inv-row" key={f.id}>
              <PlayerAvatar p={asPlayer(f.uid, f.avatar, f.avatarData)} size="sm" />
              <span className="fr-name">{f.name}</span>
              {sent[f.uid]
                ? <span className="fr-pending inv-sent"><Icon name="check-circle" className="size-4" />{t('invite.sentTag')}</span>
                : <Button size="sm" variant="primary" onPress={() => invite(f.uid)}>
                    <Icon name="user-plus-rounded" className="size-4" />{t('invite.send')}
                  </Button>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Live banner shown to the recipient when a friend invites them to a room. */
export function InviteBanner() {
  const s = useStore();
  const inv = s.invite;
  if (!inv) return null;
  const join = async () => {
    const name = (s.account && !s.account.isGuest ? s.account.name : s.name) || s.name || 'Player';
    if (!name.trim()) { notify(t('toast.name')); store.set({ screen: 'home' }); dismissInvite(); return; }
    if (s.room) await leaveRoom();
    dismissInvite();
    await joinRoom(name.trim(), inv.code);
  };
  return (
    <div className="invite-pop" role="alert">
      {/* Who is asking comes first. It used to be a generic room icon and one grey line carrying
          both the name and the code, which read as a system message rather than a person. */}
      <div className="invite-pop-top">
        <span className="invite-pop-face"><PlayerAvatar p={asPlayer(inv.fromUid, inv.avatar, inv.avatarData)} size="lg" /></span>
        <div className="invite-pop-tx">
          <b>{inv.fromName}</b>
          <span>{t('invite.incomingLine')}</span>
        </div>
        <button type="button" className="invite-pop-x" onClick={() => dismissInvite()} aria-label={t('invite.dismiss')}>
          <Icon name="close-circle" className="size-5" />
        </button>
      </div>
      <div className="invite-pop-room">
        <span className="invite-pop-lbl">{t('invite.room')}</span>
        <b className="invite-pop-code ltr" dir="ltr">{inv.code}</b>
      </div>
      <Button fullWidth size="lg" variant="primary" className="invite-pop-go" onPress={join}>
        <Icon name="login-2" className="size-5" />{t('invite.join')}
      </Button>
    </div>
  );
}

/** Small "add friend" button used on lobby seats. */
export function AddFriendButton({ uid, name }: { uid: string; name: string }) {
  const s = useStore();
  const already = s.friends.some((f) => f.uid === uid);
  const [sent, setSent] = useState(false);
  if (uid === s.me || already || sent) {
    return <span className="seat-friend done" title={already ? t('fr.already') : t('fr.sent')}><Icon name="check-circle" className="size-3.5" /></span>;
  }
  return (
    <button type="button" className="seat-friend" title={t('fr.add', { name })} aria-label={t('fr.add', { name })}
      onClick={async (e) => { e.stopPropagation(); const r = await sendFriendRequest(uid); if (r.ok || r.error === 'already') setSent(true); }}>
      <Icon name="user-plus-rounded" className="size-3.5" />
    </button>
  );
}

/** Open public lobbies. The list comes from the public_rooms() SQL function, which returns only
    code / host / seat count — never the players blob a room row actually carries. */
export function PublicRoomsPage() {
  const s = useStore();
  const [rooms, setRooms] = useState<{ code: string; host: string; n: number; max: number }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => { setRooms(null); listPublicRooms().then(setRooms).catch(() => setRooms([])); };
  useEffect(load, []);
  const join = async (code: string) => {
    const name = (s.name || '').trim();
    if (!name) { notify(t('toast.name')); store.set({ screen: 'home' }); return; }
    setBusy(code);
    const r = await joinRoom(name, code);
    setBusy(null);
    if (!r || r.ok === false) load(); // it filled up or closed while the list was on screen
  };
  /**
   * Open a room from the page that lists them.
   *
   * PUBLIC, unlike the private room the home screen makes: somebody standing in front of the open
   * rooms asking for one of their own means a room other people can walk into. The lobby's toggle
   * still takes it back off if that was not the intent.
   */
  const create = async () => {
    const name = (s.name || '').trim();
    if (!name) { notify(t('toast.name')); store.set({ screen: 'home' }); return; }
    setBusy('new');
    await createRoom(name, true);
    setBusy(null);
  };
  return (
    <section className="screen page-screen">
      <div className="page-shell">
        <PageHead screen="public" title={t('pub.title')} />
        <div className="page-body">
          {/* The home screen's own create-room button — the wood panel with the door on it — turned
              along one line. Stacked it is 46px of icon above its label, which above a list would
              push the first room off the fold. */}
          <button type="button" className="hm-opt pub-create" onClick={create} disabled={busy === 'new'}>
            <span className="hm-ic"><Art name="dungeon" className="hm-art" /></span>
            <span className="hm-tx">{t('home.create')}</span>
          </button>
          {rooms === null ? <p className="sheet-empty">{t('pub.loading')}</p>
            : rooms.length === 0 ? <p className="sheet-empty">{t('pub.empty')}</p>
              : <ul className="pub-list">
                {rooms.map((r) => (
                  <li className="pub-row" key={r.code}>
                    <span className="pub-code" dir="ltr">{r.code}</span>
                    <span className="pub-main">
                      <b>{t('pub.hostedBy', { name: r.host })}</b>
                      <span className="pub-seats">{t('pub.seats', { n: r.n, max: r.max })}</span>
                    </span>
                    <Button size="sm" variant="primary" isPending={busy === r.code} onPress={() => join(r.code)}>{t('pub.join')}</Button>
                  </li>
                ))}
              </ul>}
          <div className="pub-actions">
            <Button size="md" variant="tertiary" onPress={load}><Icon name="restart" className="size-4" />{t('pub.refresh')}</Button>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Your own page: the face, the name, what you have won, and the account it is tied to.
 *
 * The nav's profile stop used to throw the avatar modal over whatever you were looking at, which
 * is a strange thing for a destination to do — a tab should take you somewhere. Editing still
 * happens in the picker; this is the room the picker is reached from.
 */
export function ProfilePage() {
  const s = useStore();
  const me = { id: 'me', avatar: s.profile.avatar, avatarData: s.profile.avatarData, color: s.profile.color };
  return (
    <section className="screen page-screen">
      <div className="page-shell">
        <PageHead screen="profile" title={t('profile.title')} />
        <div className="page-body pf-page">
          <div className="pf-card">
            <button type="button" className="pf-face" onClick={() => store.set({ modal: 'avatar' })} aria-label={t('profile.change')}>
              <PlayerAvatar p={me} size="xl" />
              <span className="badge-photo-edit"><Icon name="pen" className="size-3.5" /></span>
            </button>
            <h2 className="pf-name-lg">{s.name || t('home.name.ph')}</h2>
            <span className="pf-trophies"><Art name="stars" className="size-5" />{t('lb.trophies')}: <b>{s.trophies}</b></span>
            <Button size="md" variant="primary" onPress={() => store.set({ modal: 'avatar' })} className="pf-edit">{t('profile.change')}</Button>
          </div>

          <div className="pf-rows">
            <button type="button" className="pf-row" onClick={() => store.set({ modal: 'chars' })}>
              <Art name="cards" className="size-6" /><span>{t('top.chars')}</span><Icon name="alt-arrow-right" className="size-4 pf-chev" />
            </button>
            <button type="button" className="pf-row" onClick={() => store.set({ modal: 'guide' })}>
              <Icon name="question-circle" className="size-6" /><span>{t('top.rules')}</span><Icon name="alt-arrow-right" className="size-4 pf-chev" />
            </button>
            <button type="button" className="pf-row" onClick={toggleSound}>
              <Art name={s.soundOn ? 'soundOn' : 'soundOff'} className="size-6" /><span>{t('top.sound')}</span>
              <span className="pf-val">{t(s.soundOn ? 'profile.on' : 'profile.off')}</span>
            </button>
            <button type="button" className="pf-row" onClick={() => setLanguage(s.lang === 'en' ? 'tn' : 'en')}>
              <Art name={s.lang === 'en' ? 'flagTn' : 'flagEn'} className="size-6 pf-flag" /><span>{t('top.lang.title')}</span>
              <Icon name="alt-arrow-right" className="size-4 pf-chev" />
            </button>
            {/* Notifications are opt-in and stay that way: this row is the only thing that ever
                asks, and it says what the browser currently thinks rather than what we would like
                it to think. Denied is a dead end until the player clears it in site settings, so it
                says so instead of pretending a tap will fix it. */}
            {pushStatus() !== 'unsupported' && (
              <button type="button" className="pf-row" disabled={pushStatus() === 'denied'}
                onClick={() => (s.pushOn ? disablePush() : enablePush())}>
                <Icon name="bell" className="size-6" /><span>{t('push.title')}</span>
                <span className="pf-val">
                  {pushStatus() === 'denied' ? t('push.blocked') : t(s.pushOn ? 'profile.on' : 'profile.off')}
                </span>
              </button>
            )}
          </div>

          <div className="pf-acct">
            {s.account && !s.account.isGuest
              ? <><span className="acct-name">{s.account.name}</span><button type="button" className="acct-link" onClick={signOutAccount}>{t('acct.signout')}</button></>
              : <button type="button" className="home-acct acct-google" onClick={signInWithGoogle}><GoogleG className="size-4" />{t('acct.google')}</button>}
          </div>
        </div>
      </div>
    </section>
  );
}
