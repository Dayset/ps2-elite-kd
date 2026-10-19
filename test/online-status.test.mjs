import test from "node:test";
import assert from "node:assert/strict";
import { parseOnline, dotHtml } from "../online-status.mjs";

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
