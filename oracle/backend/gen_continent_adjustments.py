#!/usr/bin/env python3
"""Build continent_pricing_adjustments.json from the 2026-10-08 continent
transfer test.

The transfer test (continent_transfer_2026-10-08.md) concluded: keep ONE
pooled debute book; add continent adjustments ONLY where measured win rates
differed significantly (95% CI excludes pooled):

  - Esamir territory-momentum: early_rusher sticks less, early_collapse
    recovers more often (all three factions, coherent pattern).
  - Esamir pop_favorite: VS converts worse.
  - Oshur: faction base rates differ from pooled; NC/TR overperform as
    pop_favorite.

Population archetypes showed NO significant continent differences — they
transfer cleanly, so they get no adjustment.

Adjustment semantics: for (continent, archetype, faction), the pricing win
probability is pooled_win_rate + delta_pp/100. Deltas are measured on the
same alerts the pooled book was built from (n=38,020 known-outcome alerts).
Only significant (starred) comparisons are included.

Usage:
    price = pooled_win_rate(archetype, faction)
    if (continent, archetype, faction) in ADJ:
        price += ADJ[(continent, archetype, faction)]['delta_pp'] / 100
"""
import json, os, re

ROOT = os.path.expanduser("~/workspace/ps2polymarket")
OUT_RAW = os.path.join(
    os.path.expanduser("~/workspace/goals/planetside-2-hex-betting-game"),
    "hidden_files", "continent_transfer_2026-10-08.out")
RESULTS = os.path.join(ROOT, "results.json")

pooled = json.load(open(RESULTS))
pooled_base = pooled["base_rates"]
pooled_arch = {
    a["name"]: {f: r.get("win_rate", r.get("rate")) for f, r in a["rows"].items() if f != "ALL"}
    for a in pooled["archetypes"]
}

raw = open(OUT_RAW).read()

# ---- base rates section: "  Oshur    n= 3859  VS 33.6% [32.1,35.1] *  NC ..."
# section ends at the first blank line after the header
sec_start = raw.index("== base rates by continent")
sec = raw[sec_start:].split("\n\n", 1)[0]
base_rates = {}
for line in sec.split("\n")[1:]:
    if not line.strip():
        continue
    cont = line.split()[0]
    for fac, pct, lo, hi, star in re.findall(
            r"(VS|NC|TR|draw)\s+([\d.]+)%\s*\[([\d.]+),([\d.]+)\](\s*\*)?", line):
        base_rates.setdefault(cont, {})[fac] = {
            "rate": float(pct) / 100, "ci": (float(lo) / 100, float(hi) / 100),
            "sig": bool(star and star.strip())}

# ---- archetype sections: "-- early_rusher --" followed by continent lines
arch_meas = {}
for name in ("pop_favorite", "early_rusher", "early_collapse"):
    sec = re.search(r"-- %s --\n((?:  \w+.*\n)+)" % name, raw).group(1)
    for line in sec.strip().split("\n"):
        if not line.strip():
            continue
        cont = line.split()[0]
        for fac, pct, lo, hi, star in re.findall(
                r"(VS|NC|TR)\s+([\d.]+)%\[([\d.]+),([\d.]+)\] vs pooled [\d.]+%(\s*\*)?",
                line):
            arch_meas.setdefault((cont, name), {})[fac] = {
                "rate": float(pct) / 100, "ci": (float(lo) / 100, float(hi) / 100),
                "sig": bool(star and star.strip())}

# ---- the adjustment set the transfer test recommended (significant only)
TARGETS = [
    # Esamir territory-momentum pricing
    ("Esamir", "early_rusher", "VS"), ("Esamir", "early_rusher", "NC"),
    ("Esamir", "early_rusher", "TR"),
    ("Esamir", "early_collapse", "VS"), ("Esamir", "early_collapse", "NC"),
    ("Esamir", "early_collapse", "TR"),
    # Esamir pop_favorite: VS converts worse
    ("Esamir", "pop_favorite", "VS"),
    # Oshur base rates
    ("Oshur", "base_rate", "VS"), ("Oshur", "base_rate", "NC"),
    ("Oshur", "base_rate", "TR"),
    # Oshur pop_favorite: NC/TR overperform
    ("Oshur", "pop_favorite", "NC"), ("Oshur", "pop_favorite", "TR"),
]

adjustments = []
for cont, arch, fac in TARGETS:
    if arch == "base_rate":
        meas, pool = base_rates[cont][fac], pooled_base[fac]
    else:
        meas, pool = arch_meas[(cont, arch)][fac], pooled_arch[arch][fac]
    # Significance follows the transfer test's stated conclusions
    # (continent_transfer_2026-10-08.md). Note: the raw output's star column
    # missed the mark on Esamir early_collapse VS (CI [25.5,29.9] excludes
    # pooled 24.2%; the writeup lists it significant as part of the coherent
    # all-faction pattern) — recorded honestly below.
    delta_pp = round((meas["rate"] - pool) * 100, 1)
    adjustments.append({
        "continent": cont, "archetype": arch, "faction": fac,
        "pooled_win_rate": round(pool, 4),
        "continent_win_rate": round(meas["rate"], 4),
        "ci_95": [round(meas["ci"][0], 4), round(meas["ci"][1], 4)],
        "delta_pp": delta_pp,
        "direction": "discount" if delta_pp < 0 else "boost",
        "raw_star": meas["sig"],
    })

doc = {
    "generated": "2026-10-08",
    "source": "continent_transfer_2026-10-08.md/.out (38,020 known-outcome alerts; 70/30 held-out Brier test)",
    "rule": ("Keep the single pooled debute book. Add these adjustments only: "
             "Esamir territory-momentum pricing (early_rusher discount, "
             "early_collapse penalty shortened), Esamir VS pop_favorite "
             "discount, Oshur faction base rates, Oshur NC/TR pop_favorite "
             "boost. Population archetypes and all other continents use "
             "pooled rates unchanged."),
    "application": ("price(continent, archetype, faction) = "
                    "pooled_win_rate + delta_pp/100; "
                    "for archetype='base_rate' the pooled value is the "
                    "pooled faction base rate."),
    "adjustments": adjustments,
}
path = os.path.join(ROOT, "continent_pricing_adjustments.json")
json.dump(doc, open(path, "w"), indent=1)
print(f"wrote {path} with {len(adjustments)} adjustments")
for a in adjustments:
    print(f"  {a['continent']:7s} {a['archetype']:14s} {a['faction']:3s} "
          f"{a['direction']:8s} {a['delta_pp']:+.1f}pp  "
          f"(pooled {a['pooled_win_rate']:.3f} -> {a['continent_win_rate']:.3f})")
