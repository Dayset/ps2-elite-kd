#!/usr/bin/env python3
"""Commander data (elimination, critical bases, kingmaker, etc.) for 10-40612.
Mirrors hossin_elimination.py logic, parameterized for the new alert.
Output: replay_10-40612_commander.json
"""
import json, os, sys
from datetime import datetime
from collections import defaultdict

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
import hossin_elimination as he

IID = "10-40612"


def parse_ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def load_replay_40612():
    m = json.load(open(os.path.join(ROOT, "replay_map_10-40612.json")))
    fac = m["fac"]
    links = m["links"]
    init = {fid: int(v) for fid, v in m["init"].items()}
    flips = sorted(m["flips"])
    adj = defaultdict(set)
    for a, b in links:
        a, b = str(a), str(b)
        adj[a].add(b); adj[b].add(a)
    return fac, adj, init, flips


def build_pop_tl():
    """Per-minute pop shares from raw alert file (same format as replay_10-46062.json)."""
    rec = json.load(open(os.path.join(ROOT, "data", "alerts", f"{IID}.json")))
    inst = rec["instance"]
    start = parse_ts(inst["timeStarted"])
    pop_min = []
    for m in range(91):
        best = None
        for p in rec["population"]:
            dt = (parse_ts(p["timestamp"]) - start).total_seconds() / 60
            if dt <= m and (best is None or dt > best[0]):
                best = (dt, p)
        s = best[1] if best else {"vs": 0, "nc": 0, "tr": 0, "nso": 0, "total": 0}
        denom = (s["vs"] + s["nc"] + s["tr"]) or 1
        pop_min.append({
            "VS_share": round(100 * s["vs"] / denom, 1),
            "NC_share": round(100 * s["nc"] / denom, 1),
            "TR_share": round(100 * s["tr"] / denom, 1),
            "total": s["total"],
        })
    return {m: pop_min[m] for m in range(91)}


def main():
    he._names = {}
    fac, adj, init, flips = load_replay_40612()
    names = {fid: v[0] for fid, v in fac.items()}
    he._names = names
    pf, _ = he.load_capture_model()

    tl = {e["t"]: e for e in
          json.load(open(os.path.join(ROOT, "replay_10-40612_timeline.json")))["joint_timeline"]}
    pop_tl = build_pop_tl()

    timeline = []
    for t in range(91):
        own = he.ownership_at(init, flips, t)
        sh = he.shares(own)
        elim = {f: he.eliminated(sh, f, t) for f in ("VS", "NC", "TR")}
        own_then = he.ownership_at(init, flips, max(0, t - 15))
        sh_then = he.shares(own_then)
        lead_now = max(sh, key=lambda f: sh[f])
        mom = he.momentum_of(sh, sh_then, lead_now)
        w0 = {"VS": tl[t]["vs"], "NC": tl[t]["nc"], "TR": tl[t]["tr"]}
        critical = []
        for f in ("VS", "NC", "TR"):
            if elim[f]:
                continue
            mte_base = he.minutes_to_elimination(sh, sh_then, f, t)
            for fid in he.frontier_of(own, adj, f):
                o2 = dict(own)
                fo = he.INV[f]
                taker = next((own[nb] for nb in adj.get(fid, ())
                              if own.get(nb, fo) not in (fo, 0)), None)
                if taker is None:
                    continue
                o2[fid] = taker
                sh2 = he.shares(o2)
                elim2 = he.eliminated(sh2, f, t)
                w2 = he.joint_win(sh2, t, mom) or {}
                wb, wa = w0.get(f, 0), w2.get(f, 0)
                drop = wb - wa
                casc = he.cascade_size(own, adj, fid, f)
                mte_cf = he.minutes_to_elimination(sh2, sh_then, f, t)
                breaking = False
                if mte_base is None and mte_cf is not None and mte_cf <= 30:
                    breaking = True
                elif (mte_base is not None and mte_cf is not None
                      and mte_base - mte_cf >= 15):
                    breaking = True
                critical.append({
                    "fac": fid, "name": names.get(fid, fid),
                    "owner": f, "taker": he.FACTIONS[taker],
                    "win_before": round(wb, 1), "win_after": round(wa, 1),
                    "drop": round(drop, 1),
                    "eliminated_after": elim2,
                    "cascade": casc,
                    "breaking": breaking,
                    "mte_after": mte_cf,
                    "severity": ("ELIMINATED" if elim2 else
                                 "BREAKING" if breaking else
                                 "CRITICAL" if drop >= 15 else
                                 "WATCH" if drop >= 5 or casc >= 3 else "minor"),
                })
        critical.sort(key=lambda c: (c["eliminated_after"], c["breaking"],
                                      c["drop"]), reverse=True)
        kept = [c for c in critical
                if c["severity"] in ("ELIMINATED", "CRITICAL", "BREAKING")]
        rest = [c for c in critical
                if c["severity"] not in ("ELIMINATED", "CRITICAL", "BREAKING")]
        kept += rest[:max(0, 5 - len(kept))]

        opportunities = []
        for f in ("VS", "NC", "TR"):
            if elim[f]:
                continue
            fo = he.INV[f]
            cands = []
            for fid, enemy in he.enemy_frontier_of(own, adj, f):
                o2 = dict(own)
                o2[fid] = fo
                sh2 = he.shares(o2)
                elim_enemy = he.eliminated(sh2, enemy, t)
                w2 = he.joint_win(sh2, t, mom) or {}
                wb_e = w0.get(enemy, 0)
                wa_e = w2.get(enemy, 0)
                edrop = wb_e - wa_e
                gain = w2.get(f, 0) - w0.get(f, 0)
                margin_cut = (sh[enemy] - sh[f]) - (sh2[enemy] - sh2[f])
                cands.append({
                    "fac": fid, "name": names.get(fid, fid),
                    "attacker": f, "defender": enemy,
                    "enemy_win_before": round(wb_e, 1),
                    "enemy_win_after": round(wa_e, 1),
                    "own_gain": round(gain, 1),
                    "eliminates": elim_enemy,
                    "score": (1000 if elim_enemy else 0) + edrop + gain + margin_cut,
                })
            if cands:
                cands.sort(key=lambda c: c["score"], reverse=True)
                best = cands[0]
                is_trailing = sh[f] < max(sh.values()) - 5
                if best["score"] > 1 or is_trailing:
                    opportunities.append(best)
        timeline.append({"t": t, "elim": elim, "critical": kept[:5],
                         "opportunities": opportunities,
                         "heuristics": he.command_heuristics(sh, pop_tl.get(t, {}),
                                                             own, adj, t),
                         "ranked": he.ranked_options(sh, w0, own, adj, t, mom, pf),
                         "kingmaker": he.kingmaker_ops(sh, w0, own, adj, t, mom)})
    json.dump({"timeline": timeline,
               "params": {"pp_per_fac": round(he.PP_PER_FAC, 3),
                          "lanes": he.LANES, "min_per_base": he.MIN_PER_BASE}},
              open(os.path.join(ROOT, "replay_10-40612_commander.json"), "w"),
              separators=(",", ":"))
    print("wrote replay_10-40612_commander.json")
    print("elimination timeline (first t each faction eliminated):")
    seen = {}
    for e in timeline:
        for f in ("VS", "NC", "TR"):
            if e["elim"][f] and f not in seen:
                seen[f] = e["t"]
    print(" ", seen or "none eliminated")
    print("critical-base moments (drop >= 25 or eliminated):")
    shown = 0
    for e in timeline:
        for c in e["critical"]:
            if shown < 12 and (c["eliminated_after"] or c["drop"] >= 25):
                print(f"  t={e['t']:2d} {c['owner']} holds {c['name']}: "
                      f"{c['win_before']}% -> {c['win_after']}%"
                      f"{' ELIMINATED' if c['eliminated_after'] else ''}")
                shown += 1
    if shown == 0:
        print("  (none — blowout, no high-severity critical moments)")


if __name__ == "__main__":
    main()
