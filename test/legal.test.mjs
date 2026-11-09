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

const PAGES = ["index.html", "live.html", "columns.html", "privacy.html", "updates.html", "misc.html", "ranks.html", "build-log.html", "outfits.html", "weapon-compare.html", "weapon-adad.html", "weapon-sage-gd22s.html", "weapon-sage-19a-fortuna.html", "weapon-sage-99sv.html", "weapon-sage-ac-x11.html", "weapon-sage-advx-mako.html", "weapon-sage-af-19-mercenary.html", "weapon-sage-af-20-rogue.html", "weapon-sage-af-4-cyclone.html", "weapon-sage-af-4a-bandit.html", "weapon-sage-af-57-piston.html", "weapon-sage-af-8-railjack.html", "weapon-sage-ar-100.html", "weapon-sage-as16-nighthawk.html", "weapon-sage-beamer-vs3.html", "weapon-sage-betelgeuse-54-a.html", "weapon-sage-bighorn-50m.html", "weapon-sage-blitz-gd-10.html", "weapon-sage-carnage-ar.html", "weapon-sage-cb-100.html", "weapon-sage-cb-200.html", "weapon-sage-cb-arx-newton.html", "weapon-sage-cb-x75.html", "weapon-sage-cerberus.html", "weapon-sage-chaos.html", "weapon-sage-cme.html", "weapon-sage-corvus-va55.html", "weapon-sage-cycler-trv.html", "weapon-sage-darkstar.html", "weapon-sage-deimos-va29.html", "weapon-sage-eclipse-ve3a.html", "weapon-sage-ectoblaster.html", "weapon-sage-em1.html", "weapon-sage-em4-longshot.html", "weapon-sage-em6.html", "weapon-sage-equinox-ve2-burst.html", "weapon-sage-equinox-ve2.html", "weapon-sage-eridani-sx5.html", "weapon-sage-fa1-barrage.html", "weapon-sage-flare-ve6.html", "weapon-sage-gauss-prime.html", "weapon-sage-gauss-rifle-burst.html", "weapon-sage-gauss-rifle-s.html", "weapon-sage-gauss-spr.html", "weapon-sage-gd-66-claw.html", "weapon-sage-gd-7f.html", "weapon-sage-ghost.html", "weapon-sage-gr-22.html", "weapon-sage-h-v45.html", "weapon-sage-havoc.html", "weapon-sage-hc1-cougar.html", "weapon-sage-hsg-400.html", "weapon-sage-impetus.html", "weapon-sage-ksr-35.html", "weapon-sage-la1-anchor.html", "weapon-sage-la3-desperado.html", "weapon-sage-la39-bruiser.html", "weapon-sage-la8-rebel.html", "weapon-sage-la80.html", "weapon-sage-lc2-lynx.html", "weapon-sage-lc3-jaguar.html", "weapon-sage-m77-b.html", "weapon-sage-manticore-sx40.html", "weapon-sage-mauler-s6.html", "weapon-sage-mg-c1-kindred.html", "weapon-sage-mg-h1-watchman.html", "weapon-sage-mg-s1-jackal.html", "weapon-sage-mgr-c1-charger.html", "weapon-sage-mgr-l1-promise.html", "weapon-sage-mgr-s1-gladius.html", "weapon-sage-mkv-suppressed.html", "weapon-sage-moonshot.html", "weapon-sage-msw-r.html", "weapon-sage-nc05-jackhammer.html", "weapon-sage-nc08-mag-scatter.html", "weapon-sage-nc1-gauss-rifle.html", "weapon-sage-nc12-sweeper.html", "weapon-sage-nc14-bolt-driver.html", "weapon-sage-nc2-gauss-compact.html", "weapon-sage-nc4-mag-shot.html", "weapon-sage-nc6-gauss-saw.html", "weapon-sage-nc6a-godsaw.html", "weapon-sage-nc6s-gauss-saw-s.html", "weapon-sage-nc9-a-tross.html", "weapon-sage-nova.html", "weapon-sage-ns-11a.html", "weapon-sage-ns-11c.html", "weapon-sage-ns-11p.html", "weapon-sage-ns-15m2.html", "weapon-sage-ns-357-ia.html", "weapon-sage-ns-357-underboss.html", "weapon-sage-ns-44-commissioner.html", "weapon-sage-ns-44l-blackhand.html", "weapon-sage-ns-44l-showdown.html", "weapon-sage-ns-45-pilot.html", "weapon-sage-ns-61-emissary.html", "weapon-sage-ns-66-punisher.html", "weapon-sage-ns-7-pdw.html", "weapon-sage-ns-am7-archer.html", "weapon-sage-ns-baron-g5.html", "weapon-sage-ns-viscount-g6.html", "weapon-sage-nsx-daimyo.html", "weapon-sage-nsx-kappa.html", "weapon-sage-nsx-tanto.html", "weapon-sage-nsx-tengu.html", "weapon-sage-nsx-yawara.html", "weapon-sage-nsx-yumi.html", "weapon-sage-orion-vs54.html", "weapon-sage-pandora-vx25.html", "weapon-sage-parallax-vx3.html", "weapon-sage-parsec-vx3-a.html", "weapon-sage-pdw-16-hailstorm.html", "weapon-sage-phantom-va23.html", "weapon-sage-phaseshift-vx-s.html", "weapon-sage-phobos-vx86.html", "weapon-sage-pmg-100.html", "weapon-sage-pmg-200.html", "weapon-sage-pmg-3xb.html", "weapon-sage-pmg-arx-schrodinger.html", "weapon-sage-prominence-ve4.html", "weapon-sage-pulsar-c.html", "weapon-sage-pulsar-lsw.html", "weapon-sage-pulsar-vs1.html", "weapon-sage-rams-50m.html", "weapon-sage-razor-gd-23.html", "weapon-sage-reaper-dmr.html", "weapon-sage-sabr-13.html", "weapon-sage-sas-r.html", "weapon-sage-serpent-ve92.html", "weapon-sage-sg-100.html", "weapon-sage-sg-a25.html", "weapon-sage-sg-arx-rutherford.html", "weapon-sage-shuriken.html", "weapon-sage-sirius-sx12.html", "weapon-sage-skorpios.html", "weapon-sage-smg-46-armistice.html", "weapon-sage-solstice-burst.html", "weapon-sage-solstice-ve3.html", "weapon-sage-spiker.html", "weapon-sage-sr-100.html", "weapon-sage-sr-150.html", "weapon-sage-sr-7.html", "weapon-sage-sr-arx-einstein.html", "weapon-sage-sr-l75.html", "weapon-sage-sva-88.html", "weapon-sage-t1-cycler.html", "weapon-sage-t16-rhino.html", "weapon-sage-t1a-unity.html", "weapon-sage-t1b-cycler.html", "weapon-sage-t1s-cycler.html", "weapon-sage-t32-bull.html", "weapon-sage-t4-amp.html", "weapon-sage-t5-amc.html", "weapon-sage-t9-carv-s.html", "weapon-sage-t9-carv.html", "weapon-sage-t9a-butcher.html", "weapon-sage-tar.html", "weapon-sage-tas-16-blackjack.html", "weapon-sage-tempest.html", "weapon-sage-terminus-vx-9.html", "weapon-sage-thanatos-ve70.html", "weapon-sage-the-brawler.html", "weapon-sage-the-executive.html", "weapon-sage-the-immortal.html", "weapon-sage-the-president.html", "weapon-sage-tmg-50.html", "weapon-sage-torq-9.html", "weapon-sage-trac-5-burst.html", "weapon-sage-trac-5-s.html", "weapon-sage-trac-5.html", "weapon-sage-trac-shot.html", "weapon-sage-trap-m1.html", "weapon-sage-trs-12-uppercut.html", "weapon-sage-ts2-inquisitor.html", "weapon-sage-ts4-haymaker.html", "weapon-sage-tsar-42.html", "weapon-sage-tx1-repeater.html", "weapon-sage-tx2-emperor.html", "weapon-sage-u-100-lastly.html", "weapon-sage-u-150-recall.html", "weapon-sage-u-200-harbinger.html", "weapon-sage-u-arx-dirac.html", "weapon-sage-ursa.html", "weapon-sage-v10.html", "weapon-sage-va39-spectre.html", "weapon-sage-ve-c-horizon.html", "weapon-sage-ve-h-maw.html", "weapon-sage-ve-s-canis.html", "weapon-sage-vx29-polaris.html", "weapon-sage-vx6-7.html", "weapon-sage-xm98.html", "weapon-sage-xmg-100.html", "weapon-sage-zenith-vx-5.html", "archive.html", "oracle/index.html"];
// Rendered archive pages (scripts/build-archive.mjs): same third-party / tracker guards as PAGES.
const ARCHIVE_PAGES = fs.readdirSync(path.join(ROOT, "archive/pages")).filter((f) => f.endsWith(".html")).map((f) => `archive/pages/${f}`);
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
  for (const page of [...PAGES, ...ARCHIVE_PAGES]) {
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
  const TRACKERS = /google-analytics|googletagmanager|(?<![A-Za-z])gtag\(|plausible\.io|umami\.is|static\.cloudflareinsights|beacon\.min\.js|sentry\.io|@sentry|sentry-cdn|sentry\.min\.js|hotjar|clarity\.ms|connect\.facebook|matomo|segment\.com|mixpanel/i;
  for (const f of [...PAGES, ...ARCHIVE_PAGES, ...SITE_JS]) assert.doesNotMatch(read(f), TRACKERS, `${f}: tracker found (update PRIVACY.md first)`);
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
