// 🚩 Conduit (CTF) exclusion (owner 2026-11-02): "Conduit" is the capture-the-flag
// bases — Census facility types 14 (Large CTF Outpost), 15 (Small CTF Outpost),
// 16 (Amp Station CTF), 17 (Construction Outpost CTF), 16 bases across the continents
// (Amerish 4, Esamir 7, Hossin 3, Indar 2, Oshur 0). Pure functions: no DOM, no
// requests, no imports — a node test imports this file directly.
//
// The dashboard filter runs in BOTH toggle states: with no CTF set it only
// normalizes the list shapes (attack/defend to 3, plan backups to 2, heat
// backups to 1 — today's Worker shapes), so a future Worker backfill (6
// attack/defend, 4 focus backups, extra heat backups) cannot change the
// included display. With a CTF set it additionally drops every conduit fight:
// plan entries whose bases include a CTF base, attack/defend rows on a CTF
// base, pockets whose chokepoint is CTF, and kingmaker lines whose text
// mentions a CTF base. fight_up, second and capture_live are untouched.

/** Census facility types that are capture-the-conduit (CTF) bases. */
export const CTF_TYPES = new Set(["14", "15", "16", "17"]);

/**
 * CTF base names for a zone, from the regions map api.names() returns
 * ({facility_id: {name, type}} — type is the raw JSON string).
 */
export function ctfNames(regions) {
  const out = new Set();
  for (const r of Object.values(regions || {})) {
    if (r && r.name && CTF_TYPES.has(String(r.type))) out.add(r.name);
  }
  return out;
}

/**
 * One focus plan with conduit fights removed. isCtf: base name -> true when the
 * base is a conduit base. The first surviving candidate becomes the focus, the
 * rest are backups (at most 2, or 1 for a heat plan — today's display shape).
 * Quiet when nothing survives. A plan entry counts as conduit when ANY of its
 * bases is one (a "plan" entry stages two bases).
 */
export function filterPlan(plan, isCtf) {
  if (!plan || plan.quiet) return plan;
  const drop = (x) => !!x && (x.bases || []).some((b) => isCtf(b));
  const kept = [plan.focus, ...(plan.backups || [])].filter((x) => x && !drop(x));
  if (!kept.length) return { ...plan, focus: null, backups: [], quiet: true };
  return { ...plan, focus: kept[0], backups: kept.slice(1, 1 + (plan.heat_mode ? 1 : 2)), quiet: false };
}

/**
 * A whole commander object with conduit fights removed. ctfSet: Set of CTF base
 * names, or null/empty for included (slice normalization only). Every plan
 * source is filtered (focus, focus_heat, focus_mix, focus_ahead, focus_solo),
 * so no mode can resurrect a conduit order. Null-safe.
 */
export function filterCommander(c, ctfSet) {
  if (!c) return c;
  const isCtf = (n) => !!n && !!ctfSet && ctfSet.has(n);
  const mentions = (t) => !!t && !!ctfSet && [...ctfSet].some((n) => n && t.includes(n));
  const out = { ...c };
  for (const key of ["focus", "focus_heat", "focus_mix", "focus_ahead", "focus_solo"]) {
    if (!c[key]) continue;
    const f = {};
    for (const [fac, plan] of Object.entries(c[key])) f[fac] = filterPlan(plan, isCtf);
    out[key] = f;
  }
  if (c.factions) {
    const facs = {};
    for (const [f, x] of Object.entries(c.factions)) {
      facs[f] = {
        ...x,
        attack: (x.attack || []).filter((e) => !isCtf(e.name)).slice(0, 3),
        defend: (x.defend || []).filter((e) => !isCtf(e.name)).slice(0, 3),
        kingmaker: (x.kingmaker || []).filter((k) => !mentions(k.text)),
      };
    }
    out.factions = facs;
  }
  if (c.pockets) {
    const pk = {};
    for (const [f, list] of Object.entries(c.pockets)) pk[f] = (list || []).filter((p) => !isCtf(p.chokepoint));
    out.pockets = pk;
  }
  if (c.second_place_kingmaker) out.second_place_kingmaker = c.second_place_kingmaker.filter((k) => !mentions(k.text));
  return out;
}
