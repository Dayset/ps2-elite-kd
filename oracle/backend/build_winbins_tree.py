#!/usr/bin/env python3
"""Win% tree v3: hierarchical scenario lookup with backoff.

Structure like branches: the trunk is huge (coarse bins, massive n),
branches get smaller and more specific. Lookup walks down as far as
the samples allow, then uses the deepest branch with n >= MIN_N.

Levels:
  L0 (trunk):   (t_bucket, faction, terr_bucket)
  L1 (branch):  + momentum_bucket  (up / flat / down, 15-min)
  L2 (twig):    + margin_bucket    (behind / close / clear / dominant)

A twig with n<20 falls back to its branch; a thin branch falls back
to the trunk. The tree never pretends a thin twig is certain.
"""
import json, glob, os
from build_winbins import territory_minutes, parse_ts, FACTIONS, ROOT

MIN_N = 20

def mom_bucket(m):
    if m >= 3:
        return "up"
    if m <= -3:
        return "down"
    return "flat"

def marg_bucket(margin):
    if margin < 0:
        return "behind"
    if margin < 10:
        return "close"
    if margin < 20:
        return "clear"
    return "dominant"

def main():
    l0, l1, l2 = {}, {}, {}
    used = skipped = 0
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
                t = terr[fac]
                tb = min(int(t // 5), 20)
                mb = mom_bucket(t - terr0[fac])
                mg = t - max(v for k, v in terr.items() if k != fac)
                gb = marg_bucket(mg)
                won = 1 if FACTIONS[victor] == fac else 0
                for d, key in ((l0, (b, fac, tb)),
                               (l1, (b, fac, tb, mb)),
                               (l2, (b, fac, tb, mb, gb))):
                    cell = d.setdefault(key, [0, 0])
                    cell[1] += 1
                    cell[0] += won
    # keep all L0; prune thin branches/twigs (lookup backs off anyway, but
    # pruning keeps the file small and honest)
    l1k = {k: v for k, v in l1.items() if v[1] >= MIN_N}
    l2k = {k: v for k, v in l2.items() if v[1] >= MIN_N}
    tree = {"meta": {"alerts_used": used, "alerts_skipped": skipped, "min_n": MIN_N,
                     "zone": 4, "levels": ["(t,fac,terr)", "(t,fac,terr,mom)", "(t,fac,terr,mom,margin)"],
                     "l0": len(l0), "l1": len(l1k), "l2": len(l2k)},
            "l0": {",".join(map(str, k)): v for k, v in l0.items()},
            "l1": {",".join(map(str, k)): v for k, v in l1k.items()},
            "l2": {",".join(map(str, k)): v for k, v in l2k.items()}}
    json.dump(tree, open(os.path.join(ROOT, "winbins_tree.json"), "w"))
    print(f"used={used} l0={len(l0)} l1={len(l1k)} l2={len(l2k)}")
    print("wrote winbins_tree.json")


def lookup(tree, b, fac, terr, mom, marg):
    """Walk down as far as samples allow. Returns (win_pct, level, n)."""
    tb = min(int(terr // 5), 20)
    mb = mom_bucket(mom)
    gb = marg_bucket(marg)
    l0, l1, l2 = tree["l0"], tree["l1"], tree["l2"]
    key2 = f"{b},{fac},{tb},{mb},{gb}"
    if key2 in l2:
        w, n = l2[key2]
        return 100.0 * w / n, "twig", n
    key1 = f"{b},{fac},{tb},{mb}"
    if key1 in l1:
        w, n = l1[key1]
        return 100.0 * w / n, "branch", n
    key0 = f"{b},{fac},{tb}"
    if key0 in l0:
        w, n = l0[key0]
        return 100.0 * w / n, "trunk", n
    return None, "none", 0


if __name__ == "__main__":
    main()
