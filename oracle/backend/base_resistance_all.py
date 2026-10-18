#!/usr/bin/env python3
"""Base resistance (median hold) for ALL continents, timestamp-diff method.

Why this file exists: base_resistance.py computes gaps from durationHeld
diffs, which does NOT reproduce the stored Hossin file (median |diff| 8.2
min, 40/85 class mismatches, 33,917 gaps vs 123,312 stored). The stored
file was built from timestamp diffs between consecutive flips inside one
alert. Verified 2026-10-18: variant G (within-alert timestamp diffs)
reproduces stored Hossin EXACTLY — total gaps 123,312, per-base n_gaps
exact, median |diff| 0.03 min (rounding).

Method (per alert, per base):
- qualifying flips: not isInitial, oldFaction != newFaction, both in {1,2,3}
- sort by timestamp; gap = ts[i] - ts[i-1] for i>=1; keep 0 < gap <= 30d
- gap is attributed to the oldFaction of the CLOSING event (the faction
  that held the base during the gap) for by_defender medians
- median_hold_min = median(gaps)/60; n_gaps = len(gaps)
- class: rank-based tertiles of that continent's own per-base medians,
  sorted by (median, fid): first ceil(n/3) GLASS, last ceil(n/3) STRONGHOLD

Writes base_resistance_<continent>.json per continent. NEVER overwrites
the stored Hossin base_resistance.json (it is the validated reference).
"""
import json, glob, os, statistics
from collections import defaultdict
from datetime import datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
FAC = {"1": "VS", "2": "NC", "3": "TR"}
ZONE_NAMES = {2: "indar", 4: "hossin", 6: "amerish", 8: "esamir", 344: "oshur"}

def parse_ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()

def main():
    names = {}
    warpgates = set()
    for z, zn in ZONE_NAMES.items():
        for r in json.load(open(os.path.join(ROOT, f"{zn}_regions.json"))):
            names[(z, str(r["facility_id"]))] = r["facility_name"]
            # facility_type_id 7 = spawn warpgate (never capturable; its few
            # "gaps" are data artifacts). Esamir's Shattered Warpgate is
            # type 0 and IS capturable, so it stays.
            if str(r.get("facility_type_id")) == "7":
                warpgates.add((z, str(r["facility_id"])))

    gaps = defaultdict(lambda: defaultdict(list))          # zone -> fid -> gaps (sec)
    by_fac = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    n_alerts = defaultdict(int)

    for fn in sorted(glob.glob(os.path.join(ROOT, "data", "alerts", "*.json"))):
        try:
            rec = json.load(open(fn))
        except Exception:
            continue
        zone = rec["instance"].get("zone")
        if zone not in ZONE_NAMES:
            continue
        n_alerts[zone] += 1
        byb = defaultdict(list)
        for e in rec["facility"]:
            if e.get("isInitial"):
                continue
            o, nw = str(e.get("oldFaction")), str(e.get("newFaction"))
            if o not in FAC or nw not in FAC or o == nw:
                continue
            byb[str(e["facility"])].append((parse_ts(e["timestamp"]), o))
        for f, es in byb.items():
            es.sort(key=lambda x: x[0])
            for (ts0, _), (ts1, o1) in zip(es, es[1:]):
                g = ts1 - ts0
                if 0 < g <= 30 * 86400:
                    gaps[zone][f].append(g)
                    by_fac[zone][f][o1].append(g)

    for zone, zn in ZONE_NAMES.items():
        zd = {}
        for f, gs in gaps[zone].items():
            if (zone, f) in warpgates:
                continue
            if (zone, f) not in names:
                # Facility ID with flips in alert data but no entry in the
                # continent's regions/links (e.g. Amerish 400127, Esamir
                # 400311/400316): unmappable, the commander cannot display
                # it. Excluded rather than letting it take a tertile slot.
                continue
            bd = {FAC[fac]: {"median_hold_min": round(statistics.median(v) / 60, 1),
                             "n": len(v)}
                  for fac, v in by_fac[zone][f].items() if v}
            zd[f] = {"name": names.get((zone, f), f),
                     "median_hold_min": round(statistics.median(gs) / 60, 1),
                     "n_gaps": len(gs),
                     "by_defender": bd}
        ordered = sorted(zd.items(), key=lambda kv: (kv[1]["median_hold_min"], kv[0]))
        n = len(ordered)
        n_edge = (n + 2) // 3  # ceil(n/3)
        for i, (fid, v) in enumerate(ordered):
            v["class"] = "GLASS" if i < n_edge else ("STRONGHOLD" if i >= n - n_edge else "NORMAL")
        out_path = os.path.join(ROOT, f"base_resistance_{zn}.json")
        json.dump(zd, open(out_path, "w"), indent=1)
        meds = [v["median_hold_min"] for v in zd.values()]
        ref = statistics.median(meds)
        facs = [ref / v["median_hold_min"] for v in zd.values()]
        print(f"{zn} (zone {zone}): alerts={n_alerts[zone]} bases={n} "
              f"median_hold={ref:.1f} min={min(meds):.1f} max={max(meds):.1f} "
              f"GLASS/NORMAL/STRONGHOLD="
              f"{sum(1 for v in zd.values() if v['class'] == 'GLASS')}/"
              f"{sum(1 for v in zd.values() if v['class'] == 'NORMAL')}/"
              f"{sum(1 for v in zd.values() if v['class'] == 'STRONGHOLD')} "
              f"total_gaps={sum(v['n_gaps'] for v in zd.values())} "
              f"hold_factor range {min(facs):.2f}..{max(facs):.2f} "
              f"-> {out_path}")

if __name__ == "__main__":
    main()
