# The metrics

How each number on the site is calculated. For an overview, see the [README](../README.md).

Use the **Raw** and **Smooth** chart views to see the underlying curve. The table columns below are the summaries built from it.

## Default columns

### ⚔️ iVi (skill rating)

The opposition-weighted iVi score, adjusted for your own kill speed (`adjs`).

- Own KPM from **0.8 to 1.4** leaves the score unchanged.
- Above 1.4, add `+300 × log2(own / 1.4)^1.5` points.
- Below 0.8, a positive 🎯🎈 ivi is multiplied by `max((own / 0.8)^0.415, 0.5)`. That means it's cut by at most half and never flipped negative. A score already at or below zero gets no extra penalty.
- Values below zero display as **0** ("Below the rating scale") and sort to the bottom.

### 🛡️ Resist

The Resistance Factor of the enemies you die to.

### 🏃 Activity

The volume of hard fights: ☠️ K/D × your own KPM.

### 🦁 Brave

Formerly LionHeart. Activity × shifted slope pressure under hard opposition.

### ⚡ Const

How much of your K/D you keep against the strongest third of your opponents, compared with the weakest third. 1.00 means it holds completely, and 0.50 means it halves.

### ☠️ K/D

Resistance-weighted K/D. Each death counts for more or less depending on how hard the opponent was.

## Debug columns

These are hidden by default. Tick **show older debug stats** in the footer to see them.

- **🎯 Aim** (Mech%): the estimated share of your fights that are vehicle or mech play. It's projected from Resist, not measured from shooting.
- **🎈 Inflation**: overall K/D ÷ K/D against enemies at **0.5 weapon KPM or higher**. Values above 1.0 mean the overall K/D is higher than the K/D against those enemies. The average player's enemy KPM is about 0.35 for reference. It's hidden by default because it rarely shows anything meaningful.
- **🎯🎈 ivi**: the opposition-weighted IvI before the speed adjustment. It's public IvI × Resistance tempering. The 🎈 is a label, not a value. The status page's red-flag review uses this value.
- **eKPM / own KPM**: the average enemy weapon pace, and your own pace. They're kept separate.
- **📊 COI**: the combat output index, derived from Resist.
- **📉 Slope**: the whole-curve, death-weighted angle of K/D against enemy KPM. A negative value means K/D falls as the opposition gets harder.

## Public columns

KD, KPM, own KPM, Acc %, HSR % and IvI come straight from Census and Honu, without adjustment.

## Tests

The regression suite covers the metrics code:

- pooled and sliceAt
- Inflation at 0.5
- curveSlope (deaths > 0)
- LionHeart bounds
- adjIvI
- yScale containment, for extreme values and low-volume players

Run it with `npm test`.
