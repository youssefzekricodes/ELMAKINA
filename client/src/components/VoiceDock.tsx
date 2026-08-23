/* Floating, draggable voice-chat dock — visible whenever you're in a room (lobby or game).
   Collapsed: a "Join voice" pill. Live: mute toggle, talking faces (with waves), and leave.
   Drag it anywhere by the grip; the position is remembered. */
import { useRef, useState } from 'react';
import { Button, Tooltip } from '@heroui/react';
import { t } from '../i18n';
import { useStore } from '../lib/store';
import { useVoice, joinVoice, leaveVoice, toggleMute } from '../lib/voice';
import { myId } from '../lib/net';
import { Icon, PlayerAvatar, SoundWaves } from './ui';

type Pos = { x: number; y: number };
const loadPos = (): Pos | null => { try { return JSON.parse(localStorage.getItem('mekina.voicePos') || 'null'); } catch { return null; } };

export function VoiceDock() {
  const s = useStore();
  const v = useVoice();
  const [pos, setPos] = useState<Pos | null>(loadPos);
  const node = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number; w: number; h: number; moved: boolean } | null>(null);

  if (!s.room) return null;
  const players = s.room.players;
  const meId = myId();

  const onGripDown = (e: React.PointerEvent) => {
    const el = node.current; if (!el) return;
    const r = el.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height, moved: false };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* */ }
    e.preventDefault();
  };
  const onGripMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    d.moved = true;
    const x = Math.max(6, Math.min(window.innerWidth - d.w - 6, e.clientX - d.dx));
    const y = Math.max(6, Math.min(window.innerHeight - d.h - 6, e.clientY - d.dy));
    setPos({ x, y });
  };
  const onGripUp = () => {
    if (!drag.current) return; drag.current = null;
    const el = node.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const next = { x: r.left, y: r.top };
    setPos(next);
    try { localStorage.setItem('mekina.voicePos', JSON.stringify(next)); } catch { /* */ }
  };
  const style: React.CSSProperties | undefined = pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto', transform: 'none' } : undefined;

  const Grip = (
    <span className="voice-grip" onPointerDown={onGripDown} onPointerMove={onGripMove} onPointerUp={onGripUp} onPointerCancel={onGripUp} title={t('voice.title')} aria-label="drag">
      <Icon name="grip-dots" className="size-4" />
    </span>
  );

  if (!v.active) {
    return (
      <div ref={node} className={`voice-dock ${pos ? 'placed' : ''}`} style={style}>
        <div className="voice-join-wrap">
          {Grip}
          <button type="button" className="voice-join" disabled={v.connecting} onClick={joinVoice}>
            <span className="voice-join-ic"><Icon name="headphones" className="size-[18px]" /></span>
            <span className="voice-join-tx">{v.connecting ? t('voice.joining') : t('voice.join')}</span>
          </button>
        </div>
      </div>
    );
  }

  const faces = players.filter((p) => p.id === meId || p.id in v.peers);
  return (
    <div ref={node} className={`voice-dock ${pos ? 'placed' : ''}`} style={style}>
      <div className="voice-bar" role="group" aria-label={t('voice.title')}>
        {Grip}
        <span className="voice-live"><span className="voice-dot" />{t('voice.live')}</span>
        <div className="voice-faces">
          {faces.map((p) => {
            const isMe = p.id === meId;
            const speaking = isMe ? v.speaking && !v.muted : v.peers[p.id]?.speaking;
            const muted = isMe ? v.muted : v.peers[p.id]?.muted;
            return (
              <Tooltip key={p.id} delay={300}>
                <span className={`voice-face ${speaking ? 'speaking' : ''} ${muted ? 'muted' : ''}`}>
                  <PlayerAvatar p={p} size="xs" />
                  {muted ? <span className="voice-face-mic"><Icon name="microphone-off" className="size-2.5" /></span>
                    : speaking ? <SoundWaves className="voice-face-waves" bars={3} /> : null}
                </span>
                <Tooltip.Content>{isMe ? t('voice.you') : p.name}{muted ? ` · ${t('voice.muted')}` : ''}</Tooltip.Content>
              </Tooltip>
            );
          })}
          {faces.length <= 1 && <span className="voice-alone">{t('voice.alone')}</span>}
        </div>
        <div className="voice-ctrls">
          <Tooltip delay={300}>
            <Button isIconOnly size="sm" variant={v.muted ? 'danger' : 'tertiary'} aria-label={v.muted ? t('voice.unmute') : t('voice.mute')} onPress={toggleMute}>
              <Icon name={v.muted ? 'microphone-off' : 'microphone'} className="size-4" />
            </Button>
            <Tooltip.Content>{v.muted ? t('voice.unmute') : t('voice.mute')}</Tooltip.Content>
          </Tooltip>
          <Tooltip delay={300}>
            <Button isIconOnly size="sm" variant="danger" aria-label={t('voice.leave')} onPress={leaveVoice}>
              <Icon name="phone-hangup" className="size-4" />
            </Button>
            <Tooltip.Content>{t('voice.leave')}</Tooltip.Content>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
