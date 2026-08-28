# El-MEKINA

Real-time online hidden-role bluffing game for **2–6 players**. On your turn you claim a character
(truthfully or not) and use its power; anyone can call your bluff. Lose all your cards and you're out.
Last player holding a card wins.

* **Backend: Supabase, fully serverless.** The authoritative engine runs inside one **Edge Function**
  (`supabase/functions/game`); hidden state (hands, FIFO deck, coins) lives in a service-role-only Postgres
  table; each player receives only their own per-player view through **Realtime**. Players are identified by
  Supabase **anonymous auth**. No Node server to host.
* **Client:** React 19 + Vite + Tailwind CSS v4 + **HeroUI v3** (`client/`), built to `client/dist` and served by the
  Node server. Design tokens follow `DESIGN.md` (HeroUI semantic variables; font Plus Jakarta Sans).

## Quick start (deploy on Supabase)

1. Create a Supabase project. In **Authentication → Sign In / Providers** enable **Anonymous sign-ins**.
2. Copy `.env.example` to `.env` and fill in `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (Project Settings → API).
3. Push the schema and deploy the function (Supabase CLI is a dev dependency):
   ```bash
   npm install
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npm run supabase:deploy      # = supabase db push (migration: tables, RLS, realtime) + supabase functions deploy game
   ```
4. Build the web client and host `client/dist` anywhere static (Vercel, Netlify, Cloudflare Pages, S3, Supabase Storage…):
   ```bash
   npm run build                # client/ → client/dist
   npm start                    # local preview of the build on http://localhost:8000
   ```
   `npm run dev` starts Vite with hot reload on http://localhost:5173 (it talks to your Supabase project directly).

## Analytics & ads (both optional)

Two env vars, both **off unless set** — with neither, the app requests nothing from Google and every
ad break resolves instantly. That is the default for local dev.

| Variable | Where to get it | What it turns on |
|---|---|---|
| `VITE_GA_ID` | GA4 → Admin → Data streams (`G-XXXXXXXXXX`) | Page views per screen (`/home`, `/lobby`, `/game`, …) and `game_start` / `game_end` / `room_create` / `room_join` / `sign_in` events. Users-by-country needs no extra code: GA4 derives it from the request IP (Reports → User attributes, and Realtime). |
| `VITE_ADSENSE_CLIENT` | AdSense → Account → Settings (`ca-pub-…`) | A full-screen ad before a **solo** game and on the **end-of-game** screen, via Google's H5 Games Ads. Never during play. Put the same id in `public/ads.txt`. |

Consent Mode v2 defaults to granted, then **denied for the EEA/UK/CH** until a CMP says otherwise —
enable Google's certified banner in AdSense → **Privacy & messaging** and it updates that by itself.
`public/privacy.html` is the policy both products require; keep it accurate if you add anything new.

No name, room code or account email is ever sent to Google. See `client/src/lib/analytics.ts`.

Optional backstop (timeouts/bots advance even when no browser is open): enable `pg_cron` + `pg_net` and run the
commented `cron.schedule` block at the end of `supabase/migrations/20260822000000_elmakina.sql` (fill in your
project URL + service-role key). Normally clients themselves call `tick` exactly when something is due.

Open `http://localhost:8000` in a browser, enter a name and **Create room**. Share the 4-letter code
(or the "Copy invite link" button in the lobby). Friends open the same URL and **Join**.
Everyone hits **I'm ready**, the host presses **Start game**.

For a LAN game, open `http://<your-LAN-IP>:8000` on the other devices. The port is read from `.env`
(`PORT=8000`, copy `.env.example` if missing); a real `PORT` environment variable overrides it. `npm run dev` restarts the server on file changes.

### Try it alone

Press **Play solo vs the machine** on the home screen (3 bots), or add bots from any lobby.

## Tests (no Supabase needed)

```bash
npm test                    # = both below
node test/engine.test.mjs   # engine scenarios (challenges, blocks, kills, cap, FIFO deck, random full games, JSON round-trips)
node test/flow.test.mjs     # the whole op handler with an in-memory DB: lobby → game → bots/ticks → winner → new game, cron, CAS
npm run typecheck           # tsc on the client
```

## How the serverless backend works

* **One Edge Function, one `op` per request.** `POST /functions/v1/game { op, ... }` with the player's anonymous JWT.
  Ops: `hello`, `ping`, `create_room`, `join_room`, `solo`, `leave_room`, `set_profile`, `toggle_ready`, `add_bot`,
  `remove_bot`, `start_game`, `new_game`, `back_to_lobby`, `game_action`, `game_challenge`, `game_block`,
  `game_pass`, `game_decision`, `tick`, and `tick_all` (service role only, for cron). All logic is in
  `supabase/functions/game/room.mjs` (rooms/lobby/persistence) and `engine.mjs` (rules) — plain ESM shared by
  the function, the client (`messages.mjs`) and the Node tests.
* **Engine = serializable state machine.** No timers and no closures: every timed window stores a deadline and
  every continuation is a small data descriptor (`{k:'kill', targetId, then:{k:'endTurn'}}`…), so the whole game
  round-trips through JSON between requests. `game.tick(now)` fires whatever is overdue; `viewFor(id)` builds a
  player's view (own hand + public info only).
* **Tables** (`supabase/migrations/…_elmakina.sql`): `rooms` (lobby/public, readable by members), `room_members`
  (one room per user + presence `last_seen`), `game_state` (hidden — no client policy at all), `game_views`
  (one row per player, RLS `user_id = auth.uid()`). `rooms` and `game_views` are in the Realtime publication; the
  client subscribes with `postgres_changes` filters (`code=eq.X`, `id=eq.X:uid`), so a view update is pushed to
  exactly one player.
* **Time & bots without a server loop.** Every view carries `nextDue`; the client sets a timer and calls `tick`
  right then (plus a 5 s poll while playing). Bots schedule human-like delays in the persisted state and act on the
  next tick. Presence: `ping` every 20 s; a member unseen for 45 s counts as disconnected (turn timers shorten,
  reactions auto-pass). Concurrency: optimistic versions on `rooms`/`game_state` with automatic retry.

## Web client (React + HeroUI)

* `client/src` — `App.tsx` (screens), `components/` (TopBar, Home, Lobby, Table, Console, Prompt, LogPanel, Modals),
  `lib/` (`store.ts` external store, `supabase.ts` client, `net.ts` Supabase transport (auth, Edge Function calls, Realtime, tick scheduling), `fx.ts` server-event animations, `sfx.ts`
  WebAudio sounds, `hooks.ts`), `i18n.ts` + `i18n.strings.ts` (en / Tunisian), `theme.ts` (art + actions),
  `icons.ts` (Solar line-duotone SVGs), `styles.css` (HeroUI theme tokens + game art CSS).
* **HeroUI v3 components** are used throughout: `Button` (semantic variants — primary / secondary / outline / tertiary /
  danger), `Card`, `TextField` + `Input` + `Label` + `Description`, `Chip`, `Avatar`, `Modal` (rules, avatar picker),
  `Drawer` (log on mobile), `Tooltip`, `Toast`, `Alert` (consequence / verdict lines), `ProgressCircle` (countdowns),
  `Badge`, `Separator`. Game-specific visuals (table, seats, cards, effects) are custom elements styled with the same
  tokens (`--accent`, `--surface`, `--radius`, …) so they follow the theme.
* **Theme** — `DESIGN.md` ("Redesign_1.0") is applied as HeroUI semantic variables in `client/src/styles.css`
  (`@layer theme`): light + dark token sets, `--radius: 8px`, fields `12px`, Plus Jakarta Sans (+ IBM Plex Sans Arabic for
  Tunisian). Primary/accent is the ELMAKINA machine orange (`#D9580B`; `#F08A1D` in dark), warning is coin gold.
  Change a token once and every component follows.
* The previous vanilla client is kept for reference in `docs/legacy-client/`; the previous Node + Socket.IO server
  (and its socket tests) in `docs/legacy-socket-server/`. Neither is used any more.

## Look & feel, assets, sound

* Art direction built from `public/assets` (ELMAKINA backgrounds, the orange "machine", 7 character
  cards, card back, coin): home/lobby show a **background slideshow** (cross-fade every 5 s); the game
  table is the **machine** with players as brass TV screens around it; your hand shows the **real cards**;
  the reaction prompt is a paper "telegram" with the claimed card, the primary counter key and
  **CALL THE BLUFF** always underneath; the log is a paper receipt.
* Animations are driven by server `events` (coins flying between seats and the bank, cards flying to the
  deck, TRUE!/BLUFF!/BLOCKED stamps, card-flip reveals, elimination static, confetti on a win).
  `prefers-reduced-motion` disables them.
* **Sound**: synthesized with WebAudio (no files) — toggle in the top bar, remembered per browser.
* **Mobile**: fully responsive (seat grid, bottom console, log drawer, bottom-sheet prompts, safe areas).
* Optimized images live in `public/img/` and are generated from `public/assets/` with
  `npm run assets` (uses `sharp`, a dev dependency). Re-run after replacing any asset. Branding and
  per-character data live in `client/src/theme.ts`.

## Solo mode & bots

* **Play solo vs the machine** on the home screen starts a room with 3 bots immediately;
  in any lobby the host can **+ Add a bot / − Remove bot** to fill seats. Bots act with human-like delays,
  play mostly honestly with occasional bluffs, block when they hold the counter, and call bluffs with a
  probability based on how many copies of the claimed character they hold. Logic: `supabase/functions/game/bots.mjs`.
* **Invite links** (`?room=CODE`) auto-join when the browser already knows your name; otherwise they
  pre-fill the code and ask for your name.

## Avatars & the table

* Every player has an **avatar** (12 defaults from `public/assets/avatars`, or an **uploaded photo** —
  resized in the browser to 160×176 and sent as a small data URL, ≤ ~110 KB) on a **coloured disc**.
  Colours come from the 7 character colours; by default they are assigned by seat (first unused colour),
  never randomly — players can pick another one in **Change look** (home screen or lobby, any time).
  Validation in `supabase/functions/game/room.mjs` (`cleanProfile`); bots get unused defaults.
* The game screen shows a real **oval table** with the **deck** (card count) in the middle; opponents sit
  around it as avatar + name + coins + face-down cards, you sit at the bottom, and your hand is shown
  large in the console. Every step that needs a card choice (Police slot, card to lose, Colonel guess)
  shows a bouncing **"Tap a card"** pointer and pulsing, numbered cards.

## Credits

* Log icons: [Solar Icons](https://solar-icons.com) (line-duotone) by 480 Design, CC BY 4.0, embedded via Iconify.

## Languages

* **English** and **Tunisian (Derja, Arabic script, RTL)** — toggle with the `تونسي` / `EN` button in the
  top bar (remembered per browser; `?lang=tn` in the URL also works). Arabic UI uses the Cairo / IBM Plex
  Sans Arabic fonts and flips the layout to RTL.
* All UI strings live in `public/i18n.js`; the **game log is structured** — the server sends
  `{key, params}` per entry (plus an English `text` for tools/tests) and the client renders it from the
  shared catalog `shared/messages.js` in the selected language, so every player can read the log in
  their own language. Character names, card-loss reasons and common server errors are translated too.

## Project layout

```
supabase/functions/game/engine.mjs   game engine: deck queue, serializable turn/reaction state machine, per-player views
supabase/functions/game/room.mjs     rooms, lobby, presence, persistence (DB adapter), op dispatcher
supabase/functions/game/bots.mjs     bots ("the machine")
supabase/functions/game/messages.mjs log message catalog (en/tn), shared with the client
supabase/functions/game/index.ts        the Edge Function: auth, Postgres adapter, CORS
supabase/migrations/                    schema, RLS, realtime publication (+ optional cron)
client/                                 React + HeroUI web app (Vite) → client/dist
public/assets/                          source art (originals); public/img/ = optimized output of `npm run assets`
scripts/                                build-assets.js (resize / WebP / chroma-key the machine)
docs/                                   UI plan + legacy vanilla client / Socket.IO server (reference only)
test/                                   engine tests + in-memory end-to-end flow tests
```

## Rules as implemented

* **Business Woman & Tax Man:** every other player may separately claim Tax Man to take 1 of the 4 coins; the
  Business Woman claim itself **stays challengeable in every follow-up window** until someone calls it (a Tax Man
  acting first never removes the bluff option). Once proven, only the tax option remains.

* 21-card deck = 7 characters × 3 (Tax Man, Business Woman, Police, Terrorist, Colonel, Politician,
  Thief). The deck is a real FIFO queue: draw from the front, every returned card goes to the back.
* 2–4 players: 3 cards each; 5–6 players: 2 cards each. Everyone starts with 2 coins. Seating order
  and first player are random.
* **14-coin cap**: a player is never filled above 14; the excess stays in the bank (applies to every gain:
  Income, Loan, Business Woman, Thief, Colonel payout, tax…).
* Resolution order: declare → **reaction window** → resolve → next turn. In the reaction window
  *any* other player may **call the bluff** (always offered as a secondary option under the action) and
  *any* other player — target included — may **counter** by claiming the blocking character (Police /
  Colonel / Thief), veto a Loan as Tax Man, or tax the Business Woman. A counter is itself a claim and
  opens its own reaction window where it can be challenged. If a bluff call is made and the claim is
  proven, the counter option remains open afterwards (so the Terrorist double-loss case still applies).
* Default actions (never challengeable): **Income** +1; **Loan** +2 (a Tax Man may veto — the veto
  is a claim); **Paid Kill** pay 7 to kill one card, target may pay 9 to survive.
* Character actions: **Business Woman** +4 — **every** other player may separately claim Tax Man to
  take 1 of those coins (each such claim can be challenged); she keeps 4 − (number of taxers), min 0;
  **Tax Man** take 1 from a player with >7 coins; **Police** peek one card of any player (self allowed),
  keep or swap with the front of the deck, blocked by Police (target);
  **Terrorist** pay 3, kill one card, blocked by Colonel (target);
  **Colonel** pay 4, guess a card — right: target loses that exact card, wrong: Colonel loses a random
  card and target gets the 4 coins; **Politician** return all cards to the back, draw the same number;
  **Thief** steal 2 (or what they have), blocked by Thief (target).
* Challenges: the first challenger (server arrival order) is the official one. Lying claimer → loses
  a random card, action/block fails. Truthful claimer → challenger loses a random card, the proven card
  is shown in the log, returned to the back of the deck and replaced from the front; the action proceeds.
* Terrorist special case: if the target challenges a truthful Terrorist they lose 2 cards total
  (one for the challenge, then one for the kill — which they still choose, and may still try to block).
* Killed players (Terrorist / Paid Kill) secretly choose which card to lose; challenge losses and wrong
  A wrong Colonel guess costs only the 4 coins paid (they go to the target). Lost cards are never revealed.
* Elimination on the last card. The eliminated player's **coins go to the player who took that last
  card** (Terrorist / Paid Kill / correct Colonel guess; the claimer when a bluff call fails; the
  challenger when a bluff is caught; the target when a Colonel guesses wrong) — capped at 14, the excess
  stays in the bank. Turn order skips eliminated players.

### Implementation decisions (where the spec left room)

* Terrorist (3) / Colonel (4) / Paid Kill (7) costs are paid on declaration and are **not refunded** if
  the claim is successfully challenged (Coup-style).
* Counters (Police / Colonel / Thief blocks, Loan veto, Business Woman tax) may be claimed by **any
  other player**, target included. Once someone counters, the original claim is considered accepted
  (it can no longer be challenged; the counter can).
* Pacing for readability: after every bluff call the outcome is shown for ~3 s (a **result window** with a
  green/red verdict), and every turn ends with a ~2 s **"Turn over" recap** listing what happened
  (`resultPause` / `turnPause` in `DEFAULT_TIMINGS`; set to 0 to disable). Prompts show the phase
  (Claim › Reactions › Result), a one-line "If nobody reacts, …" consequence, the turn's timeline so far,
  and each button explains itself (Pass — let it happen / Call the bluff — if they really have it, you lose a card).
* Windows: reaction 12 s (claim) / 10 s (counter-only), decisions (card choice / pay / keep-swap) 20 s, turn 60 s.
  A window closes early when every eligible player has passed. Timeouts default to: no challenge,
  no block, random card loss, "leave it", and **auto-Income** for a turn timeout.
* Disconnects: the seat is kept and the session can be restored from the same browser (token in
  localStorage). A disconnected player is treated as passing on reactions, their turn timer shrinks to
  8 s (auto-Income) and pending decisions resolve with defaults after 2.5 s.
* All timings live in `DEFAULT_TIMINGS` in `supabase/functions/game/engine.mjs`.

## Branding & avatars

Replace files in `public/assets/` (same names), run `npm run assets`, and adjust colours/blurbs in
`public/theme.js` if needed.
