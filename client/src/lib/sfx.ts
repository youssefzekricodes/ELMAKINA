/* Sound effects are disabled: this is a no-op shim so call sites stay untouched.
   (Re-add a WebAudio/clip implementation here if sound ever comes back.) */
export const sfx = {
  get enabled() { return false; },
  toggle() { return false; },
  play(_n: string) { /* silent */ },
  unlock() { /* silent */ },
};
