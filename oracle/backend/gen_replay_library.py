#!/usr/bin/env python3
"""Build the curated replay library for the Hex Betting Game artifact.

For each curated alert: per-5-min ticks with territory, tree win% (with
level/n/trunk + elimination override), commander calls, and per-base
ownership for map coloring. Output matches the push_replays action shape.
"""
import json, os
from build_winbins import parse_ts, FACTIONS
from build_winbins_growtree import lookup as tree_lookup
from live_oracle import max_swing_pp

ROOT = os.path.dirname(os.path.abspath(__file__))
CURATED = [
    ("10-46062", "TR miracle comeback (5.7% -> win)", "2026-09-29"),
    ("10-40612", "VS wire-to-wire blowout (+52pp)", "2026-10-05"),
    ("10-39219", "NC textbook consolidation (36 -> 44)", "2024-11-10"),
    ("10-46092", "TR 2pp nail-biter", "2026-10-02"),
    ("10-46002", "VS 1pp nail-biter", "2026-09-20"),
    ("10-46100", "NC comeback, trailed VS at t=60", "2026-10-03"),
    ("10-46079", "NC wire-to-wire", "2026-10-01"),
    ("10-43892", "TR wire-to-wire blowout", "2026-01-09"),
    ("10-44249", "NC wire-to-wire", "2026-02-23"),
]

tree = json.load(open(os.path.join(ROOT, "winbins_growtree.json")))
xtree = json.load(open(os.path.join(ROOT, "winbins_xtrunk.json")))


def second_place(terr, raw, trunkv, t):
    """Second-place odds among the two non-winners, once the winner is decided.

    Same math, applied to the remaining teams: renormalize the raw tree
    marginals over the two survivors; then run the elimination check on the
    B-vs-C gap itself. Returns None while the winner market is still live.
    """
    leader = max(terr, key=lambda f: terr[f])
    if not all(max_swing_pp(t) < (terr[leader] - terr[f])
               for f in terr if f != leader):
        return None
    B, C = [f for f in ("VS", "NC", "TR") if f != leader]
    gap = abs(terr[B] - terr[C])
    if max_swing_pp(t) < gap:
        w2 = B if terr[B] > terr[C] else C
        l2 = C if w2 == B else B
        return {"odds": {w2: 100.0, l2: 0.0}, "locked": True, "basis": "locked"}
    # Use scenario marginals only when the tree is actually informative about
    # these teams (not both ~0% win prob). Near-zero P(win) answers the wrong
    # question for 2nd place, so fall back to the coarser trunk as the honest
    # basis for relative strength.
    if max(raw[B], raw[C]) >= 5.0:
        qb, qc, basis = raw[B], raw[C], "scenario"
    else:
        qb, qc, basis = trunkv[B], trunkv[C], "trunk"
    if qb + qc <= 0:
        qb, qc, basis = 50.0, 50.0, "even"
    tot = qb + qc
    return {"odds": {B: round(100 * qb / tot, 1), C: round(100 * qc / tot, 1)},
            "locked": False, "basis": basis}


def build_alert(fn):
    rec = json.load(open(os.path.join(ROOT, "data", "alerts", fn)))
    inst = rec["instance"]
    start = parse_ts(inst["timeStarted"]).timestamp()
    if inst.get("timeEnded"):
        dur = (parse_ts(inst["timeEnded"]).timestamp() - start) / 60.0
    else:
        dur = 90.0
    owner = {}
    for e in rec["facility"]:
        if e.get("isInitial"):
            owner[e["facility"]] = e["newFaction"]
    flips = sorted(
        (e for e in rec["facility"]
         if not e.get("isInitial") and e.get("oldFaction") != e.get("newFaction")),
        key=lambda e: e["timestamp"])
    total = len(owner)
    ticks = []
    fi, cur = 0, dict(owner)
    # per-minute shares for momentum
    shares_min = []
    fi2, cur2 = 0, dict(owner)
    for m in range(91):
        cutoff = start + m * 60
        while fi2 < len(flips) and parse_ts(flips[fi2]["timestamp"]).timestamp() <= cutoff:
            cur2[flips[fi2]["facility"]] = flips[fi2]["newFaction"]
            fi2 += 1
        counts = {1: 0, 2: 0, 3: 0}
        for f in cur2.values():
            if f in counts:
                counts[f] += 1
        shares_min.append({FACTIONS[k]: 100.0 * v / total for k, v in counts.items()})
    for t in range(0, 91, 5):
        if t > dur:
            break
        cutoff = start + t * 60
        while fi < len(flips) and parse_ts(flips[fi]["timestamp"]).timestamp() <= cutoff:
            cur[flips[fi]["facility"]] = flips[fi]["newFaction"]
            fi += 1
        terr = shares_min[t]
        terr15 = shares_min[max(0, t - 15)]
        mom = {f: terr[f] - terr15[f] for f in ("VS", "NC", "TR")}
        b = min(t // 5, 18)
        win = {}
        raw, trunkv = {}, {}
        for f in ("VS", "NC", "TR"):
            marg = terr[f] - max(v for k, v in terr.items() if k != f)
            rival = max((k for k in terr if k != f), key=lambda k: terr[k])
            p, level, n = tree_lookup(tree, b, f, terr[f], mom[f], marg, rival, xtree)
            if p is None:
                p, level, n = 0.0, "none", 0
            raw[f] = p
            tb = min(int(terr[f]) // 5, 20)
            cell = tree["trunk"].get(f"{b},{f},{tb}")
            trunk = 100.0 * cell[0] / cell[1] if cell else p
            trunkv[f] = trunk
            win[f] = {"pct": round(p, 1), "level": level, "n": n,
                      "trunk": round(trunk, 1)}
        # elimination override (hard constraint)
        leader = max(terr, key=lambda f: terr[f])
        elim = {f: (False if f == leader
                    else max_swing_pp(t) < (terr[leader] - terr[f]))
                for f in ("VS", "NC", "TR")}
        for f in terr:
            if elim[f]:
                win[f]["pct"] = 0.0
        if all(elim[f] for f in terr if f != leader):
            win[leader]["pct"] = 100.0
        calls = []
        def mom_pct(f):
            base = terr.get(f, 0) or 0
            if base < 1:
                return f"{mom[f]:+.1f}%/15min"
            return f"{100.0 * mom[f] / base:+.1f}%/15min"
        for f in ("VS", "NC", "TR"):
            if f != leader and mom[f] <= -5:
                calls.append(f"collapse pattern forming for {f} ({mom_pct(f)})")
            if f != leader and elim[f]:
                calls.append(f"{f} mathematically eliminated")
        if mom[leader] >= 5:
            calls.append(f"{leader} extending ({mom_pct(leader)})")
        ticks.append({
            "t": t,
            "terr": {f: round(terr[f], 1) for f in ("VS", "NC", "TR")},
            "mom": {f: round(mom[f], 1) for f in ("VS", "NC", "TR")},
            "win": win,
            "second": second_place(terr, raw, trunkv, t),
            "leader": leader,
            "eliminated": [f for f in elim if elim[f]],
            "calls": calls,
            "owner": {str(fid): FACTIONS[fac] for fid, fac in cur.items()
                      if fac in (1, 2, 3)},
        })
    return ticks


def main():
    lib = {"alerts": []}
    for fn, label, date in CURATED:
        ticks = build_alert(fn + ".json")
        lib["alerts"].append({"id": fn, "label": label, "date": date,
                              "ticks": ticks})
        print(f"{fn}: {len(ticks)} ticks")
    out = os.path.join(ROOT, "replay_library.json")
    json.dump(lib, open(out, "w"))
    print(f"wrote {out} ({os.path.getsize(out)//1024} KB)")


if __name__ == "__main__":
    main()
