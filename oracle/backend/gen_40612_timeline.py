#!/usr/bin/env python3
"""Generate joint-model timeline for alert 10-40612 (Miller/Hossin VS blowout).

Uses the 144-bin joint model + EU_off DST-aware stratification.
Output: replay_10-40612_timeline.json
"""
import json, os
from datetime import datetime
from collections import Counter

ROOT = os.path.dirname(os.path.abspath(__file__))
FACTIONS = {1: "VS", 2: "NC", 3: "TR"}
OUTCOMES = ("vs", "nc", "tr", "draw")

# Strat rates (from hossin_base_rates_stratified.json)
STRAT = {"EU_off": {"VS": 40.3, "NC": 31.7, "TR": 28.0}}
GLOBAL = {"VS": 36.7, "NC": 30.0, "TR": 27.9}


def parse_ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def margin_bucket(m):
    if m < 5: return "contested<5"
    if m < 10: return "lead5-10"
    if m < 15: return "lead10-15"
    return "dominant15+"


def mom_bucket(m):
    if m <= -3: return "slipping"
    if m <= 3: return "flat"
    return "surging"


def time_bucket(t):
    rem = 90 - t
    if rem <= 10: return "endgame0-10"
    if rem <= 30: return "late10-30"
    if rem <= 60: return "mid30-60"
    return "early60-90"


def key_for(sh, tsh_tp, t):
    # sh: {1: pct, 2: pct, 3: pct}
    lead = max((1, 2, 3), key=lambda f: sh[f])
    margin = sh[lead] - max(sh[g] for g in (1, 2, 3) if g != lead)
    mom = sh[lead] - tsh_tp[lead]
    return (f"{FACTIONS[lead]}|{margin_bucket(margin)}|{mom_bucket(mom)}|"
            f"{time_bucket(t)}")


def strat_adjust(raw, strat_key="EU_off"):
    """Bayesian reweight: P_adj(f) propto P_bin(f) * P_strat(f)/P_global(f).
    Draw rate kept from bin (strat files have draw=0.0, not meaningful)."""
    s = STRAT[strat_key]
    w = {}
    for f in ("vs", "nc", "tr"):
        F = f.upper()
        w[f] = raw[f] * (s[F] / GLOBAL[F])
    w["draw"] = raw["draw"]
    tot = sum(w.values())
    return {f: round(w[f] / tot * 100, 1) for f in OUTCOMES}


def main():
    rec = json.load(open(os.path.join(ROOT, "data", "alerts", "10-40612.json")))
    inst = rec["instance"]
    start = parse_ts(inst["timeStarted"])

    # per-minute territory shares
    own = {}
    for e in rec["facility"]:
        if e.get("isInitial"):
            own[int(e["facility"])] = e["newFaction"]
    flips = sorted(
        (e for e in rec["facility"]
         if not e.get("isInitial") and not e.get("isDefence")),
        key=lambda e: e["timestamp"])
    total = len(own)
    tsh = []  # list of {1: pct, 2: pct, 3: pct}
    fi = 0
    cur = dict(own)
    for m in range(91):
        cutoff = start.timestamp() + m * 60
        while fi < len(flips) and parse_ts(flips[fi]["timestamp"]).timestamp() <= cutoff:
            e = flips[fi]
            cur[int(e["facility"])] = e["newFaction"]
            fi += 1
        c = Counter(cur.values())
        tsh.append({f: c.get(f, 0) / total * 100 for f in (1, 2, 3)})

    cells = json.load(open(os.path.join(ROOT, "replay_joint_cells.json")))["cells"]

    tl = []
    last = None
    for t in range(91):
        tp = max(0, t - 15)
        k = key_for(tsh[t], tsh[tp], t)
        c = cells.get(k)
        stale = c is None or c["n"] < 20
        if stale:
            r = last
        else:
            raw = {o: c[o] for o in OUTCOMES}
            r = strat_adjust(raw, "EU_off")
            last = r
        tl.append({"t": t, "vs": r["vs"], "nc": r["nc"], "tr": r["tr"],
                   "draw": r["draw"], "stale": stale,
                   "sh": {FACTIONS[f]: round(tsh[t][f], 1) for f in (1, 2, 3)}})

    # verify lead changes
    leaders = []
    for e in tl:
        sh = e["sh"]
        leaders.append(max(sh, key=lambda f: sh[f]))
    changes = sum(1 for i in range(1, len(leaders)) if leaders[i] != leaders[i-1])

    out = {
        "instanceId": "10-40612",
        "strat_key": "EU_off",
        "strat_rates": {"n": 1996, "VS": 40.3, "NC": 31.7, "TR": 28.0, "draw": 0.0},
        "dst_aware": True,
        "lead_changes": changes,
        "joint_timeline": [{k: e[k] for k in ("t", "vs", "nc", "tr", "draw", "stale")}
                            for e in tl],
        "territory_shares": [e["sh"] for e in tl],
    }
    json.dump(out, open(os.path.join(ROOT, "replay_10-40612_timeline.json"), "w"),
              separators=(",", ":"))
    print(f"wrote replay_10-40612_timeline.json, lead changes: {changes}")
    for t in (0, 15, 30, 45, 60, 75, 85, 90):
        r = tl[t]
        s = tl[t]["sh"]
        print(f"t={t:2d}: VS {r['vs']:5.1f} NC {r['nc']:5.1f} "
              f"TR {r['tr']:4.1f} draw {r['draw']:4.1f} | "
              f"terr VS {s['VS']:4.1f} NC {s['NC']:4.1f} TR {s['TR']:4.1f}")


if __name__ == "__main__":
    main()
