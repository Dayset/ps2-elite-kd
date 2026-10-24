// #66 step E: the pure helpers moved out of app.js.
import test from "node:test";
import assert from "node:assert/strict";
import { formatClock, fmtNum, slugKey, bareName, parseNames, namesEqualIgnoreCase, namesSetKey, niceLinTicks, niceNum, niceLogTicks, formatTick, escapeHtml, makeAbortError, isAbortError, checkAborted } from "../app-util.mjs";

test("formatting", () => {
  assert.equal(formatClock(65000), "1:05");
  assert.equal(formatClock(3725000), "1:02:05");
  assert.equal(formatClock(-1), "0:00");
  assert.equal(fmtNum(2.345, 2), "2.35");
  assert.equal(fmtNum(null, 2), "—");
  assert.equal(escapeHtml(`<a href="x">&</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
});

test("names", () => {
  assert.equal(slugKey("[TAG] Foo_Bar 2"), "foobar2");
  assert.equal(bareName(" [TAG] Foo "), "Foo");
  assert.deepEqual(parseNames("a, b;c\n[X] d"), ["a", "b", "c", "[X] d"]);
  assert.ok(namesEqualIgnoreCase(" Ab ", "aB"));
  assert.equal(namesSetKey(["B", "a"]), namesSetKey(["A", "b"]));
});

test("chart ticks", () => {
  assert.equal(niceNum(7.3), 10);
  assert.equal(niceNum(0.24), 0.2);
  assert.deepEqual(niceLinTicks(0, 10, 6), [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(niceLogTicks(0.5, 200), [1, 10, 100]);
  assert.equal(formatTick(0.05, true), "0.050");
  assert.equal(formatTick(12.3, false), "12");
});

test("abort errors", () => {
  const e = makeAbortError();
  assert.ok(isAbortError(e));
  assert.throws(() => checkAborted({ aborted: true }), (x) => isAbortError(x));
  checkAborted({ aborted: false });
});
