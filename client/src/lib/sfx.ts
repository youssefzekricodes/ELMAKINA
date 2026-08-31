/* Game sounds, synthesised in the browser with WebAudio — no files to download, no third-party
   clips, nothing to block the first paint. Every cue is a short shaped tone (or a burst of noise
   for the "thump" ones) so the set stays coherent and tiny.

   The browser will not let audio start before a real gesture, so `unlock()` is called on the first
   pointerdown and everything before that is silently dropped. */

type Wave = OscillatorType;
/** step: [start Hz, end Hz, seconds, wave, gain, delay before it plays] */
type Step = [number, number, number, Wave?, number?, number?];
type Cue = { steps?: Step[]; noise?: [number, number, number?]; gain?: number };

// A cue is a couple of glides at most: enough character to tell the events apart, short enough that
// a fast turn never stacks up into noise.
const CUES: Record<string, Cue> = {
  click:     { steps: [[520, 620, 0.05, 'triangle', 0.5]] },
  lever:     { steps: [[300, 150, 0.09, 'square', 0.35], [640, 880, 0.1, 'triangle', 0.4, 0.05]] },
  deal:      { noise: [0.16, 2400, 0.35] },
  card:      { noise: [0.22, 1500, 0.45], steps: [[420, 190, 0.22, 'sine', 0.3]] },
  coin:      { steps: [[1180, 1560, 0.07, 'triangle', 0.32], [1560, 2100, 0.09, 'triangle', 0.26, 0.06]] },
  turn:      { steps: [[520, 660, 0.11, 'sine', 0.4], [660, 880, 0.16, 'sine', 0.4, 0.1]] },
  alert:     { steps: [[880, 880, 0.09, 'square', 0.3], [1120, 1120, 0.12, 'square', 0.3, 0.11]] },
  heartbeat: { steps: [[150, 92, 0.13, 'sine', 0.55]] },
  stamp:     { noise: [0.1, 900, 0.5], steps: [[220, 90, 0.16, 'square', 0.35]] },
  reveal:    { steps: [[400, 1000, 0.16, 'triangle', 0.34], [1000, 1500, 0.2, 'triangle', 0.24, 0.14]] },
  lose:      { steps: [[420, 120, 0.42, 'sawtooth', 0.4], [300, 80, 0.5, 'sine', 0.3, 0.06]] },
  win:       { steps: [[523, 523, 0.14, 'triangle', 0.4], [659, 659, 0.14, 'triangle', 0.4, 0.13], [784, 784, 0.16, 'triangle', 0.4, 0.26], [1046, 1046, 0.34, 'triangle', 0.42, 0.39]] },
  error:     { steps: [[300, 190, 0.18, 'sawtooth', 0.35]] },
  play:      { noise: [0.12, 1100, 0.4], steps: [[560, 300, 0.14, 'triangle', 0.32]] },   // a card slapped on the table
  block:     { steps: [[300, 300, 0.1, 'square', 0.34], [200, 200, 0.22, 'sine', 0.42, 0.08]] }, // shield thunk
  bluff:     { steps: [[500, 140, 0.3, 'sawtooth', 0.4], [180, 120, 0.3, 'square', 0.25, 0.05]] }, // caught!
  boom:      { noise: [0.34, 220, 0.55], steps: [[160, 46, 0.4, 'sine', 0.5]] },          // 7 coins, one hit
  // ── the mysterious set ──────────────────────────────────────────────────────
  // Low, detuned, unhurried — they sit under the action rather than on it, and are quieter than
  // every cue above. All three fire on a BEAT. There was also a sustained bed that held for as
  // long as a claim was undecided; it was removed because a sound you cannot end by playing well
  // is just noise, and waiting is most of this game.
  whisper:   { noise: [0.4, 700, 0.1] },                                                          // a character card lands: it might be a lie
  tock:      { steps: [[1400, 1150, 0.028, 'square', 0.16], [720, 620, 0.05, 'triangle', 0.1, 0.004]] }, // a clock, once a second, near the end
  thump:     { steps: [[112, 62, 0.13, 'sine', 0.34], [96, 54, 0.15, 'sine', 0.22, 0.15]] },      // lub-dub, while a decision is yours to make
  sting:     { steps: [[440, 440, 0.26, 'sawtooth', 0.17], [622, 622, 0.3, 'sawtooth', 0.15, 0.01]] }, // a tritone: something is wrong
  creak:     { steps: [[130, 58, 0.8, 'sawtooth', 0.14], [65, 39, 0.95, 'sine', 0.18, 0.06]] },   // somebody is out
};

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let on = (() => { try { return localStorage.getItem('mekina.sound') !== 'off'; } catch { return true; } })();
let last: Record<string, number> = {};

function ensure(): AudioContext | null {
  if (ctx) return ctx;
  const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx!.createGain(); master.gain.value = 0.5; master.connect(ctx!.destination);
  const n = ctx!.sampleRate * 0.4; noiseBuf = ctx!.createBuffer(1, n, ctx!.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n); // already decaying: cheap "shuffle"
  return ctx;
}

function tone(c: AudioContext, [f0, f1, dur, wave = 'sine', g = 0.3, delay = 0]: Step) {
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator(); const env = c.createGain();
  osc.type = wave; osc.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(g, t0 + Math.min(0.02, dur / 3));
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(env); env.connect(master!); osc.start(t0); osc.stop(t0 + dur + 0.02);
}

function hiss(c: AudioContext, [dur, cut, g = 0.4]: [number, number, number?]) {
  const t0 = c.currentTime;
  const src = c.createBufferSource(); src.buffer = noiseBuf!;
  const flt = c.createBiquadFilter(); flt.type = 'bandpass'; flt.frequency.value = cut; flt.Q.value = 0.8;
  const env = c.createGain();
  env.gain.setValueAtTime(g, t0); env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(flt); flt.connect(env); env.connect(master!); src.start(t0); src.stop(t0 + dur);
}

/**
 * A channel on the same context, for anything that runs longer than a cue.
 *
 * Cues are fire-and-forget; the lobby bed runs for minutes and needs its own level and its own
 * fade. It hangs off the same master gain, so one mute silences everything.
 */
export function audioChannel(gain: number): { ctx: AudioContext; out: GainNode } | null {
  const c = ensure(); if (!c || !master) return null;
  const g = c.createGain(); g.gain.value = gain; g.connect(master);
  return { ctx: c, out: g };
}

export const sfx = {
  get enabled() { return on; },
  toggle() {
    on = !on;
    try { localStorage.setItem('mekina.sound', on ? 'on' : 'off'); } catch { /* ignore */ }
    if (on) { this.unlock(); this.play('click'); }
    return on;
  },
  /** Called from the first user gesture: browsers refuse to start audio any earlier. */
  unlock() { const c = ensure(); if (c && c.state === 'suspended') c.resume().catch(() => {}); },
  play(name: string) {
    if (!on) return;
    const cue = CUES[name]; if (!cue) return;
    const now = Date.now();
    if (now - (last[name] || 0) < 45) return; // a burst of identical events is one sound, not twelve
    last[name] = now;
    const c = ensure(); if (!c || c.state !== 'running') return;
    try {
      if (cue.noise) hiss(c, cue.noise);
      for (const st of cue.steps || []) tone(c, st);
    } catch { /* a dead audio context must never break the game */ }
  },
};
