// Archive section (scripts/build-archive.mjs): the CMDRCyrious / Iridar archive on the site.
// Guards: every archived page is rendered with attribution, lost pages are stubs (never
// articles), no page hotlinks third-party content, the committed output matches the
// generator, and the Toolbox zip is a valid download.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEntries, checkAll, ARCHIVE_PIN } from "../scripts/build-archive.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const exists = (p) => fs.existsSync(path.join(root, p));
const pagesDir = path.join(root, "archive/pages");

const { entries } = buildEntries();
const bySlug = new Map(entries.map((e) => [e.slug, e]));

test("inventory: 166 entries — 152 readable articles, 12 lost, 2 video records", () => {
  assert.equal(entries.length, 166);
  assert.equal(entries.filter((e) => e.status === "ok").length, 152);
  assert.equal(entries.filter((e) => e.status === "lost").length, 12);
  assert.equal(entries.filter((e) => e.status === "video").length, 2);
  const slugs = entries.map((e) => e.slug);
  assert.equal(new Set(slugs).size, slugs.length, "no duplicate slugs");
});

test("every entry carries attribution: title, page, source URL, archive date", () => {
  for (const e of entries) {
    assert.ok(e.title, `${e.slug}: title`);
    assert.ok(e.page, `${e.slug}: page`);
    assert.ok(e.originalUrl, `${e.slug}: originalUrl`);
    assert.equal(e.saved, "2026-11-09", `${e.slug}: saved date`);
    assert.ok(e.publisher, `${e.slug}: publisher`);
  }
});

test("Angular Size post is captured, not pending (saved by hand after the INDEX was written)", () => {
  const e = bySlug.get("angular-size-reddit-post");
  assert.ok(e, "entry exists");
  assert.equal(e.status, "ok");
  assert.equal(e.source, "Hand-saved (MHTML)");
  assert.equal(e.author, "u/Iridar51");
  assert.equal(e.date, "2017-09-10");
  assert.equal(e.currency, "dead");
});

test("every rendered page exists, has its attribution box and back link, one CSS pin", () => {
  const files = fs.readdirSync(pagesDir).filter((f) => f.endsWith(".html")).sort();
  assert.equal(files.length, entries.length, "one page per entry");
  for (const e of entries) {
    assert.ok(files.includes(`${e.slug}.html`), `${e.slug}: page file exists`);
    const html = read(e.page);
    assert.ok(html.includes('class="arc-attr"'), `${e.slug}: attribution box`);
    assert.ok(html.includes('href="../archive.html"'), `${e.slug}: back link to the Archive`);
    assert.ok(html.includes(`archive.css?v=${ARCHIVE_PIN}`), `${e.slug}: archive.css pin ${ARCHIVE_PIN}`);
    assert.ok(html.includes("styles.css?v=20261108-g2f1"), `${e.slug}: shared styles.css pin`);
    assert.ok(!html.includes("<img"), `${e.slug}: no <img> (images were not preserved; placeholders only)`);
    assert.ok(!html.includes("<iframe"), `${e.slug}: no <iframe>`);
    assert.ok(!/<script[^>]+src="https?:\/\//.test(html), `${e.slug}: no third-party script`);
  }
});

test("lost pages are stubs: lost notice, what survives — never an article body", () => {
  for (const e of entries.filter((x) => x.status === "lost")) {
    const html = read(e.page);
    assert.ok(html.includes('class="arc-lost"'), `${e.slug}: lost notice`);
    assert.ok(!html.includes('<article class="arc-body">'), `${e.slug}: no article body`);
    assert.ok(e.what && e.survives, `${e.slug}: what-it-was and what-survives recorded`);
  }
  const lostNames = entries.filter((e) => e.status === "lost").map((e) => e.slug).sort();
  assert.deepEqual(lostNames, [
    "epic-montage-dangerous",
    "find-an-outfit",
    "http-cmdrcyrious-com-planetside2-weapons",
    "new-version-of-toolbox-released",
    "new-weapon-guides-released",
    "ns-15m2-vs-automatic-scout-rifle",
    "planetside2__beginner-guides__how-to-capture-a-base",
    "planetside2__beginner-guides__how-to-get-to-the-battle",
    "planetside2__beginner-guides__how-to-kill",
    "planetside2__beginner-guides__progressing-your-character",
    "planetside2__critical-mass-alerts",
    "vr-training",
  ]);
});

test("article bodies carry no raw HTML from the source (no <script>/<iframe> smuggled in)", () => {
  for (const e of entries.filter((x) => x.status === "ok")) {
    const html = read(e.page);
    const body = (html.split('<article class="arc-body">')[1] || "").split("</article>")[0];
    assert.ok(body, `${e.slug}: article body exists`);
    assert.ok(!/<script/i.test(body), `${e.slug}: no script in the article body`);
    assert.ok(!/<iframe/i.test(body), `${e.slug}: no iframe in the article body`);
  }
});

test("archive.html: inventory links every entry, lost list names all 12, Toolbox linked", () => {
  const home = read("archive.html");
  assert.ok(home.includes('href="archive.html"') || home.includes("archive.html"), "self link");
  for (const e of entries) assert.ok(home.includes(`href="${e.page}"`), `${e.slug}: in the inventory`);
  assert.equal((home.match(/<tr data-title=/g) || []).length, entries.length, "one inventory row per entry");
  assert.ok(home.includes('href="archive/Iridars-Toolbox-v6h.zip"'), "Toolbox download linked");
  assert.ok(home.includes("Lost — 12 pages"), "lost section present");
});

test("index.json matches the pages on disk", () => {
  const j = JSON.parse(read("archive/index.json"));
  assert.equal(j.archiveDate, "2026-11-09");
  assert.deepEqual(j.counts, { total: 166, readable: 152, lost: 12, videos: 2 });
  assert.equal(j.entries.length, entries.length);
  for (const e of j.entries) assert.ok(exists(e.page), `${e.slug}: index.json page exists`);
  assert.ok(j.toolbox.file.endsWith("Iridars-Toolbox-v6h.zip"));
});

test("Toolbox zip is a valid download", () => {
  const buf = fs.readFileSync(path.join(root, "archive/Iridars-Toolbox-v6h.zip"));
  assert.equal(buf.subarray(0, 4).toString("latin1"), "PK\u0003\u0004", "zip magic bytes");
  assert.ok(buf.length > 400000, `zip is ${buf.length} bytes, expected ~414 KB`);
  assert.ok(buf.includes(Buffer.from("Iridar's Toolbox v6h.xlsm")), "zip contains the spreadsheet");
});

test("core raw sources exist on the site", () => {
  const core = JSON.parse(read("archive/core.json"));
  for (const raws of Object.values(core.raw)) {
    for (const r of raws) assert.ok(exists(`archive/raw/${r}`), `archive/raw/${r} exists`);
  }
});

test("every data-i18n key and tr() key the Archive uses exists in en.json", () => {
  const en = JSON.parse(read("i18n/en.json"));
  const used = new Set();
  const home = read("archive.html");
  for (const m of home.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) used.add(m[1]);
  for (const e of entries) {
    for (const m of read(e.page).matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) used.add(m[1]);
  }
  for (const m of read("archive.mjs").matchAll(/\btr\("([^"]+)"/g)) used.add(m[1]);
  assert.ok(used.size > 20, `${used.size} archive i18n keys used`);
  const missing = [...used].filter((k) => !(k in en));
  assert.deepEqual(missing, [], "missing en.json keys");
});

test("committed output matches the generator (run node scripts/build-archive.mjs)", () => {
  assert.deepEqual(checkAll(), []);
});
