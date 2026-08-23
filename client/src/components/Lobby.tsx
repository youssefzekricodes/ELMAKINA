import { Button, Chip, Tooltip } from '@heroui/react';
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
        <div className="lobby-head">
          <div className="lobby-head-main">
            <span className="lobby-kicker">{t('lobby.waitingRoom')}</span>
            <h1 className="lobby-title">{t('lobby.title')}</h1>
          </div>
          <div className="lobby-head-right">
            <div className="lobby-gauge" aria-label={`${n}/${cap}`}>
              <div className="lobby-pips">
                {Array.from({ length: cap }, (_, i) => <span key={i} className={`lpip ${i < n ? (i < readyCount ? 'ready' : 'on') : ''}`} />)}
              </div>
              <span className="lobby-gauge-n"><b>{n}</b>/{cap} · {t('lobby.players')}</span>
            </div>
            <Button variant="outline" size="sm" className="lobby-leave" onPress={leaveRoom}>
              <Icon name="logout-2" className="size-4" />{t('lobby.leave')}
            </Button>
          </div>
        </div>

        {/* invite card */}
        <div className="invite-card">
          <div className="invite-main">
            <span className="invite-label">{t('lobby.code')}</span>
            <div className="invite-code" dir="ltr">
              {room.code.split('').map((ch, i) => <span key={i} className="ivc">{ch}</span>)}
            </div>
            <span className="invite-share">{t('lobby.share')}</span>
          </div>
          <Button variant="primary" size="lg" className="invite-copy" onPress={() => copyInvite(room.code)}>
            <Icon name="link-round-angle" className="size-5" />{t('lobby.copy')}
          </Button>
        </div>

        {/* seats */}
        <ul className="seat-list">
          {room.players.map((p, i) => {
            const ready = p.ready || p.isHost || p.isBot;
            const talking = speakingOf(p.id);
            return (
              <li key={p.id} className={`seat-row ${ready ? 'ready' : ''} ${p.connected ? '' : 'off'} ${p.id === room.you ? 'me' : ''}`}>
                <span className="seat-num">{i + 1}</span>
                <span className={`seat-av ${inCall(p.id) ? 'in-call' : ''} ${talking ? 'speaking' : ''}`}>
                  <PlayerAvatar p={p} size="md" />
                  {inCall(p.id) && <span className="seat-mic"><Icon name={p.id in v.peers && v.peers[p.id].muted ? 'microphone-off' : 'microphone'} className="size-3" /></span>}
                </span>
                <div className="seat-body">
                  <div className="seat-name">{p.name}</div>
                  <div className="seat-tags">
                    {p.isHost && <Chip size="sm" variant="soft" color="warning"><Icon name="crown" className="size-3" />{t('lobby.host')}</Chip>}
                    {p.isBot && <Chip size="sm" variant="soft" color="accent"><Icon name="cpu-bolt" className="size-3" />{t('seat.bot')}</Chip>}
                    {p.id === room.you && <Chip size="sm" variant="soft" color="accent">{t('lobby.you')}</Chip>}
                  </div>
                </div>
                <span className={`seat-state ${ready ? 'ready' : ''}`}>
                  <Icon name={ready ? 'check-circle' : 'hourglass'} className="size-4" />
                  <span className="seat-state-txt">{ready ? t('lobby.readyTag') : t('lobby.notreadyTag')}</span>
                </span>
              </li>
            );
          })}
          {Array.from({ length: empties }, (_, k) => {
            const canAdd = isHost && n < room.maxPlayers;
            return (
              <li key={'e' + k} className={`seat-row empty ${canAdd ? 'addable' : ''}`} onClick={canAdd ? addBot : undefined} role={canAdd ? 'button' : undefined}>
                <span className="seat-num">{n + k + 1}</span>
                <span className="seat-av empty"><Icon name={canAdd ? 'user-plus-rounded' : 'sleeping-square'} className="size-5" /></span>
                <div className="seat-body">
                  <div className="seat-name muted">{canAdd ? t('lobby.addSeat') : t('lobby.seatOpen')}</div>
                </div>
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
