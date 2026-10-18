#!/usr/bin/env python3
"""Human-behavior patterns per continent from ps2alerts history.

A: early-rush (>=10pp gain t=0->15) win rate per continent
B: 2nd-place capture source t=30->60 (share from trailer vs leader) per continent
B2: same, t=45->75 (arc: does farm-the-weak fade late?)
C: P(t=30 leader loses) per continent
C2: P(t=30 leader holds | t=15->30 momentum <= 0) per continent (stalling-leader test)
Zones: 2=Indar 4=Hossin 6=Amerish 8=Esamir 344=Oshur. Factions 1=VS 2=NC 3=TR.
"""
import json, glob, os, sys
from datetime import datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
ZNAMES = {2: "Indar", 4: "Hossin", 6: "Amerish", 8: "Esamir", 344: "Oshur"}

def parse_ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()

def analyze():
    # per continent accumulators
    A = {}   # z -> [rush_wins, rush_n]
    B = {}   # z -> [from_trailer, from_leader]
    B2 = {}
    C = {}   # z -> [leader_lost, n]
    C2 = {}  # z -> [hold, n] among stalling leaders
    n_alerts = {}
    files = glob.glob(os.path.join(ROOT, "data", "alerts", "*.json"))
    for i, fn in enumerate(files):
        if i and i % 10000 == 0:
            print(f"  {i}/{len(files)}", flush=True)
        try:
            rec = json.load(open(fn))
        except Exception:
            continue
        inst = rec["instance"]
        z = inst.get("zone")
        if z not in ZNAMES:
            continue
        res = inst.get("result") or {}
        if res.get("draw"):
            continue
        victor = res.get("victor")
        if victor not in (1, 2, 3):
            continue
        fac = rec["facility"]
        owner = {}
        flips = []
        for e in fac:
            if e.get("isInitial"):
                owner[e["facility"]] = e["newFaction"]
            else:
                of, nf = e.get("oldFaction"), e.get("newFaction")
                if of in (1, 2, 3) and nf in (1, 2, 3) and of != nf:
                    flips.append(e)
        if not owner:
            continue
        total = len(owner)
        try:
            start = parse_ts(inst["timeStarted"])
            end = parse_ts(inst["timeEnded"])
        except Exception:
            continue
        dur = (end - start) / 60
        flips.sort(key=lambda e: e["timestamp"])
        # precompute float timestamps once
        fts = [(parse_ts(e["timestamp"]), e["oldFaction"], e["newFaction"]) for e in flips]

        # ownership snapshots at needed minutes
        need = sorted({0, 15, 30, 45, 60, 75} & {m for m in (0, 15, 30, 45, 60, 75) if m <= dur})
        snaps = {}
        cur = dict(owner)
        fi = 0
        for m in need:
            cutoff = start + m * 60
            while fi < len(fts) and fts[fi][0] <= cutoff:
                cur[flips[fi]["facility"]] = fts[fi][2]
                fi += 1
            snaps[m] = {f: 100.0 * sum(1 for v in cur.values() if v == f) / total
                        for f in (1, 2, 3)}
        n_alerts[z] = n_alerts.get(z, 0) + 1

        # A: early rush
        if 15 in snaps:
            a = A.setdefault(z, [0, 0])
            for f in (1, 2, 3):
                if snaps[15][f] - snaps[0][f] >= 10:
                    a[1] += 1
                    if victor == f:
                        a[0] += 1
        # C / C2: t=30 leader
        if 30 in snaps:
            s30 = snaps[30]
            order = sorted(s30, key=lambda f: (-s30[f], f))
            leader = order[0]
            c = C.setdefault(z, [0, 0])
            c[1] += 1
            if victor != leader:
                c[0] += 1
            # C2: stalling leader (no gain t=15->30)
            if 15 in snaps and snaps[30][leader] - snaps[15][leader] <= 0:
                c2 = C2.setdefault(z, [0, 0])
                c2[1] += 1
                if victor == leader:
                    c2[0] += 1
            # B: 2nd place captures t=30->60
            if dur >= 59:
                second = order[1]
                trailer = order[2]
                b = B.setdefault(z, [0, 0])
                t0, t1 = start + 30 * 60, start + 60 * 60
                for ts, of, nf in fts:
                    if t0 < ts <= t1 and nf == second:
                        if of == trailer:
                            b[0] += 1
                        elif of == leader:
                            b[1] += 1
            # B2: t=45->75
            if dur >= 74 and 45 in snaps:
                s45 = snaps[45]
                o45 = sorted(s45, key=lambda f: (-s45[f], f))
                b2 = B2.setdefault(z, [0, 0])
                t0, t1 = start + 45 * 60, start + 75 * 60
                for ts, of, nf in fts:
                    if t0 < ts <= t1 and nf == o45[1]:
                        if of == o45[2]:
                            b2[0] += 1
                        elif of == o45[0]:
                            b2[1] += 1

    print("\n=== n alerts ===")
    for z in sorted(n_alerts):
        print(f"  {ZNAMES[z]:8s}: {n_alerts[z]}")
    print("\n=== A: early-rush (>=+10pp t0->t15) win rate ===")
    for z in sorted(A):
        w, n = A[z]
        print(f"  {ZNAMES[z]:8s}: {100*w/n:5.1f}%  (n={n})")
    print("\n=== B: 2nd-place captures t30->t60: % from trailer ===")
    for z in sorted(B):
        ft, fl = B[z]
        n = ft + fl
        print(f"  {ZNAMES[z]:8s}: {100*ft/n:5.1f}% trailer / {100*fl/n:5.1f}% leader  (n={n} captures)")
    print("\n=== B2: 2nd-place captures t45->t75: % from trailer ===")
    for z in sorted(B2):
        ft, fl = B2[z]
        n = ft + fl
        if n:
            print(f"  {ZNAMES[z]:8s}: {100*ft/n:5.1f}% trailer / {100*fl/n:5.1f}% leader  (n={n} captures)")
    print("\n=== C: P(t30 leader loses) ===")
    for z in sorted(C):
        l, n = C[z]
        print(f"  {ZNAMES[z]:8s}: {100*l/n:5.1f}%  (n={n})")
    print("\n=== C2: P(t30 leader holds | stalled t15->t30, gain<=0) ===")
    for z in sorted(C2):
        h, n = C2[z]
        print(f"  {ZNAMES[z]:8s}: {100*h/n:5.1f}%  (n={n})")

if __name__ == "__main__":
    analyze()
