#!/usr/bin/env node
/**
 * #66: run only the tests a change needs.
 *
 *   npm run test:changed   tests that reach the files you changed (vs origin/main + uncommitted + new files),
 *                          plus the i18n and legal guards; switches to the full suite by the rule below
 *   npm run test:live      tests that reach live.mjs / live.html / live-sprites.mjs / scripts/build-live.mjs + guards
 *   npm run test:quick     everything except the real-store tests and the browser tests
 *   npm run test:full      everything (= npm test)
 *
 * Options: --list (print the files, run nothing), --files a,b (pretend these changed), --base <ref>.
 *
 * Which tests a file needs is computed, not tagged by hand: each test's imports are followed (and their imports), and
 * any repo path a test names ("live.html", new URL("styles.css", root)) counts as used. Folders read by pattern get a
 * fixed mapping (PATTERN_READS). A test can add paths with a "// test-select-reaches: a.html b.mjs" comment, or mark its
 * quoted paths as data with "// test-select: imports only".
 *
 * "Really big" = the full suite, automatically, when one of these changed:
 *   - a shared core module (imported directly by CORE_IMPORTERS or more of our modules: i18n.mjs, padding.mjs, …),
 *   - package.json, this script, test/fixtures/, scripts/build-ranks.mjs or a review list in data/ (reviewed, hidden,
 *     not-farm, farm, padding…),
 *   - BIG_CHANGE or more source files at once.
 * A change no test reaches (a new file, a JSON nobody imports) runs the quick tier, never zero tests.
 * The heavy browser tests (HEAVY, > 60 s each) run only in the full suite; CI runs it on every push (tests.yml).
 */
import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const GUARDS = ["test/i18n.test.mjs", "test/legal.test.mjs"];
/** Read the real player store (13k files): 61 of the 73 serial seconds on 2026-10-24. */
export const DATA = ["test/bins.test.mjs", "test/guard-omit-cheaters.test.mjs", "test/session-forensics.test.mjs", "test/wall-of-shame.test.mjs", "test/build-ranks.test.mjs", "test/farm-list.test.mjs", "test/padding.test.mjs", "test/outlier-guard.test.mjs"];
/** Browser tests over a minute each (ranks-no-nan ~90 s; sort-scroll 160 s). */
export const HEAVY = ["test/ranks-no-nan.test.mjs", "test/sort-scroll.test.mjs"];
export const LIVE_ROOTS = ["live.mjs", "live.html", "live-sprites.mjs", "scripts/build-live.mjs"];
export const CORE_IMPORTERS = 5;
export const BIG_CHANGE = 8;
export const PATTERN_READS = [
  ["i18n/", ["test/i18n.test.mjs"]],
  ["oracle/backend/", ["test/oracle-engine.test.mjs", "test/oracle-commander.test.mjs", "test/oracle-focus.test.mjs", "test/oracle-defend.test.mjs"]],
  ["data-ps/", ["test/ps-room.test.mjs", "test/ranks-unique-query.test.mjs"]],
  ["data/", ["test/ranks-unique-query.test.mjs"]],
];
const ALWAYS_FULL = /^(package\.json|scripts\/test-select\.mjs|test\/fixtures\/|scripts\/build-ranks\.mjs|data(-ps)?\/(reviewed|hidden|not-farm|farm|padding)[^/]*\.json$)/;

const exists = (p) => { try { return fs.statSync(p); } catch { return null; } };
const LIT = /(["'`])((?:\.{1,2}\/|[A-Za-z0-9_-]+\/)?[A-Za-z0-9_./-]+\.(?:mjs|js|json|html|css|jsonl|py|yml))(?:\?[^"'`]*)?\1/g;
const IMP = /(?:import|export)\s[^;]*?from\s*(["'])([^"']+)\1|import\s*\(\s*(["'])([^"']+)\3|import\s+(["'])([^"']+)\5/g;

/** Repo files a file reaches: static/dynamic imports followed, and for test files every repo path named. */
export function reach(file, memo = new Map()) {
  if (memo.has(file)) return memo.get(file);
  const deps = new Set();
  memo.set(file, deps);
  let src = "";
  try { src = fs.readFileSync(file, "utf8"); } catch { return deps; }
  const dir = path.dirname(file);
  const add = (spec, follow) => {
    const clean = spec.split("?")[0];
    for (const base of [dir, root]) {
      const abs = path.resolve(base, clean);
      if (!abs.startsWith(root)) continue;
      const st = exists(abs);
      if (st && st.isFile()) {
        const rel = path.relative(root, abs).split(path.sep).join("/");
        if (!deps.has(rel)) { deps.add(rel); if (follow && /\.m?js$/.test(abs)) for (const d of reach(abs, memo)) deps.add(d); }
        return;
      }
    }
  };
  for (const m of src.matchAll(IMP)) add(m[2] || m[4] || m[6], true);
  if (!/[\\/]test[\\/]/.test(file)) return deps;
  // a test can name what it uses that no import or quoted path shows: "// test-select-reaches: live.html live.mjs";
  // "// test-select: imports only" = its quoted paths are data, not files it uses
  for (const m of src.matchAll(/test-select-reaches:([^\n]*)/g)) for (const f of m[1].trim().split(/\s+/)) if (f) add(f, /\.m?js$/.test(f));
  if (!/test-select: imports only/.test(src)) for (const m of src.matchAll(LIT)) add(m[2], /\.m?js$/.test(m[2]));
  return deps;
}

/** Direct importers per module among our own modules (root *.mjs/*.js and scripts/). */
export function importers() {
  const fan = new Map();
  const files = fs.readdirSync(root).filter((x) => /\.m?js$/.test(x)).concat(fs.readdirSync(path.join(root, "scripts")).filter((x) => /\.m?js$/.test(x)).map((x) => `scripts/${x}`));
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    for (const m of src.matchAll(IMP)) {
      const sp = (m[2] || m[4] || m[6]).split("?")[0];
      if (!sp.startsWith(".")) continue;
      const r = path.relative(root, path.resolve(root, path.dirname(f), sp)).split(path.sep).join("/");
      fan.set(r, (fan.get(r) || 0) + 1);
    }
  }
  return fan;
}

export function allTests() {
  return fs.readdirSync(path.join(root, "test")).filter((f) => f.endsWith(".test.mjs")).sort().map((f) => `test/${f}`);
}

/** { files, why } for a tier; `changed` = the changed paths for the changed tier. */
export function select(tier, changed = []) {
  const tests = allTests();
  const memo = new Map();
  const deps = new Map(tests.map((t) => [t, reach(path.join(root, t), memo)]));
  const browser = new Set(tests.filter((t) => /chromium|playwright/i.test(fs.readFileSync(path.join(root, t), "utf8"))));
  const reaching = (files) => tests.filter((t) => files.some((f) => deps.get(t).has(f)));
  const quick = () => tests.filter((t) => !DATA.includes(t) && !browser.has(t));
  if (tier === "full") return { files: tests, why: "full" };
  if (tier === "quick") return { files: quick(), why: "quick" };
  if (tier === "live") return { files: [...new Set([...reaching(LIVE_ROOTS), ...LIVE_ROOTS.filter((f) => f.startsWith("test/")), ...GUARDS])].filter((t) => tests.includes(t)), why: "live" };
  const fan = importers();
  const src = changed.filter((f) => /\.(m?js|html|css)$/.test(f) && !f.startsWith("test/"));
  const core = changed.find((f) => (fan.get(f) || 0) >= CORE_IMPORTERS);
  const big = core ? `shared core ${core} (${fan.get(core)} modules import it)`
    : changed.find((f) => ALWAYS_FULL.test(f)) ? `build / test setup: ${changed.find((f) => ALWAYS_FULL.test(f))}`
    : src.length >= BIG_CHANGE ? `${src.length} source files changed`
    : null;
  if (big) return { files: tests, why: `full: ${big}` };
  const direct = changed.filter((f) => tests.includes(f));
  const hit = [...new Set([...reaching(changed), ...PATTERN_READS.filter(([p]) => changed.some((f) => f.startsWith(p))).flatMap(([, t]) => t)])].filter((t) => !HEAVY.includes(t));
  if (!hit.length && !direct.length) {
    return changed.some((f) => /\.(m?js|html|css|json)$/.test(f)) ? { files: quick(), why: "quick: no test reaches the change" } : { files: [], why: "nothing to test" };
  }
  return { files: [...new Set([...direct, ...hit, ...GUARDS])].filter((t) => tests.includes(t)), why: `changed: ${changed.length} files → ${hit.length} tests reach them` };
}

/** Changed paths: commits ahead of base + uncommitted + new untracked files. */
export function changedFiles(base = "origin/main") {
  const run = (c) => { try { return execSync(c, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return ""; } };
  return [...new Set((run(`git diff --name-only ${base}...HEAD`) + run("git diff --name-only HEAD") + run("git ls-files --others --exclude-standard")).split("\n").map((s) => s.trim()).filter(Boolean))];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const tier = arg("--tier") || "changed";
  const changed = tier === "changed" ? (arg("--files") ? arg("--files").split(",").filter(Boolean) : changedFiles(arg("--base") || "origin/main")) : [];
  const { files, why } = select(tier, changed);
  console.error(`[test-select] ${why}: ${files.length} test file(s)`);
  if (process.argv.includes("--list")) { console.log(files.join("\n")); process.exit(0); }
  if (!files.length) process.exit(0);
  const r = spawnSync(process.execPath, ["--test", ...files], { cwd: root, stdio: "inherit" });
  process.exit(r.status == null ? 1 : r.status);
}
