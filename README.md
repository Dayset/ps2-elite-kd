# PS2 Elite

**Player statistics for PlanetSide 2: K/D plotted against the weapon KPM of the enemies each player faced, with opposition-weighted and pace-adjusted metrics.**

🎮 **[Open the live site](https://dayset.github.io/ps2-elite-kd/)** · 📘 [Using the site](docs/using-the-site.md) · 📐 [How the numbers are calculated](docs/metrics.md) · ⚙️ [How the shared cache works](docs/pipeline.md) · 🔀 [Theory vs practice: the Diff research](docs/theory-practice-diff.md)

Free and open source. It's plain HTML, CSS and JavaScript on GitHub Pages. Two small Cloudflare Workers queue cache refreshes and run the alert oracle. No cookies, no analytics, no ads.

---

## 📊 Why plot K/D against enemy KPM?

Raw K/D counts every kill and death equally. The enemies in those fights vary, so one K/D figure mixes different opposition levels together.

PS2 Elite groups each player's fights by the **weapon KPM (kills per minute) of the enemies involved**, and plots K/D across that range. Each player's curve shows how their K/D changes as enemy KPM increases.

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

Full details are in [docs/using-the-site.md](docs/using-the-site.md). [What every column means](columns.html), in plain words. [Update log](updates.html): latest changes, live from GitHub.

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

## 🛠️ Development

```bash
npm test             # regression tests (Node 18+)
npm run check        # syntax checks
npm run build:ranks  # rebuild data/ranks.json locally
```

Pure math lives in `math.mjs`, which the browser's `app.js` imports. The file tree and the refresh pipeline are described in [docs/pipeline.md](docs/pipeline.md).

## 🔒 Data handling and privacy

What the project stores, in short (full details: [PRIVACY.md](PRIVACY.md), on the site: [privacy page](https://dayset.github.io/ps2-elite-kd/privacy.html)):

- **Player data:** public PlanetSide 2 game data from the Census API and Honu (character name and id, outfit, stats, weapons, top 200 opponents, login times), cached in `data/` and `data-ps/`. It is tied to in-game names, not to real people, but under the GDPR it still counts as personal data.
- **Visitors:** no cookies, analytics or trackers. Browser storage holds only your own settings and cached stats; "Clear local data" deletes it. The Workers see IP addresses and store them only as keyed hashes for short rate limits.
- **Oracle sign-in:** character id, name, token, BonusCheque balance (no cash value) and votes.
- **Retention:** PS sessions 45 days, oracle map snapshots 30 days, flips 90 days, sign-in attempts 1 day, rate-limit keys about 1 hour. Player files are refreshed while the character exists and deleted on request. Table in [PRIVACY.md](PRIVACY.md#1-players-people-whose-characters-appear-on-the-site).
- **Removal:** players remove their own character on the [privacy page](https://dayset.github.io/ps2-elite-kd/privacy.html#remove) after proving it is theirs with an in-game logout (PC, Genudine, Ceres). The oracle Worker records it (`/privacy/*`), the next refresh run copies it into `data/opt-out.json` / `data-ps/opt-out.json` (`scripts/sync-removals.mjs`) and purges the cached file and every record (`scripts/purge-removed.mjs`), blanks the name in opponent lists, and the page refuses to show it. Entries without a recorded proof are ignored. Mirror rule: a character Census no longer has (deleted in the game or by Daybreak; checked by id twice, ≥ 20 h apart, `scripts/gone-check.mjs`) is removed the same way automatically; a rename drops the old copy and queues the new name. Removal requests filed as issues get an automatic reply with the link (`removal-autoreply.yml`).

**GDPR note.** The site processes public game data of players worldwide, including EU servers, for community statistics, rankings and fair-play checks. Lawful basis: legitimate interests (Art. 6(1)(f)). Players are informed through the public privacy notice (Art. 14(5)(b)) and can object or ask for removal at any time (Art. 21). If you self-host a copy, you are responsible for your own compliance and privacy notice.

## ⚠️ Disclaimer

All numbers, ratings, charts and marks are automated estimates from third-party public data (Daybreak Census API, Honu). They can be wrong, incomplete or out of date, and they are not facts, proof or accusations about any player. The site and its data are provided "as is", with no warranty; the authors are not liable for any loss from using them. If an API changes or goes down, numbers can be wrong until the bots catch up. Not affiliated with or endorsed by Daybreak Game Company or Honu. PlanetSide and PlanetSide 2 are registered trademarks of Daybreak Game Company LLC.

## 🙏 Credits and data sources

- Data from the [Daybreak Census API](https://census.daybreakgames.com/) and [HONU](https://wt.honu.pw/) (Varunda); oracle history from [PS2Alerts](https://ps2alerts.com/); second opinions from [PS2 Radar](https://ps2radar.com/).
- What each source asks of us and where we stand: [DATA_SOURCES.md](DATA_SOURCES.md).
- The chart logic started as an earlier Python elite K/D tool, since ported to JavaScript.

## 🛡️ Security

Report vulnerabilities privately: [SECURITY.md](SECURITY.md).

## 📄 License

Code: [MIT](LICENSE) © 2026 Dayset. Game images, game data and other third-party content in this repository are **not** covered by the MIT license; see [NOTICE](NOTICE). The project has no runtime dependencies.
