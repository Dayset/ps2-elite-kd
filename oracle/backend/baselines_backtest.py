#!/usr/bin/env python3
"""Dumb-baseline Brier comparison for the Hossin alert oracle.

Replicates the out-of-sample sampling of backtest_phase2.py exactly
(SEED=7, sorted files, pre-2024 train / 2024+ pool, test = shuffled[500:1500],
TIMES=(30,60,75)) and scores four predictors per (alert,time,faction) triple:

  tree      -- the growtree oracle (backtest_phase2 raw; joint-normalized)
  uniform   -- coin flip, 1/3 each (expected Brier 0.222)
  leader    -- 1.0 on the territory leader at time t, 0.0 others
  terrshare -- territory share at time t as the probability vector

The tree backtest scored 0.1501 pooled over t=30/60/75. Dayset's open
question: does the tree beat *smart-simple* (leader / terrshare) by 5% or
25%? This closes that gap on the same test set.
"""
import json, os, sys, random, math
from datetime import datetime, timezone

ROOT = os.path.expanduser("~/workspace/ps2polymarket")
sys.path.insert(0, ROOT)
from backtest_phase2 import valid_alert, build_tree, predict_alert, brier
from backtest_phase2 import CUTOFF, N_SAMPLE, N_VALID, SEED, TIMES

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
    sampled = pool[:N_SAMPLE]
    test_alerts = sampled[N_VALID:]

    # (pred_dict, won_dict, t) triples where the tree produced a prediction
    test_trip = {t: [] for t in TIMES}
    skipped = 0
    for rec in test_alerts:
        won = {f: 1.0 if rec["victor"] == f else 0.0 for f in ("VS", "NC", "TR")}
        for t in TIMES:
            r = predict_alert(tree, rec, t)
            if r is None:
                skipped += 1
                continue
            mins = rec["mins"]
            sh = mins[t]
            lead = max(("VS", "NC", "TR"), key=lambda f: sh[f])
            terrshare = {f: sh[f] / 100.0 for f in ("VS", "NC", "TR")}
            test_trip[t].append({
                "tree": r[0],
                "uniform": {"VS": 1/3, "NC": 1/3, "TR": 1/3},
                "leader": {f: 1.0 if f == lead else 0.0 for f in ("VS", "NC", "TR")},
                "terrshare": terrshare,
                "won": won,
            })
    print(f"tree no-cell skipped: {skipped}", flush=True)

    names = ["tree", "uniform", "leader", "terrshare"]
    results = {"brier_by_time": {}, "brier_overall": {}, "acc_by_time": {},
               "n_triples": {str(t): len(test_trip[t]) for t in TIMES}}

    for t in TIMES:
        results["brier_by_time"][str(t)] = {}
        results["acc_by_time"][str(t)] = {}
        for name in names:
            triples = [(row[name], row["won"]) for row in test_trip[t]]
            results["brier_by_time"][str(t)][name] = brier(
                triples, lambda d: d)
        for name in names:
            hits = sum(1 for row in test_trip[t]
                       if max(row[name], key=row[name].get) == rec_winner(row["won"]))
            results["acc_by_time"][str(t)][name] = round(hits / len(test_trip[t]), 4)

    all_rows = [row for t in TIMES for row in test_trip[t]]
    for name in names:
        triples = [(row[name], row["won"]) for row in all_rows]
        results["brier_overall"][name] = brier(triples, lambda d: d)

    out = os.path.join(ROOT, "baselines_backtest_results.json")
    json.dump(results, open(out, "w"), indent=1)
    print(json.dumps(results, indent=1))
    print("wrote", out)


def rec_winner(won):
    return max(won, key=won.get)


if __name__ == "__main__":
    main()
