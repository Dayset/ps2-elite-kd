#!/usr/bin/env python3
"""
Pre-flight schema gate for the hex-betting-game live pipeline.

Validates the machine-generated payload BEFORE it reaches the artifact, so a
bad value is caught here instead of burning a push attempt (and a confusing
"schema validation" transport error) on the artifact side.

Usage:
    python3 validate_push_payload.py [path]
    - default path: ~/workspace/ps2polymarket/live_states.json
      (shape: {"states": [...], "settlements": [...]})
    - also accepts a single-push args file (shape: {"state": {...}}),
      e.g. /tmp/args_push.json — validate the exact text you are about to
      paste into invoke_action with this before invoking.

Exit 0 = clean. Exit 1 = problems found (listed on stdout).

2026-10-12: built to close the gap behind the recurring push_live
transport failures — the generator emitted values the artifact would reject
(e.g. bad outlier entries) with no local check. Catches value problems;
paste fidelity (args arriving as a string) is still the worker's job:
read the file's exact text, paste it verbatim as the object argument,
and json.loads the pasted text before invoking.
"""
import json
import os
import sys
from datetime import datetime

FACTIONS = ("VS", "NC", "TR")
WIN_LEVELS = ("trunk", "branch", "twig", "shoot", "leaf", "xtrunk")
SECOND_BASIS = ("scenario", "trunk", "even", "locked")
OUTLIER_SEVERITY = ("early", "confirmed")

errors = []


def err(msg):
    errors.append(msg)


def is_num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def check_faction_map(d, what, num=True):
    if not isinstance(d, dict):
        err(f"{what}: not an object")
        return
    for f in FACTIONS:
        if f not in d:
            err(f"{what}: missing faction {f}")
        elif num and not is_num(d[f]):
            err(f"{what}.{f}: not a number ({d[f]!r})")


def check_state(s, idx):
    tag = f"states[{idx}]"
    for k in ("ts", "t", "live", "alert", "territory", "momentum", "kd", "win", "leader"):
        if k not in s:
            err(f"{tag}: missing required key '{k}'")
    if errors and tag in errors[-1]:
        return
    if not isinstance(s.get("ts"), int) or isinstance(s.get("ts"), bool):
        err(f"{tag}.ts: must be integer")
    if not isinstance(s.get("t"), int) or isinstance(s.get("t"), bool) or s.get("t", -1) < 0:
        err(f"{tag}.t: must be non-negative integer")
    if not isinstance(s.get("live"), bool):
        err(f"{tag}.live: must be boolean")
    a = s.get("alert")
    if isinstance(a, dict):
        for k in ("world", "zone", "event_id", "start_ts"):
            if not isinstance(a.get(k), int) or isinstance(a.get(k), bool):
                err(f"{tag}.alert.{k}: must be integer ({a.get(k)!r})")
    else:
        err(f"{tag}.alert: not an object")
    check_faction_map(s.get("territory"), f"{tag}.territory")
    check_faction_map(s.get("momentum"), f"{tag}.momentum")
    check_faction_map(s.get("kd"), f"{tag}.kd")
    if s.get("leader") not in FACTIONS:
        err(f"{tag}.leader: must be VS/NC/TR ({s.get('leader')!r})")
    w = s.get("win")
    if isinstance(w, dict):
        for f in FACTIONS:
            e = w.get(f)
            if not isinstance(e, dict):
                err(f"{tag}.win.{f}: not an object")
                continue
            for k in ("pct", "level", "n", "trunk"):
                if k not in e:
                    err(f"{tag}.win.{f}: missing '{k}'")
            if is_num(e.get("pct")) and not 0 <= e["pct"] <= 100:
                err(f"{tag}.win.{f}.pct: out of range ({e['pct']})")
            if e.get("level") not in WIN_LEVELS:
                err(f"{tag}.win.{f}.level: bad enum ({e.get('level')!r})")
            if not isinstance(e.get("n"), int) or isinstance(e.get("n"), bool) or e.get("n", -1) < 0:
                err(f"{tag}.win.{f}.n: must be non-negative integer")
            if is_num(e.get("trunk")) and not 0 <= e["trunk"] <= 100:
                err(f"{tag}.win.{f}.trunk: out of range ({e['trunk']})")
    else:
        err(f"{tag}.win: not an object")
    # outliers: optional, but each entry must be well-formed
    for i, o in enumerate(s.get("outliers") or []):
        otag = f"{tag}.outliers[{i}]"
        if not isinstance(o, dict):
            err(f"{otag}: not an object")
            continue
        if o.get("faction") not in FACTIONS:
            err(f"{otag}.faction: must be VS/NC/TR ({o.get('faction')!r})")
        for k in ("kd", "kpm"):
            if not is_num(o.get(k)):
                err(f"{otag}.{k}: must be number ({o.get(k)!r})")
        if not isinstance(o.get("kills"), int) or isinstance(o.get("kills"), bool) or o.get("kills", -1) < 0:
            err(f"{otag}.kills: must be non-negative integer ({o.get('kills')!r})")
        if "severity" in o and o["severity"] not in OUTLIER_SEVERITY:
            err(f"{otag}.severity: must be early/confirmed ({o['severity']!r})")
    # commander: optional, but entries must carry the schema-required keys
    cmd = s.get("commander")
    if cmd is not None:
        facs = cmd.get("factions") if isinstance(cmd, dict) else None
        if not isinstance(facs, dict):
            err(f"{tag}.commander.factions: not an object")
        else:
            for f in FACTIONS:
                fe = facs.get(f)
                if not isinstance(fe, dict):
                    err(f"{tag}.commander.factions.{f}: not an object")
                    continue
                if is_num(fe.get("win_pct")) and not 0 <= fe["win_pct"] <= 100:
                    err(f"{tag}.commander.factions.{f}.win_pct: out of range")
                for j, de in enumerate(fe.get("defend") or []):
                    dtag = f"{tag}.commander.factions.{f}.defend[{j}]"
                    for k in ("name", "vs", "win_drop", "ev", "priority"):
                        if k not in de:
                            err(f"{dtag}: missing '{k}'")
                    if de.get("vs") not in FACTIONS:
                        err(f"{dtag}.vs: bad enum ({de.get('vs')!r})")
                    if is_num(de.get("priority")) and not 0 <= de["priority"] <= 100:
                        err(f"{dtag}.priority: out of range ({de.get('priority')})")
                    if "heat" in de and is_num(de["heat"]) and not 0 <= de["heat"] <= 100:
                        err(f"{dtag}.heat: out of range ({de['heat']})")
                for j, ae in enumerate(fe.get("attack") or []):
                    atag = f"{tag}.commander.factions.{f}.attack[{j}]"
                    for k in ("name", "target", "win_gain", "ev", "priority"):
                        if k not in ae:
                            err(f"{atag}: missing '{k}'")
                    if ae.get("target") not in FACTIONS:
                        err(f"{atag}.target: bad enum ({ae.get('target')!r})")
                    if is_num(ae.get("priority")) and not 0 <= ae["priority"] <= 100:
                        err(f"{atag}.priority: out of range ({ae.get('priority')})")
                    if "heat" in ae and is_num(ae["heat"]) and not 0 <= ae["heat"] <= 100:
                        err(f"{atag}.heat: out of range ({ae['heat']})")
                for j, km in enumerate(fe.get("kingmaker") or []):
                    if not isinstance(km, dict) or "text" not in km or "my_swing" not in km:
                        err(f"{tag}.commander.factions.{f}.kingmaker[{j}]: needs text+my_swing")
    # second-place market: locked odds must be exactly the two non-winner
    # factions, 0-100 each, totaling 100
    sec = s.get("second")
    if sec is not None:
        if not isinstance(sec, dict):
            err(f"{tag}.second: not an object")
        else:
            if sec.get("basis") not in SECOND_BASIS:
                err(f"{tag}.second.basis: bad enum ({sec.get('basis')!r})")
            if not isinstance(sec.get("locked"), bool):
                err(f"{tag}.second.locked: must be boolean")
            odds = sec.get("odds")
            if not isinstance(odds, dict):
                err(f"{tag}.second.odds: not an object")
            elif sec.get("locked"):
                winner = s.get("leader")
                pair = [f for f in FACTIONS if f != winner]
                if sorted(odds.keys()) != sorted(pair):
                    err(f"{tag}.second.odds: locked market must list exactly the two "
                        f"non-winner factions {pair} (got {sorted(odds.keys())})")
                else:
                    vals = [odds[f] for f in pair]
                    if any(not is_num(v) or not 0 <= v <= 100 for v in vals):
                        err(f"{tag}.second.odds: values must be 0-100 numbers")
                    elif abs(sum(vals) - 100) > 0.01:
                        err(f"{tag}.second.odds: locked odds must total 100 (got {sum(vals)})")


def check_settlement(x, idx):
    tag = f"settlements[{idx}]"
    if not isinstance(x.get("alertId"), str):
        err(f"{tag}.alertId: must be string")
    for k in ("endedAt", "snapshotAt"):
        v = x.get(k)
        if not isinstance(v, str):
            err(f"{tag}.{k}: must be ISO string")
    # Dayset's rule: settle from pre-end snapshots only — never post-end
    try:
        ended = datetime.fromisoformat(x["endedAt"].replace("Z", "+00:00"))
        snap = datetime.fromisoformat(x["snapshotAt"].replace("Z", "+00:00"))
        if snap > ended:
            err(f"{tag}: snapshotAt ({x['snapshotAt']}) is AFTER endedAt "
                f"({x['endedAt']}) — post-end snapshots are rejected by rule")
    except (KeyError, ValueError, TypeError):
        pass
    check_faction_map(x.get("territory"), f"{tag}.territory")


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser(
        "~/workspace/ps2polymarket/live_states.json")
    try:
        with open(path) as f:
            raw_text = f.read()
        data = json.loads(raw_text)  # proves the exact bytes are valid JSON
    except FileNotFoundError:
        print(f"FAIL: file not found: {path}")
        return 1
    except json.JSONDecodeError as e:
        print(f"FAIL: not valid JSON: {path}: {e}")
        return 1
    if not isinstance(data, dict):
        print(f"FAIL: top level must be an object, got {type(data).__name__}")
        return 1
    if "state" in data and "states" not in data:
        # single-push args file (e.g. /tmp/args_push.json)
        if not isinstance(data["state"], dict):
            print("FAIL: 'state' must be an object (args arrived as a string?)")
            return 1
        check_state(data["state"], 0)
        n_states, n_sett = 1, 0
    else:
        states = data.get("states")
        settlements = data.get("settlements")
        if not isinstance(states, list) or not isinstance(settlements, list):
            print("FAIL: need 'states' and 'settlements' arrays")
            return 1
        for i, s in enumerate(states):
            check_state(s, i) if isinstance(s, dict) else err(f"states[{i}]: not an object")
        for i, x in enumerate(settlements):
            check_settlement(x, i) if isinstance(x, dict) else err(f"settlements[{i}]: not an object")
        n_states, n_sett = len(states), len(settlements)
    if errors:
        print(f"FAIL: {len(errors)} problem(s) in {path}:")
        for e in errors[:25]:
            print(f"  - {e}")
        if len(errors) > 25:
            print(f"  ... and {len(errors) - 25} more")
        return 1
    print(f"OK: {n_states} state(s), {n_sett} settlement(s) — schema-clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
