/* Leaderboard + Friends modals. Both read/write the Supabase social tables via lib/social. */
import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import { t } from '../i18n';
import { useStore, store } from '../lib/store';
import { acceptFriend, removeFriend, sendFriendRequest, loadLeaderboard, type LeaderRow } from '../lib/social';
import { Icon, PlayerAvatar } from './ui';

const asPlayer = (uid: string, avatar: string | null, avatarData: string | null) => ({ id: uid, avatar: avatar || 'boy-1', avatarData, color: null });
const close = () => store.set({ modal: null });

export function LeaderboardModal() {
  const s = useStore();
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  useEffect(() => { if (s.modal === 'leaderboard') { setRows(null); loadLeaderboard().then(setRows); } }, [s.modal]);
  if (s.modal !== 'leaderboard') return null;
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label={t('lb.title')} onClick={close}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2 className="sheet-title"><Icon name="win" className="size-5" />{t('lb.title')}</h2>
          <button type="button" className="sheet-x" onClick={close} aria-label={t('preview.cancel')}><Icon name="close-circle" className="size-5" /></button>
        </div>
        <div className="sheet-body">
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
    </div>
  );
}

export function FriendsModal() {
  const s = useStore();
  if (s.modal !== 'friends') return null;
  const accepted = s.friends.filter((f) => f.status === 'accepted');
  const outgoing = s.friends.filter((f) => f.status === 'pending' && !f.incoming);
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label={t('fr.title')} onClick={close}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2 className="sheet-title"><Icon name="users-group-rounded" className="size-5" />{t('fr.title')}</h2>
          <button type="button" className="sheet-x" onClick={close} aria-label={t('preview.cancel')}><Icon name="close-circle" className="size-5" /></button>
        </div>
        <div className="sheet-body">
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
