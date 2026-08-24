/* Your control panel: hand, coins, status and the action tiles (HeroUI Buttons laid out as tiles). */
import { useEffect, useRef, useState } from 'react';
import { Button, Card, Chip, Tooltip } from '@heroui/react';
import { ACTIONS, CH, IMG, type ActionDef } from '../theme';
import { i18n, t } from '../i18n';
import { useStore } from '../lib/store';
import { sendAction, startAction } from '../lib/net';
import { validTargets } from '../lib/rules';
import { sfx } from '../lib/sfx';
import { Coins, GameCard, Icon, PickBanner, Ring } from './ui';

const pressAction = (type: string) => { sfx.play('lever'); startAction(type); };

const actionName = (type: string) => (CH[type as keyof typeof CH] ? i18n.charName(type) : t(`action.${type}.name`));
const actionDesc = (type: string) => t(`action.${type}.desc`);

function Tile({ a, coins, targets, onPick }: { a: ActionDef; coins: number; targets: string[] | null; onPick?: (a: ActionDef) => void }) {
  const canAfford = coins >= a.cost;
  const ok = canAfford && (!targets || targets.length > 0);
  const why = !canAfford ? t('game.needCoins', { n: a.cost }) : targets && !targets.length ? t('game.noTarget') : '';
  const th = CH[a.type as keyof typeof CH];
  return (
    <Tooltip delay={400}>
      <Button variant="outline" isDisabled={!ok} onPress={() => (onPick ? onPick(a) : pressAction(a.type))} className={`act-tile ${a.kind}`} style={{ '--c': th ? th.color : 'var(--muted)' } as any}>
        {th ? <span className="thumb"><img src={th.cardSm} alt="" /></span> : <span className="thumb icon"><Icon name={a.type} className="size-5" /></span>}
        <span className="txt">
          <span className="t">{actionName(a.type)}</span>
          <span className={`d ${why ? 'blocked' : ''}`}>{why || t(`action.${a.type}.tag`)}</span>
        </span>
        {a.cost ? <Chip size="sm" variant="soft" color={canAfford ? 'warning' : 'danger'} className="cost">{a.cost}<img src={IMG.coin} alt="" /></Chip> : null}
      </Button>
      <Tooltip.Content>{actionDesc(a.type)}</Tooltip.Content>
    </Tooltip>
  );
}

/** Basic (non-claim) actions: safe moves nobody can challenge — shown as bold, icon-forward buttons. */
function BasicTile({ a, coins, targets }: { a: ActionDef; coins: number; targets: string[] | null }) {
  const canAfford = coins >= a.cost;
  const ok = canAfford && (!targets || targets.length > 0);
  const why = !canAfford ? t('game.needCoins', { n: a.cost }) : targets && !targets.length ? t('game.noTarget') : '';
  return (
    <Tooltip delay={400}>
      <Button variant="outline" isDisabled={!ok} onPress={() => pressAction(a.type)} className={`basic-tile ${a.type}`}>
        <span className="bt-ic"><Icon name={a.type} className="size-5" /></span>
        <span className="bt-txt">
          <span className="bt-t">{actionName(a.type)}</span>
          <span className={`bt-d ${why ? 'blocked' : ''}`}>{why || t(`action.${a.type}.tag`)}</span>
        </span>
        {a.cost ? <span className="bt-cost">{a.cost}<img src={IMG.coin} alt="" /></span> : <span className="bt-cost free">{t('actions.free')}</span>}
      </Button>
      <Tooltip.Content>{actionDesc(a.type)}</Tooltip.Content>
    </Tooltip>
  );
}

export function Console() {
  const s = useStore();
  const st = s.state!; const me = s.me;
  const meP = st.players.find((p) => p.id === me); const you = st.you;
  const handKey = JSON.stringify(you?.cards || []);
  const [animKey, setAnimKey] = useState(handKey);
  const [preview, setPreview] = useState<ActionDef | null>(null); // guided mode: show a character's rule before claiming
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } setAnimKey(handKey); sfx.play('deal'); }, [handKey]);
  if (!you || !meP) return <Card id="console" className="console p-4"><div className="status-line">{t('game.spectating')}</div></Card>;
  const myTurn = st.phase === 'playing' && st.pending && st.pending.stage === 'turn' && st.pending.actorId === me && meP.alive;
  const selfPick = !!(s.targeting && s.targeting.type === 'police' && s.targetId === me);
  const ring = st.pending?.stage === 'turn' ? <Ring deadline={st.pending.deadline} total={st.timings.turn} tick={myTurn} /> : null;
  let status: React.ReactNode = null;
  if (st.phase === 'ended') status = <div className="status-line">{t('game.over')}</div>;
  else if (myTurn) status = <div className="status-line"><Chip variant="primary" color="accent">{t('game.yourturn')}</Chip><span>{t('game.choose')}</span>{ring}</div>;
  else if (st.pending && st.pending.stage === 'turn') status = <div className="status-line"><span dangerouslySetInnerHTML={{ __html: i18n.html('game.waitingFor', { name: (st.players.find((p) => p.id === st.pending!.actorId) || {}).name || '?' }) }} />{ring}</div>;
  else if (!meP.alive) status = <div className="status-line">{t('game.eliminated')}</div>;

  return (
    <Card id="console" className="console gap-2.5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">{t('game.yourhand')}</span>
          <Coins n={meP.coins} big className="me-coins" />
          <span className="text-xs text-muted">{t('game.max', { max: st.maxCoins, deck: st.deckSize })}</span>
        </div>
        {status}
      </div>
      <div className="hand-row">
        <div className={`hand ${selfPick ? 'picking' : ''}`}>
          {selfPick && <PickBanner text={t('pick.own')} />}
          {you.cards.length ? you.cards.map((c, i) => (
            <GameCard key={animKey + ':' + i} c={c} w={104} anim={!first.current} pick={selfPick} onPress={selfPick ? () => sendAction({ type: 'police', targetId: me, slot: i }) : undefined} />
          )) : <span className="status-line">{t('game.nocards')}</span>}
        </div>
        {myTurn && (
          <div className="actions">
            <div className="act-group"><div className="act-label"><Icon name="bolt" className="size-3.5" />{t('actions.basic')}</div><div className="basic-row">{ACTIONS.filter((a) => a.kind === 'default').map((a) => <BasicTile key={a.type} a={a} coins={meP.coins} targets={a.target ? validTargets(st, me, a) : null} />)}</div></div>
            <div className="act-group"><div className="act-label"><Icon name="hand-stars" className="size-3.5" />{t('actions.claims')}</div><div className="act-grid claims">{ACTIONS.filter((a) => a.kind === 'claim').map((a) => <Tile key={a.type} a={a} coins={meP.coins} targets={a.target ? validTargets(st, me, a) : null} onPick={s.tour ? setPreview : undefined} />)}</div></div>
          </div>
        )}
      </div>
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
