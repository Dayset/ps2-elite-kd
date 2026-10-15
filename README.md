# PS2 Elite K/D

**Judge PlanetSide 2 players by how their K/D holds up against harder opposition, not just the raw number.**

🎮 **[Open the live site](https://dayset.github.io/ps2-elite-kd/)** · 📘 [Using the site](docs/using-the-site.md) · 📐 [How the numbers work](docs/metrics.md) · ⚙️ [How the shared cache works](docs/pipeline.md)

Free and open source. It's plain HTML, CSS and JavaScript on GitHub Pages, with no backend.

---

## 🤔 Why not just raw K/D?

Raw K/D treats every kill the same. Someone farming weak enemies can look elite, and someone who fights the best players can look average.

PS2 Elite K/D plots each player's K/D against the **weapon KPM (kills per minute) of the enemies they fought**. You can see who keeps up as the opposition gets harder.

## ✨ What you can do

- **Compare up to 10 players** on one chart.
- **Switch between two curves:** 📈 *Raw* (cumulative, the default) or 🎚️ *Smooth* (local around each enemy KPM).
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

Player data comes from the [Daybreak Census API](https://census.daybreakgames.com/). Each player's lookup costs about 5 Census calls, and each player is scored against their top 200 opponents.

[HONU](https://wt.honu.pw/) (Varunda) is linked for killboards. It's also used as a paced fallback for lifetime history that Census doesn't have.

Requests are kept polite. The site checks cached snapshots first, uses client-side token buckets, and fetches live only when it has to.

Each lookup goes in this order:

1. **Shared cache:** `data/players/<slug>.json`, filled automatically by GitHub Actions.
2. **Your browser's cache:** `localStorage`, about 30 days, specific to that browser.
3. **Live Census:** paced on the client side.

Details are in [docs/pipeline.md](docs/pipeline.md).

## 📊 The metrics at a glance

| Metric | Meaning |
|---|---|
| ⚔️ **iVi** | Skill rating. Opposition-weighted, then adjusted for your kill speed. Sorts by default. |
| 🏃 **Activity** | How many hard fights you've taken (K/D × your KPM). |
| 🛡️ **Resist** | How hard the players you die to are. |
| 🦁 **Brave** | Activity weighted by how the curve drops under hard opposition. |
| ☠️ **K/D** | Resistance-weighted K/D. |
| ⚙️ **Mech%** | Projected mech share, implied by Resist. |
| 🎈 **Inflation** | How much easy-fight padding lifts your overall K/D. Above 1.0 means inflated. |

Each value is explained in [docs/metrics.md](docs/metrics.md).

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

[MIT](LICENSE) © 2026 Dayset. Provided "as is," with no warranty. All numbers are automated estimates, not facts.
