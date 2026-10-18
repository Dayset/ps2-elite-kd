"""Cut impact analysis: active alert snapshots only."""
import json, glob
from collections import defaultdict, Counter
from datetime import datetime

with open('indar_links.json') as f:
    links_data = json.load(f)
adj = defaultdict(list)
for e in links_data:
    a, b = str(e['facility_id_a']), str(e['facility_id_b'])
    adj[a].append(b); adj[b].append(a)

# Region ID (snapshot) -> Facility ID (lattice) mapping
with open('indar_region_to_facility.json') as f:
    r2f = {str(k): str(v) for k, v in json.load(f).items()}

# Load active snapshots only (map region IDs to facility IDs for lattice)
files = sorted(glob.glob('data/map_snapshots/1/2/*.jsonl'))
snaps = []
for fn in files:
    with open(fn) as fh:
        for line in fh:
            d = json.loads(line)
            raw_facs = d['facilities']
            # Map snapshot region IDs to lattice facility IDs
            facs = {}
            for rid, owner in raw_facs.items():
                fid = r2f.get(str(rid))
                if fid:
                    facs[fid] = str(owner)
            c = Counter(v for v in facs.values() if v in ('1','2','3'))
            n = sum(c.values())
            if n == 0: continue
            shares = {k: c[k]/n for k in ('1','2','3')}
            if all(s > 0.15 for s in shares.values()):
                dt = datetime.fromisoformat(d['ts'].replace('Z', '+00:00'))
                snaps.append((dt.timestamp(), facs))
snaps.sort()
print(f"Active snapshots: {len(snaps)}")

def find_aps(own, faction):
    fids = {fid for fid, o in own.items() if o == faction}
    if len(fids) < 5:
        return set()
    disc, low, parent = {}, {}, {}
    ap, time = set(), [0]
    sub = {fid: [nb for nb in adj.get(fid, []) if nb in fids] for fid in fids}
    def dfs(u):
        disc[u] = low[u] = time[0]; time[0] += 1
        ch = 0
        for v in sub.get(u, []):
            if v not in disc:
                parent[v] = u; ch += 1
                dfs(v)
                low[u] = min(low[u], low[v])
                if parent.get(u) is not None and low[v] >= disc[u]:
                    ap.add(u)
            elif v != parent.get(u):
                low[u] = min(low[u], disc[v])
        if parent.get(u) is None and ch > 1:
            ap.add(u)
    for s in fids:
        if s not in disc:
            parent[s] = None
            dfs(s)
    return ap

def share(own, fac):
    c = Counter(v for v in own.values() if v in ('1','2','3'))
    n = sum(c.values())
    return c[fac]/n if n else 0

cuts = []
# Check every 5th snapshot to reduce compute
for i in range(0, len(snaps)-6, 5):
    ts0, own0 = snaps[i]
    ts1, own1 = snaps[i+1]
    if ts1 - ts0 > 600:
        continue
    for fac in ('1','2','3'):
        for ap_fid in find_aps(own0, fac):
            if own0.get(ap_fid) == fac and own1.get(ap_fid) not in (fac, '0'):
                taker = own1.get(ap_fid)
                if taker not in ('1','2','3'):
                    continue
                # 15-min later share
                s0 = share(own0, fac)
                s_later = None
                for j in range(i+1, min(i+20, len(snaps))):
                    if snaps[j][0] >= ts1 + 900:
                        s_later = share(snaps[j][1], fac)
                        break
                if s_later is not None:
                    cuts.append({'victim': fac, 'taker': taker, 'ap': ap_fid,
                                 'swing': s_later - s0, 'before': s0, 'after': s_later})

print(f"\nCuts detected: {len(cuts)}")
if cuts:
    swings = [c['swing'] for c in cuts]
    avg = sum(swings)/len(swings)
    neg = sum(1 for s in swings if s < -0.02)
    pos = sum(1 for s in swings if s > 0.02)
    print(f"Avg 15-min swing for victim: {avg:+.3f}")
    print(f"Victim lost >2%: {neg}/{len(cuts)} ({100*neg/len(cuts):.1f}%)")
    print(f"Victim gained >2%: {pos}/{len(cuts)} ({100*pos/len(cuts):.1f}%)")
    cuts.sort(key=lambda c: c['swing'])
    print("\nTop 3 worst cuts:")
    for c in cuts[:3]:
        print(f"  {c['ap']}: f{c['victim']}->{c['taker']} {c['before']:.1%}->{c['after']:.1%} ({c['swing']:+.1%})")
else:
    print("No AP captures found in active snapshots")
