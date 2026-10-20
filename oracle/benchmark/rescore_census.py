#!/usr/bin/env python3
"""Re-score the PS2MapOracle benchmark against Census final scores (issue #5).

Stdlib only. Reads benchmark_predictions.jsonl (never edits it), pulls Census
METAGAME world_event rows (<= 1 request/second, cached in memory), decides each
settled alert's winner from Census final scores (or the Sudden Death kill counts
when a Sudden Death 236-240 on the same world+zone started within 10 min of the
end), recomputes Brier per slice and writes rescored.json.

Headline means skip every alert whose input_status.json entry has
exclude_from_headline: true (Unstable Meltdowns: their Briers are a separate pool,
oracle/benchmark/README.md mismatch 1). Winners are still corrected for all rows.
The flag is read, not the status string, so relabelling does not break this.

Usage: python3 rescore_census.py                 (fetches Census, writes rescored.json)
       python3 rescore_census.py --reaggregate   (no network: recompute the summary
                                                  from the rescored.json already here)
"""
import json, os, sys, time, urllib.request
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
PRED = os.path.join(HERE, "benchmark_predictions.jsonl")
OUT = os.path.join(HERE, "rescored.json")
SERVICE = os.environ.get("CENSUS_SERVICE_ID", "daysetps2legends")
BASE = f"https://census.daybreakgames.com/s:{SERVICE}/get/ps2:v2/world_event/"
F = ("VS", "NC", "TR")
MELTDOWN = set(range(176, 180)) | set(range(186, 194)) | {248, 249, 250}
SUDDEN_DEATH = set(range(236, 241))

_cache, _last = {}, [0.0]


def census(url):
    if url in _cache:
        return _cache[url]
    wait = 1.05 - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                data = json.load(r)
            break
        except Exception:
            if attempt == 2:
                raise
            time.sleep(3)
    _last[0] = time.time()
    _cache[url] = data
    return data


def fetch_events(worlds, oldest_ts):
    """All METAGAME rows for these worlds back to oldest_ts, paging with before=."""
    rows, before = {}, None
    while True:
        url = f"{BASE}?world_id={','.join(map(str, sorted(worlds)))}&type=METAGAME&c:limit=1000"
        if before:
            url += f"&before={before}"
        page = census(url).get("world_event_list", [])
        for r in page:
            rows[(r["world_id"], r["instance_id"], r["metagame_event_state_name"], r["timestamp"])] = r
        if len(page) < 1000:
            break
        lo = min(int(r["timestamp"]) for r in page)
        if lo <= oldest_ts or lo == before:
            break
        before = lo
    return list(rows.values())


def brier(probs, winner):
    return round(sum((probs.get(f, 0) - (1 if f == winner else 0)) ** 2 for f in F) / 3, 4)


def argmax(scores):
    best = max(scores.values())
    top = [f for f in F if scores[f] == best]
    return top[0] if len(top) == 1 else None


STATUS = os.path.join(HERE, "input_status.json")


def excluded_alerts():
    """Alerts with exclude_from_headline true in input_status.json (empty if the file is missing)."""
    try:
        rows = json.load(open(STATUS))["rows"]
    except (OSError, KeyError, ValueError):
        return set()
    return {a for a, v in rows.items() if v.get("exclude_from_headline")}


def aggregate(results, excluded):
    """Headline summary: per (kind, duration, slice) means over non-excluded alerts only."""
    groups = defaultdict(list)
    for r in results:
        if r["alert"] in excluded:
            continue
        for sl, b in r["brier_by_slice"].items():
            groups[(r["kind"], r["duration"], sl)].append(b)
    return [{"kind": k, "duration": d, "slice": sl, "n": len(v), "mean_brier": round(sum(v) / len(v), 4)}
            for (k, d, sl), v in sorted(groups.items(), key=lambda x: (x[0][0], x[0][1] or 0, x[0][2]))]


def print_summary(out):
    print(f"rescored {out['rescored']}/{out['settled_alerts']}; winners changed: {out['winners_changed']}; "
          f"unresolved: {len(out['unresolved'])}; excluded from headline: {out['excluded_from_headline']}")
    print("kind       dur slice        n  mean_brier")
    for g in out["summary"]:
        print(f"{g['kind']:<10} {str(g['duration']):>3} {g['slice']:<11} {g['n']:>3}  {g['mean_brier']:.4f}")


def reaggregate():
    """Recompute the headline fields from the saved rescored.json. No network."""
    out = json.load(open(OUT))
    excluded = excluded_alerts()
    out["excluded_from_headline"] = sum(1 for r in out["alerts"] if r["alert"] in excluded)
    out["excluded_alerts"] = sorted(r["alert"] for r in out["alerts"] if r["alert"] in excluded)
    for r in out["alerts"]:
        r["excluded_from_headline"] = r["alert"] in excluded
    out["summary"] = aggregate(out["alerts"], excluded)
    out["summary_basis"] = "headline: excludes exclude_from_headline alerts (input_status.json)"
    with open(OUT, "w") as fh:
        json.dump(out, fh, indent=1)
    print_summary(out)


def main():
    lines = [json.loads(l) for l in open(PRED) if l.strip()]
    settled = [l for l in lines if l.get("type") == "settled"]
    preds = defaultdict(dict)          # alert -> slice -> probs (last wins)
    iid_from_preds = {}
    for l in lines:
        if l.get("type"):
            continue
        preds[l["alert"]][l["slice"]] = l["probs"]
        if l.get("census_instance_id"):
            iid_from_preds[l["alert"]] = str(l["census_instance_id"])

    worlds = {int(s["alert"].split("-")[0]) for s in settled}
    oldest = min(int(s["ts"]) for s in settled) - 3 * 86400
    rows = fetch_events(worlds, oldest)
    by_iid = defaultdict(list)
    for r in rows:
        by_iid[(int(r["world_id"]), r["instance_id"])].append(r)

    results, unresolved = [], []
    for s in settled:
        parts = s["alert"].split("-")
        world, zone, event = int(parts[0]), int(parts[1]), int(parts[2])
        iid = str(s.get("census_instance_id") or iid_from_preds.get(s["alert"]) or "")
        if not iid:
            unresolved.append({"alert": s["alert"], "reason": "no census_instance_id"})
            continue
        evs = by_iid.get((world, iid), [])
        ended = [r for r in evs if r["metagame_event_state_name"] == "ended"]
        started = [r for r in evs if r["metagame_event_state_name"] == "started"]
        if not ended:
            unresolved.append({"alert": s["alert"], "census_instance_id": iid, "reason": "ended row not found"})
            continue
        end = ended[0]
        if int(end["metagame_event_id"]) != event or int(end["zone_id"]) != zone:
            unresolved.append({"alert": s["alert"], "census_instance_id": iid,
                               "reason": f"instance is event {end['metagame_event_id']} zone {end['zone_id']}"})
            continue
        end_ts = int(end["timestamp"])
        scores = {f: float(end[f"faction_{f.lower()}"]) for f in F}
        basis, winner = "census_final_score", argmax(scores)
        sd = [r for r in rows if int(r["world_id"]) == world and int(r["zone_id"]) == zone
              and int(r["metagame_event_id"]) in SUDDEN_DEATH and r["metagame_event_state_name"] == "started"
              and 0 <= int(r["timestamp"]) - end_ts <= 600]
        sd_info = None
        if sd:
            sd0 = min(sd, key=lambda r: int(r["timestamp"]))
            sd_end = [r for r in by_iid.get((world, sd0["instance_id"]), []) if r["metagame_event_state_name"] == "ended"]
            if not sd_end:
                unresolved.append({"alert": s["alert"], "census_instance_id": iid,
                                   "reason": f"sudden death {sd0['instance_id']} has no ended row"})
                continue
            kills = {f: float(sd_end[0][f"faction_{f.lower()}"]) for f in F}
            basis, winner = "sudden_death_kills", argmax(kills)
            sd_info = {"instance_id": sd0["instance_id"], "event": int(sd0["metagame_event_id"]), "kills": kills}
        if winner is None:
            unresolved.append({"alert": s["alert"], "census_instance_id": iid, "reason": "tie in census scores", "scores": scores})
            continue
        duration = None
        if started:
            mins = (end_ts - int(started[0]["timestamp"])) / 60
            duration = 45 if mins < 67.5 else 90
        slices = preds.get(s["alert"], {})
        results.append({
            "alert": s["alert"], "census_instance_id": iid,
            "kind": "meltdown" if event in MELTDOWN else "territory",
            "duration": duration, "old_winner": s.get("winner"), "census_winner": winner,
            "basis": basis, "final_scores": scores, "sudden_death": sd_info,
            "brier_by_slice": {k: brier(v, winner) for k, v in sorted(slices.items())},
            "old_brier_by_slice": s.get("brier"),
        })

    excluded = excluded_alerts()
    for r in results:
        r["excluded_from_headline"] = r["alert"] in excluded
    summary = aggregate(results, excluded)
    changed = [r["alert"] for r in results if r["old_winner"] != r["census_winner"]]
    out = {"generated_at": int(time.time()), "coin_flip_brier": 0.2222,
           "settled_alerts": len(settled), "rescored": len(results),
           "winners_changed": len(changed), "changed_alerts": changed,
           "unresolved": unresolved,
           "excluded_from_headline": sum(1 for r in results if r["excluded_from_headline"]),
           "excluded_alerts": sorted(r["alert"] for r in results if r["excluded_from_headline"]),
           "summary_basis": "headline: excludes exclude_from_headline alerts (input_status.json)",
           "summary": summary, "alerts": results}
    with open(OUT, "w") as fh:
        json.dump(out, fh, indent=1)
    print_summary(out)


if __name__ == "__main__":
    reaggregate() if "--reaggregate" in sys.argv else main()
