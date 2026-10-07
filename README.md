# PS2 Elite K/D (web)

Dark-themed SVG chart comparing PlanetSide 2 characters by how their projected K/D holds as opponent weapon-KPM rises. Port of the `save_share_png` / `absolute_target_split` / `kpm_curve` logic from the Python tool — **vanilla HTML + CSS + JS**, no build step, no CDN, no Python at runtime.

## Files

```
ps2-elite-kd-web/
  index.html      # page shell
  styles.css      # dark theme (#0b0c0e / #14161a)
  app.js          # chart + loaders + localStorage QoL
  data/
    justv6me.json
    chrisjttr.json
    index.json
  README.md
```

## Open locally

Prefer a tiny static server (browsers often block `fetch` of local JSON under `file://`):

```bash
cd ps2-elite-kd-web
python3 -m http.server 8080
```

Then open http://127.0.0.1:8080/

Default load: **JustV6me** vs **ChrisJTTR** from `./data/` (or your last comparison / `?names=` query).

Enter more names (comma-separated) and click **Load**, or press **Enter**. The page tries, in order:

1. Bundled `./data/<slug>.json`
2. Browser **localStorage** payload cache
3. Live Census + Honu (`wt.honu.pw`) when CORS/network allow

Status text reports which source was used per player.

## QoL (browser memory)

| Feature | Details |
|---------|---------|
| Recent names | Up to ~12 unique names in `localStorage` key `ps2-elite-kd-recent`. Clickable chips under the input add a name if missing (empty field → set; already present → keep). |
| Payload cache | After a successful load (local or live), trimmed player objects are stored in `ps2-elite-kd-cache-v1`, keyed by normalized name. |
| Last comparison | Successful name lists saved in `ps2-elite-kd-last` and auto-restored on next open (falls back to JustV6me, ChrisJTTR). |
| Clear memory | Button clears recent names, payload cache, and last comparison (confirms via `window.confirm`). |
| Copy link | Builds and copies a shareable URL like `?names=JustV6me,ChrisJTTR`. Query param is honored on load. |
| Polish | Load disabled while fetching; clearer empty/error/partial statuses; Enter submits. |

## Share / deep link

```
https://example.github.io/ps2-elite-kd-web/?names=JustV6me,ChrisJTTR
```

Comma-separated (also accepts `;` / newlines in the input field). Max 10 names per comparison.

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
