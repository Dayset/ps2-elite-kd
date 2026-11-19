import test from "node:test";
import assert from "node:assert/strict";
import { parseOnline, dotHtml, graveSlot, syncGraveMark } from "../online-status.mjs";

test("parseOnline: 0 is offline, a world id is online", () => {
  const m = parseOnline({ characters_online_status_list: [{ character_id: "1", online_status: "0" }, { character_id: "2", online_status: "10" }] });
  assert.equal(m.get("1"), false);
  assert.equal(m.get("2"), true);
});
test("dotHtml: tooltips, unknown is empty", () => {
  assert.match(dotHtml(true), /🟢/); assert.match(dotHtml(true), /title="Online"/);
  assert.match(dotHtml(false), /🔴/); assert.match(dotHtml(false), /title="Offline"/);
  assert.equal(dotHtml(undefined), "");
});

test("graveSlot: hidden trigger slot, same data-cid contract", () => {
  assert.match(graveSlot("5428539340407621441"), /class="online-slot" data-cid="5428539340407621441"/);
  assert.match(graveSlot("5428539340407621441"), /display:none/);
  assert.equal(graveSlot(""), "");
  assert.equal(graveSlot(null), "");
});

test("syncGraveMark hides 🪦 only when online (fail-closed)", () => {
  const span = { style: { display: "" } };
  const cell = { querySelectorAll: (sel) => (sel === ".auto-mark-inactive" ? [span] : []) };
  const slot = { closest: (sel) => (sel === "th, td" ? cell : null) };
  syncGraveMark(slot, true);
  assert.equal(span.style.display, "none");
  syncGraveMark(slot, false);
  assert.equal(span.style.display, "");
  syncGraveMark(slot, undefined);
  assert.equal(span.style.display, "");
  syncGraveMark(null, true); // no crash
  syncGraveMark({ closest: () => null }, true); // no cell: no crash
  syncGraveMark({ closest: (sel) => (sel === "tr" ? cell : null) }, true); // tr fallback
  assert.equal(span.style.display, "none");
});
