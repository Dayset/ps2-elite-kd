import { test } from "node:test";
import assert from "node:assert/strict";
import { othersWaiting, startYieldWatch } from "../scripts/yield-check.mjs";

test("othersWaiting: only runs that have not started, never our own", () => {
  assert.equal(othersWaiting([{ id: 1, status: "in_progress" }], 1), false);
  assert.equal(othersWaiting([{ id: 1, status: "in_progress" }, { id: 2, status: "completed" }], 1), false);
  assert.equal(othersWaiting([{ id: 1, status: "in_progress" }, { id: 2, status: "pending" }], 1), true);
  assert.equal(othersWaiting([{ id: 2, status: "queued" }], 2), false);
  assert.equal(othersWaiting(null, 1), false);
});

test("startYieldWatch: calls onWaiting once when another run waits, then stops polling", async () => {
  let calls = 0;
  let fired = [];
  const fetchImpl = async () => {
    calls++;
    const runs = calls >= 2 ? [{ id: 7, status: "in_progress" }, { id: 8, status: "pending" }] : [{ id: 7, status: "in_progress" }];
    return new Response(JSON.stringify({ workflow_runs: runs }), { status: 200 });
  };
  const stop = startYieldWatch({ token: "t", repo: "a/b", ownRunId: 7, everyMs: 5, fetchImpl, onWaiting: (w) => fired.push(w) });
  await new Promise((r) => setTimeout(r, 60));
  stop();
  assert.equal(fired.length, 1);
  const after = calls;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls, after, "no polling after it fired");
});

test("startYieldWatch: no token → no polling, network errors ignored", async () => {
  let calls = 0;
  const stop = startYieldWatch({ token: "", repo: "a/b", everyMs: 5, fetchImpl: async () => { calls++; }, onWaiting: () => {} });
  await new Promise((r) => setTimeout(r, 20));
  stop();
  assert.equal(calls, 0);
  const stop2 = startYieldWatch({ token: "t", repo: "a/b", everyMs: 5, fetchImpl: async () => { throw new Error("down"); }, onWaiting: () => assert.fail("must not fire") });
  await new Promise((r) => setTimeout(r, 20));
  stop2();
});
