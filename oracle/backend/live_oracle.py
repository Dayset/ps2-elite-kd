#!/usr/bin/env python3
"""Live Hossin alert oracle v1: live state -> time-adjusted win% + commander calls.

Read-only: reads winbins.json, map_snapshots, census_events. Never writes
to poller files, never restarts anything.

Usage:
  python3 live_oracle.py [--world 10] [--zone 4] [--at MINUTE] [--start-ts TS]
  --at        backtest: evaluate at t minutes into the alert
  --start-ts  pin a specific alert (unix ts of its 'started' MetagameEvent)
              (default: latest started alert on that world/zone)
"""
import argparse, json, glob, os
from datetime import datetime, timezone
from build_winbins_growtree import lookup as tree_lookup

ROOT = os.path.dirname(os.path.abspath(__file__))
FAC = {1: "VS", 2: "NC", 3: "TR"}

# elimination constants (from hossin_elimination.py)
N_FAC = 88
PP_PER_FAC = 100.0 / N_FAC
LANES, MIN_PER_BASE = 3, 3.0

def max_swing_pp(t, dur=90.0):
    rem = dur - t
    return LANES * int(rem // MIN_PER_BASE) * (2 * PP_PER_FAC) if rem > 0 else 0.0

def parse_ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()

def load_events(world):
    evs = []
    for fn in glob.glob(os.path.join(ROOT, "data", "census_events", str(world), "*.jsonl")):
        with open(fn) as fh:
            for line in fh:
                try:
                    r = json.loads(line)
                except Exception:
                    continue
                for e in (r.get("alert_events") or []):
                    if str(e.get("zone")) == str(args.zone):
                        evs.append(e)
    evs.sort(key=lambda e: int(e["ts"]))
    return evs

def alert_end(evs, start_ts, event_id=None):
    """First ended/canceled event after start_ts on this world/zone, else None.

    Without this, a started alert that was canceled minutes in (e.g. the
    2026-10-09 14:28 UTC Miller Hossin alert, canceled 14:32) reads as a live
    alert for hours. Sequencing pairs them; instance ids are not in the stream.

    When event_id is given, only match the same alert type — otherwise a
    "canceled" from an unrelated side event (e.g. Forgotten Fleet Carrier)
    would kill a live territory alert's state.
    """
    for e in evs:
        if int(e["ts"]) > start_ts and e.get("state") in ("ended", "canceled"):
            if event_id is not None and str(e.get("event_id")) != str(event_id):
                continue
            return e
    return None

def snapshot_at(world, zone, target):
    """Latest map snapshot at or before target (unix ts). Returns (ts, facilities)."""
    best = None
    day = datetime.fromtimestamp(target, timezone.utc).strftime("%F")
    # check target day and previous day (alert may span midnight)
    days = {day, datetime.fromtimestamp(target - 86400, timezone.utc).strftime("%F")}
    for d in sorted(days):
        fn = os.path.join(ROOT, "data", "map_snapshots", str(world), str(zone), f"{d}.jsonl")
        if not os.path.exists(fn):
            continue
        with open(fn) as fh:
            for line in fh:
                try:
                    r = json.loads(line)
                except Exception:
                    continue
                ts = parse_ts(r["ts"])
                if ts <= target and (best is None or ts > best[0]):
                    best = (ts, r["facilities"])
    return best

def territory(facilities):
    counts = {1: 0, 2: 0, 3: 0}
    total = 0
    for f in facilities.values():
        fi = int(f)
        total += 1
        if fi in counts:
            counts[fi] += 1
    total = total or 1
    return {FAC[k]: 100.0 * v / total for k, v in counts.items()}

def events_window_at(world, target):
    """Latest census_events window at or before target."""
    best = None
    days = {datetime.fromtimestamp(target, timezone.utc).strftime("%F"),
            datetime.fromtimestamp(target - 86400, timezone.utc).strftime("%F")}
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
                ts = parse_ts(r["window_start"])
                if ts <= target and (best is None or ts > best[0]):
                    best = (ts, r)
    return best

def main():
    global args
    ap = argparse.ArgumentParser()
    ap.add_argument("--world", type=int, default=10)
    ap.add_argument("--zone", type=int, default=4)
    ap.add_argument("--at", type=float, default=None, help="minutes into alert (backtest)")
    ap.add_argument("--start-ts", type=int, default=None, help="pin alert by started ts")
    args = ap.parse_args()

    evs = load_events(args.world)
    starts = [e for e in evs if e.get("state") == "started"]
    if args.start_ts:
        cand = [e for e in starts if int(e["ts"]) == args.start_ts]
        if not cand:
            print(f"no started event with ts={args.start_ts}"); return
        start_ev = cand[0]
    else:
        if not starts:
            print("no alert found"); return
        start_ev = starts[-1]
    start = int(start_ev["ts"])
    end_ev = alert_end(evs, start, start_ev.get("event_id"))
    if end_ev and args.start_ts is None and args.at is None:
        sdt = datetime.fromtimestamp(start, timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        edt = datetime.fromtimestamp(int(end_ev["ts"]), timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        print(f"no live alert on world {args.world} zone {args.zone} — "
              f"last alert started {sdt}, {end_ev['state']} {edt}")
        return
    now = datetime.now(timezone.utc).timestamp()
    if args.at is not None:
        t = args.at
    elif end_ev and args.start_ts is not None:
        t = min((now - start) / 60.0, (int(end_ev["ts"]) - start) / 60.0)
    else:
        t = (now - start) / 60.0
    target = start + t * 60

    snap = snapshot_at(args.world, args.zone, target)
    if not snap:
        print("no snapshot available"); return
    terr = territory(snap[1])

    # momentum: 15-min delta (needed before the tree lookup)
    mom = {}
    snap15 = snapshot_at(args.world, args.zone, target - 15 * 60)
    if snap15:
        t15 = territory(snap15[1])
        for f in terr:
            mom[f] = terr[f] - t15[f]
    else:
        mom = {f: 0.0 for f in terr}

    # win% tree lookup: trunk -> branch -> twig, deepest branch with n>=20 wins.
    # Shows the scenario number AND the trunk behind it, so the stable tree
    # stays visible: "win 48% [twig n=32] (trunk 79%)".
    try:
        tree = json.load(open(os.path.join(ROOT, "winbins_growtree.json")))
        try:
            xtree = json.load(open(os.path.join(ROOT, "winbins_xtrunk.json")))
        except Exception:
            xtree = None
        use_tree = True
    except Exception:
        tree = None
        xtree = None
        use_tree = False
        bins = json.load(open(os.path.join(ROOT, "winbins.json")))["bins"]
    tb_t = min(int(t) // 5, 18)
    win, win_src = {}, {}
    for f, pct in terr.items():
        if use_tree:
            marg = pct - max(v for k, v in terr.items() if k != f)
            rival = max((k for k in terr if k != f), key=lambda k: terr[k])
            p, level, n = tree_lookup(tree, tb_t, f, pct, mom[f], marg, rival, xtree)
            if p is None:
                p, level, n = 0.0, "none", 0
            win[f] = p
            # trunk value for display: read l0 directly
            tb = min(int(pct) // 5, 20)
            cell = tree["trunk"].get(f"{tb_t},{f},{tb}")
            if cell:
                trunk_p = 100.0 * cell[0] / cell[1]
            else:
                trunk_p = p
            win_src[f] = f"{level} n={n} (trunk {trunk_p:.0f}%)"
        else:
            tb = min(int(pct) // 5, 20)
            cell = bins.get(f"{tb_t},{f},{tb}")
            if cell is None:
                cands = [bins.get(f"{tb_t + d},{f},{tb}") for d in (-1, 1)]
                cands = [c for c in cands if c]
                cell = cands[0] if cands else None
            if cell:
                win[f] = 100.0 * cell[0] / cell[1]
            else:
                w = n = 0
                for key, c in bins.items():
                    tt, ff, _ = key.split(",")
                    if tt == "0" and ff == f:
                        w += c[0]; n += c[1]
                win[f] = 100.0 * w / n if n else 0.0
            win_src[f] = "trunk"

    # live KD from latest events window
    ew = events_window_at(args.world, target)
    kd = {}
    if ew:
        fx = ew[1].get("factions", {})
        for f, key in (("VS", "vs"), ("NC", "nc"), ("TR", "tr")):
            kd[f] = (fx.get(key) or {}).get("kd")

    # elimination (hard constraint overrides the statistical bins)
    leader = max(terr, key=lambda f: terr[f])
    elim = {}
    for f in terr:
        if f == leader:
            elim[f] = False
        else:
            elim[f] = max_swing_pp(t) < (terr[leader] - terr[f])
    # A mathematically eliminated faction has 0% by definition; if only the
    # leader can still win, the leader is 100% — no bin uncertainty applies.
    for f in terr:
        if elim[f]:
            win[f] = 0.0
    if all(elim[f] for f in terr if f != leader):
        win[leader] = 100.0

    # ---- output
    dt = datetime.fromtimestamp(start, timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    note = ""
    if end_ev:
        edt = (int(end_ev["ts"]) - start) / 60.0
        note = f" ({end_ev['state']} at t={edt:.0f})"
    print(f"Hossin alert t={t:.0f}{note} | world {args.world} zone {args.zone} | started {dt}")
    def mom_pct(f):
        base = terr.get(f, 0) or 0
        if base < 1:
            return f"{mom[f]:+.1f}%/15min"
        return f"{100.0 * mom[f] / base:+.1f}%/15min"
    for f in ("VS", "NC", "TR"):
        kds = f"KD {kd[f]}" if kd.get(f) is not None else "KD n/a"
        print(f"  {f}: win {win[f]:.0f}% [{win_src[f]}] | terr {terr[f]:.1f}% ({mom_pct(f)}) | {kds}")
    print(f"Leader: {leader} at {terr[leader]:.1f}%")
    # commander calls
    calls = []
    for f in ("VS", "NC", "TR"):
        if f != leader and mom[f] <= -5:
            calls.append(f"collapse pattern forming for {f} ({mom_pct(f)})")
        if f != leader and elim[f]:
            calls.append(f"{f} mathematically eliminated (can't close {terr[leader]-terr[f]:.1f}% gap)")
    if mom[leader] >= 5:
        calls.append(f"{leader} extending ({mom_pct(leader)})")
    if not calls:
        calls.append("no decisive pattern — flat war")
    print("Calls: " + "; ".join(calls))

if __name__ == "__main__":
    main()
