/* The cut-scene: one beat of the game, told across the whole screen.
   Who moved on whom, with what, and what it cost — then the mask lifts and play resumes. */
import { useEffect } from 'react';
import { needsMe, useStore } from '../lib/store';
import { endCine, yieldCine } from '../lib/fx';
import { clipUrl } from '../lib/assets';
import { i18n, t } from '../i18n';
import { ACTION_CARDS, CH, type CharacterId } from '../theme';
import { Icon, PlayerAvatar } from './ui';

const cardArt = (c?: string | null) => (c && CH[c as CharacterId] ? CH[c as CharacterId].card : null);

/** The card that did the damage: the weapon for an attack, the disputed card for a challenge. */
function artOf(kind: string, reason?: string, character?: string): string | null {
  if (kind === 'caught' || kind === 'missed') return cardArt(character);
  const r = (reason || '').replace(/_timeout$/, '');
  if (r === 'paidkill') return ACTION_CARDS.paidkill;
  if (r === 'terrorist') return CH.terrorist.card;
  if (r === 'colonel_correct' || r === 'wrong_guess') return CH.colonel.card;
  if (r === 'caught_bluffing' || r === 'lost_challenge') return null; // the disputed card belongs to the verdict scene
  return cardArt(character);
}

/** Why the card went: a plain sentence, not the log's shorthand. Falls back to the log wording
    for any reason that has no sentence of its own. */
function whyLine(reason: string): string {
  const base = reason.replace(/_timeout$/, '');
  const key = 'cine.why.' + base;
  const line = t(key);
  return line === key ? i18n.reason(base) : line;
}

/** One face: avatar, name, and — on the loser — what this beat took off them. */
function Face({ p, me, cost }: { p: any; me: string | null; cost?: React.ReactNode }) {
  if (!p) return null;
  return (
    <div className={`cine-face ${p.id === me ? 'is-me' : ''} ${cost ? 'is-loser' : ''}`}>
      <PlayerAvatar p={p} size="lg" />
      <span className="cine-name">{p.name}</span>
      {cost}
    </div>
  );
}

export function Cinematic() {
  const s = useStore();
  const c = s.cine;
  const st = s.state;
  const me = s.me;

  // The mask never costs anyone a turn: the moment the game wants an answer from me, it lifts.
  const myMove = !!c && needsMe(s);
  useEffect(() => { if (myMove) yieldCine(); }, [myMove]);

  if (!c || !st) return null;
  const pl = (id?: string | null) => (id ? st.players.find((p) => p.id === id) : null) || null;
  const actor = pl(c.actorId);
  const target = pl(c.targetId);
  const loser = pl(c.loserId);
  const chName = c.character ? i18n.charName(c.character) : '';
  const art = artOf(c.kind, c.reason, c.character);
  const took = cardArt(c.took);
  const mine = c.loserId === me;

  const lname = loser?.name || '?', tname = target?.name || '?', aname = actor?.name || '?';
  const eyebrow = c.guess ? t('cine.guess')
    : c.kind === 'caught' ? t('cine.caught') : c.kind === 'missed' ? t('cine.missed')
    : c.reason ? i18n.reason(c.reason.replace(/_timeout$/, '')) : t('cine.attack');
  // A Colonel naming a card is the mirror image of a challenge: the guesser is the one on trial,
  // and getting it wrong costs coins rather than a card. Saying "X was telling the truth" there
  // would be backwards — the target is precisely the person who did NOT hold the named card.
  const guessLine = c.guess && !c.lost && !c.out;
  // The cost leads when there is one; a beat whose bill has not landed yet still gets a verdict.
  const verdict = c.out ? t(mine ? 'cine.outMe' : 'cine.out', { name: lname })
    : c.lost > 1 ? t(mine ? 'cine.hitMeN' : 'cine.hitN', { name: lname, n: c.lost })
    : c.lost === 1 ? t(mine ? 'cine.hitMe' : 'cine.hit', { name: lname })
    : guessLine ? t(c.kind === 'caught' ? 'cine.guessRight' : 'cine.guessWrong', { name: aname })
    : c.kind === 'missed' ? t('cine.missedV', { name: tname })
    : t('cine.caughtV', { name: tname });
  // The sub-line always answers why: the lie that was exposed, the card that was named, or the weapon.
  const sub = c.guess && c.character ? t(c.kind === 'caught' ? 'cine.guessRightSub' : 'cine.guessWrongSub', { name: tname, character: chName })
    : c.kind === 'caught' && c.character ? t('cine.bluffSub', { name: tname, character: chName })
    : c.kind === 'missed' && c.character ? t('cine.trueSub', { name: tname, character: chName })
    : c.reason ? whyLine(c.reason)
    : null;
  const cost = c.out ? <span className="cine-cost out">{t('seat.eliminated')}</span>
    : c.lost > 0 ? <span className="cine-cost">{c.lost > 1 ? t('cine.cost', { n: c.lost }) : t('cine.cost1')}</span>
    : null;

  // The accuser sits on the left of a challenge, the attacker on the left of an attack — the
  // reading order is always "this player did that to this one", whichever way the cost landed.
  // A timed-out hit or a player walking out has no aggressor, so the duel collapses to one face
  // rather than pointing an arrow at nobody.
  const solo = !actor || actor.id === c.targetId;
  // A death gets its clip as the hero of the scene; the faces and the verdict move under it. The
  // clip is only ever decoration — if it has not been cached yet the scene plays without it rather
  // than waiting on a 3MB download in the middle of a hand.
  const clip = clipUrl(c.clip);
  return (
    <div key={c.id} dir={i18n.dir()} className={`cine k-${c.kind} ${c.out ? 'is-out' : ''} ${clip ? 'has-clip' : ''}`} onClick={endCine} role="presentation">
      <div className="cine-rip" aria-hidden="true" />
      <div className="cine-body">
        <span className="cine-eyebrow">{eyebrow}</span>
        {clip && (
          <div className="cine-clip">
            <img src={clip} alt="" />
            {art && <img className="cine-clip-card" src={art} alt="" />}
            {took && <img className="cine-clip-card took" src={took} alt="" />}
          </div>
        )}
        {/* The story half: who, what happened, why. A wrapper so landscape can put it beside the
            clip instead of under it — there is no vertical room for a stack at 390px tall. */}
        <div className="cine-story">
        <div className={`cine-duel ${solo ? 'solo' : ''}`}>
          {!solo && <Face p={actor} me={me} cost={actor!.id === c.loserId ? cost : undefined} />}
          <div className="cine-vs">
            {/* The evidence: what was used, and — when the table already knows it — what it took.
                A correct Colonel call is the only loss where both halves are public. */}
            {!clip && (
              <div className="cine-evidence">
                {art ? <img className="cine-art" src={art} alt="" /> : !took && <Icon name="bolt" className="size-8" />}
                {took && <img className="cine-art took" src={took} alt="" />}
              </div>
            )}
            {!solo && <Icon name={i18n.dir() === 'rtl' ? 'alt-arrow-left' : 'alt-arrow-right'} className="cine-arrow size-6" />}
          </div>
          <Face p={target} me={me} cost={target && target.id === c.loserId ? cost : undefined} />
        </div>
        <h2 className="cine-verdict">{verdict}</h2>
        {sub && <p className="cine-sub">{sub}</p>}
        </div>
        <span className="cine-skip">{t('cine.skip')}</span>
      </div>
    </div>
  );
}
