#!/usr/bin/env python3
"""Run the AI Commander for every live alert and post it to the ps2-oracle Worker.

Used by .github/workflows/oracle-commander.yml. For each live alert from
GET /live it pulls the recent map snapshots, alert events and base flips from
GET /export, writes them in the layout commander_live.py already reads
(data/map_snapshots/<w>/<z>/<date>.jsonl, data/census_events/<w>/<date>.jsonl),
runs commander_live.py unchanged, and POSTs the JSON to /commander.

Env: ORACLE_API (default https://ps2-oracle.dayset.workers.dev), ORACLE_KEY.
Exit code is 0 unless every alert failed; per-alert errors are printed.
"""
import json, os, shutil, subprocess, sys, urllib.request
from collections import defaultdict
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
API = os.environ.get("ORACLE_API", "https://ps2-oracle.dayset.workers.dev").rstrip("/")
KEY = os.environ.get("ORACLE_KEY", "")
FAC = {1: "VS", 2: "NC", 3: "TR"}
UA = "ps2-oracle-commander/1.0 (github actions)"


def call(path, body=None):
    req = urllib.request.Request(API + path, headers={"User-Agent": UA, "X-Oracle-Key": KEY, "Content-Type": "application/json"},
                                 data=json.dumps(body).encode() if body is not None else None,
                                 method="POST" if body is not None else "GET")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat().replace("+00:00", "Z")


def day(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d")


def write_layout(exp, world, zone):
    """Rebuild the poller file layout for one world/zone from an /export payload."""
    data = os.path.join(ROOT, "data")
    for sub in ("map_snapshots", "census_events"):
        shutil.rmtree(os.path.join(data, sub, str(world)), ignore_errors=True)
    snaps = defaultdict(list)
    for s in exp["snaps"]:
        snaps[day(s["ts"])].append(json.dumps({"ts": iso(s["ts"]), "world": world, "zone": zone, "facilities": s["facilities"]}))
    mdir = os.path.join(data, "map_snapshots", str(world), str(zone))
    os.makedirs(mdir, exist_ok=True)
    for d, lines in snaps.items():
        with open(os.path.join(mdir, f"{d}.jsonl"), "w") as f:
            f.write("\n".join(lines) + "\n")
    # One synthetic events "window" per day holding all alert events + flips.
    by_day = defaultdict(lambda: {"alert_events": [], "flips": []})
    for m in exp["metagame"]:
        by_day[day(m["ts"])]["alert_events"].append({
            "ts": str(m["ts"]), "world": str(world), "zone": str(m["zone"]), "event_id": str(m["event_id"]),
            "instance_id": str(m["instance_id"]), "state": m["state"]})
    for x in exp["flips"]:
        by_day[day(x["ts"])]["flips"].append({
            "ts": str(x["ts"]), "world": str(world), "zone": str(x["zone"]), "facility": str(x["facility"]),
            "old": FAC.get(x["old"], "?"), "new": FAC.get(x["new"], "?"), "duration_held": x.get("held")})
    edir = os.path.join(data, "census_events", str(world))
    os.makedirs(edir, exist_ok=True)
    for d, rec in by_day.items():
        rec["window_start"] = f"{d}T00:00:00Z"
        rec["world"] = world
        with open(os.path.join(edir, f"{d}.jsonl"), "w") as f:
            f.write(json.dumps(rec) + "\n")


def main():
    if not KEY:
        print("ORACLE_KEY not set; nothing to do")
        return 0
    try:
        live = [a for a in call("/live")["alerts"] if a["status"] == "live"]
    except Exception as e:  # Worker down or not deployed yet: not this job's failure
        print(f"::warning::oracle Worker unreachable ({e}); skipping")
        return 0
    print(f"{len(live)} live alert(s)")
    ok = fail = 0
    for a in live:
        label = f"{a['world_name']} {a['zone_name']} ({a['key']})"
        try:
            exp = call(f"/export?world={a['world']}&zone={a['zone']}&since={a['start_ts'] - 3600}")
            write_layout(exp, a["world"], a["zone"])
            r = subprocess.run([sys.executable, os.path.join(ROOT, "commander_live.py"), "--world", str(a["world"]),
                                "--zone", str(a["zone"]), "--start-ts", str(a["start_ts"]),
                                "--duration-min", str(a["dur"]), "--json"],
                               capture_output=True, text=True, timeout=120, cwd=ROOT)
            if r.returncode != 0:
                raise RuntimeError(f"commander exit {r.returncode}: {(r.stderr or r.stdout)[-400:]}")
            cmd = json.loads(r.stdout.strip().splitlines()[-1])
            res = call("/commander", {"key": a["key"], "commander": cmd})
            print(f"ok   {label}: updated={res.get('updated')}")
            ok += 1
        except Exception as e:
            print(f"FAIL {label}: {e}")
            fail += 1
    return 1 if fail and not ok else 0


if __name__ == "__main__":
    sys.exit(main())
