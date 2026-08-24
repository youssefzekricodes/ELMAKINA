import { Button, Tooltip } from '@heroui/react';
import { t } from '../i18n';
import { useStore, store } from '../lib/store';
import { addBot, copyInvite, leaveRoom, removeBot, startGame, toggleReady } from '../lib/net';
import { goFullscreen } from '../lib/fullscreen';
import { Icon, PlayerAvatar } from './ui';
import { useVoice, speakingOf, inCall } from '../lib/voice';

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
            <span className="lobby-count" aria-label={`${n}/${cap}`}><b>{n}</b><i>/{cap}</i></span>
            <Button variant="outline" size="sm" className="lobby-leave" onPress={leaveRoom}>
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
          <Button variant="primary" size="lg" className="invite-copy" onPress={() => copyInvite(room.code)}>
            <Icon name="link-round-angle" className="size-5" />{t('lobby.copy')}
          </Button>
        </div>

        {/* seats — place-cards around the table */}
        <ul className="seat-grid">
          {room.players.map((p, i) => {
            const ready = p.ready || p.isHost || p.isBot;
            const talking = speakingOf(p.id);
            return (
              <li key={p.id} className={`pcard ${ready ? 'ready' : 'waiting'} ${p.connected ? '' : 'off'} ${p.id === room.you ? 'me' : ''}`}>
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
                  {p.id === room.you && <span className="ptag you">{t('lobby.you')}</span>}
                  {!ready && <span className="ptag wait">{t('lobby.notreadyTag')}</span>}
                </div>
              </li>
            );
          })}
          {Array.from({ length: empties }, (_, k) => {
            const canAdd = isHost && n < room.maxPlayers;
            return (
              <li key={'e' + k} className={`pcard empty ${canAdd ? 'addable' : ''}`} onClick={canAdd ? addBot : undefined} role={canAdd ? 'button' : undefined}>
                <span className="pcard-num">{n + k + 1}</span>
                <span className="pcard-av empty"><Icon name={canAdd ? 'user-plus-rounded' : 'sleeping-square'} className="size-6" /></span>
                <div className="pcard-name muted">{canAdd ? t('lobby.addSeat') : t('lobby.seatOpen')}</div>
              </li>
            );
          })}
        </ul>

        <p className="hint">{hint}</p>
      </div>

      {/* action bar */}
      <div className="lobby-bar">
        <div className="lobby-bar-left">
          <Tooltip delay={400}>
            <Button isIconOnly size="md" variant="secondary" aria-label={t('profile.change')} onPress={() => store.set({ modal: 'avatar' })}><Icon name="gallery-add" className="size-5" /></Button>
            <Tooltip.Content>{t('profile.change')}</Tooltip.Content>
          </Tooltip>
          <Tooltip delay={400}>
            <Button isIconOnly size="md" variant="tertiary" aria-label={t('top.chars')} onPress={() => store.set({ modal: 'chars' })}><Icon name="card-recive" className="size-5" /></Button>
            <Tooltip.Content>{t('top.chars')}</Tooltip.Content>
          </Tooltip>
          {isHost && n < room.maxPlayers && (
            <Tooltip delay={400}>
              <Button isIconOnly size="md" variant="secondary" aria-label={t('lobby.addSeat')} onPress={addBot}><Icon name="user-plus-rounded" className="size-5" /></Button>
              <Tooltip.Content>{t('lobby.addSeat')}</Tooltip.Content>
            </Tooltip>
          )}
          {isHost && room.players.some((p) => p.isBot) && (
            <Tooltip delay={400}>
              <Button isIconOnly size="md" variant="tertiary" aria-label={t('lobby.removeBot')} onPress={removeBot}><Icon name="user-minus-rounded" className="size-5" /></Button>
              <Tooltip.Content>{t('lobby.removeBot')}</Tooltip.Content>
            </Tooltip>
          )}
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
