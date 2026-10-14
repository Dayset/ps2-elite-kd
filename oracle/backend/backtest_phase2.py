#!/usr/bin/env python3
"""Phase 2 calibration backtest for the Hossin alert oracle.

2a: post-hoc recalibration (Platt scaling, isotonic regression) fit on a
    validation split of 2024+ alerts, evaluated on a disjoint test split.
2b: (only if 2a doesn't meaningfully beat raw) shrinkage toward the flat
    1/3 base rate.

Honest setup mirrors phase 1: growtree trained on pre-2024 Hossin alerts,
predictions at t=30/60/75 on sampled 2024+ alerts, Brier-scored per
(alert, time, faction) triple. Tree marginals are joint-normalized to sum 1
(exactly like the live pipeline) before recalibration; recalibrated outputs
are renormalized before scoring.
"""
import json, os, sys, math, random
from datetime import datetime, timezone
import numpy as np

ROOT = os.path.expanduser("~/workspace/ps2polymarket")
sys.path.insert(0, ROOT)
from build_winbins import territory_minutes, parse_ts, FACTIONS
from build_winbins_tree import mom_bucket, marg_bucket
from build_winbins_growtree import mag_bucket, lookup as tree_lookup, MIN_N

ZONE = 4
TIMES = (30, 60, 75)
LEVEL_STARS = {"trunk": 1, "branch": 2, "twig": 3, "shoot": 4, "leaf": 5}
NAMES = ["trunk", "branch", "twig", "shoot", "leaf"]
CUTOFF = datetime(2024, 1, 1, tzinfo=timezone.utc)
N_SAMPLE = 1500
N_VALID = 500
SEED = 7
MEANINGFUL = 0.0005  # Brier improvement bar (phase 1 treated +-0.0002 as noise)


def valid_alert(rec):
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
        return {"mins": mins, "dur_min": dur_min, "victor": FACTIONS[victor],
                "t0": start}
    except Exception:
        return None


def build_tree(alerts):
    levels = [{} for _ in range(5)]
    for rec in alerts:
        mins, dur_min, victor = rec["mins"], rec["dur_min"], rec["victor"]
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
                won = 1 if victor == fac else 0
                keys = [(b, fac, tb), (b, fac, tb, mb), (b, fac, tb, mb, gb)]
                magb = mag_bucket(mb, mo)
                if magb:
                    keys.append((b, fac, tb, mb, gb, magb))
                    rival = max((k for k in terr if k != fac), key=lambda k: terr[k])
                    keys.append((b, fac, tb, mb, gb, magb, rival))
                for d, key in enumerate(keys):
                    cell = levels[d].setdefault(key, [0, 0])
                    cell[1] += 1
                    cell[0] += won
    tree = {}
    for d, lv in enumerate(levels):
        tree[NAMES[d]] = {",".join(map(str, k)): v for k, v in lv.items()
                          if v[1] >= MIN_N}
    return tree


def predict_alert(tree, rec, t):
    """Return (probs dict, levels dict) joint-normalized, or None if no cell."""
    mins, dur_min, victor = rec["mins"], rec["dur_min"], rec["victor"]
    if t > dur_min - 1 or t >= len(mins):
        return None
    terr = mins[t]
    terr0 = mins[max(0, t - 15)]
    tb_t = min(t // 5, 18)
    raw, lvls = {}, {}
    for f in ("VS", "NC", "TR"):
        pct = terr[f]
        mom = pct - terr0[f]
        marg = pct - max(v for k, v in terr.items() if k != f)
        rival = max((k for k in terr if k != f), key=lambda k: terr[k])
        p, level, n = tree_lookup(tree, tb_t, f, pct, mom, marg, rival, None)
        if p is None:
            return None
        raw[f] = p / 100.0
        lvls[f] = level
    tot = sum(raw.values())
    if tot <= 0:
        return None
    return {f: raw[f] / tot for f in raw}, lvls


# ---------------- recalibration fitters (numpy only) ----------------

def platt_fit(p, y, max_iter=200):
    p = np.clip(np.asarray(p, float), 1e-6, 1 - 1e-6)
    y = np.asarray(y, float)
    mu = min(max(y.mean(), 1e-3), 1 - 1e-3)
    A, B = 0.0, math.log(mu / (1 - mu))
    for _ in range(max_iter):
        pr = 1.0 / (1.0 + np.exp(-(A * p + B)))
        w = pr * (1 - pr)
        gA = ((pr - y) * p).sum()
        gB = (pr - y).sum()
        hAA = (w * p * p).sum() + 1e-9
        hAB = (w * p).sum()
        hBB = w.sum() + 1e-9
        det = hAA * hBB - hAB * hAB
        if det < 1e-12:
            break
        dA = (hBB * gA - hAB * gB) / det
        dB = (hAA * gB - hAB * gA) / det
        A -= dA
        B -= dB
        if abs(dA) + abs(dB) < 1e-10:
            break
    return A, B


def platt_predict(p, A, B):
    p = np.clip(np.asarray(p, float), 1e-6, 1 - 1e-6)
    return 1.0 / (1.0 + np.exp(-(A * p + B)))


def isotonic_fit(p, y):
    """PAVA. Returns (knot_x, knot_y) step function, non-decreasing."""
    p = np.asarray(p, float)
    y = np.asarray(y, float)
    order = np.argsort(p, kind="stable")
    xs, ys = p[order], y[order]
    bs, bc = [], []  # block sums / counts
    for yi in ys:
        bs.append(yi)
        bc.append(1.0)
        while len(bs) >= 2 and bs[-2] / bc[-2] > bs[-1] / bc[-1]:
            s2, c2 = bs.pop(), bc.pop()
            s1, c1 = bs.pop(), bc.pop()
            bs.append(s1 + s2)
            bc.append(c1 + c2)
    # knots: last x of each block -> block mean
    kx, ky, j = [], [], 0
    for s, c in zip(bs, bc):
        c = int(c)
        kx.append(xs[j + c - 1])
        ky.append(s / c)
        j += c
    return np.array(kx), np.array(ky)


def isotonic_predict(p, kx, ky):
    p = np.asarray(p, float)
    idx = np.searchsorted(kx, p, side="right") - 1
    idx = np.clip(idx, 0, len(ky) - 1)
    return ky[idx]


def renorm(probs):
    tot = sum(probs.values())
    if tot <= 0:
        return {f: 1 / 3 for f in probs}
    return {f: v / tot for f, v in probs.items()}


def brier(triples, prob_fn):
    """triples: list of (pred_dict, won_dict). prob_fn maps pred_dict->adj dict."""
    se, n = 0.0, 0
    for pred, won in triples:
        adj = renorm(prob_fn(pred))
        for f in ("VS", "NC", "TR"):
            se += (adj[f] - won[f]) ** 2
            n += 1
    return se / n if n else float("nan")


def calibration_deciles(triples, prob_fn, nb=10):
    pts = []
    for pred, won in triples:
        adj = renorm(prob_fn(pred))
        for f in ("VS", "NC", "TR"):
            pts.append((adj[f], won[f]))
    pts.sort()
    out = []
    for i in range(nb):
        lo, hi = i / nb, (i + 1) / nb
        seg = [(p, y) for p, y in pts if (p >= lo and (p < hi or (i == nb - 1 and p <= hi)))]
        if not seg:
            continue
        mp = sum(p for p, _ in seg) / len(seg)
        ay = sum(y for _, y in seg) / len(seg)
        out.append({"range": f"{lo*100:.0f}-{hi*100:.0f}", "n": len(seg),
                    "mean_pred": round(mp, 3), "actual": round(ay, 3),
                    "gap": round(mp - ay, 3)})
    return out


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
    print("cells: " + " ".join(f"{n}={len(tree[n])}" for n in NAMES), flush=True)

    rng.shuffle(pool)
    sampled = pool[:N_SAMPLE]
    valid_alerts, test_alerts = sampled[:N_VALID], sampled[N_VALID:]
    print(f"sampled={len(sampled)} validation={len(valid_alerts)} "
          f"test={len(test_alerts)}", flush=True)

    def collect(alerts):
        trip = {t: [] for t in TIMES}  # t -> list of (pred, won)
        skipped = 0
        for rec in alerts:
            won = {f: 1.0 if rec["victor"] == f else 0.0
                   for f in ("VS", "NC", "TR")}
            for t in TIMES:
                r = predict_alert(tree, rec, t)
                if r is None:
                    skipped += 1
                    continue
                pred, _lvls = r
                trip[t].append((pred, won))
        return trip, skipped

    print("predicting validation...", flush=True)
    valid_trip, vs = collect(valid_alerts)
    print("predicting test...", flush=True)
    test_trip, ts = collect(test_alerts)
    print(f"no-cell skipped: valid={vs} test={ts}", flush=True)

    # flatten validation pairs for fitting
    vp = np.array([pred[f] for trip in valid_trip.values()
                   for pred, _ in trip for f in ("VS", "NC", "TR")])
    vy = np.array([won[f] for trip in valid_trip.values()
                   for _, won in trip for f in ("VS", "NC", "TR")])
    print(f"validation pairs: {len(vp)}", flush=True)

    print("fitting Platt...", flush=True)
    A, B = platt_fit(vp, vy)
    print(f"  Platt: A={A:.4f} B={B:.4f}", flush=True)
    print("fitting isotonic...", flush=True)
    kx, ky = isotonic_fit(vp, vy)
    print(f"  isotonic knots: {len(kx)}", flush=True)

    clip = lambda d: {f: min(max(v, 0.001), 0.999) for f, v in d.items()}
    variants = {
        "raw": lambda d: d,
        "platt": lambda d: clip({f: platt_predict(v, A, B) for f, v in d.items()}),
        "isotonic": lambda d: clip({f: isotonic_predict(v, kx, ky) for f, v in d.items()}),
    }

    results = {"brier_by_time": {}, "brier_overall": {}}
    all_test = []
    for t in TIMES:
        all_test.extend(test_trip[t])
        results["brier_by_time"][str(t)] = {}
        for name, fn in variants.items():
            results["brier_by_time"][str(t)][name] = brier(test_trip[t], fn)
    for name, fn in variants.items():
        results["brier_overall"][name] = brier(all_test, fn)

    print(json.dumps(results, indent=1), flush=True)

    best = min(["platt", "isotonic"],
               key=lambda n: results["brier_overall"][n])
    gain = results["brier_overall"]["raw"] - results["brier_overall"][best]
    print(f"best recalibration: {best}, gain over raw: {gain:.5f}", flush=True)

    results["meta"] = {
        "design": "OOS: tree on pre-2024 Hossin alerts; recalibration fit on "
                  f"{N_VALID} 2024+ validation alerts, evaluated on "
                  f"{len(test_alerts)} disjoint 2024+ test alerts",
        "train_alerts": len(train), "pool_alerts": len(pool),
        "validation_alerts": len(valid_alerts), "test_alerts": len(test_alerts),
        "times": list(TIMES), "seed": SEED,
        "platt": {"A": A, "B": B}, "isotonic_knots": len(kx),
        "no_cell_skipped": {"validation": vs, "test": ts},
    }

    shipped = None
    if gain >= MEANINGFUL:
        shipped = best
        results["calibration_after"] = calibration_deciles(all_test,
                                                           variants[best])
        results["recommendation"] = (
            f"SHIP {best}: beats raw by {gain:.5f} Brier OOS "
            f"(bar was {MEANINGFUL}).")
    else:
        # ---- phase 2b: base-rate shrinkage ----
        print("2a gain below bar; running 2b base-rate shrinkage...", flush=True)
        # need levels for star-dependent weights
        def collect_levels(alerts):
            out = {t: [] for t in TIMES}
            for rec in alerts:
                won = {f: 1.0 if rec["victor"] == f else 0.0
                       for f in ("VS", "NC", "TR")}
                mins, dur_min = rec["mins"], rec["dur_min"]
                for t in TIMES:
                    if t > dur_min - 1 or t >= len(mins):
                        continue
                    terr = mins[t]
                    terr0 = mins[max(0, t - 15)]
                    tb_t = min(t // 5, 18)
                    raw, lvls = {}, {}
                    ok = True
                    for f in ("VS", "NC", "TR"):
                        pct = terr[f]
                        mom = pct - terr0[f]
                        marg = pct - max(v for k, v in terr.items() if k != f)
                        rival = max((k for k in terr if k != f),
                                    key=lambda k: terr[k])
                        p, level, n = tree_lookup(tree, tb_t, f, pct, mom,
                                                  marg, rival, None)
                        if p is None:
                            ok = False
                            break
                        raw[f] = p / 100.0
                        lvls[f] = level
                    if not ok:
                        continue
                    tot = sum(raw.values())
                    if tot <= 0:
                        continue
                    pred = {f: raw[f] / tot for f in raw}
                    out[t].append((pred, won, lvls))
            return out

        test_lv = collect_levels(test_alerts)
        all_lv = [x for t in TIMES for x in test_lv[t]]
        base = 1 / 3

        def shrink_fixed(pred, w):
            return {f: base + (v - base) * w for f, v in pred.items()}

        def shrink_star(pred, lv):
            return {f: base + (pred[f] - base) *
                    (0.5 + 0.1 * LEVEL_STARS[lv[f]]) for f in pred}

        def brier_lv(trips, fn):
            se, n = 0.0, 0
            for pred, won, lv in trips:
                adj = renorm(fn(pred, lv))
                for f in ("VS", "NC", "TR"):
                    se += (adj[f] - won[f]) ** 2
                    n += 1
            return se / n if n else float("nan")

        b2_variants = {"base_w0.9": lambda p, lv: shrink_fixed(p, 0.9),
                       "base_w0.8": lambda p, lv: shrink_fixed(p, 0.8),
                       "base_w0.7": lambda p, lv: shrink_fixed(p, 0.7),
                       "base_star_w": shrink_star}
        results["brier_by_time_2b"] = {}
        results["brier_overall_2b"] = {"raw": results["brier_overall"]["raw"]}
        for t in TIMES:
            results["brier_by_time_2b"][str(t)] = {}
            for name, fn in b2_variants.items():
                results["brier_by_time_2b"][str(t)][name] = brier_lv(test_lv[t], fn)
        for name, fn in b2_variants.items():
            results["brier_overall_2b"][name] = brier_lv(all_lv, fn)
        print(json.dumps({k: v for k, v in results.items()
                          if "2b" in k}, indent=1), flush=True)
        best2 = min([k for k in results["brier_overall_2b"] if k != "raw"],
                    key=lambda n: results["brier_overall_2b"][n])
        gain2 = results["brier_overall_2b"]["raw"] - results["brier_overall_2b"][best2]
        if gain2 >= MEANINGFUL:
            shipped = best2
            results["recommendation"] = (
                f"SHIP {best2}: base-rate shrinkage beats raw by "
                f"{gain2:.5f} Brier OOS (bar was {MEANINGFUL}). "
                f"Recalibration (2a) did not clear the bar.")
        else:
            results["recommendation"] = (
                "SHIP NOTHING. Neither recalibration (2a) nor base-rate "
                f"shrinkage (2b) beats raw by the {MEANINGFUL} bar OOS. "
                "Raw tree stands; the calibration bias is real but no "
                "tested correction earns its keep.")
    results["shipped"] = shipped
    out = os.path.join(ROOT, "backtest_phase2_results.json")
    json.dump(results, open(out, "w"), indent=1)
    print(f"wrote {out}", flush=True)
    print("RECOMMENDATION:", results["recommendation"], flush=True)


if __name__ == "__main__":
    main()
