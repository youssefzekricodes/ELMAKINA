/* What an ad network has to be able to do, and nothing more.
 *
 * The frequency rules, the "first games are free" grace and the always-resolves guarantee live one
 * level up in ./index.ts, identical for every network. A provider only has to load itself, say
 * honestly whether it can show something, and show it. That split is the whole point: the placement
 * policy is the part that keeps us inside both stores' rules, so it must not be reimplemented once
 * per network where two copies can drift apart.
 */

/** The Placement API's break types, kept as the shared vocabulary because they name the moment
 *  well: 'start' before a game begins, 'next' between one game and the following one. */
export type BreakType = 'start' | 'next';

export interface AdProvider {
  /** Human name, for logs. */
  readonly name: string;

  /** Is this provider set up AND allowed to run in the current runtime? False means the ad system
   *  is off entirely: nothing loads, no network is contacted, every break resolves instantly. */
  configured(): boolean;

  /** Begin loading and preloading. Called once at startup. Must never throw. */
  init(): void;

  /** SYNCHRONOUS: would show() actually put something on screen right now? Callers use this to
   *  keep work that needs the click's user activation on the synchronous path when no ad is
   *  coming — so this must never be optimistic. When in doubt, say false. */
  ready(): boolean;

  /**
   * Show one interstitial.
   *
   * Resolves TRUE when a break actually ran, which is what starts the cooldown. Resolves FALSE
   * when nothing was shown (no fill, blocked, not approved yet) — those must NOT burn the cooldown,
   * or a publisher with no fill would ask once and then go quiet for the rest of the session.
   *
   * Must never reject. index.ts also applies a hard ceiling, so a provider that hangs cannot
   * freeze the button, but that is a backstop and not a licence to leave promises dangling.
   */
  show(type: BreakType): Promise<boolean>;
}
