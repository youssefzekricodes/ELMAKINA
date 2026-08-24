/* The bottom prompt card: targeting, reaction window, result recap, decisions, game over. */
import { useEffect, useRef, useState } from 'react';
import { Button, Card, Chip } from '@heroui/react';
import { CH, CHARACTERS } from '../theme';
import { i18n, t } from '../i18n';
import { useStore, type LogEntry } from '../lib/store';
import { block, cancelTargeting, challenge, challengeTarget, decide, newGame, pass, sendAction } from '../lib/net';
import { sfx } from '../lib/sfx';
import { GameCard, Html, Icon, PickBanner, PlayerAvatar, Ring, TimerBar } from './ui';
import { logCharacter } from './LogPanel';

const logIcon = (e: LogEntry) => (e.key === 'game.win' ? 'win' : e.kind);

function Timeline({ limit }: { limit: number }) {
  const s = useStore(); const st = s.state!;
  const from = (st.pending && st.pending.logStart) || 0;
  const items = st.log.filter((e) => e.id > from && e.kind !== 'system').slice(-limit);
  if (!items.length) return null;
  return (
    <ol className="timeline scrollbar-thin">
      {items.map((e) => {
        const ch = logCharacter(e);
        return (
          <li key={e.id} className={`tl k-${e.kind}`}>
            {ch
              ? <span className="log-card" title={i18n.charName(ch)}><img src={CH[ch].cardSm} alt={i18n.charName(ch)} /></span>
              : <span className="ic"><Icon name={logIcon(e)} className="size-4" /></span>}
            <span className="tx">{i18n.logText(e)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function KeyBtn({ variant, onPress, main, sub, icon, disabled = false, className = '' }: { variant: any; onPress: () => void; main: string; sub?: string; icon?: string; disabled?: boolean; className?: string }) {
  return (
    <Button variant={variant} size="lg" isDisabled={disabled} onPress={onPress} className={`key ${className}`}>
      {icon && <Icon name={icon} className="size-5 shrink-0" />}
      <span className="k-text"><span className="k-main">{main}</span>{sub && <span className="k-sub">{sub}</span>}</span>
    </Button>
  );
}

export function Prompt() {
  const s = useStore();
  const st = s.state!; const me = s.me; const room = s.room;
  const pname = (id?: string | null) => (st.players.find((p) => p.id === id) || {}).name || '?';
  const pl = (id?: string | null) => st.players.find((p) => p.id === id);
  const cname = i18n.charName;
  const meP = pl(me);
  const p = st.pending, w = p && p.window;

  let body: React.ReactNode = null, head: React.ReactNode = null, urgent = false, key = '';

  if (st.phase === 'ended') {
    const isHost = room && room.hostId === me;
    key = 'end';
    head = <Chip variant="primary" color="accent">{t('end.strip')}</Chip>;
    body = (
      <div className="winner">
        <span className="win-kicker">{t('end.winner')}</span>
        <div className="win-av-wrap">
          <span className="win-crown"><Icon name="win" className="size-7" /></span>
          {st.winnerId && <PlayerAvatar p={pl(st.winnerId)} size="lg" className="win-av" />}
        </div>
        <h2>{st.winnerId ? pname(st.winnerId) : t('end.nobody')}</h2>
        <p className="p-sub">{st.winnerId === me ? t('end.you') : t('end.them')}</p>
        <ul className="standings">
          {st.players.map((pp) => (
            <li key={pp.id} className={pp.id === st.winnerId ? 'is-win' : 'is-out'}>
              <PlayerAvatar p={pp} size="xs" />
              <span className="st-name">{pp.name}{pp.id === me && <span className="st-you">{t('game.you')}</span>}</span>
              <span className="st-tag">{pp.id === st.winnerId ? t('end.champ') : t('seat.eliminated')}</span>
            </li>
          ))}
        </ul>
        {isHost ? <Button size="lg" variant="primary" onPress={newGame}><Icon name="restart" className="size-5" />{t('end.new')}</Button> : <div className="p-waiting">{t('end.wait')}</div>}
      </div>
    );
  } else if (s.targeting) {
    const a = s.targeting; key = 'target';
    head = <><span className="strip-note">{t('prompt.target.strip', { name: CH[a.type as keyof typeof CH] ? cname(a.type) : t(`action.${a.type}.name`) })}</span><Button size="sm" variant="tertiary" onPress={cancelTargeting}>{t('prompt.cancel')}</Button></>;
    if (a.type === 'police') {
      body = <><PickBanner text={s.targetId ? (s.targetId === me ? t('pick.own') : t('pick.slot', { name: pname(s.targetId) })) : t('pick.player')} /><Html as="div" className="p-sub" html={s.targetId ? i18n.html('prompt.target.police.slot', { owner: s.targetId === me ? t('prompt.owner.you') : t('prompt.owner.of', { name: pname(s.targetId) }) }) : t('prompt.target.police.pick')} /></>;
    } else if (a.type === 'colonel' && s.targetId) {
      body = <><Html as="div" className="p-sub" html={i18n.html('prompt.target.colonel', { name: pname(s.targetId) })} /><PickBanner text={t('pick.guess')} />
        <div className="p-cards picking">{CHARACTERS.map((c) => <GameCard key={c} c={c} w={72} small pick onPress={() => sendAction({ type: 'colonel', targetId: s.targetId, guess: c })} />)}</div></>;
    } else body = <><PickBanner text={t('pick.player')} /><div className="p-sub">{t('prompt.target.tap')}</div></>;
  } else if (w && w.type === 'reaction' && w.bwMulti) {
    // Business Woman calls the bluff on the skimming Tax Men — all shown at once, each independently.
    const canAct = !!(meP && meP.alive && w.eligible.includes(me) && !w.passed.includes(me));
    urgent = canAct; key = 'bwmulti' + w.deadline;
    head = <><span className="strip-note">{t('prompt.bw.head')}</span><Ring deadline={w.deadline} total={st.timings.challenge} tick={canAct} /></>;
    body = (
      <div className="react-stack">
        {(w.targets || []).map((tg: { id: string; character: string }) => (
          <div className="claim-card" key={tg.id} style={{ ['--c' as any]: CH[tg.character as keyof typeof CH]?.color }}>
            <TimerBar deadline={w.deadline} total={st.timings.challenge} />
            <div className="cl-head">
              <div className="cl-card"><GameCard c={tg.character} w={60} small /></div>
              <div className="cl-txt">
                <div className="cl-who"><PlayerAvatar p={pl(tg.id)} size="xs" /><Html as="span" html={i18n.html('prompt.bw.claimer', { name: pname(tg.id) })} /></div>
              </div>
            </div>
            {canAct && tg.id !== me && <div className="cl-btns"><button type="button" className="rx call" onClick={() => challengeTarget(tg.id)}><Icon name="danger-triangle" className="size-5" /><span>{t('prompt.bluff.btn')}</span></button></div>}
          </div>
        ))}
        {canAct ? <button type="button" className="rx keep" onClick={pass}><Icon name="check-circle" className="size-5" /><span>{t('prompt.bw.keep')}</span></button>
          : <div className="p-waiting">{t('prompt.waiting.others')}</div>}
      </div>
    );
  } else if (w && w.type === 'reaction') {
    const actor = pname(p!.actorId);
    const canChallenge = !!(meP && meP.alive && w.claim && w.challengeEligible.includes(me) && !w.passed.includes(me));
    const canBlock = !!(meP && meP.alive && w.block && w.blockEligible.includes(me) && !w.passed.includes(me));
    const canPass = !!(meP && meP.alive && w.eligible.includes(me) && !w.passed.includes(me));
    urgent = canChallenge || canBlock;
    key = 'react' + w.deadline;
    let title = '', cardC: string | null = null;
    if (w.claim) {
      const c = w.claim; cardC = c.character;
      title = i18n.html('prompt.claims', { name: pname(c.claimerId), character: cname(c.character) });
    } else if (w.block && w.block.kind === 'veto') { title = i18n.html('prompt.loan.title', { name: actor }); }
    else if (w.block && w.block.kind === 'tax') { cardC = 'businesswoman'; title = i18n.html('prompt.bw.title', { name: actor }); }
    else { cardC = p!.action.character; title = i18n.html('prompt.proven.title', { name: actor, character: cname(p!.action.character) }); }
    const blockLabel = w.block ? (w.block.kind === 'veto' ? t('prompt.block.veto') : w.block.kind === 'tax' ? t('prompt.block.tax') : t('prompt.block.block', { character: cname(w.block.character) })) : '';
    const blockDesc = w.block ? (w.block.kind === 'veto' ? t('prompt.vetoDesc') : w.block.kind === 'tax' ? t('prompt.taxDesc') : t('prompt.blockDesc', { character: cname(w.block.character) })) : '';
    let effect = '';
    const tgt = p!.action && p!.action.targetId ? pname(p!.action.targetId) : '';
    if (w.claim && w.claim.kind === 'action') effect = t('effect.' + p!.action.type, { name: actor, target: tgt });
    else if (w.claim && w.claim.kind === 'block') effect = t('effect.block');
    else if (w.claim && w.claim.kind === 'veto') effect = t('effect.veto');
    else if (w.claim && w.claim.kind === 'tax') effect = t('effect.tax');
    else if (w.block && w.block.kind === 'veto') effect = t('effect.veto');
    else if (w.block) effect = t('effect.' + (p!.action.type || 'block'), { name: actor, target: tgt });
    const total = w.claim ? st.timings.challenge : st.timings.block;
    head = <><span className="strip-note">{t('steps.react')}</span><Ring deadline={w.deadline} total={total} tick={urgent} /></>;
    // The claim on trial: a spotlit card, who's claiming what, its effect, and the three verdicts.
    body = (
      <div className="react-stack">
        <div className={`claim-card ${urgent ? 'urgent' : ''}`} style={cardC ? { ['--c' as any]: CH[cardC as keyof typeof CH]?.color } : undefined}>
          <TimerBar deadline={w.deadline} total={total} />
          <div className="cl-head">
            {cardC && <div className="cl-card"><GameCard c={cardC} w={66} small /></div>}
            <div className="cl-txt">
              <div className="cl-who"><PlayerAvatar p={pl(w.claim ? w.claim.claimerId : p!.actorId)} size="xs" /><Html as="span" html={title} /></div>
              {effect && <div className="cl-effect"><Icon name="alt-arrow-right" className="size-3.5" /><Html html={boldNames(effect, [actor, tgt])} /></div>}
            </div>
          </div>
          {canPass || canBlock || canChallenge ? (
            <div className="cl-btns">
              {canPass && <button type="button" className="rx pass" onClick={pass}><Icon name="check-circle" className="size-5" /><span>{canBlock || canChallenge ? t('prompt.pass') : t('prompt.ok')}</span></button>}
              {canBlock && <button type="button" className="rx block" onClick={block} title={blockDesc}><Icon name="shield-warning" className="size-5" /><span>{blockLabel}</span></button>}
              {w.claim && <button type="button" className="rx call" disabled={!canChallenge} onClick={challenge}><Icon name="danger-triangle" className="size-5" /><span>{t('prompt.bluff.btn')}</span></button>}
            </div>
          ) : (
            <div className="p-waiting">{w.claim && w.claim.claimerId === me ? t('prompt.waiting.mine') : t('prompt.waiting.others')} {t('prompt.passed', { n: w.passed.length, total: w.eligible.length })}</div>
          )}
        </div>
      </div>
    );
  } else if (w && w.type === 'result') {
    key = 'res' + w.deadline; const d = w.data || {};
    head = <><span className="strip-note">{t('steps.result')}</span><Ring deadline={w.deadline} total={w.kind === 'turn_end' ? st.timings.turnPause : st.timings.resultPause} /></>;
    body = (
      <>
        <div className="result-head">
          <span className={`result-ic ${w.kind === 'challenge' ? (d.result === 'true' ? 'ok' : 'bad') : ''}`}>
            <Icon name={w.kind === 'turn_end' ? 'restart' : w.kind === 'challenge' ? (d.result === 'true' ? 'reveal' : 'danger-triangle') : 'info-circle'} className="size-5" />
          </span>
          <span className="result-title">{w.kind === 'turn_end' ? t('result.turnEnd') : t('result.title')}</span>
        </div>
        {w.kind === 'challenge' && d.result && (
          <div className={`verdict-strip ${d.result === 'true' ? 'ok' : 'bad'}`}>
            <span className="vstamp">{d.result === 'true' ? t('stamp.true') : t('stamp.bluff')}</span>
            <Html className="vtext" html={boldNames(d.result === 'true' ? t('result.true', { claimer: pname(d.claimerId), character: cname(d.character), challenger: pname(d.challengerId) }) : t('result.bluff', { claimer: pname(d.claimerId), character: cname(d.character) }), [pname(d.claimerId), pname(d.challengerId), cname(d.character)])} />
          </div>
        )}
        <Timeline limit={8} />
        {w.kind === 'turn_end' && <div className="p-waiting">{t('result.next')}</div>}
      </>
    );
  } else if (w && w.type === 'decision') {
    key = 'dec' + w.deadline + w.playerId + (w.data ? 1 : 0);
    if (w.playerId === me && w.data) {
      urgent = true;
      if (w.kind === 'lose_card') {
        head = <><Chip variant="primary" color="danger">{t('decision.hit', { reason: i18n.reason(w.data.reason) })}</Chip><Ring deadline={w.deadline} total={st.timings.decision} tick /></>;
        body = <>
          <div className="p-sub">{t('decision.choose')}</div>
          <PickBanner text={t('pick.lose')} danger />
          <div className="p-cards picking">{(st.you?.cards || []).map((c, i) => <GameCard key={i} c={c} w={104} small pick onPress={() => decide({ index: i })} />)}</div>
          {w.data.canPay && <div className="p-actions"><KeyBtn variant="primary" icon="wallet-money" onPress={() => decide({ pay: true })} main={t('decision.pay', { n: w.data.payCost })} /></div>}
        </>;
      } else if (w.kind === 'police') {
        const owner = w.data.targetId === me ? t('prompt.owner.you') : t('prompt.owner.of', { name: pname(w.data.targetId) });
        head = <><Chip variant="primary" color="accent">{t('decision.police.strip')}</Chip><Ring deadline={w.deadline} total={st.timings.decision} tick /></>;
        body = <>
          <div className="p-main">
            <Peek character={w.data.card} />
            <div><Html as="div" className="p-title" html={i18n.html('decision.police.title', { owner, n: w.data.slot + 1, character: cname(w.data.card) })} /><div className="p-sub">{t('decision.police.sub')}</div></div>
          </div>
          <div className="p-actions"><KeyBtn variant="secondary" onPress={() => decide({ swap: false })} main={t('decision.keep')} /><KeyBtn variant="primary" icon="refresh-circle" onPress={() => decide({ swap: true })} main={t('decision.swap')} /></div>
        </>;
      }
    } else {
      head = <><Chip variant="soft">{t('decision.waiting.strip')}</Chip><Ring deadline={w.deadline} total={st.timings.decision} /></>;
      body = <div className="p-title">{t(w.kind === 'police' ? 'decision.waiting.police' : 'decision.waiting.lose', { name: pname(w.playerId) })}</div>;
    }
  }

  // urgent sound once per prompt
  const lastKey = useRef('');
  useEffect(() => { if (key && key !== lastKey.current) { lastKey.current = key; if (urgent) sfx.play('alert'); } });
  if (!body) return null;
  return (
    <Card className={`prompt shadow-overlay ${urgent ? 'urgent' : ''}`} key={key}>
      {head && <div className="p-strip">{head}</div>}
      <div className="p-body">{body}</div>
    </Card>
  );
}

function Peek({ character }: { character: string }) {
  const [flipped, setFlipped] = useState(false);
  useEffect(() => { const id = setTimeout(() => setFlipped(true), 150); return () => clearTimeout(id); }, []);
  return (
    <div className={`gcard flip ${flipped ? 'flipped' : ''}`} style={{ width: 96 }}>
      <div className="inner"><div className="face back" /><div className="face front"><img src={CH[character as keyof typeof CH].card} alt="" /></div></div>
    </div>
  );
}

const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
/** Escape a sentence and wrap the given player names in <b>. */
function boldNames(text: string, names: string[]) {
  let html = escHtml(text);
  for (const n of names) { if (!n) continue; const e = escHtml(n); html = html.split(e).join(`<b>${e}</b>`); }
  return html;
}
