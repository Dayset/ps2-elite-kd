#!/usr/bin/env python3
"""Win-lock timing analysis: for each integer win-chance % (50-100), the median
alert minute at which a faction's DISPLAYED (normalized) win chance first
reaches it. Replicates the live oracle pipeline exactly:
  - territory reconstruction: build_winbins.territory_minutes
  - tree lookup: build_winbins_growtree.lookup (per-zone trees + xtree backoff)
  - elimination override + viewer normalization: push_live_state.build_state
Outputs JSON summary + two PNG graphs in ~/workspace/your_files/.
"""
import json, glob, os, sys
from datetime import datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
from build_winbins import FACTIONS, parse_ts
from build_winbins_growtree import lookup as tree_lookup
from live_oracle import max_swing_pp

FACTIONS_R = {v: k for k, v in FACTIONS.items()}
ORDER = ("VS", "NC", "TR")


def territory_minutes(rec):
    """Exact copy of build_winbins.territory_minutes: 91 dicts of territory %."""
    inst = rec["instance"]
    start = parse_ts(inst["timeStarted"]).timestamp()
    owner = {}
    for e in rec["facility"]:
        if e.get("isInitial"):
            owner[e["facility"]] = e["newFaction"]
    if not owner:
        return None
    flips = sorted(
        (e for e in rec["facility"]
         if not e.get("isInitial") and e.get("oldFaction") != e.get("newFaction")),
        key=lambda e: e["timestamp"])
    total = len(owner)
    minutes = []
    fi, cur = 0, dict(owner)
    for m in range(91):
        cutoff = start + m * 60
        while fi < len(flips) and parse_ts(flips[fi]["timestamp"]).timestamp() <= cutoff:
            cur[flips[fi]["facility"]] = flips[fi]["newFaction"]
            fi += 1
        counts = {1: 0, 2: 0, 3: 0}
        for fac in cur.values():
            if fac in counts:
                counts[fac] += 1
        minutes.append({FACTIONS[k]: 100.0 * v / total for k, v in counts.items()})
    return minutes


def displayed_win(tree, xtree, t, terr, terr_prev):
    """Displayed (normalized, elimination-applied) win % per faction at minute t,
    exactly as push_live_state.build_state computes it."""
    b = min(int(t) // 5, 18)
    win = {}
    for f in ORDER:
        marg = terr[f] - max(v for k, v in terr.items() if k != f)
        rival = max((k for k in terr if k != f), key=lambda k: terr[k])
        mom = terr[f] - terr_prev[f] if terr_prev is not None else 0.0
        p, level, n = tree_lookup(tree, b, f, terr[f], mom, marg, rival, xtree)
        if p is None:
            p = 0.0
        win[f] = p
    # elimination override (push_live_state.py)
    leader = max(terr, key=lambda f: terr[f])
    for f in terr:
        if f != leader and max_swing_pp(t) < (terr[leader] - terr[f]):
            win[f] = 0.0
    if all(win[f] == 0.0 for f in terr if f != leader):
        win[leader] = 100.0
    # viewer normalization
    tot = sum(win[f] for f in ORDER)
    if tot > 0:
        for f in ORDER:
            win[f] = round(100.0 * win[f] / tot, 1)
    return win


def main():
    trees = {}
    for z in (2, 4, 6, 8, 344):
        fn = os.path.join(ROOT, "winbins_growtree.json" if z == 4 else f"winbins_growtree_z{z}.json")
        trees[z] = json.load(open(fn))
    xtree = json.load(open(os.path.join(ROOT, "winbins_xtrunk.json")))

    first = {p: [] for p in range(50, 101)}   # threshold -> [first-crossing minutes]
    lock100_times = []
    n_alerts = n_skip = 0
    files = glob.glob(os.path.join(ROOT, "data", "alerts", "*.json"))
    print(f"{len(files)} alert files", flush=True)
    for i, fn in enumerate(files):
        if i and i % 5000 == 0:
            print(f"  {i}/{len(files)}  alerts={n_alerts} skip={n_skip}", flush=True)
        try:
            rec = json.load(open(fn))
        except Exception:
            n_skip += 1
            continue
        fac_evs = rec.get("facility") or []
        if len(fac_evs) < 10:
            n_skip += 1
            continue
        inst = rec.get("instance") or {}
        zone = inst.get("zone")
        tree = trees.get(zone)
        if tree is None:
            n_skip += 1
            continue
        mins = territory_minutes(rec)
        if not mins:
            n_skip += 1
            continue
        dur_ms = inst.get("duration") or 90 * 60000
        t_max = min(90, int(dur_ms / 60000))
        n_alerts += 1
        crossed = [False] * 51  # index p-50
        for t in range(t_max + 1):
            terr = mins[t]
            terr_prev = mins[t - 15] if t >= 15 else None
            win = displayed_win(tree, xtree, t, terr, terr_prev)
            mx = max(win.values())
            hi = int(mx)
            if hi >= 50:
                for p in range(50, min(hi, 100) + 1):
                    if not crossed[p - 50]:
                        crossed[p - 50] = True
                        first[p].append(t)
            if all(crossed):
                break
    # aggregate
    import statistics
    summary = {"n_alerts": n_alerts, "n_skipped": n_skip, "thresholds": {}}
    for p in range(50, 101):
        ts = sorted(first[p])
        n = len(ts)
        if n:
            summary["thresholds"][p] = {
                "median": statistics.median(ts),
                "p25": ts[int(0.25 * (n - 1))],
                "p75": ts[int(0.75 * (n - 1))],
                "reach_rate": n / n_alerts,
                "n": n,
            }
        else:
            summary["thresholds"][p] = {"median": None, "p25": None, "p75": None,
                                       "reach_rate": 0.0, "n": 0}
    out = os.path.join(ROOT, "winlock_timing_summary.json")
    json.dump(summary, open(out, "w"), indent=1)
    dist = os.path.join(ROOT, "winlock_timing_p100.json")
    json.dump({"n": len(first[100]), "times": sorted(first[100])}, open(dist, "w"))
    print(f"alerts={n_alerts} skipped={n_skip}", flush=True)
    print(f"wrote {out} and {dist}", flush=True)
    # key numbers for the report
    for p in (50, 60, 70, 80, 90, 95, 100):
        s = summary["thresholds"][p]
        print(f"p={p}: median={s['median']} iqr=[{s['p25']},{s['p75']}] "
              f"reach={s['reach_rate']:.3f}", flush=True)
    t100 = sorted(first[100])
    n100 = len(t100)
    if n100:
        le80 = sum(1 for x in t100 if x <= 80) / n100
        le85 = sum(1 for x in t100 if x <= 85) / n100
        eq90 = sum(1 for x in t100 if x == 90) / n100
        print(f"100%: share<=80min={le80:.3f} <=85min={le85:.3f} ==90={eq90:.3f}",
              flush=True)


if __name__ == "__main__":
    main()
