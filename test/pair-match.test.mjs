/**
 * t710 👯 play-pattern match: shows only for exactly two names (PC room, nobody on the
 * removal list), neutral one-line wording in all languages, and the browser score is the
 * same 7-clue model as the build-log 👥 card (data/alts.json "tests" pairs).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pairVisible, pctText, createPairMatch } from "../pair-match.mjs";
import { removedList } from "../opt-out.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));

test("👯 shows only for exactly 2 different names, PC room, list loaded, nobody removed", () => {
  const removed = removedList({ players: { "5428000000000000001": { name: "GoneGuy", proof: "test", at: "2026-10-26" } } });
  const ok = { removed, ready: true };
  assert.equal(pairVisible(["Ahorn", "MrHorns"], ok), true);
  assert.equal(pairVisible(["Ahorn"], ok), false);
  assert.equal(pairVisible(["Ahorn", "MrHorns", "Bhorn"], ok), false);
  assert.equal(pairVisible(["Ahorn", "[TAG] ahorn"], ok), false, "same character twice");
  assert.equal(pairVisible(["Ahorn", "GoneGuy"], ok), false, "removed player hides the button");
  assert.equal(pairVisible(["[XX] goneguy", "Ahorn"], ok), false);
  assert.equal(pairVisible(["Ahorn", "MrHorns"], { ...ok, isPs: true }), false, "PC only");
  assert.equal(pairVisible(["Ahorn", "MrHorns"], { removed, ready: false }), false, "fail closed before the list loads");
});

test("percent text never says a false 0 or 100", () => {
  assert.equal(pctText(0), "<1");
  assert.equal(pctText(0.004), "<1");
  assert.equal(pctText(0.729), "73");
  assert.equal(pctText(0.999), ">99");
});

test("wording: neutral, every language has the keys and the {n} slot", () => {
  const BAD = /cheat|same person|detected|tracking/i;
  for (const lang of ["en", "ja", "ru", "de", "fr", "zh", "es", "uk", "it"]) {
    const d = read(`i18n/${lang}.json`);
    for (const k of ["pair.title", "pair.label", "pair.busy", "pair.result", "pair.fail"]) {
      assert.ok(typeof d[k] === "string" && d[k].trim(), `${lang} ${k}`);
      assert.doesNotMatch(d[k], BAD, `${lang} ${k}`);
    }
    assert.match(d["pair.result"], /\{n\}/, lang);
  }
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.match(html, /<button id="pairMatchBtn"[^>]*\shidden[\s>]/, "hidden until two names");
  assert.match(html, /id="pairMatchNote"[^>]*aria-live="polite"/);
});

test("browser score = build-alts score for the saved test pairs (no network)", async () => {
  const alts = read("data/alts.json");
  const ranks = read("data/ranks.json");
  const idx = read("data/index.json");
  const tagBySlug = new Map(idx.players.map((p) => [p.slug, p.name]));
  const realFetch = globalThis.fetch;
  let net = 0;
  globalThis.fetch = async (u) => {
    const f = String(u);
    if (/^https?:/.test(f)) { net++; return { ok: false }; }
    try { const t = fs.readFileSync(path.join(ROOT, f), "utf8"); return { ok: true, json: async () => JSON.parse(t) }; } catch { return { ok: false }; }
  };
  try {
    const note = { textContent: "", hidden: true, setAttribute() {}, removeAttribute() {} };
    let tokens = [];
    const pm = createPairMatch({
      els: { pairMatchBtn: null, pairMatchNote: note }, get nameTokens() { return tokens; }, IS_PS: false, DATA: "data/",
      removedNow: removedList(read("data/opt-out.json")), removedReady: async () => {}, loadRanksPayload: async () => ranks,
      censusJson: async () => null, CENSUS: "", tagName: (n) => tagBySlug.get(n.toLowerCase().replace(/[^a-z0-9]/g, "")) || "",
    });
    const pairs = Object.values(alts.tests).flat();
    assert.ok(pairs.length > 20);
    let close = 0;
    const off = [];
    for (const t of pairs) {
      tokens = [t.na, t.nb];
      pm.sync();
      await new Promise((r) => setTimeout(r, 0));
      await pm.run();
      const m = note.textContent.match(/(<1|>99|\d+)%/);
      assert.ok(m, `${t.na}+${t.nb}: ${note.textContent}`);
      const got = m[1] === "<1" ? 0 : m[1] === ">99" ? 100 : +m[1];
      if (Math.abs(got - t.p) <= 3) close++; else off.push(`${t.na}+${t.nb} ${t.p} vs ${got}`);
    }
    // ranks.json can be newer than alts.json (stat profile drift), so allow a few.
    assert.ok(close >= 0.9 * pairs.length, `only ${close}/${pairs.length} close:\n${off.join("\n")}`);
  } finally {
    globalThis.fetch = realFetch;
  }
});
