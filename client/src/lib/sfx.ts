/* Synthesized sound effects (WebAudio, no files). */
const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let ctx: AudioContext | null = null;
let enabled = typeof localStorage !== 'undefined' && localStorage.getItem('mekina.sound') !== 'off';

const ensure = () => {
  if (!ctx) { try { ctx = new (window.AudioContext || (window as any).webkitAudioContext)(); } catch { return null; } }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
};
const tone = (f: number, dur: number, type: OscillatorType = 'sine', gain = 0.12, t0 = 0, slide = 0) => {
  const c = ensure(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f, c.currentTime + t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, c.currentTime + t0 + dur);
  g.gain.setValueAtTime(0, c.currentTime + t0); g.gain.linearRampToValueAtTime(gain, c.currentTime + t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + t0 + dur);
  o.connect(g).connect(c.destination); o.start(c.currentTime + t0); o.stop(c.currentTime + t0 + dur + 0.05);
};
const noise = (dur: number, gain = 0.08, t0 = 0) => {
  const c = ensure(); if (!c) return;
  const b = c.createBuffer(1, c.sampleRate * dur, c.sampleRate); const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800;
  s.buffer = b; g.gain.value = gain; s.connect(f).connect(g).connect(c.destination); s.start(c.currentTime + t0);
};
const lib: Record<string, () => void> = {
  click: () => tone(900, 0.05, 'square', 0.03),
  error: () => tone(200, 0.18, 'sawtooth', 0.05),
  // metallic coin clink: two detuned high partials + a tiny attack tick
  coin: () => { noise(0.03, 0.04); tone(2100, 0.07, 'triangle', 0.09); tone(3150, 0.13, 'sine', 0.07, 0.03); tone(1560, 0.1, 'sine', 0.05, 0.02); },
  // paper riffle
  card: () => { noise(0.11, 0.05); tone(320, 0.05, 'square', 0.02, 0.01); },
  deal: () => { noise(0.08, 0.045); tone(420, 0.04, 'triangle', 0.03, 0.01); },
  // ink-stamp thud
  stamp: () => { tone(120, 0.2, 'square', 0.13); tone(70, 0.16, 'sine', 0.1, 0.01); noise(0.06, 0.09); },
  // mechanical lever/switch clunk
  lever: () => { tone(180, 0.06, 'square', 0.08); noise(0.05, 0.06, 0.02); tone(90, 0.12, 'sine', 0.07, 0.04); },
  // urgent two-tone alarm
  alert: () => { tone(660, 0.1, 'square', 0.06); tone(880, 0.14, 'square', 0.06, 0.12); },
  // low countdown heartbeat (double thump)
  heartbeat: () => { tone(62, 0.11, 'sine', 0.11); tone(52, 0.14, 'sine', 0.09, 0.14); },
  turn: () => { tone(523, 0.1, 'triangle', 0.09); tone(659, 0.1, 'triangle', 0.09, 0.11); tone(784, 0.2, 'triangle', 0.09, 0.22); },
  // brass fanfare
  win: () => { [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 0.4, 'triangle', 0.1, i * 0.12)); tone(1568, 0.6, 'triangle', 0.08, 0.62); },
  lose: () => tone(300, 0.5, 'sawtooth', 0.06, 0, 90),
  reveal: () => { tone(440, 0.12, 'sine', 0.08); tone(880, 0.25, 'sine', 0.08, 0.1); },
};

// ── recorded meme clips (mp3 files in /public/sfx), played for big game beats ──
const CLIPS: Record<string, string> = {
  cardkill: '/sfx/cardkill.mp3',   // someone knocks out another player's card
  coup: '/sfx/coup.mp3',           // paid kill (7 coins)
  bluff: '/sfx/bluff.mp3',         // a bluff gets exposed
  death: '/sfx/death.mp3',         // a player is eliminated
  cardloss: '/sfx/cardloss.mp3',   // you lose a card
  blocked: '/sfx/blocked.mp3',     // your action gets blocked
};
const clips: Record<string, HTMLAudioElement> = {};
const clipEl = (n: string) => {
  let a = clips[n];
  if (!a && CLIPS[n]) { a = new Audio(CLIPS[n]); a.preload = 'auto'; a.volume = 0.5; clips[n] = a; }
  return a || null;
};

export const sfx = {
  get enabled() { return enabled; },
  toggle() { enabled = !enabled; localStorage.setItem('mekina.sound', enabled ? 'on' : 'off'); if (enabled) { ensure(); lib.click(); } return enabled; },
  play(n: string) { if (!enabled || (reducedMotion && n === 'click')) return; try { (lib[n] || (() => {}))(); } catch { /* ignore */ } },
  /** Play a recorded clip (mp3). Restarts if already playing so rapid beats still fire. */
  clip(n: string) { if (!enabled) return; const a = clipEl(n); if (!a) return; try { a.currentTime = 0; const p = a.play(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ } },
  unlock() { ensure(); for (const n of Object.keys(CLIPS)) clipEl(n); },
};
