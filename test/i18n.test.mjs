// Site translation (i18n.mjs, i18n/*.json, the 🌐 menu in index.html).
// Human translators edit i18n/<lang>.json; these tests keep the files in step with
// the English reference (i18n/en.json) and with the code that uses the keys.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { LANGS, pickLang, fill, t } from "../i18n.mjs";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const en = JSON.parse(read("i18n/en.json"));
const codes = LANGS.map((l) => l.code);
const otherLangs = codes.filter((c) => c !== "en");
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

test("pickLang: saved choice, then browser language, then English", () => {
  assert.equal(pickLang("ja", ["en-US"]), "ja", "a saved choice wins");
  assert.equal(pickLang("xx", ["de-DE"]), "de", "an unknown saved value is ignored");
  assert.equal(pickLang(null, ["zh-TW", "en"]), "zh", "regional codes map to the language");
  assert.equal(pickLang(null, ["pt-BR", "fr"]), "fr", "the first supported browser language is used");
  assert.equal(pickLang(null, ["pt-BR"]), "en", "unsupported browser languages fall back to English");
  assert.equal(pickLang(null, []), "en");
  assert.equal(pickLang(undefined, undefined), "en");
});

test("fill: {name} placeholders; unknown ones stay as written", () => {
  assert.equal(fill("Hello {name}", { name: "ShloDog" }), "Hello ShloDog");
  assert.equal(fill("Hi {who}", { name: "x" }), "Hi {who}");
  assert.equal(fill("plain"), "plain");
});

test("t: English fallback when no translation is loaded (never a raw key)", () => {
  assert.equal(t("cta.press", "▶️ Press Analyze"), "▶️ Press Analyze");
  assert.equal(t("no.such.key"), "no.such.key", "with no fallback the key is the last resort");
});

test("language menu lists exactly the languages the code knows, in order", () => {
  const html = read("index.html");
  const sel = html.match(/<select id="langSelect"[\s\S]*?<\/select>/);
  assert.ok(sel, "index.html has the language menu");
  const menu = [...sel[0].matchAll(/<option value="([a-z]{2})"/g)].map((m) => m[1]);
  assert.deepEqual(menu, codes);
  assert.deepEqual(codes, ["en", "ja", "ru", "de", "fr", "zh", "es"], "Japanese first, then Russian, German, French, Chinese, Spanish");
});

test("every language has a file, and every file is valid JSON of strings", () => {
  for (const code of otherLangs) {
    assert.ok(existsSync(new URL(`i18n/${code}.json`, root)), `i18n/${code}.json exists`);
  }
  for (const code of codes) {
    const j = JSON.parse(read(`i18n/${code}.json`));
    for (const [k, v] of Object.entries(j)) {
      assert.equal(typeof v, "string", `${code}: ${k} is a string`);
      assert.ok(v.trim().length > 0, `${code}: ${k} is not empty`);
    }
  }
});

test("no language has keys that English does not (stale or misspelt keys)", () => {
  for (const code of otherLangs) {
    const j = JSON.parse(read(`i18n/${code}.json`));
    const stale = Object.keys(j).filter((k) => !(k in en));
    assert.deepEqual(stale, [], `${code}.json has keys that en.json does not`);
  }
});

test("translations keep the same {placeholders} as English", () => {
  for (const code of otherLangs) {
    const j = JSON.parse(read(`i18n/${code}.json`));
    for (const [k, v] of Object.entries(j)) {
      if (!(k in en)) continue;
      assert.equal(placeholders(v), placeholders(en[k]), `${code}: ${k} placeholders`);
    }
  }
});

test("every data-i18n key used by index.html exists in en.json", () => {
  const html = read("index.html");
  const used = new Set([...html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map((m) => m[1]));
  assert.ok(used.size > 20, "the page marks its UI text");
  const missing = [...used].filter((k) => !(k in en));
  assert.deepEqual(missing, []);
});

test("every tr(\"key\", …) call in the UI modules exists in en.json", () => {
  const used = new Set();
  for (const file of ["app.js", "rankings.mjs", "name-suggest.mjs", "infantry.mjs", "vehicle-cut.mjs", "analyze-run.mjs", "padding.mjs", "player-metrics.mjs", "jump-btns.mjs", "live.mjs"]) {
    for (const m of read(file).matchAll(/\btr\("([^"]+)"/g)) used.add(m[1]);
  }
  assert.ok(used.size > 30, "the UI modules use the translator");
  // "tip." + id and "tier." + id build keys at run time: check the prefixes have keys below them.
  for (const p of [...used].filter((k) => k.endsWith("."))) assert.ok(Object.keys(en).some((k) => k.startsWith(p)), p + " has keys");
  const missing = [...used].filter((k) => !k.endsWith(".") && !(k in en));
  assert.deepEqual(missing, []);
});

test("coverage: how much of the English text each language has (informational)", () => {
  for (const code of otherLangs) {
    const j = JSON.parse(read(`i18n/${code}.json`));
    const done = Object.keys(en).filter((k) => typeof j[k] === "string" && j[k].trim()).length;
    // Missing keys show English, so this only reports; it never fails the build.
    console.log(`${code}: ${done}/${Object.keys(en).length} strings translated`);
  }
  assert.ok(true);
});
