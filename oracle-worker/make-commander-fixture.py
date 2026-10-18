#!/usr/bin/env python3
"""Writes test/fixtures/commander-parity.json: realistic random alert states
run through the real commander_live.py (--json), for the JS port to reproduce.

Python iterates lattice neighbours from sets (hash order varies per process),
which only changes tie orders and which enemy neighbour is named "taker". To
compare like with like, load_lattice is pinned to links-file order here, the
order the JS port uses.

Run from the repo root: python3 oracle-worker/make-commander-fixture.py
"""
import contextlib, io, json, os, random, shutil, sys
from collections import defaultdict
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(HERE, "..", "oracle", "backend")
sys.path.insert(0, BACKEND)
import commander_live as C  # noqa: E402

SLUG = {2: "indar", 4: "hossin", 6: "amerish", 8: "esamir", 344: "oshur"}
WORLD = 99  # scratch world id: data written under oracle/backend/data/*/99


def ordered_lattice(zone):
    slug = SLUG[zone]
    links = json.load(open(os.path.join(BACKEND, f"{slug}_links.json")))
    adj = defaultdict(list)
    for l in links:
        a, b = str(l["facility_id_a"]), str(l["facility_id_b"])
        if b not in adj[a]:
            adj[a].append(b)
        if a not in adj[b]:
            adj[b].append(a)
    regs = json.load(open(os.path.join(BACKEND, f"{slug}_regions.json")))
    names = {str(r["facility_id"]): r["facility_name"] for r in regs}
    r2f = json.load(open(os.path.join(BACKEND, f"{slug}_region_to_facility.json")))
    return adj, names, r2f


C.load_lattice = ordered_lattice


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat().replace("+00:00", "Z")


def grow(zone, rng, dominant=None):
    adj, names, r2f = ordered_lattice(zone)
    fids = sorted(set(r2f.values()), key=int)
    gates = [f for f in fids if "warpgate" in names.get(f, "").lower()]
    rng.shuffle(gates)
    own = {}
    facs = [1, 2, 3]
    rng.shuffle(facs)
    frontier = []
    for g, fo in zip(gates, facs * 3):
        own[g] = fo
        frontier.append(g)
    weights = {1: 1.0, 2: 1.0, 3: 1.0}
    if dominant:
        weights[dominant] = 4.0
    while frontier:
        rng.shuffle(frontier)
        frontier.sort(key=lambda x: -weights[own[x]] * rng.random())
        cur = frontier.pop(0)
        for nb in adj.get(cur, []):
            if nb in r2f.values() and nb not in own:
                own[nb] = own[cur]
                frontier.append(nb)
    for f in fids:
        own.setdefault(f, rng.choice([1, 2, 3]))
    gateset = set(gates)
    for f in fids:
        if f not in gateset and rng.random() < 0.08:
            own[f] = rng.choice([1, 2, 3])
        if f not in gateset and rng.random() < 0.02:
            own[f] = 0
    return own, r2f, fids


def to_regions(own, r2f):
    inv = {}
    for rid, fid in r2f.items():
        inv.setdefault(fid, rid)
    regs = {inv[f]: str(o) for f, o in own.items() if f in inv}
    return dict(sorted(regs.items(), key=lambda kv: int(kv[0])))


def write_layout(zone, start, target, regs_now, regs_15, flips, dur):
    data = os.path.join(BACKEND, "data")
    for sub in ("map_snapshots", "census_events"):
        shutil.rmtree(os.path.join(data, sub, str(WORLD)), ignore_errors=True)
    mdir = os.path.join(data, "map_snapshots", str(WORLD), str(zone))
    os.makedirs(mdir, exist_ok=True)
    day = datetime.fromtimestamp(target, timezone.utc).strftime("%Y-%m-%d")
    with open(os.path.join(mdir, f"{day}.jsonl"), "w") as f:
        f.write(json.dumps({"ts": iso(target - 900), "facilities": regs_15}) + "\n")
        f.write(json.dumps({"ts": iso(target - 5), "facilities": regs_now}) + "\n")
    edir = os.path.join(data, "census_events", str(WORLD))
    os.makedirs(edir, exist_ok=True)
    with open(os.path.join(edir, f"{day}.jsonl"), "w") as f:
        f.write(json.dumps({"window_start": iso(start), "alert_events": [
            {"ts": str(start), "zone": str(zone), "event_id": "153", "state": "started"}],
            "flips": [{"ts": str(ts), "zone": str(zone), "facility": fac, "old": old, "new": new} for ts, new, old, fac in flips]}) + "\n")


def run(zone, start, at, dur):
    sys.argv = ["commander_live.py", "--world", str(WORLD), "--zone", str(zone), "--start-ts", str(start),
                "--at", str(at), "--duration-min", str(dur), "--json"]
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        C.main()
    return json.loads(buf.getvalue().strip().splitlines()[-1])


def main():
    rng = random.Random(20261018)
    cases = []
    zones = [2, 4, 6, 8, 344]
    for i in range(60):
        zone = zones[i % 5]
        dur = rng.choice([90, 90, 45, 30])
        at = round(rng.uniform(1, dur + 4), 2) if i % 6 else round(dur * 0.85, 2)
        dominant = rng.choice([1, 2, 3]) if i % 6 == 0 else None
        own, r2f, fids = grow(zone, rng, dominant)
        own15 = dict(own)
        for f in rng.sample(fids, k=max(1, len(fids) // 12)):
            own15[f] = rng.choice([1, 2, 3])
        start = 1_792_000_000 + i * 10_000
        target = start + at * 60
        flips = []
        for _ in range(rng.choice([0, 6, 25, 60])):
            ts = int(rng.uniform(start, target))
            new, old = rng.sample(["VS", "NC", "TR"], 2)
            flips.append((ts, new, old, rng.choice(fids)))
        # a burst in the last 4 minutes so heat / predictive heat are exercised
        for _ in range(rng.choice([0, 3, 8])):
            ts = int(rng.uniform(max(start, target - 240), target))
            new, old = rng.sample(["VS", "NC", "TR"], 2)
            flips.append((ts, new, old, rng.choice(fids)))
        flips.sort()
        regs_now, regs_15 = to_regions(own, r2f), to_regions(own15, r2f)
        write_layout(zone, start, target, regs_now, regs_15, flips, dur)
        out = run(zone, start, at, dur)
        cases.append({"zone": zone, "dur": dur, "at": at, "start": start, "regs_now": regs_now, "regs_15": regs_15,
                      "flips": [[ts, new, old, fac] for ts, new, old, fac in flips], "out": out})
    for sub in ("map_snapshots", "census_events"):
        shutil.rmtree(os.path.join(BACKEND, "data", sub, str(WORLD)), ignore_errors=True)
    path = os.path.join(HERE, "..", "test", "fixtures", "commander-parity.json")
    json.dump(cases, open(path, "w"))
    locked = sum(1 for c in cases if "second_place" in c["out"])
    devs = sum(1 for c in cases if c["out"]["fight_up"]["deviation"])
    km = sum(1 for c in cases for f in c["out"]["factions"].values() if f["kingmaker"])
    cuts = sum(1 for c in cases for f in c["out"]["factions"].values() for a in f["attack"] if a["cut_severs"])
    print(f"wrote {len(cases)} cases: second_place={locked} fight_up_dev={devs} kingmaker_lists={km} cut_attacks={cuts}")


if __name__ == "__main__":
    main()
