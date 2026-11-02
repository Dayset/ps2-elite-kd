// Global "⚖️ Population weight:" row moved out of the pinned bar into the
// footer (2026-11-02): #mini keeps alert + This-alert only; the footer carries
// the global row. Structural (source-shape) checks — skill-foot.js itself is
// not node-importable (it imports state.js, which touches location).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../oracle/index.html", import.meta.url), "utf8");
const foot = readFileSync(new URL("../oracle/js/skill-foot.js", import.meta.url), "utf8");

// The #mini line is a single line: miniMain + miniSkillAlert, no miniSkill.
// (Note: "miniSkillAlert" contains "miniSkill" as a substring, so the
// absence check must use the exact id with its closing quote.)
const miniLine = html.split("\n").find((l) => l.includes('id="mini"'));
assert.ok(miniLine, "index.html has a #mini line");
test("pinned bar: alert + This-alert only, no global row", () => {
  assert.ok(miniLine.includes('id="miniMain"'), "#mini keeps miniMain");
  assert.ok(miniLine.includes('id="miniSkillAlert"'), "#mini keeps miniSkillAlert (This alert stays pinned)");
  assert.ok(!miniLine.includes('id="miniSkill"'), "#mini no longer contains the global miniSkill row");
});

test("footer carries the global row", () => {
  const footBlock = html.slice(html.indexOf("<footer>"), html.indexOf("</footer>"));
  assert.ok(footBlock.includes('id="footSkill"'), "footer has #footSkill");
  assert.ok(footBlock.includes('class="mini-skill"'), "footer row reuses .mini-skill (label left, numbers right)");
});

test("renderSkillFoot targets the footer element", () => {
  assert.ok(foot.includes('const el = $("footSkill");'), "renderSkillFoot renders into footSkill");
  assert.ok(!foot.includes('$("miniSkill")'), "no remaining miniSkill target in skill-foot.js");
});
