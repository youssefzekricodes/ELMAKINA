import { Button } from '@heroui/react';
import { t } from '../i18n';
import { ask } from '../lib/ask';
import { useStore, store } from '../lib/store';
import { copyInvite, kickPlayer, leaveRoom, setRoomPublic, startGame, toggleReady } from '../lib/net';
import { goFullscreen } from '../lib/fullscreen';
import { Art, Icon, PlayerAvatar } from './ui';
import { sendFriendRequest } from '../lib/social';
import { useState } from 'react';
import { useVoice, speakingOf, inCall } from '../lib/voice';

/**
 * The friend action on a seat, with its state written out: "Add friend" is a button, "Friend" and
 * "Requested" are facts. The icon-only dot it replaces looked the same in all three states and
 * nobody could tell whether it was a button or a badge.
 */
function FriendChip({ uid, name }: { uid: string; name: string }) {
  const s = useStore();
  const already = s.friends.some((f) => f.uid === uid);
  const [sent, setSent] = useState(false);
  if (already) return <span className="pact done"><Icon name="check-circle" className="size-3.5" />{t('lobby.act.friend')}</span>;
  if (sent) return <span className="pact done muted"><Icon name="check-circle" className="size-3.5" />{t('lobby.act.requested')}</span>;
  return (
    <button type="button" className="pact" title={t('fr.add', { name })}
      onClick={async (e) => { e.stopPropagation(); const r = await sendFriendRequest(uid); if (r.ok || r.error === 'already') setSent(true); }}>
      <Icon name="user-plus-rounded" className="size-3.5" />{t('lobby.act.addFriend')}
    </button>
  );
}

export function Lobby() {
  const s = useStore();
  const v = useVoice(); void v; // live speaking rings on seats
  const room = s.room!;
  const isHost = room.hostId === room.you;
  const meP = room.players.find((p) => p.id === room.you);
  const n = room.players.length;
  const readyCount = room.players.filter((p) => p.ready || p.isHost || p.isBot).length;
  const hint = n < room.minPlayers ? t('lobby.hint.more', { n, max: room.maxPlayers }) : isHost ? (room.canStart ? t('lobby.hint.canStart') : t('lobby.hint.wait')) : t('lobby.hint.guest');
  const cap = Math.min(room.maxPlayers, 6);
  const empties = Math.max(0, cap - n);
  const openEditor = () => store.set({ modal: 'avatar' });

  return (
    <section className="screen lobby-screen">
      <div className="lobby-shell">
        {/* header */}
        <header className="lobby-head">
          <div className="lobby-head-main">
            <span className="lobby-kicker">{t('lobby.waitingRoom')}</span>
            <h1 className="lobby-title">{t('lobby.title')}</h1>
          </div>
          <div className="lobby-head-right">
            {/* Who may walk in. A single badge that flipped between two words made you read it,
                work out which of the two states it was showing, and guess whether tapping set it or
                described it. Two pills side by side answer all three at a glance: both options are
                visible, the lit one is the answer, and the other one is the thing you can press. */}
            <div className={`pill-switch ${isHost ? '' : 'ro'}`} data-on={room.isPublic ? 'pub' : 'priv'}
              role="group" aria-label={t('lobby.visibility')}>
              <button type="button" className={`ps-opt ${room.isPublic ? '' : 'on'}`} aria-pressed={!room.isPublic}
                disabled={!isHost} onClick={() => setRoomPublic(false)}>
                <Icon name="eye" className="size-3.5" />{t('lobby.private')}
              </button>
              <button type="button" className={`ps-opt ${room.isPublic ? 'on' : ''}`} aria-pressed={!!room.isPublic}
                disabled={!isHost} onClick={() => setRoomPublic(true)}>
                <Icon name="users-room" className="size-3.5" />{t('lobby.public')}
              </button>
            </div>
            <span className="lobby-count" aria-label={`${n}/${cap}`}><b>{n}</b><i>/{cap}</i></span>
            {/* Leaving is the one irreversible thing on this screen, so it is worded, not implied:
                an unlabelled arrow in a corner is a door nobody is sure about. */}
            <Button variant="danger" size="sm" className="lobby-leave" onPress={leaveRoom}>
              <Icon name="logout-2" className="size-4" /><span className="lobby-leave-tx">{t('lobby.leave')}</span>
            </Button>
          </div>
        </header>

        {/* invite band */}
        <div className="invite-card">
          <div className="invite-main">
            <span className="invite-label">{t('lobby.code')}</span>
            <div className="invite-code" dir="ltr">
              {room.code.split('').map((ch, i) => <span key={i} className="ivc">{ch}</span>)}
            </div>
          </div>
          {/* Two ways to fill the seats, side by side where the code is: the link for anyone, the
              friends list for the people already in the app. "Invite friends" used to be an
              unlabelled icon in the bottom bar, a long way from the code it belongs with. */}
          <div className="invite-actions">
            <Button variant="primary" size="lg" className="invite-copy" onPress={() => copyInvite(room.code)}>
              <Icon name="link-round-angle" className="size-5" />{t('lobby.copy')}
            </Button>
            <Button variant="secondary" size="lg" className="invite-friends" onPress={() => store.set({ modal: 'invite' })}>
              <Icon name="users-group-rounded" className="size-5" />{t('lobby.invite')}
            </Button>
          </div>
        </div>

        {/* seats — place-cards around the table */}
        <ul className="seat-grid">
          {room.players.map((p, i) => {
            const ready = p.ready || p.isHost || p.isBot;
            const talking = speakingOf(p.id);
            const mine = p.id === room.you;
            const canKick = isHost && !mine;
            const kickLabel = t('lobby.kick', { name: p.name });
            return (
              <li
                key={p.id}
                className={`pcard ${ready ? 'ready' : 'waiting'} ${p.connected ? '' : 'off'} ${mine ? 'me' : ''}`}
              >
                <span className="pcard-num">{i + 1}</span>
                {ready && <span className="pcard-stamp">{t('lobby.readyTag')}</span>}
                <span className={`pcard-av ${inCall(p.id) ? 'in-call' : ''} ${talking ? 'speaking' : ''}`}>
                  <PlayerAvatar p={p} size="lg" />
                  {inCall(p.id) && <span className="seat-mic"><Icon name={p.id in v.peers && v.peers[p.id].muted ? 'microphone-off' : 'microphone'} className="size-3" /></span>}
                </span>
                <div className="pcard-name">{p.name}</div>
                <div className="pcard-tags">
                  {p.isHost && <span className="ptag host"><Icon name="crown" className="size-3" />{t('lobby.host')}</span>}
                  {p.isBot && <span className="ptag bot"><Icon name="cpu-bolt" className="size-3" />{t('seat.bot')}</span>}
                  {mine && <span className="ptag you">{t('lobby.you')}</span>}
                  {!ready && <span className="ptag wait">{t('lobby.notreadyTag')}</span>}
                </div>
                {/* What you can do to THIS seat, written out. Yours: change your look. Someone else's:
                    befriend them, and — as host — remove them. Each is a small labelled button, not a
                    pencil or a minus floating on the avatar's shoulder. */}
                <div className="pcard-actions">
                  {mine && (
                    <button type="button" className="pact" onClick={(e) => { e.stopPropagation(); openEditor(); }}>
                      <Icon name="pen" className="size-3.5" />{t('lobby.act.edit')}
                    </button>
                  )}
                  {!p.isBot && !mine && <FriendChip uid={p.id} name={p.name} />}
                  {canKick && (
                    <button type="button" className="pact danger" title={kickLabel}
                      onClick={async (e) => { e.stopPropagation(); if (await ask(t('lobby.kickConfirm', { name: p.name }), { ok: kickLabel, danger: true })) kickPlayer(p.id); }}>
                      <Icon name="user-minus-rounded" className="size-3.5" />{t('lobby.act.remove')}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
          {Array.from({ length: empties }, (_, k) => (
            <li key={'e' + k} className="pcard empty">
              <span className="pcard-num">{n + k + 1}</span>
              <span className="pcard-av empty"><Icon name="sleeping-square" className="size-6" /></span>
              <div className="pcard-name muted">{t('lobby.seatOpen')}</div>
            </li>
          ))}
        </ul>

        {room.isPublic && n < room.minPlayers
          ? <div className="searching" role="status">
              <span className="sr-dots" aria-hidden="true"><i /><i /><i /></span>
              <b>{t('search.title')}</b>
              <span>{t('lobby.waitingPlayers')}</span>
            </div>
          : <p className="hint">{hint}</p>}
      </div>

      {/* action bar */}
      <div className="lobby-bar">
        <div className="lobby-bar-left">
          {/* One secondary action, and it says what it opens. The bar used to hold three icons — a
              pen, a card, two heads — that read as decoration; the pen is on your own seat now and
              the invite sits with the room code. */}
          <Button size="md" variant="tertiary" className="lobby-chars" onPress={() => store.set({ modal: 'chars' })}>
            <Art name="cards" className="size-5" />{t('top.chars')}
          </Button>
        </div>
        {!isHost && (
          <Button size="lg" variant={meP?.ready ? 'secondary' : 'primary'} className="lobby-cta" onPress={toggleReady}>
            <Icon name="check-circle" className="size-5" />{meP?.ready ? t('lobby.notready') : t('lobby.ready')}
          </Button>
        )}
        {isHost && (
          <Button size="lg" variant="primary" className="lobby-cta" isDisabled={!room.canStart} onPress={() => { goFullscreen(); startGame(); }}>
            <Icon name="play-circle" className="size-5" />{t('lobby.start')}
          </Button>
        )}
      </div>
    </section>
  );
}
