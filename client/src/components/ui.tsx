/* Small shared pieces: icons, player avatars, coins, cards, countdown ring, phase steps. */
import { useEffect, useRef } from 'react';
import { Avatar } from '@heroui/react';
import { ICONS } from '../icons';
import { CH, IMG, type CharacterId } from '../theme';
import { avatarSrc } from '../lib/store';
import { i18n, t } from '../i18n';
import { useCountdown } from '../lib/hooks';
import { sfx } from '../lib/sfx';

export function Icon({ name, className = 'size-5' }: { name: string; className?: string }) {
  const body = ICONS[name] || ICONS.system;
  return <svg viewBox="0 0 24 24" className={className} aria-hidden="true" dangerouslySetInnerHTML={{ __html: body }} />;
}

export function PlayerAvatar({ p, size = 'md', className = '' }: { p: any; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  const dim = { xs: 'size-7', sm: 'size-10', md: 'size-14', lg: 'size-[72px]', xl: 'size-28' }[size];
  return (
    <Avatar className={`pavatar ${dim} ${className}`} style={{ '--bg': (p && p.color) || '#727274' } as any}>
      <Avatar.Image src={avatarSrc(p)} alt="" className="pavatar-img" />
      <Avatar.Fallback>{(p?.name || '?').slice(0, 2).toUpperCase()}</Avatar.Fallback>
    </Avatar>
  );
}

export function Coins({ n, big = false, className = '' }: { n: number; big?: boolean; className?: string }) {
  return (
    <span className={`coins ${big ? 'big' : ''} ${className}`} data-coins="">
      <img src={IMG.coin} alt="" />
      <span className="n tabular-nums">{n}</span>
    </span>
  );
}

export function GameCard({ c, w = 96, small = false, pick = false, anim = false, onPress, title, className = '' }: { c: CharacterId | string; w?: number; small?: boolean; pick?: boolean; anim?: boolean; onPress?: () => void; title?: string; className?: string }) {
  const th = CH[c as CharacterId];
  const Tag: any = onPress ? 'button' : 'div';
  return (
    <Tag type={onPress ? 'button' : undefined} onClick={onPress} title={title ?? t('char.blurb.' + c)} className={`gcard ${pick ? 'pick' : ''} ${anim ? 'in' : ''} ${className}`} style={{ width: w }}>
      <img src={th ? (small ? th.cardSm : th.card) : ''} alt={i18n.charName(c)} draggable={false} />
    </Tag>
  );
}

export function CardBack({ className = '', onPress, label }: { className?: string; onPress?: () => void; label?: string }) {
  if (onPress) return <button type="button" onClick={onPress} className={`cardback ${className}`}><span className="slot-n">{label}</span></button>;
  return <div className={`cardback ${className}`}>{label ? <span className="slot-n">{label}</span> : null}</div>;
}

/** Countdown for timed windows: the clock badge + seconds and a depleting bar (turns red near the end). */
export function Ring({ deadline, total, tick = false }: { deadline?: number | null; total?: number; tick?: boolean }) {
  const rem = useCountdown(deadline);
  const secs = Math.max(0, rem / 1000);
  const low = rem < 3000;
  // heartbeat on each of the final 3 seconds — only for windows the player must act in
  const lastSec = useRef(-1);
  useEffect(() => {
    if (!deadline || !tick) return;
    const sec = Math.ceil(rem / 1000);
    if (low && sec !== lastSec.current && sec > 0 && sec <= 3) sfx.play('heartbeat');
    lastSec.current = sec;
  });
  if (!deadline) return null;
  const pct = total && total > 0 ? Math.max(0, Math.min(100, (rem / total) * 100)) : 100;
  return (
    <span className={`countdown ${low ? 'low' : ''}`} dir="ltr" aria-label="Time left" role="timer">
      <img src="/assets/icons/clock.png" alt="" className="countdown-clock" draggable={false} />
      <span className="countdown-body">
        <span className="countdown-num tabular-nums">{secs.toFixed(rem < 10000 ? 1 : 0)}<span className="countdown-unit">s</span></span>
        <span className="countdown-track"><span className="countdown-fill" style={{ width: `${pct}%` }} /></span>
      </span>
    </span>
  );
}

/** A thin top progress line that depletes as a window's timer runs down. */
export function TimerBar({ deadline, total }: { deadline?: number | null; total?: number }) {
  const rem = useCountdown(deadline);
  if (!deadline) return null;
  const pct = total && total > 0 ? Math.max(0, Math.min(100, (rem / total) * 100)) : 100;
  const low = rem < 3000;
  return (
    <span className={`timerbar ${low ? 'low' : ''}`} aria-hidden="true">
      <span className="timerbar-fill" style={{ width: `${pct}%` }} />
    </span>
  );
}

export function Steps({ active }: { active: 'claim' | 'react' | 'result' | 'decide' }) {
  const keys = ['claim', 'react', 'result'] as const;
  const idx = keys.indexOf(active as (typeof keys)[number]);
  return (
    <span className="steps" role="list">
      {keys.map((k, i) => (
        <span key={k} className="step-wrap">
          {i > 0 && <span className="step-sep" aria-hidden="true">›</span>}
          <span className={`step ${k === active ? 'active' : i < idx ? 'done' : ''}`} role="listitem">{t('steps.' + k)}</span>
        </span>
      ))}
    </span>
  );
}

export function PickBanner({ text, danger = false }: { text: string; danger?: boolean }) {
  return (
    <div className={`pick-banner ${danger ? 'danger' : ''}`}>
      <Icon name="cursor" className="size-4" /> <span>{text}</span>
    </div>
  );
}

export function Html({ html, className = '', as: Tag = 'span' }: { html: string; className?: string; as?: any }) {
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Animated equalizer bars — shown while a player is talking. */
export function SoundWaves({ className = '', bars = 4 }: { className?: string; bars?: number }) {
  return (
    <span className={`waves ${className}`} aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => <span key={i} className="wave-bar" style={{ animationDelay: `${i * 0.12}s` }} />)}
    </span>
  );
}
