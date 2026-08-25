/* Leaderboard + Friends full pages (reached from Home). Read/write the Supabase social tables via lib/social. */
import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import { t } from '../i18n';
import { useStore, store } from '../lib/store';
import { acceptFriend, removeFriend, sendFriendRequest, loadLeaderboard, loadFriends, type LeaderRow } from '../lib/social';
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
