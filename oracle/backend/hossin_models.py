#!/usr/bin/env python3
"""Hossin conditional probability models v1 — "in that situation, what are the chances?"

Two models, Hossin (zone 4) only:

  Model A — P(faction F wins the alert | F's situation at minute t).
    Situation = (F's territory-share bucket, F's 15-min momentum bucket,
                 F's population-share bucket). Empirical win rates per bin
    across all faction-slots. Answers: "chances to win the map for each faction."

  Model B — P(frontier facility f is captured by attacker B within 15 min
    | pressure). Frontier = f owned by A, >=1 lattice neighbor owned by B.
    Pressure = # B-owned neighbors that flipped to B in the trailing 15 min.
    Answers: "chances of capturing each linked territory."

Outputs:
  hossin_win_model.json, hossin_capture_model.json, HOSSIN_MODELS_v1.md
"""
import json, glob, math, os, bisect
from datetime import datetime
from collections import Counter, defaultdict

ROOT = os.path.expanduser("~/workspace/ps2polymarket")
DATA = os.path.join(ROOT, "data", "alerts")
FACTIONS = {1: "VS", 2: "NC", 3: "TR"}

links_raw = json.load(open(os.path.join(ROOT, "hossin_links.json")))
ADJ = defaultdict(set)
for e in links_raw:
    a, b = int(e["facility_id_a"]), int(e["facility_id_b"])
    ADJ[a].add(b); ADJ[b].add(a)


def parse_ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def wilson(p, n, z=1.96):
    if n == 0:
        return (0.0, 0.0)
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    m = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (round(max(0.0, (c - m) / d), 4), round(min(1.0, (c + m) / d), 4))


# ---------------------------------------------------------------- load
def load_hossin():
    alerts = []
    for path in sorted(glob.glob(os.path.join(DATA, "*.json"))):
        d = json.load(open(path))
        inst = d["instance"]
        if str(inst.get("zone")) != "4":
            continue
        r = inst.get("result") or {}
        t0 = parse_ts(inst["timeStarted"]).timestamp()
        own0 = {}
        for e in d["facility"]:
            if e.get("isInitial"):
                own0[int(e["facility"])] = e["newFaction"]
        total = len(own0)
        if total == 0:
            continue
        flips = sorted(
            [e for e in d["facility"] if not e.get("isInitial") and not e.get("isDefence")],
            key=lambda e: e["timestamp"])
        # per-minute ownership 0..90
        own = dict(own0)
        fi = 0
        tsh = []
        own_min = []
        flip_by_fac = defaultdict(list)  # fac -> sorted [(t_min, newFaction)]
        for m in range(91):
            t = t0 + m * 60
            while fi < len(flips) and parse_ts(flips[fi]["timestamp"]).timestamp() <= t:
                f = int(flips[fi]["facility"])
                nf = flips[fi]["newFaction"]
                own[f] = nf
                flip_by_fac[f].append((m, nf))
                fi += 1
            own_min.append(dict(own))
            c = Counter(own.values())
            tsh.append({f: c.get(f, 0) / total * 100 for f in (1, 2, 3)})
        # per-minute pop shares (latest sample <= minute)
        pop = sorted(d.get("population", []), key=lambda e: e["timestamp"])
        pop_min = []
        pi = 0
        cur = None
        for m in range(91):
            t = t0 + m * 60
            while pi < len(pop) and parse_ts(pop[pi]["timestamp"]).timestamp() <= t:
                cur = pop[pi]; pi += 1
            if cur:
                tot = cur["vs"] + cur["nc"] + cur["tr"]
                pop_min.append({1: cur["vs"] / tot * 100 if tot else 0,
                                2: cur["nc"] / tot * 100 if tot else 0,
                                3: cur["tr"] / tot * 100 if tot else 0})
            else:
                pop_min.append({1: 0, 2: 0, 3: 0})
        v = r.get("victor")
        alerts.append({"iid": inst["instanceId"], "tsh": tsh, "pop": pop_min,
                       "own_min": own_min, "flips": flip_by_fac,
                       "victor": v if v in FACTIONS else None})
    return alerts


# ------------------------------------------------------------- Model A
def share_bucket(s):
    if s < 25: return "S1<25"
    if s < 33: return "S2:25-33"
    if s < 40: return "S3:33-40"
    return "S4:40+"


def mom_bucket(m):
    if m <= -5: return "M1:<=-5"
    if m < -2: return "M2:-5..-2"
    if m <= 2: return "M3:-2..+2"
    if m <= 5: return "M4:+2..+5"
    return "M5:>5"


def pop_bucket(p):
    if p < 25: return "P1<25"
    if p < 33: return "P2:25-33"
    return "P3:33+"


def model_a(alerts):
    cells = defaultdict(lambda: [0, 0])  # key -> [n, wins]
    for a in alerts:
        if a["victor"] is None:
            continue
        for t in range(0, 86, 5):
            t_prev = max(0, t - 15)
            for f in (1, 2, 3):
                s = a["tsh"][t][f]
                m = a["tsh"][t][f] - a["tsh"][t_prev][f]
                p = a["pop"][t][f]
                key = (FACTIONS[f], share_bucket(s), mom_bucket(m), pop_bucket(p))
                cells[key][0] += 1
                if a["victor"] == f:
                    cells[key][1] += 1
    out = {}
    for key, (n, w) in sorted(cells.items()):
        if n < 20:
            continue
        pr = w / n
        out["|".join(key)] = {"n": n, "wins": w, "p": round(pr, 4),
                              "ci": wilson(pr, n)}
    return out


# ------------------------------------------------------------- Model B
def minute_bucket(t):
    if t < 30: return "early:0-30"
    if t < 60: return "mid:30-60"
    return "late:60-90"


def model_b(alerts):
    glob_cells = defaultdict(lambda: [0, 0])   # (pressure, minb) -> [n, caps]
    fac_cells = defaultdict(lambda: [0, 0])    # (fac, pressure_bin) -> [n, caps]
    for a in alerts:
        flips = a["flips"]
        for t in range(0, 76, 5):
            own = a["own_min"][t]
            minb = minute_bucket(t)
            for f, owner in own.items():
                if f not in ADJ:
                    continue
                for B in (1, 2, 3):
                    if B == owner:
                        continue
                    b_neigh = [nb for nb in ADJ[f] if own.get(nb) == B]
                    if not b_neigh:
                        continue
                    # pressure: B-neighbors that flipped TO B in (t-15, t]
                    press = 0
                    for nb in b_neigh:
                        for tm, nf in flips.get(nb, []):
                            if t - 15 < tm <= t and nf == B:
                                press += 1
                                break
                    # target: f flips to B in (t, t+15]
                    cap = 0
                    for tm, nf in flips.get(f, []):
                        if t < tm <= t + 15 and nf == B:
                            cap = 1
                            break
                    pb = "P0:none" if press == 0 else "P1:pressured"
                    glob_cells[(pb, minb)][0] += 1
                    glob_cells[(pb, minb)][1] += cap
                    fac_cells[(f, pb)][0] += 1
                    fac_cells[(f, pb)][1] += cap
    def pack(cells, min_n):
        out = {}
        for key, (n, c_) in sorted(cells.items()):
            if n < min_n:
                continue
            pr = c_ / n
            out["|".join(str(k) for k in key)] = {"n": n, "caps": c_,
                                                 "p": round(pr, 4),
                                                 "ci": wilson(pr, n)}
        return out
    return pack(glob_cells, 50), pack(fac_cells, 30)


def main():
    alerts = load_hossin()
    print(f"Hossin alerts loaded: {len(alerts)}")
    wa = model_a(alerts)
    print(f"Model A cells (n>=20): {len(wa)}")
    json.dump({"n_alerts": len(alerts), "cells": wa},
              open(os.path.join(ROOT, "hossin_win_model.json"), "w"))
    wg, wf = model_b(alerts)
    print(f"Model B global cells: {len(wg)}, per-facility cells: {len(wf)}")
    json.dump({"n_alerts": len(alerts), "global": wg, "per_facility": wf},
              open(os.path.join(ROOT, "hossin_capture_model.json"), "w"))

    # headline numbers for the writeup
    md = ["# Hossin conditional models v1 — \"in that situation, what are the chances?\"",
          "",
          f"**Dataset:** {len(alerts)} Hossin alerts (zone 4), 90-min territory control.",
          "",
          "## Model A — P(win | situation at minute t)",
          "Situation per faction = territory-share bucket x 15-min momentum bucket x pop-share bucket.",
          ""]
    # best/worst bins per faction
    by_fac = defaultdict(list)
    for k, v in wa.items():
        fac = k.split("|")[0]
        by_fac[fac].append((v["p"], v["n"], k))
    for fac in ("VS", "NC", "TR"):
        rows = sorted(by_fac[fac], reverse=True)
        md.append(f"### {fac} — highest and lowest win-probability situations")
        for p, n, k in rows[:3]:
            md.append(f"- **{p:.1%}** (n={n}): `{k}`")
        for p, n, k in rows[-2:]:
            md.append(f"- **{p:.1%}** (n={n}): `{k}`")
        md.append("")
    md += ["## Model B — P(frontier facility captured in 15 min | pressure)",
           "Frontier = owned by A with >=1 lattice neighbor owned by attacker B. "
           "Pressure = >=1 B-neighbor flipped to B in trailing 15 min.", ""]
    g = json.load(open(os.path.join(ROOT, "hossin_capture_model.json")))["global"]
    for k in sorted(g):
        v = g[k]
        md.append(f"- `{k}`: **{v['p']:.1%}** (n={v['n']}, 95% CI {v['ci'][0]:.1%}-{v['ci'][1]:.1%})")
    md += ["",
           "## Caveats",
           "- Correlation, not causation. Pressure may proxy for zerg presence, not cause captures.",
           "- Bins with small n have wide CIs — check n before quoting a probability.",
           "- Hossin only. Other continents need their own books.",
           "- Re-run after the extended fetch lands (~555 alerts) for tighter cells."]
    open(os.path.join(ROOT, "HOSSIN_MODELS_v1.md"), "w").write("\n".join(md))
    print("wrote HOSSIN_MODELS_v1.md")


if __name__ == "__main__":
    main()
