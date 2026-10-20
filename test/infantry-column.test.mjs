// 🪖 Infantry column: right after ☠️ K/D on the main stats table and the Rankings; ranks.json carries inf / infMax / infVeh.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { infTip, infantryShares } from "../infantry.mjs";

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");

test("column order and ranks.json columns", () => {
  assert.match(read("rankings.mjs"), /id: "rkd", label: "☠️ K\/D"[^\n]*\n\s*\{ id: "inf", label: (?:"🪖 Infantry"|tr\("col\.infantry", "🪖 Infantry"\))/);
  assert.match(read("app.js"), /id: "rkd", label: "☠️ K\/D"[^\n]*\n\s*\{ id: "inf", label: (?:"🪖 Infantry"|tr\("col\.infantry", "🪖 Infantry"\))/);
  assert.match(read("scripts/build-ranks.mjs"), /ranks\.cols\.push\("inf", "infMax", "infVeh"\)/);
});

test("hover text names percentile, MAX and vehicle share", () => {
  const t = infTip(81.2, 3.4, 18.8, 90);
  assert.match(t, /81\.2% of lifetime kills — top 10%/);
  assert.match(t, /MAX 3\.4% \(counted as infantry\)/);
  assert.match(t, /vehicles\/turrets 18\.8%/);
  assert.equal(infantryShares(null), null);
});
