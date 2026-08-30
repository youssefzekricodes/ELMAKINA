/* The table: stadium felt with deck + bank in the middle, opponents around it, you at the bottom. */
import { CH, IMG, type CharacterId } from '../theme';
import { i18n, t } from '../i18n';
import { useStore, type GPlayer } from '../lib/store';
import { tapTarget } from '../lib/net';
import { CardBack, Coins, Icon, PlayerAvatar, SoundWaves } from './ui';
import { validTargets } from '../lib/rules';
import { useVoice, speakingOf, inCall } from '../lib/voice';

const SEAT_ANGLES: Record<number, number[]> = { 1: [-90], 2: [-142, -38], 3: [-158, -90, -22], 4: [-164, -118, -62, -16], 5: [-168, -128, -90, -52, -12] };

/** The character card a player is currently claiming/using (shown over their avatar), or null. */
function claimedChar(p: GPlayer, st: any): CharacterId | null {
  const w = st.pending && st.pending.window;
  if (w && w.type === 'reaction') {
    if (w.claim && w.claim.claimerId === p.id) return w.claim.character as CharacterId;
    if (Array.isArray(w.taxers) && w.taxers.includes(p.id)) return 'taxman';
    if (Array.isArray(w.targets) && w.targets.some((t: { id: string }) => t.id === p.id)) return 'taxman';
  }
  const pend = st.pending;
  if (pend && pend.actorId === p.id && pend.stage === 'resolving' && pend.action && pend.action.character && CH[pend.action.character as CharacterId]) return pend.action.character as CharacterId;
  return null;
}

/** A persistent status pill pinned over a player's avatar (claim / deciding / playing / passed / …), or null. */
function seatStatus(p: GPlayer, s: ReturnType<typeof useStore>): { icon: string; label: string; cls: string } | null {
  const st = s.state!; const w = st.pending?.window;
  if (!p.alive) return { icon: 'eliminated', label: t('seat.eliminated'), cls: 'out' };
  if (w && w.type === 'reaction') {
    if (w.claim && w.claim.claimerId === p.id) return { icon: 'hand-stars', label: i18n.charName(w.claim.character), cls: 'claim' };
    if (Array.isArray(w.taxers) && w.taxers.includes(p.id)) return { icon: 'hand-stars', label: i18n.charName('taxman'), cls: 'claim' };
    if (w.passed.includes(p.id)) return { icon: 'check-circle', label: t('seat.passed'), cls: 'passed' };
    if (w.eligible.includes(p.id)) return { icon: 'hourglass', label: t('seat.deciding'), cls: 'deciding' };
  } else if (w && w.type === 'decision' && w.playerId === p.id) return { icon: 'hourglass', label: t('seat.deciding'), cls: 'deciding' };
  const isTurn = st.turnPlayerId === p.id && st.phase === 'playing';
  if (isTurn && st.pending && st.pending.stage === 'turn') return { icon: 'bolt', label: p.id === s.me ? t('seat.yourTurn') : t('seat.theirTurn'), cls: 'playing' };
  if (st.pending && st.pending.actorId === p.id && st.pending.stage === 'resolving') return { icon: 'bolt', label: t('seat.acting'), cls: 'playing' };
  if (!p.connected) return { icon: 'cpu-bolt', label: t('seat.left'), cls: 'auto' };
  return null;
}

/** The overlay pill markup, shared by opponents and "me". */
function StatusPill({ p, s }: { p: GPlayer; s: ReturnType<typeof useStore> }) {
  const info = seatStatus(p, s);
  if (!info) return null;
  return <span className={`seat-status ${info.cls}`}><Icon name={info.icon} className="size-3" /><span className="ss-tx">{info.label}</span></span>;
}

export function Table() {
  const s = useStore();
  const v = useVoice(); void v; // subscribe so speaking rings update live
  const st = s.state!; const me = s.me;
  // `st.players` is turn order, so rotating it to start just after YOU makes the row read
  // "next, then next, then next" instead of starting at whoever happens to be first in the array.
  // Same rotation feeds SEAT_ANGLES, so the desktop arc becomes clockwise turn order too.
  const mine = st.players.findIndex((p) => p.id === me);
  const ordered = mine < 0 ? st.players : st.players.slice(mine + 1).concat(st.players.slice(0, mine));
  const opponents = ordered.filter((p) => p.id !== me);
  // No "up next" marker: the seats are already laid out clockwise in turn order, so who follows is
  // read off the ring itself. A badge on top of that was one more thing competing for attention.
  const angles = SEAT_ANGLES[opponents.length] || SEAT_ANGLES[5];
  const targets = s.targeting ? validTargets(st, me, s.targeting) : null;
  const meP = st.players.find((p) => p.id === me);
  const isMyTurn = st.turnPlayerId === me && st.phase === 'playing';

  const onSeat = tapTarget; // shared with the prompt's chip picker (see Prompt.tsx)

  return (
    <div className="table-area" id="table">
      {/* An open arena, not a table: deck and bank float at the centre of a soft pool of light and
          the players ring it. No slab, no border, no watermark — the cards are the furniture. */}
      <div className="arena">
        <div className="deck" id="deck"><div className="cardback lg" /><div className="cardback lg" /><div className="cardback lg" /><span className="deck-n">{st.deckSize}</span></div>
        <div className="bank" id="bank">
          <div className="pile">{[0, 1, 2, 3, 4, 5].map((i) => <img key={i} src={IMG.coin} alt="" />)}</div>
          <span className="bank-lbl">{t('game.bank')}</span>
        </div>
      </div>
      {/* data-n = how many opponents are on screen: phones use it to keep every seat on ONE row (3/4/5 across). */}
      <div className={`seats ${s.targeting ? 'targeting' : ''}`} data-n={opponents.length + 1}>
        {opponents.map((p, i) => {
          const a = ((angles[i] !== undefined ? angles[i] : -90) * Math.PI) / 180;
          const isTurn = st.turnPlayerId === p.id && st.phase === 'playing';
          const targetable = !!(targets && targets.includes(p.id));
          const pickSlots = !!(s.targeting && s.targeting.type === 'police' && s.targetId === p.id);
          const rw = st.pending && st.pending.window && st.pending.window.type === 'reaction' ? st.pending.window : null;
          const isClaimer = !!(rw && rw.claim && rw.claim.claimerId === p.id);
          const claimCh = claimedChar(p, st);
          const cls = ['seat', isTurn ? 'turn' : '', !p.alive ? 'dead' : '', !p.connected && p.alive ? 'offline' : '', targetable ? 'targetable' : '', s.targetId === p.id ? 'selected' : '', pickSlots ? 'picking' : '', isClaimer ? 'claimer' : ''].join(' ');
          return (
            <div key={p.id} className={cls} data-seat={p.id} onClick={() => onSeat(p.id)} role={targetable ? 'button' : undefined}
              style={{
                left: `clamp(var(--seat-inset, 80px), ${50 + 40 * Math.cos(a)}%, calc(100% - var(--seat-inset, 80px)))`,
                top: `clamp(var(--seat-vinset, 100px), ${52 + 33 * Math.sin(a)}%, calc(100% - var(--seat-vinset, 100px)))`,
              }}>
              {targetable && !pickSlots && <span className="target-tap"><Icon name="cursor" className="size-3" />{t('pick.tap')}</span>}
              <div className={`av-wrap ${inCall(p.id) ? 'in-call' : ''} ${speakingOf(p.id) ? 'speaking' : ''}`}>
                {claimCh && <span className="claim-badge" style={{ ['--c' as any]: CH[claimCh].color }} title={i18n.charName(claimCh)}><img src={CH[claimCh].cardSm} alt={i18n.charName(claimCh)} /></span>}
                <PlayerAvatar p={p} size="md" />
                <span className={`lamp ${p.connected ? 'on' : 'off'}`} />
                {inCall(p.id) && (p.id in v.peers && v.peers[p.id].muted
                  ? <span className="mic-tag muted"><Icon name="microphone-off" className="size-3" /></span>
                  : speakingOf(p.id) ? <SoundWaves className="wave-tag" /> : <span className="mic-tag"><Icon name="microphone" className="size-3" /></span>)}
                <StatusPill p={p} s={s} />
              </div>
              <div className="nm">{p.name}{p.isBot && <span className="bot-chip">{t('seat.bot')}</span>}</div>
              <Coins n={p.coins} />
              {/* a fan, so a hand reads as cards at a glance — --k centres the spread on any count */}
              <div className={`hand fan n${p.cardCount}`}>
                {Array.from({ length: p.cardCount }, (_, k) => {
                  const spread = { ['--k' as any]: k - (p.cardCount - 1) / 2 };
                  return pickSlots
                    ? <CardBack key={k} className="pick" label={String(k + 1)} onPress={() => onSeat(p.id, k)} style={spread} />
                    : <CardBack key={k} style={spread} />;
                })}
              </div>
              {pickSlots && <div className="pick-arrow"><Icon name="cursor" className="size-3.5" />{t('pick.card')}</div>}
            </div>
          );
        })}
        {/* You sit in the ring with everyone else. Kept out of it, your own seat was hidden entirely
            on phones, so the one player you most need to track had no seat at all. */}
        {meP && (
        <div className={`seat me ${isMyTurn ? 'turn' : ''} ${!meP.alive ? 'dead' : ''}`} data-seat={me || ''}>
          <div className={`av-wrap ${inCall(me || '') ? 'in-call' : ''} ${speakingOf(me || '') ? 'speaking' : ''}`}>
            {claimedChar(meP, st) && <span className="claim-badge" style={{ ['--c' as any]: CH[claimedChar(meP, st)!].color }}><img src={CH[claimedChar(meP, st)!].cardSm} alt="" /></span>}
            <PlayerAvatar p={meP} size="md" />
            {inCall(me || '') && (v.muted
              ? <span className="mic-tag muted"><Icon name="microphone-off" className="size-3" /></span>
              : speakingOf(me || '') ? <SoundWaves className="wave-tag" /> : <span className="mic-tag"><Icon name="microphone" className="size-3" /></span>)}
            <StatusPill p={meP} s={s} />
          </div>
          <div className="nm">{meP.name} <span className="you-chip">{t('game.you')}</span></div>
          <Coins n={meP.coins} />
        </div>
        )}
      </div>
      {s.banner && <div key={s.banner.id} className={`banner ${s.banner.cls || ''}`} role="status" aria-live="polite">{s.banner.text}</div>}
    </div>
  );
}
