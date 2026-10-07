# Shared player cache

These JSON files are the **shared** cache for [dayset.github.io/ps2-elite-kd](https://dayset.github.io/ps2-elite-kd/). Every visitor loads them from GitHub Pages.

## Layout

```
data/
  watchlist.txt          # every name ever fetched OK (deduped by tag-less slug)
  index.json             # catalog: name, slug, file, savedAt, aliases
  players/<slug>.json    # per-character payload (Honu/Census snapshot)
  load-flag.json         # Actions under-load signal ({ fetching, ts, source })
  refresh-state.json     # fetch bookkeeping (last attempt / failures per slug)
  top-killers.txt        # Honu live top killers seen by background runs (7 days)
  status.json            # current batch + last run summary
  README.md              # this file
```

## How it grows and refreshes

Automatic. A Cloudflare Worker cron (every 5 min) starts one background run of the **Refresh shared cache** Action whenever none is running. GitHub's hourly `17 * * * *` schedule is a fallback. A background run only adds **new** players: Honu's live top killers on each active PC world first (merged into `top-killers.txt`), then frequent opponents of cached players. That's up to 50 per run, until 1500 are cached. Cached players are **not** re-fetched on a schedule. `status.json` holds the current run and the last run's summary (`lastRun.newFromLive`, `liveWorlds`). `refresh-state.json` records attempts and failures per name, so a misspelled name doesn't block the queue.

On-demand: a `workflow_dispatch` with `names` (the site's Worker sends these when someone analyzes a new name or asks for fresh data; you can also use **Actions → Run workflow**) refreshes only those names. Names that fetch OK are appended to `watchlist.txt`, deduped by tag-less slug.

The static site **cannot** push cache updates from the browser. Use **Fetch fresh data** for a personal live pull; shared updates only come from this Action.

## Add a name

Analyze it on the site (the Worker queues it), or run the workflow with `names`.

## Under-load flag

Background runs don't raise the banner; `load-flag.json` stays `fetching: false` (each run's commit makes sure of it).

Browser **Analyze** / live fetch cannot write this file (GitHub Pages is static). Cross-tab browser load still uses `localStorage`.
