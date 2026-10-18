#!/usr/bin/env python3
"""Writes test/fixtures/oracle-parity.json: random inputs + the Python odds
engine's outputs (compute_win, second_place). The JS port must reproduce them.

Run from the repo root: python3 oracle-worker/make-parity-fixture.py
"""
import json, os, random, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(HERE, "..", "oracle", "backend")
sys.path.insert(0, BACKEND)
os.chdir(BACKEND)
import push_live_state as P  # noqa: E402  (loads trees on import)

random.seed(20261018)
cases = []
for i in range(400):
    zone = random.choice([2, 4, 6, 8, 344])
    dur = random.choice([90, 90, 45, 30])
    t = round(random.uniform(0, dur + 4), 2)
    a, b = sorted(random.uniform(0, 100) for _ in range(2))
    shares = [a, b - a, 100 - b]
    neutral = random.choice([0, 0, 0, random.uniform(0, 15)])
    terr = {f: round(s * (100 - neutral) / 100, 3) for f, s in zip(("VS", "NC", "TR"), shares)}
    mom = {f: round(random.uniform(-15, 15), 3) for f in ("VS", "NC", "TR")}
    if random.random() < 0.2:
        mom = {f: 0.0 for f in mom}
    win, raw, trunkv = P.compute_win(P.trees[zone], terr, mom, t, dur)
    sp = P.second_place(terr, raw, trunkv, t, dur)
    cases.append({"zone": zone, "dur": dur, "t": t, "terr": terr, "mom": mom,
                  "win": win, "raw": raw, "trunkv": trunkv, "second": sp})

out = os.path.join(HERE, "..", "test", "fixtures", "oracle-parity.json")
os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump(cases, open(out, "w"))
print(f"wrote {len(cases)} cases to {out}")
