/**
 * The lobby bed.
 *
 * Waiting for a room to fill is the one stretch of this game where nothing is happening, and
 * silence makes it feel longer than it is. So the lobby hums: a slow darbouka figure, a low drone
 * and a four-note phrase that comes round every couple of bars — quiet enough to talk over, and it
 * stops the moment the game starts.
 *
 * Synthesised, like every other sound here (see lib/sfx): nothing to download, nothing to license,
 * nothing to block the first paint. It is generated from a pattern rather than looped from a file,
 * so it never lands on the same bar twice in a way you can hear.
 *
 * If you would rather play a real recording, point TRACK at a file you have the rights to — the
 * synth bed then never runs. Anything from YouTube needs a licence first; a track being freely
 * playable there does not make it free to ship.
 */
import { audioChannel, sfx } from './sfx';

/** The lobby track. Set to null to fall back to the generated bed below. */
const TRACK: string | null = '/audio/lobby.m4a';
/** Under everything. It is a room tone, not a track you sit and listen to. */
const TRACK_VOL = 0.14;
const FADE_MS = 1400;

const BPM = 90;
const BEAT = 60 / BPM;
const STEP = BEAT / 2;          // eighth notes
const BAR = 8;                  // eighths per bar
const PATTERN = BAR * 2;        // the figure comes round every two bars

/** Hijaz on D — the flattened second and the wide third are the whole character of it. */
const ROOT = 146.83;            // D3
const HIJAZ = [0, 1, 4, 5, 7, 8, 11];
const semis = (n: number) => ROOT * Math.pow(2, n / 12);
const deg = (d: number) => semis(HIJAZ[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7));

/** dum = the low open hit, tak = the rim. The spine of every rhythm in the region. */
const DUM = [0, 3, 8, 11, 14];
const TAK = [2, 4, 6, 10, 12, 13, 15];
/** The phrase, as scale degrees on the eighth-note grid (-1 = rest). */
const PHRASE = [4, -1, 3, -1, 2, -1, 3, 4, -1, -1, 1, -1, 0, -1, -1, -1];

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let timer: any = null;
let step = 0;
let next = 0;
let el: HTMLAudioElement | null = null;
let fade: any = null;
let playing = false;

/** Ramp the element's volume — cutting a track in or out at full level is a slap. */
function fadeTo(target: number, done?: () => void) {
  clearInterval(fade);
  const from = el ? el.volume : 0;
  const t0 = Date.now();
  fade = setInterval(() => {
    if (!el) return clearInterval(fade);
    const k = Math.min(1, (Date.now() - t0) / FADE_MS);
    el.volume = Math.max(0, Math.min(1, from + (target - from) * k));
    if (k === 1) { clearInterval(fade); fade = null; done && done(); }
  }, 40);
}

const LEVEL = 0.5;              // of the master, which is already 0.5

function dum(t: number) {
  const o = ctx!.createOscillator(), g = ctx!.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(128, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.14);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
  o.connect(g); g.connect(out!); o.start(t); o.stop(t + 0.26);
}

function tak(t: number, soft: boolean) {
  const b = ctx!.createBufferSource(), f = ctx!.createBiquadFilter(), g = ctx!.createGain();
  const n = Math.floor(ctx!.sampleRate * 0.06);
  const buf = ctx!.createBuffer(1, n, ctx!.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  b.buffer = buf;
  f.type = 'bandpass'; f.frequency.value = soft ? 1900 : 3200; f.Q.value = 1.1;
  g.gain.setValueAtTime(soft ? 0.12 : 0.2, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  b.connect(f); f.connect(g); g.connect(out!); b.start(t); b.stop(t + 0.07);
}

/** The drone: two saws a hair apart, so it beats slowly against itself. */
function drone(t: number, dur: number) {
  const f = ctx!.createBiquadFilter(), g = ctx!.createGain();
  f.type = 'lowpass'; f.frequency.setValueAtTime(240, t); f.Q.value = 3;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.09, t + dur * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  for (const detune of [-6, 6]) {
    const o = ctx!.createOscillator();
    o.type = 'sawtooth'; o.frequency.value = ROOT / 2; o.detune.value = detune;
    o.connect(f); o.start(t); o.stop(t + dur + 0.05);
  }
  f.connect(g); g.connect(out!);
}

/** The phrase voice: plucked, short, a little nasal — it should sit under the drums, not on top. */
function pluck(t: number, hz: number) {
  const o = ctx!.createOscillator(), f = ctx!.createBiquadFilter(), g = ctx!.createGain();
  o.type = 'triangle'; o.frequency.value = hz;
  f.type = 'bandpass'; f.frequency.value = hz * 2.2; f.Q.value = 1.6;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.13, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
  o.connect(f); f.connect(g); g.connect(out!); o.start(t); o.stop(t + 0.44);
}

/** One eighth note, scheduled ahead of the clock. */
function tick(i: number, t: number) {
  const b = i % BAR;
  if (DUM.includes(i)) dum(t);
  if (TAK.includes(i)) tak(t, b % 2 === 1);
  if (i === 0) drone(t, PATTERN * STEP);
  const p = PHRASE[i % PHRASE.length];
  // The phrase sits out the first pass and answers on the second, so two bars never sound alike.
  if (p >= 0 && i >= BAR) pluck(t, deg(p + 7));
  if (p >= 0 && i < BAR && p % 2 === 0) pluck(t, deg(p));
}

function schedule() {
  if (!ctx || !out) return;
  // A hidden tab throttles setInterval to once a minute while the audio clock keeps running. Without
  // this the catch-up loop would schedule a minute of notes in the past, and Web Audio plays those
  // immediately — a burst of every drum at once the moment you come back to the tab. Fall far enough
  // behind and the figure simply starts again from the top.
  if (next < ctx.currentTime - 0.2) { next = ctx.currentTime + 0.05; step = 0; }
  while (next < ctx.currentTime + 0.35) {
    tick(step % PATTERN, next);
    step++; next += STEP;
  }
}

export const music = {
  get playing() { return playing; },

  /** Start the bed, fading in — safe to call twice, and a no-op while sound is off. */
  start() {
    if (playing || !sfx.enabled) return;
    if (TRACK) {
      el = el || new Audio(TRACK);
      el.loop = true;
      el.volume = 0;                       // faded up by hand: HTMLAudioElement has no gain ramp
      el.play().catch(() => { /* no gesture yet: the lobby is a click away, we try again next time */ });
      fadeTo(TRACK_VOL);
      playing = true;
      return;
    }
    const ch = audioChannel(0.0001);
    if (!ch) return;
    ctx = ch.ctx; out = ch.out;
    // The context may still be suspended if nothing has been tapped yet; resume is harmless.
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    out.gain.exponentialRampToValueAtTime(LEVEL, ctx.currentTime + 2.2);   // fade in over two bars
    step = 0; next = ctx.currentTime + 0.1;
    schedule();
    timer = setInterval(schedule, 120);
    playing = true;
  },

  /** Fade out and stop. Anything already scheduled rides out on the fade. */
  stop() {
    if (!playing) return;
    playing = false;
    if (el) { fadeTo(0, () => { if (el) { el.pause(); el.currentTime = 0; } }); return; }
    clearInterval(timer); timer = null;
    if (ctx && out) {
      const g = out, end = ctx.currentTime + 0.6;
      g.gain.cancelScheduledValues(ctx.currentTime);
      g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      setTimeout(() => { try { g.disconnect(); } catch { /* already gone */ } }, 900);
    }
    ctx = null; out = null;
  },
};
