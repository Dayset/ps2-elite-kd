# Shared player cache

These JSON files are the **shared** cache for [dayset.github.io/ps2-elite-kd](https://dayset.github.io/ps2-elite-kd/). Every visitor loads them from GitHub Pages.

## Layout

```
data/
  watchlist.txt          # names for scheduled / empty-input refreshes
  index.json             # catalog: name, slug, file, savedAt, aliases
  players/<slug>.json    # per-character payload (Honu/Census snapshot)
  load-flag.json         # Actions under-load signal ({ fetching, ts, source })
  refresh-state.json     # rotation bookkeeping (last attempt / failures per slug)
  README.md              # this file
```

## How it refreshes

Automatic. The **Refresh shared cache** Action runs hourly (`17 * * * *` UTC). Each run refreshes the 30 stalest names (never-fetched first, then oldest `savedAt`), so the whole watchlist rotates every few hours. `refresh-state.json` records the last attempt and failures per name, so a misspelled name doesn't block the queue. Failed names keep their old files.

On-demand: a `workflow_dispatch` with `names` (the site's Worker sends these when someone analyzes a new name; you can also use **Actions → Run workflow**) refreshes only those names. Names that fetch OK are appended to `watchlist.txt`, deduped by tag-less slug.

The static site **cannot** push cache updates from the browser. Use **Fetch fresh data** for a personal live pull; shared updates only come from this Action.

## Add a name to the watchlist

Edit `watchlist.txt` and commit. New names are fetched first on the next hourly run.

## Under-load flag

While the refresh workflow runs, Actions commits `load-flag.json` with `fetching: true` so open site tabs can show *“The server is under load…”*. At the end of the job (`if: always()`), it commits `fetching: false`.

Browser **Analyze** / live fetch cannot write this file (GitHub Pages is static). Cross-tab browser load still uses `localStorage`.
