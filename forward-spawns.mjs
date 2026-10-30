/**
 * 🚐 Forward spawns (owner 2026-10-30), shared by the Oracle (oracle/js/fights.js) and 🎥 LIVE
 * (live-caps.mjs): the spawn points each side had at a base in the last 10 minutes —
 * Sunderers, Routers, squad beacons, Galaxies / Valkyries, ANTs, Deliverers — counted from the
 * spawn XP in the game's live event stream (cache Worker live-map.js). Faction totals only;
 * shown, never read by the odds.
 *
 * sp = { VS: { su: 3, ro: 2 }, NC: { be: 2 } }   (su ro be ga sv an de)
 */
export const SPAWN_KINDS = ["su", "ro", "be", "ga", "sv", "an", "de"];
const FACS = ["VS", "NC", "TR"];
const KIND = { su: "Sunderer", ro: "Router", be: "squad beacon", ga: "Galaxy", sv: "Valkyrie/Galaxy", an: "ANT", de: "Deliverer" };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const has = (sp, f) => !!(sp && sp[f] && SPAWN_KINDS.some((k) => +sp[f][k] > 0));

/** "3× Sunderer · 2× Router" for one faction ("" when none). */
export function spawnList(q, tr) {
  if (!q) return "";
  return SPAWN_KINDS.filter((k) => +q[k] > 0).map((k) => `${Math.round(+q[k])}× ${esc(tr(`sp.${k}`, KIND[k]))}`).join(" · ");
}

/**
 * One base's line (HTML, "" when no spawn point was seen).
 * own = the defending faction (base owner before the flip / now), att = the attacking faction when known.
 * → "🚐 Attacker TR forward spawn: 3× Sunderer · 2× Router — Defender NC: 2× squad beacon"
 */
export function spawnLine(sp, tr, { own = null, att = null, cls = "" } = {}) {
  if (!sp || !FACS.some((f) => has(sp, f))) return "";
  const fac = (f) => `<span class="${f} ${f.toLowerCase()}">${f}</span>`;
  const parts = [];
  if (own && FACS.includes(own)) {
    const atts = att && FACS.includes(att) && att !== own ? [att] : FACS.filter((f) => f !== own && has(sp, f));
    if (!atts.length) parts.push(tr("sp.attNone", "🚐 Attacker: no forward spawn seen"));
    for (const f of atts) parts.push(tr("sp.att", "🚐 Attacker {f} forward spawn: {list}", { f: fac(f), list: spawnList(sp[f], tr) || tr("sp.none", "none seen") }));
    if (has(sp, own)) parts.push(tr("sp.def", "Defender {f}: {list}", { f: fac(own), list: spawnList(sp[own], tr) }));
  } else {
    const list = FACS.filter((f) => has(sp, f)).map((f) => `${fac(f)} ${spawnList(sp[f], tr)}`).join(" — ");
    parts.push(tr("sp.all", "🚐 Spawn points: {list}", { list }));
  }
  const tip = esc(tr("sp.tip", "Spawn points each side had at this base in the last 10 min (Sunderers, Routers, squad beacons, Galaxies…), counted from spawns in the game's live event stream. Rough: a Sunderer pulled again counts as a new one. Shown only, not used in the odds."));
  return `<span class="fspawn${cls ? " " + cls : ""}" title="${tip}">${parts.join(" — ")}</span>`;
}
