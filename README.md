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

1. Type names; **space** or **comma** locks a chip (click a chip to remove). Green = cached / analyzed; amber = not fetched yet.
2. Press **Analyze** (or Enter). Clear names with **×**.
3. **Copy link** builds `?names=…` for sharing.
4. **☀️ Light / 🌙 Dark** toggles a creamy haze light theme (~15% white).
5. **Fetch fresh data** skips caches and hits Census + Honu live. Unchecked on every load.

Lookup order per name:

1. Shared `./data/players/<slug>.json` (catalog in `data/index.json`, filled by GitHub Actions)
2. Browser `localStorage` payload cache (~30-day TTL) — personal to that browser only
3. Live Census + Honu when network/CORS allow

Max 10 names. Deep link: `?names=JustV6me,ChrisJTTR`.

## Layout

| Block | What |
|--------|------|
| **Public (Census/Honu)** | Collapsed by default — KD, KPM, own KPM, Acc %, HSR %, IvI |
| **Adjusted (calculated)** | ivi, KD, eKPM, own KPM, Resistance, Activity, COI, Mech%, Slope, LionHeart, Inflation |
| Chart | Projected K/D vs enemy weapon KPM (bands Easy / Hard at 0.75 / 1.50). Vertical **Y zoom** slider (top-right): middle = auto-fit; up enlarges weak curves; down fits extreme / high-tier K/D |
| Footer | Repo link + thanks to [HONU](https://wt.honu.pw/) / Varunda |

Click any column header to sort (names alphabetical; metrics numeric). Default sort is **ivi** descending. Hover headers for short hints. Tables sit above the graph.

### Adjusted metrics (short)

- **ivi** — opposition-weighted IvI (public IvI × Resistance tempering)
- **KD** — resistance-weighted K/D
- **eKPM / own KPM** — average enemy weapon pace vs your pace (kept separate)
- **Resistance / Activity / COI / Mech%** — hardness of deaths, volume of hard fights, combat output, projected mech share
- **Slope** — whole-curve death-weighted angle (K/D vs enemy KPM); negative = K/D falls as opposition hardens
- **LionHeart** — Activity × shifted slope pressure under hard opposition
- **Inflation** — global KD ÷ KD among deaths vs opponents ≥ **0.5** weapon KPM (avg planetman ~0.35; soft padding above this)

## Shared cache (GitHub Actions)

The static Pages site cannot write `data/`. Shared snapshots are committed automatically by the **Refresh shared cache** Action, with no manual steps:

- **Hourly** at :17 UTC (`17 * * * *`). Each run refreshes the **20 stalest** names from `data/watchlist.txt` + `index.json` (never-fetched first, then oldest `savedAt`), so all ~225 rotate about every 11 hours. Honu requests are paced to 2/s (Honu rate-limits Actions IPs), so a run takes ~15–20 min, with a 30-min internal budget.
- Misspelled/unknown names are skipped and their old files are kept (attempts are tracked in `data/refresh-state.json`). A player is also kept as-is if more than 10% of its opponent lookups fail, so rate limits can't save fake 0-KPM curves. A run only fails if nothing refreshed because Census/Honu were down.
- While it runs, `data/load-flag.json` is `fetching: true`. It's cleared in the same commit as the new data, even if the run fails.
- Each run also re-enables the workflow, so GitHub's 60-day inactivity rule can't switch the schedule off.
- **On-demand:** a dispatch with `names` (from the site's Worker when someone analyzes a new name, or **Actions → Run workflow**) refreshes only those names. Names that fetch OK are added to `watchlist.txt`; failures are left out. These runs queue behind a running batch and never cancel it.

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
