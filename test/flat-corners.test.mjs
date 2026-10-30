// Owner 2026-10-30: one flat style everywhere — sharp, square corners on every box,
// button, chip, input, bar and card. Only true round symbols may use 50 %
// (spinner, status dots, oracle map markers and their legend swatches).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SKIP = /^(data|data-ps|assets|node_modules|test|oracle\/backend|oracle\/benchmark|oracle\/js\/vendor)\//;
const ROUND_OK = [
  /^\.spinner\b/, /^\.dot\b/, /^\.live-online i\b/,
  /^\.legend \.sw\.(poi|pkring)\b/, /^#map \.pulses\b/,
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.relative(ROOT, path.join(dir, e.name));
    if (e.name.startsWith(".") || SKIP.test(rel + "/")) continue;
    if (e.isDirectory()) walk(path.join(dir, e.name), out);
    else if (/\.(css|html|mjs|js)$/.test(e.name)) out.push(rel);
  }
  return out;
}

test("no rounded corners anywhere (flat style)", () => {
  const bad = [];
  for (const rel of walk(ROOT)) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    for (const m of src.matchAll(/border-radius:\s*([^;"'}\n]+)/g)) {
      const v = m[1].trim();
      if (v === "0" || v === "inherit") continue;
      if (v === "50%") {
        const before = src.slice(0, m.index);
        const sel = before.slice(before.lastIndexOf("}") + 1, before.lastIndexOf("{")).trim();
        if (ROUND_OK.some((r) => sel.split(",").some((s) => r.test(s.trim())))) continue;
      }
      bad.push(`${rel}: border-radius: ${v}`);
    }
    for (const m of src.matchAll(/\brx:\s*([\d.]+)/g)) if (Number(m[1]) !== 0) bad.push(`${rel}: rx ${m[1]}`);
    if (/borderRadius\s*=/.test(src)) bad.push(`${rel}: style.borderRadius`);
  }
  assert.deepEqual(bad, [], "use border-radius: 0 (see claude/working-setup.md, flat style)");
});
