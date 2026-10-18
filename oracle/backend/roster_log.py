"""Phase 1 (log-only) roster-strength logging for the PS2MapOracle live pipeline.

Spec: ~/workspace/ps2polymarket/roster_strength_spec.md
Phase 1 = log per-faction roster-strength features per 5-min tick; no model change.

Cost model (non-negotiable):
  - 0 external calls per 5-min tick (cache + already-persisted stream data only).
  - Per alert: exactly 1 Honu roster call (/api/session/history) + bounded
    background stat-cache fills at new-alert setup time (never per tick).
  - Honu etiquette: <=60 req/min (1.1s spacing), cache-first, try/except
    everywhere so logging can never break the push.
"""

import json
import os
import sqlite3
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
LOG_PATH = os.path.join(ROOT, "roster_log.jsonl")
MAP_PATH = os.path.join(ROOT, "roster_map.json")
CACHE_PATH = os.path.join(ROOT, "roster_skill_cache.sqlite")

HONU = "https://wt.honu.pw"
REQ_SPACING = 1.1          # seconds between Honu calls (<=60/min)
CACHE_TTL = 7 * 86400      # 7-day skill cache TTL
MAX_IDS_STORED = 500       # cap on char_ids per faction per tick
PRIOR_KD, PRIOR_KPM = 1.0, 0.5
PRIOR_WEIGHT = 3600.0      # nominal 1h play-time weight for unknown chars

FACTIONS = ("VS", "NC", "TR")
FID2F = {"1": "VS", "2": "NC", "3": "TR"}          # Honu factionID -> faction
TEAM2F = {"1": "VS", "2": "NC", "3": "TR"}          # Honu session teamID -> faction
F2W = {"VS": "vs", "NC": "nc", "TR": "tr"}          # our factions -> window keys


def _log_err(msg):
    print(f"roster_log: {msg}", flush=True)


# ---------------------------------------------------------------------------
# Honu roster (1 call per alert)
# ---------------------------------------------------------------------------

def _honu_get(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": "ps2maporacle-roster/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def get_roster_meta(world, start_epoch):
    """One Honu call: all PC sessions overlapping start_epoch on world.

    Returns (roster, outfits): roster = {faction: [char_ids]},
    outfits = {char_id: outfit_id_or_None}. NSO chars are assigned by
    session teamID allegiance, else dropped. Never raises.
    """
    roster = {f: [] for f in FACTIONS}
    outfits = {}
    try:
        data = _honu_get(f"{HONU}/api/session/history/{int(start_epoch)}?worldID={int(world)}")
        rows = data.get("data", data) if isinstance(data, dict) else data
        for row in rows or []:
            ch = (row or {}).get("character") or {}
            cid = ch.get("id")
            if not cid:
                continue
            cid = str(cid)
            fac = FID2F.get(str(ch.get("factionID")))
            if fac is None:
                # NSO (factionID 4): assign by observed team allegiance, else drop
                team = (row.get("session") or {}).get("teamID")
                fac = TEAM2F.get(str(team))
                if fac is None:
                    continue
            roster[fac].append(cid)
            outfits[cid] = ch.get("outfitID")
    except Exception as e:  # never crash the caller
        _log_err(f"get_roster w{world} failed: {e}")
        return {f: [] for f in FACTIONS}, {}
    return roster, outfits


def get_roster(world, start_epoch):
    """Returns {faction: [character_ids]}. Never raises ({} factions on failure)."""
    roster, _ = get_roster_meta(world, start_epoch)
    return roster


# ---------------------------------------------------------------------------
# Skill cache (SQLite, 7-day TTL)
# ---------------------------------------------------------------------------

def _db():
    os.makedirs(os.path.dirname(CACHE_PATH) or ".", exist_ok=True)
    con = sqlite3.connect(CACHE_PATH)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute(
        "CREATE TABLE IF NOT EXISTS skill ("
        " char_id TEXT PRIMARY KEY,"
        " weapon_kills INTEGER, weapon_deaths INTEGER, weapon_play_time INTEGER,"
        " fetched_at INTEGER)"
    )
    return con


def get_skill(char_id):
    """Cached lifetime weapon stats, or None on miss/stale. Never raises."""
    try:
        con = _db()
        row = con.execute(
            "SELECT weapon_kills, weapon_deaths, weapon_play_time, fetched_at"
            " FROM skill WHERE char_id = ?", (str(char_id),)
        ).fetchone()
        con.close()
        if not row:
            return None
        wk, wd, wpt, ts = row
        if time.time() - ts > CACHE_TTL:
            return None
        return {"weapon_kills": wk, "weapon_deaths": wd, "weapon_play_time": wpt}
    except Exception as e:
        _log_err(f"get_skill failed: {e}")
        return None


def _store_skill(char_id, wk, wd, wpt):
    con = _db()
    con.execute(
        "INSERT OR REPLACE INTO skill"
        " (char_id, weapon_kills, weapon_deaths, weapon_play_time, fetched_at)"
        " VALUES (?, ?, ?, ?, ?)",
        (str(char_id), int(wk), int(wd), int(wpt), int(time.time())),
    )
    con.commit()
    con.close()


def _parse_weapon_stats(rows):
    """Extract weapon_kills/deaths/play_time (valueForever) from Honu stats rows."""
    vals = {}
    for r in rows or []:
        name = r.get("statName")
        if name in ("weapon_kills", "weapon_deaths", "weapon_play_time"):
            v = r.get("valueForever", 0)
            try:
                vals[name] = int(v)
            except (TypeError, ValueError):
                vals[name] = 0
    return (vals.get("weapon_kills", 0), vals.get("weapon_deaths", 0),
            vals.get("weapon_play_time", 0))


def fill_cache(char_ids, budget_sec=90):
    """Background filler: fetch cache misses at <=60/min within a time budget.

    Designed to run at new-alert setup (not per tick). Skips when the budget
    is exhausted. Never raises.
    """
    deadline = time.time() + max(0, budget_sec)
    todo = []
    seen = set()
    for cid in char_ids:
        cid = str(cid)
        if cid in seen:
            continue
        seen.add(cid)
        if get_skill(cid) is None:
            todo.append(cid)
    for cid in todo:
        if time.time() >= deadline:
            break
        try:
            data = _honu_get(f"{HONU}/api/character/{cid}/stats")
            rows = data.get("data", data) if isinstance(data, dict) else data
            wk, wd, wpt = _parse_weapon_stats(rows)
            _store_skill(cid, wk, wd, wpt)
        except urllib.error.HTTPError as e:
            if getattr(e, "code", None) == 429:
                _log_err("fill_cache hit 429, stopping")
                break
            _log_err(f"fill_cache {cid} failed: {e}")
        except Exception as e:
            _log_err(f"fill_cache {cid} failed: {e}")
        time.sleep(REQ_SPACING)


# ---------------------------------------------------------------------------
# Features
# ---------------------------------------------------------------------------

def compute_features(roster, live_kd, outfits=None):
    """Five per-faction features (spec §3). Unknown chars get the prior.

    roster: {faction: [char_ids]}. live_kd: {VS/NC/TR: kd}.
    outfits: {char_id: outfit_id_or_None} (chars w/o outfit => singletons).
    Returns {faction: {n, roster_kd, elite_share, outfit_conc, roster_kpm,
                       live_kd, char_ids, skill_cached}}.
    """
    outfits = outfits or {}
    out = {}
    for f in FACTIONS:
        ids = [str(c) for c in (roster.get(f) or [])]
        n = len(ids)
        kd_wsum = kpm_wsum = wsum = 0.0
        elite = 0
        ocounts = {}
        cached = 0
        # nominal weight for unknowns: faction mean cached play_time, else 1h
        known_pts = []
        skills = {}
        for cid in ids:
            s = get_skill(cid)
            skills[cid] = s
            if s:
                cached += 1
                pt = s["weapon_play_time"] or 0
                if pt > 0:
                    known_pts.append(pt)
        mean_pt = sum(known_pts) / len(known_pts) if known_pts else PRIOR_WEIGHT
        for cid in ids:
            s = skills[cid]
            if s and (s["weapon_play_time"] or 0) > 0:
                kd = s["weapon_kills"] / max(1, s["weapon_deaths"])
                w = float(s["weapon_play_time"])
                kpm = s["weapon_kills"] / (s["weapon_play_time"] / 60.0)
            elif s:
                kd, kpm, w = PRIOR_KD, PRIOR_KPM, PRIOR_WEIGHT
            else:
                kd, kpm, w = PRIOR_KD, PRIOR_KPM, mean_pt
            kd_wsum += kd * w
            kpm_wsum += kpm * w
            wsum += w
            if kd >= 2.0:
                elite += 1
            # outfit concentration: unknown outfit => singleton (dilutes, safe)
            o = outfits.get(cid)
            okey = f"oid:{o}" if o else f"cid:{cid}"
            ocounts[okey] = ocounts.get(okey, 0) + 1
        conc = sum((c / n) ** 2 for c in ocounts.values()) if n else 0.0
        out[f] = {
            "n": n,
            "roster_kd": round(kd_wsum / wsum, 3) if wsum else PRIOR_KD,
            "elite_share": round(elite / n, 3) if n else 0.0,
            "outfit_conc": round(conc, 4),
            "roster_kpm": round(kpm_wsum / wsum, 3) if wsum else PRIOR_KPM,
            "live_kd": live_kd.get(f, 1.0) if isinstance(live_kd, dict) else 1.0,
            "char_ids": sorted(ids)[:MAX_IDS_STORED],
            "skill_cached": round(cached / n, 3) if n else 0.0,
        }
    return out


# ---------------------------------------------------------------------------
# Death-stream augmentation (local only: persisted per-zone player ID lists)
# ---------------------------------------------------------------------------

def _parse_ts(s):
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


def stream_roster(world, zone, start_ts, now_ts):
    """Union of per-faction attacker/victim char IDs from persisted
    census_events windows for (world, zone) in [start_ts, now_ts].
    Zero external calls. Missing 'players' keys (old windows) => empty.
    """
    out = {f: set() for f in FACTIONS}
    try:
        days = set()
        for ts in (start_ts, now_ts):
            d = datetime.fromtimestamp(ts, timezone.utc).strftime("%F")
            days.add(d)
            days.add(datetime.fromtimestamp(ts - 86400, timezone.utc).strftime("%F"))
        for d in sorted(days):
            fn = os.path.join(ROOT, "data", "census_events", str(world), f"{d}.jsonl")
            if not os.path.exists(fn):
                continue
            with open(fn) as fh:
                for line in fh:
                    try:
                        r = json.loads(line)
                    except Exception:
                        continue
                    wts = _parse_ts(r.get("window_start", ""))
                    if not (start_ts <= wts <= now_ts):
                        continue
                    zrec = (r.get("zones") or {}).get(str(zone)) or {}
                    for f in FACTIONS:
                        for cid in (zrec.get(F2W[f]) or {}).get("players", []) or []:
                            out[f].add(str(cid))
    except Exception as e:
        _log_err(f"stream_roster failed: {e}")
    return out


# ---------------------------------------------------------------------------
# JSONL logging (§5)
# ---------------------------------------------------------------------------

def log_tick(alert_key, t, ts, features):
    """Append one JSON line per tick. features from compute_features()."""
    line = {"alert": alert_key, "t": int(t), "ts": int(ts)}
    for f in FACTIONS:
        fd = features.get(f, {})
        line[f] = {
            "n": fd.get("n", 0),
            "roster_kd": fd.get("roster_kd", PRIOR_KD),
            "elite_share": fd.get("elite_share", 0.0),
            "outfit_conc": fd.get("outfit_conc", 0.0),
            "roster_kpm": fd.get("roster_kpm", PRIOR_KPM),
            "live_kd": fd.get("live_kd", 1.0),
            "char_ids": (fd.get("char_ids") or [])[:MAX_IDS_STORED],
            "skill_cached": fd.get("skill_cached", 0.0),
        }
    with open(LOG_PATH, "a") as fh:
        fh.write(json.dumps(line, separators=(",", ":")) + "\n")


def log_final(alert_key, territory, winner):
    """Append a terminal summary line for a settled alert.

    Deviation from spec §5 (documented): §5 shows `final` inline on tick
    lines, which would require rewriting the JSONL. A dedicated summary line
    is cleaner and trivially joinable for Phase 2 training.
    """
    line = {
        "alert": alert_key,
        "type": "final",
        "ts": int(time.time()),
        "final": {
            "VS": round(float(territory.get("VS", 0)), 1),
            "NC": round(float(territory.get("NC", 0)), 1),
            "TR": round(float(territory.get("TR", 0)), 1),
            "winner": winner,
        },
    }
    with open(LOG_PATH, "a") as fh:
        fh.write(json.dumps(line, separators=(",", ":")) + "\n")


# ---------------------------------------------------------------------------
# Roster map persistence + per-tick orchestration (called by push_live_state)
# ---------------------------------------------------------------------------

def load_roster_map():
    try:
        return json.load(open(MAP_PATH))
    except Exception:
        return {}


def save_roster_map(m):
    tmp = MAP_PATH + ".tmp"
    json.dump(m, open(tmp, "w"))
    os.replace(tmp, MAP_PATH)


def _merged_roster(t0_roster, stream_ids):
    merged = {}
    for f in FACTIONS:
        ids = list(dict.fromkeys(
            [str(c) for c in t0_roster.get(f, [])] + sorted(stream_ids.get(f, ()))))
        merged[f] = ids[:MAX_IDS_STORED]
    return merged


def tick_alert(world, zone, start, t, now, state, roster_map):
    """Per-tick orchestration. Zero external calls on the tick path EXCEPT
    the one-time new-alert setup (1 roster call + bounded cache fills)."""
    eid = state["alert"]["event_id"]
    key = f"{world}-{zone}-{eid}"
    entry = roster_map.get(key)
    if entry is None:
        # new alert: the single Honu roster call + background skill fills
        roster, outfits = get_roster_meta(world, start)
        try:
            all_ids = [c for f in FACTIONS for c in roster.get(f, [])]
            fill_cache(all_ids, budget_sec=90)
        except Exception as e:
            _log_err(f"fill_cache failed: {e}")
        entry = {
            "world": world, "zone": zone, "start": start,
            "roster": roster, "outfits": outfits,
            "first_seen": int(now),
        }
        roster_map[key] = entry
    stream_ids = stream_roster(world, zone, start, now)
    merged = _merged_roster(entry.get("roster", {}), stream_ids)
    feats = compute_features(merged, state.get("kd", {}), entry.get("outfits", {}))
    log_tick(key, t, now, feats)
    entry["last_t"] = int(t)
    entry["last_territory"] = state.get("territory", {})
    entry["last_leader"] = state.get("leader")
    save_roster_map(roster_map)
    return key


def finalize_alert(key, roster_map):
    """Alert disappeared from the live sweep: write its final line, forget it."""
    entry = roster_map.pop(key, None)
    if entry is None:
        return
    terr = entry.get("last_territory") or {}
    winner = entry.get("last_leader")
    if not winner and terr:
        winner = max(terr, key=lambda f: terr.get(f, 0))
    log_final(key, terr, winner or "?")
    save_roster_map(roster_map)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["fill", "tick-test"])
    ap.add_argument("--ids", default="")
    ap.add_argument("--budget", type=int, default=120)
    a = ap.parse_args()
    if a.cmd == "fill":
        fill_cache([c for c in a.ids.split(",") if c], budget_sec=a.budget)
    elif a.cmd == "tick-test":
        feats = compute_features(
            {"VS": ["1", "2"], "NC": ["3"], "TR": []},
            {"VS": 1.1, "NC": 0.9, "TR": 1.0},
            {"1": "abc", "2": "abc", "3": None},
        )
        log_tick("test-0-0", 30, int(time.time()), feats)
        print(json.dumps(feats, indent=1)[:800])
