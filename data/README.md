# Shared player cache

These JSON files are the **shared** cache for [dayset.github.io/ps2-elite-kd](https://dayset.github.io/ps2-elite-kd/). Every visitor loads them from GitHub Pages.

## Layout

```
data/
  watchlist.txt          # names for scheduled / empty-input refreshes
  index.json             # catalog: name, slug, file, savedAt, aliases
  players/<slug>.json    # per-character payload (Honu/Census snapshot)
  load-flag.json         # Actions under-load signal ({ fetching, ts, source })
  README.md              # this file
```

## How to refresh

1. Open the repo on GitHub → **Actions** → **Refresh shared cache**.
2. **Run workflow**.
3. Optional: pass names (e.g. `JustV6me LionHeart`) in the `names` input. Leave empty to refresh `watchlist.txt` plus anyone already in `index.json`.
4. The workflow fetches Census + Honu, writes `data/players/*.json`, updates `index.json`, and commits.

An hourly schedule also runs (minute 0 UTC: `0 * * * *`).

The static site **cannot** push cache updates from the browser. Use **Fetch fresh data** for a personal live pull; shared updates only come from this Action.

## Add a name to the watchlist

Edit `watchlist.txt`, commit, then run the workflow (or wait for the schedule).

## Under-load flag

While the refresh workflow runs, Actions commits `load-flag.json` with `fetching: true` so open site tabs can show *“The server is under load…”*. At the end of the job (`if: always()`), it commits `fetching: false`.

Browser **Analyze** / live fetch cannot write this file (GitHub Pages is static). Cross-tab browser load still uses `localStorage`.
