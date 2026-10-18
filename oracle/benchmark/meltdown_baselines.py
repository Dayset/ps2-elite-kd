#!/usr/bin/env python3
"""Simple baselines for Unstable Meltdown alerts (issue #11). Stdlib only.

For every Meltdown in rescored.json, fetch its Census `started` row (same polite
fetch as rescore_census.py: <= 1 request/s, cached in memory), score baselines by
Brier against the Census winner, and write meltdown_baselines.json.

  (a) uniform 1/3
  (b) leader of the started-row scores wins with p, others split 1-p
      (p fitted leave-one-out on a 0.34..0.99 grid)
  (c) probabilities proportional to the started-row scores
  (d) our model's t0 (from rescored.json)

Usage: python3 meltdown_baselines.py
"""
import json, math, os
from collections import defaultdict
import rescore_census as rc

HERE = os.path.dirname(os.path.abspath(__file__))
F = rc.F


def brier(p, w):
    return sum((p[f] - (1 if f == w else 0)) ** 2 for f in F) / 3


def leader_probs(scores, p):
    top = max(scores.values())
    lead = [f for f in F if scores[f] == top]
    if len(lead) == 3:
        return {f: 1 / 3 for f in F}
    rest = [f for f in F if f not in lead]
    return {f: (p / len(lead) if f in lead else (1 - p) / len(rest)) for f in F}


def prop_probs(scores):
    tot = sum(scores.values())
    return {f: scores[f] / tot for f in F} if tot > 0 else {f: 1 / 3 for f in F}


def stats(xs):
    n = len(xs)
    if not n:
        return {"n": 0, "mean": None, "se": None}
    m = sum(xs) / n
    sd = math.sqrt(sum((x - m) ** 2 for x in xs) / (n - 1)) if n > 1 else 0.0
    return {"n": n, "mean": round(m, 4), "se": round(sd / math.sqrt(n), 4)}


GRID = [round(0.34 + 0.01 * i, 2) for i in range(66)]


def fit_p(items):
    return min(GRID, key=lambda p: sum(brier(leader_probs(s, p), w) for s, w in items))


def main():
    rs = json.load(open(os.path.join(HERE, "rescored.json")))
    melts = [a for a in rs["alerts"] if a["kind"] == "meltdown"]
    worlds = {int(a["alert"].split("-")[0]) for a in melts}
    oldest = min(int(a["alert"].split("-")[3]) for a in melts) - 2 * 86400
    rows = rc.fetch_events(worlds, oldest)
    started = {}
    for r in rows:
        if r["metagame_event_state_name"] == "started":
            started[(int(r["world_id"]), r["instance_id"])] = r

    per, missing = [], []
    for a in melts:
        w = int(a["alert"].split("-")[0])
        r = started.get((w, a["census_instance_id"]))
        if not r:
            missing.append(a["alert"])
            continue
        scores = {f: float(r[f"faction_{f.lower()}"]) for f in F}
        per.append({"alert": a["alert"], "census_instance_id": a["census_instance_id"], "duration": a["duration"],
                    "winner": a["census_winner"], "start_scores": scores,
                    "start_leader": [f for f in F if scores[f] == max(scores.values())],
                    "model_t0_brier": a["brier_by_slice"].get("t0")})

    items = [(p["start_scores"], p["winner"]) for p in per]
    for i, p in enumerate(per):
        p_loo = fit_p(items[:i] + items[i + 1:])
        p["b_uniform"] = round(brier({f: 1 / 3 for f in F}, p["winner"]), 4)
        p["b_leader_loo"] = round(brier(leader_probs(p["start_scores"], p_loo), p["winner"]), 4)
        p["leader_p_loo"] = p_loo
        p["b_proportional"] = round(brier(prop_probs(p["start_scores"]), p["winner"]), 4)

    def col(key, subset=None):
        return [p[key] for p in (subset or per) if p.get(key) is not None]

    with_t0 = [p for p in per if p["model_t0_brier"] is not None]
    summary = {
        "all": {
            "uniform": stats(col("b_uniform")), "leader_loo": stats(col("b_leader_loo")),
            "proportional": stats(col("b_proportional")), "model_t0": stats(col("model_t0_brier")),
        },
        "same_alerts_as_model_t0": {
            "uniform": stats(col("b_uniform", with_t0)), "leader_loo": stats(col("b_leader_loo", with_t0)),
            "proportional": stats(col("b_proportional", with_t0)), "model_t0": stats(col("model_t0_brier", with_t0)),
        },
        "paired_vs_uniform": {k: stats([p[k] - p["b_uniform"] for p in per if p.get(k) is not None])
                              for k in ("b_leader_loo", "b_proportional", "model_t0_brier")},
        "leader_p_full_fit": fit_p(items),
        "start_leader_won": sum(1 for p in per if p["winner"] in p["start_leader"] and len(p["start_leader"]) == 1),
        "start_leader_unique": sum(1 for p in per if len(p["start_leader"]) == 1),
        "start_all_tied": sum(1 for p in per if len(p["start_leader"]) == 3),
        "by_duration": {str(d): len([p for p in per if p["duration"] == d]) for d in sorted({p["duration"] for p in per})},
    }
    out = {"source": "rescored.json + Census world_event started rows", "coin_flip": 0.2222,
           "n_meltdowns": len(melts), "n_scored": len(per), "missing_started_row": missing,
           "summary": summary, "alerts": per}
    json.dump(out, open(os.path.join(HERE, "meltdown_baselines.json"), "w"), indent=1)
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
