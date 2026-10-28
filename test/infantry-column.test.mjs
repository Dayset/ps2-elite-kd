// 🪖 Infantry column + table column order on the main stats table and the Rankings;
// ranks.json carries inf / infMax / infVeh. Column order (Dayset 2026-10-21):
// ☠️ K/D sits right after 🛡️ Resist, 🪳 Zerg before 🪖 last (visible);
// 🔀 Diff is debug-only since 2026-10-28 (owner: low value currently).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { infTip, infantryShares } from "../infantry.mjs";

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");

test("column order and ranks.json columns", () => {
  for (const f of ["rankings.mjs", "stats-table.mjs"]) { // the main stats table moved out of app.js (#66)
    const src = read(f);
    const at = (id) => src.indexOf(`id: "${id}"`);
    assert.ok(at("rf") >= 0 && at("rf") < at("rkd"), `${f}: ☠️ K/D right after 🛡️ Resist`);
    assert.ok(at("rkd") < at("cons"), `${f}: ☠️ K/D before ⚡ Const`);
    // 🔀 Diff is debug-only (owner 2026-10-28): visible order keeps 🪖 last.
    assert.ok(at("apk") < at("zerg") && at("zerg") < at("inf"), `${f}: 🤝 Assists, 🪳 Zerg, 🪖 Infantry last (visible)`);
    const dbg = f === "rankings.mjs"
      ? src.slice(src.indexOf("const DEBUG = ["), src.indexOf("const PUBLIC = ["))
      : src.slice(src.indexOf("const adjDebugCols = ["), src.indexOf("];", src.indexOf("const adjDebugCols = [")));
    assert.ok(dbg.indexOf('id: "inflation"') >= 0 && dbg.indexOf('id: "inflation"') < dbg.indexOf('id: "diff"'), `${f}: 🔀 Diff in debug, after 🎈 Inflation`);
  }
  assert.match(read("scripts/build-ranks.mjs"), /ranks\.cols\.push\("inf", "infMax", "infVeh"\)/);
});

test("hover text names percentile, MAX and vehicle share", () => {
  const t = infTip(81.2, 3.4, 18.8, 90);
  assert.match(t, /81\.2% of lifetime kills — top 10%/);
  assert.match(t, /MAX 3\.4% \(counted as infantry\)/);
  assert.match(t, /vehicles\/turrets 18\.8%/);
  assert.equal(infantryShares(null), null);
});
