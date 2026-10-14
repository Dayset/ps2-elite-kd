#!/usr/bin/env python3
"""Multi-continent fetcher for PS2polymarket — extends the Hossin dataset.

Scope: completed 90-min territory alerts on Indar (2), Amerish (6),
Esamir (8), Oshur (344); worlds 1/10/13/17/19/40; all history back to
2021 (ps2alerts' earliest data). Skips alerts already in data/alerts/
(files are keyed by instance ID, so Hossin files never collide).

Same polite pattern as fetch_hossin.py: ~1.2s between calls, retries,
lockfile, checkpointing, 7-day target cache. The listing endpoint accepts
a zone filter, so listing runs per (world, zone).

Usage:
  python3 fetch_continents.py --list-only   # target listing, no downloads
  python3 fetch_continents.py               # full fetch (uses/refreshes cache)
"""
import json, os, sys, time, urllib.request
from datetime import datetime, timezone

ROOT = os.path.expanduser("~/workspace/ps2polymarket")
DATA = os.path.join(ROOT, "data", "alerts")
PROG = os.path.join(ROOT, "progress_continents.json")
LOCK = os.path.join(ROOT, "fetch_continents.lock")
BASE = "https://api.ps2alerts.com"
UA = {"User-Agent": "ps2polymarket-research/0.1 (continent-models; ~1 req/s)"}
WORLDS = [1, 10, 13, 17, 19, 40]
ZONES = {2: "Indar", 6: "Amerish", 8: "Esamir", 344: "Oshur"}
LIST_PAGE = 25
LIST_RETRIES = 6
TARGETS_CACHE = os.path.join(ROOT, "targets_continents.json")
CACHE_MAX_AGE_DAYS = 7
CUTOFF = datetime(2020, 1, 1, tzinfo=timezone.utc)
SLEEP = 1.2
DUR_90MIN_MS = 5400000


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


def _pid_is_our_script(pid, marker):
    """True if pid exists AND its cmdline names our script.

    os.kill(pid, 0) alone can't tell a live script from an unrelated
    process that recycled the PID after a VM replacement -- that race
    silently stalls the fetch (lockfile looks valid, nothing is running).
    """
    try:
        os.kill(pid, 0)
    except (ProcessLookupError, PermissionError):
        return False
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            cmdline = f.read().replace(b"\0", b" ").decode(errors="replace")
    except FileNotFoundError:
        return False
    return marker in cmdline


def lock():
    if os.path.exists(LOCK):
        try:
            pid = int(open(LOCK).read().strip())
        except ValueError:
            pid = None
        if pid and _pid_is_our_script(pid, "fetch_continents"):
            print(f"another continents fetcher running (pid {pid}), exiting")
            sys.exit(0)
        print(f"stale lockfile (pid {pid}), taking over", flush=True)
    open(LOCK, "w").write(str(os.getpid()))


def list_targets(world, zone):
    """Completed 90-min territory alerts for one (world, zone), paginated."""
    out = []
    page = 1
    while True:
        d = get(f"{BASE}/instances/territory-control"
                f"?world={world}&zone={zone}&pageSize={LIST_PAGE}"
                f"&sortBy=timeStarted&order=desc&page={page}",
                retries=LIST_RETRIES)
        if not d:
            break
        for a in d:
            ts = a.get("timeStarted", "")
            if (a.get("state") == 2 and a.get("duration") == DUR_90MIN_MS
                    and ts >= "2020-01-01"):
                out.append(a["instanceId"])
        oldest = min(a["timeStarted"] for a in d)
        if len(d) < LIST_PAGE or oldest < "2020-01-01":
            break
        page += 1
        time.sleep(SLEEP)
    return out


def load_cached_targets():
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
    total = sum(len(v) for w in targets.values() for v in w.values())
    print(f"saved {total} targets to cache", flush=True)


def build_targets():
    """List all (world, zone) targets. Returns {world: {zone: [iids]}}.
    Resilient: a flaky stream doesn't kill the whole listing; failed
    (world, zone) pairs are retried in later rounds."""
    cached = load_cached_targets()
    if cached is not None:
        return cached
    targets = {str(w): {} for w in WORLDS}
    pending = [(w, z) for w in WORLDS for z in ZONES]
    for round_no in range(1, 4):
        if not pending:
            break
        print(f"listing round {round_no}: {len(pending)} streams pending",
              flush=True)
        still_pending = []
        for w, z in pending:
            zname = ZONES[z]
            try:
                iids = list_targets(w, z)
                targets[str(w)][str(z)] = iids
                print(f"world {w} {zname} ({z}): {len(iids)} alerts",
                      flush=True)
            except RuntimeError as e:
                print(f"world {w} {zname} ({z}): FAILED ({e}), "
                      f"will retry", flush=True)
                still_pending.append((w, z))
            time.sleep(SLEEP)
        pending = still_pending
        if pending:
            print(f"waiting 60s before retry round", flush=True)
            time.sleep(60)
    if pending:
        # last resort: stale cache for the missing streams
        print(f"{len(pending)} streams still failing; trying stale cache",
              flush=True)
        if os.path.exists(TARGETS_CACHE):
            try:
                old = json.load(open(TARGETS_CACHE))["targets"]
                for w, z in pending:
                    v = old.get(str(w), {}).get(str(z))
                    if v:
                        targets[str(w)][str(z)] = v
                        print(f"  used stale cache for world {w} zone {z}",
                              flush=True)
                pending = [(w, z) for w, z in pending
                           if str(z) not in targets.get(str(w), {})]
            except Exception:
                pass
        if pending:
            raise RuntimeError(
                f"could not list {len(pending)} streams: {pending}")
    save_cached_targets(targets)
    return targets


def main():
    list_only = "--list-only" in sys.argv
    os.makedirs(DATA, exist_ok=True)
    if not list_only:
        lock()
    try:
        targets = build_targets()
        total = sum(len(v) for w in targets.values() for v in w.values())
        print(f"TOTAL TARGETS: {total}", flush=True)
        for z, zname in ZONES.items():
            n = sum(len(targets.get(str(w), {}).get(str(z), []))
                    for w in WORLDS)
            print(f"  {zname}: {n}", flush=True)
        if list_only:
            return
        prog = json.load(open(PROG)) if os.path.exists(PROG) else {}
        if prog.get("complete"):
            on_disk = {f[:-5] for f in os.listdir(DATA)
                       if f.endswith(".json")}
            missing = [iid for w in targets.values() for v in w.values()
                       for iid in v if iid not in on_disk]
            if not missing:
                print("continents fetch already complete")
                return
            print(f"complete flag set but {len(missing)} targets missing; "
                  f"resuming", flush=True)
            prog["complete"] = False
        done = prog.get("done", {})
        existing = {f[:-5] for f in os.listdir(DATA) if f.endswith(".json")}
        todo = [iid for w in targets.values() for v in w.values()
                for iid in v if iid not in done and iid not in existing]
        print(f"already have {total - len(todo)}, todo {len(todo)}",
              flush=True)
        new = 0
        failed = []
        for iid in todo:
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
            print(f"CONTINENTS PASS DONE: {new} new, {len(failed)} failed",
                  flush=True)
        else:
            json.dump({"done": done, "complete": True}, open(PROG, "w"))
            print(f"CONTINENTS COMPLETE: {new} new alerts")
    finally:
        if not list_only and os.path.exists(LOCK):
            os.remove(LOCK)


if __name__ == "__main__":
    main()
