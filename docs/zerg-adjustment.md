# 🪳⚔️ Zerg evening-out on ⚔️ iVi: the research

⚔️ iVi on PC is evened out for 🪳 Zerg (since 2026-10-29, issue [#84](https://github.com/Dayset/ps2-elite-kd/issues/84)):

```
⚔️ iVi = (iVi before + 3100) × e^(−0.00021 × (🪳 − 26.8)) − 3100
```

This page explains why, what it is based on, and why it is **not** a penalty for playing with a group.

## In short

- **Measured, not assumed.** Every constant comes from real fights: 103,689 pairs of PC infantry players who fought each other 30 or more times.
- **It goes both ways.** Players below the average crowd (🪳 26.8) go **up**; players above it go down. Players without a 🪳 score are unchanged.
- **It is small.** Most players move by 1% or less. At iVi 1,000: 🪳 0 → +23, 🪳 50 → −20, 🪳 99 → −62.
- **It was checked on players the fit never saw**, and it made fight predictions slightly better, not worse.

## The question

🪳 Zerg (0–99) is high when a player's K/D holds up much better against soft opponents than against strong ones (🎈 Inflation) **and** many of their kills are shared (🤝 Assists). The idea to test: does fighting inside a big crowd lift ⚔️ iVi beyond what the player wins on their own?

## The data

Census killboards list how many times two players killed each other over their whole careers. Among ranked PC players that gives 1.66 million pairs. For the fit we used pairs where:

- both players have at least 75% of their kills on foot (🪖 Infantry), and
- they killed each other at least 30 times.

That leaves **103,689 pairs** from 3,955 players. For each pair we know who won the exchange (the kill ratio), both players' ⚔️ iVi and 🪳, and their vehicle and MAX kill shares.

## What we found

1. **Yes, there is an effect, but it is small.** At the same ⚔️ iVi, a player with a higher 🪳 wins slightly fewer of their fights: about **0.08% fewer kills per 🪳 step**, 95% range 0.05–0.12%. It shows on players the fit never saw and also on PlayStation (same size there, but too few players to be sure).
2. **An earlier, simpler estimate was far too big.** The first draft charged 0.44% of iVi per 🪳 step. Most of that came from how iVi gaps were compared (as percentages instead of points), not from 🪳. Charged that way, fight predictions got **worse** on fresh pairs, so it was dropped.
3. **Vehicles are not counted twice.** ⚔️ iVi already cuts vehicle and MAX play (🚜). In fights, vehicle users actually win **more** than their iVi says, so 🪳 is measured with vehicle and MAX shares held fixed and no vehicle term is added.
4. **Assists alone do not explain it.** Once 🎈 Inflation and vehicle shares are known, 🤝 Assists add nothing. The revive and crowd checks add nothing either. What matters is a K/D that does not hold against strong opponents.
5. **The same weight fits every tier.** Each iVi tier measured on its own agreed with the shared weight, and separate per-tier weights did not predict fights better.

## Why it is centred at 🪳 26.8

Players without a 🪳 score (not enough Honu sessions) keep their plain iVi. In fights they play like **🪳 26.8** (95% range 17.5–36.5). Centring there means a player with a score and a player without one compare fairly. The median 🪳 of players who have one is 31, so most players sit close to the centre.

Typical change at each tier's median iVi and median 🪳:

| Tier | Median 🪳 | Change |
|---|---|---|
| 🏆 Top 1% | 8 | +18 |
| 💎 Top 1–5% | 16 | +9 |
| 🥇 Top 5–10% | 23 | +2 |
| 🥈 Top 10–25% | 29 | −3 |
| 🥉 Top 25–50% | 34 | −7 |
| Lower half | 40 | −10 |

## How it was checked

- **Players the fit never saw.** Players were split at random into two halves. Fitted on one half and tested on fights inside the other half, the 🪳 bias in those fights went from −0.08% / −0.09% per step to +0.01% / −0.01%, and fight predictions improved slightly.
- **Pairs with fewer fights.** Fitted on pairs with 100+ kills and tested on separate pairs with 30–99 kills: same result.
- **Margin.** The weight is known to about ±40%. That is why the adjustment is kept small and the same in every tier.

## What it does not do

- It does not fix single matchups: two specific players can still be ±25% away from what their iVi says.
- It does not touch players who have been away: without 🤝 sessions in the last 60 days the plain iVi stays until a refresh brings fresh data (stale 🪳 inputs would describe how they used to play).
- It does not touch PlayStation (measured on PC), 🪳 itself, 🎈 Inflation, or the 🚜 vehicle cut.

## Re-checking it

`node scripts/zerg-pairs.mjs` rebuilds every pair from the cached data (about 3 minutes) and ends with a pass/fail check. The shipped weight must stay inside the range a fresh fit gives, fights must still lose at least half of their 🪳 bias on unseen players, and the centre must stay inside the range where players without a 🪳 score fight. Code: [`zerg-charge.mjs`](../zerg-charge.mjs). Formulas for all columns: [metrics.md](metrics.md).
