# ELMEKINA — promo video brief (sponsored spot)

A brief for a video-generation agent. One game round, four players, told as a heist-comedy
in the machine's own café-noir style. Every scene is written to fit a **10-second clip**; the
spot is assembled from the clips in order. Total: 12 scenes, ~100 seconds. A 30-second cut is
marked at the end.

## 0. Hard rules for the video agent (read before anything else)

1. **No text on any card. Ever.** No names, no letters, no numbers, no symbols that look like
   writing, no title bands. A card is a picture only: a portrait on a coloured, patterned
   background inside a cream border. If the model tries to label a card, regenerate the clip.
2. **No Arabic script anywhere in the video** — not on cards, walls, posters, screens, buttons or
   captions. Video models draw Arabic wrong, and wrong Arabic is worse than none.
3. **No generated text of any kind inside the footage.** No captions, no logos, no button labels,
   no speech bubbles, no readable posters (wall posters are blurred shapes with faces, nothing
   legible). Every word the viewer reads — the captions listed per scene, the logo, the store
   badges — is **added afterwards in the edit** as an overlay, in English. The "caption" lines
   below are for the editor, not for the video model.
4. Characters are told apart by **colour and portrait**, never by a label. Keep each character's
   colour and look identical in every scene (see the table in section 1).
5. Each clip is **10 seconds or less**, one continuous shot, no cuts inside a clip.

Tone: sly, warm, a little theatrical. Nobody is a villain; everybody is lying and everybody knows
it. Think a card table in a Tunisian café at midnight, lamp-lit, coffee glasses, a machine that
hums when someone bluffs.

---

## 1. World and look (read first)

**Setting.** A round dark-wood table under one warm lamp. Behind it, a wall covered in wanted
posters and a red map of Tunisia. Red stage curtains at the far left and right edges. Everything
outside the lamp's pool is near-black. Palette: dark wood `#0E0B08`, warm paper `#F3E9D6`, machine
orange `#F08A1D` (the only bright accent), brass-gold `#FFC24A` for coins and highlights.

**"The machine" (ELMEKINA).** A squat orange steampunk contraption with three small TV screens and
a robot face. It sits at the centre of the table where the deck and the coin bank live. It is the
game's referee and mascot: when someone lies it *hums*, when a bluff is caught its screens flash
red, when someone wins it spits out coins. It never speaks.

**Coins.** Brass discs with a star. They fly between players and the bank as arcs of coins, never
teleport.

**Cards — the card UI (important, describe exactly).**
- Portrait playing card, aspect ~ 3 : 5, rounded corners, a plain **cream border** all round.
- **The face of a card is a picture and nothing else**: a **flat-shaded cartoon portrait** (bust,
  facing camera, neutral or wry expression) filling the frame, on a **background in the
  character's colour** patterned with small repeated icons of their trade. **No title band, no
  name, no lettering, no numerals, no corner marks** — top and bottom of the card are just more
  cream border. (The real in-game cards carry a name; the video's cards deliberately do not.)
- A character is recognised by its **colour + its portrait**. The colour is the loudest cue: a
  gold card is always the Business Woman, a red card always the Terrorist.
- **Card back:** dark wood colour with a small orange machine emblem in the centre and a thin
  brass border. No writing.
- Cards sit **face down** on the table; a player sees only their own two, held in a fan. A card
  turns face up in three moments only: when a claim is *proved* (flipped for one second, then it
  slides under the deck and a new face-down card is dealt), when a card is *lost* (it flips and
  stays face up and greyed in front of that player as a dead card), and in the final reveal.
- **Claim chip:** when a player claims a character, a large glowing **disc in that character's
  colour with the character's portrait on it** drops onto the table in front of them. No words on
  it. This is how the video shows "I claim X" without text.

**The seven characters** (colour, background pattern, one-line power):

| Character | Colour | Pattern behind the portrait | Power in one line |
|---|---|---|---|
| Tax Man | green `#2F7D32` | stamped documents, coins | Take 1 coin from anyone holding more than 7 |
| Business Woman | gold `#D7A800` | banknotes, briefcases | Take 4 coins from the bank |
| Police | blue `#1E4FB5` | badges, handcuffs | Secretly look at one card, keep or swap it |
| Terrorist | red `#B3261E` | fuses, dynamite | Pay 3: destroy one of a player's cards |
| Colonel | olive `#4B6B2B` | medals, stars | Pay 4: guess a card in someone's hand |
| Politician | purple `#5B2D9E` | podiums, ballot boxes | Return all your cards, draw fresh ones |
| Thief | orange-brown `#B5561A` | crowbars, keys | Steal 2 coins from a player |

Card-face characters as portraits: Tax Man is a bearded man in a grey suit with glasses; Business
Woman a woman with a black bob and a navy blazer; Police a young officer in a blue cap; Terrorist
a man in a keffiyeh-style scarf; Colonel an older moustached man in olive uniform and dark glasses;
Politician a smiling man in a suit and red tie; Thief a young man in a black beanie and jacket.

**The rule the whole video teaches, in one sentence:** *You may claim any character whether you
hold it or not; anyone can call your bluff; whoever is wrong loses a card; lose both cards and you
are out; last player standing wins.*

---

## 2. The four players

Give each a distinct silhouette so they read instantly in a wide shot.

| Seat | Name | Look | Hidden hand (the audience is shown it) | Personality |
|---|---|---|---|---|
| Bottom (hero, "you") | **Youssef** | 20s, hoodie, round glasses, coffee glass in hand | Police + Thief | Nervous, learns fast, ends up the sly one |
| Left | **Mariem** | 30s, sharp blazer, gold earrings, sunglasses pushed up | Business Woman + Politician | Confident, bluffs with a straight face |
| Top | **Si Hamadi** | 60s, flat cap, grey moustache, cigarette behind ear | Colonel + Tax Man | Slow, silent, deadly when he speaks |
| Right | **Karim** | 20s, gym vest, gold chain, chews gum | Terrorist + Thief | Loud, reckless, the first to fall |

Each player has: a small round **avatar portrait** floating by their seat, a **stack of real coins** (no
number floating over it), and **two face-down cards**. The active player's seat glows orange. A thin orange ring
counts down when a decision is timed.

---

## 3. Scenes (each ≤ 10 s)

Camera notes are for the agent. **Captions are overlaid in the edit and must not be generated
into the footage.** VO = voice-over (English, warm, one sentence). Keep sound design simple:
the machine's hum, cards sliding, coins clinking, one comic sting per twist.

### Scene 1 — The table (0:00–0:10) · establishing
- Camera: slow push-in from the curtains toward the lamp-lit table. Four silhouettes lean in.
  The machine wakes up: screens flicker on, orange glow spreads across the table.
- Action: the machine deals **two face-down cards to each player** and slides **2 coins** to each.
- Caption (added in edit, not generated): `ELMEKINA` (logo), then `Everyone gets 2 cards. Everyone lies.`
- VO: "Four players. Two secret cards each. And nobody, *nobody*, tells the truth."

### Scene 2 — Meet the hands (0:10–0:20) · exposition
- Camera: quick orbit around the table, stopping at each player. Their two cards lift to the
  camera for half a second each so the *audience* sees them (the players do not).
- Show: Youssef's Police + Thief; Mariem's Business Woman + Politician; Si Hamadi's Colonel +
  Tax Man; Karim's Terrorist + Thief.
- Caption (added in edit): the two character names near each hand.
- VO: "You know your cards. They don't. That's your only weapon."

### Scene 3 — Karim goes big (0:20–0:30) · the first claim
- Karim slams a **claim chip** onto the table: a glowing **gold disc with the Business Woman's
  portrait**, no words. He does not hold the Business Woman. His grin says so.
- The machine hums louder. A gold arc of **4 coins** starts to slide from the bank toward him.
- Caption (added in edit, not generated): `Karim claims BUSINESS WOMAN` then `Take 4 coins… if nobody objects.`
- VO: "Claim a card you don't have. Why not? Four free coins."

### Scene 4 — "Bluff!" (0:30–0:40) · the challenge
- Mariem leans in, lowers her sunglasses, and slams her palm on a **round red button with a
  white warning triangle** that rises from the table in front of her. No lettering on it.
- Freeze frame on Karim's face, record-scratch. The coins stop mid-air and roll back to the bank.
- Karim's two cards flip: **Terrorist, Thief**. No Business Woman. The machine's screens flash
  red and a **red cross** stamps across his seat (a shape, not a word).
- One of Karim's cards (the Thief) slides away face up and stays dead in front of him.
- Caption (added in edit, not generated): `Caught. Karim loses a card.`
- VO: "Get caught, lose a card. Lose both… and you're out."

### Scene 5 — Mariem plays it straight (0:40–0:50) · a true claim
- Mariem drops the same **gold claim disc** herself. Karim, furious, calls the bluff again.
- Mariem flips her card: it *is* the Business Woman. She smiles. The card slides under the deck,
  a new face-down card is dealt to her, and **4 coins** arc from the bank into her stack.
- Karim's last card flips and dies. His avatar greys out and his seat light goes dark. His chair pushes
  back. (Comic beat: he keeps chewing gum.)
- Caption (added in edit, not generated): `Truth costs nothing. Doubt costs a card.`
- VO: "Call a true claim… and it's *you* who pays. Bye, Karim."

### Scene 6 — The Thief (0:50–1:00) · a targeted move
- Youssef (nervous) drops an **orange-brown claim disc with the Thief's portrait** and points at Mariem. A dotted orange line runs from him to
  her; **2 coins** lift from her stack and drift toward him.
- Mariem's hand hovers over a **shield-shaped button in the same orange-brown**… and she pulls
  it back. She lets it pass.
- Coins land in Youssef's stack, which visibly grows to four coins.
- Caption (added in edit, not generated): `Steal 2 coins. Unless the target claims Thief too.`
- VO: "Steal, block, or stay quiet. Every move is a bet on what they're holding."

### Scene 7 — Si Hamadi speaks (1:00–1:10) · the Colonel
- Si Hamadi, silent all game, drops an **olive claim disc with the Colonel's portrait** and pays
  **4 coins** into the bank. He points at Mariem; seven small wordless card pictures fan out in
  front of him and he taps the **purple one** (the Politician).
- The purple card picture enlarges and hovers above the table, pulsing, facing Mariem.
- Caption (added in edit, not generated): `Colonel: pay 4, guess a card.` then `Si Hamadi guesses… POLITICIAN.`
- VO: "The Colonel doesn't bluff. He *knows*."

### Scene 8 — The guess lands (1:10–1:20) · card lost
- Nobody dares call him. Mariem's second card flips: **Politician**. Correct.
- The card slides away face up, dead. Mariem is down to one card. Her sunglasses come back down.
- The machine's screens show a **green tick**; Si Hamadi's seat glows brass.
- Caption (added in edit, not generated): `Right guess: she loses that exact card.`
- VO: "Guess right, they lose it. Guess wrong, they keep your coins."

### Scene 9 — The squeeze (1:20–1:30) · money pressure
- Fast montage of three quick turns, one second each: Youssef takes one coin from the bank, Mariem
  takes two (Si Hamadi lifts a finger as if to veto as Tax Man, then lets it go), Si
  Hamadi claims Tax Man and takes 1 coin from Mariem, who now has more than 7.
- Coin stacks visibly grow and shrink beside each player; Youssef's ends as a tall stack of seven.
- Caption (added in edit, not generated): `Coins are life. Seven coins buys a kill.`
- VO: "Save up… because seven coins buys something nobody can block."

### Scene 10 — Pay 7 to eliminate (1:30–1:40) · the coup
- Youssef counts out **7 coins**, pushes them to the bank, and slides a **black card with an orange crosshair symbol** across the
  table toward Si Hamadi (a symbol, no text).
- Si Hamadi raises an eyebrow, then flips his Tax Man: dead. One card left.
- Caption (added in edit, not generated): `Paid kill. No card needed. No bluff to call.`
- VO: "Sometimes you don't lie. You just pay."

### Scene 11 — The last bluff (1:40–1:50) · the twist
- Mariem (one card: a fresh unknown) drops a **red claim disc with the Terrorist's portrait** aimed at Youssef. Youssef sweats. His
  hidden Police card is useless here. He has one real choice: block as Colonel, which he does
  not have.
- He drops an **olive Colonel disc** anyway. Beat. Mariem stares. The orange timer ring shrinks.
- She lets it pass. The claim stands. The machine hums, satisfied.
- Caption (added in edit, not generated): `He doesn't have it. She doesn't know that.`
- VO: "The best lie is the one nobody checks."

### Scene 12 — Winner (1:50–2:00) · payoff and CTA
- Next turn Youssef, now the one with coins, pays 7 again and eliminates Mariem's last card.
  Her card flips, dies; her avatar greys out.
- The machine erupts: screens go gold, coins fountain out onto the table, a gold cup drops onto
  Youssef's avatar and a small flame lights up beside him.
- Hold on the dark table with empty space in the upper third: the logo, store badges and URL are
  **overlaid in the edit** on this shot.
- Caption (added in edit, not generated): `ELMEKINA — Identity · Deception · Deduction` then `Play free on elmekina.com ·
  Google Play · App Store`.
- VO: "ELMEKINA. Lie better than your friends. Play free."

---

## 4. The 30-second cut

Use scenes **1, 3, 4, 5, 12** in that order, trimmed to 6 s each. It carries the whole rule:
deal → claim → bluff caught → true claim punishes the doubter → winner.

## 5. Text and language rules

- **The video model generates zero text.** All captions, the logo, the URL and the store badges
  are overlays added by the editor from the "Caption" lines above. English only.
- **No Arabic script in any cut.** A Tunisian version is made by re-recording the voice-over in
  Derja over the same footage; the pictures do not change.
- Cards never carry writing (section 0, rule 1). If a generated clip shows letters on a card, a
  poster or a button, discard it and regenerate — do not try to fix it in post.
- No numbers in the VO beyond "two cards", "four coins", "seven coins": those are the rule.

## 6. Do / don't for the agent

- Do keep the lamp as the only light. Do let the machine react to every lie.
- Do show coins travelling; never let a number just change.
- Don't put text, letters, numbers or Arabic on anything (cards, chips, buttons, posters, screens).
- Don't show anyone's cards to the *players*; only to the camera, and only in Scene 2 and on flips.
- Don't add extra characters, weapons, or real-world politics. The characters are card archetypes
  in a café card game.
- Don't use the purple/pink "generic mobile game" palette. Orange, brass, wood, cream. That's it.

## 7. Assets to hand the agent

- Card faces: `public/img/cards/<character>.webp` — use as **portrait and colour reference only**;
  these files carry name bands, so crop to the inner picture before handing them over. Card back:
  `public/img/card-back.webp`.
- The machine: `public/img/machine.webp`. Coin: `public/img/coin.webp`.
- Table scene reference: `public/img/bg-game.webp` (landscape), `public/img/bg-portrait.webp`.
- Store badges: `public/img/stores/`. Logo: `public/img/icons/`.
