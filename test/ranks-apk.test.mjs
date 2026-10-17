import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
test("ranks.json keeps the 🤝 apk column", () => {
  const r = JSON.parse(readFileSync(new URL("../data/ranks.json", import.meta.url), "utf8"));
  const i = r.cols.indexOf("apk");
  assert.ok(i >= 0, "apk column missing");
  assert.ok(r.rows.some((row) => Number.isFinite(row[i])), "no apk values");
});
test("CI rebuilds derived files after a rebase", () => {
  const s = readFileSync(new URL("../scripts/ci-commit-push.sh", import.meta.url), "utf8");
  const w = readFileSync(new URL("../.github/workflows/refresh-cache.yml", import.meta.url), "utf8");
  assert.match(s, /REBUILD_DERIVED/);
  assert.match(w, /REBUILD_DERIVED=.*build-ranks/);
});
