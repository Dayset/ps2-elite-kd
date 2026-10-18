#!/usr/bin/env python3
"""Live AI commander for every supported continent.

Combines snapshot ownership, the continent's win tree, and its lattice into
ranked defends / attacks / kingmaker ops + the 3-way verdict. Hossin uses its
per-facility capture model; other continents use the calibrated pressured-base
fallback until continent-specific capture models are available.

Read-only: reads winbins_growtree.json, map_snapshots, census_events, lattice files.
Never writes to poller files, never restarts anything.

Usage:
  python3 commander_live.py [--world 10] [--zone 4] [--at MINUTE]
                            [--start-ts TS] [--faction VS]
  --at        backtest: evaluate at t minutes into the alert (clamped to end)
  --start-ts  pin a specific alert (unix ts of its 'started' MetagameEvent)
  --faction   show only one faction block (default: all three)
"""
import argparse, json, glob, os, statistics
from collections import defaultdict
from datetime import datetime, timezone
from build_winbins_growtree import lookup as tree_lookup

ROOT = os.path.dirname(os.path.abspath(__file__))
FAC = {1: "VS", 2: "NC", 3: "TR"}
INV = {"VS": 1, "NC": 2, "TR": 3}

# elimination constants (from hossin_elimination.py)
N_FAC = 88
PP_PER_FAC = 100.0 / N_FAC
LANES, MIN_PER_BASE = 3, 3.0
ZONE_SLUGS = {2: "indar", 4: "hossin", 6: "amerish", 8: "esamir", 344: "oshur"}

from hossin_elimination import (  # noqa: E402
    eliminated, frontier_of, enemy_frontier_of, war_shape,
)


def max_swing_pp(t, dur=90.0):
    rem = dur - t
    return LANES * int(rem // MIN_PER_BASE) * (2 * PP_PER_FAC) if rem > 0 else 0.0


# Alert duration in minutes; set from --duration-min in main(). The tree and
# heuristics were built for 90-min alerts; shorter alerts (45/30-min
# Unstable Meltdowns) must not use 90-min remaining-time math.
ALERT_DUR = 90.0


def parse_ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


# ---------- alert framing + snapshots (mirrors live_oracle.py) ----------

def load_events(world, zone):
    evs = []
    for fn in glob.glob(os.path.join(ROOT, "data", "census_events", str(world), "*.jsonl")):
        with open(fn) as fh:
            for line in fh:
                try:
                    r = json.loads(line)
                except Exception:
                    continue
                for e in (r.get("alert_events") or []):
                    if str(e.get("zone")) == str(zone):
                        evs.append(e)
    evs.sort(key=lambda e: int(e["ts"]))
    return evs


def alert_end(evs, start_ts, event_id=None):
    """First ended/canceled event after start_ts on this world/zone, else None."""
    for e in evs:
        if int(e["ts"]) > start_ts and e.get("state") in ("ended", "canceled"):
            if event_id is not None and str(e.get("event_id")) != str(event_id):
                continue
            return e
    return None


# ---------- fight-up target-selection signal ----------

# Baseline: 2nd-place factions normally fight UPWARD, not farm downward.
# Share of 2nd-place captures taken from the leader: 66.9% Hossin (t=30->60),
# 68.2% Hossin (t=45->75); 63-72% across continents. A 2nd-place faction whose
# captures come mostly from the WEAKER faction is a real deviation — the
# leader is under less pressure than usual, and normalization (a pivot to the
# leader) is the expected next move.
FIGHT_UP_BASELINE = 0.67
FIGHT_UP_WINDOW_MIN = 20
FIGHT_UP_MIN_FLIPS = 5


def load_flips(world, zone):
    """All FacilityControl flips on world/zone: (ts, new_fac, old_fac, facility_id)."""
    out = []
    for fn in glob.glob(os.path.join(ROOT, "data", "census_events", str(world), "*.jsonl")):
        with open(fn) as fh:
            for line in fh:
                try:
                    r = json.loads(line)
                except Exception:
                    continue
                for x in (r.get("flips") or []):
                    if str(x.get("zone")) != str(zone):
                        continue
                    try:
                        ts = int(x["ts"])
                    except (TypeError, ValueError):
                        continue
                    new = (x.get("new") or "").upper()
                    old = (x.get("old") or "").upper()
                    if new in FAC.values() and old in FAC.values() and new != old:
                        out.append((ts, new, old, x.get("facility")))
    out.sort()
    return out


FREEZE_WINDOW_S = 600  # enemy capture at/next to a chokepoint this recent = threatened


def heat_score(fid, flips, now_ts, adj, window_min=4):
    """Heat 0-100 for a base: recent flips at or adjacent to it.
    
    A base that flipped in the last 4 min is on fire. Adjacent flips
    mean the fight is spilling over. Older flips cool off linearly.
    2026-10-12: window cut from 10 to 4 min — after a capture the fight
    rarely continues; 3-min-old heat felt outdated.
    """
    if not flips:
        return 0
    cutoff = now_ts - window_min * 60
    score = 0
    neighbors = set(adj.get(fid, ()))
    for ts, new, old, fac in flips:
        if ts < cutoff:
            continue
        age_min = (now_ts - ts) / 60
        decay = max(0, 1 - age_min / window_min)  # 1.0 = just now, 0.0 = 4min ago
        if str(fac) == str(fid):
            score += 100 * decay  # direct flip: full heat
        elif str(fac) in {str(n) for n in neighbors}:
            score += 40 * decay  # adjacent flip: spillover heat
    return min(100, round(score))


def fight_up_signal(flips, start, target, sh):
    """Who is pressuring whom, vs the fight-upward baseline.

    Prefers the fresh 20-min window; falls back to the whole alert so far
    when the flip stream is too thin (same honesty rule as the tree: say
    which window the number came from). Returns (lines, deviation) where
    deviation is a dict for the 2nd-place faction when it is fighting
    downward, else None.
    """
    order = sorted(sh, key=lambda f: -sh[f])  # leader, 2nd, 3rd
    leader, second, third = order
    ranks = ["leader", "2nd", "3rd"]
    fresh_w0 = max(start, target - FIGHT_UP_WINDOW_MIN * 60)
    chosen = None
    for w0, wlabel in ((fresh_w0, f"last {FIGHT_UP_WINDOW_MIN}m"),
                       (start, "since alert start")):
        win = [f for f in flips if w0 <= f[0] <= target]
        by_fac = defaultdict(lambda: defaultdict(int))
        for _, new, old, _facility in win:
            by_fac[new][old] += 1
        n2 = sum(by_fac[second].values())
        chosen = (w0, wlabel, win, by_fac, n2)
        if n2 >= FIGHT_UP_MIN_FLIPS:
            break
    _, wlabel, win, by_fac, n2 = chosen
    # when the verdict rests on the stale since-start window, also show the
    # fresh read if it has any substance — a late pivot must stay visible
    fresh_note = None
    if wlabel == "since alert start":
        fresh = [f for f in flips if fresh_w0 <= f[0] <= target and f[1] == second]
        if len(fresh) >= 3:
            fs = sum(1 for f in fresh if f[2] == leader) / len(fresh)
            trend = "pivot toward the leader underway" if fs >= 0.50 else "still fighting downward"
            fresh_note = (f"  recent {FIGHT_UP_WINDOW_MIN}m: {fs:.0%} of {second} captures "
                          f"from {leader} (n={len(fresh)}) — {trend}.")
    n_all = len(win)
    lines = [f"TARGET SELECTION ({wlabel}, n={n_all} directed flips):"]
    for rank, f in enumerate(order):
        tot = sum(by_fac[f].values())
        if not tot:
            lines.append(f"  {f} ({ranks[rank]}): no observed captures")
            continue
        parts = ", ".join(f"{by_fac[f][v]/tot:.0%} from {v}"
                          for v in sorted(by_fac[f], key=lambda v: -by_fac[f][v]))
        cap_word = "capture" if tot == 1 else "captures"
        lines.append(f"  {f} ({ranks[rank]}): {tot} {cap_word} — {parts}")
    deviation = None
    if n2 >= FIGHT_UP_MIN_FLIPS:
        share_leader = by_fac[second][leader] / n2
        if share_leader < 0.50:
            deviation = {"second": second, "leader": leader, "third": third,
                         "share_leader": share_leader, "n": n2}
            lines.append(
                f"  DEVIATION: {second} is fighting DOWNWARD — only "
                f"{share_leader:.0%} of captures from leader {leader} "
                f"(baseline ~{FIGHT_UP_BASELINE:.0%} fight upward). "
                f"{leader} under less pressure than usual; "
                f"expect normalization toward {leader}.")
        else:
            lines.append(
                f"  {second} pressuring the leader normally "
                f"({share_leader:.0%} of captures from {leader}, "
                f"baseline ~{FIGHT_UP_BASELINE:.0%}).")
    else:
        lines.append(f"  (insufficient flip data to judge the fight-up pattern, n={n2})")
    if fresh_note:
        lines.append(fresh_note)
    return lines, deviation


def snapshot_at(world, zone, target):
    """Latest map snapshot at or before target (unix ts). Returns (ts, facilities)."""
    best = None
    days = {datetime.fromtimestamp(target, timezone.utc).strftime("%F"),
            datetime.fromtimestamp(target - 86400, timezone.utc).strftime("%F")}
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


# ---------- lattice / names / id mapping ----------

def load_lattice(zone):
    """Load the lattice, facility names, and Census region mapping for a zone."""
    slug = ZONE_SLUGS.get(zone)
    if not slug:
        raise ValueError(f"unsupported zone {zone}")
    links = json.load(open(os.path.join(ROOT, f"{slug}_links.json")))
    adj = defaultdict(set)
    for l in links:
        a, b = str(l["facility_id_a"]), str(l["facility_id_b"])
        adj[a].add(b)
        adj[b].add(a)
    regs = json.load(open(os.path.join(ROOT, f"{slug}_regions.json")))
    names = {str(r["facility_id"]): r["facility_name"] for r in regs}
    r2f = json.load(open(os.path.join(ROOT, f"{slug}_region_to_facility.json")))
    return adj, names, r2f


def snapshot_ownership(facilities, r2f):
    """Census region_id -> faction  ==>  lattice facility_id -> faction int."""
    own = {}
    for rid, f in facilities.items():
        fid = r2f.get(str(rid))
        if fid is None:
            continue
        try:
            own[fid] = int(f)
        except (TypeError, ValueError):
            continue
    return own


def shares(own):
    n = defaultdict(int)
    for v in own.values():
        n[v] += 1
    tot = sum(n.values()) or 1
    return {f: n.get(INV[f], 0) / tot * 100 for f in ("VS", "NC", "TR")}


# ---------- win% via the tree (trunk -> branch -> twig) ----------

def second_place_probs(sh, w0, t, mom):
    """P(second place) for the two non-winners when winner is locked.
    
    Returns {B: pct, C: pct} or None if winner not locked.
    Uses territory gap + momentum; locks when gap > max possible swing.
    """
    locked = [f for f in ("VS", "NC", "TR") if w0.get(f, 0) >= 100]
    if not locked:
        return None
    winner = locked[0]
    contenders = [f for f in ("VS", "NC", "TR") if f != winner]
    B, C = contenders[0], contenders[1]
    gap = sh[B] - sh[C]
    max_swing = max_swing_pp(t, ALERT_DUR)
    # momentum adjustment: who's gaining on whom
    mom_edge = (mom.get(B, 0) - mom.get(C, 0)) / 2
    adj_gap = gap + mom_edge * 0.5  # momentum counts half
    if abs(adj_gap) > max_swing:
        w2 = B if adj_gap > 0 else C
        l2 = C if w2 == B else B
        return {w2: 100.0, l2: 0.0, "locked": True}
    # logistic-ish: 50% at 0 gap, approaching 100% at max_swing
    pB = 50 + 50 * (adj_gap / max_swing)
    pB = max(1, min(99, round(pB, 1)))
    return {B: pB, C: round(100 - pB, 1), "locked": False}

def make_winfn_tree(tree, t, mom, joint=False, xtree=None, dur=90.0):
    """Tree lookup with backoff. Momentum is the measured trailing-15min
    trajectory (it does not change with a hypothetical single flip);
    margin recomputes from the counterfactual shares.
    joint=True renormalizes the three marginals to sum to 100 -- needed for
    counterfactuals where YOUR territory doesn't move but others' does
    (kingmaker): raw tree cells keyed on own territory would show zero
    swing by construction.
    2026-10-12: duration-aware phase rescale (t_eff = t*90/dur) — tree trained
    on 90-min alerts only; short alerts read the phase-matched bin."""
    t_eff = t * 90.0 / dur if dur else t
    tb_t = min(int(t_eff) // 5, 18)

    def wfn(sh):
        raw = {}
        for f in ("VS", "NC", "TR"):
            marg = sh[f] - max(v for k, v in sh.items() if k != f)
            rival = max((k for k in sh if k != f), key=lambda k: sh[k])
            p, level, n = tree_lookup(tree, tb_t, f, sh[f], mom[f], marg, rival, xtree)
            raw[f] = p if p is not None else 0.0
        if not joint:
            return raw
        s = sum(raw.values()) or 1
        return {f: 100.0 * raw[f] / s for f in raw}

    return wfn



# ---------- capture model ----------

def load_capture_model(zone):
    """Use a zone-specific capture model when available.

    The ranking engine has a calibrated pressured-base fallback, so a missing
    per-facility model must not suppress commander output for another continent.
    """
    slug = ZONE_SLUGS.get(zone)
    if not slug:
        return {}
    path = os.path.join(ROOT, f"{slug}_capture_model.json")
    if not os.path.exists(path):
        return {}
    cm = json.load(open(path))
    return cm.get("per_facility", {})


def p_capture(pf, fid, pressured=True):
    key = f"{fid}|{'P1:pressured' if pressured else 'P0:none'}"
    if key in pf:
        return pf[key]["p"]
    return 0.33 if pressured else 0.18


RESISTANCE_FILE = {
    2: "base_resistance_indar.json",
    4: "base_resistance.json",  # Hossin: the original file (has the GLASS/... class)
    6: "base_resistance_amerish.json",
    8: "base_resistance_esamir.json",
    344: "base_resistance_oshur.json",
}


def load_resistance(zone):
    """Per-base median hold times for the continent (RESISTANCE_FILE).

    Unknown zone or missing file: return {} and defends keep their unadjusted
    EV (hold factor 1.0), same graceful-degradation pattern as load_capture_model.
    The JS port bundles the same files (oracle-worker/build-trees.mjs).
    """
    if zone not in RESISTANCE_FILE:
        return {}
    path = os.path.join(ROOT, RESISTANCE_FILE[zone])
    if not os.path.exists(path):
        return {}
    return json.load(open(path))


def hold_factor(res, fid, ref_median):
    """Defend-EV multiplier from base turnover.

    Fast-flipping bases are perpetual flip-back targets: a coordinated
    outfit can answer a flip in about a minute, randoms cannot, and a
    freshly flipped base is juicy to flip back. So a base that changes
    hands every ~17 min carries more defend urgency than its
    take-probability alone says, and a ~28-min stronghold carries less.
    Factor = reference median hold / this base's median hold, so the
    average defend keeps roughly its old EV while the ranking re-orders
    by turnover. Missing entry (warpgate, other continent) -> 1.0.
    """
    if not res or ref_median is None:
        return 1.0
    entry = res.get(str(fid))
    if not entry:
        return 1.0
    med = entry.get("median_hold_min")
    if not med:
        return 1.0
    return ref_median / med


# ---------- commander engine (adapted from hossin_elimination.py) ----------

def margin_of(sh, fac):
    ld = max(sh, key=lambda x: sh[x])
    if ld == fac:
        return sh[fac] - max(sh[x] for x in sh if x != fac)
    return sh[fac] - sh[ld]


def find_cut_points(own, adj, names):
    """Articulation points per faction: bases whose capture would sever territory.

    For each faction, builds their territory graph and finds vertices whose
    removal disconnects part of their territory from the warpgate. Returns
    {faction_int: [(fid, severed_count, severed_fids), ...]} sorted by
    severed_count descending. These are the cut opportunities — capturing
    one isolates the severed chunk.
    2026-10-12: Dayset's doctrine — cuts are the win condition, prioritized
    "at all cost" unless the defender has 2-3x overpop (human judgment call).
    """
    # warpgate per faction
    wg_owner = {}
    for fid, n in names.items():
        if "warpgate" in n.lower():
            o = own.get(fid)
            if o:
                wg_owner.setdefault(o, []).append(fid)
    cuts = {}
    for fo, wg_fids in wg_owner.items():
        # build faction's territory graph
        faction_fids = {fid for fid, o in own.items() if o == fo}
        if not faction_fids:
            continue
        # find articulation points via DFS (Tarjan)
        disc = {}
        low = {}
        parent = {}
        ap = set()  # articulation points
        time = [0]
        # For each AP, track what gets severed (computed after)
        def dfs(u):
            disc[u] = low[u] = time[0]
            time[0] += 1
            children = 0
            for v in adj.get(u, ()):
                if own.get(v) != fo:
                    continue
                if v not in disc:
                    parent[v] = u
                    children += 1
                    dfs(v)
                    low[u] = min(low[u], low[v])
                    # u is AP if it's not root and low[v] >= disc[u]
                    # (root handled separately)
                    if parent.get(u) is not None and low[v] >= disc[u]:
                        ap.add(u)
                elif v != parent.get(u):
                    low[u] = min(low[u], disc[v])
            # root is AP if it has >1 child in DFS tree
            if parent.get(u) is None and children > 1:
                ap.add(u)
        for start in wg_fids:
            if start not in disc and own.get(start) == fo:
                parent[start] = None
                dfs(start)
        # for each AP, compute severed chunk (BFS from warpgate without the AP)
        # 2026-10-12 fix: severed must be measured against the warpgate-
        # connected set WITH the AP (disc), not all faction bases — otherwise
        # pre-existing disconnected pockets inflate every AP's count.
        connected_with_ap = {fid for fid in faction_fids if fid in disc}
        ap_cuts = []
        for ap_fid in ap:
            # BFS from warpgate excluding ap_fid
            seen = set()
            stack = [w for w in wg_fids if w != ap_fid and own.get(w) == fo]
            while stack:
                cur = stack.pop()
                if cur in seen or cur == ap_fid:
                    continue
                seen.add(cur)
                for nb in adj.get(cur, ()):
                    if nb not in seen and nb != ap_fid and own.get(nb) == fo:
                        stack.append(nb)
            severed = connected_with_ap - seen - {ap_fid}
            # only count if the AP itself is not the warpgate and something is severed
            if severed and ap_fid not in wg_fids:
                ap_cuts.append((ap_fid, len(severed), severed))
        ap_cuts.sort(key=lambda x: -x[1])
        if ap_cuts:
            cuts[fo] = ap_cuts
    return cuts


def warpgate_connected(own, adj, names):
    """faction-int -> fids latticed to their warpgate through friendly hexes.

    A base outside this set is cut off from the main line: the fight there
    should be abandoned, since the lines can't be moved from a severed pocket.
    Warpgates never flip, so live ownership identifies each faction's gate.
    Factions whose warpgate can't be identified get no entry (caller must skip
    cutoff logic then, never abandon everything).
    """
    wg_owner = {}
    for fid, n in names.items():
        if "warpgate" in n.lower():
            o = own.get(fid)
            if o:
                wg_owner.setdefault(o, []).append(fid)
    connected = {}
    for fo, fids in wg_owner.items():
        seen, stack = set(), list(fids)
        while stack:
            cur = stack.pop()
            if cur in seen:
                continue
            seen.add(cur)
            for nb in adj.get(cur, ()):
                if nb not in seen and own.get(nb) == fo:
                    stack.append(nb)
        connected[fo] = seen
    return connected


def ranked_live(sh, w0, own, adj, names, pf, winfn, flips=None, now_ts=None, res=None):
    """Ranked attacks/defends by EV. win% from winbins, not the joint model.

    When one faction is locked at 100% win, the other two stop getting advice
    to attack the winner — their fight is for second place now. Attacks
    targeting the locked winner get priority 0 (dead action).

    Each action also gets a heat score (0-100): recent flips at or adjacent
    to the base mean it's where the fighting is hottest.
    """
    locked = [f for f in ("VS", "NC", "TR") if w0.get(f, 0) >= 100]
    locked_winner = locked[0] if locked else None
    # Hold-time reference: median of per-base median holds (Hossin ~23 min).
    # Defend EV is scaled by ref / base_median_hold; no resistance file
    # (other continents) -> ref None -> hold factor 1.0 everywhere.
    ref_median = None
    if res:
        holds = [v.get("median_hold_min") for v in res.values()
                 if v.get("median_hold_min")]
        if holds:
            ref_median = statistics.median(holds)
    flips = flips or []
    now_ts = now_ts or 0
    # map base names back to facility ids for heat lookup
    name_to_fid = {v: k for k, v in names.items()}
    # warpgate-connected territory per faction (cutoff detection)
    conn = warpgate_connected(own, adj, names)
    # cut opportunities: articulation points whose capture severs enemy territory
    # 2026-10-12: Dayset's doctrine — cuts are the win condition, top priority
    cuts = find_cut_points(own, adj, names)
    # map fid -> (severed_count,) for quick lookup by attacking faction
    cut_by_fid = {}
    for fo_int, cut_list in cuts.items():
        for fid, scount, _ in cut_list:
            cut_by_fid[fid] = scount
    # PREDICTIVE HEAT 2026-10-12: bases adjacent to hot fights warm up before
    # the lattice link opens. Dayset: "just before they're available for
    # capture should be set on fire." Weight by link count (hub = crucial).
    pred_heat = {}
    if flips and now_ts:
        hot_fids = set()
        for fid in own:
            h = heat_score(fid, flips, now_ts, adj)
            if h >= 40:
                hot_fids.add(fid)
        for fid in own:
            if fid in hot_fids:
                continue
            # warming if adjacent to a hot base
            warming = 0
            for nb in adj.get(fid, ()):
                if nb in hot_fids:
                    nb_links = len(adj.get(nb, ()))
                    # hub bonus: more links = more crucial
                    warming = max(warming, min(60, 20 + nb_links * 5))
            if warming:
                pred_heat[fid] = warming
    out = {}
    for f in ("VS", "NC", "TR"):
        fo = INV[f]
        my_conn = conn.get(fo)  # None -> warpgate unknown, skip cutoff logic
        attacks, defends = [], []
        for fid, enemy in enemy_frontier_of(own, adj, f):
            o2 = dict(own)
            o2[fid] = fo
            sh2 = shares(o2)
            m_gain = margin_of(sh2, f) - margin_of(sh, f)
            pc = p_capture(pf, fid, pressured=True)
            ev = pc * max(0, m_gain)
            w2 = winfn(sh2)
            # cut off: none of our staging hexes links back to the warpgate;
            # capturing here only grows a dead pocket -> abandon.
            cut = (my_conn is not None and not any(
                nb in my_conn for nb in adj.get(fid, ())
                if own.get(nb) == fo))
            # bridge: touches both our severed pocket and our connected line;
            # taking it reconnects the pocket -> point at it.
            is_bridge = (my_conn is not None and
                         any(nb in my_conn for nb in adj.get(fid, ())
                             if own.get(nb) == fo) and
                         any(nb not in my_conn for nb in adj.get(fid, ())
                             if own.get(nb) == fo))
            # owner's perspective: base severed from its owner's warpgate ->
            # dead fight, no fire-badge bait.
            owner_conn = conn.get(INV[enemy])
            owner_cut = owner_conn is not None and fid not in owner_conn
            # CUT OPPORTUNITY: capturing this base severs enemy territory.
            # Dayset's doctrine: top priority, "at all cost".
            cut_severs = cut_by_fid.get(fid, 0)
            attacks.append({"name": names.get(fid, f"#{fid}"), "target": enemy,
                            "p_cap": round(pc, 2),
                            "win_gain": round(w2[f] - w0[f], 1),
                            "margin_gain": round(m_gain, 2),
                            "ev": round(ev, 3),
                            "heat": heat_score(fid, flips, now_ts, adj),
                            "pred_heat": pred_heat.get(fid, 0),
                            "cut_off": cut,
                            "reconnect": is_bridge,
                            "owner_cut": owner_cut,
                            "cut_severs": cut_severs})
        # 🥶 set: our bases whose warpgate link depends on a threatened chokepoint.
        # A chokepoint (our articulation point) is threatened if it's hot
        # (being fought over) or on the enemy frontier.
        # 2026-10-18: Dayset — 🥶 showed "too often on territory that is not cut
        # yet". A chokepoint that merely touches an enemy base is the normal front
        # line, not a threat. Threatened now means real fighting at it: heat >= 30,
        # or an enemy capture at the chokepoint or next to it in the last 10 min.
        freezing_fids = set()
        for ap_fid, _, severed in cuts.get(fo, []):
            ap_nbrs = {str(n) for n in adj.get(ap_fid, ())}
            ap_threatened = heat_score(ap_fid, flips, now_ts, adj) >= 30 or any(
                ts >= now_ts - FREEZE_WINDOW_S and ts <= now_ts and new != f
                and (str(fac) == str(ap_fid) or str(fac) in ap_nbrs)
                for ts, new, old, fac in flips)
            if ap_threatened:
                freezing_fids.update(severed)
        for fid in frontier_of(own, adj, f):
            taker = next((own[nb] for nb in adj.get(fid, ())
                          if own.get(nb, fo) not in (fo, 0)), None)
            if taker is None:
                continue
            o2 = dict(own)
            o2[fid] = taker
            sh2 = shares(o2)
            m_loss = margin_of(sh, f) - margin_of(sh2, f)
            pl = p_capture(pf, fid, pressured=True)
            # 2026-10-17: Dayset — re-rank defend EV by hold time.
            # Fast-turnover bases are perpetual flip-back targets, so
            # their defend EV is scaled up by ref/base_median_hold.
            rf = hold_factor(res, fid, ref_median)
            ev = pl * max(0, m_loss) * rf
            w2 = winfn(sh2)
            # cut off from the warpgate: the fight is severed, abandon it.
            # (owner is us here, so this doubles as the no-fire-bait flag.)
            cut = my_conn is not None and fid not in my_conn
            # 🥶 FREEZING: this base's supply line runs through a threatened
            # chokepoint — if it falls, you're cut off. No backup coming.
            # 2026-10-12: Dayset — "oh it's almost cut, that's why" no one came.
            # ALSO: if already severed (cut), mark 🥶 not 🔥 — the fire from the
            # recent fight is misleading; you're isolated, don't expect help.
            # 2026-10-12: Dayset — "they are fighting at fire you left and
            # should be marked as frozen spots instead"
            freezing = (fid in freezing_fids) or cut
            # Severed: suppress fire — the fight is dead, don't bait with 🔥.
            # The 🥶 marker carries the "you're isolated" signal.
            disp_heat = 0 if cut else heat_score(fid, flips, now_ts, adj)
            res_entry = (res or {}).get(str(fid)) or {}
            defends.append({"name": names.get(fid, f"#{fid}"),
                            "attacker": FAC[taker],
                            "p_loss": round(pl, 2),
                            "hold_factor": round(rf, 2),
                            "resistance": res_entry.get("class"),
                            "median_hold_min": res_entry.get("median_hold_min"),
                            "win_drop": round(w0[f] - w2[f], 1),
                            "margin_loss": round(m_loss, 2),
                            "ev": round(ev, 3),
                            "heat": disp_heat,
                            "pred_heat": pred_heat.get(fid, 0),
                            "cut_off": cut,
                            "owner_cut": cut,
                            "freezing": freezing})
        attacks.sort(key=lambda x: (-x.get("cut_severs", 0), -x.get("reconnect", False), -x["ev"]))
        defends.sort(key=lambda x: -x["ev"])
        # Priority 0-100 ABSOLUTE: win% actually at stake for the faction.
        # 0% = dead action (nothing/negative to gain — don't bother),
        # 100% = 10%+ win swing (genuine full throttle).
        # (Was relative: best-of-bunch got 100% even when every stake was
        # tiny, e.g. three tied 3.9% defends all reading 100%.)
        # Locked-winner rule: if someone's at 100%, non-winners get priority 0
        # for attacks on the winner — fight for second place instead.
        # Exception: free bases (p_cap >= 0.9, essentially uncontested) are still
        # worth taking even from the winner. Defends vs winner keep priority —
        # you still need to hold your territory for the second-place race.
        for a in attacks + defends:
            # dead fight (base severed from its owner's warpgate): no fire
            # badge bait, even if the heat is high.
            if a.pop("owner_cut", False):
                a["heat"] = 0
            if a.pop("cut_off", False):
                # severed from the warpgate: abandon the fight, the lines
                # can't be moved from a cut-off pocket.
                a["priority"] = 0
                a["isolated"] = True  # kept for the 🥶 label: cut vs almost cut
                continue
            is_attack_on_winner = (locked_winner and f != locked_winner 
                                   and a.get("target") == locked_winner)
            is_free = a.get("p_cap", 0) >= 0.9
            if is_attack_on_winner and not is_free:
                a["priority"] = 0
            else:
                delta = a.get("win_gain", a.get("win_drop", 0))
                a["priority"] = round(max(0, min(100, 100 * delta / 10)))
            if a.pop("reconnect", False):
                # bridge that reconnects a severed pocket: point at it.
                a["priority"] = max(a["priority"], 70)
        out[f] = {"attack": attacks[:3], "defend": defends[:3]}
    return out


def kingmaker_live(sh, w0, own, adj, names, winfn):
    """Fights between OTHER factions where YOUR win% swings most.

    A 'fight' = a connected cluster of contested bases between the same
    owner/challenger pair (e.g. 'NC wins the Acan fight'). Counterfactual:
    the challenger takes the whole cluster. |swing|>=3, top 3 per faction.
    """
    out = {}
    for f in ("VS", "NC", "TR"):
        fo = INV[f]
        others = [x for x in ("VS", "NC", "TR") if x != f]
        # candidate bases: owned by one 'other', adjacent to another 'other'
        cand = {}  # fid -> (owner, challenger)
        for fid, o in own.items():
            if o == fo or o == 0:
                continue
            owner = FAC[o]
            for nb in adj.get(fid, ()):
                nb_o = own.get(nb, 0)
                if nb_o == 0 or nb_o == fo or nb_o == o:
                    continue
                challenger = FAC[nb_o]
                if owner not in others or challenger not in others:
                    continue
                cand.setdefault(fid, (owner, challenger))
        # connected components over same (owner, challenger) pairs
        seen, clusters = set(), []
        for fid, pair in cand.items():
            if fid in seen:
                continue
            stack, comp = [fid], []
            seen.add(fid)
            while stack:
                cur = stack.pop()
                comp.append(cur)
                for nb in adj.get(cur, ()):
                    if nb in cand and nb not in seen and cand[nb] == pair:
                        seen.add(nb)
                        stack.append(nb)
            clusters.append((pair, comp))
        ops = []
        for (owner, challenger), fids in clusters:
            o2 = dict(own)
            for fid in fids:
                o2[fid] = INV[challenger]
            w2 = winfn(shares(o2))
            f_swing = w2[f] - w0[f]
            if abs(f_swing) >= 3:
                base_names = [names.get(fid, f"#{fid}") for fid in fids]
                ops.append({"bases": base_names, "n": len(fids),
                            "holder": owner, "challenger": challenger,
                            "my_now": round(w0[f], 1),
                            "my_swing": round(f_swing, 1)})
        ops.sort(key=lambda x: -abs(x["my_swing"]))
        out[f] = ops[:3]
    return out


def km_text(k):
    """One-line kingmaker play description, sign-aware.

    Shows the resulting win% (now -> then), not just the swing, so a
    -4.7% from 54.7% reads as "54.7% -> 50.0%" (still leading) while a
    -10% reads as "54.7% -> 44.7%" (lead gone).
    """
    b = k["bases"][0] + (f" ×{k['n']}" if k["n"] > 1 else "")
    now = k.get("my_now")
    if now is None:  # fallback for ops built without my_now
        if k["my_swing"] > 0:
            return (f"help {k['challenger']} take {b} from {k['holder']}: "
                    f"+{k['my_swing']:.1f}% your win")
        return (f"keep {k['holder']} on {b} vs {k['challenger']}: "
                f"if {k['challenger']} takes it, {k['my_swing']:.1f}% your win")
    then = now + k["my_swing"]
    outcome = f"your win {now:.1f}% → {then:.1f}%"
    if k["my_swing"] > 0:
        return (f"help {k['challenger']} take {b} from {k['holder']}: "
                f"{outcome} (+{k['my_swing']:.1f}%)")
    return (f"keep {k['holder']} on {b} vs {k['challenger']}: "
            f"if {k['challenger']} takes it, {outcome} ({k['my_swing']:.1f}%)")


def second_place_kingmaker(sh, w0, t, mom, own, adj, names):
    """When winner is locked, the winner's attacks decide who gets second.
    
    For each base the winner could take from B or C, compute how it shifts
    the B-vs-C second-place race. Returns list of {bases, holder, beneficiary,
    swing} — "if W takes X from B, C's second-place chances go up by Y%".
    """
    locked = [f for f in ("VS", "NC", "TR") if w0.get(f, 0) >= 100]
    if not locked:
        return []
    W = locked[0]
    contenders = [f for f in ("VS", "NC", "TR") if f != W]
    B, C = contenders[0], contenders[1]
    wo = INV[W]
    
    # baseline second-place probs
    sp0 = second_place_probs(sh, w0, t, mom)
    if not sp0:
        return []
    
    ops = []
    # W's frontier bases owned by B or C
    for fid, owner_int in own.items():
        owner = FAC.get(owner_int)
        if owner not in (B, C):
            continue
        # is it adjacent to W?
        adjacent_to_w = any(own.get(nb) == wo for nb in adj.get(fid, ()))
        if not adjacent_to_w:
            continue
        # simulate W taking it
        o2 = dict(own)
        o2[fid] = wo
        sh2 = shares(o2)
        # recompute second-place with new shares (momentum unchanged)
        sp2 = second_place_probs(sh2, w0, t, mom)
        if not sp2:
            continue
        # who benefits? the one NOT losing the base
        victim = owner
        beneficiary = C if victim == B else B
        swing = sp2.get(beneficiary, 0) - sp0.get(beneficiary, 0)
        if abs(swing) >= 2:  # meaningful shift
            ops.append({
                "bases": [names.get(fid, f"#{fid}")],
                "n": 1,
                "holder": victim,
                "beneficiary": beneficiary,
                "by": W,
                "swing": round(swing, 1),
            })
    ops.sort(key=lambda x: -abs(x["swing"]))
    return ops[:3]


def sp_km_text(k):
    """One-line second-place kingmaker description."""
    b = k["bases"][0]
    if k["swing"] > 0:
        return (f"{k['by']} takes {b} from {k['holder']}: "
                f"+{k['swing']:.1f}% {k['beneficiary']} second place")
    return (f"{k['by']} takes {b} from {k['holder']}: "
            f"{k['swing']:.1f}% {k['beneficiary']} second place")


def war_shape_str(ws, f):
    b = ws[f]["borders"]
    tot = ws[f]["total"]
    if tot == 0:
        return "no borders"
    parts = sorted(b.items(), key=lambda x: -x[1])
    desc = ", ".join(f"{e} {n}" for e, n in parts)
    if len(parts) >= 2 and parts[0][1] >= tot * 0.65:
        return f"1v1 LOCKED vs {parts[0][0]} ({desc})"
    if len(parts) >= 2:
        return f"two-front ({desc})"
    return f"vs {parts[0][0]} ({desc})"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--world", type=int, default=10)
    ap.add_argument("--zone", type=int, default=4)
    ap.add_argument("--at", type=float, default=None)
    ap.add_argument("--start-ts", type=int, default=None)
    ap.add_argument("--faction", default=None, choices=["VS", "NC", "TR"])
    ap.add_argument("--json", action="store_true",
                    help="output machine-readable JSON instead of text")
    ap.add_argument("--duration-min", type=float, default=90.0,
                    help="alert duration in minutes (90/45/30 by alert type)")
    args = ap.parse_args()
    global ALERT_DUR
    ALERT_DUR = args.duration_min

    slug = ZONE_SLUGS.get(args.zone)
    if not slug:
        print(f"unsupported zone {args.zone}")
        return
    tree_name = "winbins_growtree.json" if args.zone == 4 else f"winbins_growtree_z{args.zone}.json"
    tree_path = os.path.join(ROOT, tree_name)
    if not os.path.exists(tree_path):
        print(f"no win tree for zone {args.zone}")
        return
    tree = json.load(open(tree_path))
    try:
        xtree = json.load(open(os.path.join(ROOT, "winbins_xtrunk.json")))
    except Exception:
        xtree = None
    try:
        adj, names, r2f = load_lattice(args.zone)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"no commander map data for zone {args.zone}: {exc}")
        return
    pf = load_capture_model(args.zone)
    res = load_resistance(args.zone)

    evs = load_events(args.world, args.zone)
    starts = [e for e in evs if e.get("state") == "started"]
    if args.start_ts:
        cand = [e for e in starts if int(e["ts"]) == args.start_ts]
        if not cand:
            print(f"no started event with ts={args.start_ts}")
            return
        start_ev = cand[0]
    else:
        if not starts:
            print("no alert found")
            return
        start_ev = starts[-1]
    start = int(start_ev["ts"])
    end_ev = alert_end(evs, start, start_ev.get("event_id"))

    now = datetime.now(timezone.utc).timestamp()
    if args.at is not None:
        t = args.at
    elif end_ev and args.start_ts is not None:
        t = min((now - start) / 60.0, (int(end_ev["ts"]) - start) / 60.0)
    else:
        t = (now - start) / 60.0
    if end_ev and args.start_ts is None and args.at is None:
        edt = datetime.fromtimestamp(int(end_ev["ts"]), timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        sdt = datetime.fromtimestamp(start, timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        print(f"no live alert on world {args.world} zone {args.zone} — "
              f"last alert started {sdt}, {end_ev['state']} {edt}")
        return
    # clamp --at to the alert's actual end
    if end_ev and args.at is not None:
        t = min(t, (int(end_ev["ts"]) - start) / 60.0)
    t = max(t, 0)
    target = start + t * 60

    snap = snapshot_at(args.world, args.zone, target)
    if not snap:
        print("no snapshot available")
        return
    own = snapshot_ownership(snap[1], r2f)
    if not own:
        print("snapshot has no mappable facilities")
        return
    # Elimination math is continent-sized: one facility is a different share
    # on Esamir than on Oshur. Use the mapped live facility count for this run.
    global N_FAC, PP_PER_FAC
    N_FAC = len(own)
    PP_PER_FAC = 100.0 / N_FAC
    sh = shares(own)
    snap15 = snapshot_at(args.world, args.zone, target - 15 * 60)
    if snap15:
        own15 = snapshot_ownership(snap15[1], r2f)
        sh15 = shares(own15) if own15 else sh
    else:
        sh15 = sh
    mom = {f: sh[f] - sh15[f] for f in ("VS", "NC", "TR")}
    w0 = make_winfn_tree(tree, t, mom, joint=False, xtree=xtree, dur=ALERT_DUR)(sh)  # display: raw oracle numbers
    winfn = make_winfn_tree(tree, t, mom, joint=True, xtree=xtree, dur=ALERT_DUR)    # counterfactuals: joint-normalized
    w0j = winfn(sh)                                      # counterfactual baseline (same scale)

    leader = max(sh, key=lambda f: sh[f])
    flips = load_flips(args.world, args.zone)
    fu_lines, fu_dev = fight_up_signal(flips, start, target, sh)
    elim = {f: (False if f == leader else max_swing_pp(t, ALERT_DUR) < (sh[leader] - sh[f]))
            for f in ("VS", "NC", "TR")}
    ws = war_shape(own, adj)
    ranked = ranked_live(sh, w0j, own, adj, names, pf, winfn, flips=flips, now_ts=int(target), res=res)
    km = kingmaker_live(sh, w0j, own, adj, names, winfn)
    sp = second_place_probs(sh, w0, t, mom)
    sp_km = second_place_kingmaker(sh, w0, t, mom, own, adj, names)

    if args.json:
        # machine-readable output for the betting game artifact
        out = {
            "t": int(t),
            "world": args.world,
            "zone": args.zone,
            "start_ts": start,
            "leader": leader,
            "factions": {},
        }
        if sp:
            out["second_place"] = sp
        if sp_km:
            out["second_place_kingmaker"] = [
                {"text": sp_km_text(k), "swing": k["swing"],
                 "bases": k["bases"], "holder": k["holder"],
                 "beneficiary": k["beneficiary"], "by": k["by"]}
                for k in sp_km
            ]
        for f in ("VS", "NC", "TR"):
            rd = ranked[f]["defend"][:3]
            ra = ranked[f]["attack"][:3]
            kk = km[f][:3]
            out["factions"][f] = {
                # w0j (joint-normalized) so the panel agrees with the odds
                # board: raw w0 marginals don't sum to 100 and showed e.g.
                # NC 58.8% next to the board's 54.4% on the same screen.
                "win_pct": round(w0j[f], 1),
                "terr_pct": round(sh[f], 1),
                "war_shape": war_shape_str(ws, f),
                "eliminated": bool(elim[f]),
                "defend": [
                    {"name": d["name"], "vs": d["attacker"],
                     "win_drop": round(d["win_drop"], 1),
                     "p_loss": round(d["p_loss"], 2),
                     "ev": round(d["ev"], 2),
                     "priority": d.get("priority", 0),
                     "heat": d.get("heat", 0),
                     "pred_heat": d.get("pred_heat", 0),
                     "freezing": bool(d.get("freezing", False)),
                     "cut_off": bool(d.get("isolated", False)),
                     "hold_factor": d.get("hold_factor", 1.0),
                     "resistance": d.get("resistance"),
                     "median_hold_min": d.get("median_hold_min")}
                    for d in rd
                ],
                "attack": [
                    {"name": a["name"], "target": a["target"],
                     "win_gain": round(a["win_gain"], 1),
                     "margin_gain": round(a["margin_gain"], 1),
                     "p_cap": round(a["p_cap"], 2),
                     "ev": round(a["ev"], 2),
                     "priority": a.get("priority", 0),
                     "heat": a.get("heat", 0),
                     "pred_heat": a.get("pred_heat", 0),
                     "cut_severs": int(a.get("cut_severs", 0))}
                    for a in ra
                ],
                "kingmaker": [
                    {"text": km_text(k), "my_swing": round(k["my_swing"], 1)}
                    for k in kk
                ],
            }
        # fight-up signal
        if fu_dev:
            out["fight_up"] = {
                "leader": fu_dev["leader"],
                "second": fu_dev["second"],
                "third": fu_dev["third"],
                "deviation": True,
                "text": "\n".join(fu_lines),
            }
        else:
            out["fight_up"] = {"deviation": False, "text": "\n".join(fu_lines)}
        print(json.dumps(out))
        return

    sdt = datetime.fromtimestamp(start, timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    note = ""
    if end_ev:
        note = f" ({end_ev['state']} at t={(int(end_ev['ts']) - start) / 60:.0f})"
    print(f"COMMANDER t={t:.0f}{note} | world {args.world} zone {args.zone} | started {sdt}")
    for ln in fu_lines:
        print(ln)
    facs = [args.faction] if args.faction else ["VS", "NC", "TR"]
    for f in facs:
        estatus = "ELIMINATED" if elim[f] else "alive"
        print(f"\n{f} — win {w0[f]:.0f}% | terr {sh[f]:.1f}% | "
              f"{war_shape_str(ws, f)} | {estatus}")
        # the tree can only be bent while it can still move: a faction at
        # 0% (eliminated) or 100% (sole survivor) has no branch left to bend
        decided = elim[f] or w0[f] <= 0 or w0[f] >= 100
        if decided:
            print("  TREE DECIDED — no bend left to play.")
            continue
        if fu_dev and f == fu_dev["leader"]:
            s2, s3 = fu_dev["second"], fu_dev["third"]
            print(f"  Pressure relief: {s2} is fighting {s3} "
                  f"({1-fu_dev['share_leader']:.0%} of its captures), not you — "
                  f"less incoming pressure than the baseline assumes.")
        if fu_dev and f == fu_dev["second"]:
            print(f"  Target selection: you are fighting {fu_dev['third']} (weaker) — "
                  f"the fight-up baseline says ~{FIGHT_UP_BASELINE:.0%} of 2nd-place "
                  f"captures come from the leader. Pressuring {fu_dev['leader']} "
                  f"is the higher-EV direction.")
        rd = ranked[f]["defend"]
        if rd:
            print("  DEFEND (urgency):")
            for d in rd:
                print(f"    {d['name']} vs {d['attacker']} — "
                      f"lose {d['win_drop']:.1f}% win if lost "
                      f"(p_loss {d['p_loss']:.2f}, EV {d['ev']:.2f})")
        else:
            print("  DEFEND: nothing pressing")
        ra = ranked[f]["attack"]
        if ra:
            print("  ATTACK:")
            for a in ra:
                wg = f"+{a['win_gain']:.1f}% win" if a["win_gain"] >= 0.5 else \
                    f"+{a['margin_gain']:.1f}pp margin"
                print(f"    {a['name']} ({a['target']}) — {wg} if taken "
                      f"(p_cap {a['p_cap']:.2f}, EV {a['ev']:.2f})")
        else:
            print("  ATTACK: no targets")
        kk = km[f]
        if kk:
            print("  KINGMAKER:")
            for k in kk:
                print(f"    {km_text(k)}")
        else:
            print("  KINGMAKER: none ≥3%")
        # headline verdict: best 3-way swing vs best defend vs best attack
        best_km = max((abs(k["my_swing"]) for k in kk), default=0)
        best_def = max((d["win_drop"] for d in rd), default=0)
        best_atk = max((a["win_gain"] for a in ra), default=0)
        bk = max(kk, key=lambda k: abs(k["my_swing"])) if kk else None
        bd = max(rd, key=lambda d: d["win_drop"]) if rd else None
        ba = max(ra, key=lambda a: a["win_gain"]) if ra else None
        if bk and best_km > best_def and best_km > best_atk:
            dpart = f"defending {bd['name']} ({bd['win_drop']:.1f}%)" if bd else "any defense"
            print(f"  VERDICT: {km_text(bk)} OUTRANKS {dpart} — play the 3-way.")
        elif ba and best_atk > best_def and best_atk >= 1:
            print(f"  VERDICT: attack {ba['name']} ({ba['target']}, "
                  f"+{ba['win_gain']:.1f}% win) outranks defense — press the attack.")
        elif bd and best_def >= 1:
            print(f"  VERDICT: defend {bd['name']} first "
                  f"({bd['win_drop']:.1f}% at stake) — own territory outranks the 3-way.")
        else:
            print("  VERDICT: no decisive play — hold position, watch the map.")


if __name__ == "__main__":
    main()
