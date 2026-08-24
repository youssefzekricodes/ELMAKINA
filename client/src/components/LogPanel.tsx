import { useEffect, useRef } from 'react';
import { Card, Drawer } from '@heroui/react';
import { i18n, t } from '../i18n';
import { useStore, store, type LogEntry } from '../lib/store';
import { useMediaQuery } from '../lib/hooks';
import { CH, CHARACTERS, type CharacterId } from '../theme';
import { Icon } from './ui';

const logIcon = (e: LogEntry) => (e.key === 'game.win' ? 'win' : e.kind);

const isChar = (x?: string): x is CharacterId => !!x && (CHARACTERS as string[]).includes(x);

/** The character card involved in a log entry (a claimed/played/revealed role), or null. */
export function logCharacter(e: LogEntry): CharacterId | null {
  const p = (e.params || {}) as { character?: string; guess?: string };
  if (isChar(p.character)) return p.character;                       // block.claim, bluff.*
  const key = e.key || '';
  if (key.startsWith('claim.')) { const seg = key.split('.')[1]; if (isChar(seg)) return seg; } // claim.thief, claim.police.self…
  const last = key.split('.').pop() || '';
  if (isChar(last)) return last;
  if ((key === 'colonel.right' || key === 'colonel.wrong') && isChar(p.guess)) return p.guess;  // reveal the guessed card
  if (key.startsWith('colonel.')) return 'colonel';
  if (key === 'loan.veto' || key === 'loan.vetofail' || key === 'loan.vetoed' || key === 'bw.taxclaim' || key.startsWith('tax.')) return 'taxman';
  if (key.startsWith('bw.')) return 'businesswoman';
  if (key.startsWith('police.')) return 'police';
  if (key.startsWith('politician.')) return 'politician';
  if (key === 'steal' || key === 'steal.out') return 'thief';
  return null;                                                        // paidkill / income / loan.* / elim.* → no card
}

function Entries({ log }: { log: LogEntry[] }) {
  const box = useRef<HTMLDivElement>(null);
  const lastId = useRef(0);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const last = log.length ? log[log.length - 1].id : 0;
    if (last !== lastId.current) { lastId.current = last; el.scrollTop = el.scrollHeight; }
  }, [log]);
  const shown = log.slice(-150);
  return (
    <div ref={box} className="log scrollbar-thin" aria-live="polite">
      {shown.map((e) => {
        const ch = logCharacter(e);
        return (
          <div key={e.id} className={`entry k-${e.kind}`}>
            {ch
              ? <span className="log-card" title={i18n.charName(ch)}><img src={CH[ch].cardSm} alt={i18n.charName(ch)} /></span>
              : <span className="ic"><Icon name={logIcon(e)} className="size-4" /></span>}
            <span className="tx">{i18n.logText(e).replace(/^[☠🏆]\s*/, '')}</span>
          </div>
        );
      })}
    </div>
  );
}

export function LogPanel() {
  const s = useStore();
  const mobile = useMediaQuery('(max-width: 1023px)');
  const log = s.state?.log || [];
  // unread counter for the mobile badge
  const seen = useRef(0);
  useEffect(() => {
    const last = log.length ? log[log.length - 1].id : 0;
    if (seen.current === 0) { seen.current = last; return; }
    if (last > seen.current) { const fresh = log.filter((e) => e.id > seen.current).length; seen.current = last; if (mobile && !s.logOpen) store.set((st) => ({ unread: st.unread + fresh })); }
  }, [log, mobile, s.logOpen]);

  if (mobile) {
    return (
      <Drawer.Backdrop isOpen={s.logOpen} onOpenChange={(o) => store.set({ logOpen: o, unread: 0 })}>
        <Drawer.Content placement={i18n.dir() === 'rtl' ? 'left' : 'right'} className="max-w-[380px]">
          <Drawer.Dialog aria-label={t('game.logHead')} className="log-drawer light">
            <Drawer.CloseTrigger />
            <Drawer.Header><Drawer.Heading>{t('game.logHead')}</Drawer.Heading></Drawer.Header>
            <Drawer.Body className="p-0"><Entries log={log} /></Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    );
  }
  const collapsed = s.logCollapsed;
  const toggle = () => store.set((st) => { const v = !st.logCollapsed; try { localStorage.setItem('mekina.logCollapsed', v ? '1' : '0'); } catch { /* ignore */ } return { logCollapsed: v }; });
  return (
    <Card className={`log-area light gap-0 p-0 ${collapsed ? 'collapsed' : ''}`}>
      <button type="button" className="log-head" onClick={toggle} aria-expanded={!collapsed} title={collapsed ? t('game.logShow') : t('game.logHide')}>
        <Icon name="document-text" className="size-4 log-head-ic" />
        {!collapsed && <span className="log-title">{t('game.logHead')}</span>}
        <Icon name={collapsed ? 'alt-arrow-left' : 'alt-arrow-right'} className="size-4 log-chevron" />
        {collapsed && <span className="log-vlabel">{t('game.logHead')}</span>}
      </button>
      {!collapsed && <Entries log={log} />}
    </Card>
  );
}
