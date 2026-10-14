"""Cut tracking system: detects territory cuts in live/historical map data.

A "cut" = an articulation point (chokepoint) in a faction's territory graph
is captured by an enemy, severing part of their territory from the warpgate.

Usage:
    from cut_tracker import CutTracker
    tracker = CutTracker()
    # Check two snapshots for cuts
    events = tracker.detect_cuts(snap0, snap1, zone)
    # Log to persistent store
    tracker.log_events(events)
"""
import json
import os
from collections import defaultdict, Counter
from datetime import datetime

# Zone -> continent name
ZONE_NAMES = {2: 'indar', 4: 'hossin', 6: 'amerish', 8: 'esamir', 344: 'oshur'}

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
EVENT_LOG = os.path.join(BASE_DIR, 'cut_events.jsonl')


class CutTracker:
    def __init__(self):
        self.lattices = {}  # zone -> adj dict
        self.r2f = {}       # zone -> region->facility mapping
        self.names = {}     # zone -> facility_id -> name
        for zone, cname in ZONE_NAMES.items():
            # Lattice
            with open(os.path.join(BASE_DIR, f'{cname}_links.json')) as f:
                links = json.load(f)
            adj = defaultdict(list)
            for e in links:
                a, b = str(e['facility_id_a']), str(e['facility_id_b'])
                adj[a].append(b)
                adj[b].append(a)
            self.lattices[zone] = dict(adj)
            # Region -> facility
            with open(os.path.join(BASE_DIR, f'{cname}_region_to_facility.json')) as f:
                self.r2f[zone] = {str(k): str(v) for k, v in json.load(f).items()}
            # Names (optional)
            try:
                with open(os.path.join(BASE_DIR, f'{cname}_regions.json')) as f:
                    regions = json.load(f)
                # regions: list of {facility_id, name} or dict
                nm = {}
                if isinstance(regions, list):
                    for r in regions:
                        fid = str(r.get('facility_id', r.get('id', '')))
                        n = r.get('name', '')
                        if fid and n:
                            nm[fid] = n
                elif isinstance(regions, dict):
                    for fid, info in regions.items():
                        if isinstance(info, dict):
                            nm[str(fid)] = info.get('name', str(fid))
                        else:
                            nm[str(fid)] = str(info)
                self.names[zone] = nm
            except FileNotFoundError:
                self.names[zone] = {}

    def normalize(self, raw_facs, zone):
        """Map snapshot region IDs to lattice facility IDs."""
        r2f = self.r2f.get(zone, {})
        out = {}
        for rid, owner in raw_facs.items():
            fid = r2f.get(str(rid))
            if fid:
                out[fid] = str(owner)
        return out

    def find_aps(self, own, zone, faction):
        """Articulation points in faction's territory. Returns {fid: severed_count}."""
        adj = self.lattices.get(zone, {})
        fids = {fid for fid, o in own.items() if o == str(faction)}
        if len(fids) < 5:
            return {}
        disc, low, parent = {}, {}, {}
        ap = set()
        time = [0]
        sub = {fid: [nb for nb in adj.get(fid, []) if nb in fids] for fid in fids}

        def dfs(u):
            disc[u] = low[u] = time[0]
            time[0] += 1
            ch = 0
            for v in sub.get(u, []):
                if v not in disc:
                    parent[v] = u
                    ch += 1
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

        # For each AP, count what would be severed
        result = {}
        for ap_fid in ap:
            # BFS from all non-AP faction bases, see what's unreachable
            # Simplified: use warpgate BFS if available, else flood from neighbors
            seen = set()
            # Start from all faction bases except the AP
            seeds = [f for f in fids if f != ap_fid]
            if not seeds:
                continue
            # BFS from first seed (assumes connected territory minus AP)
            stack = [seeds[0]]
            while stack:
                u = stack.pop()
                if u in seen or u == ap_fid:
                    continue
                seen.add(u)
                stack.extend(nb for nb in sub.get(u, []) if nb != ap_fid)
            severed = len(fids) - len(seen) - 1  # minus AP itself
            if severed > 0:
                result[ap_fid] = severed
        return result

    def territory_share(self, own, faction):
        c = Counter(v for v in own.values() if v in ('1', '2', '3'))
        n = sum(c.values())
        return c[str(faction)] / n if n else 0

    def detect_cuts(self, snap0, snap1, zone):
        """Compare two snapshots. Returns list of cut events.
        snap = (timestamp_epoch, {facility_id: owner_str})
        """
        ts0, own0 = snap0
        ts1, own1 = snap1
        events = []
        for fac in ('1', '2', '3'):
            aps = self.find_aps(own0, zone, fac)
            for ap_fid, severed in aps.items():
                o0 = own0.get(ap_fid)
                o1 = own1.get(ap_fid)
                if o0 == fac and o1 not in (fac, '0', None) and o1 in ('1', '2', '3'):
                    events.append({
                        'ts': ts1,
                        'dt': datetime.fromtimestamp(ts1).isoformat(),
                        'zone': zone,
                        'continent': ZONE_NAMES.get(zone, str(zone)),
                        'victim': fac,
                        'taker': o1,
                        'base_id': ap_fid,
                        'base_name': self.names.get(zone, {}).get(ap_fid, ap_fid),
                        'severed_count': severed,
                        'victim_share_before': round(self.territory_share(own0, fac), 4),
                    })
        return events

    def log_events(self, events):
        """Append events to persistent JSONL log."""
        if not events:
            return
        with open(EVENT_LOG, 'a') as f:
            for e in events:
                f.write(json.dumps(e) + '\n')

    def load_events(self, zone=None, since_ts=None):
        """Load logged events, optionally filtered."""
        out = []
        if not os.path.exists(EVENT_LOG):
            return out
        with open(EVENT_LOG) as f:
            for line in f:
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if zone is not None and e.get('zone') != zone:
                    continue
                if since_ts is not None and e.get('ts', 0) < since_ts:
                    continue
                out.append(e)
        return out
