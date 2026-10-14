#!/usr/bin/env python3
"""Build historical Hossin win% bins from PS2Alerts data.

Bin dimensions: 5-minute time bucket x faction x 5pp territory bucket -> {wins, n}.
Territory reconstruction copies gen_replay.py: initial ownership (isInitial)
plus chronological flips, each base weighted equally (100 / total bases).
Usage: python3 build_winbins.py   (writes winbins.json)
"""
import json, glob, os
from datetime import datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
FACTIONS = {1: "VS", 2: "NC", 3: "TR"}

def parse_ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))

def territory_minutes(rec):
    """Return list of 91 dicts {VS,NC,TR} territory shares from alert record."""
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

def main():
    bins = {}          # (t_bucket, faction, terr_bucket) -> [wins, n]
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
        victor, draw = res.get("victor"), res.get("draw")
        if draw or victor not in (1, 2, 3):
            skipped += 1
            continue
        minutes = territory_minutes(rec)
        if minutes is None:
            skipped += 1
            continue
        used += 1
        for m, terr in enumerate(minutes):
            tb_t = m // 5
            for fac_id, fac in FACTIONS.items():
                terr_b = min(int(terr[fac]) // 5, 20)
                key = (tb_t, fac, terr_b)
                cell = bins.get(key)
                if cell is None:
                    cell = bins[key] = [0, 0]
                cell[1] += 1
                if victor == fac_id:
                    cell[0] += 1
    # drop thin bins
    kept = {f"{t},{f},{tb}": cell for (t, f, tb), cell in bins.items() if cell[1] >= 20}
    out = {"meta": {"alerts_used": used, "alerts_skipped": skipped,
                    "bins_total": len(bins), "bins_kept": len(kept),
                    "min_n": 20, "zone": 4,
                    "bucket": "t=5min, faction, territory=5pp"},
           "bins": kept}
    path = os.path.join(ROOT, "winbins.json")
    json.dump(out, open(path, "w"))
    print(f"alerts used: {used}, skipped: {skipped}")
    print(f"bins: {len(bins)} total, {len(kept)} kept (n>=20) -> {path}")

    # sanity checks
    def wpct(t, fac, terr_b):
        cell = kept.get(f"{t},{fac},{terr_b}")
        return cell[0] / cell[1] if cell else None
    print("\nsanity: t=0 bucket, terr 30-35% (bucket 6):")
    for fac in ("VS", "NC", "TR"):
        print(f"  {fac}: {wpct(0, fac, 6)}")
    print("sanity: t=85 bucket (t=17), leader at 60-65% (bucket 12):")
    for fac in ("VS", "NC", "TR"):
        print(f"  {fac}: {wpct(17, fac, 12)}")
    print("sanity: t=85, trailer at 10-15% (bucket 2):")
    for fac in ("VS", "NC", "TR"):
        print(f"  {fac}: {wpct(17, fac, 2)}")

if __name__ == "__main__":
    main()
