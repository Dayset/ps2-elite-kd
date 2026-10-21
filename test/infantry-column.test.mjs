// 🪖 Infantry column + table column order on the main stats table and the Rankings;
// ranks.json carries inf / infMax / infVeh. Column order (Dayset 2026-10-21):
// ☠️ K/D sits right after 🛡️ Resist, and 🔀 Diff before 🪳 Zerg (swapped), 🪖 last.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { infTip, infantryShares } from "../infantry.mjs";

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");

test("column order and ranks.json columns", () => {
  for (const f of ["rankings.mjs", "app.js"]) {
    const src = read(f);
    const at = (id) => src.indexOf(`id: "${id}"`);
    assert.ok(at("rf") >= 0 && at("rf") < at("rkd"), `${f}: ☠️ K/D right after 🛡️ Resist`);
    assert.ok(at("rkd") < at("cons"), `${f}: ☠️ K/D before ⚡ Const`);
    assert.ok(at("apk") < at("diff") && at("diff") < at("zerg") && at("zerg") < at("inf"), `${f}: 🔀 Diff before 🪳 Zerg (swapped), 🪖 Infantry last`);
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
