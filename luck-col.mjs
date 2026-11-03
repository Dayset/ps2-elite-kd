/**
 * 🎲 Luck column (owner t849u → public t850u): per-player "vs expected" from
 * data/duel-ivi-player.json (scripts/fit-duel-ivi.mjs writePlayers). Value =
 * average gap, in points of the mutual-kill share, between what the player got
 * and what the ⚔️ iVi model (duels.mjs) predicts, over opponents with 10+ kills
 * between them (file field min); shrunk toward 0 for few opponents. Shared by ✨ Stats
 * (stats-table.mjs) and 🏆 Rankings (rankings.mjs), one fetch for both.
 */
import { t as tr } from "./i18n.mjs";
import { playerLuck } from "./duels.mjs?v=20261102-luck5";

export { playerLuck };

const loads = new Map();
/** One lazy fetch per data dir; resolves to the file or false. A network failure is not cached. */
export function loadLuckData(dataDir) {
  if (loads.has(dataDir)) return loads.get(dataDir);
  const p = fetch(`${dataDir}duel-ivi-player.json`)
    .then((r) => (r.ok ? r.json() : false))
    .then((d) => (d && d.v === 1 && d.p && d.cuts ? d : false))
    .catch(() => { loads.delete(dataDir); return null; });
  loads.set(dataDir, p);
  return p;
}

/** Sortable value in points (one decimal), NaN when there is none. */
export function luckPoints(l) {
  return l ? Math.round(l.gap * 1000) / 10 : NaN;
}

/** Cell text: whole-number signed percent, "+9%" / "−3%" / "0%". */
export function luckText(l) {
  if (!l) return "—";
  const n = Math.round(l.gap * 100);
  return n > 0 ? `+${n}%` : n < 0 ? `−${-n}%` : "0%";
}

export function luckClass(l) {
  if (!l) return "luck-few";
  return "luck-" + (!l.lvl ? "as" : (l.up ? "up" : "down") + l.lvl);
}

export function luckVerdict(l) {
  const arrow = !l.lvl ? "≈" : (l.up ? "↑" : "↓").repeat(l.lvl);
  const word = !l.lvl ? tr("duel.luck.as", "as expected")
    : l.up ? (l.lvl === 2 ? tr("duel.luck.better2", "much better") : tr("duel.luck.better1", "a bit better"))
      : (l.lvl === 2 ? tr("duel.luck.worse2", "much worse") : tr("duel.luck.worse1", "a bit worse"));
  return `${arrow} ${word}`;
}

export const LUCK_HINT_EN = "Wins more (+) or fewer (−) of the kills against the same opponents than ⚔️ iVi predicts. Not literally luck; vehicle kills are already adjusted.";
export const luckHint = () => tr("tip.luck", LUCK_HINT_EN);
export const luckLabel = () => tr("col.luck", "🎲 Luck");
export const luckFewTip = (d) => tr("luck.p.few", "Too few opponents: needs {n} with {k}+ kills between them.", { n: d ? d.oppMin : 20, k: d && d.min ? d.min : 10 });

/** Hover: verdict, the numbers, how, and what it is not. */
export function luckTip(l) {
  const pts = `${l.gap >= 0 ? "+" : "−"}${(Math.abs(l.gap) * 100).toFixed(1)}`;
  return luckVerdict(l) + "\n" + tr("luck.p.tip", "{gap} pts of the kills vs what ⚔️ iVi predicts, over {n} opponents; beat the prediction against {b}% of them.\nHow: kill share vs each opponent (10+ kills between them) minus the iVi prediction, averaged.\nNot literally luck: more or fewer won mutual fights than iVi predicts; vehicle kills already adjusted.",
    { gap: pts, n: l.opps.toLocaleString(), b: l.beat });
}

/** Full <td> for a player's lookup result (null = too few opponents). */
export function luckCellHtml(l, data, esc) {
  if (!l && !data) return `<td class="luck-few">—</td>`; // file not loaded (yet)
  if (!l) return `<td class="luck-few" title="${esc(luckFewTip(data))}">—</td>`;
  return `<td class="luck-cell ${luckClass(l)}" title="${esc(luckTip(l))}">${luckText(l)}</td>`;
}
