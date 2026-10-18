// Cache Worker -> oracle hook: dispatch oracle-honu.yml only when the oracle has Honu work.
import { test } from "node:test";
import assert from "node:assert/strict";
import { oracleTick, ORACLE_WORKFLOW } from "../worker/src/oracle-tick.js";

const c = { repo: "Dayset/ps2-elite-kd", ref: "main", timeoutMs: 1000 };
const oracle = (body, status = 200) => ({ fetch: async () => new Response(JSON.stringify(body), { status }) });

test("off without the binding or a token", async () => {
  assert.equal((await oracleTick({ GH_TOKEN: "t" }, c)).decision, "off");
  assert.equal((await oracleTick({ ORACLE: oracle({ pending: true }) }, c)).decision, "off");
});

test("idle when the oracle has nothing queued: no GitHub call", async () => {
  let called = 0;
  const r = await oracleTick({ GH_TOKEN: "t", ORACLE: oracle({ pending: false, pop: 0, reports: 0 }) }, c, async () => { called++; });
  assert.equal(r.decision, "idle");
  assert.equal(called, 0);
});

test("dispatches oracle-honu.yml on main when work is queued", async () => {
  let req;
  const r = await oracleTick({ GH_TOKEN: "t", ORACLE: oracle({ pending: true, pop: 2, reports: 1 }) }, c,
    async (url, init) => { req = { url, init }; return new Response(null, { status: 204 }); });
  assert.deepEqual(r, { decision: "dispatched", pop: 2, reports: 1 });
  assert.equal(req.url, `https://api.github.com/repos/Dayset/ps2-elite-kd/actions/workflows/${ORACLE_WORKFLOW}/dispatches`);
  assert.deepEqual(JSON.parse(req.init.body), { ref: "main" });
  assert.equal(req.init.headers.Authorization, "Bearer t");
});

test("errors are reported, never thrown", async () => {
  assert.equal((await oracleTick({ GH_TOKEN: "t", ORACLE: oracle({}, 500) }, c)).decision, "error");
  const boom = { fetch: async () => { throw new TypeError("x"); } };
  assert.equal((await oracleTick({ GH_TOKEN: "t", ORACLE: boom }, c)).decision, "error");
  const r = await oracleTick({ GH_TOKEN: "t", ORACLE: oracle({ pending: true }) }, c, async () => new Response("no", { status: 403 }));
  assert.deepEqual(r, { decision: "error", reason: "dispatch_http_403" });
});
