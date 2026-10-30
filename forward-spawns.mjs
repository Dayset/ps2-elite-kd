/**
 * 🚐 Forward spawns (owner 2026-10-30), shared by the Oracle (oracle/js/fights.js) and 🎥 LIVE
 * (live-caps.mjs): the spawn points each side had at a base in the last 10 minutes —
 * Sunderers, Routers, squad beacons, Galaxies / Valkyries, ANTs, Deliverers — counted from the
 * spawn XP in the game's live event stream (cache Worker live-map.js). Faction totals only;
 * shown, never read by the odds.
 *
 * sp = { TR: { su: 3, suN: 40, suL: 2, ro: 2, roN: 5, n: 45 }, NC: { be: 2, beN: 9, n: 9 } }
 *   (su ro be ga sv an de; kN = spawns at that kind, kL = destroyed in the window, n = all spawns)
 *
 * The line is kept short on purpose (owner 2026-10-30, "text overload"): attacker first, then
 * the defender after a bar, the full wording sits in the hover hint.
 *   🚐 TR 3 Sunderer·40 (2 lost) · 2 Router·5 | NC 2 beacon·9
 */
export const SPAWN_KINDS = ["su", "ro", "be", "ga", "sv", "an", "de"];
const FACS = ["VS", "NC", "TR"];
const KIND = { su: "Sunderer", ro: "Router", be: "squad beacon", ga: "Galaxy", sv: "Valkyrie/Galaxy", an: "ANT", de: "Deliverer" };
const SHORT = { su: "Sunderer", ro: "Router", be: "beacon", ga: "Galaxy", sv: "Valk/Gal", an: "ANT", de: "Deliverer" };
const num = (x) => Math.max(0, Math.round(+x || 0));
const label = (k, tr, short) => (k === "be" ? tr(short ? "sp.beS" : "sp.be", short ? SHORT.be : KIND.be) : short ? SHORT[k] : KIND[k]);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const has = (sp, f) => !!(sp && sp[f] && SPAWN_KINDS.some((k) => +sp[f][k] > 0));

/** One faction, short: "3 Sunderer·40 (2 lost) · 2 Router·5" ("" when none). */
export function spawnList(q, tr) {
  if (!q) return "";
  const kinds = SPAWN_KINDS.filter((k) => num(q[k]) > 0);
  const per = kinds.some((k) => num(q[k + "N"]) > 0);
  const items = kinds.map((k) => {
    const n = num(q[k + "N"]), l = num(q[k + "L"]);
    return `${num(q[k])} ${esc(label(k, tr, true))}${n ? `<span class="fspn">·${n}</span>` : ""}${l ? ` <span class="fspx">${esc(tr("sp.lost", "({n} lost)", { n: l }))}</span>` : ""}`;
  });
  const tot = !per && num(q.n) ? `<span class="fspn">·${num(q.n)}</span>` : ""; // older rows: one total per faction
  return items.join(" · ") + tot;
}

/** One faction, full words for the hover hint: "3× Sunderer — 40 spawns, 2 destroyed · …". */
export function spawnTip(q, tr) {
  if (!q) return "";
  return SPAWN_KINDS.filter((k) => num(q[k]) > 0).map((k) => {
    const l = num(q[k + "L"]);
    const n = num(q[k + "N"]);
    const it = n ? tr("sp.tItem", "{c}× {k} — {n} spawns", { c: num(q[k]), k: label(k, tr, false), n }) : `${num(q[k])}× ${label(k, tr, false)}`;
    return l ? `${it}, ${tr("sp.tLost", "{n} destroyed", { n: l })}` : it;
  }).join(" · ");
}

/**
 * One base's line (HTML, "" when no spawn point was seen).
 * own = the defending faction (base owner before the flip / now), att = the attacking faction when known.
 * → "🚐 TR 3 Sunderer·40 (2 lost) · 2 Router·5 | NC 2 beacon·9" (attacker first, defender after the bar)
 */
export function spawnLine(sp, tr, { own = null, att = null, cls = "" } = {}) {
  if (!sp || !FACS.some((f) => has(sp, f))) return "";
  const fac = (f) => `<span class="${f} ${f.toLowerCase()}">${f}</span>`;
  const side = (f) => `${fac(f)} ${spawnList(sp[f], tr)}`;
  const vis = [], tips = [];
  if (own && FACS.includes(own)) {
    const atts = att && FACS.includes(att) && att !== own ? [att] : FACS.filter((f) => f !== own && has(sp, f));
    const seen = atts.filter((f) => has(sp, f));
    if (!seen.length) { vis.push(esc(tr("sp.attNone", "no attacker spawn"))); tips.push(tr("sp.tNone", "Attacker: no forward spawn seen")); }
    for (const f of seen) { vis.push(side(f)); tips.push(tr("sp.tAtt", "Attacker {f}: {list}", { f, list: spawnTip(sp[f], tr) })); }
    if (has(sp, own)) { vis.push(side(own)); tips.push(tr("sp.tDef", "Defender {f}: {list}", { f: own, list: spawnTip(sp[own], tr) })); }
  } else {
    for (const f of FACS.filter((x) => has(sp, x))) { vis.push(side(f)); tips.push(`${f}: ${spawnTip(sp[f], tr)}`); }
  }
  tips.push(tr("sp.tip", "Spawn points each side had at this base in the last 10 min, counted from spawns in the game's live event stream. ·40 = spawns there, lost = destroyed in that time. Rough: a Sunderer pulled again counts as a new one. Shown only, not used in the odds."));
  const tip = tips.map(esc).join("&#10;");
  return `<span class="fspawn${cls ? " " + cls : ""}" title="${tip}">🚐 ${vis.join(' <span class="fspsep">|</span> ')}</span>`;
}
