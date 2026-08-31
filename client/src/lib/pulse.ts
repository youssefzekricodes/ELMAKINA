/**
 * The clock you can hear.
 *
 * Two sounds, both tied to a real deadline rather than to a mood: a heartbeat while a window is
 * waiting on YOU, and a clock tick over the last few seconds of it. Neither plays for a window
 * somebody else has to answer — a sound you cannot act on is just noise, which is what the
 * ambient bed that used to live here turned out to be.
 *
 * The heartbeat quickens as the deadline closes, so the pressure is information and not decoration.
 */
import { store, needsMe } from './store';
import { now } from './net';
import { sfx } from './sfx';

const TICK_FROM_MS = 4000;   // the clock starts being audible this close to the end
const BEAT_SLOW = 1150;      // heartbeat interval with plenty of time left…
const BEAT_FAST = 620;       // …and once it is nearly up

let timer: any = null;
let nextBeat = 0;
let lastTock = -1;

function stop() { clearInterval(timer); timer = null; nextBeat = 0; lastTock = -1; }

function frame() {
  const s = store.get();
  const w = s.state?.pending?.window;
  const deadline = w?.deadline ?? s.state?.pending?.deadline;
  if (!needsMe(s) || !deadline) return stop();
  const left = deadline - now();
  if (left <= 0) return stop();

  // the clock: exactly once per second, counting down
  if (left <= TICK_FROM_MS) {
    const sec = Math.ceil(left / 1000);
    if (sec !== lastTock) { lastTock = sec; sfx.play('tock'); }
  }
  // the heartbeat: faster as the deadline closes
  const t = Date.now();
  if (t >= nextBeat) {
    if (nextBeat) sfx.play('thump');            // skip the very first frame: the window just opened
    const ratio = Math.max(0, Math.min(1, left / 8000));
    nextBeat = t + (BEAT_FAST + (BEAT_SLOW - BEAT_FAST) * ratio);
  }
}

export function initPulse() {
  store.subscribe(() => {
    const s = store.get();
    const w = s.state?.pending?.window;
    const live = !!(needsMe(s) && (w?.deadline || s.state?.pending?.deadline));
    if (live && !timer) { nextBeat = Date.now(); lastTock = -1; timer = setInterval(frame, 90); }
    else if (!live && timer) stop();
  });
}
