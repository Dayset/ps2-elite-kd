#!/usr/bin/env python3
"""T-axis rescale backtest for short alerts.

Live, the tree is queried with ABSOLUTE t (push_live_state.py: b = t//5)
even on 45/30-min alerts, while the elimination math is duration-aware.
Question: on a D-minute alert at fractional progress f, is the tree's
absolute-t read worse than a rescaled read at t' = t*90/D?

Honest setup mirrors phase 2: growtree trained on pre-2024 Hossin alerts,
evaluated on a disjoint sample of 2024+ Hossin alerts. Since the fetch only
holds 90-min alerts with outcomes, each 90-min alert is truncated into a
SYNTHETIC D-minute alert whose winner = territory leader at t=D.
At elapsed t = f*D we compare three reads against that synthetic winner:

  absolute      : tree bucket b = t//5, 15-min momentum      (current live)
  rescaled      : tree bucket b = (t*90/D)//5, 15-min momentum
  rescaled+mom  : rescaled bucket, momentum window 15*D/90 min

Brier-scored per (alert, D, f, faction). Bar: 0.0005 (phase-2 noise bar).
"""
import json, os, sys, random
from datetime import datetime, timezone

ROOT = os.path.expanduser("~/workspace/ps2polymarket")
sys.path.insert(0, ROOT)
from build_winbins_tree import mom_bucket, marg_bucket  # noqa: F401
from build_winbins_growtree import lookup as tree_lookup
from backtest_phase2 import build_tree
from build_winbins import territory_minutes, parse_ts, FACTIONS as _FAC

import os as _os
ZONE = int(_os.environ.get("TAX_ZONE", "4"))
DURS = (30, 45)
FRACS = (1 / 3, 1 / 2, 2 / 3)
CUTOFF = datetime(2024, 1, 1, tzinfo=timezone.utc)
N_TEST = 1500
SEED = 7
MEANINGFUL = 0.0005
FACTIONS = ("VS", "NC", "TR")


def valid_alert(rec):
    """Zone-aware copy of backtest_phase2.valid_alert (that one hardcodes ZONE=4)."""
    try:
        inst = rec["instance"]
        if inst.get("zone") != ZONE:
            return None
        res = inst.get("result") or {}
        if res.get("draw"):
            return None
        victor = res.get("victor")
        if victor not in (1, 2, 3):
            return None
        mins = territory_minutes(rec)
        if not mins:
            return None
        start = parse_ts(inst["timeStarted"])
        end = parse_ts(inst["timeEnded"])
        dur_min = (end - start).total_seconds() / 60
        return {"mins": mins, "dur_min": dur_min, "victor": _FAC[victor],
                "t0": start}
    except Exception:
        return None


def leader_at(mins, t):
    terr = mins[t]
    top = max(terr.values())
    leaders = [f for f in FACTIONS if terr[f] == top]
    return leaders[0] if len(leaders) == 1 else None


def predict(tree, mins, t_state, t_lookup, mom_win):
    """Tree read of state at t_state, using bucket for t_lookup and a
    mom_win-minute momentum window. Returns joint-normalized probs or None."""
    terr = mins[t_state]
    terr0 = mins[max(0, t_state - mom_win)]
    b = min(int(t_lookup) // 5, 18)
    raw = {}
    for f in FACTIONS:
        pct = terr[f]
        mom = pct - terr0[f]
        marg = pct - max(v for k, v in terr.items() if k != f)
        rival = max((k for k in terr if k != f), key=lambda k: terr[k])
        p, _, _ = tree_lookup(tree, b, f, pct, mom, marg, rival, None)
        if p is None:
            return None
        raw[f] = p / 100.0
    tot = sum(raw.values())
    if tot <= 0:
        return None
    return {f: raw[f] / tot for f in raw}


def main():
    rng = random.Random(SEED)
    alert_dir = os.path.join(ROOT, "data", "alerts")
    files = sorted(os.listdir(alert_dir))
    print(f"scanning {len(files)} alert files...", flush=True)
    train, pool = [], []
    for i, fn in enumerate(files):
        if i and i % 10000 == 0:
            print(f"  {i}/{len(files)}...", flush=True)
        try:
            rec = json.load(open(os.path.join(alert_dir, fn)))
        except Exception:
            continue
        va = valid_alert(rec)
        if va is None:
            continue
        (train if va["t0"] < CUTOFF else pool).append(va)
    print(f"train(pre-2024)={len(train)} pool(2024+)={len(pool)}", flush=True)

    print("building tree...", flush=True)
    tree = build_tree(train)

    rng.shuffle(pool)
    test = pool[:N_TEST]
    print(f"test alerts: {len(test)}", flush=True)

    # results[variant][D][f] -> [se, n]
    variants = ["absolute", "rescaled", "rescaled+mom"]
    acc = {v: {D: {f: [0.0, 0] for f in FRACS} for D in DURS}
           for v in variants}
    skipped = {"tie": 0, "nocell": 0}

    for ri, rec in enumerate(test):
        if ri and ri % 300 == 0:
            print(f"  {ri}/{len(test)}...", flush=True)
        mins = rec["mins"]
        for D in DURS:
            winner = leader_at(mins, D)
            if winner is None:
                skipped["tie"] += 1
                continue
            won = {f: 1.0 if f == winner else 0.0 for f in FACTIONS}
            for f in FRACS:
                t = int(round(f * D))
                t_rs = t * 90.0 / D
                mom_w_rs = max(1, int(round(15 * D / 90.0)))
                reads = {
                    "absolute": predict(tree, mins, t, t, 15),
                    "rescaled": predict(tree, mins, t, t_rs, 15),
                    "rescaled+mom": predict(tree, mins, t, t_rs, mom_w_rs),
                }
                for v in variants:
                    pred = reads[v]
                    if pred is None:
                        skipped["nocell"] += 1
                        continue
                    se, n = acc[v][D][f]
                    for fac in FACTIONS:
                        se += (pred[fac] - won[fac]) ** 2
                        n += 1
                    acc[v][D][f] = [se, n]

    print(f"skipped: {skipped}", flush=True)
    out = {"brier": {}, "overall": {}, "meta": {
        "design": "OOS: tree on pre-2024 Hossin; synthetic D-min alerts from "
                  f"{N_TEST} 2024+ Hossin 90-min alerts, winner = leader at t=D",
        "durs": list(DURS), "fracs": list(FRACS), "seed": SEED,
        "skipped": skipped, "bar": MEANINGFUL}}
    for v in variants:
        out["brier"][v] = {}
        se_all, n_all = 0.0, 0
        for D in DURS:
            out["brier"][v][str(D)] = {}
            for fr in FRACS:
                se, n = acc[v][D][fr]
                b = se / n if n else float("nan")
                out["brier"][v][str(D)][f"{fr:.2f}"] = round(b, 5)
                se_all += se
                n_all += n
        out["overall"][v] = round(se_all / n_all, 5) if n_all else None

    print(json.dumps(out, indent=1), flush=True)
    base = out["overall"]["absolute"]
    for v in ("rescaled", "rescaled+mom"):
        gain = base - out["overall"][v]
        verdict = "BEATS absolute" if gain >= MEANINGFUL else (
            "ties absolute" if abs(gain) < MEANINGFUL else "WORSE than absolute")
        print(f"{v}: Brier {out['overall'][v]} vs absolute {base} "
              f"(gain {gain:+.5f}) -> {verdict}", flush=True)
        out["meta"][f"verdict_{v}"] = verdict
    fp = os.path.join(ROOT, f"backtest_taxisscale_results_z{ZONE}.json")
    json.dump(out, open(fp, "w"), indent=1)
    print(f"wrote {fp}", flush=True)


if __name__ == "__main__":
    main()
