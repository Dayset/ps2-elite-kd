#!/usr/bin/env python3
"""Win% bins v2: P(win | t, territory, momentum) — scenario-conditioned.

The v1 bins are blind: P(win | t, own territory) averages over surging,
flat, and collapsing scenarios with the same number. v2 adds the 15-min
momentum dimension so the lookup sees the trajectory, not just the snapshot.
Falls back to v1 bins when the scenario cell is thin (n<20).
"""
import json, glob, os
from build_winbins import territory_minutes, parse_ts, FACTIONS, ROOT

def mom_bucket(m):
    if m >= 3:
        return "up"
    if m <= -3:
        return "down"
    return "flat"

def main():
    bins = {}
    used, skipped = 0, 0
    files = glob.glob(os.path.join(ROOT, "data", "alerts", "*.json"))
    for i, fn in enumerate(files):
        if i and i % 10000 == 0:
            print(f"  {i}/{len(files)}...", flush=True)
        try:
            rec = json.load(open(fn))
        except Exception:
            skipped += 1
            continue
        inst = rec["instance"]
        if inst.get("zone") != 4:
            continue
        res = inst.get("result") or {}
        if res.get("draw"):
            skipped += 1
            continue
        victor = res.get("victor")
        if victor not in (1, 2, 3):
            skipped += 1
            continue
        mins = territory_minutes(rec)
        if not mins:
            skipped += 1
            continue
        dur_min = (parse_ts(inst["timeEnded"]) - parse_ts(inst["timeStarted"])).total_seconds() / 60
        used += 1
        for b in range(19):
            m = b * 5
            if m > dur_min - 1 or m >= len(mins):
                continue
            terr = mins[m]
            terr0 = mins[max(0, m - 15)]
            for fac in ("VS", "NC", "TR"):
                mb = mom_bucket(terr[fac] - terr0[fac])
                tb = min(int(terr[fac] // 5), 20)
                key = f"{b},{fac},{tb},{mb}"
                cell = bins.setdefault(key, [0, 0])
                cell[1] += 1
                if FACTIONS[victor] == fac:
                    cell[0] += 1
    kept = {k: v for k, v in bins.items() if v[1] >= 20}
    out = {"meta": {"alerts_used": used, "alerts_skipped": skipped,
                    "bins_total": len(bins), "bins_kept": len(kept),
                    "min_n": 20, "zone": 4,
                    "bucket": "t=5min, faction, territory=5pp, momentum=15min(up/flat/down)"},
           "bins": {k: v for k, v in kept.items()}}
    # JSON needs string keys already; values are [wins, n]
    json.dump(out, open(os.path.join(ROOT, "winbins_mom.json"), "w"))
    print(f"used={used} skipped={skipped} bins_total={len(bins)} kept={len(kept)}")

    # demo: same (t, terr), different scenarios
    print("\n--- scenario split demo: t=60 (bucket 12), terr 45-50% ---")
    for mb in ("up", "flat", "down"):
        w = n = 0
        for fac in ("VS", "NC", "TR"):
            cell = kept.get(f"12,{fac},9,{mb}")
            if cell:
                w += cell[0]; n += cell[1]
        if n:
            print(f"  momentum {mb:5s}: {100*w/n:5.1f}% (n={n})")

if __name__ == "__main__":
    main()
