// 🪦 Reverse favourite targets (owner 2026-11-03): the third duels-crowd line.
// A player's favourite target is their max-kills winning killboard row (kills >
// deaths; ties: fewer deaths; "0" rows skipped) — the same rule crowdSummary
// in duels.mjs uses for its target. This module inverts it: for every player,
// who has THEM as favourite target. The panel cannot compute that from the
// viewed player's own killboard (it would need every opponent's killboard),
// so build-ranks.mjs precomputes it from the stored player files into
// data/rev-targets.json (data-ps/ for the PlayStation room) and the panel
// just looks the viewed player up.
//
// players: [{ display, rows }] with rows = killboard rows ({ name, kills,
// deaths }); rawRows is accepted too, like crowdRows.
// Returns { bareLowerTargetName: [hunterDisplay, hunterKills, hunterDeaths] },
// one hunter per target: the hunter with the most kills on them (ties: fewer
// deaths). The numbers are the HUNTER's kills/deaths, so the crowd line shows
// them flipped (k = hunterDeaths, d = hunterKills) to stay in the viewed
// player's perspective like the nemesis / target lines.
// No farm or hidden filter: the map must answer "whose target is this player,
// per the panel's own definition", and the panel applies no such filter either.
// Bar (owner 2026-11-03): 7 is the usual bar — the PlanetSide 2 bounty-kill
// value. A target with no 7+ hunter falls back down the ladder — 6, then 5,
// and so on — to the best hunter available. 1 never counts: a single kill is
// noise. The fallback never replaces a 7+ hunter: gaps are filled from the
// floor-2 map only where the floor-7 map has no entry.
export const REV_MIN_KILLS = 7;
export const REV_FALLBACK_MIN_KILLS = 2;
const bare = (n) => String(n || "").replace(/^\[[^\]]*\]\s*/, "").trim();

function invert(players, floor) {
  const rev = {};
  for (const p of players || []) {
    const rows = (p && (p.rawRows || p.rows)) || [];
    let tgt = null;
    for (const r of rows) {
      if (!r || bare(r.name) === "0") continue;
      const k = +r.kills || 0, d = +r.deaths || 0;
      if (k > d && (!tgt || k > tgt.kills || (k === tgt.kills && d < tgt.deaths))) {
        tgt = { name: String(r.name), kills: k, deaths: d };
      }
    }
    if (!tgt || tgt.kills < floor) continue;
    const key = bare(tgt.name).toLowerCase();
    if (!key) continue;
    const cur = rev[key];
    if (!cur || tgt.kills > cur[1] || (tgt.kills === cur[1] && tgt.deaths < cur[2])) {
      rev[key] = [p.display ? String(p.display) : "", tgt.kills, tgt.deaths];
    }
  }
  return rev;
}

export function buildRevTargets(players) {
  const rev = invert(players, REV_MIN_KILLS);
  const fallback = invert(players, REV_FALLBACK_MIN_KILLS);
  for (const [key, entry] of Object.entries(fallback)) if (!rev[key]) rev[key] = entry;
  return rev;
}
