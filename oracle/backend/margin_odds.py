#!/usr/bin/env python3
"""P(leader wins) vs leader margin at fixed t (default t=50).
One clear picture: odds as a function of margin.
"""
import json, glob, os, sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from build_winbins import territory_minutes, parse_ts, FACTIONS, ROOT

T = int(sys.argv[1]) if len(sys.argv) > 1 else 50

def main():
    files = glob.glob(os.path.join(ROOT, "data", "alerts", "*.json"))
    buckets = {}  # margin bucket -> [wins, n]
    n_alerts = 0
    for fn in files:
        try:
            rec = json.load(open(fn))
        except Exception:
            continue
        inst = rec["instance"]
        if inst.get("zone") != 4:
            continue
        res = inst.get("result") or {}
        if res.get("draw"):
            continue
        victor = res.get("victor")
        if victor not in (1, 2, 3):
            continue
        mins = territory_minutes(rec)
        if not mins:
            continue
        dur_min = (parse_ts(inst["timeEnded"]) - parse_ts(inst["timeStarted"])).total_seconds() / 60
        if T > dur_min - 1 or T >= len(mins):
            continue
        n_alerts += 1
        terr = mins[T]
        vals = sorted(terr.values(), reverse=True)
        margin = vals[0] - vals[1]
        leader = max(terr, key=terr.get)
        mb = int(margin // 5) * 5
        b = buckets.setdefault(mb, [0, 0])
        b[1] += 1
        if leader == FACTIONS[victor]:
            b[0] += 1

    xs, ys, ns = [], [], []
    for mb in sorted(buckets):
        w, n = buckets[mb]
        if n < 30:
            continue
        xs.append(mb + 2.5)
        ys.append(100.0 * w / n)
        ns.append(n)
    print(f"t={T}, alerts: {n_alerts}")
    for x, y, n in zip(xs, ys, ns):
        print(f"  margin {x-2.5:4.0f}-{x+2.5:4.0f}pp: {y:5.1f}% (n={n})")

    fig, ax = plt.subplots(figsize=(10, 5.5))
    ax.plot(xs, ys, "o-", color="#4da3ff", linewidth=2, markersize=8)
    ax.fill_between(xs, ys, 33.3, alpha=0.12, color="#4da3ff")
    ax.axhline(33.3, color="gray", linestyle=":", alpha=0.6)
    ax.text(1, 36, "coin flip (33%)", color="gray", fontsize=9)
    ax.axhline(50, color="gray", linestyle=":", alpha=0.4)
    for x, y, n in zip(xs, ys, ns):
        ax.annotate(f"{y:.0f}%\nn={n}", (x, y), textcoords="offset points",
                    xytext=(0, 12), ha="center", fontsize=8, color="#4da3ff")
    ax.set_xlabel("leader margin at t=%d (pp)" % T)
    ax.set_ylabel("P(leader wins) %")
    ax.set_title("Hossin: leader win odds by margin at t=%d (n=%d alerts)" % (T, n_alerts))
    ax.set_xlim(-1, max(xs) + 6)
    ax.set_ylim(25, 105)
    ax.grid(alpha=0.25)
    out = os.path.join(ROOT, f"margin_odds_t{T}.png")
    fig.tight_layout()
    fig.savefig(out, dpi=110)
    print("wrote", out)

if __name__ == "__main__":
    main()
