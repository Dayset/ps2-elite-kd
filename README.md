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
| Chart | Projected K/D vs enemy weapon KPM (bands Easy / Hard at 0.75 / 1.50) |
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

The static Pages site cannot write `data/`. Shared snapshots are committed by **Refresh shared cache**:

1. Repo → **Actions** → **Refresh shared cache** → **Run workflow**
2. Optional `names` input; empty uses `data/watchlist.txt` + existing index
3. Job sets `data/load-flag.json` (`fetching: true`), refreshes `data/players/*.json` + `index.json`, then clears the flag

Schedule: **hourly** at minute 0 UTC (`0 * * * *`). Manual runs anytime.

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
    watchlist.txt         # scheduled refresh names
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
