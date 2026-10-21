// Fetch popularity counts (worker): /seen bumps a per-slug tally in one KV
// key, persisted at most once per 10 min (bumps inside the window are
// dropped by design); /requested exposes the tally to the refresh pipeline.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/src/worker.js";

function fakeKV() {
  const m = new Map();
  return {
    m,
    async get(k) { const e = m.get(k); return e ? e.value : null; },
    async getWithMetadata(k) { const e = m.get(k); return e ? { value: e.value, metadata: e.metadata || null } : { value: null, metadata: null }; },
    async put(k, v, o = {}) { m.set(k, { value: String(v), metadata: o.metadata }); },
    async list({ prefix = "" } = {}) {
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name, metadata: m.get(name).metadata }));
      return { keys, list_complete: true };
    },
  };
}

const INDEX = { players: [{ slug: "alpha", name: "Alpha" }, { slug: "shlodog", name: "ShloDog" }] };

async function withIndex(fn) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input && input.url ? input.url : input);
    if (url.includes("index.json")) return new Response(JSON.stringify(INDEX), { status: 200 });
    throw new Error(`unexpected fetch ${url}`);
  };
  try { await fn(); } finally { globalThis.fetch = realFetch; }
}

const T0 = Date.UTC(2026, 9, 20, 12, 0, 0);
const seenReq = (names) => new Request("https://w.example/seen", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "https://dayset.github.io" },
  body: JSON.stringify({ names }),
});

test("counts: first batch flushes, in-window bumps drop, later batch persists; /requested exposes the tally", async () => {
  await withIndex(async () => {
    const kv = fakeKV();
    const env = { QUEUE: kv, CENSUS_PROXY_KEY: "k" };
    const ctx = { waitUntil: () => {} };

    // The worker reads its clock from Date.now(); drive time by faking it.
    const realNow = Date.now;
    let now = T0;
    Date.now = () => now;
    try {
      let res = await worker.fetch(seenReq(["Alpha", "ShloDog"]), env, ctx);
      assert.equal(res.status, 200);
      let stored = JSON.parse(kv.m.get("counts:map").value);
      assert.deepEqual(stored.counts, { alpha: 1, shlodog: 1 });
      assert.equal(stored.since, T0);
      assert.equal(stored.flushedAt, T0);

      now = T0 + 5 * 60_000; // inside the 10-min coalesce window
      res = await worker.fetch(seenReq(["Alpha"]), env, ctx);
      assert.equal(res.status, 200);
      stored = JSON.parse(kv.m.get("counts:map").value);
      assert.deepEqual(stored.counts, { alpha: 1, shlodog: 1 }, "in-window bump is dropped, not persisted");

      now = T0 + 11 * 60_000; // past the window: this batch flushes
      res = await worker.fetch(seenReq(["Alpha"]), env, ctx);
      assert.equal(res.status, 200);
      stored = JSON.parse(kv.m.get("counts:map").value);
      assert.deepEqual(stored.counts, { alpha: 2, shlodog: 1 });
      assert.equal(stored.flushedAt, T0 + 11 * 60_000);

      const req = new Request("https://w.example/requested", { headers: { "X-Proxy-Key": "k" } });
      const out = await (await worker.fetch(req, env, ctx)).json();
      assert.deepEqual(out.counts, { alpha: 2, shlodog: 1 });
      assert.equal(out.countsSince, T0);
    } finally {
      Date.now = realNow;
    }
  });
});

test("counts: a broken counts key never breaks /seen", async () => {
  await withIndex(async () => {
    const kv = fakeKV();
    kv.m.set("counts:map", { value: "{not json", metadata: null });
    const env = { QUEUE: kv, CENSUS_PROXY_KEY: "k" };
    const res = await worker.fetch(seenReq(["Alpha"]), env, { waitUntil: () => {} });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.known, 1);
  });
});
