# PS2 Elite K/D

Opposition-weighted K/D chart for PlanetSide 2: how projected K/D holds as enemy weapon KPM rises. Vanilla HTML/CSS/JS — no build step, CDN, or runtime Python.

**Live:** [dayset.github.io/ps2-elite-kd](https://dayset.github.io/ps2-elite-kd/)

## Quick start

```bash
cd ps2-elite-kd
python3 -m http.server 8080
# open http://127.0.0.1:8080/
```

Prefer a local server (`file://` often blocks `fetch` of JSON).

## Use

1. Type names; **space** or **comma** locks a chip (click a chip to remove). Green = cached / analyzed; amber = not fetched yet. On narrow portrait phones (≤600px) the chips stack one name per line; wider screens and landscape keep them inline.
2. Press **Analyze** (or Enter). Clear names with **×**.
3. The square **🔗** button (same height as Analyze) copies a `?names=…` share link; it flashes ✓ when copied. Opening that link **auto-runs Analyze** once the page is ready — friends land straight on the graph (see *Sharing* below).
4. **☀️ Light / 🌙 Dark** toggles a creamy haze light theme (~15% white).
5. **Fetch fresh data** skips caches and hits Census + Honu live. Unchecked on every load.

Lookup order per name:

1. Shared `./data/players/<slug>.json` (catalog in `data/index.json`, filled by GitHub Actions)
2. Browser `localStorage` payload cache (~30-day TTL) — personal to that browser only
3. Live Census + Honu when network/CORS allow

Max 10 names. Deep link: `?names=JustV6me,ChrisJTTR`.

### Sharing

- A URL with `?names=…` (what **🔗** copies) **auto-runs Analyze** after the page and shared-cache index load — exactly like pressing 🔍 Analyze: progress popup with countdown and abort ×, skipped-name warning for names that don't exist (the rest are still graphed), then a smooth scroll to the results.
- More than 10 names in the link → the first 10 become chips and are analysed; the "10 players limit reached" hint stays visible.
- The auto-run never uses **Fetch fresh data** (forced off), runs once (no repeat if the same set is already graphed or the user already started a run), and does **not** happen on a plain URL — the last comparison restored from localStorage only fills the chips and waits for Analyze.

## Layout

| Block | What |
|--------|------|
| **Public (Census/Honu)** | Collapsed by default — KD, KPM, own KPM, Acc %, HSR %, IvI |
| **Adjusted (calculated)** | Default columns: ⚔️ iVi, 🛡️ Resist, 🔥 Active, 🦁 Brave, ☠️ K/D, ⚙️ Mech%, 🎈 Inflation. Ticking **show older debug stats** (footer, right of the repo link; remembered in localStorage) appends 🎯🎈 ivi, eKPM, own KPM, 📊 COI, 📉 Slope |
| Chart | Projected K/D vs enemy weapon KPM (bands Easy / Hard at 0.75 / 1.50). Vertical **zoom** slider (top-right): middle / **Auto** = full graph, auto-fit; **up** zooms hard into the start of the graph — X min stays 0 while X max shrinks fast (≈0.71 at +1, 0.25 at the top) and Y re-fits to the visible left side (lines leaving the right edge are clipped); **down** keeps full X and flattens Y to fit extreme / high-tier K/D |
| Footer | Repo link (with the **show older debug stats** checkbox on the right) + thanks to [HONU](https://wt.honu.pw/) / Varunda |

Click any column header to sort (names alphabetical; metrics numeric). Default sort is **⚔️ iVi** descending (sorting by a debug column falls back to it when the debug columns are hidden). Hover headers for short hints. Each value also shows a small dimmed % against its column reference (per-column `pctDir`): by default **−N%** = gap below the highest value; for **🎈 Inflation** (`pctDir: "low"`, `pctRefFloor: 1.0`) the reference is max(lowest value, 1.0) and others show **+N%** above it; values at/below the reference show no % (below 1.0 = no inflation). No % on the reference value, on ⚔️ iVi cells shown as 0, or when the reference is ≤ 0 (e.g. 📉 Slope); on phones the % sits under the number. Tables sit above the graph.

### Adjusted metrics (short)

Visible by default:

- **⚔️ iVi** — ivi adjusted for own kill speed (`adjs`): own KPM 0.8–1.4 unchanged; above, `+300 × log2(own/1.4)^1.5` points; below, a positive 🎯🎈 ivi is multiplied by `max((own/0.8)^0.415, 0.5)` (at most halved, never flipped negative; a score already ≤ 0 gets no extra penalty). Values below zero display as **0** ("Below the rating scale") and sort to the bottom
- **🛡️ Resist** — Resistance: hardness of the players you die to (Resistance Factor)
- **🔥 Active** — Activity: volume of hard fights (☠️ K/D × own KPM)
- **🦁 Brave** — formerly LionHeart: 🔥 Active × shifted slope pressure under hard opposition
- **☠️ K/D** — resistance-weighted K/D
- **⚙️ Mech%** — projected mech share implied by Resist
- **🎈 Inflation** — global KD ÷ KD among deaths vs opponents ≥ **0.5** weapon KPM (avg planetman ~0.35; soft padding above this)

Older debug stats (hidden unless the footer box is ticked):

- **🎯🎈 ivi** — opposition-weighted IvI before the speed adjustment (public IvI × Resistance tempering); the 🎈 flags that the score is still inflated. The status page red-flag bin uses this value
- **eKPM / own KPM** — average enemy weapon pace vs your pace (kept separate)
- **📊 COI** — combat output index derived from Resist
- **📉 Slope** — whole-curve death-weighted angle (K/D vs enemy KPM); negative = K/D falls as opposition hardens

## Shared cache (GitHub Actions)

The static Pages site cannot write `data/`. Shared snapshots are committed automatically by the **Refresh shared cache** Action, with no manual steps. Goal: grow the cache (1000+ players). Background runs only add **new** players and never re-fetch cached ones.

- **Driver:** a background run that added players and still has names left dispatches the next run itself, so runs go back to back (~10 min each). If the chain stops (outage, empty queue), the Cloudflare Worker (`ps2-elite-kd-cache`) restarts it: its cron checks every 5 min (plus a fallback check on site visits) and dispatches a run when none is queued/running and the last one ended >1 min ago. GitHub's own `17 * * * *` schedule is a last fallback; it hasn't been firing.
- **Discovery (~9 min per run):** the run reads Honu's live **top killers** on every active PC world (SignalR hub `wt.honu.pw/ws/data`, 120-min window, 8 per faction) and merges them into `data/top-killers.txt` (name, world, first/last seen, times seen, best KPM; kept 7 days). It fetches names that aren't cached yet, most-seen and best-KPM first. When that list runs short, it falls back to frequent opponents from cached killboards. Caps: max 50 new per run, stops at 1500 cached. Honu is paced to 1 req/s with 429 backoff. New names join `watchlist.txt`.
- **No scheduled refresh of cached players.** A cached player is only re-fetched when someone asks for fresh data (the Worker dispatches it on demand).
- **On-demand:** a dispatch with `names` (from the Worker, or **Actions → Run workflow**) refreshes only those names at 2 req/s. Names that fetch OK are added to `watchlist.txt`; failures are left out. These runs queue behind a running background run and never cancel it.
- **One commit per run** (Pages allows ~10 builds/hour). No commit if no player file changed. Background runs don't raise the main page's under-load banner.
- Real not-found names (no character, invalid name, empty killboard) are never retried by discovery. Other failures (timeouts, outages) are retried at most 3 times, 15 min apart (tracked in `data/refresh-state.json`). A player is not saved if more than 10% of its opponent lookups fail, so rate limits can't save fake 0-KPM curves. If Census is unreachable from the runner, the run resolves characters through Honu instead.
- `status.json` → `lastRun.batch` lists each planned name with its source (`top-killers`, `opponent-crawl`, `retry`, `on-demand`) and result (done / failed / not-found / pending), committed with the run's data.
- Each run re-enables the workflow, so GitHub's 60-day inactivity rule can't switch it off.
- Hidden status page: `/status.html` (current run, live top killers, last run, queue).

Browser Analyze still uses a local under-load note across tabs on the same device; the Actions load-flag is what other visitors see during a shared refresh.

## Files

```
ps2-elite-kd/
  index.html  styles.css  app.js  math.mjs
  test/math.test.mjs      # node --test regression suite
  package.json            # npm test / npm run check
  assets/                 # dark + light placeholder graphs
  data/
    index.json            # shared catalog
    watchlist.txt         # names in the hourly rotation
    refresh-state.json    # rotation bookkeeping
    load-flag.json        # Actions under-load signal
    players/<slug>.json
  scripts/refresh-cache.mjs
  .github/workflows/refresh-cache.yml
```

## Tests

Pure math lives in `math.mjs` (imported by the browser `app.js` module). Run:

```bash
npm test          # node --test test/*.test.mjs
npm run check     # syntax-check app.js, math.mjs, refresh script
```

Coverage includes pooled/sliceAt, Inflation@0.5, curveSlope (deaths>0), LionHeart bounds, adjIvI, and yScale containment for cheater spikes / low players.

## Credits

Killboard / meta data via [HONU](https://wt.honu.pw/) (Varunda). Chart logic ported from the earlier Python elite-K/D tool.
