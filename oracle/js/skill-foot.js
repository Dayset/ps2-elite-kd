// ⚖️ Top mini-bar, second row: faction skill (⚔️ iVi) weighted by real population (t810u, moved out of
// the footer 2026-11-01). Reuses the 7-day history the results table already fetches (no new Worker call);
// data/factions.json is a static file, read at most every 30 min. Method in pop-weight.mjs.
// Names kept (skill-foot / skillFootHtml / renderSkillFoot) to avoid churning results.js + tests.
import { esc, $ } from "./state.js?v=20261018-scrub2";
import { alertPop, weightedSkill } from "../../pop-weight.mjs?v=20261031-popw1";
import { t as tr } from "../../i18n.mjs";

const FAC_ORDER = [["vs", "VS"], ["nc", "NC"], ["tr", "TR"], ["nso", "NS"]];
const RELOAD_MS = 30 * 60 * 1000;
let facP = null, facAt = 0;
function factions() {
  if (!facP || Date.now() - facAt > RELOAD_MS) {
    facAt = Date.now();
    facP = fetch("../data/factions.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((d) => { if (!d) facP = null; return d; });
  }
  return facP;
}

/** HTML of the mini-bar skill row (label left, numbers right via .mini-skill flex), or "" when there is
    not enough data. Exported for tests. */
export function skillFootHtml(fac, alerts) {
  if (!fac || !fac.popw) return "";
  const { pop, alerts: n } = alertPop(alerts);
  if (!n) return "";
  const w = weightedSkill(fac.popw, pop);
  const parts = FAC_ORDER.filter(([k]) => w[k]).map(([k, lab]) => `<span class="${lab === "NS" ? "" : lab}">${lab} ${w[k].med}</span>`);
  if (!parts.length) return "";
  const tip = tr("or.skillPopTip", "Median ⚔️ iVi of each faction's cached players (OOR players and padders left out), with each server weighted by that faction's real players there in the last {n} alerts (Honu alert reports), so a server that is over-represented in the cache counts less.", { n });
  return `<span class="mini-skill-label" title="${esc(tip)}">${esc(tr("or.skillPop", "⚖️ Population weight:"))}</span><span class="mini-skill-values">${parts.join(" · ")}</span>`;
}

export async function renderSkillFoot(alerts) {
  const el = $("miniSkill");
  if (!el) return;
  const html = skillFootHtml(await factions(), alerts);
  if (html) el.innerHTML = html;
  el.hidden = !el.innerHTML;
}
