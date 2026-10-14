#!/usr/bin/env python3
"""Benchmark prediction logger for the PS2MapOracle vs external forecaster.

Logs the oracle's raw tree 3-faction probabilities at alert slices t0/t30/t60,
then computes multi-class Brier per slice when the alert settles. Log-only;
a benchmark failure must NEVER break the push.

Probability contract: probs are fractions in 0..1 (raw model probabilities,
NOT star ratings, NOT display-rounded win%). Brier = mean over the 3 factions
of (p_f - o_f)^2 with o=1 for the winner, 0 otherwise.
"""

import json
import os
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
LOG_PATH = os.path.join(ROOT, "benchmark_predictions.jsonl")
MAP_PATH = os.path.join(ROOT, "benchmark_map.json")

FACTIONS = ("VS", "NC", "TR")
SLICES = ("t0", "t30", "t60")


def _next_alert_n(benchmark_map):
    """Sequential human-friendly alert number. Stored in map _meta so it
    survives restarts. Existing alerts are numbered by first-seen order."""
    meta = benchmark_map.setdefault("_meta", {})
    if "next_alert_n" not in meta:
        # Seed: count distinct alert keys already present (excluding _meta).
        existing = [k for k in benchmark_map.keys() if k != "_meta"]
        meta["next_alert_n"] = len(existing) + 1
    n = meta["next_alert_n"]
    meta["next_alert_n"] = n + 1
    return n


def _assign_alert_n(alert_key, benchmark_map):
    """Return the alert's number, assigning a new one if first seen."""
    entry = benchmark_map.setdefault(alert_key, {"slices": {}})
    if "alert_n" not in entry:
        entry["alert_n"] = _next_alert_n(benchmark_map)
    return entry["alert_n"]


def _log_err(msg):
    print(f"benchmark_log: {msg}", flush=True)


def load_benchmark_map():
    try:
        return json.load(open(MAP_PATH))
    except Exception:
        return {}


def save_benchmark_map(m):
    tmp = MAP_PATH + ".tmp"
    json.dump(m, open(tmp, "w"))
    os.replace(tmp, MAP_PATH)


def _append(line):
    with open(LOG_PATH, "a") as fh:
        fh.write(json.dumps(line, separators=(",", ":")) + "\n")


def _already_settled(alert_key):
    """True if a settled line already exists for this alert key in the log.

    Used to keep ended alerts from re-entering tracking: an alert whose end
    event is missing can linger in the live sweep, and without this guard the
    t0 block re-records it and the settle sweep emits a SECOND settled line,
    double-counting the alert in the benchmark."""
    try:
        with open(LOG_PATH) as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    r = json.loads(line)
                except Exception:
                    continue
                if r.get("type") == "settled" and r.get("alert") == alert_key:
                    return True
    except Exception:
        pass
    return False


def log_slice(alert_key, slice_name, probs, t_actual, instance_id=None, alert_n=None):
    """Append one JSONL prediction line. probs = {VS,NC,TR} fractions 0..1."""
    line = {
        "alert": alert_key,
        "slice": slice_name,
        "t_actual": round(float(t_actual), 1),
        "probs": {f: round(float(probs[f]), 4) for f in FACTIONS},
        "ts": int(time.time()),
    }
    if alert_n is not None:
        line["alert_n"] = alert_n
    if instance_id:
        line["census_instance_id"] = str(instance_id)
    _append(line)


def record_slice(alert_key, slice_name, probs, t_actual, benchmark_map, instance_id=None):
    """Log slice once per alert; idempotent. Returns True if a new line was
    written. Creates the map entry if missing."""
    if _already_settled(alert_key):
        # Ended alerts that linger in the sweep must not re-enter tracking:
        # their slices are post-end junk and would settle a second time.
        return False
    entry = benchmark_map.setdefault(alert_key, {"slices": {}})
    alert_n = _assign_alert_n(alert_key, benchmark_map)
    if instance_id and not entry.get("census_instance_id"):
        entry["census_instance_id"] = str(instance_id)
    slices = entry.setdefault("slices", {})
    if slice_name in slices:
        return False
    probs_r = {f: round(float(probs[f]), 4) for f in FACTIONS}
    slices[slice_name] = probs_r
    log_slice(alert_key, slice_name, probs_r, t_actual, instance_id, alert_n)
    save_benchmark_map(benchmark_map)
    return True


def touch_alert(alert_key, territory, leader, benchmark_map, instance_id=None):
    """Refresh last-observed territory/leader for settle-time winner
    determination. Ended MetagameEvents carry no winner, so the leader at
    last observation stands in (mirrors roster_log.finalize_alert)."""
    entry = benchmark_map.setdefault(alert_key, {"slices": {}})
    if instance_id and not entry.get("census_instance_id"):
        entry["census_instance_id"] = str(instance_id)
    if territory:
        entry["last_territory"] = {f: round(float(territory.get(f, 0)), 1)
                                   for f in FACTIONS}
    if leader in FACTIONS:
        entry["last_leader"] = leader
    save_benchmark_map(benchmark_map)


def brier(probs, winner):
    """Multi-class Brier: mean over factions of (p_f - o_f)^2."""
    return sum((float(probs[f]) - (1.0 if f == winner else 0.0)) ** 2
               for f in FACTIONS) / 3.0


def log_settled(alert_key, winner):
    """Append the terminal Brier summary line for a settled alert. Missing
    slices get null (not zero) brier."""
    if alert_key == "_meta" or _already_settled(alert_key):
        # The _meta bookkeeping entry is not an alert and must never be
        # settled; an alert with an existing settled line must not settle
        # twice. Just drop it from the map.
        benchmark_map = load_benchmark_map()
        benchmark_map.pop(alert_key, None)
        save_benchmark_map(benchmark_map)
        return None
    benchmark_map = load_benchmark_map()
    entry = benchmark_map.pop(alert_key, None)
    slices = (entry or {}).get("slices", {})
    brier_out = {}
    for s in SLICES:
        p = slices.get(s)
        brier_out[s] = round(brier(p, winner), 4) if p is not None else None
    line = {
        "alert": alert_key,
        "type": "settled",
        "winner": winner,
        "brier": brier_out,
        "slices_present": [s for s in SLICES if s in slices],
        "ts": int(time.time()),
    }
    if entry and entry.get("alert_n") is not None:
        line["alert_n"] = entry["alert_n"]
    if entry and entry.get("census_instance_id"):
        line["census_instance_id"] = entry["census_instance_id"]
    _append(line)
    save_benchmark_map(benchmark_map)
    return line


def settle_alert(alert_key, winner, benchmark_map):
    """Settle from an in-memory map (cron path): compute the line, drop the
    entry, persist. Returns the settled line, or None if nothing was
    appended (bookkeeping entry or already-settled alert)."""
    if alert_key == "_meta" or _already_settled(alert_key):
        # Never settle the _meta bookkeeping entry as a fake alert, and
        # never emit a second settled line for an alert that already has
        # one — just drop it from the map.
        benchmark_map.pop(alert_key, None)
        save_benchmark_map(benchmark_map)
        return None
    entry = benchmark_map.pop(alert_key, None)
    slices = (entry or {}).get("slices", {})
    brier_out = {}
    for s in SLICES:
        p = slices.get(s)
        brier_out[s] = round(brier(p, winner), 4) if p is not None else None
    line = {
        "alert": alert_key,
        "type": "settled",
        "winner": winner,
        "brier": brier_out,
        "slices_present": [s for s in SLICES if s in slices],
        "ts": int(time.time()),
    }
    if entry and entry.get("alert_n") is not None:
        line["alert_n"] = entry["alert_n"]
    if entry and entry.get("census_instance_id"):
        line["census_instance_id"] = entry["census_instance_id"]
    _append(line)
    save_benchmark_map(benchmark_map)
    return line


if __name__ == "__main__":
    # Dry run: 2 fake alerts through the module functions.
    import tempfile
    LOG_PATH = os.path.join(tempfile.gettempdir(), "bench_dry.jsonl")
    MAP_PATH = os.path.join(tempfile.gettempdir(), "bench_dry_map.json")
    for p in (LOG_PATH, MAP_PATH):
        if os.path.exists(p):
            os.remove(p)

    m = load_benchmark_map()

    # Alert A: full t0/t30/t60, VS wins.
    keyA = "1-4-999001"
    record_slice(keyA, "t0", {"VS": 0.34, "NC": 0.33, "TR": 0.33}, 2.0, m)
    touch_alert(keyA, {"VS": 34.0, "NC": 33.0, "TR": 33.0}, "VS", m)
    # idempotency: second t0 must not double-log
    assert record_slice(keyA, "t0", {"VS": 0.5, "NC": 0.25, "TR": 0.25}, 3.0, m) is False
    record_slice(keyA, "t30", {"VS": 0.55, "NC": 0.30, "TR": 0.15}, 31.0, m)
    touch_alert(keyA, {"VS": 42.0, "NC": 33.0, "TR": 25.0}, "VS", m)
    record_slice(keyA, "t60", {"VS": 0.70, "NC": 0.20, "TR": 0.10}, 62.0, m)
    touch_alert(keyA, {"VS": 45.0, "NC": 32.0, "TR": 23.0}, "VS", m)
    lineA = settle_alert(keyA, "VS", m)
    print("settled A:", json.dumps(lineA))

    # Alert B: ends at t=20 — only t0 observed, NC wins.
    keyB = "10-2-999002"
    record_slice(keyB, "t0", {"VS": 0.30, "NC": 0.45, "TR": 0.25}, 4.0, m)
    touch_alert(keyB, {"VS": 30.0, "NC": 40.0, "TR": 30.0}, "NC", m)
    lineB = settle_alert(keyB, "NC", m)
    print("settled B:", json.dumps(lineB))

    # Hand-check Brier: A/t60 probs {0.7,0.2,0.1}, VS winner
    # ((0.7-1)^2+(0.2-0)^2+(0.1-0)^2)/3 = (0.09+0.04+0.01)/3 = 0.0467
    assert lineA["brier"]["t60"] == 0.0467, lineA["brier"]
    assert lineA["slices_present"] == ["t0", "t30", "t60"]
    # B/t0 probs {0.30,0.45,0.25}, NC winner:
    # (0.09+0.3025+0.0625)/3 = 0.455/3 = 0.1517
    assert lineB["brier"]["t0"] == 0.1517, lineB["brier"]
    assert lineB["brier"]["t30"] is None and lineB["brier"]["t60"] is None
    assert lineB["slices_present"] == ["t0"]
    assert keyA not in m and keyB not in m  # entries forgotten after settle

    print("--- JSONL ---")
    print(open(LOG_PATH).read())
    print("dry run OK")
