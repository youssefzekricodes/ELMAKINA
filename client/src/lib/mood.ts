/**
 * Atmosphere, driven by the state of the table rather than by events.
 *
 * The cues in lib/sfx fire on things that HAPPEN. This is the other half: while a claim is sitting
 * on the table waiting to be believed or called, the room holds its breath — an ambient bed comes
 * up, and drops the moment the window resolves. It is the only sound in the game that tells you
 * something is still undecided, which on a phone is often the only way to notice at all.
 */
import { store } from './store';
import { sfx } from './sfx';

let holding = false;

/** True while somebody's claim is open for challenge or counter — the undecided moment. */
function tense(): boolean {
  const s = store.get();
  if (s.screen !== 'game' || !s.state || s.state.phase !== 'playing') return false;
  const w = s.state.pending?.window;
  return !!(w && (w.type === 'reaction' || w.type === 'decision'));
}

export function initMood() {
  store.subscribe(() => {
    const want = tense();
    if (want === holding) return;
    holding = want;
    sfx.mood(want);
    // A short breath in and out either side of the bed, so the change reads as deliberate rather
    // than as the audio glitching.
    sfx.play(want ? 'suspect' : 'hush');
  });
}
