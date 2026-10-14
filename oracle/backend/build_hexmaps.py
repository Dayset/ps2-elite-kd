"""Build hexmap/links/regions/region_to_facility for Indar(2), Esamir(8), Oshur(344).

Replicates the Amerish pipeline exactly:
- tile (tx, ty) -> gx = round(100*sqrt(3)*ty, 1), gy = 100*(2*tx + ty)
  (fit against amerish_hexmap.json: exact, 0 multiset mismatches over 81 facilities)
- flag = 2 for all hexes of warpgate facilities (facility_type_id == "7"), else 0
  (verified: warpgate<->flag2 correspondence is exact in Amerish)
- regions: all-string values, location_y = location_z verbatim
- links: canonical undirected pairs, int(a) < int(b), sorted by (int a, int b)
- r2f: map_region_id -> facility_id for every region WITH hexes, source region order
- Census overrides (live API preferred on conflict): Oshur facility_id/name/location
  for 6 regions; Esamir 18249/18262 have no facility_id in Census either ->
  synthetic facility_id = map_region_id, location = hex-cluster centroid.
"""
import json, math, os

S = 100 * math.sqrt(3)
ROOT = os.path.expanduser("~/workspace/ps2polymarket")

# Game-frame scale per zone. Oshur's source tiles are at 2x density: at the
# Amerish transform its hexes would span +/-6600, but the game map is 8km
# (Census facility locations span +/-3000, same as Indar) and the client
# viewBox is fixed at +/-3900. Halving puts Oshur hexes at +/-3300, and the
# ps2map SVG then matches at scale 1.0 exactly like Indar/Esamir (61/67
# region consensus; 6 outliers are stale pre-rework SVG polygons).
ZONE_SCALE = {2: 1.0, 8: 1.0, 344: 0.5}

# Census-preferred overrides: map_region_id -> (facility_id, facility_name, location_x, location_z)
CENSUS_OVERRIDES = {
    "18263": ("400427", "Excavion Cleanup Site", "-355.642548", "157.643265"),
    "18266": ("400329", "Centri Import Hub", "-672.34552", "-977.172913"),
    "18369": ("400332", "Bathala Overlook", "-115.495117", "273.175415"),
    "18303": (None, "Oshur North Flotilla", None, None),
    "18304": (None, "Oshur West Flotilla", None, None),
    "18305": (None, "Oshur Southeast Flotilla", None, None),
    "18346": (None, "Wakerift Plateau", None, None),
}
# facility-less Esamir regions (no facility_id in source OR Census): synthetic ids
SYNTHETIC_FACILITY = {"18249", "18262"}


def tile_to_game(tx, ty, scale=1.0):
    return round(scale * S * ty, 1), float(scale * 100 * (2 * tx + ty))


def build(zone, slug):
    regs = json.load(open(f"/tmp/regions-{zone}.json"))["map_region_list"]

    # resolve per-region facility attributes
    resolved = {}  # map_region_id -> dict
    for r in regs:
        mr = r["map_region_id"]
        hexes_in = r.get("map_hexes") or []
        if not hexes_in:
            continue  # water/expanse filler (Oshur 18328/18347)
        fac = r.get("facility_id")
        name = r.get("facility_name")
        ftype = r.get("facility_type_id")
        lx = r.get("location_x")
        lz = r.get("location_z")
        if mr in CENSUS_OVERRIDES:
            ofac, oname, olx, olz = CENSUS_OVERRIDES[mr]
            if ofac:
                fac = ofac
            name = oname
            if olx:
                lx, lz = olx, olz
        if mr in SYNTHETIC_FACILITY:
            fac = mr  # synthetic facility_id = map_region_id
            ftype = "0"
            lx = lz = None  # centroid below
        assert fac, f"no facility_id for region {mr}"
        resolved[mr] = {
            "facility_id": str(fac),
            "facility_name": name,
            "facility_type_id": str(ftype),
            "location_x": str(lx) if lx is not None else None,
            "location_z": str(lz) if lz is not None else None,
            "tiles": [(int(h["x"]), int(h["y"])) for h in hexes_in],
            "links": r.get("facility_links") or [],
        }

    # hexes
    scale = ZONE_SCALE[zone]
    hex_rows = []
    for mr, rd in resolved.items():
        fac = rd["facility_id"]
        flag = 2 if rd["facility_type_id"] == "7" else 0
        pts = []
        for tx, ty in rd["tiles"]:
            gx, gy = tile_to_game(tx, ty, scale)
            pts.append([gx, gy, int(fac), flag])
        pts.sort(key=lambda p: (p[1], p[0]))
        # synthetic regions: location = hex cluster centroid
        if rd["location_x"] is None:
            cx = sum(p[0] for p in pts) / len(pts)
            cy = sum(p[1] for p in pts) / len(pts)
            rd["location_x"] = f"{cx:.6f}"
            rd["location_z"] = f"{cy:.6f}"
        hex_rows.append((int(fac), pts))
    hex_rows.sort(key=lambda t: t[0])
    all_hexes = [row for _, pts in hex_rows for row in pts]

    # regions file (numeric facility_id sort, all-string values)
    fac_info = {}
    for mr, rd in resolved.items():
        f = rd["facility_id"]
        if f not in fac_info:
            fac_info[f] = rd
    regions = [
        {
            "facility_id": f,
            "facility_name": fac_info[f]["facility_name"],
            "facility_type_id": fac_info[f]["facility_type_id"],
            "location_x": fac_info[f]["location_x"],
            "location_y": fac_info[f]["location_z"],  # location_y = location_z verbatim
        }
        for f in sorted(fac_info, key=int)
    ]

    # links: canonical undirected, resolved endpoints via map_region_id
    pairs = set()
    for mr, rd in resolved.items():
        a = rd["facility_id"]
        for l in rd["links"]:
            bmr = (l.get("map_region") or {}).get("map_region_id")
            if bmr and bmr in resolved:
                b = resolved[bmr]["facility_id"]
            else:
                b = str(l["facility_id_b"])  # fallback (should not happen)
                print(f"  WARN: link from {mr} missing map_region, using facility_id_b={b}")
            if a == b:
                continue
            x, y = (a, b) if int(a) < int(b) else (b, a)
            pairs.add((x, y))
    links = [
        {"facility_id_a": a, "facility_id_b": b}
        for a, b in sorted(pairs, key=lambda p: (int(p[0]), int(p[1])))
    ]

    # region_to_facility (source region order, only regions with hexes)
    r2f = {mr: resolved[mr]["facility_id"] for mr in
           [r["map_region_id"] for r in regs if r["map_region_id"] in resolved]}

    # write
    with open(f"{ROOT}/{slug}_hexmap.json", "w") as f:
        f.write(json.dumps({"hexes": all_hexes}, separators=(",", ":")) + "\n")
    with open(f"{ROOT}/{slug}_regions.json", "w") as f:
        f.write(json.dumps(regions, indent=2) + "\n")
    with open(f"{ROOT}/{slug}_links.json", "w") as f:
        f.write(json.dumps(links, indent=2) + "\n")
    with open(f"{ROOT}/{slug}_region_to_facility.json", "w") as f:
        f.write(json.dumps(r2f, indent=2) + "\n")

    n_wg = sum(1 for r in regions if r["facility_type_id"] == "7")
    print(f"{slug}: {len(all_hexes)} hexes, {len(regions)} facilities "
          f"({n_wg} warpgates), {len(links)} links, {len(r2f)} region mappings")


build(2, "indar")
build(8, "esamir")
build(344, "oshur")
