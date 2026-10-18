#!/usr/bin/env python3
"""Meltdown predictability proxy analysis (read-only).

Historical dataset has ZERO 45-min alerts (fetch pipeline filtered duration==5400000).
This script uses 90-min alerts with meltdown-like starting conditions (t0 leader >=41%
territory, the approximate Unstable Meltdown trigger threshold) as a proxy to estimate
how much more predictable meltdowns are than standard alerts.

Also computes the 90-min leader-win curve as the baseline for duration-normalized comparison.
"""
import json, glob, os
from collections import Counter, defaultdict
from datetime import datetime, timezone

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "alerts")

def parse_ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))

def load_alert(path):
    d = json.load(open(path))
    inst = d["instance"]
    r = inst.get("result") or {}
    v = r.get("victor")
    if v not in (1, 2, 3) or r.get("draw"):
        return None
    try:
        t0 = parse_ts(inst["timeStarted"]).timestamp()
    except Exception:
        return None
    own0 = {}
    for e in d["facility"]:
        if e.get("isInitial"):
            own0[int(e["facility"])] = e["newFaction"]
    total = len(own0)
    if total == 0:
        return None
    flips = sorted(
        [e for e in d["facility"] if not e.get("isInitial") and not e.get("isDefence")],
        key=lambda e: e["timestamp"])
    own = dict(own0)
    fi = 0
    tsh = {}
    for m in (0, 15, 30, 45, 60, 75):
        t = t0 + m * 60
        while fi < len(flips) and parse_ts(flips[fi]["timestamp"]).timestamp() <= t:
            own[int(flips[fi]["facility"])] = flips[fi]["newFaction"]
            fi += 1
        c = Counter(own.values())
        tsh[m] = {f: c.get(f, 0) / total * 100 for f in (1, 2, 3)}
    return {"victor": v, "tsh": tsh, "zone": str(inst.get("zone")),
            "world": inst.get("world"), "dur_min": (inst.get("duration") or 0) // 60000}

def leader(sh):
    return max((1, 2, 3), key=lambda f: sh[f])

def main():
    files = sorted(glob.glob(os.path.join(DATA, "*.json")))
    n_files = len(files)
    n_used = 0
    n_skip = 0
    # leader-win counts per slice minute
    win_at = defaultdict(int)
    n_at = defaultdict(int)
    # meltdown proxy: t0 leader share >= 41
    proxy_win = defaultdict(int)
    proxy_n = defaultdict(int)
    # t0 lead margin buckets -> leader win rate
    margin_buckets = defaultdict(lambda: [0, 0])  # bucket -> [wins, n]
    proxy_zones = Counter()
    proxy_worlds = Counter()
    t0_lead_dist = Counter()
    SLICES = [0, 15, 30, 45, 60, 75]
    for p in files:
        try:
            a = load_alert(p)
        except Exception:
            n_skip += 1
            continue
        if a is None:
            n_skip += 1
            continue
        n_used += 1
        v = a["victor"]
        tsh = a["tsh"]
        t0 = tsh[0]
        l0 = leader(t0)
        l0share = t0[l0]
        margin0 = l0share - max(t0[g] for g in (1, 2, 3) if g != l0)
        t0_lead_dist[round(l0share)] += 1
        bucket = f"{int(margin0 // 5) * 5}-{int(margin0 // 5) * 5 + 5}"
        is_proxy = l0share >= 41.0
        for m in SLICES:
            lm = leader(tsh[m])
            n_at[m] += 1
            if lm == v:
                win_at[m] += 1
            if is_proxy:
                proxy_n[m] += 1
                if lm == v:
                    proxy_win[m] += 1
        mb = margin_buckets[bucket]
        mb[1] += 1
        if l0 == v:
            mb[0] += 1
        if is_proxy:
            proxy_zones[a["zone"]] += 1
            proxy_worlds[a["world"]] += 1

    print(f"files={n_files} used={n_used} skipped={n_skip}")
    print("\n== 90-min baseline: leader-win rate by slice ==")
    for m in SLICES:
        print(f"  t{m:>2}: {win_at[m]/n_at[m]:.3f}  (n={n_at[m]})")
    n_proxy = proxy_n[0]
    print(f"\n== meltdown proxy (t0 leader >=41%): n={n_proxy} ({n_proxy/n_used:.1%} of alerts) ==")
    for m in SLICES:
        print(f"  t{m:>2}: {proxy_win[m]/proxy_n[m]:.3f}  (n={proxy_n[m]})")
    print("\n== leader-win rate by t0 lead-margin bucket ==")
    for b in sorted(margin_buckets, key=lambda x: int(x.split("-")[0])):
        w, n = margin_buckets[b]
        if n >= 200:
            print(f"  margin {b:>7}pp: {w/n:.3f}  (n={n})")
    print("\n== proxy alert zone distribution ==", dict(proxy_zones))
    print("== proxy alert world distribution ==", dict(proxy_worlds))
    print("\n== t0 leader share distribution (rounded %) ==")
    for s in sorted(t0_lead_dist):
        if t0_lead_dist[s] >= 100:
            print(f"  {s}%: {t0_lead_dist[s]}")

    out = {
        "n_files": n_files, "n_used": n_used, "n_skipped": n_skip,
        "baseline_leader_win": {str(m): round(win_at[m]/n_at[m], 4) for m in SLICES},
        "proxy_n": n_proxy, "proxy_frac": round(n_proxy/n_used, 4),
        "proxy_leader_win": {str(m): round(proxy_win[m]/proxy_n[m], 4) for m in SLICES},
        "margin_buckets": {b: {"win": round(margin_buckets[b][0]/margin_buckets[b][1], 4),
                               "n": margin_buckets[b][1]}
                           for b in margin_buckets if margin_buckets[b][1] >= 200},
        "proxy_zones": dict(proxy_zones), "proxy_worlds": dict(proxy_worlds),
    }
    json.dump(out, open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                     "meltdown_proxy_results.json"), "w"), indent=1)
    print("\nwrote meltdown_proxy_results.json")

if __name__ == "__main__":
    main()
