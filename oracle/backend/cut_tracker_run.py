"""Ongoing cut tracker: checks latest snapshots for new cuts.
Run via cron every 15 minutes. State in cut_tracker_state.json.
"""
import json, glob, os
from collections import Counter
from datetime import datetime
from cut_tracker import CutTracker, ZONE_NAMES

BASE = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.path.join(BASE, 'cut_tracker_state.json')

def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {'last_ts': {}}

def save_state(s):
    with open(STATE_FILE, 'w') as f:
        json.dump(s, f)

def main():
    tracker = CutTracker()
    state = load_state()
    last_ts = state.get('last_ts', {})
    new_events = []

    for zone in (2, 4, 6, 8, 344):
        # Get latest snapshot files
        files = sorted(glob.glob(os.path.join(BASE, f'data/map_snapshots/1/{zone}/*.jsonl')))
        if not files:
            continue
        # Read last 30 snapshots from the latest file
        snaps = []
        with open(files[-1]) as fh:
            lines = fh.readlines()
        for line in lines[-30:]:
            d = json.loads(line)
            facs = tracker.normalize(d['facilities'], zone)
            dt = datetime.fromisoformat(d['ts'].replace('Z', '+00:00'))
            snaps.append((dt.timestamp(), facs))
        snaps.sort()
        if len(snaps) < 2:
            continue

        # Only check snapshots newer than last run
        zkey = str(zone)
        cutoff = last_ts.get(zkey, 0)
        # Compare consecutive pairs
        for i in range(len(snaps) - 1):
            ts0, own0 = snaps[i]
            ts1, own1 = snaps[i + 1]
            if ts1 <= cutoff:
                continue
            if ts1 - ts0 > 600:
                continue
            events = tracker.detect_cuts((ts0, own0), (ts1, own1), zone)
            new_events.extend(events)

        # Update watermark
        if snaps:
            last_ts[zkey] = snaps[-1][0]

    if new_events:
        tracker.log_events(new_events)
        print(f"Logged {len(new_events)} new cut events")
        for e in new_events:
            print(f"  {e['continent']} {e['base_name']}: f{e['victim']}->f{e['taker']} "
                  f"severed={e['severed_count']}")
    else:
        print("No new cuts")

    state['last_ts'] = last_ts
    save_state(state)

if __name__ == '__main__':
    main()
