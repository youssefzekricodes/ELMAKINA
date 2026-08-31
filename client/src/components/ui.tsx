/* Small shared pieces: icons, player avatars, coins, cards, countdown ring, phase steps. */
import { useEffect, useRef } from 'react';
import { Avatar } from '@heroui/react';
import { ICONS } from '../icons';
import { CH, IMG, type CharacterId } from '../theme';
import { avatarSrc, setLearn, useStore } from '../lib/store';
import { i18n, t } from '../i18n';
import { useCountdown } from '../lib/hooks';
import { sfx } from '../lib/sfx';

export function Icon({ name, className = 'size-5' }: { name: string; className?: string }) {
  const body = ICONS[name] || ICONS.system;
  return <svg viewBox="0 0 24 24" className={className} data-icon={name} aria-hidden="true" dangerouslySetInnerHTML={{ __html: body }} />;
}

/** Multi-colour Google "G" for the sign-in button. */
export function GoogleG({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 12 0 12 12 0 0 0 1.3 6.6l4 3.1C6.2 6.9 8.9 4.8 12 4.8z" />
    </svg>
  );
}

export function PlayerAvatar({ p, size = 'md', className = '' }: { p: any; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  const dim = { xs: 'size-7', sm: 'size-10', md: 'size-14', lg: 'size-[72px]', xl: 'size-28' }[size];
  return (
    <Avatar className={`pavatar ${p && p.avatar === 'custom' ? 'custom' : ''} ${p && String(p.avatar || '').startsWith('mv:') ? 'mv' : ''} ${dim} ${className}`} style={{ '--bg': (p && p.color) || '#727274' } as any}>
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

export function CardBack({ className = '', onPress, label, style }: { className?: string; onPress?: () => void; label?: string; style?: React.CSSProperties }) {
  if (onPress) return <button type="button" onClick={onPress} className={`cardback ${className}`} style={style}><span className="slot-n">{label}</span></button>;
  return <div className={`cardback ${className}`} style={style}>{label ? <span className="slot-n">{label}</span> : null}</div>;
}

/** Countdown for timed windows: the clock badge + seconds and a depleting bar (turns red near the end). */
/**
 * The turn clock, worn by the seat itself: an arc around the avatar that drains as the player's
 * time runs out. It replaces the old pulsing glow — the ring is both the "who's on" marker and
 * the countdown, the way a real game clock sits in front of the player it times.
 *
 * The dash lengths are in user units off the real circumference, NOT `pathLength`: WebKit ignores
 * `pathLength` on a <circle>, so a "75 100" dash was measured against the true 289-unit perimeter
 * and drew a quarter-arc plus a stray second dash instead of three quarters of a ring.
 */
const CLOCK_R = 46;
const CLOCK_C = 2 * Math.PI * CLOCK_R;
export function SeatClock({ deadline, total }: { deadline?: number | null; total?: number }) {
  const rem = useCountdown(deadline);
  if (!deadline || !total) return null;
  const frac = Math.max(0, Math.min(1, rem / total));
  return (
    <svg className={`seat-clock ${rem < 5000 ? 'low' : ''}`} viewBox="0 0 100 100" aria-hidden="true">
      <circle className="sc-track" cx="50" cy="50" r={CLOCK_R} />
      <circle className="sc-arc" cx="50" cy="50" r={CLOCK_R} strokeDasharray={`${(frac * CLOCK_C).toFixed(2)} ${CLOCK_C.toFixed(2)}`} />
    </svg>
  );
}

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

/** Persistent "learning mode" switch — coach-marks + card rules in every game. Shown on Home and in the Guide. */
export function LearnToggle({ className = '' }: { className?: string }) {
  const on = useStore().learn;
  return (
    <button
      type="button" role="switch" aria-checked={on} aria-label={t('learn.title')}
      className={`learn-toggle ${on ? 'on' : ''} ${className}`} onClick={() => setLearn(!on)}
    >
      <span className="lt-ic"><Icon name="hand-stars" className="size-4" /></span>
      <span className="lt-tx">
        <span className="lt-t">{t('learn.title')}</span>
        <span className="lt-s">{t('learn.sub')}</span>
      </span>
      <span className="lt-sw" aria-hidden="true"><span className="lt-knob" /></span>
    </button>
  );
}
