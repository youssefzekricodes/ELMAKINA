/* Your control panel — every move is a card. The character cards you actually hold are framed;
   cards you can't play right now are disabled. Your cards stay visible so you never forget your hand. */
import { useEffect, useRef, useState } from 'react';
import { Button, Card, Chip, Tooltip } from '@heroui/react';
import { ACTIONS, ACTION_CARDS, CH, IMG, type ActionDef } from '../theme';
import { i18n, t } from '../i18n';
import { isCoaching, store, useStore } from '../lib/store';
import { sendAction, startAction } from '../lib/net';
import { validTargets } from '../lib/rules';
import { sfx } from '../lib/sfx';
import { Art, Coins, GameCard, Icon, PickBanner, Ring } from './ui';

const pressAction = (type: string) => { sfx.play('lever'); startAction(type); };
const actionName = (type: string) => (CH[type as keyof typeof CH] ? i18n.charName(type) : t(`action.${type}.name`));
const actionDesc = (type: string) => t(`action.${type}.desc`);
const cardArt = (type: string) => (CH[type as keyof typeof CH] ? CH[type as keyof typeof CH].card : ACTION_CARDS[type]);

/** One playable card: art + name + cost. Owned character cards are framed; unplayable ones look disabled
    but stay clickable, so a tap can explain WHY it can't be played (a real `disabled` fires no events). */
function BoardCard({ a, coins, targets, myTurn, owned, blockedNote, onPlay, onBlocked }: {
  a: ActionDef; coins: number; targets: string[] | null; myTurn: boolean; owned: number; blockedNote: string;
  onPlay: (a: ActionDef) => void; onBlocked: (a: ActionDef, msg: string) => void;
}) {
  const th = CH[a.type as keyof typeof CH];
  const canAfford = coins >= a.cost;
  const noTarget = !!(targets && !targets.length);
  const playable = myTurn && canAfford && !noTarget;
  const why = !myTurn ? '' : !canAfford ? t('game.needCoins', { n: a.cost }) : noTarget ? t('game.noTarget') : '';
  // Full sentence for the tap-to-explain toast. Never "you don't hold this card" — bluffing is legal.
  const note = !myTurn ? blockedNote : !canAfford ? t('board.needCoinsFull', { n: a.cost }) : noTarget ? t('board.noTargetFull') : '';
  return (
    <Tooltip delay={350}>
      <button type="button" className={`board-card ${owned ? 'owned' : ''} ${playable ? '' : 'off'}`} data-kind={a.kind} aria-disabled={!playable}
        onClick={() => (playable ? onPlay(a) : onBlocked(a, note))} style={{ '--c': th ? th.color : 'var(--accent)' } as any}>
        <span className="bc-art">
          <img src={cardArt(a.type)} alt={actionName(a.type)} draggable={false} />
          {a.cost > 0 && <span className="bc-cost">{a.cost}<img src={IMG.coin} alt="" /></span>}
        </span>
        {owned > 0 && <span className="bc-own">{t('board.yours')}{owned > 1 ? ` ×${owned}` : ''}</span>}
        <span className="bc-name">{actionName(a.type)}</span>
        {why ? <span className="bc-why">{why}</span> : null}
      </button>
      <Tooltip.Content>{playable ? actionDesc(a.type) : `${actionDesc(a.type)} — ${note}`}</Tooltip.Content>
    </Tooltip>
  );
}

export function Console() {
  const s = useStore();
  const st = s.state!; const me = s.me;
  const meP = st.players.find((p) => p.id === me); const you = st.you;
  const handKey = JSON.stringify(you?.cards || []);
  const [preview, setPreview] = useState<{ a: ActionDef; why?: string } | null>(null); // what this card does — shown before playing, or why it can't be played
  const first = useRef(true);
  const boardRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (first.current) { first.current = false; return; } sfx.play('deal'); }, [handKey]);
  // centre the swiper on YOUR cards (they sit mid-row) whenever the hand changes
  useEffect(() => {
    const id = setTimeout(() => {
      const el = boardRef.current; if (!el || el.scrollWidth <= el.clientWidth) return;
      const own = [...el.querySelectorAll<HTMLElement>('.board-card.owned')];
      if (!own.length) return;
      const left = Math.min(...own.map((c) => c.offsetLeft));
      const right = Math.max(...own.map((c) => c.offsetLeft + c.offsetWidth));
      el.scrollTo({ left: (left + right) / 2 - el.clientWidth / 2 });
    }, 60); // after layout
    return () => clearTimeout(id);
  }, [handKey]);
  /** Scroll the row by roughly one and a half cards, in whichever direction the arrow points. */
  const nudgeRow = (dir: number) => {
    const el = boardRef.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>('.board-card');
    const step = (card ? card.offsetWidth + 8 : 90) * 1.5;
    // scrollBy handles RTL for us — in an RTL row a positive delta still means "further along".
    el.scrollBy({ left: dir * step * (getComputedStyle(el).direction === 'rtl' ? -1 : 1), behavior: 'smooth' });
  };
  /**
   * Tell the player the row scrolls. Two signals: `data-more` drives an edge fade on whichever side
   * still has cards, and a one-time nudge animates the row on someone's very first game. People were
   * simply not discovering the cards past the edge — a hidden scrollbar is no affordance at all.
   */
  useEffect(() => {
    const el = boardRef.current, wrap = wrapRef.current;
    if (!el || !wrap) return;
    const sync = () => {
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 4) { wrap.removeAttribute('data-more'); return; }
      // Math.abs because the default language is Tunisian and the row is RTL there: Chrome reports
      // scrollLeft as 0 at the start and NEGATIVE going forward, so a plain `> 4` never fires and
      // the start-side fade would simply never appear in Arabic.
      const pos = Math.abs(el.scrollLeft);
      const start = pos > 4, end = pos < max - 4;
      wrap.setAttribute('data-more', `${start ? 'start ' : ''}${end ? 'end' : ''}`.trim());
    };
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    const ro = new ResizeObserver(sync); ro.observe(el);
    let nudge: any;
    try {
      if (el.scrollWidth > el.clientWidth && !localStorage.getItem('mekina.rowHint')) {
        localStorage.setItem('mekina.rowHint', '1');
        el.classList.add('nudge');
        nudge = setTimeout(() => el.classList.remove('nudge'), 3200);
      }
    } catch { /* private mode: skip the hint rather than break the row */ }
    return () => { el.removeEventListener('scroll', sync); ro.disconnect(); clearTimeout(nudge); };
  }, [handKey]);
  /**
   * How much of the screen bottom your hand occupies, published as --hand-h.
   *
   * The claim panel is fixed and was centred, so on a phone it landed straight on top of the one
   * thing you need in order to answer a claim — your own cards. CSS cannot measure another box, so
   * the console measures itself and the panel anchors above it.
   */
  const handBar = useRef<HTMLDivElement>(null);
  const [handOpen, setHandOpen] = useState(false);
  useEffect(() => {
    const publish = () => {
      const el = handBar.current;
      const r = el && el.getBoundingClientRect();
      // A hidden bar reports a zero rect, and innerHeight - 0 is the whole screen — which pushed
      // the claim panel clean off the top. No bar on screen means nothing to stay clear of.
      const px = r && r.height > 0 ? Math.max(0, Math.round(window.innerHeight - r.top)) : 0;
      document.documentElement.style.setProperty('--hand-h', px + 'px');
    };
    publish();
    const ro = new ResizeObserver(publish);
    if (handBar.current) ro.observe(handBar.current);
    window.addEventListener('resize', publish);
    return () => { ro.disconnect(); window.removeEventListener('resize', publish); };
  });

  if (!you || !meP) return <Card id="console" className="console p-4"><div className="status-line">{t('game.spectating')}</div></Card>;

  const myTurn = st.phase === 'playing' && st.pending && st.pending.stage === 'turn' && st.pending.actorId === me && meP.alive;
  const selfPick = !!(s.targeting && s.targeting.type === 'police' && s.targetId === me);
  const ring = st.pending?.stage === 'turn' ? <Ring deadline={st.pending.deadline} total={st.timings.turn} tick={myTurn} /> : null;
  const owned: Record<string, number> = {};
  for (const c of you.cards) owned[c] = (owned[c] || 0) + 1;

  let status: React.ReactNode = null;
  if (st.phase === 'ended') status = <div className="status-line">{t('game.over')}</div>;
  else if (myTurn) status = <div className="status-line"><Chip variant="primary" color="accent">{t('game.yourturn')}</Chip><span>{t('game.choose')}</span>{ring}</div>;
  else if (st.pending && st.pending.stage === 'turn') status = <div className="status-line"><span dangerouslySetInnerHTML={{ __html: i18n.html('game.waitingFor', { name: (st.players.find((p) => p.id === st.pending!.actorId) || {}).name || '?' }) }} />{ring}</div>;
  else if (!meP.alive) status = <div className="status-line">{t('game.eliminated')}</div>;

  // coaching = the guide's one-off practice tour OR the persistent "learning mode" setting
  const coaching = isCoaching(s);
  // every card explains itself before it is played (the guide's card rule, then Use / Cancel)
  const play = (a: ActionDef) => setPreview({ a });
  // tapping a card you can't play explains itself instead of doing nothing
  const blockedNote = !meP.alive ? t('board.outNote') : st.phase === 'ended' ? t('board.overNote') : t('board.wait');
  // a card you can't play opens the same sheet, showing the card and WHY it is unavailable
  const onBlocked = (a: ActionDef, msg: string) => setPreview({ a, why: msg || blockedNote });
  const card = (a: ActionDef) => <BoardCard key={a.type} a={a} coins={meP.coins} targets={a.target ? validTargets(st, me, a) : null} myTurn={!!myTurn} owned={CH[a.type as keyof typeof CH] ? (owned[a.type] || 0) : 0} blockedNote={blockedNote} onPlay={play} onBlocked={onBlocked} />;
  // your held cards sit side by side in the MIDDLE of the row, with the rest split around them —
  // the swiper centres on them so you can swipe either way
  const isMine = (a: ActionDef) => !!(CH[a.type as keyof typeof CH] && owned[a.type]);
  const mine = ACTIONS.filter(isMine);
  const rest = ACTIONS.filter((a) => !isMine(a));
  const half = Math.ceil(rest.length / 2);
  const orderedActions = [...rest.slice(0, half), ...mine, ...rest.slice(half)];

  return (
    <Card id="console" className="console gap-2.5 p-3">
      <div className="console-top">
        <div className="ct-meta">
          <span className="ct-title">{t('game.yourhand')}</span>
          <Coins n={meP.coins} big className="me-coins" />
          <span className="ct-deck"><Icon name="card-recive" className="size-3.5" />{t('game.max', { max: st.maxCoins, deck: st.deckSize })}</span>
        </div>
        {status}
      </div>

      {/* MY CARDS: one card per physical card in your grip (duplicates show twice), so you never
          have to decode a "×2" badge on the board below. Hidden while spectating / eliminated. */}
      {!selfPick && meP.alive && you.cards.length > 0 && (
        /* On a phone this is a drawer parked off the side of the screen: the tab stays in reach and
           the hand only comes out when you pull it, so a full-screen claim never buries it and it
           never eats board height while you are just watching. On wider screens it is a plain
           strip, as before — `open` and the tab do nothing there. */
        <div className={`my-cards ${handOpen ? 'open' : ''}`} ref={handBar}>
          <button type="button" className="mc-tab" aria-expanded={handOpen} aria-controls="my-hand"
            onClick={() => setHandOpen((v) => !v)} aria-label={t('board.mycards')}>
            <Art name="cards" className="mc-tab-art" />
            <span className="mc-tab-n">{you.cards.length}</span>
          </button>
          <div className="mc-head">
            <span className="mc-label"><Icon name="card-recive" className="size-3.5" />{t('board.mycards')}</span>
            {coaching && (
              <button type="button" className="mc-chars" onClick={() => store.set({ modal: 'chars' })}>
                <Art name="cards" className="size-4" />{t('top.chars')}
              </button>
            )}
          </div>
          <div className="hand mc-hand" id="my-hand">
            {you.cards.map((c, i) => (
              <div className="hand-card" key={handKey + ':my:' + i} style={CH[c as keyof typeof CH] ? ({ '--c': CH[c as keyof typeof CH].color } as any) : undefined}>
                <GameCard c={c} w={68} small />
                <span className="hc-name">{i18n.charName(c)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {selfPick ? (
        // Police self-swap: pick which of your real cards to exchange for a fresh one.
        <div className="hand picking">
          <PickBanner text={t('pick.own')} />
          {you.cards.map((c, i) => (
            <div className="hand-card" key={handKey + ':' + i} style={CH[c as keyof typeof CH] ? ({ '--c': CH[c as keyof typeof CH].color } as any) : undefined}>
              <GameCard c={c} w={104} pick onPress={() => sendAction({ type: 'police', targetId: me, slot: i })} />
            </div>
          ))}
        </div>
      ) : (
        <div className="card-board" ref={wrapRef}>
          {/* Tap-to-scroll arrows. The row has always been swipeable, but a swipe is invisible —
              these say so, and give a target for anyone not holding the phone two-handed. Both
              sides always show; data-more dims the one that has nothing left to reach. */}
          <button type="button" className="row-arrow start" aria-label={t('board.scrollPrev')} tabIndex={-1}
            onClick={() => nudgeRow(-1)}><Icon name="alt-arrow-left" className="size-6" /></button>
          <div className="board-grid" ref={boardRef}>{orderedActions.map(card)}</div>
          <button type="button" className="row-arrow end" aria-label={t('board.scrollNext')} tabIndex={-1}
            onClick={() => nudgeRow(1)}><Icon name="alt-arrow-right" className="size-6" /></button>
        </div>
      )}

      {preview && (
        <div className="claim-preview-backdrop" role="dialog" aria-modal="true" onClick={() => setPreview(null)}>
          <div className={`claim-preview ${preview.why ? 'blocked' : ''}`} onClick={(e) => e.stopPropagation()} style={{ ['--c' as any]: CH[preview.a.type as keyof typeof CH]?.color }}>
            <img className="cp-card" src={cardArt(preview.a.type)} alt={actionName(preview.a.type)} draggable={false} />
            <div className="cp-body">
              <h3 className="cp-name">{actionName(preview.a.type)}</h3>
              <p className="cp-desc">{actionDesc(preview.a.type)}</p>
              {preview.a.cost ? <span className="cp-cost">{t('preview.cost', { n: preview.a.cost })}<img src={IMG.coin} alt="" /></span> : null}
              {preview.why && <p className="cp-why"><Icon name="danger-triangle" className="size-4" />{preview.why}</p>}
            </div>
            <div className="cp-actions">
              {preview.why
                ? <Button fullWidth variant="secondary" onPress={() => setPreview(null)}>{t('preview.ok')}</Button>
                : <>
                    <Button variant="tertiary" onPress={() => setPreview(null)}>{t('preview.cancel')}</Button>
                    <Button variant="primary" onPress={() => { const a = preview.a; setPreview(null); pressAction(a.type); }}><Icon name="hand-stars" className="size-4" />{t(preview.a.kind === 'claim' ? 'preview.use' : 'preview.useBasic')}</Button>
                  </>}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
