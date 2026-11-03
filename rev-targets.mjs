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
// Floor (owner 2026-11-03): a hunter needs at least 7 kills on the target —
// 7 is the PlanetSide 2 bounty-kill value, picked between the measured 5
// (keeps 77% of hunters) and 10 (keeps 50%; 10 is the median, not a small cut).
export const REV_MIN_KILLS = 7;
const bare = (n) => String(n || "").replace(/^\[[^\]]*\]\s*/, "").trim();

export function buildRevTargets(players) {
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
    if (!tgt || tgt.kills < REV_MIN_KILLS) continue;
    const key = bare(tgt.name).toLowerCase();
    if (!key) continue;
    const cur = rev[key];
    if (!cur || tgt.kills > cur[1] || (tgt.kills === cur[1] && tgt.deaths < cur[2])) {
      rev[key] = [p.display ? String(p.display) : "", tgt.kills, tgt.deaths];
    }
  }
  return rev;
}
