#!/usr/bin/env python3
"""Mathematical elimination + critical-base (AI commander) engine for Hossin.

For each minute t of a replay:
  - Reconstruct facility ownership from init + flips.
  - ELIMINATION: for each faction, compute max territory swing achievable in
    remaining time (parallel lanes x capture rate). If the deficit to the
    leader exceeds max swing, the faction is mathematically eliminated.
  - CRITICAL BASES: for each frontier facility a faction holds, simulate
    losing it. If that flips the faction to eliminated (or crashes its joint
    win chance), the base is critical: "hold this or you're dead."

Outputs replay_elimination_v1.json:
  { "timeline": [ {t, elim: {VS,NC,TR: bool},
                   critical: [{fac, name, owner, win_before, win_after, eliminated_after}] } ] }
"""
import json, os
from collections import defaultdict

ROOT = os.path.dirname(os.path.abspath(__file__))
FACTIONS = {1: "VS", 2: "NC", 3: "TR"}
INV = {"VS": 1, "NC": 2, "TR": 3}

# v1 approximations (documented, tunable)
N_FAC = 88
PP_PER_FAC = 100.0 / N_FAC          # ~1.136pp per facility
SWING_PER_FLIP = 2 * PP_PER_FAC     # ~2.27pp swing per base flip
LANES = 3                            # parallel capture lanes
MIN_PER_BASE = 3.0                   # minutes to capture one base


def load_replay(iid="10-46062"):
    m = json.load(open(os.path.join(ROOT, "replay_map_compact.json")))
    fac = m["fac"]                   # id -> [name, x, y]
    links = m["links"]               # lattice
    init = {fid: int(v) for fid, v in m["init"].items()}
    flips = sorted(m["flips"])       # [t, fid, old, new]
    # adjacency
    adj = defaultdict(set)
    if isinstance(links, list) and links and isinstance(links[0], dict):
        for l in links:
            a, b = str(l["facility_id_a"]), str(l["facility_id_b"])
            adj[a].add(b); adj[b].add(a)
    else:
        for a, b in links:
            a, b = str(a), str(b)
            adj[a].add(b); adj[b].add(a)
    return fac, adj, init, flips


def ownership_at(init, flips, t):
    own = dict(init)
    for ft, fid, old, new in flips:
        if ft <= t:
            own[str(fid)] = int(new)
        else:
            break
    return own


def shares(own):
    n = defaultdict(int)
    for v in own.values():
        n[v] += 1
    tot = sum(n.values()) or 1
    return {f: n.get(INV[f], 0) / tot * 100 for f in ("VS", "NC", "TR")}


def max_swing_pp(t):
    """Max territory swing (pp) a faction can achieve in remaining time."""
    rem = 90.0 - t
    if rem <= 0:
        return 0.0
    flips = LANES * int(rem // MIN_PER_BASE)
    return flips * SWING_PER_FLIP


def eliminated(sh, faction, t):
    """True if faction cannot possibly take the lead in remaining time."""
    lead = max(sh, key=lambda f: sh[f])
    if lead == faction:
        return False
    deficit = sh[lead] - sh[faction]
    return max_swing_pp(t) < deficit


# --- joint model lookup for counterfactual win chances ---
_joint = None

def joint_win(sh, t, mom="flat"):
    """Approximate P(win) via joint bins."""
    global _joint
    if _joint is None:
        _joint = json.load(open(os.path.join(ROOT, "replay_joint_cells.json")))
    cells = _joint["cells"]
    lead = max(sh, key=lambda f: sh[f])
    margin = sh[lead] - max(sh[g] for g in ("VS", "NC", "TR") if g != lead)
    mb = ("contested<5" if margin < 5 else "lead5-10" if margin < 10
          else "lead10-15" if margin < 15 else "dominant15+")
    rem = 90 - t
    tb = ("endgame0-10" if rem <= 10 else "late10-30" if rem <= 30
          else "mid30-60" if rem <= 60 else "early60-90")
    k = f"{lead}|{mb}|{mom}|{tb}"
    c = cells.get(k)
    if not c:
        return None
    return {"VS": c["vs"], "NC": c["nc"], "TR": c["tr"], "draw": c["draw"]}


def momentum_of(sh_now, sh_then, lead):
    m = sh_now[lead] - sh_then[lead]
    return "slipping" if m <= -3 else "surging" if m > 3 else "flat"


def frontier_of(own, adj, faction):
    """Facilities owned by faction adjacent to enemy territory."""
    f = INV[faction]
    out = []
    for fid, o in own.items():
        if o != f:
            continue
        for nb in adj.get(fid, ()):
            if own.get(nb, o) not in (f, 0):
                out.append(fid)
                break
    return out


def cascade_size(own, adj, fid, faction):
    """How many new frontier bases open if faction loses fid."""
    f = INV[faction]
    # bases that would become frontier: neighbors of fid's neighbors,
    # owned by faction, not currently frontier
    current_frontier = set(frontier_of(own, adj, faction))
    # simulate loss: fid becomes enemy
    o2 = dict(own)
    # find taker
    taker = next((own[nb] for nb in adj.get(fid, ())
                  if own.get(nb, f) not in (f, 0)), f)
    o2[fid] = taker
    new_frontier = set(frontier_of(o2, adj, faction))
    return len(new_frontier - current_frontier)


def minutes_to_elimination(sh_now, sh_then, faction, t):
    """Minutes until faction is mathematically eliminated at current trend.
    Returns None if not eliminated within the alert."""
    f = faction
    lead = max(sh_now, key=lambda x: sh_now[x])
    if lead == f:
        return None
    r_f = (sh_now[f] - sh_then[f]) / 15.0
    r_l = (sh_now[lead] - sh_then[lead]) / 15.0
    for T in range(0, 91 - t):
        deficit = (sh_now[lead] + r_l * T) - (sh_now[f] + r_f * T)
        if max_swing_pp(t + T) < deficit:
            return T
    return None


def enemy_frontier_of(own, adj, faction):
    """Enemy facilities adjacent to faction's territory (attack targets)."""
    f = INV[faction]
    out = []
    for fid, o in own.items():
        if o == f or o == 0:
            continue
        for nb in adj.get(fid, ()):
            if own.get(nb) == f:
                out.append((fid, FACTIONS[o]))
                break
    return out


def war_shape(own, adj):
    """Three-way pressure analysis. Returns {faction: {borders, split, total}}."""
    from collections import Counter
    pair = Counter()
    for fid, o in own.items():
        for nb in adj.get(fid, ()):
            o2 = own.get(nb, 0)
            if o != o2 and o not in (0,) and o2 not in (0,):
                a, b = sorted([o, o2])
                pair[(a, b)] += 1
    out = {}
    for f in (1, 2, 3):
        press = {}
        for (a, b), n in pair.items():
            if a == f:
                press[b] = n // 2
            elif b == f:
                press[a] = n // 2
        total = sum(press.values())
        out[FACTIONS[f]] = {"borders": {FACTIONS[k]: v for k, v in press.items()},
                            "total": total}
    return out


def command_heuristics(sh, pop, own, adj, t):
    """Resource-management heuristics per faction.
    pop: dict with VS_share, NC_share, TR_share (global pop %).
    Returns {faction: [advice strings]}.
    """
    out = {}
    ws = war_shape(own, adj)
    # find the "free" faction (fewest borders) — they pick their spots
    totals = {f: ws[f]["total"] for f in ("VS", "NC", "TR")}
    free_f = min(totals, key=lambda f: totals[f]) if any(totals.values()) else None
    for f in ("VS", "NC", "TR"):
        adv = []
        ps = pop.get(f"{f}_share", 0)
        ts = sh[f]
        frontiers = frontier_of(own, adj, f)
        nf = len(frontiers)
        # H0: THREE-WAY WAR SHAPE (double-team factor)
        b = ws[f]["borders"]
        tot = ws[f]["total"]
        if tot >= 6:
            enemies = sorted(b.items(), key=lambda x: -x[1])
            if len(enemies) >= 2:
                e1, n1 = enemies[0]
                e2, n2 = enemies[1]
                if n1 >= tot * 0.65:
                    adv.append(f"1v1 LOCKED: {n1}/{tot} borders vs {e1}. "
                               f"{free_f} is free — watch your flank.")
                elif n1 >= tot * 0.4 and n2 >= tot * 0.25:
                    adv.append(f"TWO-FRONT WAR: {e1} on {n1}, {e2} on {n2}. "
                               f"Split force tight — you're the anvil.")
            if f == free_f and tot > 0:
                others = [x for x in ("VS", "NC", "TR") if x != f]
                adv.append(f"FREE AGENT: only {tot} borders "
                           f"(vs {totals[others[0]]}/{totals[others[1]]}). "
                           f"Pick your spots — you're not the focus.")
        # H1: force concentration vs spread
        if nf >= 5 and ps < 28:
            adv.append(f"SPREAD THIN: {nf} frontier bases with {ps:.0f}% pop. "
                       f"You can't hold them all — prioritize top 2, concede rest.")
        elif nf <= 2 and ps > 38 and nf > 0:
            adv.append(f"OVERCONCENTRATED: {ps:.0f}% pop on {nf} lane(s). "
                       f"Split force — open a second lane.")
        # H2: pop-territory efficiency
        if ps > 5:
            eff = ts / ps
            if eff < 0.75:
                adv.append(f"WASTING POP: {ps:.0f}% pop holding {ts:.0f}% territory "
                           f"(eff {eff:.2f}). Spread out or focus attacks.")
            elif eff > 1.3:
                adv.append(f"HEROIC EFFICIENCY: {ps:.0f}% pop holding {ts:.0f}% territory "
                           f"(eff {eff:.2f}). You're outperforming — keep pressure.")
        # H3: underdog / overdog stance
        lead = max(sh, key=lambda x: sh[x])
        if f != lead:
            deficit = sh[lead] - ts
            rem = 90 - t
            need_flips = deficit / (2 * 100.0 / 88)
            max_flips = 3 * int(rem // 3)
            if need_flips > max_flips * 0.7:
                adv.append(f"UPHILL: need ~{need_flips:.0f} flips in {rem:.0f}min "
                           f"(max ~{max_flips}). Every base counts — no waste.")
        out[f] = adv
    return out


def load_capture_model():
    cm = json.load(open(os.path.join(ROOT, "hossin_capture_model.json")))
    return cm["per_facility"], cm["global"]


def p_capture(pf, fid, pressured=True):
    """P(base falls in 15min). Use per-facility if available, else global."""
    key = f"{fid}|{'P1:pressured' if pressured else 'P0:none'}"
    if key in pf:
        return pf[key]["p"]
    return 0.33 if pressured else 0.18


def ranked_options(sh, w0, own, adj, t, mom, pf):
    """Rank attack and defend options by expected value.
    Uses MARGIN SWING (continuous, sensitive) for ranking, not coarse win% bins.
    Attack EV = P(capture) * margin_gain. Defend EV = P(loss) * margin_loss.
    Returns {faction: {'attack': [...], 'defend': [...]}} ranked by EV.
    """
    out = {}
    for f in ("VS", "NC", "TR"):
        fo = INV[f]
        lead = max(sh, key=lambda x: sh[x])
        attacks, defends = [], []
        # ATTACK: enemy frontier bases
        for fid, enemy in enemy_frontier_of(own, adj, f):
            o2 = dict(own); o2[fid] = fo
            sh2 = shares(o2)
            # margin impact: how much does F's deficit shrink (or lead grow)?
            def margin_of(s, fac):
                ld = max(s, key=lambda x: s[x])
                if ld == fac:
                    return s[fac] - max(s[x] for x in s if x != fac)
                return s[fac] - s[ld]
            m_gain = margin_of(sh2, f) - margin_of(sh, f)
            pc = p_capture(pf, fid, pressured=True)
            ev = pc * max(0, m_gain)
            w2 = joint_win(sh2, t, mom) or {}
            attacks.append({"name": _names.get(fid, fid), "target": enemy,
                            "p_cap": round(pc, 2),
                            "win_gain": round(w2.get(f, 0) - w0.get(f, 0), 1),
                            "margin_gain": round(m_gain, 2),
                            "ev": round(ev, 3)})
        # DEFEND: own frontier bases
        for fid in frontier_of(own, adj, f):
            taker = next((own[nb] for nb in adj.get(fid, ())
                          if own.get(nb, fo) not in (fo, 0)), None)
            if taker is None:
                continue
            o2 = dict(own); o2[fid] = taker
            sh2 = shares(o2)
            m_loss = margin_of(sh, f) - margin_of(sh2, f)
            pl = p_capture(pf, fid, pressured=True)
            ev = pl * max(0, m_loss)
            w2 = joint_win(sh2, t, mom) or {}
            defends.append({"name": _names.get(fid, fid), "attacker": FACTIONS[taker],
                            "p_loss": round(pl, 2),
                            "win_drop": round(w0.get(f, 0) - w2.get(f, 0), 1),
                            "margin_loss": round(m_loss, 2),
                            "ev": round(ev, 3)})
        attacks.sort(key=lambda x: -x["ev"])
        defends.sort(key=lambda x: -x["ev"])
        out[f] = {"attack": attacks[:5], "defend": defends[:5]}
    return out


_names = {}


def kingmaker_ops(sh, w0, own, adj, t, mom):
    """Kingmaker: fights between OTHER factions where YOUR win% swings most.
    For faction F, find bases where A vs B fight (F not involved), compute
    F's win% if the challenger wins vs holder keeps. Rank by |swing|.
    Compact output: base, fight pair, who F wants, swings.
    """
    out = {}
    for f in ("VS", "NC", "TR"):
        fo = INV[f]
        others = [x for x in ("VS", "NC", "TR") if x != f]
        ops = []
        seen = set()
        for fid, o in own.items():
            if o == fo or o == 0:
                continue
            owner = FACTIONS[o]
            # is this base adjacent to the OTHER enemy (A vs B fight)?
            for nb in adj.get(fid, ()):
                nb_o = own.get(nb, 0)
                if nb_o == 0 or nb_o == fo or nb_o == o:
                    continue
                challenger = FACTIONS[nb_o]
                # ensure it's others-vs-others (not involving f)
                if owner not in others or challenger not in others:
                    continue
                key = (fid, owner, challenger)
                if key in seen:
                    continue
                seen.add(key)
                # counterfactual: challenger takes it
                o2 = dict(own); o2[fid] = nb_o
                sh2 = shares(o2)
                w2 = joint_win(sh2, t, mom) or {}
                # F's swing
                f_swing = w2.get(f, 0) - w0.get(f, 0)
                # participants' stakes
                a_stake = w0.get(owner, 0) - w2.get(owner, 0)  # owner loses
                b_stake = w2.get(challenger, 0) - w0.get(challenger, 0)
                if abs(f_swing) >= 3:
                    ops.append({
                        "base": _names.get(fid, fid),
                        "holder": owner, "challenger": challenger,
                        "want": challenger if f_swing > 0 else owner,
                        "my_swing": round(f_swing, 1),
                        "holder_loses": round(a_stake, 1),
                        "chall_gains": round(b_stake, 1),
                    })
        ops.sort(key=lambda x: -abs(x["my_swing"]))
        out[f] = ops[:3]
    return out


def main(iid="10-46062"):
    global _names
    fac, adj, init, flips = load_replay(iid)
    names = {fid: v[0] for fid, v in fac.items()}
    _names = names
    pf, _ = load_capture_model()
    # true timeline win chances for win_before reference
    tl = {e["t"]: e for e in
          json.load(open(os.path.join(ROOT, "replay_joint_v1.json")))["joint_timeline"]}
    # population timeline
    pop_tl = {e["t"]: e["pop"] for e in
              json.load(open(os.path.join(ROOT, "replay_10-46062.json")))["timeline"]}
    timeline = []
    for t in range(91):
        own = ownership_at(init, flips, t)
        sh = shares(own)
        elim = {f: eliminated(sh, f, t) for f in ("VS", "NC", "TR")}
        # momentum from 15 min ago
        own_then = ownership_at(init, flips, max(0, t - 15))
        sh_then = shares(own_then)
        lead_now = max(sh, key=lambda f: sh[f])
        mom = momentum_of(sh, sh_then, lead_now)
        w0 = {"VS": tl[t]["vs"], "NC": tl[t]["nc"], "TR": tl[t]["tr"]}
        critical = []
        for f in ("VS", "NC", "TR"):
            if elim[f]:
                continue
            mte_base = minutes_to_elimination(sh, sh_then, f, t)
            for fid in frontier_of(own, adj, f):
                # counterfactual: f loses fid to the neighboring enemy
                o2 = dict(own)
                fo = INV[f]
                taker = next((own[nb] for nb in adj.get(fid, ())
                              if own.get(nb, fo) not in (fo, 0)), None)
                if taker is None:
                    continue
                o2[fid] = taker
                sh2 = shares(o2)
                elim2 = eliminated(sh2, f, t)
                # counterfactual momentum: assume same trend
                w2 = joint_win(sh2, t, mom) or {}
                wb, wa = w0.get(f, 0), w2.get(f, 0)
                drop = wb - wa
                casc = cascade_size(own, adj, fid, f)
                # trajectory: does losing this base accelerate elimination?
                mte_cf = minutes_to_elimination(sh2, sh_then, f, t)
                breaking = False
                if mte_base is None and mte_cf is not None and mte_cf <= 30:
                    breaking = True  # causes elimination within 30 min
                elif (mte_base is not None and mte_cf is not None
                      and mte_base - mte_cf >= 15):
                    breaking = True  # accelerates elimination by 15+ min
                # always track; severity flagged below
                critical.append({
                    "fac": fid, "name": names.get(fid, fid),
                    "owner": f, "taker": FACTIONS[taker],
                    "win_before": round(wb, 1), "win_after": round(wa, 1),
                    "drop": round(drop, 1),
                    "eliminated_after": elim2,
                    "cascade": casc,
                    "breaking": breaking,
                    "mte_after": mte_cf,
                    "severity": ("ELIMINATED" if elim2 else
                                 "BREAKING" if breaking else
                                 "CRITICAL" if drop >= 15 else
                                 "WATCH" if drop >= 5 or casc >= 3 else "minor"),
                })
        # keep top 5 by drop, but always include any ELIMINATED/CRITICAL/BREAKING
        critical.sort(key=lambda c: (c["eliminated_after"], c["breaking"],
                                      c["drop"]), reverse=True)
        kept = [c for c in critical
                if c["severity"] in ("ELIMINATED", "CRITICAL", "BREAKING")]
        rest = [c for c in critical
                if c["severity"] not in ("ELIMINATED", "CRITICAL", "BREAKING")]
        kept += rest[:max(0, 5 - len(kept))]
        # OFFENSIVE: which enemy bases should this faction attack?
        # Rank by strategic value; always show best per faction even if small.
        opportunities = []
        for f in ("VS", "NC", "TR"):
            if elim[f]:
                continue
            fo = INV[f]
            cands = []
            for fid, enemy in enemy_frontier_of(own, adj, f):
                o2 = dict(own)
                o2[fid] = fo
                sh2 = shares(o2)
                elim_enemy = eliminated(sh2, enemy, t)
                w2 = joint_win(sh2, t, mom) or {}
                wb_e = w0.get(enemy, 0)
                wa_e = w2.get(enemy, 0)
                edrop = wb_e - wa_e
                gain = w2.get(f, 0) - w0.get(f, 0)
                # strategic score: elimination > win% swing > margin cut
                margin_cut = (sh[enemy] - sh[f]) - (sh2[enemy] - sh2[f])
                cands.append({
                    "fac": fid, "name": names.get(fid, fid),
                    "attacker": f, "defender": enemy,
                    "enemy_win_before": round(wb_e, 1),
                    "enemy_win_after": round(wa_e, 1),
                    "own_gain": round(gain, 1),
                    "eliminates": elim_enemy,
                    "score": (1000 if elim_enemy else 0) + edrop + gain + margin_cut,
                })
            if cands:
                cands.sort(key=lambda c: c["score"], reverse=True)
                best = cands[0]
                # only include if meaningful (score > 0) or faction is trailing
                is_trailing = sh[f] < max(sh.values()) - 5
                if best["score"] > 1 or is_trailing:
                    opportunities.append(best)
        timeline.append({"t": t, "elim": elim, "critical": kept[:5],
                         "opportunities": opportunities,
                         "heuristics": command_heuristics(sh, pop_tl.get(t, {}),
                                                          own, adj, t),
                         "ranked": ranked_options(sh, w0, own, adj, t, mom, pf),
                         "kingmaker": kingmaker_ops(sh, w0, own, adj, t, mom)})
    json.dump({"timeline": timeline,
               "params": {"pp_per_fac": round(PP_PER_FAC, 3),
                          "lanes": LANES, "min_per_base": MIN_PER_BASE}},
              open(os.path.join(ROOT, "replay_elimination_v1.json"), "w"),
              separators=(",", ":"))
    # diagnostics
    print("elimination timeline (first t each faction eliminated):")
    seen = {}
    for e in timeline:
        for f in ("VS", "NC", "TR"):
            if e["elim"][f] and f not in seen:
                seen[f] = e["t"]
    print(" ", seen or "none eliminated")
    print("critical-base moments (t, owner, base, win_before->win_after):")
    shown = 0
    for e in timeline:
        for c in e["critical"]:
            if shown < 12 and (c["eliminated_after"] or c["drop"] >= 25):
                print(f"  t={e['t']:2d} {c['owner']} holds {c['name']}: "
                      f"{c['win_before']}% -> {c['win_after']}%"
                      f"{' ELIMINATED' if c['eliminated_after'] else ''}")
                shown += 1


if __name__ == "__main__":
    main()
