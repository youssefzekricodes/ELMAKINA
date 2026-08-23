/* Fullscreen helpers. Browsers only allow requestFullscreen from (or shortly after) a user gesture,
   so we call goFullscreen() from the start-game click handlers and also best-effort when the game mounts.
   All failures are swallowed — fullscreen is a nice-to-have, never a hard requirement. */

type FsEl = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
};
type FsDoc = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  msExitFullscreen?: () => Promise<void> | void;
};

export function isFullscreen(): boolean {
  const d = document as FsDoc;
  return !!(d.fullscreenElement || d.webkitFullscreenElement);
}

export function goFullscreen(): void {
  try {
    if (isFullscreen()) return;
    const el = document.documentElement as FsEl;
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (!req) return; // unsupported (e.g. iOS Safari) — silently no-op
    const r = req.call(el);
    if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => {});
  } catch { /* ignore */ }
}

export function exitFullscreen(): void {
  try {
    if (!isFullscreen()) return;
    const d = document as FsDoc;
    const ex = d.exitFullscreen || d.webkitExitFullscreen || d.msExitFullscreen;
    if (!ex) return;
    const r = ex.call(d);
    if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => {});
  } catch { /* ignore */ }
}
