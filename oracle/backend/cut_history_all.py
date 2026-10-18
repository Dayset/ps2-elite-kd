"""Historical cut analysis: all 5 continents, full snapshot window."""
import json, glob
from collections import Counter
from datetime import datetime
from cut_tracker import CutTracker, ZONE_NAMES

tracker = CutTracker()
all_cuts = []

for zone in (2, 4, 6, 8, 344):
    cname = ZONE_NAMES[zone]
    files = sorted(glob.glob(f'data/map_snapshots/1/{zone}/*.jsonl'))
    snaps = []
    for fn in files:
        with open(fn) as fh:
            for line in fh:
                d = json.loads(line)
                facs = tracker.normalize(d['facilities'], zone)
                c = Counter(v for v in facs.values() if v in ('1', '2', '3'))
                n = sum(c.values())
                if n == 0:
                    continue
                shares = {k: c[k] / n for k in ('1', '2', '3')}
                if all(s > 0.15 for s in shares.values()):
                    dt = datetime.fromisoformat(d['ts'].replace('Z', '+00:00'))
                    snaps.append((dt.timestamp(), facs))
    snaps.sort()
    print(f"{cname} (z{zone}): {len(snaps)} active snapshots")

    # Detect cuts (every 5th snapshot)
    zone_cuts = []
    for i in range(0, len(snaps) - 2, 5):
        ts0, own0 = snaps[i]
        ts1, own1 = snaps[i + 1]
        if ts1 - ts0 > 600:
            continue
        events = tracker.detect_cuts((ts0, own0), (ts1, own1), zone)
        # Measure 15-min impact
        for e in events:
            s0 = e['victim_share_before']
            s_later = None
            for j in range(i + 1, min(i + 20, len(snaps))):
                if snaps[j][0] >= ts1 + 900:
                    s_later = tracker.territory_share(snaps[j][1], e['victim'])
                    break
            e['victim_share_after'] = round(s_later, 4) if s_later is not None else None
            e['swing_15m'] = round(s_later - s0, 4) if s_later is not None else None
            zone_cuts.append(e)
    print(f"  Cuts: {len(zone_cuts)}")
    all_cuts.extend(zone_cuts)
    # Log to persistent store
    tracker.log_events(zone_cuts)

print(f"\n{'='*50}")
print(f"TOTAL CUTS: {len(all_cuts)}")
if all_cuts:
    valid = [c for c in all_cuts if c['swing_15m'] is not None]
    swings = [c['swing_15m'] for c in valid]
    avg = sum(swings) / len(swings)
    neg = sum(1 for s in swings if s < -0.02)
    print(f"With 15-min follow-up: {len(valid)}")
    print(f"Avg victim swing: {avg:+.3f}")
    print(f"Victim lost >2%: {neg}/{len(valid)} ({100*neg/len(valid):.1f}%)")
    # By continent
    print("\nBy continent:")
    by_cont = {}
    for c in valid:
        by_cont.setdefault(c['continent'], []).append(c['swing_15m'])
    for cont, sw in sorted(by_cont.items()):
        print(f"  {cont}: n={len(sw)}, avg={sum(sw)/len(sw):+.3f}")
    # Worst cuts
    valid.sort(key=lambda c: c['swing_15m'])
    print("\nTop 5 worst cuts:")
    for c in valid[:5]:
        print(f"  {c['continent']} {c['base_name']} ({c['base_id']}): "
              f"f{c['victim']}->f{c['taker']} "
              f"{c['victim_share_before']:.1%}->{c['victim_share_after']:.1%} "
              f"({c['swing_15m']:+.1%}) severed={c['severed_count']}")
