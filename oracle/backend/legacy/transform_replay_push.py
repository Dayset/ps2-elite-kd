#!/usr/bin/env python3
"""Transform replay_library.json into the push_replays action shape."""
import json, os, sys

ROOT = os.path.dirname(os.path.abspath(__file__))


def main():
    lib = json.load(open(os.path.join(ROOT, "replay_library.json")))
    out = {"alerts": []}
    for a in lib["alerts"]:
        ticks = []
        for t in a["ticks"]:
            win = {}
            for f in ("VS", "NC", "TR"):
                w = t["win"][f]
                lvl = w["level"] if w["level"] != "none" else "trunk"
                win[f] = {"pct": w["pct"], "level": lvl, "n": w["n"],
                          "trunk": w["trunk"]}
            tick = {
                "t": t["t"], "terr": t["terr"], "win": win,
                "momentum": t["mom"], "owners": t["owner"], "calls": t["calls"],
            }
            if t.get("second"):
                tick["second"] = t["second"]
            ticks.append(tick)
        out["alerts"].append({"id": a["id"], "label": a["label"],
                              "date": a["date"], "ticks": ticks})
        # one file per alert for manageable push sizes
        json.dump({"alerts": [out["alerts"][-1]]},
                  open(os.path.join(ROOT, f"push_{a['id']}.json"), "w"))
    json.dump(out, open(os.path.join(ROOT, "replay_library_push.json"), "w"))
    print("alerts:", len(out["alerts"]),
          "ticks:", sum(len(a["ticks"]) for a in out["alerts"]))


if __name__ == "__main__":
    main()
