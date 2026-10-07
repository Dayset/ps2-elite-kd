# PS2 Elite K/D (web)

Dark-themed SVG chart comparing PlanetSide 2 characters by how their projected K/D holds as opponent weapon-KPM rises. Port of the `save_share_png` / `absolute_target_split` / `kpm_curve` logic from the Python tool — **vanilla HTML + CSS + JS**, no build step, no CDN, no Python at runtime.

## Files

```
ps2-elite-kd/
  index.html
  styles.css
  app.js
  assets/
  data/
    index.json           # shared catalog (name, slug, file, savedAt)
    watchlist.txt        # names for scheduled Action refreshes
    load-flag.json       # Actions under-load signal
    players/<slug>.json  # shared per-player snapshots
    README.md
  scripts/refresh-cache.mjs
  .github/workflows/refresh-cache.yml
  README.md
```

## Open locally

Prefer a tiny static server (browsers often block `fetch` of local JSON under `file://`):

```bash
cd ps2-elite-kd-web
python3 -m http.server 8080
```

Then open http://127.0.0.1:8080/

On open: names are filled from `?names=`, last comparison, or demo defaults (**JustV6me**, **ChrisJTTR**) — chart stays idle until you press **Analyze** (or Enter).

Type a name and press **space** or **comma** to lock it as a chip (click a chip to remove). Green chips are cached/already analyzed; amber means not fetched yet. Click **Analyze** or press **Enter**. The page tries, in order:

1. Shared `./data/players/<slug>.json` (from `data/index.json`, refreshed by GitHub Actions)
2. Browser **localStorage** payload cache (personal overlay, ~30-day TTL)
3. Live Census + Honu (`wt.honu.pw`) when CORS/network allow

**Fetch fresh data** skips caches and hits live only. The static site cannot write the shared `data/` cache or under-load flag — use **Actions → Refresh shared cache**.

Status text reports which source was used per player.

## QoL (browser memory)

| Feature | Details |
|---------|---------|
| Name chips | Players field is a token box: space/comma locks a name; click to unlock/remove. Fetched = green, unfetched = amber. |
| Cached names | All names in the payload cache shown below the field (`ps2-elite-kd-cache-v2`, ~30-day TTL). Click to add. |
| Payload cache | After a successful load (local or live), trimmed player objects are stored in `ps2-elite-kd-cache-v2` as `{ savedAt, player }`, keyed by normalized name. Expired after 30 days. |
| Last comparison | Successful name lists saved in `ps2-elite-kd-last` and restored as chips on next open (falls back to JustV6me, ChrisJTTR); Analyze still required. |
| Clear memory | Button clears recent names, payload cache, and last comparison (confirms via `window.confirm`). |
| Copy link | Builds and copies a shareable URL like `?names=JustV6me,ChrisJTTR`. Query param is honored on load. |
| Polish | Analyze disabled while fetching with progress text; skip refetch when names unchanged (unless **Fetch fresh data**); Enter submits; Public/Adjusted stats table under the chart. |

## Share / deep link

```
https://example.github.io/ps2-elite-kd-web/?names=JustV6me,ChrisJTTR
```

Spaces or commas (also `;` / newlines). Outfit tags like `[1TC] Name` stay one token. Max 10 names per comparison.

## GitHub Pages

You can host this as a static site with no build step.

### Option A — user/org site from repo root

1. Put `index.html`, `styles.css`, `app.js`, and `data/` at the **root** of a repo (e.g. `username.github.io` or a dedicated repo).
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Branch: `main` (or `master`), folder: **/ (root)**.
4. Site URL: `https://<user>.github.io/` or `https://<user>.github.io/<repo>/`.

### Option B — project site from `/docs`

1. Copy this folder’s contents into the repo’s `docs/` directory (so `docs/index.html` exists).
2. **Settings → Pages → Deploy from a branch**, folder: **/docs**.
3. Site URL: `https://<user>.github.io/<repo>/`.

### Option C — subfolder on an existing Pages site

Serve the folder as-is under a path, e.g.:

```
https://<user>.github.io/<repo>/ps2-elite-kd-web/
```

Relative assets (`styles.css`, `app.js`, `data/…`) work as long as you open the directory that contains `index.html`.

After enabling Pages, wait a minute for the first deploy, then hard-refresh.

## Chart notes

| Piece | Behavior |
|--------|----------|
| X axis | Enemy weapon KPM 0 → 2 |
| Y axis | Projected (cumulative) K/D |
| Guides | Absolute bands at **0.75** and **1.50** (Farming noobs / Easy–Hard / Shredding) |
| Curves | From `player.curve` points `{kpm, kd, kills, deaths, n}` |
| Dots | Radius ∝ √deaths (amplified volume) |
| Kill-share | easy / mid / hard % of kills by absolute opp KPM |

No RED FLAG badge in this build.


## Shared cache (GitHub Actions)

> **Note:** The workflow YAML also lives at `scripts/refresh-cache.workflow.yml` because the automation token lacks GitHub’s `workflow` OAuth scope to push under `.github/workflows/`. To enable Actions once: copy that file to `.github/workflows/refresh-cache.yml` in the GitHub UI (Add file → Create new file), or run `gh auth refresh -s workflow` and push the local `.github/workflows/refresh-cache.yml`.

Shared player JSON lives under `data/` and is committed by the **Refresh shared cache** workflow.

1. Repo → **Actions** → **Refresh shared cache** → **Run workflow**
2. Optional `names` input (e.g. `JustV6me ChrisJTTR`); empty uses `data/watchlist.txt` + existing index
3. Workflow raises `data/load-flag.json` (`fetching: true`), fetches Honu/Census, writes `data/players/*.json` + `index.json`, then clears the flag

Weekly schedule: Sunday 12:00 UTC.

Live site: https://dayset.github.io/ps2-elite-kd/
