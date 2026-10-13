# Changelog

## 2026-10-13 — Pace-adjusted K/D on comparison graph

**What changed:** The Y-axis on the player comparison graph now shows pace-adjusted K/D instead of raw K/D.

**Before:** The lines plotted raw K/D. This rewarded passive play — a 10 K/D earned at 1 kill per minute (safe fights, long breaks between engagements) appeared higher than a 5 K/D earned at 4 kills per minute (constant action, no time to reset). The most passive farmers sat on top of the graph.

**After:** Each player's curve is scaled by `(own KPM / 2.0)²`, capped at 1.0 (penalize only, never boost). High-activity players keep their full K/D. Low-activity players are pulled down to reflect the easier conditions their K/D was earned in.

**Why:** K/D preservation is non-linear in pace. At low KPM you get full reloads, recharged shields, positioning time, and reaction time between fights. At high KPM you fight on half-mags with damaged shields and no setup. The cost follows a quadratic curve — the gap between 1 KPM and 4 KPM is enormous, far bigger than the raw numbers suggest.

**What didn't change:** The iVi formula, all metrics, rankings, and raw data are untouched. Raw K/D is still shown in tooltips. This is a display-layer change only — the line now expresses skill, not just K/D.
