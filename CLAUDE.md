# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ELMEKINA — a real-time online hidden-role bluffing game (Coup-style) for 2–6 players. Fully serverless: the authoritative game engine runs in one Supabase Edge Function, hidden state lives in service-role-only Postgres, and each player receives only their own view over Supabase Realtime. The client is React 19 + Vite + Tailwind v4 + HeroUI v3, shipped both as a static web app (Netlify) and as a Capacitor Android shell.

## Commands

```bash
npm run dev              # Vite dev server on :5173 (talks to the real Supabase project from .env)
npm run build            # web build → client/dist
npm run typecheck        # tsc on the client (client/tsconfig.json)

npm test                 # both test files, plain Node, no Supabase needed
node test/engine.test.mjs   # engine scenarios (fake clock + tick())
node test/flow.test.mjs     # full op handler against an in-memory DB (lobby → game → winner)

npm run supabase:deploy  # supabase db push + supabase functions deploy game
npm run supabase:serve   # local Edge Function via Docker (needs SUPABASE_* in .env)

npm run build:native     # VITE_PLATFORM=native build for the Capacitor shell (see "Web vs native")
npm run apk              # sync:native + gradle assembleDebug (expects JAVA_HOME or /opt/homebrew/opt/openjdk@21)
npm run apk:install      # apk + adb install
npm run bundle           # release AAB
npm run android          # scripts/run-android.sh (build + run on device/emulator)

npm run assets           # regenerate public/img/ from public/assets/ source art (sharp)
npm run splash           # iOS splash PNGs + the <link> block for index.html
```

Tests use a hand-rolled harness (`test(name, fn)` + `assert`), not a framework — there is no CLI filter for a single test; run the file. A failing test sets a non-zero exit code but the file keeps running, so read the ✗ lines, not just the exit status.

## Architecture

### The engine is a serializable state machine, shared as plain ESM

`supabase/functions/game/engine.mjs` (rules), `room.mjs` (rooms/lobby/presence/persistence/op dispatch), `bots.mjs` (bot AI), and `messages.mjs` (en/tn log catalog) are **plain `.mjs` ESM imported by three runtimes**: the Deno Edge Function (`index.ts`, which adds auth, the Postgres adapter, and CORS), the browser client (`client/src/i18n.ts` imports `messages.mjs`; `client/src/lib/rules.ts` mirrors engine logic), and the Node tests. Keep these files runtime-agnostic — no Deno/Node/browser APIs.

The engine has **no timers and no closures**: every timed window stores a `deadline`, every continuation is a small data descriptor (e.g. `{k:'kill', targetId, then:{k:'endTurn'}}`), and the whole game round-trips through JSON between requests (`toJSON()`/`Game.fromJSON()`). `game.tick(now)` fires whatever is overdue; `viewFor(id)` builds a player's private view. All timings live in `DEFAULT_TIMINGS` in `engine.mjs`.

### Request/data flow

- Every intent is `POST /functions/v1/game { op, ... }` with the player's **anonymous-auth** JWT. Ops: `create_room`, `join_room`, `solo`, `game_action`, `game_challenge`, `game_block`, `game_decision`, `tick`, etc. — all dispatched in `room.mjs`.
- Tables (`supabase/migrations/`): `rooms` (readable by members), `room_members`, `game_state` (**no client policy at all** — hands/deck/coins live here), `game_views` (one row per player, RLS `user_id = auth.uid()`). `rooms` and `game_views` are in the Realtime publication; the client subscribes with `postgres_changes` filters so each view update reaches exactly one player.
- **No server loop.** Every view carries `nextDue`; the client sets a timer and calls `tick` at that moment (plus a poll while playing). Bots persist human-like delays in state and act on the next tick. Presence = `ping` every 20 s. Concurrency = optimistic versions on `rooms`/`game_state` with retry. An optional `pg_cron` block (commented at the end of the first migration) is a backstop only.
- A second Edge Function, `supabase/functions/push`, sends standard VAPID Web Push (no Firebase).

### Client

`client/src/` — `App.tsx` picks the screen; `components/` are the screens/panels; `lib/` is the machinery:

- `store.ts` — tiny external store (`useSyncExternalStore`); the transport writes, React reads via `useStore()`.
- `net.ts` — the whole Supabase transport: anonymous auth, `emit(op, data)` to the Edge Function, Realtime channel management, tick scheduling, connection-quality tracking.
- `fx.ts` — animations are driven by server-sent `events` in each view (coins flying, stamps, reveals), not by client-side inference.
- i18n: UI strings in `i18n.strings.ts` (en + `tn` — Tunisian Derja, Arabic script, **RTL**; `tn` is the default). The game log is structured `{key, params}` rendered client-side from the shared `messages.mjs` catalog — never hardcode log text.
- Sound is synthesized WebAudio (`sfx.ts`) — no audio files.

Design tokens: `DESIGN.md` is applied as HeroUI semantic variables in `client/src/styles.css` (`@layer theme`), with an ELMEKINA override — accent is machine orange (`#D9580B` light / `#F08A1D` dark), not the purple in the token tables. Use semantic tokens (`--accent`, `--surface`, `bg-surface`, `Button variant="primary"`, …), never raw hex, in component code.

### Web vs native (ad-safety gate — do not weaken)

Web and app ship the same game code; what differs is what may load beside it. **AdSense's terms forbid its code inside an application** — shipping it in the store build risks the entire publisher account. This is gated twice (see `client/src/lib/platform.ts`):

- Build time: `VITE_PLATFORM=native` (set by `npm run build:native`) makes `vite.config.ts` omit the AdSense loader and meta tag from the HTML entirely.
- Runtime: `isNative()` also returns true whenever the Capacitor bridge is present, so even a web bundle refuses AdSense inside the shell.

AdMob (`client/src/lib/ads/`) is the native-side equivalent. Always build the shell with `npm run build:native`, never `npm run build`. While developing ads, set the AdMob env vars to the literal `test` (see `.env.example` — clicking real units is account-suspension territory).

Other native invariants (documented in `capacitor.config.ts`): `appId` is permanent, `androidScheme: 'https'` is load-bearing (localStorage is keyed by origin — changing it orphans every player's local state). The Android widget lives in `android/app/src/main/java/com/elmekina/game/` (`StreakWidget*`) with its client bridge in `client/src/lib/widget.ts`.

### Deployment

- Netlify hosts only the static client (`netlify.toml`): the game is served under `/play/`, a landing page at `/`, legacy `/?room=CODE` invite links 301 to `/play/?room=CODE`. Extra static pages are generated by `client/pages/build-pages.ts` at build time.
- Backend deploys via the Supabase CLI (`npm run supabase:deploy`). Function secrets (`VAPID_*`, `SENTRY_DSN`) go in `supabase secrets set` — the service-role key must never appear in a `VITE_*` var, a build, or `.env.example`.
- GA4/AdSense production IDs are defaults in `client/src/lib/google.ts` and duplicated in `public/ads.txt` + the meta tag in `client/index.html` — change one, change all. Neither is active in `npm run dev`.

## Conventions and gotchas

- Game rules as implemented (challenge/counter windows, coin cap, Terrorist double-loss, timings) are specified in detail in `README.md` — treat it as the rules spec when touching `engine.mjs`, and keep `test/engine.test.mjs` scenarios in step.
- Some README paths predate the React client (`public/i18n.js`, `shared/messages.js`, `public/theme.js`, "Node server"): the real locations are `client/src/i18n.strings.ts`, `supabase/functions/game/messages.mjs`, and `client/src/theme.ts`; there is no Node server.
- `docs/legacy-client/` and `docs/legacy-socket-server/` are dead reference code — never import from them.
- Source art lives in `public/assets/`; `public/img/` is generated output of `npm run assets` — don't edit it by hand.
- The codebase's comment style is deliberate: comments explain *why* (constraints, terms-of-service traps, ordering hazards), and files carry substantial header comments. Match that; don't strip them.
