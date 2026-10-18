#!/usr/bin/env python3
"""Joint Hossin victor model: P(victor in {VS,NC,TR,draw} | leader, lead-margin bucket,
leader-momentum bucket, time-remaining bucket at minute t). Proper multinomial
summing to 100%.

v2: adds time-remaining as a feature (early/mid/late/endgame). A lead with
2 minutes left is worth far more than the same lead with 60 minutes left.
Faction base-rate skew is captured per-bin via historical frequencies.

Rebuilds:
  hossin_joint_model.json  - 144 bins with n, vs/nc/tr/draw percentages
  replay_joint_cells.json  - compact cells + base rates for the demo
  replay_joint_v1.json     - per-minute joint timeline for alert 10-46062
"""
import json, math, os
from collections import defaultdict
from hossin_models import load_hossin, FACTIONS

ROOT = os.path.dirname(os.path.abspath(__file__))
OUTCOMES = ("VS", "NC", "TR", "draw")


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
    """Minutes remaining = 90 - t. Late leads are stickier than early ones."""
    rem = 90 - t
    if rem <= 10: return "endgame0-10"
    if rem <= 30: return "late10-30"
    if rem <= 60: return "mid30-60"
    return "early60-90"


def wilson(p, n, z=1.96):
    if n == 0: return (0.0, 0.0)
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    m = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (round(max(0.0, (c - m) / d), 4), round(min(1.0, (c + m) / d), 4))


def key_for(sh, tsh_tp, t):
    lead = max((1, 2, 3), key=lambda f: sh[f])
    margin = sh[lead] - max(sh[g] for g in (1, 2, 3) if g != lead)
    mom = sh[lead] - tsh_tp[lead]
    return (f"{FACTIONS[lead]}|{margin_bucket(margin)}|{mom_bucket(mom)}|"
            f"{time_bucket(t)}")


def main():
    alerts = load_hossin()
    print(f"Hossin alerts loaded: {len(alerts)}")
    cells = defaultdict(lambda: defaultdict(int))
    base = defaultdict(int)
    for a in alerts:
        v = a["victor"]
        out = FACTIONS[v] if v else "draw"
        base[out] += 1
        for t in range(0, 86, 5):
            tp = max(0, t - 15)
            k = key_for(a["tsh"][t], a["tsh"][tp], t)
            cells[k][out] += 1
            cells[k]["n"] += 1
    nb = sum(base.values())
    base_rates = {k: round(base[k] / nb * 100, 1) for k in OUTCOMES}
    model = {"n_alerts": len(alerts), "base_rates": base_rates, "cells": {}}
    for k, c in sorted(cells.items()):
        tot = sum(c[o] for o in OUTCOMES)
        ci = {o: wilson(c[o] / tot, tot) for o in OUTCOMES}
        model["cells"][k] = {
            "n": c["n"],
            **{o.lower(): round(c[o] / tot * 100, 1) for o in OUTCOMES},
            "ci": {o.lower(): list(ci[o]) for o in OUTCOMES},
        }
    json.dump(model, open(os.path.join(ROOT, "hossin_joint_model.json"), "w"))
    compact = {"base_rates": base_rates, "cells": {
        k: {"n": v["n"], "vs": v["vs"], "nc": v["nc"], "tr": v["tr"], "draw": v["draw"]}
        for k, v in model["cells"].items()}}
    json.dump(compact, open(os.path.join(ROOT, "replay_joint_cells.json"), "w"),
              separators=(",", ":"))
    print(f"joint bins: {len(model['cells'])}, base_rates={base_rates}")

    # demo timeline for 10-46062
    a = next(x for x in alerts if x["iid"] == "10-46062")
    tl, last = [], None
    for t in range(91):
        tp = max(0, t - 15)
        k = key_for(a["tsh"][t], a["tsh"][tp], t)
        c = model["cells"].get(k)
        stale = c is None or c["n"] < 20
        r = None if stale else {o.lower(): c[o.lower()] for o in OUTCOMES}
        if r is None: r = last
        tl.append({"t": t, "vs": r["vs"], "nc": r["nc"], "tr": r["tr"],
                   "draw": r["draw"], "stale": stale})
        if not stale: last = r
    json.dump({"joint_timeline": tl},
              open(os.path.join(ROOT, "replay_joint_v1.json"), "w"),
              separators=(",", ":"))
    print(f"baked {len(tl)} timeline minutes")
    for t in (0, 15, 30, 45, 60, 75, 85):
        r = tl[t]
        print(f"t={t:2d}: VS {r['vs']:5.1f} NC {r['nc']:5.1f} "
              f"TR {r['tr']:5.1f} draw {r['draw']:4.1f}")
    print("tie endgames (contested<5, flat, 0-10min left) by nominal leader:")
    for lead in ("VS", "NC", "TR"):
        k = f"{lead}|contested<5|flat|endgame0-10"
        c = model["cells"].get(k)
        if c:
            print(f"  {k}: n={c['n']:4d} VS {c['vs']:5.1f} NC {c['nc']:5.1f} "
                  f"TR {c['tr']:5.1f} draw {c['draw']:4.1f}")
    stale_bins = sum(1 for v in model["cells"].values() if v["n"] < 20)
    print(f"bins: {len(model['cells'])}, stale(n<20): {stale_bins}")


if __name__ == "__main__":
    main()
