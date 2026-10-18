#!/usr/bin/env python3
"""Generate a replay timeline JSON for the debute-book visual demo.

Alert: 10-46062 (Miller Hossin, 2026-09-29) — the comeback. VS led 58% at
half; TR won. Perfect for showing hints firing as the story unfolds.

Output: ~/workspace/ps2polymarket/replay_10-46062.json with:
  meta, per-minute territory shares, per-minute pop, hint events
  (opening classification + rolling collapse/momentum warnings with
  book stats baked in).
"""
import json, os
from datetime import datetime, timezone

ROOT = os.path.expanduser("~/workspace/ps2polymarket")
ALERT = "10-46062"

BOOK = {
    "base": {"VS": 37.6, "TR": 29.6, "NC": 27.1, "draw": 5.7},
    "early_rusher": {"line": 40.4, "base": 32.0, "n": 223,
                     "desc": "gained 5+ points of territory in 15 min"},
    "early_collapse": {"line": 19.0, "base": 31.4, "n": 211,
                       "desc": "lost 5+ points of territory in 15 min"},
    "pop_underdog": {"line": 23.9, "base": 31.6, "n": 222,
                     "desc": "started with <25% of continent pop"},
}
FACTIONS = {1: "VS", 2: "NC", 3: "TR"}


def parse_ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def main():
    rec = json.load(open(os.path.join(ROOT, "data", "alerts", f"{ALERT}.json")))
    inst = rec["instance"]
    start = parse_ts(inst["timeStarted"])

    # --- territory reconstruction: initial ownership + chronological flips
    owner = {}
    for e in rec["facility"]:
        if e.get("isInitial"):
            owner[e["facility"]] = e["newFaction"]
    flips = sorted(
        (e for e in rec["facility"]
         if not e.get("isInitial") and e.get("oldFaction") != e.get("newFaction")),
        key=lambda e: e["timestamp"])
    total = len(owner)
    # per-minute shares
    minutes = []
    fi = 0
    flips_sorted = flips
    cur = dict(owner)
    for m in range(0, 91):
        cutoff = start.timestamp() + m * 60
        while fi < len(flips_sorted) and parse_ts(flips_sorted[fi]["timestamp"]).timestamp() <= cutoff:
            e = flips_sorted[fi]
            cur[e["facility"]] = e["newFaction"]
            fi += 1
        counts = {1: 0, 2: 0, 3: 0}
        for f, fac in cur.items():
            if fac in counts:
                counts[fac] += 1
        minutes.append({FACTIONS[k]: round(100 * v / total, 1) for k, v in counts.items()})

    # --- population per minute (samples are ~1/min; index by minute)
    pop_min = []
    for m in range(0, 91):
        best = None
        for p in rec["population"]:
            dt = (parse_ts(p["timestamp"]) - start).total_seconds() / 60
            if dt <= m and (best is None or dt > best[0]):
                best = (dt, p)
        s = best[1] if best else {"vs": 0, "nc": 0, "tr": 0, "nso": 0, "total": 0}
        denom = (s["vs"] + s["nc"] + s["tr"]) or 1
        pop_min.append({
            "VS": s["vs"], "NC": s["nc"], "TR": s["tr"], "NSO": s["nso"],
            "total": s["total"],
            "VS_share": round(100 * s["vs"] / denom, 1),
            "NC_share": round(100 * s["nc"] / denom, 1),
            "TR_share": round(100 * s["tr"] / denom, 1),
        })

    # --- recent flips feed (for the event ticker, sampled)
    flip_feed = [{"t": round((parse_ts(e["timestamp"]) - start).total_seconds() / 60, 1),
                  "from": FACTIONS.get(e["oldFaction"], "?"),
                  "to": FACTIONS.get(e["newFaction"], "?")}
                 for e in flips_sorted]

    # --- hint events
    hints = []

    def delta(fac, a, b):
        return minutes[b][fac] - minutes[a][fac]

    def pct_str(fac, d, t_base):
        base = minutes[t_base][fac]
        if base < 1:
            return f"{d:+.1f}%"
        return f"{100.0 * d / base:+.1f}%"

    # t=0: pop underdog check
    p0 = pop_min[0]
    for fac in ("VS", "NC", "TR"):
        if p0[f"{fac}_share"] < 25 and p0["total"] > 0:
            b = BOOK["pop_underdog"]
            hints.append({
                "t": 0, "kind": "pop_underdog", "faction": fac,
                "title": f"{fac} starts underpopulated",
                "detail": (f"{fac} holds {p0[f'{fac}_share']}% of pop at alert start. "
                           f"Factions like this win {b['line']}% vs {b['base']}% base (n={b['n']})."),
                "stat": f"{b['line']}% vs {b['base']}%",
            })

    # t=15: opening classification
    for fac in ("VS", "NC", "TR"):
        d = delta(fac, 0, 15)
        ps = pct_str(fac, d, 0)
        if d >= 5:
            b = BOOK["early_rusher"]
            hints.append({
                "t": 15, "kind": "early_rusher", "faction": fac,
                "title": f"{fac} rushing the opening",
                "detail": (f"{fac} {ps} territory in 15 min. Factions that open like this "
                           f"win {b['line']}% vs {b['base']}% base (n={b['n']})."),
                "stat": f"{ps} → {b['line']}%",
            })
        elif d <= -5:
            b = BOOK["early_collapse"]
            hints.append({
                "t": 15, "kind": "early_collapse", "faction": fac,
                "title": f"{fac} collapsing early",
                "detail": (f"{fac} {ps} territory in 15 min. Factions that open like this "
                           f"win only {b['line']}% vs {b['base']}% base (n={b['n']})."),
                "stat": f"{ps} → {b['line']}%",
            })

    # rolling 15-min windows: collapse warnings (the "collapse pattern forming" hint)
    warned_collapse, noted_rush = set(), set()
    for t in range(20, 91, 5):
        for fac in ("VS", "NC", "TR"):
            d = delta(fac, t - 15, t)
            if d <= -5 and fac not in warned_collapse:
                warned_collapse.add(fac)
                b = BOOK["early_collapse"]
                ps = pct_str(fac, d, t - 15)
                hints.append({
                    "t": t, "kind": "collapse_warning", "faction": fac,
                    "title": f"Collapse pattern forming: {fac}",
                    "detail": (f"{fac} {ps} over the last 15 min. Historically, factions "
                               f"shedding territory this fast win only {b['line']}% (n={b['n']}). "
                               f"Commanders: this is the moment to react."),
                    "stat": f"{ps}/15min → {b['line']}%",
                })
            elif d >= 5 and fac not in noted_rush and t > 15:
                noted_rush.add(fac)
                b = BOOK["early_rusher"]
                ps = pct_str(fac, d, t - 15)
                hints.append({
                    "t": t, "kind": "momentum", "faction": fac,
                    "title": f"{fac} building momentum",
                    "detail": (f"{fac} {ps} over the last 15 min. Sustained pushes like "
                               f"this convert at {b['line']}% historically."),
                    "stat": f"{ps}/15min",
                })

    hints.sort(key=lambda h: h["t"])
    res = inst.get("result", {})
    out = {
        "meta": {
            "instanceId": ALERT, "world": inst["world"], "zone": inst["zone"],
            "date": inst["timeStarted"][:10],
            "victor": FACTIONS.get(res.get("victor"), "?"),
            "final": {FACTIONS.get(int(k), k): v for k, v in
                      (res.get("territoryGain", {}) or {}).items()},
            "book": "Debute Book v1 (600 alerts, Connery+Miller)",
        },
        "timeline": [{"t": m, "territory": minutes[m], "pop": pop_min[m]}
                     for m in range(0, 91)],
        "flip_feed": flip_feed,
        "hints": hints,
    }
    path = os.path.join(ROOT, f"replay_{ALERT}.json")
    json.dump(out, open(path, "w"))
    print(f"wrote {path}: {len(hints)} hints, {len(flip_feed)} flips")
    for h in hints:
        print(f"  t={h['t']:>3} [{h['kind']}] {h['title']}")


main()
