# Theory vs Practice — the 🔀 Diff column: compiled knowledge

Compiled 2026-10-21 from the design dialogue and measurements of that day.
Audience: other agents (Claude, batch workers) picking up ps2-elite-kd work.
Population for every number below: data/ranks.json, 2026-10-21 ~20:44Z,
13,406 players with both IvI and ⚔️ iVi (thin samples excluded by shownValue).

## 1. The framing

The skill graph has two views, and they are two different kinds of skill:

- **💀 K/D mode — PRACTICE.** "Who wins fights": the realized K/D curve
  against easy → hard enemies. Positioning, fight selection, opposition
  quality — everything that actually happens is inside this number.
- **🎯 iVi mode — THEORY.** "Who aims best IN THEORY" (owner wording,
  shipped 2026-10-21, commit 14fc8790): each line keeps its shape but is
  placed at the player's aim score, public IvI = accuracy × headshot %.
  Pure mechanics — what the aim would do in a vacuum. The tip says it
  outright: "better aim, not more wins."

Owner's summary of the pair: theoretical and practical side of the skill.
Players swapping places between the views is the visible form of the gap.

## 2. The 🔀 Diff column (shipped 2026-10-21, commit 302dde1f)

Owner's design call, in his words: "show just practical graph + numbers
for the theoretical difference" — the practical view stays the canvas; the
only theoretical artifact is one number.

- **Definition (fixed, never view-relative):**
  Diff = percentile(⚔️ iVi) − percentile(public IvI), percentile = the
  site's floored share-below (dist.mjs percentileOf). Range −99…+99.
  Positive = results outrun aim. Negative = aim doesn't convert.
  It deliberately does NOT flip sign in the 🎯 view (owner was offered
  the flip; the fixed version was chosen — "Build it as proposed").
- **Placement:** last column of the stats table's DEBUG group
  (adjDebugCols in app.js, after 🎈 Inflation), behind the existing
  "show older debug stats" toggle. Stats table only — Rankings untouched.
- **Plumbing:** both pools come from data/ranks-lite.json. build-ranks.mjs
  LITE_COLS gained "ivi" (appended; all consumers look columns up by name).
  app.js loadConsPool() builds adjsPool + iviPool; the column fn returns
  NaN (cell "—") until a lite payload with ivi arrives. Custom diffCell
  renderer: signed value, no relative-% suffix, hover shows both
  percentiles ("Practice ⚔️ percentile {a} − theory IvI percentile {i}").
- **i18n:** keys col.diff ("🔀 Diff"), tip.diff, diff.cell in en.json;
  other locales fall back to English. Retranslation = issue #54.
  (Sibling change: chart.modeAim / chart.modeAimTip "IN THEORY" wording,
  popup bold via head-tip.mjs ** parsing — issue #53.)

## 3. Measured findings (2026-10-21)

### Reference names (Const = ⚡ percentile [raw ratio]; Diff = ⚔️ pct − IvI pct)

| Player | ⚡ Const | Theory | Practice | Diff |
|---|---|---|---|---|
| Gleerp | 86 [0.75] | 99 | 0 | −99 |
| Andarethh | 94 [1.00] | 95 | 5 | −90 |
| GingerBabyNCE | 27 [0.46] | 2 | 94 | +92 |
| Volt1geur | 37 [0.50] | 9 | 99 | +90 |
| ShloDog | 69 [0.63] | 30 | 59 | +29 |
| Sluglip | 0 [0.18] | 57 | 84 | +27 |
| Artofdying | 90 [0.84] | 94 | 99 | +5 |
| xCloneKano | 54 [0.57] | 97 | 99 | +2 |
| Zugie | 33 [0.49] | 97 | 96 | −1 |
| Simplenubb | 71 [0.64] | 99 | 99 | 0 |

All ten reproduce live in the shipped column (harness-verified).

### The top 1% (n=134 each way)

- By ⚔️: median Diff +2, SD 8.7. Only 4 players |Diff| ≥ 20, one ≥ 40.
- By IvI: median Diff −1, SD 14.5. 16 players ≤ −20, six ≤ −40.
- **Overlap: only 42 of 134 are in both top-1% lists.** At the very top,
  "best aim" and "best results" are largely different populations.
- **Asymmetry:** aim is nearly necessary but far from sufficient.
  Only 6/134 practice-elite have theory below pct 90 (1 below 50);
  27/134 theory-elite fall below practice pct 90 (2 below the median).

### Middle and bottom (owner's prior — confirmed)

- Middle band (⚔️ pct 45–55, n=1,475): SD 23.4; half have |Diff| ≥ 20.
- Bottom 10% by ⚔️ (n=1,341): SD 20.2, median −11; 209 players ≤ −40.
- Caveat: part of the top's calm is arithmetic — at pct 99 the gap can
  only point one way, so it is capped by construction. The asymmetry
  and the 42/134 overlap are NOT arithmetic.

### The tails

- **Positive tail (Diff ≥ +40, n=615):** Mech% median 52 (population 43);
  at the very top (+85…+92) Mech 52–77. Practice far beyond aim.
- **Negative tail (Diff ≤ −40, n=850 — the larger tail):** Mech% median
  36 (infantry), and the five most extreme all have RF (🦁 Brave factor)
  0.06–0.13 — their results collapse specifically against strong
  opposition. Aim sheets that real fights don't honor.
- Inflation medians are ~equal in both tails (2.1) — Diff is orthogonal
  to 🎈 Inflation.

## 4. Which impostors does Diff catch? (the owner's question)

Ranked by what the data shows:

1. **Chart impostors — YES, most of all.** The negative tail (850
   players) is the biggest catch: elite IvI on paper, collapsed realized
   rating. Type specimens: Gleerp (IvI 1,532 p99 → ⚔️ −1,359 p0),
   PerfectAdene (−92), AzimGirl (−91), Andarethh (−90, with Const 1.00 —
   perfectly consistent, just outclassed), Adsweqtt (−88),
   Sheldon3945 (IvI 1,803, ⚔️ −296, ⚡ Const 0.21 — K/D collapses
   against the hard third; consistency explains the non-conversion).
2. **Hidden vehicle mains — YES.** Positive tail + high Mech% is their
   signature (⚔️ already credits vehicle results; IvI doesn't see them).
   Type specimen from the known cast: **coldandhot, Diff +65** —
   IvI 15 (pct 0, essentially no infantry aim record), ⚔️ 569 (pct 65),
   Mech 78. Volt1geur (+90, Mech 77) and contruk (+89, Mech 77) are the
   population extremes.
3. **Zerg surfers — NO.** Top-5% 🎈 Inflation players (n=670) have
   median Diff −4: no signal. Reason: ⚔️ already strips the
   soft-opposition advantage, so their practice and theory sink
   together. Zerg surfing stays Inflation's job (proof case: Bhorn —
   Inflation 3.58 from pure fight selection, Diff exactly 0, theory and
   practice agree at pct 89).

**Diff is not a cheat flag.** The known "peakie" sheets are invisible to
it because their theory and practice agree: Aekris Diff +1, Omegadude1234
+1, Zyr0s +1, DizzyKnight +4, ShrimpeHx 0 — whatever those sheets are,
Diff neither convicts nor clears them. It measures CONVERSION, not
honesty. (And a 0 Diff for xCloneKano/Simplenubb/Zugie, the legit
controls, is the sanity check that the measure is wired right.)

## 5. Caveats for anyone reusing these numbers

- Percentiles are floored shares over slightly different pools
  (IvI exists for ~45 more players than ⚔️); gaps of ±1–2 are noise.
- ⚔️ can go negative (speed cut + penalties), which stretches the
  bottom of the practice scale — Diff −99 is partly that floor.
- Mid-pack percentile gaps compress raw differences: ±10 around the
  median is small; the measure speaks at the extremes.
- Diff is computed from the lite payload (values rounded: adjs/ivi to
  0.1); full-ranks recomputation agrees within ±1 on every checked name.

## 6. Open questions for other agents

- **Diff × RF screen:** the negative tail's RF is 0.06–0.13. Does
  Diff ≤ −40 AND RF < 0.2 isolate "aim that can't handle strong
  opponents" as a named, explainable class (a Sheldon3945 detector)?
- **Diff × Const:** Sheldon3945 (Const 0.21) vs Andarethh (Const 1.00)
  are both ~−90 but for opposite reasons — collapse vs uniform
  outclassing. Worth separating in any future display?
- **Infantry-only Diff for vehicle mains:** the positive tail is
  "explained" by Mech%, but there is no infantry-only practice
  percentile to compare their IvI against. Would need an
  infantry-restricted ⚔️ variant — does the data support one?
- **Promotion path:** if Diff proves itself in debug use, candidates
  are the Rankings table (needs a ranks.json column — build-time, both
  percentiles exist there) and the columns.html debug section write-up.
- **Zerg joint signature:** Inflation catches surfers alone today; is
  there a joint Inflation × slope/Const pattern that separates
  "surfs zergs" from "farms soft fights solo"? Bhorn is the seed case.
