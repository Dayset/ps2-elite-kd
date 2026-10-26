# Oracle knowledge

Short notes on what the Oracle can and can't see, and what's planned.

## AI commander vision

**Status:** waiting for the Cloudflare Workers Paid plan ($5/month). Tracked in [#78](https://github.com/Dayset/ps2-elite-kd/issues/78).

**What the commander sees today:** only who owns each base, polled once a minute. It can't see how many players are fighting at a base or how far a capture has got. The map shows a base as flipped about 3 minutes after the fight there starts, so orders lag behind the real fight.

**Plan:**
1. One Durable Object keeps a live connection to the Census event stream and turns it into per-base totals only: a rough crowd size for each side at each contested base, plus early signs a fight or capture is starting (bursts of kills, revives and point-defense XP at one base) before the map flips.
2. Re-tune the commander weights on past alerts, with and without this activity data.
3. Keep it only if backtests show a clear gain.

**Early research:** base-level activity worked out from captures, defenses and vehicle kills lands on the right base about 82–85% of the time when the data is 3–4 minutes fresh, which is good enough as a per-base fight-activity estimate.

**Privacy:** aggregate per-base totals only. Nothing is shown or stored about any single player.

**Why it needs the paid plan:** on the free plan, Durable Object time is already at 84–85% a day (the cache's KillMonitor), and D1 writes reach 85–92% of the daily limit on busy days. An always-on stream would push past the caps and stop other parts until the daily reset. The paid plan counts limits per month with much higher totals.
