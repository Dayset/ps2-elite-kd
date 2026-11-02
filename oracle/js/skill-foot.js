// ⚖️ Footer skill row: faction skill (⚔️ iVi) weighted by real population (t810u; pinned bar's second row
// 2026-11-01, moved back to the footer 2026-11-02). Reuses the 7-day history the results table already fetches (no new Worker call);
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

/** HTML of the footer skill row (label left, numbers right via .mini-skill flex), or "" when there is
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
  const el = $("footSkill");
  if (!el) return;
  const html = skillFootHtml(await factions(), alerts);
  if (html) el.innerHTML = html;
  el.hidden = !el.innerHTML;
}

/** HTML of the mini-bar alert-skill row (#89: this alert's placed players, live map medians),
    label left, numbers right via .mini-skill flex, or "" when there is no alert skill.
    Same shape as the global row so the two compare directly. Exported for tests. */
export function alertSkillHtml(skill) {
  if (!skill || typeof skill !== "object") return "";
  const parts = FAC_ORDER.filter(([k]) => skill[k] && Number.isFinite(+skill[k].med)).map(([k, lab]) => `<span class="${lab === "NS" ? "" : lab}">${lab} ${Math.round(+skill[k].med)}</span>`);
  if (!parts.length) return "";
  const counts = { vs: 0, nc: 0, tr: 0, ns: 0 };
  for (const k of ["vs", "nc", "tr"]) if (skill[k] && Number.isFinite(+skill[k].n)) counts[k] = Math.round(+skill[k].n);
  if (skill.nso && Number.isFinite(+skill.nso.n)) counts.ns = Math.round(+skill.nso.n);
  const tip = tr("or.skillAlertTip", "Median ⚔️ iVi of this alert's placed players (live map, last 5 minutes; players without a known score left out). Players counted: VS {vs}, NC {nc}, TR {tr}, NS {ns}.", counts);
  return `<span class="mini-skill-label" title="${esc(tip)}">${esc(tr("or.skillAlert", "⚔️ This alert:"))}</span><span class="mini-skill-values">${parts.join(" · ")}</span>`;
}

/** Render the alert-skill row for the selected alert (live alerts with skill only); hidden otherwise. */
export function renderAlertSkill(alert) {
  const el = $("miniSkillAlert");
  if (!el) return;
  const html = alert && alert.status === "live" && alert.state ? alertSkillHtml(alert.state.alertSkill) : "";
  el.innerHTML = html;
  el.hidden = !html;
}
