# PS2 Elite K/D

**PlanetSide 2 player stats and comparison.** Compare up to 10 players on one chart of K/D against enemy weapon KPM, see who holds up as the opposition gets harder, and look them up in population rankings. Free and open source: plain HTML/CSS/JS served from GitHub Pages, with no build step and no backend.

**Live:** [dayset.github.io/ps2-elite-kd](https://dayset.github.io/ps2-elite-kd/)

## Features

- **Comparison chart:** K/D vs enemy KPM per player. **📈 Raw** (cumulative: K/D vs everyone at or above each KPM, the default) or **🎚️ Smooth** (K/D vs enemies around each KPM, faded where there are few fights). Optional **👻 Ghost** lines: a dashed prediction from play style (fitted on the shared cache) that fills sparse ranges, clearly marked as not real fights.
- **Stats table:** ⚔️ iVi skill rating, 🛡️ Resist, 🏃 Activity, 🦁 Brave, ☠️ K/D, ⚙️ Mech%, 🎈 Inflation (details below), with population percentiles.
- **[Rankings](https://dayset.github.io/ps2-elite-kd/ranks.html):** every cached player ranked on the same columns, with search, compare and a distribution chart per metric.
- **Shared cache:** a GitHub Actions workflow refreshes player snapshots automatically, so most lookups load instantly without hitting the live APIs.
- **Status page** (unlisted): refresh runs, queue, a 🚩 red-flag review list (leads, never accusations) and a 🌱 "Could use a hand" list of players who might appreciate tips or a squad invite.
- Light / dark theme, share links (`?names=…` auto-runs), mobile layout.

**Data sources:** [Daybreak Census API](https://census.daybreakgames.com/) for all per-player data (killboard via `characters_event_grouped`, stats via batched `characters_stat` / `characters_stat_by_faction`, ~5 calls per player, `census-fetch.mjs`). [HONU](https://wt.honu.pw/) (Varunda) is linked for killboards and used only as a paced fallback for lifetime history Census lacks. Requests are kept polite: cached snapshots first, client-side token buckets, live fetches only when needed.

## Quick start

Serve the folder with any static file server, for example:

```bash
cd ps2-elite-kd
npx serve .          # or any static server
```

Prefer a local server (`file://` often blocks `fetch` of JSON). Tests: `npm test` (Node 18+).

## Use

1. Type names; **space** or **comma** locks a chip (click a chip to remove). The **📦 Shared cache** list (sorted by name, tags ignored, with [#] [A] [B]… headers) has a sticky **# A … Z** jump bar at the top when open — letters with no names are dimmed; tap one to glide to its header. Scrolled ~1 screen into the open list, the same round **⬆ / ⬇** buttons as the rankings page (bottom-right, `jump-btns.mjs`) jump to the list top (alphabet bar) / its last names; they hide when the list is collapsed or off screen. The chips in the names field survive a refresh (saved on every change; × and 🗑️ clear it too, so a cleared field stays empty): a `?names=` link still wins and auto-runs, and names picked after analyzing come back in the field once that graph is redrawn; without `?names=` the saved chips return without running. Green = cached / analyzed; amber = not fetched yet. On narrow portrait phones (≤600px) the chips stack one name per line; wider screens and landscape keep them inline.
2. Press **Analyze** (or Enter). Clear names with **×**.
3. The square **🔗** button (same height as Analyze) copies a `?names=…` share link; it flashes ✓ when copied. Opening that link **auto-runs Analyze** once the page is ready — friends land straight on the graph (see *Sharing* below).
4. **🏆** (left end of the 🗑️ / theme row) opens the [Rankings](ranks.html) page. **☀️ Light / 🌙 Dark** toggles a creamy haze light theme (~15% white).
5. **Fetch fresh data** skips caches and hits Census live. Unchecked on every load.

Lookup order per name:

1. Shared `./data/players/<slug>.json` (catalog in `data/index.json`, filled by GitHub Actions)
2. Browser `localStorage` payload cache (~30-day TTL) — personal to that browser only
3. Live Census (service ID in `config.mjs`, paced client-side)

Max 10 names. Deep link: `?names=JustV6me,ChrisJTTR`.

## Rankings

[ranks.html](ranks.html) — population ranks across the whole shared cache (one row per player). Same ✨ Adjusted columns as the main page (⚔️ iVi default sort, optional debug columns via the shared "show older debug stats" checkbox), with a **#** rank column and a small **pN** population percentile next to each number (share of cached players below that value). Search filters by name (ignores outfit tags); check up to 10 players and hit **Compare** (or click a name) to open them on the main chart; ticks are remembered across reloads (and after Compare) until you untick them or press **✕ Clear**. The big **‹ 🔍** button (far left of the toolbar and again at the left of the footer, "Back to player search" hint on hover) goes back to the main page. While scrolling the long list, round **⬆ / ⬇** buttons (bottom-right) jump to the top / bottom of the rankings (smooth; instant with reduced motion). A collapsible **📊 Distribution** chart above the table plots any metric (Adjusted, debug or public KD / KPM / Acc / HSR / IvI; sorting by a column switches to it): bars = % of players per value range (~30 nice bins over p1–p99, with `<` / `>` tail bins for outliers; below-scale ⚔️ iVi < 0 sits in the lowest one), a cumulative % line on the right axis, and median / p90 / p99 markers. Hover or tap a bar for "X% of players have … (N players); top Y% from here". Picked players — or a search matching ≤ 5 — appear as coloured markers in the main chart's player palette. Helpers: `dist.mjs` (tested), colours: `palette.mjs` (shared with the main chart). Numbers come from a precomputed `data/ranks.json` rebuilt by `scripts/build-ranks.mjs` on every cache refresh — the browser never fetches a thousand player files.

### Sharing

- A URL with `?names=…` (what **🔗** copies) **auto-runs Analyze** after the page and shared-cache index load — exactly like pressing 🔍 Analyze: progress popup with countdown and abort ×, skipped-name warning for names that don't exist (the rest are still graphed), then a smooth scroll to the results.
- More than 10 names in the link → the first 10 become chips and are analysed; the "10 players limit reached" hint stays visible.
- The auto-run never uses **Fetch fresh data** (forced off), runs once (no repeat if the same set is already graphed or the user already started a run), and does **not** happen on a plain URL — the last comparison restored from localStorage only fills the chips and waits for Analyze.

## Layout

| Block | What |
|--------|------|
| **Public (Census/Honu)** | Collapsed by default — KD, KPM, own KPM, Acc %, HSR %, IvI |
| **Adjusted (calculated)** | Default columns: ⚔️ iVi, 🛡️ Resist, 🏃 Activity, 🦁 Brave, ☠️ K/D, ⚙️ Mech%, 🎈 Inflation. Ticking **show older debug stats** (footer, right of the repo link; remembered in localStorage) appends 🎯🎈 ivi, eKPM, own KPM, 📊 COI, 📉 Slope |
| Chart | Projected K/D vs enemy weapon KPM (bands Easy / Hard at 0.75 / 1.50). Vertical **zoom** slider (top-right): middle / **Auto** = full graph, auto-fit; **up** zooms hard into the start of the graph — X min stays 0 while X max shrinks fast (≈0.71 at +1, 0.25 at the top) and Y re-fits to the visible left side (lines leaving the right edge are clipped); **down** keeps full X and flattens Y to fit extreme / high-tier K/D |
| Footer | Repo link (with the **show older debug stats** checkbox on the right) + thanks to [HONU](https://wt.honu.pw/) / Varunda |

Click any column header to sort (names alphabetical; metrics numeric). Default sort is **⚔️ iVi** descending (sorting by a debug column falls back to it when the debug columns are hidden). Hover headers for short hints. Each value also shows a small dimmed % against its column reference (per-column `pctDir`): by default **−N%** = gap below the highest value; for **🎈 Inflation** (`pctDir: "low"`, `pctRefFloor: 1.0`) the reference is max(lowest value, 1.0) and others show **+N%** above it; values at/below the reference show no % (below 1.0 = no inflation). No % on the reference value, on ⚔️ iVi cells shown as 0, or when the reference is ≤ 0 (e.g. 📉 Slope); on phones the % sits under the number. Tables sit above the graph.

### Adjusted metrics (short)

Visible by default:

- **⚔️ iVi** — ivi adjusted for own kill speed (`adjs`): own KPM 0.8–1.4 unchanged; above, `+300 × log2(own/1.4)^1.5` points; below, a positive 🎯🎈 ivi is multiplied by `max((own/0.8)^0.415, 0.5)` (at most halved, never flipped negative; a score already ≤ 0 gets no extra penalty). Values below zero display as **0** ("Below the rating scale") and sort to the bottom
- **🛡️ Resist** — Resistance: hardness of the players you die to (Resistance Factor)
- **🏃 Activity** — volume of hard fights (☠️ K/D × own KPM)
- **🦁 Brave** — formerly LionHeart: 🏃 Activity × shifted slope pressure under hard opposition
- **☠️ K/D** — resistance-weighted K/D
- **⚙️ Mech%** — projected mech share implied by Resist
- **🎈 Inflation** — global KD ÷ KD among deaths vs opponents ≥ **0.5** weapon KPM (avg planetman ~0.35; soft padding above this)

Older debug stats (hidden unless the footer box is ticked):

- **🎯🎈 ivi** — opposition-weighted IvI before the speed adjustment (public IvI × Resistance tempering); the 🎈 flags that the score is still inflated. The status page red-flag bin uses this value
- **eKPM / own KPM** — average enemy weapon pace vs your pace (kept separate)
- **📊 COI** — combat output index derived from Resist
- **📉 Slope** — whole-curve death-weighted angle (K/D vs enemy KPM); negative = K/D falls as opposition hardens

## Shared cache (GitHub Actions)

The static Pages site cannot write `data/`. Shared snapshots are committed automatically by the **Refresh shared cache** Action, with no manual steps. Goal: every PC player who actually plays (target up to ~12,000), kept fresh by activity.

- **Driver:** a background run that added players and still has names left dispatches the next run itself, so runs go back to back (~10 min each). If the chain stops (outage, empty queue), the Cloudflare Worker (`ps2-elite-kd-cache`) restarts it: its cron checks every 5 min (plus a fallback check on site visits) and dispatches a run when none is queued/running and the last one ended >1 min ago. GitHub's own `17 * * * *` schedule is a last fallback; it hasn't been firing.
- **Discovery (Census only, `scripts/discovery.mjs`):** once a day a login sweep reads every PC character that logged in since the last sweep (`character?times.last_login=]<cursor>&c:sort=times.last_login`, 1,000 per call, keyset paging; the first sweep looks back 7 days). Cached players found there only get their last-activity time (`last` in `data/index.json`) updated. Others with ≥ 30 lifetime minutes get a fight check: `characters_stat_history` kills + deaths for 100 ids per call, day buckets d01–d07. Only players with **≥ 100 kills+deaths in the last 7 days** qualify, new accounts included (no free pass for being new). Queue in `data/discovery.json`: new accounts (< 91 days) that play first, then most fights; entries expire after 14 days. The sweep is resumable and takes at most `SWEEP_SLICE_SEC` (60 s) per run. Roughly 60–80 Census calls per daily sweep (more on the first, 7-day one); no Honu calls. The old Honu top-killers seed and the opponent crawl are retired.
- **Cap:** `cap` in `data/discovery.json`: steps 3,000 → 6,000 → 9,000 → 12,000; it moves to the next step automatically only once caught up (index at the cap, format-sync backlog empty, due refreshes fit in one run). Growth also stops early if the discovery queue runs dry (only players with ≥ 100 kills+deaths in the last 7 days qualify). Expected size at 12,000: ~210 MB of player files (~17.5 KB each), well under the 700 MB size warning. Max 50 new per run (`GROW_MAX`).
- **Background runs (~9 min, driven by `data/schedule.json`):** the one-time format sync / 200-opponent upgrade goes first; while it lasts new names only get leftover time. After that, when both are waiting, due refreshes get the first half of a run and new names the rest. **Refresh tiers** by last activity: played this week → weekly, this month → every 2 weeks, 1–12 months → monthly, 🪦 > 1 year → never (only a user lookup / Fetch fresh; also skipped by the format sync). Unknown activity = weekly. On-demand `/add` and the browser's "Fetch fresh" are unaffected. The Worker cron reads `schedule.json` every 5 min and dispatches only when a run is due (growth chains runs back to back; refresh-only runs ~hourly; the daily sweep wakes it too). Census uses the site's service ID `s:daysetps2legends` (`config.mjs` for the browser, `CENSUS_SERVICE_ID` in the workflow/Worker) and is paced client-side at ≤ 60 calls/min. New names join `watchlist.txt`.
- **Honu daily cap:** all Honu calls (assists, full XP for requested players, history fallback) count against `HONU_DAILY_CAP` (1,000 per UTC day, `data/honu-usage.json`), paced at ≤ 20/min. 🔎 Session forensics has its own 150-call slice inside the 1,000 (`FORENSICS_DAILY_RESERVE`): everything else stops at 850 unless forensics has already used its slice. When it is used up, assists / XP wait for the next day and the old values stay.
- **Size watch:** each run writes `status.json` → `size` (`repoBytes` = GitHub repo size incl. history, `dataBytes`, `playersBytes`, `playerFiles`, `warnAtBytes` = 700 MB, `at`) and `sizeWarning` (true once the repo or data/ reaches 700 MB). build-log shows a 💾 size line. Plan at that point: manual backup first, then move player files to Cloudflare (R2), no history rewrite before the backup.
- **Opponent sample:** each player is scored on their top **200** opponents by kills + deaths (`OPPONENT_TOP_N` in `census-fetch.mjs`, shared by the browser and the refresh; ~8 Census calls per player, opponent stats in batches of 120 ids). Files saved before 2026-10-09 used the top 50 (`top: 50`, or no `top` field); they are kept as they are, marked with a subtle ◦ on Rankings and in the stats table, and upgraded to 200 when the format sync / weekly refresh next re-fetches them (they go first among players that are due anyway; no extra runs). New names and "Fetch fresh" always use 200.
- **Account flairs:** `flairs.mjs` holds one list of rules (`FLAIR_RULES`), so more can be added later. 🪦 = no activity for over a year; 👴🏽 = account 8+ years old and active in the last year. 👶 = account created in the last ~3 months (91 days). One flair per player, priority 🪦 > 👴🏽 > 👶. Shown only in the name list under the graph, in place of the colored dot (the name keeps its line color); description on hover. Dates come from Census `character.times` (creation, last_save / last_login), which the normal character lookup already returns, stored as `player.times = { created, last }` (UNIX seconds). No dates → no flair. Older files were filled once with `node scripts/backfill-times.mjs` (100 characters per Census call).
- **🙈 Hidden from rankings:** `data/hidden.json` (owner-edited; key = player name or character id → `{ reason, at }`) leaves players out of `ranks.json` / ranks.html (tables, percentiles, distributions). They stay in the cache, can still be analyzed on the main page, still count in 🚩 red flags and the 🧪 outlier guard, and are listed on the build log.
- **On-demand:** a dispatch with `names` (from the Worker, or **Actions → Run workflow**) refreshes only those names at 2 req/s. Names that fetch OK are added to `watchlist.txt`; failures are left out. These runs queue behind a running background run and never cancel it.
- **One commit per run** (Pages allows ~10 builds/hour). No commit if no player file changed.
- Real not-found names (no character, invalid name, empty killboard) are never retried by discovery. Other failures (timeouts, outages) are retried at most 3 times, 15 min apart (tracked in `data/refresh-state.json`). A player is not saved if more than 10% of its opponent lookups fail, so rate limits can't save fake 0-KPM curves. If Census is unreachable, the run stops early and keeps the old data (retried 30 min later).
- `status.json` → `lastRun.batch` lists each planned name with its source (`discovery-new`, `discovery`, `refresh`, `retry`, `on-demand`) and result (done / failed / not-found / pending), committed with the run's data.
- Each run re-enables the workflow, so GitHub's 60-day inactivity rule can't switch it off.

The main page has no "server under load" banner (removed 2026-10-09: Census fetches are fast and background runs use their own connection). The only load messages are the real Census ones: "Daybreak Census is busy, retrying…", the cached fallback and ↻ Try again.

## Files

```
ps2-elite-kd/
  index.html  ranks.html  styles.css  app.js  math.mjs  dist.mjs  palette.mjs
  test/math.test.mjs      # node --test regression suite
  package.json            # npm test / npm run check
  assets/                 # dark + light placeholder graphs
  data/
    index.json            # shared catalog
    ranks.json            # precomputed rankings (scripts/build-ranks.mjs)
    watchlist.txt         # names in the hourly rotation
    refresh-state.json    # rotation bookkeeping
    discovery.json        # login-sweep cursor, discovery queue, cap step
    honu-usage.json       # Honu calls today (daily cap)
    players/<slug>.json
  scripts/refresh-cache.mjs
  scripts/discovery.mjs     # Census discovery + refresh tiers + cap steps
  scripts/build-ranks.mjs   # data/ranks.json from the cache (run by the refresh workflow)
  .github/workflows/refresh-cache.yml
```

## Tests

Pure math lives in `math.mjs` (imported by the browser `app.js` module). Run:

```bash
npm test          # node --test test/*.test.mjs
npm run check     # syntax-check app.js, math.mjs, refresh + ranks scripts
npm run build:ranks  # rebuild data/ranks.json locally
```

Coverage includes pooled/sliceAt, Inflation@0.5, curveSlope (deaths>0), LionHeart bounds, adjIvI, and yScale containment for cheater spikes / low players.

## Credits

Data via the [Daybreak Census API](https://census.daybreakgames.com/) and [HONU](https://wt.honu.pw/) (Varunda). History: the chart logic began as an earlier Python elite-K/D tool, since ported to JavaScript.

## License

[MIT](LICENSE) © 2026 Dayset. Free to use, provided "as is" with no warranty. All numbers are automated estimates, not facts.
