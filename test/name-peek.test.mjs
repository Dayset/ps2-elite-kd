import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NAME_MAX_CH, isTruncated, peekPosition } from "../name-peek.mjs";

describe("name-peek helpers", () => {
  it("caps names at 18 characters (≈80% of cached names)", () => {
    assert.equal(NAME_MAX_CH, 18);
  });
  it("detects truncation from scroll vs client width", () => {
    assert.equal(isTruncated({ scrollWidth: 200, clientWidth: 140 }), true);
    assert.equal(isTruncated({ scrollWidth: 140, clientWidth: 140 }), false);
    assert.equal(isTruncated(null), false);
  });
  it("places the popup above the anchor, below when there is no room, inside the viewport", () => {
    const vp = { width: 380, height: 800 };
    const size = { width: 200, height: 40 };
    assert.deepEqual(peekPosition({ left: 100, top: 300, width: 80, bottom: 320 }, size, vp), { left: 40, top: 252 });
    assert.deepEqual(peekPosition({ left: 100, top: 20, width: 80, bottom: 40 }, size, vp), { left: 40, top: 48 });
    assert.deepEqual(peekPosition({ left: 340, top: 300, width: 40, bottom: 320 }, size, vp), { left: 172, top: 252 });
    assert.deepEqual(peekPosition({ left: -50, top: 300, width: 40, bottom: 320 }, size, vp), { left: 8, top: 252 });
  });
});

import { peekParts } from "../name-peek.mjs";
describe("name-peek legend", () => {
  it("returns the full name and an empty legend when none is stored", () => {
    const el = { getAttribute: (k) => ({ "data-full": "[TAG] Someone" })[k] ?? null, textContent: "Someone" };
    assert.deepEqual(peekParts(el), { name: "[TAG] Someone", desc: "", url: "" });
  });
  it("includes the stored legend from data-desc", () => {
    const el = { getAttribute: (k) => ({ "data-full": "Zyr0sNCx", "data-desc": "  Quick on the trigger.  " })[k] ?? null, textContent: "" };
    assert.deepEqual(peekParts(el), { name: "Zyr0sNCx", desc: "Quick on the trigger.", url: "" });
  });
  it("takes the profile link from the enclosing anchor, ignores '#' links", () => {
    const honu = { getAttribute: (k) => (k === "href" ? "https://wt.honu.pw/c/5428010618035323201" : null) };
    const el = {
      getAttribute: (k) => ({ "data-full": "Zyr0sNCx" })[k] ?? null,
      textContent: "",
      closest: () => honu,
    };
    assert.equal(peekParts(el).url, "https://wt.honu.pw/c/5428010618035323201");
    const hash = { getAttribute: (k) => (k === "href" ? "#" : null) };
    const el2 = {
      getAttribute: (k) => ({ "data-full": "Zyr0sNCx" })[k] ?? null,
      textContent: "",
      closest: () => hash,
    };
    assert.equal(peekParts(el2).url, "");
  });
  it("takes the profile link from data-profile (plain legend names, no anchor)", () => {
    const el = {
      getAttribute: (k) => ({ "data-full": "Zyr0sNCx", "data-profile": "https://wt.honu.pw/c/5428010618035323201" })[k] ?? null,
      textContent: "",
      closest: () => null,
    };
    assert.equal(peekParts(el).url, "https://wt.honu.pw/c/5428010618035323201");
    const bad = {
      getAttribute: (k) => ({ "data-full": "Zyr0sNCx", "data-profile": "javascript:alert(1)" })[k] ?? null,
      textContent: "",
      closest: () => null,
    };
    assert.equal(peekParts(bad).url, "");
  });
});

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
describe("name-peek popup link opens a new window (owner, 2026-10-20)", () => {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "name-peek.mjs"), "utf8");
  it("popup profile link forces window.open(_blank) on click, not just target=_blank", () => {
    assert.match(src, /link\.target = "_blank"/);
    assert.match(src, /window\.open\(url, "_blank", "noopener,noreferrer"\)/);
    assert.match(src, /e\.preventDefault\(\)/);
  });
});
