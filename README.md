# PS2 Elite K/D

**Player statistics for PlanetSide 2: K/D plotted against the weapon KPM of the enemies each player faced, with opposition-weighted and pace-adjusted metrics.**

🎮 **[Open the live site](https://dayset.github.io/ps2-elite-kd/)** · 📘 [Using the site](docs/using-the-site.md) · 📐 [How the numbers are calculated](docs/metrics.md) · ⚙️ [How the shared cache works](docs/pipeline.md)

Free and open source. It's plain HTML, CSS and JavaScript on GitHub Pages, with no backend.

---

## 📊 Why plot K/D against enemy KPM?

Raw K/D counts every kill and death equally. The enemies in those fights vary, so one K/D figure mixes different opposition levels together.

PS2 Elite K/D groups each player's fights by the **weapon KPM (kills per minute) of the enemies involved**, and plots K/D across that range. Each player's curve shows how their K/D changes as enemy KPM increases.

## ✨ What you can do

- **Compare up to 10 players** on one chart.
- **Choose a chart view:** 📈 *Raw* (cumulative, the default). 🎚️ *Smooth* (banded) is available in the debug box.
- **Read the stats table** with adjusted metrics and population percentiles.
- **Browse 🏆 Rankings** of every cached player, with a distribution chart for each metric.
- **Share a comparison** with one link. Opening it runs the analysis automatically.
- **Use it on any device:** light and dark themes, with a mobile layout.

## 🚀 Quick start

Serve the folder with any static file server:

```bash
cd ps2-elite-kd
npx serve .          # or any static server
```

Use a local server rather than opening the file directly, because `file://` often blocks the JSON `fetch` calls.

## 🧭 How to use it

1. **Type names.** Press **space** or **comma** to lock each one in as a chip.
2. **Press Analyze** (or Enter).
3. **Share it** with the 🔗 button. Opening the link runs Analyze automatically.

Full details are in [docs/using-the-site.md](docs/using-the-site.md).

## 🗄️ Where the data comes from

Player data comes from the [Daybreak Census API](https://census.daybreakgames.com/). Each player's lookup uses about 5 Census calls, and each player is calculated from their top 200 opponents.

[HONU](https://wt.honu.pw/) (Varunda) is linked for killboards. It's also used as a paced fallback for lifetime history that Census doesn't have.

Requests are paced. The site checks cached snapshots first, uses client-side token buckets, and fetches live only when needed.

Each lookup goes in this order:

1. **Shared cache:** `data/players/<slug>.json`, filled automatically by GitHub Actions.
2. **Your browser's cache:** `localStorage`, about 30 days, specific to that browser.
3. **Live Census:** paced on the client side.

Details are in [docs/pipeline.md](docs/pipeline.md).

## 📊 The metrics at a glance

| Metric | What it measures |
|---|---|
| ⚔️ **iVi** | Opposition-weighted rating, adjusted for kill speed. Sorts by default. |
| 🏃 **Activity** | K/D × your own KPM: fight volume at your kill pace. |
| 🛡️ **Resist** | The Resistance Factor of the enemies you die to. |
| ⚡ **Const** | How much of your K/D remains against the strongest third of opponents compared with the weakest third. |
| 🦁 **Brave** | Activity × the slope of your K/D curve under higher enemy KPM. |
| ☠️ **K/D** | Resistance-weighted K/D. |

Hidden by default. Tick *show older debug stats* to show these: 🎯 **Aim** (Mech%, estimated from Resist), 🎈 **Inflation** (overall K/D ÷ K/D against enemies at 0.5 KPM or higher), and a few others.

Each value is explained in [docs/metrics.md](docs/metrics.md).

## 📖 Player legends

Hover a name in the ✨ Adjusted table and you get a short story-style legend: a standalone story about how that person behaved on the battlefield, written from the visible stats only (✨ Adjusted defaults + 📊 Public), judged against the whole population. No numbers except years, no role or loadout claims unless the owner wrote one down, and never related to any other player.

- **Where they live:** `data/descriptions/<first char of slug>.json`, with `{ text, basis, at }` per player, plus a tiny `data/descriptions/index.json` (`updatedAt`) that the page uses as a version param. The page fetches only the shards for the players currently shown.
- **Eligibility:** every player in `data/ranks.json` gets one, except thin samples (`thin = 1`) and confirmed padders (`data/reviewed.json` decision `padding`). Hidden players are already out of `ranks.json`.
- **Cards:** `node scripts/build-legend-cards.mjs` builds the fact cards writers see (visible metrics + population percentile + band word + tenure + eligibility + owner note). Writers never see raw player files or debug columns.
- **Staleness:** a legend's `basis` is its bands plus tenure state. When a later refresh moves a band, `node scripts/build-legend-cards.mjs --stale` lists the legend for rewriting; numbers drifting inside a band don't invalidate it.
- **Validator:** `node scripts/check-legends.mjs` enforces the style rules (45–90 words, no digits except years, no gendered pronouns, no cheating/padding/farming/flag or role words without an owner note, no words relating players to each other — no teammates, rivals, alts, same-outfit claims, no named references or comparisons — no repeated openings or phrases, basis matches the current card; the player's own name forms are stripped before the word checks, so a name that is itself a banned/role word — e.g. Aimbot — can still be used).
- **Owner notes:** `data/legend-notes.json` holds the only role facts legends may use (role, class, outfit), written by the owner. Everything else must come from the stats.
- **Writing more:** pick a chunk with `--chunk N --chunk-size 40` (active players by ⚔️ iVi first, then the rest, then 🪦), write from the cards, validate, and after writing shards run `node scripts/build-legend-cards.mjs --reindex` so the page picks up the new version.

## 🛠️ Development

```bash
npm test             # regression tests (Node 18+)
npm run check        # syntax checks
npm run build:ranks  # rebuild data/ranks.json locally
```

Pure math lives in `math.mjs`, which the browser's `app.js` imports. The file tree and the refresh pipeline are described in [docs/pipeline.md](docs/pipeline.md).

## 🙏 Credits

- Data from the [Daybreak Census API](https://census.daybreakgames.com/) and [HONU](https://wt.honu.pw/) (Varunda).
- The chart logic started as an earlier Python elite K/D tool, since ported to JavaScript.

## 📄 License

[MIT](LICENSE) © 2026 Dayset. Provided "as is," with no warranty. All numbers are automated estimates.
