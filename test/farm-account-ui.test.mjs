import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../build-log.html", import.meta.url), "utf8");

describe("build-log 🤖 Likely farm accounts", () => {
  it("has the 🤖 sub-list inside the 🌱 card", () => {
    const card = html.slice(html.indexOf('id="cardSprouts"'), html.indexOf("</main>"));
    assert.match(card, /🤖 Likely farm accounts/);
    assert.match(card, /id="farmAcct"/);
  });
  it("farm accounts don't count as sprouts", () => {
    assert.match(html, /sprout: sp\.sprout && !farmAcct/);
    assert.match(html, /renderFarmAccounts\(/);
  });
});
