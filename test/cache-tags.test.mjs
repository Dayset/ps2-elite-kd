// #66 guard: one module = one ?v= tag everywhere. Two tags for the same module load it twice in the browser — two
// copies of its state, a bug that already happened once (working notes, "two tags make two module instances").
// test-select: imports only
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN = ["", "oracle", "oracle/js", "scripts"]; // folders whose pages / modules load our modules in the browser

export function moduleTags() {
  const tags = new Map(); // module path → Map(tag → [files])
  for (const dir of SCAN) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs).filter((x) => /\.(m?js|html)$/.test(x))) {
      const file = path.join(abs, f);
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(/["'`(]((?:\.{1,2}\/|\/)?[A-Za-z0-9_./-]+\.m?js)\?v=([A-Za-z0-9_.-]+)/g)) {
        const target = path.relative(root, path.resolve(path.dirname(file), m[1].replace(/^\//, root + "/")));
        if (target.startsWith("..")) continue;
        const rel = path.relative(root, file);
        if (!tags.has(target)) tags.set(target, new Map());
        const t = tags.get(target);
        t.set(m[2], [...(t.get(m[2]) || []), rel]);
      }
    }
  }
  return tags;
}

test("every module is loaded with one ?v= tag across all its importers", () => {
  const bad = [];
  for (const [mod, t] of moduleTags()) if (t.size > 1) bad.push(`${mod}: ${[...t].map(([tag, files]) => `${tag} (${[...new Set(files)].join(", ")})`).join(" vs ")}`);
  assert.deepEqual(bad, [], "bump every importer together:\n" + bad.join("\n"));
});

test("the scan finds the module tags (guard against a silent regex break)", () => {
  const t = moduleTags();
  assert.ok(t.size > 30, `only ${t.size} tagged modules found`);
  assert.ok(t.has("padding.mjs") && t.has("live.mjs"));
});
