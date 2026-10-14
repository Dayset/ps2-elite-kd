#!/usr/bin/env python3
"""Hossin-only fetcher for PS2polymarket — conditional probability models.

Scope: completed 90-min territory alerts on Hossin (zone 4), worlds
1/10/13/17/19/40 (all live servers + Jaeger; SolTech only runs 45-min
alerts so the 90-min filter naturally excludes it), all history back to
2021 (ps2alerts' earliest data), via paginated listing. Skips alerts
already in data/alerts/. Same polite pattern as v1/v2 (~1.2s between
calls), own progress file, restart-proof via checkpointing + lockfile.
"""
import json, os, sys, time, urllib.request
from datetime import datetime, timezone

ROOT = os.path.expanduser("~/workspace/ps2polymarket")
DATA = os.path.join(ROOT, "data", "alerts")
PROG = os.path.join(ROOT, "progress_hossin.json")
LOCK = os.path.join(ROOT, "fetch_hossin.lock")
BASE = "https://api.ps2alerts.com"
UA = {"User-Agent": "ps2polymarket-research/0.1 (hossin-models; ~1 req/s)"}
WORLDS = [1, 10, 13, 17, 19, 40]
ZONE = 4
LIST_PAGE = 25  # ps2alerts truncates listing responses above ~25KB; 25/page works
LIST_RETRIES = 6  # listing endpoint is flaky; retry a few times, then let the
                  # hourly cron try again later rather than hammering a sick API
TARGETS_CACHE = os.path.join(ROOT, "targets_hossin.json")
CACHE_MAX_AGE_DAYS = 7
CUTOFF = datetime(2020, 1, 1, tzinfo=timezone.utc)
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
            print(f"another hossin fetcher running (pid {pid}), exiting")
            sys.exit(0)
        except (ValueError, ProcessLookupError, PermissionError):
            pass
    open(LOCK, "w").write(str(os.getpid()))


def list_world(w):
    """All territory-control instances for a world, paginated back to CUTOFF."""
    all_d = []
    page = 1
    while True:
        d = get(f"{BASE}/instances/territory-control"
                f"?world={w}&pageSize={LIST_PAGE}&sortBy=timeStarted"
                f"&order=desc&page={page}", retries=LIST_RETRIES)
        if not d:
            break
        all_d.extend(d)
        oldest = min(a["timeStarted"] for a in d)
        if len(d) < LIST_PAGE or oldest < "2020-01-01":
            break
        page += 1
        time.sleep(SLEEP)
    return all_d


def load_cached_targets():
    """Target instance IDs per world, if the cache is fresh enough."""
    if not os.path.exists(TARGETS_CACHE):
        return None
    try:
        c = json.load(open(TARGETS_CACHE))
        age_days = (datetime.now(timezone.utc) -
                    datetime.fromisoformat(c["listed_at"])).days
        if age_days <= CACHE_MAX_AGE_DAYS:
            return c["targets"]
        print(f"target cache stale ({age_days}d), re-listing", flush=True)
    except Exception as e:
        print(f"target cache unreadable ({e}), re-listing", flush=True)
    return None


def save_cached_targets(targets):
    json.dump({"listed_at": datetime.now(timezone.utc).isoformat(),
               "targets": targets},
              open(TARGETS_CACHE, "w"))
    print(f"saved {sum(len(v) for v in targets.values())} targets to cache",
          flush=True)


def main():
    os.makedirs(DATA, exist_ok=True)
    lock()
    try:
        prog = json.load(open(PROG)) if os.path.exists(PROG) else {}
        if prog.get("complete"):
            # verify against the target cache: a previous pass may have marked
            # complete while some alerts failed
            missing = None
            tbw = load_cached_targets()
            if tbw:
                targets_all = [iid for w in WORLDS
                               for iid in tbw.get(str(w), [])]
                on_disk = {f[:-5] for f in os.listdir(DATA)
                           if f.endswith(".json")}
                missing = [iid for iid in targets_all if iid not in on_disk]
            if not missing:
                print("hossin fetch already complete")
                return
            print(f"complete flag set but {len(missing)} targets missing "
                  f"from disk; resuming", flush=True)
            prog["complete"] = False
        done = prog.get("done", {})
        existing = {f[:-5] for f in os.listdir(DATA) if f.endswith(".json")}
        targets_by_world = load_cached_targets()
        if targets_by_world is None:
            targets_by_world = {}
            try:
                for w in WORLDS:
                    d = list_world(w)
                    filt = [a["instanceId"] for a in d
                            if a.get("state") == 2 and a.get("duration") == 5400000
                            and a.get("zone") == ZONE
                            and datetime.fromisoformat(
                                a["timeStarted"].replace("Z", "+00:00")) >= CUTOFF]
                    print(f"world {w}: {len(filt)} hossin alerts in window",
                          flush=True)
                    targets_by_world[str(w)] = filt
                    time.sleep(SLEEP)
            except RuntimeError as e:
                # listing failed even after retries; fall back to any cache,
                # even stale, rather than losing the run
                print(f"listing failed ({e}); trying stale cache", flush=True)
                targets_by_world = None
                if os.path.exists(TARGETS_CACHE):
                    try:
                        targets_by_world = json.load(
                            open(TARGETS_CACHE))["targets"]
                        print("using stale target cache", flush=True)
                    except Exception:
                        pass
                if not targets_by_world:
                    raise
            save_cached_targets(targets_by_world)
        targets = [iid for w in WORLDS for iid in
                   targets_by_world.get(str(w), [])]
        todo = [iid for iid in targets
                if iid not in done and iid not in existing]
        print(f"total {len(targets)}, already have {len(targets)-len(todo)}, "
              f"todo {len(todo)}", flush=True)
        new = 0
        failed = []
        for i, iid in enumerate(todo):
            try:
                fac = get(f"{BASE}/instance-entries/{iid}/facility"
                          f"?pageSize=2000&sortBy=timestamp&order=asc")
                time.sleep(SLEEP)
                pop = get(f"{BASE}/aggregates/instance/{iid}/population"
                          f"?pageSize=500&sortBy=timestamp&order=asc")
                time.sleep(SLEEP)
                inst = get(f"{BASE}/instances/{iid}")
                time.sleep(SLEEP)
                rec = {"instance": inst, "facility": fac, "population": pop}
                with open(os.path.join(DATA, f"{iid}.json"), "w") as f:
                    json.dump(rec, f)
                done[iid] = True
                new += 1
                if new % 25 == 0:
                    json.dump({"done": done}, open(PROG, "w"))
                    print(f"  progress {new}/{len(todo)}", flush=True)
            except Exception as e:
                print(f"  FAILED {iid}: {e}", flush=True)
                failed.append(iid)
        if failed:
            json.dump({"done": done, "complete": False, "failed": failed},
                      open(PROG, "w"))
            print(f"HOSSIN PASS DONE: {new} new, {len(failed)} failed "
                  f"(will retry next pass)", flush=True)
        else:
            json.dump({"done": done, "complete": True}, open(PROG, "w"))
            print(f"HOSSIN COMPLETE: {new} new alerts")
    finally:
        if os.path.exists(LOCK):
            os.remove(LOCK)


if __name__ == "__main__":
    main()
