#!/usr/bin/env python3
"""Rank Hossin alerts by predictability ("guessability") using the 144-bin joint model.

For each decisive alert (real victor), compute the joint model's P(actual winner)
at t=0,15,30,45,60. Score = MEAN of P(winner) across checkpoints (chosen over max:
max rewards being favored even once; mean rewards being favored throughout, which
is what "easiest to guess" means for a demo).

Also records: winner, victory margin (pp at t=90), leader at t=0, # lead changes,
min P(winner) across checkpoints.
"""
import json, os, sys
from hossin_models import load_hossin, FACTIONS
from hossin_joint_model import margin_bucket, mom_bucket, time_bucket

ROOT = os.path.dirname(os.path.abspath(__file__))
CHECKPOINTS = [0, 15, 30, 45, 60]


def main():
    model = json.load(open(os.path.join(ROOT, "hossin_joint_model.json")))
    cells = model["cells"]
    base_rates = model["base_rates"]

    alerts = load_hossin()
    print(f"alerts loaded: {len(alerts)}", flush=True)

    rows = []
    skipped_draw = 0
    missing_cell = 0
    for a in alerts:
        v = a["victor"]
        if v not in FACTIONS:
            skipped_draw += 1
            continue
        wname = FACTIONS[v]
        tsh = a["tsh"]
        probs = []
        ok = True
        for t in CHECKPOINTS:
            sh = tsh[t]
            lead = max((1, 2, 3), key=lambda f: sh[f])
            margin = sh[lead] - max(sh[g] for g in (1, 2, 3) if g != lead)
            mom = sh[lead] - tsh[max(0, t - 15)][lead]
            key = (f"{FACTIONS[lead]}|{margin_bucket(margin)}|"
                   f"{mom_bucket(mom)}|{time_bucket(t)}")
            cell = cells.get(key)
            if cell is None:
                ok = False
                break
            probs.append(cell[wname.lower()] / 100.0)
        if not ok:
            missing_cell += 1
            continue
        # victory margin at t=90
        fin = tsh[90]
        margin_v = fin[v] - max(fin[g] for g in (1, 2, 3) if g != v)
        # leader at t=0
        sh0 = tsh[0]
        lead0 = FACTIONS[max((1, 2, 3), key=lambda f: sh0[f])]
        # lead changes across 0..90
        leaders = [FACTIONS[max((1, 2, 3), key=lambda f: tsh[m][f])] for m in range(91)]
        lead_changes = sum(1 for i in range(1, 91) if leaders[i] != leaders[i - 1])
        # winner led from start?
        winner_led_start = lead0 == wname
        rows.append({
            "iid": a["iid"],
            "winner": wname,
            "margin_pp": round(margin_v, 1),
            "p_winner": {str(t): round(p, 3) for t, p in zip(CHECKPOINTS, probs)},
            "score_mean": round(sum(probs) / len(probs), 4),
            "score_min": round(min(probs), 4),
            "score_max": round(max(probs), 4),
            "leader_t0": lead0,
            "winner_led_t0": winner_led_start,
            "lead_changes": lead_changes,
        })

    print(f"scored: {len(rows)}, draws skipped: {skipped_draw}, missing cells: {missing_cell}", flush=True)
    rows.sort(key=lambda r: r["score_mean"], reverse=True)

    scores = [r["score_mean"] for r in rows]
    import statistics
    dist = {
        "n": len(scores),
        "mean": round(statistics.mean(scores), 4),
        "median": round(statistics.median(scores), 4),
        "stdev": round(statistics.stdev(scores), 4),
        "min": round(min(scores), 4),
        "max": round(max(scores), 4),
        "p90": round(sorted(scores)[int(0.9 * len(scores))], 4),
        "p10": round(sorted(scores)[int(0.1 * len(scores))], 4),
    }
    out = {
        "method": ("mean of joint-model P(actual winner) at t=0,15,30,45,60; "
                   "mean chosen over max because it rewards being favored "
                   "throughout the alert, not just once"),
        "checkpoints": CHECKPOINTS,
        "base_rates": base_rates,
        "distribution": dist,
        "top20": rows[:20],
        "bottom20": rows[-20:][::-1],
    }
    with open(os.path.join(ROOT, "alert_predictability_ranking.json"), "w") as f:
        json.dump(out, f, indent=1)
    print("saved alert_predictability_ranking.json")
    print("distribution:", json.dumps(dist, indent=1))
    print("\nTOP 5:")
    for r in rows[:5]:
        print(f"  {r['iid']} {r['winner']} margin={r['margin_pp']}pp "
              f"score={r['score_mean']} lead_changes={r['lead_changes']} "
              f"p0={r['p_winner']['0']}")
    print("\nBOTTOM 5:")
    for r in rows[-5:][::-1]:
        print(f"  {r['iid']} {r['winner']} margin={r['margin_pp']}pp "
              f"score={r['score_mean']} lead_changes={r['lead_changes']}")


if __name__ == "__main__":
    main()
