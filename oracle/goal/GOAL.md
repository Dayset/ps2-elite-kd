# PlanetSide 2 hex voting game

> **Renamed 2026-10-18:** betting is now **voting** (owner decision, #27). BonusCheques are a meme currency: no cash value, nothing is ever paid out, they can't be bought, sold, traded or cashed out. Current-state text below uses vote / amount / reward; dated history and code identifiers (`placebet`, the `bets` table, the `hex-betting-game` artifact) keep their original names. See `oracle/js/vote.js` (`DISCLAIMER`).

Goal ID: goal_4ce5f47123d4
Goal slug: planetside-2-hex-betting-game

## Description
A PlanetSide 2 prediction game where BonusCheques (meme currency, no cash value) are voted per map hex — which faction captures it and when — plus a global vote on the alert winner, resolved against ps2alerts.com data. The pool is parimutuel with no house cut; graded entries pay 5%/15%/30% at the 50%/80%/90% checkpoints plus a 10% certainty kicker when model odds exceed 75% (fees feed the winners' pot). The hint system issues 'collapse pattern forming' warnings without directing play. Dayset playtested a past-alert voting simulator and approved the economics; the concept is now being validated with a debute book of opening-15-minute alert archetypes built from hex-flip order, population, and outcomes.
