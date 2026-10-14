"""Pilot: do historical cuts correlate with territory collapse?
Uses 9 days of per-base map_snapshots (2026-10-04 to 2026-10-12).
Detects articulation-point captures and measures territory swing after.
"""
import json, glob
from collections import defaultdict

# Load Indar lattice (zone 2)
with open('indar_links.json') as f:
    links_data = json.load(f)
# links: [{facility_id_a, facility_id_b}, ...]
adj = defaultdict(list)
for e in links_data:
    a, b = str(e['facility_id_a']), str(e['facility_id_b'])
    adj[a].append(b)
    adj[b].append(a)

print(f"Lattice: {len(adj)} bases")

# Load snapshots for world 1, zone 2 (Indar)
files = sorted(glob.glob('data/map_snapshots/1/2/*.jsonl'))
snaps = []
for fn in files:
    with open(fn) as fh:
        for line in fh:
            d = json.loads(line)
            facs = d.get('facilities', {})
            # facilities: {fid: owner} or list?
            if isinstance(facs, dict) and facs:
                # parse ISO timestamp to epoch
                from datetime import datetime
                ts_str = d['ts']
                dt = datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
                snaps.append((dt.timestamp(), facs))
snaps.sort()
print(f"Snapshots: {len(snaps)}, range: {snaps[0][0]} to {snaps[-1][0]}")

# Simple articulation check for a faction's territory
def find_aps(own, faction):
    fids = {fid for fid, o in own.items() if str(o) == str(faction)}
    if len(fids) < 3:
        return set()
    # find warpgate (assume lowest fid or name check - use connectivity from any)
    # Use iterative DFS for articulation points
    disc, low, parent = {}, {}, {}
    ap = set()
    time = [0]
    # Build subgraph adjacency
    sub_adj = {fid: [nb for nb in adj.get(fid, []) if nb in fids] for fid in fids}
    def dfs(u):
        disc[u] = low[u] = time[0]; time[0] += 1
        children = 0
        for v in sub_adj.get(u, []):
            if v not in disc:
                parent[v] = u; children += 1
                dfs(v)
                low[u] = min(low[u], low[v])
                if parent.get(u) is not None and low[v] >= disc[u]:
                    ap.add(u)
            elif v != parent.get(u):
                low[u] = min(low[u], disc[v])
        if parent.get(u) is None and children > 1:
            ap.add(u)
    for start in fids:
        if start not in disc:
            parent[start] = None
            dfs(start)
    return ap

def territory_share(own):
    counts = defaultdict(int)
    total = 0
    for fid, o in own.items():
        if str(o) in ('1', '2', '3'):
            counts[str(o)] += 1
            total += 1
    return {k: v/total for k, v in counts.items()} if total else {}

# Detect AP captures and measure 15-min territory swing
cuts_detected = []
for i in range(len(snaps) - 1):
    ts0, own0 = snaps[i]
    ts1, own1 = snaps[i + 1]
    if ts1 - ts0 > 300:  # gap too large, skip
        continue
    # Find APs in own0 for each faction
    for fac in ('1', '2', '3'):
        aps = find_aps(own0, fac)
        for ap_fid in aps:
            o0 = str(own0.get(ap_fid, '0'))
            o1 = str(own1.get(ap_fid, '0'))
            if o0 == fac and o1 not in (fac, '0') and o1 in ('1', '2', '3'):
                # AP captured by enemy = CUT MADE against fac
                sh0 = territory_share(own0)
                # Find snapshot ~15 min later
                target_ts = ts1 + 900
                sh_later = None
                for j in range(i + 1, min(i + 20, len(snaps))):
                    if snaps[j][0] >= target_ts:
                        sh_later = territory_share(snaps[j][1])
                        break
                if sh_later:
                    swing = sh_later.get(fac, 0) - sh0.get(fac, 0)
                    cuts_detected.append({
                        'ts': ts1, 'victim': fac, 'taker': o1,
                        'ap': ap_fid, 'swing_15m': swing,
                        'before': sh0.get(fac, 0), 'after': sh_later.get(fac, 0),
                    })

print(f"\nCuts detected: {len(cuts_detected)}")
if cuts_detected:
    swings = [c['swing_15m'] for c in cuts_detected]
    avg_swing = sum(swings) / len(swings)
    neg = sum(1 for s in swings if s < -0.02)
    print(f"Avg 15-min territory swing for victim: {avg_swing:+.3f}")
    print(f"Cuts followed by >2% territory loss: {neg}/{len(cuts_detected)} ({100*neg/len(cuts_detected):.1f}%)")
    # Show worst 3
    cuts_detected.sort(key=lambda c: c['swing_15m'])
    print("\nWorst 3 cuts (biggest territory loss):")
    for c in cuts_detected[:3]:
        print(f"  AP {c['ap']}: fac{c['victim']} -> fac{c['taker']}, "
              f"{c['before']:.1%} -> {c['after']:.1%} (swing {c['swing_15m']:+.1%})")
else:
    print("No cuts detected in sample - may need wider time window or different zone")
