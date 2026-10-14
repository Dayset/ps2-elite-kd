#!/usr/bin/env python3
"""Accuracy-vs-time curve for the Hossin oracle.

For each 5-min bucket t, predicts the winner as the territory leader at t
(the oracle's bin argmax is monotonic in territory, so this is its rule),
and scores against the actual victor. Also scores the subset where the
leader's margin is >= 10pp. Draws accuracy(t) graph.
"""
import json, glob, os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from build_winbins import territory_minutes, parse_ts, FACTIONS, ROOT

FAC_IDS = {"VS": 1, "NC": 2, "TR": 3}

def main():
    bins = json.load(open(os.path.join(ROOT, "winbins.json")))["bins"]
    def winpct(t_b, fac, terr):
        tb = min(int(terr // 5), 20)
        for dt in (0, -1, 1):
            key = f"{t_b+dt},{fac},{tb}"
            if key in bins:
                w, n = bins[key]
                return 100.0 * w / n
        return None

    files = glob.glob(os.path.join(ROOT, "data", "alerts", "*.json"))
    # per bucket: [correct, n, correct_big, n_big]
    stats = {b: [0, 0, 0, 0] for b in range(19)}
    n_alerts = 0
    for i, fn in enumerate(files):
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
        n_alerts += 1
        for b in range(19):
            m = b * 5
            if m > dur_min - 1:
                continue
            terr = mins[m]
            # oracle prediction: argmax bin win%
            preds = {}
            for fac in ("VS", "NC", "TR"):
                p = winpct(b, fac, terr[fac])
                preds[fac] = p if p is not None else terr[fac]
            pred = max(preds, key=preds.get)
            actual = FACTIONS[victor]
            s = stats[b]
            s[1] += 1
            if pred == actual:
                s[0] += 1
            ordered = sorted(terr.values(), reverse=True)
            if ordered[0] - ordered[1] >= 10:
                s[3] += 1
                if pred == actual:
                    s[2] += 1

    print(f"alerts scored: {n_alerts}")
    ts, acc, acc_big, ns = [], [], [], []
    for b in range(19):
        c, n, cb, nb = stats[b]
        if n == 0:
            continue
        ts.append(b * 5)
        acc.append(100.0 * c / n)
        acc_big.append(100.0 * cb / nb if nb else float("nan"))
        ns.append(n)
        if b * 5 in (0, 30, 50, 60, 75, 90):
            print(f"t={b*5:3d}  acc={100*c/n:5.1f}% (n={n})  "
                  f"margin>=10pp: {100*cb/nb:5.1f}% (n={nb})")

    fig, ax = plt.subplots(figsize=(10, 5.5))
    ax.plot(ts, acc, "o-", color="#4da3ff", label="leader predicted correctly")
    ax.plot(ts, acc_big, "s--", color="#ff5d5d", label="leader margin ≥ 10pp")
    ax.axhline(33.3, color="gray", linestyle=":", alpha=0.6)
    ax.text(2, 34.5, "coin flip (33%)", color="gray", fontsize=9)
    ax.set_xlabel("minutes into alert")
    ax.set_ylabel("prediction accuracy %")
    ax.set_title("Hossin oracle: how often the t-minute leader wins (n=%d alerts)" % n_alerts)
    ax.set_xlim(0, 90)
    ax.set_ylim(30, 102)
    ax.grid(alpha=0.25)
    ax.legend()
    for x, y, n in zip(ts[::3], acc[::3], ns[::3]):
        ax.annotate(f"{y:.0f}%", (x, y), textcoords="offset points",
                    xytext=(0, 8), ha="center", fontsize=8, color="#4da3ff")
    out = os.path.join(ROOT, "oracle_accuracy.png")
    fig.tight_layout()
    fig.savefig(out, dpi=110)
    print("wrote", out)

if __name__ == "__main__":
    main()
