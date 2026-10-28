/**
 * Legal and privacy guards (#61). These keep PRIVACY.md / NOTICE true:
 * no runtime dependencies, no third-party scripts or trackers, no cookies,
 * no raw IP addresses at rest, short-lived sign-in attempts, and the legal
 * files linked where people look for them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const exists = (f) => fs.existsSync(path.join(ROOT, f));

const PAGES = ["index.html", "live.html", "columns.html", "privacy.html", "updates.html", "misc.html", "ranks.html", "build-log.html", "oracle/index.html"];
const SITE_JS = [
  ...fs.readdirSync(ROOT).filter((f) => /\.(m?js)$/.test(f)),
  ...fs.readdirSync(path.join(ROOT, "oracle/js")).filter((f) => f.endsWith(".js")).map((f) => `oracle/js/${f}`),
];

test("legal files exist and the README points to them", () => {
  assert.match(read("LICENSE"), /^MIT License/);
  for (const f of ["NOTICE", "PRIVACY.md", "SECURITY.md", "DATA_SOURCES.md", ".github/ISSUE_TEMPLATE/config.yml", ".github/workflows/removal-autoreply.yml"]) assert.ok(exists(f), `${f} exists`);
  const readme = read("README.md");
  for (const f of ["LICENSE", "NOTICE", "PRIVACY.md", "SECURITY.md", "DATA_SOURCES.md"]) assert.ok(readme.includes(`(${f}`), `README links ${f}`);
  assert.match(read("NOTICE"), /NOT cover/, "NOTICE carves third-party content out of MIT");
});

test("no runtime dependencies (NOTICE says so)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.license, "MIT");
  for (const k of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    assert.ok(!pkg[k] || !Object.keys(pkg[k]).length, `package.json ${k} must stay empty, or list it in NOTICE and update this test`);
  }
});

test("pages load no third-party scripts, styles, fonts, frames or images", () => {
  for (const page of PAGES) {
    const html = read(page);
    for (const m of html.matchAll(/<(script|link|iframe|img|source|video|audio|embed|object)\b[^>]*>/gi)) {
      const tag = m[0];
      const url = (/\s(?:src|href|data)="([^"]+)"/i.exec(tag) || [])[1] || "";
      if (!/^(https?:)?\/\//i.test(url)) continue;
      const own = /^https:\/\/dayset\.github\.io\/ps2-elite-kd\//.test(url);
      const meta = /rel="(canonical|alternate)"/i.test(tag);
      assert.ok(own && (meta || /<a\b/i.test(tag)), `${page}: external resource ${url} (PRIVACY.md promises none)`);
    }
    assert.doesNotMatch(html, /@import\s+url\(\s*["']?https?:/i, `${page}: no external @import`);
  }
  for (const css of ["styles.css", "live.css", "site-layout.css", "oracle/oracle.css"]) {
    if (exists(css)) assert.doesNotMatch(read(css), /url\(\s*["']?https?:|@import\s+["']https?:/i, `${css}: no external CSS resources`);
  }
});

test("no analytics, trackers or error reporters", () => {
  const TRACKERS = /google-analytics|googletagmanager|(?<![A-Za-z])gtag\(|plausible\.io|umami\.is|static\.cloudflareinsights|beacon\.min\.js|sentry|hotjar|clarity\.ms|connect\.facebook|matomo|segment\.com|mixpanel/i;
  for (const f of [...PAGES, ...SITE_JS]) assert.doesNotMatch(read(f), TRACKERS, `${f}: tracker found (update PRIVACY.md first)`);
});

test("the site never writes a cookie (only clears old ones)", () => {
  for (const f of SITE_JS) {
    const src = read(f);
    const writes = [...src.matchAll(/document\.cookie\s*=(?!=)/g)];
    if (!writes.length) continue;
    assert.ok(/function wipeAppCookies/.test(src), `${f} writes document.cookie`); // only the 🗑️ wipe (app.js part local-cache.mjs, #66)
    const start = src.indexOf("function wipeAppCookies");
    const indent = src.slice(src.lastIndexOf("\n", start) + 1, start);
    const end = src.indexOf(`\n${indent}}\n`, start);
    for (const w of writes) assert.ok(w.index > start && w.index < end, "cookie writes only inside wipeAppCookies (expiring them)");
    assert.match(src.slice(start, end), /01 Jan 1970/);
  }
});

test("privacy notice is linked from the main page, the live page and the oracle", () => {
  for (const f of ["index.html", "live.html"]) assert.match(read(f), /href="privacy\.html"/, `${f} footer links privacy.html`);
  assert.match(read("oracle/index.html"), /href="\.\.\/privacy\.html"/);
  assert.match(read("oracle/js/vote.js"), /privacy\.html/, "sign-in text links the notice");
  const p = read("privacy.html");
  assert.match(p, /id="rmBox"/, "self-service removal box");
  assert.match(p, /PRIVACY\.md/);
  assert.match(read("sitemap.xml"), /privacy\.html/);
  assert.match(read("index.html"), /registered trademarks of Daybreak Game Company LLC/);
});

test("cache Worker: visitor IPs become a keyed hash, never a KV key", async () => {
  const src = read("worker/src/worker.js");
  assert.doesNotMatch(src, /`rl:ip:\$\{ip\}/, "raw IP in a KV key");
  const { ipTag } = await import("../worker/src/worker.js");
  const a = await ipTag("203.0.113.7", "secret-1");
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(a, await ipTag("203.0.113.7", "secret-1"), "stable within a secret");
  assert.notEqual(a, await ipTag("203.0.113.7", "secret-2"), "depends on the secret");
  assert.notEqual(a, await ipTag("203.0.113.8", "secret-1"));
  assert.ok(!a.includes("203"));
});

let sqlite = null;
try {
  sqlite = await import("node:sqlite");
} catch {
  sqlite = null;
}

function fakeD1() {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(read("oracle-worker/schema.sql"));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async first() { return db.prepare(sql).get(...args) ?? null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() { db.prepare(sql).run(...args); return { meta: {} }; },
    _exec() { return db.prepare(sql).run(...args); },
  });
  return { raw: db, prepare: (sql) => stmt(sql), async batch(l) { return l.map((s) => s._exec()); } };
}

test("oracle: sign-in attempts store a keyed IP hash and are pruned after a day", { skip: !sqlite && "node:sqlite unavailable (needs Node >= 22.5)" }, async () => {
  const { ipHash, CHALLENGE_KEEP_S } = await import("../oracle-worker/src/auth.js");
  const { pruneStatements } = await import("../oracle-worker/src/index.js");
  const DB = fakeD1();
  const h = await ipHash(DB, "198.51.100.23");
  assert.equal(h, await ipHash(DB, "198.51.100.23"));
  assert.notEqual(h, await ipHash(DB, "198.51.100.24"));
  assert.ok(!h.includes("198.51"));
  const plain = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("ip|198.51.100.23"));
  const plainHex = Array.from(new Uint8Array(plain), (b) => b.toString(16).padStart(2, "0")).join("");
  assert.ok(!plainHex.startsWith(h), "not the old unsalted SHA-256");

  assert.equal(CHALLENGE_KEEP_S, 86400);
  const now = 1_800_000_000;
  const ins = DB.raw.prepare("INSERT INTO challenge (id, cid, name, created, status, ip_hash) VALUES (?, '1', 'A', ?, 'expired', ?)");
  ins.run("old", now - 2 * 86400, h);
  ins.run("new", now - 3600, h);
  await DB.batch(pruneStatements(DB, now));
  assert.deepEqual(DB.raw.prepare("SELECT id FROM challenge").all().map((r) => r.id), ["new"]);
});

test("public hide lists and review notes never call a player a cheater (#61)", () => {
  for (const f of ["data/hidden.json", "data-ps/hidden.json", "data/reviewed.json", "data-ps/reviewed.json"]) {
    if (!exists(f)) continue;
    const j = JSON.parse(read(f));
    const players = j.players || {};
    for (const [k, v] of Object.entries(players)) {
      const text = [v && v.reason, v && v.note].filter(Boolean).join(" ");
      assert.doesNotMatch(text, /cheat/i, `${f}: ${k} — use "excluded after review" / "flagged: impossible stats"`);
      if (f.endsWith("hidden.json") && /^(excluded after review|flagged: impossible stats)/.test(String(v.reason || ""))) assert.ok(["excluded", "flagged"].includes(v.kind), `${f}: ${k} needs kind`);
    }
  }
});
