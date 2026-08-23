# El-MEKINA — UI overhaul plan

> Status (2026-08-21): steps 1–6 implemented (assets pipeline, home/lobby slideshow, machine table,
> keyed rendering + event-driven FX, mobile layouts, rules dossier, winner screen, SFX). Remaining polish
> ideas: Lighthouse/perf pass on low-end phones, iOS Safari audio/gesture check, real SFX files if wanted.

Goal: replace the current generic dark "dashboard" look with a bespoke, gamified art direction built
from the provided assets, make every state change animate smoothly, and make the whole app work on
phones. No gameplay/server logic changes (only the client + static assets), except small view additions
noted in §7.

## 0. Asset inventory (public/assets)
| File | Size | Use |
|---|---|---|
| `background.png` 1774×887 | 2.3 MB | Ambient background #1 (green patterned wall + phone mock + machine) |
| `background2.png` 1672×941 | 2.1 MB | Ambient background #2 (theatre curtains, table, card fan) |
| `rename-table-background.png` 1121×1403 | 2.0 MB | The "machine" — becomes the game table centrepiece |
| `characters/*.png` 468×764 (businesswoman 401×623) | ~0.45 MB each | Face-up character cards (EN title + AR title, coloured art) |

Gaps (no asset provided): **card back**, **logo/wordmark** as a standalone file, **coin** icon, **favicon**.
→ Plan: I build an SVG card back (gear mark ☼ + "ELMAKINA" + the green pattern), an SVG coin and a
favicon in the same style; the wordmark is set in Bebas Neue to match the art. Swap later if you send files.

Asset pipeline: convert the big PNGs to WebP (+ PNG fallback), generate 2 sizes (1920w / 960w) for
backgrounds, 480w / 240w for cards, `preload` the first background and the 7 cards once the game starts,
lazy-load the rest. Target ≤ 1.5 MB on first paint instead of ~9 MB.

## 1. Art direction ("gamified", no generic AI-dashboard look)
* Palette pulled from the art: deep green wall `#1f3a1c`, dark wood `#3a1d12`, machine orange `#f08a1d`,
  brass `#c9a24a`, paper white `#f4efe6`, ink `#15120f`, accent yellow `#ffd23f` (the "Question everyone" yellow).
* Type: **Bebas Neue** for titles (matches "ELMAKINA"), **IBM Plex Sans** body; Arabic subtitle support
  (Noto Naskh) for the card names shown under avatars.
* Materials instead of flat glass panels: paper cards with soft drop shadows, brass-rimmed "TV screens"
  for player seats (taken straight from the machine art), riveted orange metal for the action console,
  wooden table surface, stamp-style feedback ("BLUFF!", "TRUE!", "BLOCKED").
* Remove: gradient pill buttons, emoji glyphs, generic rounded glass cards, muted grey dashboard log.

## 2. Home & lobby
* Full-bleed **background slideshow**: `background.png` ↔ `background2.png`, cross-fade every **5 s**
  (1.2 s ease), slow Ken-Burns zoom; pauses when the tab is hidden and honours `prefers-reduced-motion`.
  Dark vignette overlay so text stays readable.
* Home: wordmark + tagline "Identity • Deception • Deduction", name field styled as a paper ticket,
  "Create room" as an orange machine button with a press animation, room-code input as 4 brass slots.
* Lobby: players as TV-screen tiles (avatar placeholder = silhouette in static), ready = green light,
  host = crown; room code as a stamped card; "Start" lights up the machine's red lamp.
* Rules modal restyled as a dossier (paper, tabs per character showing the real card art).

## 3. Game table (main room)
* Background: the **machine image** centred as the table (object-fit contain, its light-grey background
  blended into a matching `#e8e8e6`→dark vignette so it reads as a lit table under a dark room).
  Optional: 2–3 subtle CSS animations on it (blinking lamp, slow fan rotation via masked overlays).
* **Seats** arranged around the machine in a ring (CSS grid areas per player count 2–6); each seat =
  brass TV screen with name, coins (stacked coin chips, animated count), face-down card backs, status
  lamp (turn = yellow, passed = grey, claims = orange, eliminated = static noise screen, offline = "NO SIGNAL").
* **Your console** (bottom): your cards shown as the real art, large; coins as a chip stack; the
  action buttons as a riveted control panel — default actions (Income / Loan / Paid Kill) as grey keys,
  character actions as colour-coded keys using each card's colour with a mini portrait; disabled keys show
  the reason on hover/tap.
* **Targeting**: seats pulse with a crosshair; Police slot pick highlights card backs; Colonel guess shows
  the 7 real cards as a fan to pick from.
* **Log**: a paper ticker/receipt printed by the machine (new lines slide in); collapsible on small screens.
* **Prompts**: the reaction prompt docks above the console as a "telegram" card: the claimed character's
  real card on the left, the action text, primary keys (Pass / Block as … / Veto / Take 1), and the
  "Call the bluff" row always underneath as a red stamp-style button with the countdown ring.
  Decision prompts (choose card to lose / pay 9, Police keep-or-swap) show real cards, flip to reveal.
* **Feedback animations**: coin chips fly between seats/bank, card backs slide to the deck on loss,
  proven reveal = card flip + "TRUE!" stamp, bluff caught = "BLUFF!" stamp + shake, elimination = screen
  goes to static + bounty coins fly to the killer, winner = spotlight + confetti + wordmark.
* Turn banner: "YOUR TURN" slides in from the machine; soft ticking ring in the last 3 s. Optional SFX
  hooks (muted by default, toggle in top bar) — no audio files yet, so hooks only.

## 4. Motion & smoothness (technical)
* Replace full `innerHTML` re-render with **keyed updates** (one function per region, diffing by
  player id / log id) so transitions aren't reset on every state message.
* FLIP animations for coin/card movement; CSS transitions for states; `transform`/`opacity` only
  (GPU-friendly); all timings via CSS variables; `prefers-reduced-motion` disables the fancy ones.
* Timer rendering via a single `requestAnimationFrame` loop (instead of the 100 ms interval).
* Preload character cards + card back at game start to avoid first-reveal flashes.

## 5. Responsive / mobile (full app)
* Breakpoints: ≥1100 (desktop ring + side log), 700–1100 (ring above, log collapsible), <700 (phone).
* Phone portrait: seats as a 2–3 column grid above a smaller machine; your hand as a bottom sheet with
  the action console in 2 rows of keys; prompts as bottom sheets; log in a slide-in drawer (badge with
  unread count); top bar compressed (code + connection lamp + menu).
* Touch: ≥44 px targets, no hover-only info (tap shows reasons), `viewport-fit=cover` + safe-area
  insets, no horizontal scroll, `100dvh` layouts, landscape phone layout handled.
* Lobby/home stack vertically; background slideshow keeps cover fit.

## 6. Accessibility & polish
* Colour is never the only signal (icons/labels for statuses), focus rings, ARIA live region for the log,
  ESC closes modals, reduced-motion support, contrast ≥ 4.5:1 on text over art (vignettes).

## 7. Small server-side view additions (no rule changes)
* Add a short-lived `events` list to the state view (e.g. `coins_moved {from,to,n}`, `card_lost {playerId}`,
  `reveal`, `eliminated {playerId,killerId}`) so the client can animate exactly what happened instead of
  diffing numbers. Purely additive; log stays the source of truth.

## 8. Execution order (each step is shippable on its own)
1. Asset pipeline + theme tokens + fonts; wire real cards into `theme.js`; card back / coin SVGs.  
2. Home + lobby restyle with the 5 s background slideshow.  
3. Game table: machine centrepiece, seat ring, console, prompts (desktop first).  
4. Keyed rendering + animation layer (+ `events` in the view).  
5. Mobile layouts and touch polish.  
6. Rules dossier, winner screen, a11y pass, perf check (Lighthouse), cross-browser check (Safari iOS).

Estimate: ~1 day of work per step 1–3, ~half a day each for 4–6.

## Open questions
1. Brand spelling: the art says **ELMAKINA**, the app says **El-MEKINA** — which one is final?
2. Do you have (or want me to draw) a **card back**, a **logo file**, and a **coin** icon?
3. The backgrounds contain the phone mock-up and the "2-8 players / 15 min" badges — OK to use as-is
   (cropped/vignetted), or will you provide text-free versions?
4. Sound effects: want them (I'd add a mute toggle and a small set of free SFX later)?
