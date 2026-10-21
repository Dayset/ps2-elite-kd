# Using the site

A walkthrough of the main page. For a short version, see the [README](../README.md).

## Picking players

- Type a name, then press **space** or **comma** to lock it in as a chip. Click a chip to remove it.
- The **📦 Shared cache** list is sorted by name (tags ignored) and has `[#] [A] [B]…` headers.
- When the list is open, a sticky **# A … Z** bar sits at the top. Letters with no names are dimmed. Tap a letter to jump to its header.
- Once you've scrolled about one screen into the open list, round **⬆ / ⬇** buttons appear bottom-right. **⬆** jumps to the top (the alphabet bar), and **⬇** jumps to the last names. They hide when the list is collapsed or off screen.
- Chip colours: **green** means cached or analysed, **amber** means not fetched yet.
- On narrow portrait phones (600px or less), chips stack one per line. Wider screens and landscape show them inline.
- Names you type are saved on every change. **×** and **🗑️** clear them, and a cleared field stays empty.
- A `?names=` link always wins and runs automatically. Without one, your saved chips come back but don't run until you press Analyze.
- Names picked after an analysis reappear in the field once the graph is redrawn.
- The maximum is 10 names.

## Analysing

1. Press **Analyze** (or Enter). Use **×** to clear names.
2. Tick **Fetch fresh data** to skip every cache and query Census live. It's unticked on each page load.
3. Use the square **🔗** button to copy a share link (`?names=JustV6me,ChrisJTTR`). It flashes ✓ when copied.

## Sharing

- Opening a `?names=` link **runs Analyze automatically** once the page and the shared-cache index have loaded. It behaves exactly like pressing Analyze: a progress popup shows a countdown and an abort **×**. Names that don't exist trigger a warning, and the rest are still graphed. The page then scrolls smoothly to the results.
- If a link has more than 10 names, the first 10 become chips and are analysed. A "10 players limit reached" hint stays visible.
- The auto-run never uses Fetch fresh, and it runs only once. It won't repeat if the same set is already graphed or a run has already started.
- A plain URL doesn't auto-run. The last comparison restored from `localStorage` fills the chips and waits for you to press Analyze.

## Theme and navigation

- **☀️ / 🌙** (small button at the right of the "Fetch fresh data" line) toggles the theme. The light theme is a creamy haze of about 15% white.
- **🏆 Rankings** sit below the graph, and the old `ranks.html` links redirect to `index.html#rankings`, keeping any `?names=`.

## The chart

One view since 2026-10-21 (owner t488u): **💀 Who wins fights** — kills per death against easy → hard enemies. Higher line = wins more fights. The aim-vs-results gap now lives in the public 🔀 Diff column instead.

- *(Switched off, code kept for later)* **🎯 Who aims best**: each line keeps its shape but is lifted to the player's aim score (public IvI = accuracy × headshot %). Higher line = better aim, not more wins. Players can swap places between the two views: sharp aim doesn't always win fights, and vehicle / explosive players win without headshots.

Both are cumulative: K/D against everyone at or above each enemy KPM. The axis fits the names on the graph.

- **🎚️ Smooth**: K/D against enemies near each KPM. Faded where there are few fights.
- **👻 Ghost** (optional): a dashed prediction based on play style, fitted on the shared cache. It fills sparse ranges and is clearly marked as not real fights.
- Bands mark **Easy** and **Hard** at 0.75 and 1.50 enemy KPM.
- The **zoom** slider (top-right corner):
  - **Bottom / Auto** shows the full graph, auto-fitted.
  - **Up** zooms into the start of the graph. The X maximum shrinks quickly (about 0.71 halfway, 0.25 at the top), and Y refits to the visible left side. Lines leaving the right edge are clipped.

## The stats table

- **Public (Census/Honu)** columns are collapsed by default: KD, KPM, own KPM, Acc %, HSR %, IvI.
- **Adjusted** columns are shown by default: ⚔️ iVi, 🏃 Activity, 🦁 Brave, 🛡️ Resist, ⚡ Const, ☠️ K/D.
- Tick **show older debug stats** in the footer to add ⚙️ Mech%, 🎯🎈 ivi, eKPM, own KPM, 📊 COI, 📉 Slope and 🎈 Inflation. The choice is remembered.
- Click any header to sort. Names sort alphabetically, and metrics sort numerically. The default is ⚔️ iVi, descending. Sorting by a debug column falls back to iVi when the debug columns are hidden.
- Hover a header for a short hint.
- Each value shows a small dimmed percentage against a reference value in its column:
  - By default it's **−N%**, the gap below the highest value.
  - For 🎈 Inflation (a debug column) it's **+N%** above the reference, which is the greater of the lowest value and 1.0. Values at or below the reference show no percentage, so anything below 1.0 means no inflation.
  - No percentage appears on the reference value itself, on iVi cells shown as 0, or when the reference is 0 or less (such as 📉 Slope).
  - On phones the percentage sits under the number.

## Rankings

**🏆 Rankings** loads lazily: after the graph, when you scroll near it, or after a short idle.

- It ranks every player in the shared cache, one row per player.
- The names box at the top is the only selection. Tick ✅ in the table to add or remove a player. Clicking a player's name also adds them. The graph and stats follow without pressing Analyze, as long as the data is saved.
- **🏅 Positions** shows, for each selected player, their rank and population percentile on every ✨ Adjusted metric.
- The **#** column gives the rank, and a small **pN** shows the population percentile next to each number.
- **Filter the table by name…** narrows the table. Tags are ignored, and the selection doesn't change.
- **📊 Distribution** is collapsible and plots current metrics. Sorting by a column switches the chart to that metric.
  - Bars show the share of players in each value range (about 30 bins over p1–p99, with `<` and `>` tail bins).
  - A cumulative line runs across the bars. Median, p90 and p99 are marked.
  - Hover or tap a bar for details. Clicking a bar sorts the table by that metric and scrolls to the range, clearing any filter first.
  - Clicking a selected player's name label scrolls to their row.
- ↻ marks rows recalculated from your browser's newer "Fetch fresh" copy. The footer reads "N of N players · updated … · ↻ N from your fresh fetch".
- The numbers come from `data/ranks.json`, which is rebuilt on every cache refresh. Your browser never downloads a thousand player files.
- Helpers: `dist.mjs`, `dist-labels.mjs`, `rank-row.mjs`, `palette.mjs`.

## Other pages and features

- **🔎 Status page** (unlisted): refresh runs, the queue, and a 🚩 list of flagged players for manual review.
- **Account flairs** appear under the graph in the name list:
  - 🪦 no activity for over a year.
  - 👴🏽 account 8+ years old and active in the last year.
  - 👶 account created in the last ~3 months (91 days).
  - Each player gets one flair, with 🪦 taking priority over 👴🏽, and 👴🏽 over 👶.
- **🙈 Hidden players** are left out of the Rankings but still work everywhere else. See the [pipeline doc](pipeline.md).
