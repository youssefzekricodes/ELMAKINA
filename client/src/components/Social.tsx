/* Leaderboard + Friends full pages (reached from Home). Read/write the Supabase social tables via lib/social. */
import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import { t } from '../i18n';
import { useStore, store } from '../lib/store';
import { acceptFriend, removeFriend, sendFriendRequest, loadLeaderboard, loadFriends, inviteToRoom, dismissInvite, type LeaderRow } from '../lib/social';
import { joinRoom, leaveRoom, notify } from '../lib/net';
import { Icon, PlayerAvatar } from './ui';

const asPlayer = (uid: string, avatar: string | null, avatarData: string | null) => ({ id: uid, avatar: avatar || 'boy-1', avatarData, color: null });
const home = () => store.set({ screen: 'home' });

function PageHead({ icon, title }: { icon: string; title: string }) {
  return (
    <header className="page-head">
      <button type="button" className="page-back" onClick={home} aria-label={t('page.back')}>
        <Icon name="alt-arrow-left" className="size-5" />
      </button>
      <h1 className="page-title"><Icon name={icon} className="size-6" />{title}</h1>
      <span className="page-head-sp" />
    </header>
  );
}

export function LeaderboardPage() {
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  useEffect(() => { setRows(null); loadLeaderboard().then(setRows); }, []);
  return (
    <section className="screen page-screen">
      <div className="page-shell">
        <PageHead icon="win" title={t('lb.title')} />
        <div className="page-body">
          {rows === null ? <p className="sheet-empty">{t('lb.loading')}</p>
            : rows.length === 0 ? <p className="sheet-empty">{t('lb.empty')}</p>
              : <ol className="lb-list">
                {rows.map((r, i) => (
                  <li key={r.uid} className={`lb-row ${r.me ? 'me' : ''}`}>
                    <span className={`lb-rank r${i + 1}`}>{i + 1}</span>
                    <PlayerAvatar p={asPlayer(r.uid, r.avatar, r.avatarData)} size="sm" />
                    <span className="lb-name">{r.name}{r.me && <span className="lb-you">{t('lobby.you')}</span>}</span>
                    <span className="lb-stat">{t('lb.wins', { n: r.wins })}</span>
                    <span className="lb-trophies"><Icon name="win" className="size-3.5" />{r.trophies}</span>
                  </li>
                ))}
              </ol>}
        </div>
      </div>
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
        <PageHead icon="users-group-rounded" title={t('fr.title')} />
        <div className="page-body">
          {s.account?.isGuest && <p className="fr-hint">{t('fr.guest')}</p>}

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
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label={t('invite.title')} onClick={close}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2 className="sheet-title"><Icon name="user-plus-rounded" className="size-5" />{t('invite.title')}</h2>
          <button type="button" className="sheet-x" onClick={close} aria-label={t('preview.cancel')}><Icon name="close-circle" className="size-5" /></button>
        </div>
        <div className="sheet-body">
          {friends.length === 0 ? <p className="sheet-empty">{t('invite.none')}</p> : friends.map((f) => (
            <div className="fr-row" key={f.id}>
              <PlayerAvatar p={asPlayer(f.uid, f.avatar, f.avatarData)} size="sm" />
              <span className="fr-name">{f.name}</span>
              {sent[f.uid]
                ? <span className="fr-pending">{t('invite.sentTag')}</span>
                : <Button size="sm" variant="primary" onPress={() => invite(f.uid)}>{t('invite.send')}</Button>}
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
      <span className="invite-pop-ic"><Icon name="users-room" className="size-5" /></span>
      <div className="invite-pop-tx"><b>{inv.fromName}</b><span>{t('invite.incoming', { code: inv.code })}</span></div>
      <div className="invite-pop-btns">
        <Button size="sm" variant="primary" onPress={join}>{t('invite.join')}</Button>
        <Button size="sm" variant="tertiary" isIconOnly aria-label={t('invite.dismiss')} onPress={() => dismissInvite()}><Icon name="close-circle" className="size-4" /></Button>
      </div>
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
