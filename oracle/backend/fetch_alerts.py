#!/usr/bin/env python3
"""Resumable, polite fetcher for PS2polymarket debute-book validation data.

What it pulls (per alert): instance record (outcome), facility capture
history (hex flip order), per-minute population samples.
Scope: newest 300 completed 90-min territory alerts per world (1/10/13/19),
started on/after 2025-10-01. ~1,200 alerts, 2 API calls each, ~1.2s apart.

Restart-proof: progress.json records every completed alert; reruns skip
done work. Lockfile prevents concurrent runs. Exits fast when complete.
"""
import json, os, sys, time, urllib.request
from datetime import datetime, timezone

ROOT = os.path.expanduser("~/workspace/ps2polymarket")
DATA = os.path.join(ROOT, "data", "alerts")
PROG = os.path.join(ROOT, "progress.json")
LOCK = os.path.join(ROOT, "fetch.lock")
BASE = "https://api.ps2alerts.com"
UA = {"User-Agent": "ps2polymarket-research/0.1 (debute-book validation; ~1 req/s)"}
WORLDS = [1, 10, 13, 19]          # Connery, Miller, Emerald, Cobalt
PER_WORLD = 300
CUTOFF = datetime(2025, 10, 1, tzinfo=timezone.utc)
SLEEP = 1.2


def get(url, retries=4):
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            wait = 5 * (i + 1)
            print(f"  retry {i+1} ({e}) {url[:70]}", flush=True)
            time.sleep(wait)
    raise RuntimeError(f"failed: {url[:70]}")


def lock():
    if os.path.exists(LOCK):
        try:
            pid = int(open(LOCK).read().strip())
            os.kill(pid, 0)
            print(f"another fetcher running (pid {pid}), exiting")
            sys.exit(0)
        except (ValueError, ProcessLookupError, PermissionError):
            pass
    open(LOCK, "w").write(str(os.getpid()))


def main():
    os.makedirs(DATA, exist_ok=True)
    lock()
    try:
        prog = json.load(open(PROG)) if os.path.exists(PROG) else {}
        if prog.get("complete"):
            print("fetch already complete")
            return
        done = prog.get("done", {})
        targets = []
        for w in WORLDS:
            d = get(f"{BASE}/instances/territory-control"
                    f"?world={w}&pageSize=1000&sortBy=timeStarted&order=desc")
            filt = [a for a in d
                    if a.get("state") == 2 and a.get("duration") == 5400000
                    and datetime.fromisoformat(
                        a["timeStarted"].replace("Z", "+00:00")) >= CUTOFF][:PER_WORLD]
            print(f"world {w}: {len(filt)} targets", flush=True)
            targets.extend(filt)
            time.sleep(SLEEP)
        todo = [a for a in targets if a["instanceId"] not in done]
        print(f"total {len(targets)}, todo {len(todo)}", flush=True)
        for i, a in enumerate(todo):
            iid = a["instanceId"]
            try:
                fac = get(f"{BASE}/instance-entries/{iid}/facility"
                          f"?pageSize=2000&sortBy=timestamp&order=asc")
                time.sleep(SLEEP)
                pop = get(f"{BASE}/aggregates/instance/{iid}/population"
                          f"?pageSize=500&sortBy=timestamp&order=asc")
                time.sleep(SLEEP)
                rec = {
                    "instance": {k: a.get(k) for k in (
                        "instanceId", "world", "zone", "timeStarted",
                        "timeEnded", "duration", "bracket", "result")},
                    "facility": fac,
                    "population": pop,
                }
                with open(os.path.join(DATA, f"{iid}.json"), "w") as f:
                    json.dump(rec, f)
                done[iid] = True
            except Exception as e:
                print(f"FAILED {iid}: {e}", flush=True)
            if (i + 1) % 25 == 0:
                json.dump({"done": done, "complete": False}, open(PROG, "w"))
                print(f"  progress {i+1}/{len(todo)}", flush=True)
        json.dump({"done": done, "complete": True}, open(PROG, "w"))
        print(f"COMPLETE: {len(done)} alerts", flush=True)
    finally:
        if os.path.exists(LOCK):
            os.remove(LOCK)


main()
