# Acceptance report (spec Doc 5)

Every checklist item from the specification is verified automatically against the
real modules. Run everything with:

```bash
npm test            # 178 assertions across 15 suites (incl. acceptance)
node tests/acceptance.test.js   # just the Doc-5 checklist
```

`tests/acceptance.test.js` is organized so each block below corresponds to one
numbered group in its output.

| # | Spec-5 requirement | Status | Evidence |
|---|---|---|---|
| 1 | The wheel (A-2-3-4-5) loses to a 6-high straight | ✅ | `acceptance` §1 — `evaluate7` + `compareScores`: the wheel scores as a 5-high straight and loses to 2-3-4-5-6. Also covered in `engine.value-layer`. |
| 2 | Board play (the board is the best five) → all survivors split | ✅ | `acceptance` §2 — a stacked deck puts Broadway on the board with both hole hands junk; the hand is run to showdown and both stacks return to their starting value (even split), with a `WIN` carrying `payouts`. |
| 3 | Three unequal all-in stacks → exact main/side pots | ✅ | `acceptance` §3 — `buildPots([100,300,300])` yields a 300 main (all eligible) and a 400 side (only the two larger stacks); `distribute` awards the main to the best hand that is eligible for it and the side to the best of the rest. Also `engine.orchestration`. |
| 4 | An incomplete (short) all-in raise does not reopen betting | ✅ | `acceptance` §4 — after a raise to 300 and a call, a short shove to 380 (a raise of only 80) is offered as all-in-only (`raiseAllInOnly`), and the prior caller's `legalActions().canRaise` is `false`. Also `engine.orchestration`. |
| 5 | A bad beat raises bluff frequency, which decays within 10 hands | ✅ | `acceptance` §5 — a bad beat spikes `tiltLevel`; at high tilt the same weak hand facing a bet is bluffed more and folded less than when calm; tilt then decays below half its peak over 10 uneventful hands. **See the fix note below.** Trigger/decay mechanics also in `ai.psychology`. |
| 6 | The Shark exploits a high fold rate by bluffing more | ✅ | `acceptance` §6 — `exploitAdjustments` returns `bluffWiden > 0` for a passive/foldy read (AF < 1, ≥10 hands); with that read seeded, the Shark's aggressive share on a weak hand exceeds an unread control. The in-app **developer mode** panel shows this live (`estRangeTopHands`, distribution). |
| 7 | A Gemini key error / timeout never stalls the game (fallback) | ✅ | `acceptance` §7 — a client that always rejects yields a legal action with `source: 'fallback'`, and a full hand with a failing Gemini seat plays to completion with chips conserved. Also `ai.gemini` (timeout/HTTP/parse → typed errors) and `ai.llm-decider` (validation, clamping, throttle). |
| 8 | "Reduce motion" replaces every animation with an instant cut | ✅ | `acceptance` §8 — with reduced motion the Presenter emits steps that are all `duration: 0` and the `Timeline` length collapses to 0, so play proceeds at full speed. Also `anim.core`. |
| 9 | 60fps: only `transform`/`opacity` are animated | ✅ (+ note) | `acceptance` §9 — every animation step's `from`/`to` keys are restricted to `{x, y, rotate, rotateY, scale, opacity}` (which compile to `transform`/`opacity`); no layout-triggering property (`top`/`left`/`width`/…) is ever animated. The on-screen frame rate itself is a runtime property — verify in the browser via DevTools' FPS meter on `demo/app.html` while dealing and betting. |

## Fix found during acceptance (item 5)

Acceptance testing surfaced a real defect. The cognitive state tracked tilt
correctly (trigger, decay, big-win relief — all already tested), but the action
**distribution** did not translate higher tilt into more bluffing: in spots
where aggression was already the sharp choice, raising tilt actually *increased*
folding.

- **Cause.** The soft-max temperature was `T = 0.18·(1 + 1.2·tilt)·(1.25 − 0.5·s2)`.
  The `(1 + 1.2·tilt)` factor flattened the distribution toward uniform as tilt
  rose, overpowering the explicit, spec-named terms (`bluff × (1 + 1.2·tilt)`,
  `fold × (1 − 0.3·tilt)`) and reversing the net direction.
- **Fix.** Removed the tilt factor from the temperature (`T = 0.18·(1.25 − 0.5·s2)`).
  Tilt's "erratic play" still enters through `s2` (which already carries
  `−0.4·tilt`), while the explicit spec-2.2-C terms now set the net direction:
  more bluffing, less folding. Verified monotonic across all four archetypes,
  with no regression in the other 14 suites.
