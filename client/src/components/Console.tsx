/* Your control panel — every move is a card. The character cards you actually hold are framed;
   cards you can't play right now are disabled. Your cards stay visible so you never forget your hand. */
import { useEffect, useRef, useState } from 'react';
import { Button, Card, Chip, Tooltip } from '@heroui/react';
import { ACTIONS, ACTION_CARDS, CH, IMG, type ActionDef } from '../theme';
import { i18n, t } from '../i18n';
import { isCoaching, store, useStore } from '../lib/store';
import { notify, sendAction, startAction } from '../lib/net';
import { validTargets } from '../lib/rules';
import { sfx } from '../lib/sfx';
import { Coins, GameCard, Icon, PickBanner, Ring } from './ui';

const pressAction = (type: string) => { sfx.play('lever'); startAction(type); };
const actionName = (type: string) => (CH[type as keyof typeof CH] ? i18n.charName(type) : t(`action.${type}.name`));
const actionDesc = (type: string) => t(`action.${type}.desc`);
const cardArt = (type: string) => (CH[type as keyof typeof CH] ? CH[type as keyof typeof CH].card : ACTION_CARDS[type]);

/** One playable card: art + name + cost. Owned character cards are framed; unplayable ones look disabled
    but stay clickable, so a tap can explain WHY it can't be played (a real `disabled` fires no events). */
function BoardCard({ a, coins, targets, myTurn, owned, blockedNote, onPlay, onBlocked }: {
  a: ActionDef; coins: number; targets: string[] | null; myTurn: boolean; owned: number; blockedNote: string;
  onPlay: (a: ActionDef) => void; onBlocked: (msg: string) => void;
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
        onClick={() => (playable ? onPlay(a) : onBlocked(note))} style={{ '--c': th ? th.color : 'var(--accent)' } as any}>
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
  const [preview, setPreview] = useState<ActionDef | null>(null); // guided mode: show a character's rule before claiming
  const first = useRef(true);
  const boardRef = useRef<HTMLDivElement>(null);
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
  const play = (a: ActionDef) => { if (coaching && a.kind === 'claim') setPreview(a); else pressAction(a.type); };
  // tapping a card you can't play explains itself instead of doing nothing
  const blockedNote = !meP.alive ? t('board.outNote') : st.phase === 'ended' ? t('board.overNote') : t('board.wait');
  const onBlocked = (msg: string) => notify(msg || blockedNote);
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
        <div className="my-cards">
          <div className="mc-head">
            <span className="mc-label"><Icon name="card-recive" className="size-3.5" />{t('board.mycards')}</span>
            {coaching && (
              <button type="button" className="mc-chars" onClick={() => store.set({ modal: 'chars' })}>
                <Icon name="hand-stars" className="size-3.5" />{t('top.chars')}
              </button>
            )}
          </div>
          <div className="hand mc-hand">
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
        <div className="card-board">
          <div className="board-grid" ref={boardRef}>{orderedActions.map(card)}</div>
        </div>
      )}

      {preview && (
        <div className="claim-preview-backdrop" role="dialog" aria-modal="true" onClick={() => setPreview(null)}>
          <div className="claim-preview" onClick={(e) => e.stopPropagation()} style={{ ['--c' as any]: CH[preview.type as keyof typeof CH]?.color }}>
            <GameCard c={preview.type} w={104} />
            <div className="cp-body">
              <h3 className="cp-name">{actionName(preview.type)}</h3>
              <p className="cp-desc">{actionDesc(preview.type)}</p>
              {preview.cost ? <span className="cp-cost">{t('preview.cost', { n: preview.cost })}<img src={IMG.coin} alt="" /></span> : null}
            </div>
            <div className="cp-actions">
              <Button variant="tertiary" onPress={() => setPreview(null)}>{t('preview.cancel')}</Button>
              <Button variant="primary" onPress={() => { const a = preview; setPreview(null); pressAction(a.type); }}><Icon name="hand-stars" className="size-4" />{t('preview.use')}</Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
