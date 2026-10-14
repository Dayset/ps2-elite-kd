#!/usr/bin/env python3
"""Zone-split debute preview — per-continent archetype stats on current data.

Read-only analysis: imports load_alerts()/wilson from debute_book.py,
computes the four key slot archetypes (early_rusher, early_collapse,
pop_dominant, pop_underdog) separately per zone, using per-zone
slot-weighted base rates. Writes zone_debute_preview.json; does not
touch results.json or DEBUTE_BOOK_v1.md.

Zones: 2=Indar, 4=Hossin, 6=Amerish, 8=Esamir, 344=Oshur.
"""
import json, os, sys
from collections import Counter

sys.path.insert(0, os.path.expanduser("~/workspace/ps2polymarket"))
from debute_book import load_alerts, wilson, FACTIONS  # noqa: E402

ROOT = os.path.expanduser("~/workspace/ps2polymarket")
ZONE_NAMES = {2: "Indar", 4: "Hossin", 6: "Amerish", 8: "Esamir", 344: "Oshur"}

ARCHETYPES = {
    "early_rusher": lambda a, f: a["net15"][f] >= 5.0,
    "early_collapse": lambda a, f: a["net15"][f] <= -5.0,
    "pop_dominant": lambda a, f: a["popshare"][f] > 0.45,
    "pop_underdog": lambda a, f: a["popshare"][f] < 0.25,
}


def zone_slot_archetype(known, zone_base, name, criterion):
    rows = {}
    all_wins, all_n = 0, 0
    for f in (1, 2, 3):
        slots = [a for a in known if criterion(a, f)]
        wins = sum(1 for a in slots if a["victor"] == f)
        n = len(slots)
        wr = wins / n if n else 0
        lo, hi = wilson(wr, n)
        rows[FACTIONS[f]] = {"n": n, "win_rate": wr, "ci": [lo, hi],
                             "base": zone_base[FACTIONS[f]],
                             "lift_pp": (wr - zone_base[FACTIONS[f]]) * 100}
        all_wins += wins
        all_n += n
    pooled_base = sum(rows[FACTIONS[f]]["base"] * rows[FACTIONS[f]]["n"]
                      for f in (1, 2, 3)) / all_n if all_n else 0
    pooled_wr = all_wins / all_n if all_n else 0
    lo, hi = wilson(pooled_wr, all_n)
    rows["ALL"] = {"n": all_n, "win_rate": pooled_wr, "ci": [lo, hi],
                   "base": pooled_base, "lift_pp": (pooled_wr - pooled_base) * 100}
    return {"name": name, "rows": rows}


def main():
    alerts = load_alerts()
    known = [a for a in alerts if a["outcome"] != "unknown"]
    print(f"loaded {len(alerts)} alerts, {len(known)} with known outcomes")

    out = {"n_alerts": len(known), "zones": {}}
    for zone, zname in ZONE_NAMES.items():
        z = [a for a in known if a["zone"] == zone]
        n = len(z)
        if n == 0:
            out["zones"][zname] = {"n": 0}
            print(f"\n== {zname} (zone {zone}): n=0 ==")
            continue
        base = Counter(a["outcome"] for a in z)
        zone_base = {k: base[k] / n for k in ("VS", "NC", "TR", "draw")}
        zrec = {"n": n, "base_rates": {k: round(v * 100, 1)
                                       for k, v in zone_base.items()},
                "archetypes": {}}
        print(f"\n== {zname} (zone {zone}) n={n} "
              f"base VS={zone_base['VS']*100:.1f} NC={zone_base['NC']*100:.1f} "
              f"TR={zone_base['TR']*100:.1f} draw={zone_base['draw']*100:.1f}")
        for aname, crit in ARCHETYPES.items():
            r = zone_slot_archetype(z, zone_base, aname, crit)
            zrec["archetypes"][aname] = r
            row = r["rows"]["ALL"]
            sig = " *" if (row["ci"][0] > row["base"] or row["ci"][1] < row["base"]) else ""
            print(f"   {aname:14s} ALL n={row['n']:5d} rate={row['win_rate']*100:5.1f}% "
                  f"base={row['base']*100:4.1f}% lift={row['lift_pp']:+5.1f}pp{sig}")
        out["zones"][zname] = zrec

    with open(os.path.join(ROOT, "zone_debute_preview.json"), "w") as f:
        json.dump(out, f, indent=1)
    print("\nwrote zone_debute_preview.json  (* = 95% CI excludes zone base rate)")


if __name__ == "__main__":
    main()
