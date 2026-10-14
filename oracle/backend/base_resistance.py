#!/usr/bin/env python3
"""Base resistance ranking for Hossin.

Per base: flip count, flip rate, avg hold time (flip speed),
and per-faction avg hold time = resistance factor.
"""
import json, glob, os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from collections import defaultdict

ROOT = os.path.dirname(os.path.abspath(__file__))
FAC = {"1": "VS", "2": "NC", "3": "TR"}

def main():
    names = {}
    for r in json.load(open(os.path.join(ROOT, "hossin_regions.json"))):
        names[str(r["facility_id"])] = r["facility_name"]

    flips = defaultdict(int)          # base -> total flips
    seen = defaultdict(int)           # base -> alerts seen in
    gaps = defaultdict(list)          # base -> inter-flip gaps (flip speed)
    fac_hold = defaultdict(lambda: defaultdict(list))  # base -> fac -> hold times
    n_alerts = 0

    for fn in glob.glob(os.path.join(ROOT, "data", "alerts", "*.json")):
        try:
            rec = json.load(open(fn))
        except Exception:
            continue
        if rec["instance"].get("zone") != 4:
            continue
        n_alerts += 1
        byb = defaultdict(list)
        bases = set()
        for e in rec["facility"]:
            f = str(e["facility"])
            bases.add(f)
            if e.get("isInitial"):
                continue
            o, nw = str(e.get("oldFaction")), str(e.get("newFaction"))
            if o not in FAC or nw not in FAC or o == nw:
                continue
            flips[f] += 1
            try:
                dh = float(e.get("durationHeld") or 0)
            except Exception:
                dh = 0
            byb[f].append((e["timestamp"], o, dh))
        for b in bases:
            seen[b] += 1
        for f, es in byb.items():
            es.sort(key=lambda x: x[0])
            prev_dh = None
            for ts, o, dh in es:
                # durationHeld is cumulative per base; hold time = diff vs previous flip.
                first = prev_dh is None
                gap = dh if first else max(0.0, dh - prev_dh)
                prev_dh = dh
                if gap <= 0 or gap > 30 * 86400:
                    continue  # ignore counter anomalies (>30d)
                if not first:
                    gaps[f].append(gap)  # inter-flip gap (first flip includes pre-alert hold)
                fac_hold[f][o].append(gap)  # resistance: how long oldFaction held it

    print(f"alerts: {n_alerts}, bases tracked: {len(seen)}")

    from statistics import median

    def nm(f):
        return names.get(f, f)

    def med_min(xs):
        return median(xs) / 60

    # 1. most flipped
    print("\n=== TOP 20 MOST-FLIPPED BASES ===")
    top_flip = sorted(flips, key=lambda f: -flips[f])[:20]
    for f in top_flip:
        print(f"  {nm(f):32s} {flips[f]:5d} flips  ({flips[f]/seen[f]:.2f}/alert)")

    # 2. fastest flipping (min 50 gaps, median)
    print("\n=== TOP 20 FASTEST-FLIPPING (median hold, min 50 gaps) ===")
    fast = [f for f in gaps if len(gaps[f]) >= 50]
    fast.sort(key=lambda f: med_min(gaps[f]))
    for f in fast[:20]:
        print(f"  {nm(f):32s} median hold {med_min(gaps[f]):5.1f} min  ({flips[f]} flips)")

    # 3. resistance: median hold per faction per base (min 15 holds each)
    print("\n=== FACTION RESISTANCE (median hold minutes, min 15 holds each) — top 20 by max faction ===")
    res = []
    for f, d in fac_hold.items():
        if all(len(d[fac]) >= 15 for fac in ("1", "2", "3")):
            m = {fac: med_min(d[fac]) for fac in ("1", "2", "3")}
            best = max(m, key=m.get)
            res.append((m[best], f, best, m))
    res.sort(reverse=True)
    for mv, f, best, m in res[:20]:
        print(f"  {nm(f):32s} VS {m['1']:6.1f} / NC {m['2']:6.1f} / TR {m['3']:6.1f} min")

    # 3b. strongholds: one faction's median hold >= 3x the best of the other two
    print("\n=== STRONGHOLDS (one faction median hold >= 3x others) ===")
    strong = []
    for mv, f, best, m in res:
        others = [v for k, v in m.items() if k != best]
        if mv >= 3 * max(others) and mv >= 30:
            strong.append((mv / max(others), f, best, m))
    strong.sort(reverse=True)
    for ratio, f, best, m in strong[:15]:
        print(f"  {nm(f):32s} {FAC[best]} {m[best]:6.1f} min vs "
              f"{'/'.join(f'{m[k]:.1f}' for k in ('1','2','3') if k != best)}  ({ratio:.1f}x)")

    # chart: top 15 flipped
    top15 = top_flip[:15]
    fig, ax = plt.subplots(figsize=(10, 6))
    ax.barh([nm(f) for f in reversed(top15)], [flips[f] for f in reversed(top15)],
            color="#4da3ff")
    ax.set_xlabel("total flips (all Hossin alerts)")
    ax.set_title("Hossin: most-contested bases")
    fig.tight_layout()
    out = os.path.join(ROOT, "base_flip_ranking.png")
    fig.savefig(out, dpi=110)
    print("\nwrote", out)

    # slowest (most stable) bases for contrast
    print("\n=== TOP 10 MOST STABLE (lowest flips/alert, min 100 alerts seen) ===")
    stable = [f for f in seen if seen[f] >= 100 and f in flips]
    stable.sort(key=lambda f: flips[f] / seen[f])
    for f in stable[:10]:
        print(f"  {nm(f):32s} {flips[f]/seen[f]:.2f} flips/alert")

if __name__ == "__main__":
    main()
