#!/usr/bin/env python3
"""Pre-alert map state poller — captures facility ownership BEFORE alerts start.

Polls Census Map API every 60s for all servers and zones.
ps2alerts only records DURING alerts; this builds the pre-alert baseline.

Output: data/map_snapshots/<world>/<zone>/<YYYY-MM-DD>.jsonl
Each line: {"ts": iso, "world": id, "zone": id, "facilities": {region_id: faction_id}}
"""
import json, os, sys, time, urllib.request
from datetime import datetime, timezone, timedelta

ROOT = os.path.expanduser("~/workspace/ps2polymarket")
OUT = os.path.join(ROOT, "data", "map_snapshots")
LOG = os.path.join(ROOT, "logs", "map_poller.log")
LOCK = os.path.join(ROOT, "map_poller.lock")
DARK_STATE = os.path.join(ROOT, "dark_worlds.json")

# Public PC servers per Census /world (verified 2026-10-18): 1 Osprey,
# 10 Wainwright, 25 Briggs, 40 SolTech. 19 is Jaeger (private events server,
# usually empty) and was tracked by mistake under the name "Emerald".
WORLDS = [1, 10, 25, 40]
ZONES = [2, 4, 6, 8, 344]  # Indar, Hossin, Amerish, Esamir, Oshur
INTERVAL = 60
# Census sometimes serves empty map data for a whole world (w13 Cobalt and
# w17 Emerald went dark 2026-10-04). Probing them every 60s wastes a third
# of our Census quota, so dark worlds are re-probed at this low cadence and
# resume full cadence automatically on recovery.
DARK_PROBE_INTERVAL = 1800
UA = {"User-Agent": "ps2polymarket-monitor/0.1 (pre-alert-research; 30 req/min)"}
# Census service ID: env var wins; default is the project's own public ID
# (never the throttled demo ID s:example, ~10 req/min).
SERVICE_ID = os.environ.get("CENSUS_SERVICE_ID", "daysetps2legends").removeprefix("s:")
BASE = f"https://census.daybreakgames.com/s:{SERVICE_ID}/get/ps2:v2/map/"


def load_dark():
    """Worlds Census is serving empty map data for: {world: next_probe_iso}."""
    try:
        d = json.load(open(DARK_STATE))
        return {int(k): v for k, v in d.items()}
    except Exception:
        return {}


def save_dark(d):
    try:
        with open(DARK_STATE, "w") as f:
            json.dump({str(k): v for k, v in d.items()}, f)
    except Exception:
        pass


def log(msg):
    ts = datetime.now(timezone.utc).isoformat()
    line = f"[{ts}] {msg}"
    # NOTE: no print() here — stdout is redirected into this same file by the
    # launch path (nohup >> logs/....log 2>&1), so printing would double every line.
    try:
        with open(LOG, "a") as f:
            f.write(line + "\n")
    except:
        pass


def get(url, retries=3):
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            log(f"  retry {i+1}: {e} {url[:60]}")
            time.sleep(3 * (i + 1))
    return None


def poll_once():
    ts = datetime.now(timezone.utc)
    date_str = ts.strftime("%Y-%m-%d")
    ts_iso = ts.isoformat()
    dark = load_dark()
    ok = 0
    fail = 0
    skipped = 0

    for world in WORLDS:
        probe_at = dark.get(world)
        if probe_at:
            try:
                if ts < datetime.fromisoformat(probe_at):
                    skipped += len(ZONES)
                    continue
            except ValueError:
                pass
        world_dark = False
        for zone in ZONES:
            url = f"{BASE}?world_id={world}&zone_ids={zone}"
            data = get(url)
            if data is None or "map_list" not in data:
                fail += 1
                continue
            if not data["map_list"]:
                # Census-side outage for this whole world (empty map_list),
                # not a transient blip: mark dark and re-probe later.
                dark[world] = (ts + timedelta(seconds=DARK_PROBE_INTERVAL)).isoformat()
                save_dark(dark)
                log(f"world {world} map data dark on Census (empty map_list); re-probing in {DARK_PROBE_INTERVAL // 60}m")
                fail += 1
                world_dark = True
                break
            try:
                rows = data["map_list"][0]["Regions"]["Row"]
                facilities = {}
                for row in rows:
                    rd = row["RowData"]
                    facilities[rd["RegionId"]] = rd["FactionId"]

                outdir = os.path.join(OUT, str(world), str(zone))
                os.makedirs(outdir, exist_ok=True)
                path = os.path.join(outdir, f"{date_str}.jsonl")
                rec = {"ts": ts_iso, "world": world, "zone": zone,
                       "facilities": facilities}
                with open(path, "a") as f:
                    f.write(json.dumps(rec) + "\n")
                ok += 1
            except Exception as e:
                log(f"  parse error w{world} z{zone}: {e}")
                fail += 1
            # Small delay between requests to stay polite
            time.sleep(1.5)
        if not world_dark and world in dark:
            del dark[world]
            save_dark(dark)
            log(f"world {world} map data back on Census; full cadence resumed")

    log(f"cycle done: {ok} ok, {fail} failed, {skipped} skipped (Census-dark)")
    return ok, fail


def _pid_is_our_script(pid, marker):
    """True if pid exists AND its cmdline names our script.

    os.kill(pid, 0) alone can't tell a live poller from an unrelated
    process that recycled the PID after a VM replacement -- that race
    makes a relaunch exit quietly while nothing is actually running.
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


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true", help="single poll cycle then exit (for cron)")
    args = ap.parse_args()

    # Lockfile: don't run twice. The PID in the lockfile is verified
    # against /proc/<pid>/cmdline because os.kill(pid, 0) alone trusts
    # recycled PIDs after a VM replacement (silent stall: lockfile looks
    # valid, nothing is actually running).
    if os.path.exists(LOCK):
        try:
            pid = int(open(LOCK).read().strip())
        except ValueError:
            pid = None
        if pid and _pid_is_our_script(pid, "map_poller"):
            print(f"map_poller already running (pid {pid})", flush=True)
            sys.exit(0)
        print(f"stale map_poller lockfile (pid {pid}), taking over", flush=True)
    with open(LOCK, "w") as f:
        f.write(str(os.getpid()))

    os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
    log("map_poller started" + (" (once)" if args.once else ""))
    try:
        if args.once:
            poll_once()
        else:
            backoff = 5
            while True:
                start = time.time()
                try:
                    ok, fail = poll_once()
                    backoff = 5  # reset after a clean cycle
                    if ok == 0 and fail > 0:
                        # Total outage (e.g. proxy throttling every request):
                        # hammering retries only feeds it. Back off before
                        # the next cycle; collection resumes on its own.
                        log("all requests failed this cycle; cooling down 120s")
                        time.sleep(120)
                except Exception as e:
                    # A Census blip must never kill the loop outright —
                    # back off and retry instead of exiting (census_events.py
                    # already does this; map_poller did not, which is why the
                    # watchdog kept finding it dead after bad API responses).
                    log(f"cycle error: {e}, retry in {backoff}s")
                    time.sleep(backoff)
                    backoff = min(backoff * 2, 300)
                    continue
                elapsed = time.time() - start
                sleep_for = max(5, INTERVAL - elapsed)
                time.sleep(sleep_for)
    finally:
        try:
            os.unlink(LOCK)
        except:
            pass


if __name__ == "__main__":
    main()
