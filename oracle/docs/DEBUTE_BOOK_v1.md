# Debute Book v1 — can the opening 15 minutes predict the alert?

**Verdict: yes, but selectively.** Territory *momentum* in the first 15 minutes
discriminates clearly. Population — the thing everyone watches — barely
discriminates at all. That is the contrarian headline of this book.

**Dataset:** 600 completed 90-minute territory alerts, world 1 (Osprey) + world 10 (Wainwright),
Oct 2025 – Oct 2026. Per alert: full hex-flip history, per-minute population,
final result. Two alerts with unresolvable victors excluded from outcome stats
(n=598).

**Base rates (the lines to beat):** VS **37.6%** · TR **29.6%** · NC **27.1%** ·
draw **5.7%**.

---

## The book — archetype table

| Archetype | Plain-English meaning | n | Signal (win rate vs base) | Lift | Real? |
|---|---|---|---|---|---|
| **early_rusher** | Faction gains ≥5pp territory in the first 15 min | 223 faction-slots | 40.4% vs 32.0% | **+8.4pp** | ✅ 95% CI excludes base |
| **early_collapse** | Faction loses ≥5pp territory in the first 15 min | 211 faction-slots | 19.0% vs 31.4% | **−12.4pp** | ✅ 95% CI excludes base |
| **pop_underdog** | Faction starts with <25% of continent pop | 222 faction-slots | 23.9% vs 31.6% | **−7.7pp** | ✅ pooled; driven by NC (−13.8pp) |
| pop_starved | Faction starts with <20% of continent pop | 71 faction-slots | 31.0% vs 32.1% | −1.1pp | ❌ no signal (wide CI) |
| pop_favorite | Faction starts with >40% of continent pop | 319 faction-slots | 31.0% vs 31.4% | −0.4pp | ❌ no signal |
| pop_dominant | Faction starts with >45% of continent pop | 121 faction-slots | 30.6% vs 31.5% | −1.0pp | ❌ no signal |
| balanced_opening | Leader holds ≤40% at 15 min | 149 alerts | victor dist ≈ base | ~0 | ❌ no signal (expected) |
| runaway_opening | Leader holds ≥45% at 15 min | 217 alerts | victor dist ≈ base | ~0 | ❌ no signal |
| dead_hours | <80 players at alert start | 142 alerts | victor dist ≈ base | ~0 | ❌ no signal |
| prime_time | ≥220 players at alert start | 172 alerts | victor dist ≈ base (TR +6.4pp, n.s.) | ~0 | ❌ no signal |

*"Real?" = the 95% Wilson confidence interval for the archetype's win rate
excludes the base rate. Slot-level base rates are slot-weighted across factions.*

---

## What works

**1. Early momentum is the book's best predictor.**
A faction that gains ≥5pp of territory in the first 15 minutes wins 40.4%
of the time against a 32.0% base (+8.4pp, significant). The effect holds for
all three factions in the same direction (VS +5.6, NC +11.5, TR +8.9), which
is what makes it believable rather than a fluke. NC rushers gain the most
(+11.5pp, individually significant).

**2. Collapse predicts harder than rush.**
Losing ≥5pp in the first 15 minutes drops a faction to 19.0% wins (−12.4pp,
significant; VS −17.6pp and TR −13.7pp individually significant). Losing
territory early is more informative than gaining it — plausibly because gains
can be empty-base ghost caps while losses mean you are actually being beaten.

**3. The rush is not mean reversion.**
Rushers who started *low* on territory win 33.8%; mid/high starters win
44.6%/42.7%. If the signal were just "low teams bounce back," it would run
the other way. The momentum is genuine.

## The honest negatives

**4. Starting population advantage is worth nothing.**
A faction starting with >40% of the population wins 31.0% vs a 31.4% base.
At >45% it is 30.6% vs 31.5%. Three hundred nineteen faction-slots of pop
favorites, and the lift is zero. Whatever population advantage means at
minute zero, ninety minutes of alert washes it out (players log off, switch
factions, zergs stall).

**5. A 45% leader at 15 minutes is not winning the alert.**
The runaway_opening archetype (n=217) produces victor rates indistinguishable
from base. Comebacks are the norm, not the exception — which is exactly why
the betting sim's 50%/80% checkpoints stay interesting.

**6. The "faction too low" effect is real but modest — and faction-asymmetric.**
Pop underdogs (<25%) win 23.9% vs 31.6% (−7.7pp, significant pooled), but the
pain is not shared: **NC underdogs are crushed (13.3% vs 27.1% base,
significant) while VS underdogs barely notice (35.1% vs 37.6%, not
significant).** When any underdog exists, VS wins 43.7% of those alerts
against a 37.6% base — VS is the faction that profits from imbalanced
population. Below 20% (pop_starved, n=71) no effect is detectable, but the
confidence interval is wide enough to hide one; do not read this as "20% is
safe."

**7. Time of day and continent busyness don't move the lines.**
Dead-hours and prime-time alerts resolve at base rates. (Hours are UTC;
World 1 (Osprey) is US, world 10 (Wainwright) is EU — the pop buckets capture "busyness" better than
the clock does.)

---

## Methodology notes

- **Territory reconstruction:** initial ownership from `isInitial` entries,
  then non-defence flips applied chronologically. Validated: the 50%-elapsed
  checkpoint reproduces the three ground-truth anchors *exactly*
  (10-46062: 58.0/30.7/11.4; 10-46027: 34.7/40.8/24.5; 10-45671:
  34.8/10.1/55.1).
- **Net-change features are flip-based**, so they do not depend on the
  initial snapshot at all — robust by construction.
- **Defence entries** always have oldFaction == newFaction (verified across
  the dataset); they are no-ops and excluded from the flip sequence.
- **Population:** first per-minute sample (~1 min after alert start); faction
  shares computed over VS+NC+TR (NSO excluded from shares, included in totals).
- **Draws** are their own outcome in alert-level archetypes and count as
  non-wins in slot-level win rates.
- **Significance:** 95% Wilson interval excluding the base rate. With 10
  archetypes × multiple rows, isolated significances should be treated
  cautiously — but rusher/collapse replicate across all three factions in
  the same direction, which is the signature of a real effect.

## Data-quality caveats

- The collector's **initial territory snapshot disagrees with the official
  alert-page 0% values** on the anchor alerts (e.g. 10-46062: collector says
  52.3/31.8/15.9, page says 34.1/33.0/33.0). Across 600 alerts the median
  initial spread is 18pp, so imbalanced starts are normal — but treat absolute
  t=0 shares as collector-reported, not gospel. (All momentum features are
  unaffected.)
- The `mapControl` counts on capture entries use a **different facility set**
  than the instance-entries feed; reconstruction uses the entries feed
  consistently and never mixes the two.
- Only worlds 1 (Osprey) and 10 (Wainwright) (300 alerts each). No zone splits in v1 — per-zone
  cells would be too small to trust.
- Correlation, not causation. A rush may *cause* wins, or good factions may
  both rush and win.

## What's next (v2 candidates)

- **Interactions:** rusher × pop-favorite (does a rush with pop behind it
  convert harder?), underdog × zone.
- **Zone-specific books** once n grows (Indar/Amerish/Hossin/Esamir behave
  differently; Oshur n=39 is too small).
- **The inflection detector** (hint-system phase 3): find historical moments
  where win-probability swung violently and characterize the 5–10 minutes
  before them — the "collapse pattern forming" warning.
- **Live validation:** run the book against incoming alerts and track
  calibration, not just backtest lift.

*Generated by `debute_book.py` (rerunnable) from local data. No API calls.*
