// Portal pages load styles.css with one shared ?v= tag. A split tag serves
// stale CSS to returning visitors (the portal nav rules live in styles.css),
// so every portal page must move together when the tag bumps.
// test-select: imports only
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The eight portal pages (dense guide has its own inline CSS, no styles.css;
// build-log and the archived pages keep their own tags and are out of scope).
const PORTAL = ["index.html", "live.html", "weapon-compare.html", "outfits.html", "columns.html", "archive.html", "updates.html", "privacy.html"];

test("portal pages share one styles.css ?v= tag", () => {
  const tags = new Map();
  for (const f of PORTAL) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    const found = [...src.matchAll(/styles\.css\?v=([A-Za-z0-9_.-]+)/g)].map((x) => x[1]);
    assert.equal(found.length, 1, `${f}: expected one styles.css tag, found ${found.length}`);
    tags.set(f, found[0]);
  }
  assert.equal(
    new Set(tags.values()).size,
    1,
    `split styles.css tags: ${[...tags].map(([f, t]) => `${f}=${t}`).join(", ")}`
  );
});
