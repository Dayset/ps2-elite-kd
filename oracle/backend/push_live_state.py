#!/usr/bin/env python3
"""Generate live push_live states for the Hex Betting Game artifact.

Sweeps all world/zone combos, detects live alerts, and writes a state per
live alert (push_live schema) to live_states.json.

Usage: python3 push_live_state.py
"""
import json, os, sys, subprocess
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_winbins import FACTIONS
from build_winbins_growtree import lookup as tree_lookup
import live_oracle
from types import SimpleNamespace
live_oracle.args = SimpleNamespace(zone=4, world=10)
from live_oracle import (load_events, alert_end, snapshot_at, territory,
                         events_window_at, max_swing_pp)

# Phase 1 roster-strength logging (log-only; never breaks the push).
try:
    import roster_log
except Exception as _e:
    roster_log = None
    print(f"roster_log unavailable: {_e}", file=sys.stderr)

# Benchmark prediction logger: raw tree probs at t0/t30/t60 + Brier at
# settle, for comparison against an external forecaster. Log-only; a
# benchmark failure must NEVER break the push.
try:
    import benchmark_log
except Exception as _e:
    benchmark_log = None
    print(f"benchmark_log unavailable: {_e}", file=sys.stderr)

ROOT = os.path.dirname(os.path.abspath(__file__))
WORLDS = [1, 10, 19, 25]
ZONES = [2, 4, 6, 8, 344]
# Canonical labels for log lines: workers copy these verbatim into run
# summaries and user messages (prevents Indar/Esamir, Miller/Emerald mixups).
WORLD_NAMES = {1: "Connery", 10: "Miller", 19: "Jaeger", 25: "Briggs"}
ZONE_NAMES = {2: "Indar", 4: "Hossin", 6: "Amerish", 8: "Esamir", 344: "Oshur"}
OUT = os.path.join(ROOT, "live_states.json")

# Territory alert types (Census metagame_event type 9) -> duration in minutes.
# Verified 2026-10-11 via Census metagame_event collection. Non-territory
# events (e.g. 242-246 Forgotten Fleet Carrier, 15-min, ~95% canceled) are
# deliberately absent: they are not alerts and must never surface as one.
# Measured 2026-10-04..11: territory alerts are NEVER canceled (0/150), so
# they can be shown from the announcement onward with no ghost gate.
TERRITORY_ALERTS = {
    # 90-min: Superiority / Enlightenment / Liberation / Conquest
    147: 90, 148: 90, 149: 90, 150: 90, 151: 90, 152: 90, 153: 90, 154: 90,
    155: 90, 156: 90, 157: 90, 158: 90, 211: 90, 212: 90, 213: 90, 214: 90,
    # 45-min: Unstable Meltdown + Koltyr + Oshur territory alerts
    176: 45, 177: 45, 178: 45, 179: 45, 186: 45, 187: 45, 188: 45, 189: 45,
    190: 45, 191: 45, 192: 45, 193: 45, 208: 45, 209: 45, 210: 45, 215: 45,
    222: 45, 223: 45, 224: 45, 226: 45, 227: 45,
    # 30-min: Oshur Unstable Meltdown
    248: 30, 249: 30, 250: 30,
}

# Sudden death overtime (kill-based, triggers on territory alert draw).
# 15 min: first to 10,000 kills or most kills at end. NOT territory-based.
SUDDEN_DEATH_ALERTS = {
    236: 15,  # Indar
    237: 15,  # Hossin
    238: 15,  # Amerish
    239: 15,  # Esamir
    240: 15,  # Oshur
}

# per-zone trees (zone 4 canonical name; others z-specific)
trees = {}
for z in ZONES:
    fn = os.path.join(ROOT, "winbins_growtree.json" if z == 4
                      else f"winbins_growtree_z{z}.json")
    if os.path.exists(fn):
        trees[z] = json.load(open(fn))
    else:
        print(f"warning: no tree for zone {z}, skipping")
xtree = json.load(open(os.path.join(ROOT, "winbins_xtrunk.json")))
region_maps = {
    2: json.load(open(os.path.join(ROOT, "indar_region_to_facility.json"))),
    4: json.load(open(os.path.join(ROOT, "hossin_region_to_facility.json"))),
    6: json.load(open(os.path.join(ROOT, "amerish_region_to_facility.json"))),
    8: json.load(open(os.path.join(ROOT, "esamir_region_to_facility.json"))),
    344: json.load(open(os.path.join(ROOT, "oshur_region_to_facility.json"))),
}


def second_place(terr, raw, trunkv, t, dur=90.0):
    """Second-place odds among the two non-winners, once the winner is decided."""
    leader = max(terr, key=lambda f: terr[f])
    if not all(max_swing_pp(t, dur) < (terr[leader] - terr[f])
               for f in terr if f != leader):
        return None
    B, C = [f for f in ("VS", "NC", "TR") if f != leader]
    gap = abs(terr[B] - terr[C])
    if max_swing_pp(t, dur) < gap:
        w2 = B if terr[B] > terr[C] else C
        l2 = C if w2 == B else B
        return {"odds": {w2: 100.0, l2: 0.0}, "locked": True, "basis": "locked"}
    if max(raw[B], raw[C]) >= 5.0:
        qb, qc, basis = raw[B], raw[C], "scenario"
    else:
        qb, qc, basis = trunkv[B], trunkv[C], "trunk"
    if qb + qc <= 0:
        qb, qc, basis = 50.0, 50.0, "even"
    tot = qb + qc
    return {"odds": {B: round(100 * qb / tot, 1), C: round(100 * qc / tot, 1)},
            "locked": False, "basis": basis}


def get_commander(world, zone, start_ts, dur=90.0):
    """Run commander_live.py --json for any supported continent.

    Returns the parsed commander dict, or None on a transient data/model failure.
    Each zone selects its own lattice, region map, and win tree in the commander.
    """
    try:
        r = subprocess.run(
            [sys.executable, os.path.join(ROOT, "commander_live.py"),
             "--world", str(world), "--zone", str(zone),
             "--start-ts", str(start_ts), "--duration-min", str(dur),
             "--json"],
            capture_output=True, text=True, timeout=25)
        if r.returncode != 0:
            return None
        return json.loads(r.stdout)
    except Exception:
        return None


def compute_win(tree, terr, mom, t, dur=90.0):
    """Raw tree 3-faction win% with elimination override, normalized to 100.

    This is the odds engine's probability output; benchmark t0 slices reuse
    it directly so logged probs match what bettors see. Returns
    (win, raw, trunkv) where win[f] = {"pct","level","n","trunk"}.
    2026-10-12: duration-aware phase rescale — the tree was trained on 90-min
    alerts only, so short alerts (45/30-min) rescale t to the 90-min phase:
    t_eff = t * 90/dur. A 45-min alert at t=30 (15 min left) reads the t=60
    bin (same endgame phase), not the t=30 mid-game bin."""
    t_eff = t * 90.0 / dur if dur else t
    b = min(int(t_eff) // 5, 18)
    win = {}
    raw, trunkv = {}, {}
    for f in ("VS", "NC", "TR"):
        marg = terr[f] - max(v for k, v in terr.items() if k != f)
        rival = max((k for k in terr if k != f), key=lambda k: terr[k])
        p, level, n = tree_lookup(tree, b, f, terr[f], mom[f], marg, rival, xtree)
        if p is None:
            p, level, n = 0.0, "trunk", 0
        raw[f] = p
        tb = min(int(terr[f]) // 5, 20)
        cell = tree["trunk"].get(f"{b},{f},{tb}")
        trunk = 100.0 * cell[0] / cell[1] if cell else p
        trunkv[f] = trunk
        win[f] = {"pct": round(p, 1), "level": level, "n": n,
                  "trunk": round(trunk, 1)}

    # elimination override (duration-aware: uses real remaining time)
    leader = max(terr, key=lambda f: terr[f])
    for f in terr:
        if f != leader and max_swing_pp(t, dur) < (terr[leader] - terr[f]):
            win[f]["pct"] = 0.0
    if all(win[f]["pct"] == 0.0 for f in terr if f != leader):
        win[leader]["pct"] = 100.0

    # normalize to 100: tree marginals are independent and may not sum to 100,
    # but a betting market needs proper probabilities.
    tot = sum(win[f]["pct"] for f in ("VS", "NC", "TR"))
    if tot > 0:
        for f in ("VS", "NC", "TR"):
            win[f]["pct"] = round(100.0 * win[f]["pct"] / tot, 1)
    return win, raw, trunkv


def build_state(world, zone, start_ev, start, t, now, dur=90.0):
    tree = trees[zone]
    snap = snapshot_at(world, zone, now)
    snap15 = snapshot_at(world, zone, now - 900)
    if not snap:
        return None
    terr = territory(snap[1])
    mom = {f: terr[f] - (territory(snap15[1])[f] if snap15 else terr[f])
           for f in ("VS", "NC", "TR")}

    # KD and population from events window, per-zone if available
    ew = events_window_at(world, now)
    kd = {"VS": 1.0, "NC": 1.0, "TR": 1.0}
    pop = {"VS": 0, "NC": 0, "TR": 0}
    outliers = []  # ⚠️☠️⚠️ cheater flags per faction
    if ew:
        zones = ew[1].get("zones", {})
        zfx = (zones.get(str(zone)) or {})
        # zones entries are {vs: {...}, nc: {...}, tr: {...}} directly
        fx = zfx if "vs" in zfx else ew[1].get("factions", {})
        for f, key in (("VS", "vs"), ("NC", "nc"), ("TR", "tr")):
            v = (fx.get(key) or {}).get("kd")
            if v:
                kd[f] = round(v, 3)
            p = (fx.get(key) or {}).get("active_players")
            if p:
                pop[f] = int(p)
            elif (fx.get(key) or {}).get("players") is not None:
                # Per-zone entries never carry active_players (writer sets it
                # only at world level) — fall back to the per-zone player-ID
                # list length. Capped at 150 IDs by the writer, so this
                # undercounts if a faction's zone pop ever exceeds 150.
                pop[f] = len(fx[key]["players"])
        # Outliers: flag factions with crazy high KD/KPM players
        # 2026-10-12: Dayset — show ⚠️☠️⚠️ when raging cheater detected
        for o in ew[1].get("outliers", []):
            if str(o.get("zone")) == str(zone):
                outliers.append(o)

    # tree win% per faction (raw model probabilities; no calibration)
    win, raw, trunkv = compute_win(tree, terr, mom, t, dur)
    leader = max(terr, key=lambda f: terr[f])

    # EXPERIMENTAL: time-weighted pop blend (2026-10-12)
    # At t0-t30 the tree is weak (Brier 0.23/0.19); pop leads territory.
    # At t60+ the tree dominates; pop is redundant. Blend decays linearly.
    # KD/KPM excluded: tested, they add noise not signal.
    win_popadj = None
    _pop_total = sum(pop.values())
    if _pop_total > 0:
        _w = max(0.0, 1.0 - t / 60.0)  # 1.0 at t0 → 0 at t60
        if _w > 0:
            _pop_share = {f: pop[f] / _pop_total for f in ("VS", "NC", "TR")}
            _adj = {}
            for f in ("VS", "NC", "TR"):
                _base = win[f]["pct"] / 100.0
                _adj[f] = (1 - _w) * _base + _w * _pop_share[f]
            _sum = sum(_adj.values())
            if _sum > 0:
                win_popadj = {f: {"pct": round(100 * _adj[f] / _sum, 1)} for f in ("VS", "NC", "TR")}

    # calls / hints — momentum as relative % (no pp anywhere)
    def mom_pct(f):
        base = terr.get(f, 0) or 0
        if base < 1:
            return f"{mom[f]:+.1f}%/15min"
        return f"{100.0 * mom[f] / base:+.1f}%/15min"
    calls, hints = [], []
    for f in ("VS", "NC", "TR"):
        if f != leader and mom[f] <= -5:
            c = f"collapse pattern forming for {f} ({mom_pct(f)})"
            calls.append(c)
            hints.append(c)
        if f != leader and win[f]["pct"] == 0.0 and max_swing_pp(t, dur) < (terr[leader] - terr[f]):
            calls.append(f"{f} mathematically eliminated")
    if mom[leader] >= 5:
        calls.append(f"{leader} extending ({mom_pct(leader)})")
    if mom[leader] <= -5:
        calls.append(f"{leader} collapsing ({mom_pct(leader)})")

    # Per-base owners for every continent with bundled artifact geometry.
    owners = {}
    region_map = region_maps.get(zone)
    if region_map:
        for region, fac in snap[1].items():
            fid = region_map.get(str(region))
            if fid and fac in ("1", "2", "3"):
                owners[fid] = FACTIONS[int(fac)]

    # alert identity: event_id when the stream provides one, else start_ts
    # (census_events alert_events carry no event_id; start_ts is unique per alert)
    eid = int(start_ev.get("event_id") or start)
    alert = {"world": world, "zone": zone,
             "event_id": eid,
             "start_ts": start,
             "duration_min": dur}
    state = {
        "ts": int(now),
        "t": int(t),
        "live": True,
        "alert": alert,
        "territory": {f: round(terr[f], 1) for f in ("VS", "NC", "TR")},
        "momentum": {f: round(mom[f], 1) for f in ("VS", "NC", "TR")},
        "kd": kd,
        "pop": pop,
        "outliers": outliers,  # ⚠️☠️⚠️ factions with raging cheaters
        "win": win,
        "win_popadj": win_popadj,  # experimental time-weighted pop blend; None if w=0 or no pop
        "leader": leader,
        "calls": calls,
        "hints": hints,
        "owners": owners,
    }
    # "second" is omitted (not null) when no second-place market is open;
    # the artifact schema rejects null for this field.
    sp = second_place(terr, raw, trunkv, t, dur)
    if sp is not None:
        state["second"] = sp
    # commander: critical bases, fire points, kingmakers, and war shape
    cmd = get_commander(world, zone, start, dur)
    if cmd:
        state["commander"] = cmd
    return state


def main():
    now = datetime.now(timezone.utc).timestamp()
    states = []
    settlements = []
    roster_map = roster_log.load_roster_map() if roster_log else {}
    bench_map = benchmark_log.load_benchmark_map() if benchmark_log else {}
    seen_keys = set()
    bench_seen_keys = set()
    for world in WORLDS:
        for zone in ZONES:
            if zone not in trees:
                continue
            live_oracle.args.zone = zone
            zevs = load_events(world)
            # Territory alerts only: the stream also carries side events
            # (Forgotten Fleet Carrier etc., 89-100% canceled) which are not
            # alerts and must never surface. Territory alerts are never
            # canceled (0/150 measured 2026-10-04..11), so the old 5-min
            # ghost gate is unnecessary for them: the map goes live at the
            # announcement, with t0 predictions from the start.
            zstarts = [e for e in zevs
                       if e.get("state") == "started"
                       and int(e.get("event_id") or 0) in TERRITORY_ALERTS]
            if not zstarts:
                continue
            # Keep recently ended alerts in the settlement feed for at least
            # three scheduler passes (0, +5, +10 minutes), even if another
            # territory alert starts meanwhile. Each pass re-reads the map
            # log so delayed pre-end snapshots can replace the candidate.
            for ended_start in reversed(zstarts):
                ended_start_ts = int(ended_start["ts"])
                ended_eid = int(ended_start.get("event_id") or 0)
                ended_ev = alert_end(zevs, ended_start_ts, ended_eid)
                ended_ts = int(ended_ev["ts"]) if ended_ev else ended_start_ts + TERRITORY_ALERTS[ended_eid] * 60
                if now < ended_ts or now - ended_ts > 20 * 60:
                    continue
                final_snap = snapshot_at(world, zone, ended_ts)
                if not final_snap:
                    continue
                final_terr = territory(final_snap[1])
                # Tie detection: if top two factions are within 0.5% (rounding
                # threshold), this is a draw. Sudden death (events 236-240)
                # will decide by kills. Do NOT settle from territory — hold
                # until sudden death completes. Check for active sudden death.
                terr_vals = sorted([final_terr[f] for f in ("VS", "NC", "TR")], reverse=True)
                is_tie = (terr_vals[0] - terr_vals[1]) < 0.5
                if is_tie:
                    # Look for sudden death event on same world/zone
                    sd_starts = [e for e in zevs
                                 if e.get("state") == "started"
                                 and int(e.get("event_id") or 0) in SUDDEN_DEATH_ALERTS
                                 and int(e.get("ts") or 0) >= ended_ts - 60
                                 and int(e.get("ts") or 0) <= ended_ts + 20 * 60]
                    if sd_starts:
                        # Sudden death is running or recent — hold settlement.
                        # The artifact's record_final_check will show
                        # "awaiting sudden death" and hold payout.
                        print(f"TIE detected for {world}-{zone}-{ended_eid}, "
                              f"sudden death event found, holding settlement", flush=True)
                        continue
                    # No sudden death found yet (might start soon) — still hold,
                    # don't settle a tie from territory.
                    print(f"TIE detected for {world}-{zone}-{ended_eid}, "
                          f"no sudden death yet, holding settlement", flush=True)
                    continue
                settlements.append({
                    "alertId": f"{world}-{zone}-{int(ended_start.get('event_id') or ended_start_ts)}",
                    "endedAt": datetime.fromtimestamp(ended_ts, timezone.utc).isoformat().replace("+00:00", "Z"),
                    "snapshotAt": datetime.fromtimestamp(final_snap[0], timezone.utc).isoformat().replace("+00:00", "Z"),
                    "territory": {f: round(final_terr[f], 1) for f in ("VS", "NC", "TR")},
                })
            start_ev = zstarts[-1]
            start = int(start_ev["ts"])
            eid = int(start_ev.get("event_id") or 0)
            dur = TERRITORY_ALERTS[eid]
            end_ev = alert_end(zevs, start, eid)
            t = (now - start) / 60.0
            # event_ids recycle within a day on the same world+zone (e.g. w10 z6
            # ev244 fired twice on 2026-10-11), so start_ts joins the key —
            # otherwise a repeat start silently drops its slices into the
            # first alert's entry and corrupts its settlement.
            key = f"{world}-{zone}-{int(start_ev.get('event_id') or start)}-{start}"
            # Census instance_id for future cross-checks (e.g. PS2Alerts):
            # recorded on every benchmark slice/settlement so a disputed
            # winner can be verified against third-party history.
            b_instance_id = start_ev.get("instance_id")
            # Benchmark t0: fires on FIRST sighting of a live alert, BEFORE
            # the ghost gate — even a t<5 alert gets its t0 slice logged
            # (state is generated for logging only, never pushed). Requires
            # no end event yet; momentum ~0 is the t<15 tree approximation.
            if benchmark_log and not end_ev and t <= dur + 5 and key not in bench_map:
                try:
                    snap0 = snapshot_at(world, zone, now)
                    if snap0:
                        terr0 = territory(snap0[1])
                        mom0 = {f: 0.0 for f in ("VS", "NC", "TR")}
                        win0, _, _ = compute_win(trees[zone], terr0, mom0, max(t, 0.0), dur)
                        probs0 = {f: win0[f]["pct"] / 100.0 for f in ("VS", "NC", "TR")}
                        benchmark_log.record_slice(key, "t0", probs0, t, bench_map,
                                                     b_instance_id)
                        benchmark_log.touch_alert(
                            key, terr0, max(terr0, key=lambda f: terr0[f]), bench_map,
                            b_instance_id)
                except Exception as e:
                    print(f"benchmark t0 failed: {e}", file=sys.stderr)
            # Ended alerts are emitted through the settlement feed above.
            # Never turn the last live-push state into a result.
            # NOTE: bench_seen_keys is only updated for LIVE alerts — ended
            # ones must NOT be marked seen, or the settlement sweep below
            # (key not in bench_seen_keys) will never fire. Bug found 2026-10-12.
            if end_ev or t > dur + 5:
                continue
            bench_seen_keys.add(key)
            st = build_state(world, zone, start_ev, start, t, now, dur)
            if st:
                states.append(st)
                alabel = f"{WORLD_NAMES.get(world, world)} {ZONE_NAMES.get(zone, zone)}"
                print(f"{alabel} (w{world} z{zone}) t={t:.0f} leader={st['leader']} "
                      + " ".join(f"{f}={st['win'][f]['pct']}" for f in ("VS", "NC", "TR")))
                # Benchmark t30/t60: raw tree probs from the pushed state.
                # Also log pop-adjusted experimental probs for comparison.
                if benchmark_log:
                    try:
                        probs = {f: st["win"][f]["pct"] / 100.0
                                 for f in ("VS", "NC", "TR")}
                        if t >= 30:
                            benchmark_log.record_slice(key, "t30", probs, t, bench_map,
                                                       b_instance_id)
                        if t >= 60:
                            benchmark_log.record_slice(key, "t60", probs, t, bench_map,
                                                       b_instance_id)
                        # Experimental pop blend
                        _wpa = st.get("win_popadj")
                        if _wpa:
                            _probs_adj = {f: _wpa[f]["pct"] / 100.0 for f in ("VS", "NC", "TR")}
                            if t >= 30:
                                benchmark_log.record_slice(key, "t30_popadj", _probs_adj, t, bench_map,
                                                           b_instance_id)
                            if t >= 60:
                                benchmark_log.record_slice(key, "t60_popadj", _probs_adj, t, bench_map,
                                                           b_instance_id)
                        benchmark_log.touch_alert(key, st["territory"], st["leader"],
                                                  bench_map, b_instance_id)
                    except Exception as e:
                        print(f"benchmark slice failed: {e}", file=sys.stderr)
                # Phase 1 roster log: additive, failures never break the push.
                if roster_log:
                    try:
                        key = roster_log.tick_alert(
                            world, zone, start, t, now, st, roster_map)
                        seen_keys.add(key)
                    except Exception as e:
                        print(f"roster tick failed: {e}", file=sys.stderr)
    # Dedup identical settlements within a run (keeps first occurrence).
    # A stale start whose own end event is missing from the stream can match
    # a later alert's end event via alert_end, emitting a byte-identical
    # phantom for the same alertId. Invoking record_final_check twice in one
    # run would log two checks seconds apart, violating the five-minute
    # check spacing the triple-check design requires. Cross-run re-emission
    # (checks 1/2/3) is untouched — dedup is within this run only.
    _seen_settlements = set()
    _uniq_settlements = []
    for _s in settlements:
        _k = json.dumps(_s, sort_keys=True)
        if _k not in _seen_settlements:
            _seen_settlements.add(_k)
            _uniq_settlements.append(_s)
    settlements = _uniq_settlements
    json.dump({"states": states, "settlements": settlements}, open(OUT, "w"))
    print(f"{len(states)} live alert(s), {len(settlements)} settlement candidate(s)")
    # Alerts that disappeared from the sweep have ended: write their final
    # roster-log lines and forget them.
    if roster_log:
        try:
            for key in list(roster_map):
                if key not in seen_keys:
                    roster_log.finalize_alert(key, roster_map)
        except Exception as e:
            print(f"roster finalize failed: {e}", file=sys.stderr)
    # Benchmark settle: alerts that vanished from the sweep (end event seen
    # or t>95 or stream gap) get their per-slice Brier summary. Winner is the
    # leader at last observation — ended MetagameEvents carry no winner.
    if benchmark_log:
        try:
            for key in list(bench_map):
                if key not in bench_seen_keys:
                    entry = bench_map.get(key, {})
                    winner = entry.get("last_leader")
                    if not winner:
                        terr = entry.get("last_territory") or {}
                        winner = max(terr, key=lambda f: terr.get(f, 0)) if terr else "?"
                    benchmark_log.settle_alert(key, winner, bench_map)
        except Exception as e:
            print(f"benchmark settle failed: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
