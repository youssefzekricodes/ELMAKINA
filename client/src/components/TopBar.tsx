import { useEffect, useState } from 'react';
import { Badge, Button, Chip, Tooltip } from '@heroui/react';
import { IMG } from '../theme';
import { t } from '../i18n';
import { useStore, store } from '../lib/store';
import { leaveRoom, setLanguage, toggleSound } from '../lib/net';
import { Icon } from './ui';

function IconButton({ label, icon, onPress, className = '' }: { label: string; icon: string; onPress: () => void; className?: string }) {
  return (
    <Tooltip delay={400}>
      <Button isIconOnly variant="tertiary" size="sm" aria-label={label} onPress={onPress} className={className}>
        <Icon name={icon} className="size-5" />
      </Button>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  );
}

/** The four set-once controls, folded behind one button so the in-game bar stays at three. */
function MoreMenu() {
  const s = useStore();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const shut = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.more-wrap')) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', shut);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', shut); document.removeEventListener('keydown', esc); };
  }, [open]);
  const item = (icon: string, label: string, onPress: () => void) => (
    <button type="button" className="more-item" onClick={() => { setOpen(false); onPress(); }}>
      <Icon name={icon} className="size-4" />{label}
    </button>
  );
  return (
    <span className="more-wrap">
      <Button isIconOnly variant="tertiary" size="sm" aria-label={t('top.more')} aria-expanded={open} onPress={() => setOpen((v) => !v)}>
        <Icon name="grip-dots" className="size-5" />
      </Button>
      {open && (
        <div className="more-menu" role="menu">
          {item('card-recive', t('top.chars'), () => store.set({ modal: 'chars' }))}
          {item('question-circle', t('top.rules'), () => store.set({ modal: 'guide' }))}
          {item(s.soundOn ? 'volume-loud' : 'volume-cross', t('top.sound'), toggleSound)}
          {item('info-circle', t('top.lang.title'), () => setLanguage(s.lang === 'en' ? 'tn' : 'en'))}
        </div>
      )}
    </span>
  );
}

/**
 * In-game controls for phones and tablets, where the header is gone entirely.
 *
 * The bar cost a permanent ~50px strip of the scarcest thing a phone has — table height — to show
 * a wordmark and seven controls, none of which are needed mid-turn except the log and the way out.
 * All of it now lives behind one gear, and the sheet opens from the bottom where a thumb already is.
 */
export function GameMenu() {
  const s = useStore();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);
  const onLeave = async () => {
    if (s.state && s.state.phase === 'playing' && !confirm(t('toast.leave'))) return;
    await leaveRoom();
  };
  const item = (icon: string, label: string, onPress: () => void, cls = '', tail?: React.ReactNode) => (
    <button type="button" className={`gm-item ${cls}`} role="menuitem" onClick={() => { setOpen(false); onPress(); }}>
      <Icon name={icon} className="size-5" /><span className="gm-tx">{label}</span>{tail}
    </button>
  );
  return (
    <>
      <button type="button" className="gm-btn" aria-label={t('top.more')} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name="settings-minimalistic" className="size-5" />
        {s.unread > 0 && <span className="gm-dot">{s.unread > 9 ? '9+' : s.unread}</span>}
      </button>
      {open && (
        <div className="gm-scrim" onClick={() => setOpen(false)}>
          <div className="gm-sheet" role="menu" aria-label={t('top.more')} onClick={(e) => e.stopPropagation()}>
            <div className="gm-head">
              <span className="gm-brand">ELMEKINA</span>
              {s.room && <span className="gm-code ltr" dir="ltr">{s.room.code}</span>}
            </div>
            {s.net !== 'ok' && (
              <span className={`net-pill ${s.net} gm-net`} role="status">
                <Icon name={s.net === 'off' ? 'danger-triangle' : 'hourglass'} className="size-3.5" />
                <span className="net-tx">{t(s.net === 'off' ? 'net.off' : 'net.slow')}</span>
              </span>
            )}
            {item('document-text', t('top.log'), () => store.set({ logOpen: !s.logOpen, unread: 0 }), '', s.unread > 0 ? <span className="gm-badge">{s.unread > 9 ? '9+' : s.unread}</span> : null)}
            {item('card-recive', t('top.chars'), () => store.set({ modal: 'chars' }))}
            {item('question-circle', t('top.rules'), () => store.set({ modal: 'guide' }))}
            {item(s.soundOn ? 'volume-loud' : 'volume-cross', t('top.sound'), toggleSound)}
            {item('info-circle', t('top.lang.title'), () => setLanguage(s.lang === 'en' ? 'tn' : 'en'))}
            {item('logout-2', t('top.leave'), onLeave, 'danger')}
          </div>
        </div>
      )}
    </>
  );
}

export function TopBar() {
  const s = useStore();
  const inGame = s.screen === 'game';
  const onLeave = async () => {
    if (s.state && s.state.phase === 'playing' && !confirm(t('toast.leave'))) return;
    await leaveRoom();
  };
  return (
    <header className="topbar">
      <div className="flex items-center gap-2.5">
        <img className="size-8 object-contain drop-shadow" src={IMG.machineSmall} alt="" />
        <span className="brand-word">ELMEKINA</span>
      </div>
      <div className="topbar-right flex items-center gap-1.5">
        {s.room && s.screen !== 'home' && <Chip variant="secondary" className="room-code font-semibold tracking-[.2em] tabular-nums ltr" dir="ltr">{s.room.code}</Chip>}
        {inGame && (
          <Badge.Anchor className="lg:hidden">
            <IconButton label={t('top.log')} icon="document-text" onPress={() => store.set({ logOpen: !s.logOpen, unread: 0 })} />
            {s.unread > 0 && <Badge color="danger" size="sm">{s.unread > 9 ? '9+' : s.unread}</Badge>}
          </Badge.Anchor>
        )}
        {/* Mid-game the header keeps only what you might need mid-turn: the log, the connection, and
            the way out. Language, the card reference, the rules and sound are set-once things, so
            they live behind one button instead of crowding the bar. */}
        {inGame ? <MoreMenu /> : (
          <>
            <Tooltip delay={400}>
              <Button variant="tertiary" size="sm" onPress={() => setLanguage(s.lang === 'en' ? 'tn' : 'en')} aria-label={t('top.lang.title')} className="font-semibold">{t('top.lang')}</Button>
              <Tooltip.Content>{t('top.lang.title')}</Tooltip.Content>
            </Tooltip>
            <Tooltip delay={400}>
              <Button variant="outline" size="sm" onPress={() => store.set({ modal: 'chars' })} aria-label={t('top.chars')} className="guide-btn">
                <Icon name="card-recive" className="size-4" /><span className="guide-btn-tx">{t('top.chars')}</span>
              </Button>
              <Tooltip.Content>{t('top.chars')}</Tooltip.Content>
            </Tooltip>
            <IconButton label={t('top.rules')} icon="question-circle" onPress={() => store.set({ modal: 'guide' })} />
            <IconButton label={t('top.sound')} icon={s.soundOn ? 'volume-loud' : 'volume-cross'} onPress={toggleSound} className={s.soundOn ? '' : 'is-muted'} />
          </>
        )}
        {/* Only trouble is worth a badge. A green "everything is fine" dot sat in the header for
            the whole session saying nothing — the slow/offline pills are the states you need. */}
        {s.net !== 'ok' && (
          <span className={`net-pill ${s.net}`} role="status" title={t(s.net === 'off' ? 'net.off' : 'net.slow')}>
            <Icon name={s.net === 'off' ? 'danger-triangle' : 'hourglass'} className="size-3.5" />
            <span className="net-tx">{t(s.net === 'off' ? 'net.off' : 'net.slow')}</span>
          </span>
        )}
        {inGame && (
          <Button variant="danger" size="sm" onPress={onLeave} className="leave-btn">
            <Icon name="logout-2" className="size-4" /><span className="leave-tx">{t('top.leave')}</span>
          </Button>
        )}
      </div>
    </header>
  );
}
