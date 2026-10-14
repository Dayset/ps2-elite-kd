// Worker cron KV budget: a simulated day of 5-minute ticks must stay far under
// the Workers free-plan KV limits (1,000 writes, 1,000 lists a day) while still
// dispatching when a run is due and re-dispatching stuck /add names.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/src/worker.js";

function fakeKV() {
  const m = new Map();
  const n = { get: 0, put: 0, list: 0 };
  return {
    n,
    m,
    async get(k) { n.get++; const e = m.get(k); return e ? e.value : null; },
    async getWithMetadata(k) { n.get++; const e = m.get(k); return e ? { value: e.value, metadata: e.metadata || null } : { value: null, metadata: null }; },
    async put(k, v, o = {}) { n.put++; m.set(k, { value: String(v), metadata: o.metadata }); },
    async list({ prefix = "" } = {}) {
      n.list++;
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name, metadata: m.get(name).metadata }));
      return { keys, list_complete: true };
    },
  };
}

/** fetch stub: schedule.json, index.json, GitHub runs list + dispatch. */
function stubFetch(world) {
  return async (input, init = {}) => {
    const url = String(input && input.url ? input.url : input);
    const ok = (body, status = 200) => new Response(body == null ? null : JSON.stringify(body), { status });
    if (url.includes("schedule.json")) return ok(world.schedule);
    if (url.includes("index.json")) { world.indexFetches++; return ok({ players: world.cached.map((s) => ({ slug: s, name: s })) }); }
    if (url.includes("/runs?")) return ok({ workflow_runs: world.runs });
    if (url.endsWith("/dispatches") && init.method === "POST") {
      world.dispatches.push(JSON.parse(init.body).inputs.names);
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
}

async function day(world, env, { ticks = 288, startMs = Date.UTC(2026, 9, 14), each } = {}) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = stubFetch(world);
  try {
    for (let i = 0; i < ticks; i++) {
      const t = startMs + i * 5 * 60_000;
      if (each) each(i, t);
      let job;
      await worker.scheduled({ scheduledTime: t }, env, { waitUntil: (p) => { job = p; } });
      await job;
    }
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("idle day: at most ~50 KV writes and 48 lists (was 288 + 288)", async () => {
  const kv = fakeKV();
  const env = { QUEUE: kv, GH_TOKEN: "t" };
  const world = { schedule: { nextDueAt: null, reason: "idle" }, cached: [], runs: [], dispatches: [], indexFetches: 0 };
  await day(world, env);
  assert.ok(kv.n.put <= 50, `writes ${kv.n.put}`);
  assert.ok(kv.n.list <= 48, `lists ${kv.n.list}`);
  assert.equal(world.dispatches.length, 0);
  const last = JSON.parse(kv.m.get("backup:last").value);
  assert.equal(last.decision, "skipped-idle");
});

test("busy day (run due, one active run at a time): dispatches still happen, KV stays low", async () => {
  const kv = fakeKV();
  const env = { QUEUE: kv, GH_TOKEN: "t" };
  const world = { schedule: { nextDueAt: "2026-10-01T00:00:00Z", reason: "growth" }, cached: [], runs: [], dispatches: [], indexFetches: 0 };
  let runEnds = 0;
  let runId = 0;
  await day(world, env, {
    each: (i, t) => {
      // A dispatched run lasts ~30 min, then completes.
      if (world.dispatches.length > runId) { runId = world.dispatches.length; runEnds = t + 30 * 60_000; }
      world.runs = t < runEnds ? [{ id: runId, status: "in_progress", created_at: new Date(t).toISOString() }] : [];
    },
  });
  assert.ok(world.dispatches.length >= 40, `dispatches ${world.dispatches.length}`);
  assert.ok(kv.n.put <= 2 * world.dispatches.length + 50, `writes ${kv.n.put} for ${world.dispatches.length} dispatches`);
  assert.ok(kv.n.list <= 48, `lists ${kv.n.list}`);
});

test("stuck /add names are still re-dispatched, at most once per 30 min", async () => {
  const kv = fakeKV();
  const env = { QUEUE: kv, GH_TOKEN: "t" };
  const t0 = Date.UTC(2026, 9, 14);
  await kv.put("pending:someguy", String(t0 - 20 * 60_000), { metadata: { name: "SomeGuy", at: t0 - 20 * 60_000 } });
  const world = { schedule: { nextDueAt: null }, cached: [], runs: [], dispatches: [], indexFetches: 0 };
  await day(world, env, { ticks: 12, startMs: t0 }); // one hour
  assert.deepEqual(world.dispatches[0], "SomeGuy");
  assert.ok(world.dispatches.length <= 2, `dispatches ${world.dispatches.length}`);
});

test("/health still reports the last logged check", async () => {
  const kv = fakeKV();
  const env = { QUEUE: kv, GH_TOKEN: "t" };
  const world = { schedule: { nextDueAt: null }, cached: [], runs: [], dispatches: [], indexFetches: 0 };
  await day(world, env, { ticks: 3 });
  const res = await worker.fetch(new Request("https://w.example/health"), env, { waitUntil() {} });
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.backupTimer.last.decision, "skipped-idle");
});
