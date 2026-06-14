# Hold'em — complete No-Limit Texas Hold'em (engine · AI · Gemini · render · animation · app · settings · dev · acceptance)

Pure, render-free game logic for the No-Limit Texas Hold'em project. The project
spec documents are the Single Source of Truth; this layer implements the
correctness-critical pieces with **no approximation**.

## Modules (`src/engine/`)

- **`cards.js`** — Card primitives (`rank` 2–14, Ace = 14), parsing helpers,
  full 52-card deck. Suit colours are logical (`red`/`black`); concrete hex
  values stay in the design-token layer.
- **`deck.js`** — Fisher–Yates shuffle over `crypto.getRandomValues`, with
  unbiased rejection sampling. `Math.random()` is never used.
- **`handEvaluator.js`** — Exact 5–7 → best-5 evaluation. Full kicker
  tiebreaks, wheel (A-2-3-4-5 = 5-high), royal-flush labelling. Brute-forces all
  21 five-card subsets for provable correctness.
- **`potManager.js`** — Side-pot layering + distribution. Folded players fund
  pots but cannot win; ties split equally; leftover chips start from the seat
  left of the button.
- **`gameEngine.js`** — `HoldemEngine`: the state machine
  (WAITING → PREFLOP → FLOP → TURN → RIVER → SHOWDOWN → PAYOUT) and betting
  rounds. Blinds + button rotation (heads-up rule), two-pass dealing with burns,
  minimum-raise enforcement, **incomplete-all-in does not reopen the action**,
  all-in run-outs, uncontested wins, and engine events. `getView(seat)` returns
  PUBLIC info — including `actionsThisHand` (the hand's betting log) — plus only
  that seat's own hole cards (the anti-cheat boundary for AIs).
- **`contracts.js`** — Cross-layer seams: `GameState`, `ActionType`,
  `EventType`, and `Action` / `GameView` typedefs.

## Cognitive AI (`src/ai/`)

- **`equity.js`** — Monte-Carlo equity (spec 2.1 ①, ≥1000 sims) vs random
  opponents or vs estimated ranges; `potOdds`. Uses a seeded mulberry32 PRNG
  (seeded from crypto, injectable for deterministic tests) — `Math.random()` is
  never used; the real game deck still shuffles with crypto.
- **`range.js`** — 169 starting-hand classes (→1326 combos), Chen preflop
  ranking (Chen & Ankenman) for `topPercentRange`, a weighted `Range` type, and
  hand→class reduction with Chen percentiles (`handTopFraction`) for range gates.
- **`opponentModel.js`** — `OpponentStats` (VPIP / PFR / AF / c-bet) and
  Bayesian-style range reweighting from actions and showdowns (spec 2.2 F/G).
- **`personalities.js`** — the four archetype presets (Rock / Calling Station /
  Maniac / Shark) exactly from spec 2.3, plus shared prospect-theory constants
  and behavioural-tell parameters.
- **`prospect.js`** — Prospect-Theory value function `v(x)` (loss aversion λ,
  diminishing sensitivity) and probability weighting `w(p)` (spec 2.2 A).
- **`cognitiveState.js`** — per-AI state across hands: tilt triggers/decay
  (2.2 C), cognitive load + System-1/2 mixing weight (2.2 B), and the
  recency / gambler's-fallacy draw-chase adjustment (2.2 E).
- **`cognitiveAI.js`** — the agent. **`decide(gameView) → Action`** runs the full
  spec 2.1 pipeline: equity (blending a naive estimate with an opponent-aware
  one by the System-2 weight) → prospect-theory value of fold / call / raise →
  an action distribution shaped by dual-process temperature, archetype
  aggression & bluffing, tilt, anchoring (raise sizing), draw-chase, a preflop
  range gate, and Bayesian exploits → sampled action, with a behavioural-tell
  delay and a dev-mode pipeline trace. `observeAction` / `observeHandEnd` feed
  results back into stats and affect. Consumes only the anti-cheat `gameView`.
- **`geminiClient.js`** — optional LLM transport (spec §4): the
  `gemini-flash-lite-3.1` model constant + endpoint, per-archetype persona system
  prompts, `gameView`→prompt serialization, an 8-second-timeout request with 429
  backoff+retry, and mapping/repair of the model's JSON onto a **legal** engine
  `Action` (enum check, amount clamp, illegal→nearest-legal). `fetch` is injected
  (real in the browser, mocked in tests); failures throw a typed `GeminiError`
  for the decider to fall back on. The API key lives only in memory.
- **`llmDecider.js`** — the hybrid seat. `decide(view)` tries the Gemini client
  and, on any failure or timeout, falls back to the same seat's `CognitiveAI`
  (identical persona) — returning `source: 'llm' | 'fallback'`, the fallback
  reason, and a personality-flavoured `delayMs`. Enforces a per-seat minimum call
  interval, surfaces fallbacks via an `onFallback` hook (e.g. blink the seat),
  and keeps the fallback model warm by routing all `observe*()` into it.

## Renderer (`src/render/`) — code-drawn casino objects, no external assets

- **`tokens.js` / `tokens.css`** — the design tokens (spec 3.1): `tokens.js` is the
  canonical source for code that needs values programmatically (SVG/Canvas) and
  also holds the chip denomination palette; `tokens.css` mirrors the environment
  tokens (felt, rail, gold, per-motion easings) for DOM/CSS. One definition per
  value — no scattered hardcoded colours.
- **`chip.js`** — the chip system (spec 3.2): greedy denomination `chipBreakdown`,
  `stackLayout` (bottom-up stagger, fresh column past 20, 1–3px jitter), and
  `chipSVG` drawing a chip as code — drop shadow, side-thickness rim, sheen
  gradient face, 6–8 edge spots, concentric denomination ring, and a central gold
  monogram disc. Unique gradient/filter ids per chip avoid collisions on a page.
- **`card.js` / `cards.css`** — the card system (spec 3.3): vector suit glyphs,
  the traditional pip arrangement per rank, stylised J/Q/K monograms, a large
  ace, mirrored corner indices, and a micro-noise overlay — plus a guilloché
  back with a double gold border and central emblem. `cards.css` adds the 12px
  corners and the hover lift (reduced-motion safe). Suit colours are tokens.
- **`table.js`** — the table surface (spec 3.5): wood trim, a stitched leather
  rail, radially-shaded felt with a noise overlay, a centre watermark, and the
  betting line, plus `seatLayout(n)` geometry (hero bottom-centre, N seats round
  an ellipse) and `towardCenter` for placing committed chips.
- **`hud.js` / `table.css`** — the toggleable glassmorphism HUD: pot odds, live
  Monte-Carlo equity, and a hand-rank hint; `table.css` styles the seat plates,
  chip piles, dealer button, and the glass panel.
- **`scene.js`** — `sceneHTML(snapshot)` composes the whole table from a gameView
  snapshot: board, pot, and each seat's name/stack/cards/committed chips, with
  dealer button and fold/all-in/active states (hero sees faces, opponents backs).

A self-contained visual preview is generated from the real modules by
`npm run preview` → **`demo/chips.html`**, **`demo/cards.html`**, and
**`demo/table.html`** (static; open with a double-click).

## Animation (`src/anim/`) — Presenter → Timeline, transform/opacity only

- **`easing.js`** — a cubic-bezier solver and the per-motion easings (deal
  overshoot, easeInBack collect, pop, smooth) from the design tokens.
- **`tween.js`** — `lerp`, the parabolic flight path (deals/bets arc), and a
  transform-string builder that only ever emits `translate/rotate/rotateY/scale`.
- **`presenter.js`** — `Presenter.present(event)` turns engine events into
  animation steps per spec 3.4 (DEAL = parabola + 720° spin + 100ms stagger;
  FLIP = 3D rotateY 0→180; BET = chip arc, 40ms stagger; COLLECT = bets→pot;
  FLOP/TURN/RIVER = slide-in then flip). Reduced motion collapses every step to
  an instant cut.
- **`animator.js`** — a samplable `Timeline` (steps on one target are merged, so
  a flip never clobbers a card's position), the `play` rAF loop, and `domApply`
  (writes transform/opacity and swaps the card face past 90°).
- **`effects.js`** — the cinematic catalogue logic (spec 3.4): particle bursts
  (gold win shower, full-screen quads+), shockwave rings, the slow-mo/shake/
  vignette config by hand strength (quads+ and a royal-flush special), hand-name
  letter stagger, the pot rolling counter, the turn-timer ring (cyan→amber→red),
  and event→effect-cue mapping for WIN / SHOWDOWN / ALL-IN.
- **`sound.js`** — synthesised Web-Audio sounds (card slide, chip clink, win
  fanfare) as pure specs, played by a lazy, mute-toggleable `SoundBoard`.

`npm run preview` also writes **`demo/anim.html`** (deal/flip/board/bet/collect,
reduce-motion toggle) and **`demo/effects.html`** (win burst, all-in shockwave,
quads slow-mo, royal sweep, turn timer, pot counter, hand-name, sounds) — both
self-contained and runnable with a double-click.

## App (`src/app/`) — integration

- **`adapters.js`** — pure glue: `tableGeometry` (seat/card/chip/pot points, hero
  rotated to the bottom), `viewToScene` (getView → the snapshot the renderer
  draws), and `AnimMapper` (engine events → normalized animation events + effect
  cues, with stable element ids). All deterministic and Node-tested.
- **`controller.js`** — the game loop: buffers engine events, animates them,
  renders the scene, then asks the current actor (human via the action bar, AI
  via a decider) and applies the action — to hand end. Timing, animation,
  rendering, and input are all injected, so the loop runs headlessly in tests.
- **`settings.js`** — `normalizeSettings` (validate/clamp seat count, blinds, and
  per-seat config; a keyless Gemini seat falls back to built-in), `buildSeats`
  (factory-injected → the controller's seat list), and `serializeSettings` (a
  persistable view that never includes API keys — spec 4.1, memory-only).
- **`devpanel.js`** — `formatTrace` turns a CognitiveAI decision trace into a
  view-model (equity, prospect value v(x), tilt, estimated opponent range,
  action distribution) and `devPanelHTML` renders the live panel (spec 2.4).

### Play

```bash
npm run serve      # then open http://localhost:8000/demo/app.html
```

A playable table: you (bottom seat) vs Rock / Maniac / Shark, with live dealing,
flips, chip motion, an action bar (fold / check / call / raise slider), a HUD
(pot odds, win chance, hand hint), and win/all-in effects. The **⚙ Settings**
modal configures seat count, each seat's style and brain (built-in cognitive or
Gemini + fallback, with an in-memory API key), blinds, and the sound /
reduced-motion toggles. **Developer mode** opens a side panel showing each AI's
live equity, v(x), tilt, estimated range, and action distribution.



```js
const e = new HoldemEngine({ seats: [{id:'You',stack:10000}, {id:'AI',stack:10000}],
                             smallBlind: 50, bigBlind: 100, button: 0 });
const ai = CognitiveAI.fromArchetype('Shark', 10000);   // a cognitive opponent
e.startHand();
while (e.currentActor() !== null) {
  const seat = e.currentActor();
  const view = e.getView(seat);          // ← PUBLIC info + only this seat's cards
  const action = ai.decide(view);        // ← {type, amount?, delayMs, reasoning}
  e.applyAction(seat, action);
}
// e.lastResult holds the showdown reveals + payouts; call e.startHand() again.
```

## Test

```bash
npm test     # runs all fifteen suites
```

178 assertions. Engine: hand ranking, side pots, shuffle, betting rules
(short all-in no-reopen vs full-raise reopen), all-in run-out, uncontested win,
anti-cheat view, full hand, button rotation. AI core: Monte-Carlo equity vs
known reference values, nuts/board-split exactness, Chen ranking, range updates,
stats. AI psychology: archetype presets, prospect-theory loss aversion +
probability weighting, tilt triggers/decay, cognitive load, S1/S2 weight,
gambler's-fallacy direction. AI decisions: legality of every action, monster
never folds, tight folds vs loose continues, isolated aggression effect, tilt
loosens, loss-domain risk-seeking, anchored raise sizing, ToM range modelling,
behavioural tells, dev trace — plus an **AI-vs-AI hand played through the engine**
(chips conserved, legal board, payout reached) across multiple hands. Gemini
layer: model/endpoint, prompt construction, response parsing, the 8s timeout,
429 backoff+retry, typed errors, and legal-Action mapping/repair (mocked fetch).
Decider: success → `llm`, every failure mode → `fallback` (still legal), keyless
short-circuit, per-seat throttle, observe delegation, and an LLM-backed seat
playing a full engine hand. Renderer: chip breakdown reconstructs amounts,
stack layout splits columns past 20 with 1–3px jitter, and the chip SVG carries
its shadow, sheen, ring, monogram, and configurable edge spots. Cards: suit
colour/rank mapping, traditional pip counts per rank, and face/back structure
(corner indices, monograms, guilloché, emblem, micro-noise). Table: seat
geometry (hero bottom-centre, in-bounds), the surface SVG (felt/rail/line/
watermark), HUD value helpers + panel, and scene composition (board, pot, seat
states, hero faces vs opponent backs, dealer button). Animation: easing curves
(overshoot/easeInBack), parabola + transform builder, the event→step Presenter,
and Timeline scheduling/merging with the reduced-motion instant-cut path.
Cinematics: particle physics, shockwave, the big-hand config (quads+/royal),
letter stagger, pot counter, turn-timer ring, event→cue mapping, and the
synthesised-sound specs with mute gating. App: table geometry, gameView→scene,
event→animation mapping, and the controller loop (AI-only and human-seat hands
played to completion with chips conserved).

## Status — complete

All six phases are done and every spec Doc-5 acceptance item passes; see
`ACCEPTANCE.md` for the checklist and evidence. The full game is playable via
`npm run serve` → `demo/app.html`.

- **Engine** — deck (crypto Fisher–Yates), 7-card evaluator with full kickers and
  the wheel, side pots with odd-chip rule, and the betting state machine
  (including the short-all-in no-reopen rule).
- **Cognitive AI** — Monte-Carlo equity, prospect theory, dual-process S1/S2 with
  cognitive load, tilt, anchoring, gambler's fallacy, ToM L0–L2, and Bayesian
  opponent modelling, across four archetypes.
- **Gemini** — `gemini-flash-lite-3.1` seats with JSON validation, clamping, an
  8-second timeout, 429 back-off, and a built-in fallback that never stalls play.
- **Visuals** — code-drawn chips, cards, and felt (no external assets), a
  glassmorphism HUD, a full animation catalogue, synthesised sound, and a
  reduced-motion path.
- **App** — the controller loop, the action bar, the settings modal (incl.
  per-seat Gemini with in-memory keys), and the developer-mode panel.

During acceptance, one real defect was found and fixed: the tilt soft-max
temperature was reversing the bluff direction (details in `ACCEPTANCE.md`).
