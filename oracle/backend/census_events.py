#!/usr/bin/env python3
"""Pre-alert conditions monitor — live Census event stream aggregator.

Connects to Census WebSocket (direct, no third-party dependency) and aggregates:
- Death events -> faction KD, KPM, unique active players, class usage (via loadout_id)
- FacilityControl -> real-time base flips (lower latency than ps2alerts)
- MetagameEvent -> alert start/end tagging (pre-alert vs during-alert)

Output: data/census_events/<world>/<YYYY-MM-DD>.jsonl
Each line: one 60s aggregation window per world.

Population note: Census has no direct pop endpoint. We count unique character_ids
in Death events per 5-min window as "active fighters" — a useful proxy, not total
online. Documented limitation.
"""
import json, os, sys, time, asyncio, urllib.request
from datetime import datetime, timezone
from collections import defaultdict

ROOT = os.path.expanduser("~/workspace/ps2polymarket")
OUT = os.path.join(ROOT, "data", "census_events")
LOG = os.path.join(ROOT, "logs", "census_events.log")
LOCK = os.path.join(ROOT, "census_events.lock")

WORLDS = [1, 10, 19, 25]
INTERVAL = 60
UA = "ps2polymarket-monitor/0.1 (pre-alert-research; census-direct)"
WS_URL = "wss://push.planetside2.com/streaming?environment=ps2&service-id=s:example"

# Loadout ID -> class name (covers VS/NC/TR; NSO loadouts map to same classes)
LOADOUT_CLASS = {
    1: "infiltrator", 3: "light_assault", 4: "combat_medic",
    5: "engineer", 6: "heavy_assault", 7: "max",
    8: "infiltrator", 10: "light_assault", 11: "combat_medic",
    12: "engineer", 13: "heavy_assault", 14: "max",
    15: "infiltrator", 17: "light_assault", 18: "combat_medic",
    19: "engineer", 20: "heavy_assault", 21: "max",
    # NSO common pool
    28: "infiltrator", 29: "light_assault", 30: "combat_medic",
    31: "engineer", 32: "heavy_assault", 45: "max",
}
FACTION = {"1": "vs", "2": "nc", "3": "tr", "4": "ns"}


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


class Aggregator:
    def __init__(self):
        self.reset()
        # Per-character tracking persists across reset() (full alert/session).
        # 2026-10-12: Dayset — "just log everything for later to clarify if
        # the player is top legit or cheater." Full distribution, not just outliers.
        self.char_kills = defaultdict(int)  # (w, z, char_id) -> kills
        self.char_deaths = defaultdict(int)  # (w, z, char_id) -> deaths
        self.char_first_seen = {}  # (w, z, char_id) -> timestamp (for KPM)
        self.char_faction = {}  # (w, z, char_id) -> faction

    def reset(self):
        # (world, zone, faction) -> stats
        self.kills = defaultdict(int)
        self.deaths = defaultdict(int)
        self.players = defaultdict(set)  # unique character_ids
        self.classes = defaultdict(lambda: defaultdict(int))  # (w,z,f) -> class -> count
        self.flips = []  # FacilityControl events
        self.alerts = []  # MetagameEvent
        self.event_count = 0
        # Per-character tracking for outlier detection (cheater logging)
        # 2026-10-12: Dayset — log crazy high KD/KPM players as context
        # for why predictions miss ("we deal with whatever we have")
        # NOTE: char_* is NOT reset here — it persists across the full alert
        # so KPM and kill counts reflect the whole session, not a 60s window.
        # Initialized in __init__ only; cleaned by age in snapshot().
        pass

    def on_death(self, p):
        try:
            w = int(p.get("world_id", 0))
            z = int(p.get("zone_id", 0))
            atk_f = FACTION.get(str(p.get("attacker_team_id")), "?")
            vic_f = FACTION.get(str(p.get("team_id")), "?")
            if w not in WORLDS:
                return
            self.event_count += 1
            ts = p.get("timestamp")
            # Attacker gets a kill
            if atk_f in ("vs", "nc", "tr"):
                self.kills[(w, z, atk_f)] += 1
                cid = p.get("attacker_character_id")
                if cid and cid != "0":
                    self.players[(w, z, atk_f)].add(cid)
                    # Per-character tracking for outlier detection
                    key = (w, z, str(cid))
                    self.char_kills[key] += 1
                    self.char_faction[key] = atk_f
                    if key not in self.char_first_seen and ts:
                        self.char_first_seen[key] = ts
                cls = LOADOUT_CLASS.get(int(p.get("attacker_loadout_id", 0)))
                if cls:
                    self.classes[(w, z, atk_f)][cls] += 1
            # Victim gets a death
            if vic_f in ("vs", "nc", "tr"):
                self.deaths[(w, z, vic_f)] += 1
                cid = p.get("character_id")
                if cid and cid != "0":
                    self.players[(w, z, vic_f)].add(cid)
                    key = (w, z, str(cid))
                    self.char_deaths[key] += 1
                    self.char_faction[key] = vic_f
                    if key not in self.char_first_seen and ts:
                        self.char_first_seen[key] = ts
        except (ValueError, TypeError):
            pass

    def flag_outliers(self, kd_thresh=5.0, kpm_early=2.0, kpm_sure=3.0, min_kills=20):
        """Flag characters with extreme KD or KPM.
        Returns list of {char_id, world, zone, faction, kills, deaths, kd, kpm, severity}.
        Severity: "early" (KD>=5 and KPM>=2) or "confirmed" (KD>=5 and KPM>=3).
        2026-10-12: Dayset — two-tier: "KD 5 and 2 KPM is an early sign then
        KD 5 and 3 KPM to make it sure". Log as context for prediction misses.
        """
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        out = []
        for (w, z, cid), kills in self.char_kills.items():
            if kills < min_kills:
                continue
            deaths = self.char_deaths.get((w, z, cid), 0)
            kd = kills / max(1, deaths)
            # KPM: kills per minute since first seen
            # Census ESS 'timestamp' is epoch seconds (int or digit string),
            # not ISO — 2026-10-12 fix: parse epoch, else ISO fallback.
            first = self.char_first_seen.get((w, z, cid))
            kpm = 0
            if first:
                try:
                    fs = str(first).strip()
                    if fs.replace(".", "", 1).isdigit():
                        dt = datetime.fromtimestamp(float(fs), tz=timezone.utc)
                    else:
                        dt = datetime.fromisoformat(fs.replace('Z', '+00:00'))
                    mins = max(1, (now - dt).total_seconds() / 60)
                    kpm = kills / mins
                except (ValueError, TypeError):
                    pass
            # Two-tier: both KD and KPM must clear the bar (AND, not OR)
            severity = None
            if kd >= kd_thresh and kpm >= kpm_sure:
                severity = "confirmed"
            elif kd >= kd_thresh and kpm >= kpm_early:
                severity = "early"
            if severity:
                out.append({
                    "char_id": cid,
                    "world": w,
                    "zone": z,
                    "faction": self.char_faction.get((w, z, cid), "?"),
                    "kills": kills,
                    "deaths": deaths,
                    "kd": round(kd, 2),
                    "kpm": round(kpm, 2),
                    "severity": severity,
                })
        out.sort(key=lambda x: (-x["kd"], -x["kpm"]))
        return out

    def on_flip(self, p):
        self.flips.append({
            "ts": p.get("timestamp"),
            "world": p.get("world_id"),
            "zone": p.get("zone_id"),
            "facility": p.get("facility_id"),
            "old": FACTION.get(str(p.get("old_faction_id")), "?"),
            "new": FACTION.get(str(p.get("new_faction_id")), "?"),
            "duration_held": p.get("duration_held"),
        })

    def on_metagame(self, p):
        self.alerts.append({
            "ts": p.get("timestamp"),
            "world": p.get("world_id"),
            "zone": p.get("zone_id"),
            "event_id": p.get("metagame_event_id"),
            "instance_id": p.get("instance_id"),
            "state": p.get("metagame_event_state_name"),
        })
        log(f"  MetagameEvent: world={p.get('world_id')} zone={p.get('zone_id')} "
            f"state={p.get('metagame_event_state_name')} instance={p.get('instance_id')}")

    def snapshot(self):
        ts = datetime.now(timezone.utc)
        date_str = ts.strftime("%Y-%m-%d")
        results = []
        # Group by world. Worlds with alerts/flips but no kills this window
        # must still get a record -- otherwise MetagameEvents (alert
        # start/end) are silently dropped and the alert stays invisible
        # to the live push (seen 2026-10-09: SolTech Indar start lost).
        worlds = set(k[0] for k in list(self.kills.keys()) + list(self.deaths.keys()))
        for ev in list(self.alerts) + list(self.flips):
            try:
                w = int(ev.get("world"))
            except (TypeError, ValueError):
                continue
            if w in WORLDS:
                worlds.add(w)
        for w in sorted(worlds):
            rec = {
                "window_start": (ts.isoformat()),
                "world": w,
                "total_events": self.event_count,
                "factions": {},
                "zones": {},
            }
            for f in ("vs", "nc", "tr"):
                k = sum(v for (ww, zz, ff), v in self.kills.items() if ww == w and ff == f)
                d = sum(v for (ww, zz, ff), v in self.deaths.items() if ww == w and ff == f)
                players = set()
                for (ww, zz, ff), s in self.players.items():
                    if ww == w and ff == f:
                        players |= s
                cls = defaultdict(int)
                for (ww, zz, ff), c in self.classes.items():
                    if ww == w and ff == f:
                        for cn, cv in c.items():
                            cls[cn] += cv
                rec["factions"][f] = {
                    "kills": k, "deaths": d,
                    "kd": round(k / max(1, d), 3),
                    "kpm": round(k / (INTERVAL / 60), 2),
                    "active_players": len(players),
                    "class_usage": dict(cls),
                }
            # Per-zone breakdown
            zones = set(k[1] for k in list(self.kills.keys()) if k[0] == w)
            for z in sorted(zones):
                zrec = {}
                for f in ("vs", "nc", "tr"):
                    k = self.kills.get((w, z, f), 0)
                    d = self.deaths.get((w, z, f), 0)
                    # Phase 1 roster logging: persist the char IDs this window
                    # already collected (capped). Additive key; readers ignore it.
                    pids = sorted(self.players.get((w, z, f), ()))[:150]
                    zrec[f] = {"kills": k, "deaths": d,
                               "kd": round(k / max(1, d), 3),
                               "players": pids}
                rec["zones"][str(z)] = zrec

            # Outlier players (cheater detection) per zone/faction
            # 2026-10-12: Dayset — show ⚠️☠️⚠️ when crazy raging cheater detected
            # Two-tier: "early" (KD>=5, KPM>=2) vs "confirmed" (KD>=5, KPM>=3)
            outliers = self.flag_outliers()
            rec["outliers"] = [
                {"zone": o["zone"], "faction": o["faction"].upper(),
                 "kd": o["kd"], "kpm": o["kpm"], "kills": o["kills"],
                 "severity": o["severity"]}
                for o in outliers if o["world"] == w
            ]

            rec["flips"] = [f for f in self.flips if str(f.get("world")) == str(w)]
            rec["alert_events"] = [a for a in self.alerts if str(a.get("world")) == str(w)]

            outdir = os.path.join(OUT, str(w))
            os.makedirs(outdir, exist_ok=True)
            path = os.path.join(outdir, f"{date_str}.jsonl")
            with open(path, "a") as fh:
                fh.write(json.dumps(rec) + "\n")
            results.append((w, rec))

        # Log ALL per-character stats for later legit-vs-cheater analysis.
        # 2026-10-12: Dayset — "just log everything for later to clarify if
        # the player is top legit or cheater." Full distribution, not just outliers.
        self._log_all_players(date_str, ts)

        return results

    def _log_all_players(self, date_str, ts):
        """Write every tracked character's KD/KPM to data/player_stats/.
        Runs each snapshot (60s); data accumulates across the alert since
        char_* is not reset. Overwrites per (date, char) — latest wins.
        """
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        outdir = os.path.join(os.path.dirname(OUT), "player_stats")
        os.makedirs(outdir, exist_ok=True)
        path = os.path.join(outdir, f"{date_str}.jsonl")
        # Build full player records
        records = []
        for (w, z, cid), kills in self.char_kills.items():
            deaths = self.char_deaths.get((w, z, cid), 0)
            kd = kills / max(1, deaths)
            first = self.char_first_seen.get((w, z, cid))
            kpm = 0
            mins_observed = 0
            if first:
                try:
                    fs = str(first).strip()
                    if fs.replace(".", "", 1).isdigit():
                        dt = datetime.fromtimestamp(float(fs), tz=timezone.utc)
                    else:
                        dt = datetime.fromisoformat(fs.replace('Z', '+00:00'))
                    mins_observed = (now - dt).total_seconds() / 60
                    if mins_observed >= 1:
                        kpm = kills / mins_observed
                except (ValueError, TypeError):
                    pass
            # Only log players with meaningful activity (5+ kills)
            if kills >= 5:
                records.append({
                    "ts": ts.isoformat(),
                    "world": w, "zone": z,
                    "char_id": cid,
                    "faction": self.char_faction.get((w, z, cid), "?"),
                    "kills": kills, "deaths": deaths,
                    "kd": round(kd, 2), "kpm": round(kpm, 2),
                    "mins_observed": round(mins_observed, 1),
                })
        # Append (not overwrite) — each snapshot adds a timestamped row;
        # later analysis picks the latest per char per alert.
        if records:
            with open(path, "a") as fh:
                for r in records:
                    fh.write(json.dumps(r) + "\n")


async def run_stream(agg, duration=None):
    import websockets
    proxy_url = os.environ.get("https_proxy") or os.environ.get("HTTPS_PROXY")

    kwargs = {"user_agent_header": UA, "open_timeout": 20}
    if proxy_url:
        kwargs["proxy"] = proxy_url

    async with websockets.connect(WS_URL, **kwargs) as ws:
        log("Census WebSocket connected")
        await ws.send(json.dumps({
            "service": "event", "action": "subscribe",
            "worlds": ["all"],
            "eventNames": ["FacilityControl", "MetagameEvent"]}))
        await ws.send(json.dumps({
            "service": "event", "action": "subscribe",
            "characters": ["all"], "eventNames": ["PlayerLogout", "PlayerLogin"]}))
        log("subscribed: FacilityControl + MetagameEvent + PlayerLogout/Login (no Death)")

        last_save = time.time()
        start_t = time.time()
        while True:
            if duration and (time.time() - start_t >= duration):
                break
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=30)
            except asyncio.TimeoutError:
                continue
            try:
                d = json.loads(msg)
            except:
                continue
            p = d.get("payload", {})
            et = p.get("event_name")
            if et == "FacilityControl":
                agg.on_flip(p)
            elif et == "MetagameEvent":
                agg.on_metagame(p)
            elif et == "PlayerLogout":
                # Auth: detect logout completing a challenge sequence
                # 2026-10-12: PlayerLogout payload has character_id
                try:
                    cid = str(p.get("character_id", ""))
                    if cid and cid != "0":
                        import auth_challenge
                        import datetime
                        ts = p.get("timestamp")
                        try:
                            dt = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
                            event_ts = dt.timestamp()
                        except:
                            event_ts = time.time()
                        verified = auth_challenge.record_logout(cid, event_ts)
                        if verified:
                            log(f"auth: challenge {verified[:8]}... VERIFIED for character {cid}")
                except Exception:
                    pass

            if time.time() - last_save >= INTERVAL:
                results = agg.snapshot()
                total_k = sum(r[1]["factions"]["vs"]["kills"] + r[1]["factions"]["nc"]["kills"] + r[1]["factions"]["tr"]["kills"] for r in results)
                log(f"window saved: {len(results)} worlds, {total_k} kills, "
                    f"{len(agg.flips)} flips, {len(agg.alerts)} alert events")
                agg.reset()
                last_save = time.time()

        # save any partial window on exit (for --once mode)
        if duration:
            results = agg.snapshot()
            if results:
                total_k = sum(r[1]["factions"]["vs"]["kills"] + r[1]["factions"]["nc"]["kills"] + r[1]["factions"]["tr"]["kills"] for r in results)
                log(f"final window saved: {len(results)} worlds, {total_k} kills")


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
    ap.add_argument("--once", action="store_true", help="collect ~50s then exit (for cron)")
    args = ap.parse_args()

    # Lockfile: don't run twice. PID verified against /proc/<pid>/cmdline --
    # os.kill(pid, 0) alone trusts recycled PIDs after a VM replacement.
    if os.path.exists(LOCK):
        try:
            pid = int(open(LOCK).read().strip())
        except ValueError:
            pid = None
        if pid and _pid_is_our_script(pid, "census_events"):
            print(f"census_events already running (pid {pid})", flush=True)
            sys.exit(0)
        print(f"stale census_events lockfile (pid {pid}), taking over", flush=True)
    with open(LOCK, "w") as f:
        f.write(str(os.getpid()))

    os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
    log("census_events started" + (" (once)" if args.once else ""))

    if args.once:
        try:
            agg = Aggregator()
            asyncio.run(run_stream(agg, duration=50))
        except Exception as e:
            log(f"once run error: {e}")
        finally:
            try:
                os.unlink(LOCK)
            except:
                pass
        return

    backoff = 5
    try:
        while True:
            try:
                agg = Aggregator()
                asyncio.run(run_stream(agg))
                backoff = 5
            except Exception as e:
                log(f"stream error: {e}, retry in {backoff}s")
                time.sleep(backoff)
                backoff = min(backoff * 2, 300)
    finally:
        try:
            os.unlink(LOCK)
        except:
            pass


if __name__ == "__main__":
    main()
