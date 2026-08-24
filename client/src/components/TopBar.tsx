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
        <span className="brand-word">ELMAKINA</span>
      </div>
      <div className="topbar-right flex items-center gap-1.5">
        {s.room && s.screen !== 'home' && <Chip variant="secondary" className="room-code font-semibold tracking-[.2em] tabular-nums ltr" dir="ltr">{s.room.code}</Chip>}
        {inGame && (
          <Badge.Anchor className="lg:hidden">
            <IconButton label={t('top.log')} icon="document-text" onPress={() => store.set({ logOpen: !s.logOpen, unread: 0 })} />
            {s.unread > 0 && <Badge color="danger" size="sm">{s.unread > 9 ? '9+' : s.unread}</Badge>}
          </Badge.Anchor>
        )}
        <Tooltip delay={400}>
          <Button variant="tertiary" size="sm" onPress={() => setLanguage(s.lang === 'en' ? 'tn' : 'en')} aria-label={t('top.lang.title')} className="font-semibold">{t('top.lang')}</Button>
          <Tooltip.Content>{t('top.lang.title')}</Tooltip.Content>
        </Tooltip>
        <IconButton label={t('top.sound')} icon={s.soundOn ? 'volume-loud' : 'volume-cross'} onPress={toggleSound} />
        <Tooltip delay={400}>
          <Button variant="outline" size="sm" onPress={() => store.set({ modal: 'chars' })} aria-label={t('top.chars')} className="guide-btn">
            <Icon name="card-recive" className="size-4" /><span className="guide-btn-tx">{t('top.chars')}</span>
          </Button>
          <Tooltip.Content>{t('top.chars')}</Tooltip.Content>
        </Tooltip>
        <IconButton label={t('top.rules')} icon="question-circle" onPress={() => store.set({ modal: 'guide' })} />
        <span className={`lamp ${s.connected ? 'on' : 'off'}`} title="Connection" />
        {inGame && (
          <Button variant="outline" size="sm" onPress={onLeave}>
            <Icon name="logout-2" className="size-4" /><span className="leave-tx">{t('top.leave')}</span>
          </Button>
        )}
      </div>
    </header>
  );
}
