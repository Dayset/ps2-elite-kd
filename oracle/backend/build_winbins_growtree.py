#!/usr/bin/env python3
"""Win% growing tree v4: twigs that get fat sprout their own branches.

Levels:
  L0 trunk:   (t, fac, terr)
  L1 branch:  + momentum          (up / flat / down, 15-min)
  L2 twig:    + margin            (behind / close / clear / dominant)
  L3 shoot:   + surge magnitude   (up: warm +3..8 / hot +8+;
                                   down: cool -3..-8 / cold -8-; flat: -)
  L4 leaf:    + matchup           (nearest rival faction)

A cell is kept when n >= MIN_N. Lookup walks down as far as kept cells
allow (backoff) — the tree grows exactly where the data feeds it, and
never pretends a thin leaf is certain.
"""
import json, glob, os, argparse
from build_winbins import territory_minutes, parse_ts, FACTIONS, ROOT
from build_winbins_tree import mom_bucket, marg_bucket

MIN_N = 20
ZONE_NAMES = {2: "Indar", 4: "Hossin", 6: "Amerish", 8: "Esamir", 344: "Oshur"}


def mag_bucket(mom_b, m):
    if mom_b == "up":
        return "hot" if m >= 8 else "warm"
    if mom_b == "down":
        return "cold" if m <= -8 else "cool"
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zone", type=int, default=4)
    args = ap.parse_args()
    zone = args.zone
    levels = [{} for _ in range(5)]
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
        if inst.get("zone") != zone:
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
        try:
            dur_min = (parse_ts(inst["timeEnded"]) - parse_ts(inst["timeStarted"])).total_seconds() / 60
        except (TypeError, AttributeError):
            skipped += 1
            continue
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
                mo = t - terr0[fac]
                mb = mom_bucket(mo)
                mg = t - max(v for k, v in terr.items() if k != fac)
                gb = marg_bucket(mg)
                won = 1 if FACTIONS[victor] == fac else 0
                keys = [(b, fac, tb),
                        (b, fac, tb, mb),
                        (b, fac, tb, mb, gb)]
                magb = mag_bucket(mb, mo)
                if magb:
                    keys.append((b, fac, tb, mb, gb, magb))
                    rival = max((k for k in terr if k != fac), key=lambda k: terr[k])
                    keys.append((b, fac, tb, mb, gb, magb, rival))
                for d, key in enumerate(keys):
                    cell = levels[d].setdefault(key, [0, 0])
                    cell[1] += 1
                    cell[0] += won
    kept = []
    for d, lv in enumerate(levels):
        k = {",".join(map(str, kk)): v for kk, v in lv.items() if v[1] >= MIN_N}
        kept.append(k)
    names = ["trunk", "branch", "twig", "shoot", "leaf"]
    tree = {"meta": {"alerts_used": used, "alerts_skipped": skipped,
                     "min_n": MIN_N, "zone": zone,
                     "levels": ["(t,fac,terr)", "(t,fac,terr,mom)",
                                "(t,fac,terr,mom,margin)", "(t,fac,terr,mom,margin,mag)",
                                "(t,fac,terr,mom,margin,mag,rival)"],
                     "cells": {n: len(k) for n, k in zip(names, kept)}},
            **{n: k for n, k in zip(names, kept)}}
    out = os.path.join(ROOT, f"winbins_growtree_z{zone}.json")
    json.dump(tree, open(out, "w"))
    print(f"used={used} cells=" + " ".join(f"{n}={len(k)}" for n, k in zip(names, kept)))
    print(f"wrote {out}")
    # zone 4 keeps the canonical name too
    if zone == 4:
        json.dump(tree, open(os.path.join(ROOT, "winbins_growtree.json"), "w"))
        print("wrote winbins_growtree.json (canonical Hossin)")


def lookup(tree, b, fac, terr, mom, marg, rival, xtree=None):
    """Deepest kept cell wins; cross-continent trunk is the last backoff
    for thin Hossin cells. Returns (win_pct, level_name, n)."""
    tb = min(int(terr // 5), 20)
    mb = mom_bucket(mom)
    gb = marg_bucket(marg)
    magb = mag_bucket(mb, mom)
    names = ["trunk", "branch", "twig", "shoot", "leaf"]
    keys = [f"{b},{fac},{tb}",
            f"{b},{fac},{tb},{mb}",
            f"{b},{fac},{tb},{mb},{gb}"]
    if magb:
        keys.append(f"{b},{fac},{tb},{mb},{gb},{magb}")
        keys.append(f"{b},{fac},{tb},{mb},{gb},{magb},{rival}")
    for key, name in zip(reversed(keys), reversed(names[:len(keys)])):
        cell = tree[name].get(key)
        if cell:
            return 100.0 * cell[0] / cell[1], name, cell[1]
    if xtree is not None:
        cell = xtree["cells"].get(f"{b},{fac},{tb}")
        if cell:
            return 100.0 * cell[0] / cell[1], "xtrunk", cell[1]
    return None, "none", 0


if __name__ == "__main__":
    main()
