/**
 * Sentry for the Edge Functions, in about forty lines and no dependency.
 *
 * The Deno SDK would work, but every function pays for it at cold start — and what is actually
 * needed here is one POST of a well-known shape. So this speaks Sentry's envelope protocol
 * directly: an event line, an item header, the event. Nothing to bundle, nothing to keep updated
 * beyond a format that has not moved in years.
 *
 * Set SENTRY_DSN as a function secret to switch it on. Unset, every call here returns immediately
 * and the functions behave exactly as they did before — monitoring must never be a way to fail.
 */
const DSN = Deno.env.get('SENTRY_DSN') || '';

/** https://<key>@<host>/<project> — the three parts everything below needs. */
const parsed = (() => {
  try {
    if (!DSN) return null;
    const u = new URL(DSN);
    const project = u.pathname.replace(/^\//, '');
    if (!u.username || !u.host || !project) return null;
    return { key: u.username, host: u.host, project };
  } catch { return null; }
})();

export const monitoring = !!parsed;

/**
 * Report a thrown error, with whatever context makes it identifiable — the op that was running,
 * the room, never the player's name or anything else about them.
 */
export async function reportError(err: unknown, ctx: Record<string, unknown> = {}): Promise<void> {
  if (!parsed) return;
  try {
    const e = err as Error;
    const eventId = crypto.randomUUID().replace(/-/g, '');
    const event = {
      event_id: eventId,
      timestamp: new Date().toISOString(),
      platform: 'javascript',
      level: 'error',
      server_name: 'supabase-edge',
      environment: Deno.env.get('SENTRY_ENV') || 'production',
      exception: { values: [{ type: e?.name || 'Error', value: String(e?.message || err), stacktrace: undefined }] },
      extra: { ...ctx, stack: e?.stack || null },
    };
    const body = [
      JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn: DSN }),
      JSON.stringify({ type: 'event' }),
      JSON.stringify(event),
    ].join('\n');
    await fetch(`https://${parsed.host}/api/${parsed.project}/envelope/?sentry_key=${parsed.key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-sentry-envelope' }, body,
    });
  } catch { /* a monitor that throws is worse than no monitor */ }
}

/**
 * Cron check-in — this is the downtime half.
 *
 * A scheduled job that stops running produces no error, no log and no alert: it simply stops, and
 * you find out weeks later that nobody has been reminded to play. Sentry watches for the check-in
 * instead of the failure, so silence is the alert.
 */
export async function cronCheckIn(slug: string, status: 'in_progress' | 'ok' | 'error'): Promise<void> {
  if (!parsed) return;
  try {
    await fetch(`https://${parsed.host}/api/${parsed.project}/cron/${slug}/${parsed.key}/?status=${status}`, { method: 'POST' });
  } catch { /* ignore */ }
}
