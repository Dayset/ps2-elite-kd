# How the shared cache works

The static Pages site can't write to `data/`. Instead, a GitHub Actions workflow commits player snapshots automatically, with no manual steps. The goal is every PC player who actually plays (up to about 12,000), kept fresh based on how active they are.

## Components

| Piece | Role |
|---|---|
| `.github/workflows/refresh-cache.yml` | Runs the **Refresh shared cache** Action. |
| `scripts/refresh-cache.mjs` | The refresh itself. |
| `scripts/discovery.mjs` | Finds new players and applies the refresh tiers and cap. |
| `scripts/build-ranks.mjs` | Builds `data/ranks.json` after each refresh. |
| Cloudflare Worker `ps2-elite-kd-cache` | Restarts the chain when it stops, and proxies `/census` for Actions. |

## Runs

- **Background runs** take about 9 to 10 minutes each, driven by `data/schedule.json`.
- **Chaining:** a run that added players and still has names left starts the next run itself, so runs go back to back.
- **Restarting:** if the chain stops (an outage, or an empty queue), the Worker restarts it. Its cron checks every 5 minutes, plus a fallback check on site visits. It dispatches a run when none is queued or running and the last one finished more than a minute ago.
- GitHub's own `17 * * * *` schedule is a last-resort fallback. It hasn't been firing.
- **Priority:** a one-time format sync (and the 200-opponent upgrade) runs first. While it lasts, new names only get leftover time. After that, when both are waiting, due refreshes get the first half of a run and new names get the rest.
- **On-demand runs:** a dispatch with `names` (from the Worker, or **Actions → Run workflow**) refreshes only those names, at 2 requests per second. Names that succeed are added to `watchlist.txt`. These runs queue behind a running background run and never cancel it.
- **One commit per run**, because GitHub Pages allows about 10 builds per hour. No commit happens if no player file changed.
- Each run re-enables the workflow, so GitHub's 60-day inactivity rule can't turn it off.

## Discovery

Discovery uses Census only, through `scripts/discovery.mjs`.

1. **Login sweep:** once a day, the sweep reads every PC character that logged in since the last sweep. It uses keyset paging, 1,000 per call. The first sweep looks back 7 days.
2. **Known players** found in the sweep only get their last-activity time (`last` in `data/index.json`) updated.
3. **New players** with at least 30 lifetime minutes get a fight check. `characters_stat_history` returns kills and deaths for 100 IDs per call, in day buckets d01–d07.
4. **Qualifying players** need at least **100 kills + deaths in the last 7 days**. New accounts qualify too, with no special exemption.
5. **Queue:** stored in `data/discovery.json`. New accounts (under 91 days old) go first, then the most active. Entries expire after 14 days.
6. **Limits:** the sweep is resumable and runs for at most `SWEEP_SLICE_SEC` (60 seconds) per run. A daily sweep makes roughly 60–80 Census calls, more on the first one. No Honu calls are made.

The old Honu top-killers seed and the opponent crawl are retired.

## Refresh tiers

Players are refreshed based on their last activity:

| Last activity | Refresh |
|---|---|
| Played this week | Weekly |
| Played this month | Every 2 weeks |
| 1–12 months ago | Monthly |
| 🪦 More than a year ago | Never (only a user lookup or Fetch fresh) |

Unknown activity counts as weekly. Players in the 🪦 tier are also skipped by the format sync. On-demand `/add` and the browser's "Fetch fresh" are unaffected.

Census uses the site's service ID `s:daysetps2legends`. It's set in `config.mjs` for the browser and in `CENSUS_SERVICE_ID` for the workflow and Worker. Requests are paced at 60 or fewer calls per minute. New names are added to `watchlist.txt`.

## Cap

The cap lives in `data/discovery.json`. It steps from 3,000 to 6,000, 9,000, and so on, up to **24,000** (3,000 per step).

- The cap moves to the next step as soon as the index reaches it.
- Refresh backlog doesn't hold it back.
- At 24,000 players, the estimated size is about 420 MB, under the 700 MB warning.

The step values are in `scripts/discovery.mjs` as `CAP_STEPS`. Changing them usually also means updating the workflow comments, the tests and this doc.

## Honu daily cap

All Honu calls count against `HONU_DAILY_CAP`: 10,000 per UTC day, tracked in `data/honu-usage.json`. They're paced at 10 per minute or fewer.

- The Honu calls cover assists, full XP for requested players, and the history fallback.
- 🔎 Session forensics has its own 150-call slice inside the 10,000 (`FORENSICS_DAILY_RESERVE`).
- Everything else stops at 9,850, unless forensics has already used its slice.
- When the cap is used up, assists and XP wait until the next day and the old values stay.

The cap is a temporary safety net and will be removed later.

## Size watch

Each run writes `status.json` → `size`:

- `repoBytes`: GitHub repo size, including history
- `dataBytes`
- `playersBytes`
- `playerFiles`
- `warnAtBytes`: 700 MB
- `at`

`sizeWarning` turns true once the repo or `data/` reaches 700 MB. The build log shows a 💾 size line.

If the warning fires, back up manually first. Then move player files to Cloudflare R2. Don't rewrite history before the backup.

## Player data

- **Opponent sample:** each player is scored on their top **200** opponents by kills + deaths (`OPPONENT_TOP_N` in `census-fetch.mjs`). That's about 8 Census calls per player, with opponent stats fetched in batches of 120 IDs.
- **Older files:** files saved before 2026-10-09 used the top 50 (`top: 50`, or no `top` field). They stay as they are, marked with a subtle ◦ on Rankings and in the stats table. They're upgraded to 200 when the format sync or a weekly refresh next re-fetches them. New names and Fetch fresh always use 200.
- **Account flairs:** `flairs.mjs` holds the rules in `FLAIR_RULES`, so more can be added later. Dates come from Census `character.times`, stored as `player.times = { created, last }` (UNIX seconds). Players with no dates get no flair. Older files were filled once with `node scripts/backfill-times.mjs` (100 characters per Census call).
- **Hidden players:** `data/hidden.json` is owner-edited. Its key is a player name or character ID, mapped to `{ reason, at }`. Hidden players are left out of `ranks.json` and the Rankings (tables, percentiles, distributions). They stay in the cache, can still be analysed on the main page, still count in 🚩 red flags and the 🧪 outlier guard, and are listed on the build log.

## Failures

- **Not-found names** (no character, invalid name, or an empty killboard) are never retried by discovery.
- **Other failures** (timeouts, outages) are retried at most 3 times, 15 minutes apart. Retry state is tracked in `data/refresh-state.json`.
- **Partial data:** a player isn't saved if more than 10% of their opponent lookups fail. This stops incomplete lookups (for example, rate limiting) from producing curves with missing opponent data.
- **Outages:** if Census is unreachable, the run stops early and keeps the old data. It's retried 30 minutes later.
- `status.json` → `lastRun.batch` lists each planned name with its source (`discovery-new`, `discovery`, `refresh`, `retry`, `on-demand`) and its result (done, failed, not-found or pending), committed with the run's data.

The main page has no "server under load" banner. It was removed on 2026-10-09, because Census fetches are fast and background runs use their own connection. The only load messages are the real Census ones: "Daybreak Census is busy, retrying…", the cached fallback, and ↻ Try again.

## File tree

```
ps2-elite-kd/
  index.html  rankings.mjs  ranks.html (redirect)  styles.css  app.js  math.mjs  dist.mjs  palette.mjs
  test/math.test.mjs        # node --test regression suite
  package.json              # npm test / npm run check
  assets/                   # dark + light placeholder graphs
  docs/                     # these guides
  data/
    index.json              # shared catalog
    ranks.json              # precomputed rankings (scripts/build-ranks.mjs)
    watchlist.txt           # names in the hourly rotation
    refresh-state.json      # rotation bookkeeping
    discovery.json          # login-sweep cursor, discovery queue, cap step
    honu-usage.json         # Honu calls today (daily cap)
    players/<slug>.json
  scripts/refresh-cache.mjs
  scripts/discovery.mjs     # Census discovery + refresh tiers + cap steps
  scripts/build-ranks.mjs   # data/ranks.json from the cache (run by the refresh workflow)
  .github/workflows/refresh-cache.yml
```

## 🪖 Infantry split

- `player.infantry` (infantry.mjs, v2): kills split by Census lifetime weapon stats into on-foot, vehicle seat/turret and other. Vehicle kills are counted once per vehicle (the item 0 total row, or the seat-weapon sum if larger).
- MAX arm weapons (static `MAX_ITEMS`, Census categories 9/10/20–23) count as infantry; `maxKills` / `maxShare` keep them visible.
- Normal refreshes store the full summary (2 calls). Older files are filled with `node scripts/backfill-infantry.mjs` (one kills-only call per 10 players, `part: "kills"`: deaths / time stay null until the next refresh).
- `ranks.json` carries `inf` / `infMax` / `infVeh` (% of kills, null below 100 kills) for the public 🪖 Infantry column, plus `vcut` (vehicle + MAX cut % already applied to `adjs`; uncapped, share − 10% per part, no visible mark). Tags (infantry / mixed / vehicle) stay build-log only; no automatic tag is shown publicly.
