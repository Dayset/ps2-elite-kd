// ⚙️ voice list (owner t650u): the always-visible voice dropdown (huge on Edge) is now a ⚙️ next to the speaker.
// The page behaviour (opens, fits the screen, closes on pick / Escape / tap elsewhere) is in oracle-smoke.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("no <select> for voices; ⚙️ button + list instead", () => {
  const v = read("oracle/js/voice.js");
  assert.doesNotMatch(v, /<select/);
  assert.match(v, /data-voicegear/);
  assert.match(read("oracle/js/main.js"), /bindVoiceMenu\(\$\("main"\)\)/);
});

test("list is capped to the screen, cuts long names, no animation", () => {
  const css = read("oracle/oracle.css");
  const m = css.match(/\.voicemenu \{[^}]*\}/)[0];
  assert.match(m, /width: min\(20rem, calc\(100vw - 16px\)\)/);
  assert.match(m, /max-height: min\(50vh/);
  assert.match(m, /overflow-y: auto/);
  assert.match(css, /\.voicemenu \.vopt \{[^}]*text-overflow: ellipsis/);
  const all = css.match(/\.voice(gear|menu)[^{]*\{[^}]*\}/g).join("\n");
  assert.doesNotMatch(all, /animation|transition/);
});

test("same voice.js version everywhere (one shared voice state)", () => {
  const vers = new Set(["oracle/js/main.js", "oracle/js/commander.js"].flatMap((p) => [...read(p).matchAll(/voice\.js\?v=([\w-]+)/g)].map((x) => x[1])));
  assert.equal(vers.size, 1, [...vers].join(", "));
});

test("⚙️ label in all 9 languages", () => {
  for (const l of ["en", "ja", "ru", "de", "fr", "zh", "es", "uk", "it"]) {
    const s = JSON.parse(read(`i18n/${l}.json`))["or.vc.pick"];
    assert.ok(s && s.startsWith("⚙️ "), l);
  }
});
