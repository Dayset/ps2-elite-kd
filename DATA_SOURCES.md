# Data sources

Where every number on PS2 Elite and the oracle comes from, what each source asks of us, and where we stand. Checked 2026-10-26 (issue #61). Not legal advice.

| Source | What we take | Their terms | Attribution | Status |
|---|---|---|---|---|
| [Daybreak Census API](https://census.daybreakgames.com/) (REST + streaming) | Character stats, opponents, weapons, online status, map, alerts, base flips, PS login/logout and assist events | Written API policy (below) | Footer: "Data from the Daybreak Census API"; trademark line in the footer disclaimer and `NOTICE` | ✅ with two open points |
| [Honu](https://wt.honu.pw/) (Varunda) | Lifetime history fallback, sessions, kill lists, experience (assists), alert participants | None published | Footer: "Thanks to HONU / Varunda"; killboard links | ✅ OK from Varunda (Discord, 2026-10-26) for the paced use |
| [PS2Alerts](https://ps2alerts.com/) | Territory-alert history (scores, base captures) to grow and test the oracle trees | None published for the API; code GPL-3.0 (we use no code) | Oracle page footer: "alert history from PS2Alerts" (linked) | ✅ OK from PS2Alerts (Discord, 2026-10-26); they asked for API calls, not page scraping, and a user agent (ours names the project) |
| [PS2 Radar](https://ps2radar.com/) | Second-opinion result for flagged players only | None published | Linked next to each result | ✅ capped: 50 lookups/day (site), 25/day (oracle) |
| Saerro | Probed once (#23), not used | n/a | n/a | not used |

## Daybreak Census API policy, point by point

The policy is on the Census front page. What it asks and how we meet it:

| Policy | Us |
|---|---|
| Use a registered service ID, always | ✅ `daysetps2legends` on every call (browser, bots, Workers) |
| "Please don't share your service ID" | ⚠️ The page calls Census straight from the visitor's browser, so the ID is visible in our code. Bots and Workers go through the cache Worker. Fix option: send browser calls through the cache Worker too, so the ID becomes a secret (owner decision, #61). |
| Excessive requests can get the ID cut off; avoid polling | ⚠️ Bots are paced (`CENSUS_RPM`, token buckets on the page, 1.5 s between players). The oracle reads the map and alert events every minute, which is polling. Daybreak can revoke the ID; keep the cadence modest. |
| Only for Daybreak games; no reverse engineering or access beyond what the API gives | ✅ |
| Get permission for content owned by someone else | ✅ Honu and PS2Alerts agreed (2026-10-26, see above) |
| Comply with all applicable laws | `PRIVACY.md` |
| No suggestion of Daybreak sponsorship or endorsement; no game name in a mobile app title | ✅ Footer: "Not affiliated with or endorsed by Daybreak Game Company". The installable web app is called "PS2 Elite": not an app-store app, low risk, noted. |
| Monetizing with ads is allowed | Not used |
| API and data are "as is"; Daybreak may change or end it | Our own disclaimer says the same |

Daybreak keeps all rights in its games, game data and art. The weapon images in `assets/weapons/` are Census image files converted to WebP; they are not covered by our MIT license (`NOTICE`).

## How we call each source

- **Census:** paced on the page (client-side token buckets, retries with backoff) and in the bots (`CENSUS_RPM` 40 on PS, about 5 calls per player, shared cache first). Streaming: one connection per environment, reconnect with backoff (`worker/src/monitor.js`, `oracle-worker/src/auth-watcher.js`).
- **Honu:** OK from Varunda (2026-10-26). 10 calls/min, daily cap 10,000 (`data/honu-usage.json`), only for what Census lacks. Requests carry a user agent naming this project and its GitHub page. Honu's bot check challenges Cloudflare's network but answers GitHub Actions, so Honu work for the oracle runs in Actions (`oracle-honu.yml`). That is a reason to get Varunda's explicit OK.
- **PS2Alerts:** OK from PS2Alerts (2026-10-26). About 1 request per second, resumable, history only, API endpoints only (no page scraping), own user agent (`oracle-worker/history/fetch.mjs`).
- **PS2 Radar:** flagged players only, daily caps above; the oracle rechecks a cached result after 3 days.

## Open points (owner)

1. Optional: decide whether browser Census calls should go through the cache Worker (service ID kept secret).

Closed 2026-10-26: Honu (Varunda) and PS2Alerts both agreed to the data use. PS2Alerts asked for their name as the source, which the oracle footer already gives with a link.
