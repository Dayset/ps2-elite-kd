"""Validate the new zone geometry files against the Amerish reference pipeline."""
import json, math, os, re
import numpy as np

S = 100 * math.sqrt(3)
ROOT = os.path.expanduser("~/workspace/ps2polymarket")
ASSETS = os.path.expanduser("~/workspace/ts-spaces/hex-betting-game/client/src/assets")

ZONES = [(2, "indar"), (8, "esamir"), (344, "oshur")]
ZONE_SCALE = {2: 1.0, 8: 1.0, 344: 0.5}  # Oshur tiles are 2x density; game frame is 8km

# --- reference schema shapes from Amerish ---
am_hex = json.load(open(f"{ASSETS}/amerish_hexmap.json"))
am_reg = json.load(open(f"{ASSETS}/amerish_regions.json"))
am_lnk = json.load(open(f"{ASSETS}/amerish_links.json"))
am_r2f = json.load(open(f"{ROOT}/amerish_region_to_facility.json"))
assert set(am_hex.keys()) == {"hexes"}
assert set(am_reg[0].keys()) == {"facility_id", "facility_name", "facility_type_id", "location_x", "location_y"}
assert set(am_lnk[0].keys()) == {"facility_id_a", "facility_id_b"}
print("reference schema keys confirmed")

# Census overrides applied at build (live API preferred)
CENSUS_NAME = {
    "18263": "Excavion Cleanup Site", "18303": "Oshur North Flotilla",
    "18304": "Oshur West Flotilla", "18305": "Oshur Southeast Flotilla",
    "18346": "Wakerift Plateau", "18369": "Bathala Overlook",
}
CENSUS_FAC = {"18263": "400427", "18266": "400329", "18369": "400332"}


def load_svg(slug):
    svg = open(f"/tmp/{slug}.svg").read()
    out = {}
    for pid, pts in re.findall(r'<polygon id="(\d+)" points="([^"]+)"', svg):
        p = [tuple(map(float, q.split(","))) for q in pts.split()]
        xs = [x for x, y in p]; ys = [y for x, y in p]
        out[pid] = (sum(xs) / len(xs), sum(ys) / len(ys), min(xs), max(xs), min(ys), max(ys))
    return out


for zone, slug in ZONES:
    print(f"\n=== {slug} (zone {zone}) ===")
    hexmap = json.load(open(f"{ROOT}/{slug}_hexmap.json"))
    regions = json.load(open(f"{ROOT}/{slug}_regions.json"))
    links = json.load(open(f"{ROOT}/{slug}_links.json"))
    r2f = json.load(open(f"{ROOT}/{slug}_region_to_facility.json"))
    src_regs = json.load(open(f"/tmp/regions-{zone}.json"))["map_region_list"]
    src = {r["map_region_id"]: r for r in src_regs}

    # 1. schema key names / types
    assert set(hexmap.keys()) == {"hexes"}, "hexmap keys"
    for h in hexmap["hexes"]:
        assert isinstance(h[0], float) and isinstance(h[1], float), f"hex coords not float: {h}"
        assert isinstance(h[2], int) and isinstance(h[3], int), f"hex ids not int: {h}"
        assert h[3] in (0, 2), f"bad flag: {h}"
    for r in regions:
        assert set(r.keys()) == set(am_reg[0].keys()), f"region keys: {r.keys()}"
        assert all(isinstance(v, str) for v in r.values()), f"non-string region value: {r}"
    for l in links:
        assert set(l.keys()) == set(am_lnk[0].keys()), f"link keys: {l.keys()}"
        assert all(isinstance(v, str) for v in l.values()), "non-string link value"
    assert all(isinstance(k, str) and isinstance(v, str) for k, v in r2f.items()), "r2f types"
    print("  schema: OK")

    # 2. all hex facility_ids in regions; regions unique
    reg_ids = [r["facility_id"] for r in regions]
    assert len(reg_ids) == len(set(reg_ids)), "dup facility_id in regions"
    reg_set = set(reg_ids)
    hex_facs = set(h[2] for h in hexmap["hexes"])
    assert all(str(f) in reg_set for f in hex_facs), "hex facility not in regions"
    # hex count per facility matches source tile count
    for r in src_regs:
        mr = r["map_region_id"]
        if not r.get("map_hexes"):
            continue
        fid = r2f[mr]
        n_hex = sum(1 for h in hexmap["hexes"] if str(h[2]) == fid)
        # note: synthetic/shared facility ids aggregate; compare per region via r2f
        assert n_hex >= len(r["map_hexes"]), f"hex shortfall {mr}"
    print("  hex facility_ids all in regions: OK")

    # 3. all link endpoints in regions; no dupes/self-links
    pairs = [(l["facility_id_a"], l["facility_id_b"]) for l in links]
    assert len(pairs) == len(set(pairs)), "dup links"
    assert all(a != b for a, b in pairs), "self link"
    assert all(a in reg_set and b in reg_set for a, b in pairs), "orphan link endpoint"
    print("  links endpoints all in regions: OK")

    # 4. r2f covers every source map_region_id that has hexes
    need = {r["map_region_id"] for r in src_regs if r.get("map_hexes")}
    assert set(r2f.keys()) == need, f"r2f coverage gap: {need - set(r2f.keys())}"
    assert all(v in reg_set for v in r2f.values()), "r2f value not in regions"
    print(f"  r2f covers all {len(need)} hexed regions: OK")

    # 5. names: Census preferred on conflict, else source
    for r in regions:
        mr = next(m for m, f in r2f.items() if f == r["facility_id"])
        expect = CENSUS_NAME.get(mr, src[mr].get("facility_name"))
        assert r["facility_name"] == expect, f"name {mr}: {r['facility_name']} != {expect}"
    for mr, f in CENSUS_FAC.items():
        if zone == 344:
            assert r2f[mr] == f, f"Census facility_id override missing for {mr}"
    print("  names/facility_ids (Census-preferred): OK")

    # 6. location_y == location_z verbatim (sign convention preserved);
    #    regions lacking any location (Indar 18205-18207, Esamir synthetics)
    #    fall back to hex-cluster centroid
    CENTROID_FALLBACK = {"18205", "18206", "18207", "18249", "18262"}
    # expected locations mirror build logic: Census override where present
    CEN_LOC = {"18263": ("-355.642548", "157.643265"),
               "18266": ("-672.34552", "-977.172913"),
               "18369": ("-115.495117", "273.175415")}
    for r in regions:
        mr = next(m for m, f in r2f.items() if f == r["facility_id"])
        if mr in CENTROID_FALLBACK:
            float(r["location_x"]); float(r["location_y"])  # numeric strings
            continue
        if mr in CEN_LOC:
            ex, ez = CEN_LOC[mr]
        else:
            s = src[mr]
            ex, ez = str(s["location_x"]), str(s["location_z"])
        assert r["location_y"] == ez, f"location_y != location_z for {mr}"
        assert r["location_x"] == ex, f"location_x changed for {mr}"
    print("  location sign convention (y = z verbatim): OK")

    # 7. warpgate flag rule: flag 2 <=> facility_type_id 7
    wg = {r["facility_id"] for r in regions if r["facility_type_id"] == "7"}
    bad = [h for h in hexmap["hexes"] if (str(h[2]) in wg) != (h[3] == 2)]
    assert not bad, f"flag rule violations: {len(bad)}"
    print(f"  warpgate flag rule ({len(wg)} warpgates): OK")

    # 8. coordinate frame: hex centroid inside SVG polygon bbox (SVG frame is
    #    90deg-rotated: svg_x ~ gy + 4096, svg_y ~ -gx + 4096; fit per zone).
    #    Oshur SVG has 6 stale pre-rework polygons (flotillas etc.) -> allowlist.
    polys = load_svg(slug)
    scale = ZONE_SCALE[zone]
    rows = []
    for r in src_regs:
        mr = r["map_region_id"]
        if not r.get("map_hexes") or mr not in polys:
            continue
        xs = [scale * S * int(h["y"]) for h in r["map_hexes"]]
        ys = [scale * 100.0 * (2 * int(h["x"]) + int(h["y"])) for h in r["map_hexes"]]
        rows.append((mr, sum(xs) / len(xs), sum(ys) / len(ys), polys[mr]))
    A = np.column_stack([[a for _, a, b, _ in rows], [b for _, a, b, _ in rows], np.ones(len(rows))])
    cx, _, _, _ = np.linalg.lstsq(A, np.array([p[0] for _, _, _, p in rows]), rcond=None)
    cy, _, _, _ = np.linalg.lstsq(A, np.array([p[1] for _, _, _, p in rows]), rcond=None)
    # fit must recover a ~90deg rotation at ~unit scale (same SVG convention as Indar)
    assert abs(abs(cx[1]) - 1.0) < 0.15 and abs(cx[0]) < 0.15, f"bad svg-x fit: {cx}"
    assert abs(abs(cy[0]) - 1.0) < 0.15 and abs(cy[1]) < 0.15, f"bad svg-y fit: {cy}"
    allow = {"18303", "18304", "18305", "18346", "18369", "18264"} if zone == 344 else set()
    outside = []
    for mr, gx, gy, (pcx, pcy, x0, x1, y0, y1) in rows:
        sx = cx[0] * gx + cx[1] * gy + cx[2]
        sy = cy[0] * gx + cy[1] * gy + cy[2]
        if not (x0 - 120 <= sx <= x1 + 120 and y0 - 120 <= sy <= y1 + 120):
            outside.append(mr)
    bad = [m for m in outside if m not in allow]
    assert not bad, f"{len(bad)} region centroids outside SVG bboxes: {bad}"
    print(f"  SVG frame check ({len(rows)} regions, {len(outside)} stale-polygon allowlisted): OK")

    n_hex = len(hexmap["hexes"])
    n_flag2 = sum(1 for h in hexmap["hexes"] if h[3] == 2)
    print(f"  SUMMARY: {n_hex} hexes, {len(regions)} facilities, {len(links)} links "
          f"({100.0 * n_flag2 / n_hex:.1f}% flag2)")

print("\nALL VALIDATIONS PASSED")
