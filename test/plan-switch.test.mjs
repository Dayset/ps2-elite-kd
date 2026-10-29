// 🔀 Plan switch (owner 2026-10-29: easy fallback to the free Cloudflare plan): plan.json + the PLAN variable.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PlanSwitch, parsePlan, PLAN_URL, PLAN_TTL_MS } from "../worker/src/plan.js";
import * as oraclePlan from "../oracle-worker/src/plan.js";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");

test("plan.json at the site root says paid or free", () => {
  const j = JSON.parse(read("plan.json"));
  assert.ok(parsePlan(j.plan), j.plan);
  assert.ok(PLAN_URL.endsWith("/ps2-elite-kd/plan.json"));
});

test("both Workers run the same switch code", () => {
  assert.equal(code(read("worker/src/plan.js")), code(read("oracle-worker/src/plan.js")));
  assert.equal(oraclePlan.PLAN_URL, PLAN_URL);
});

test("variable beats the file; the file is cached; failures keep the last plan; unknown = free", async () => {
  let n = 0, body = { plan: "paid" }, ok = true;
  const fetchFn = async () => { n++; if (!ok) throw new Error("down"); return new Response(JSON.stringify(body)); };
  const sw = new PlanSwitch({ fetchFn });
  assert.equal(sw.plan, "free", "nothing known yet: free");
  assert.equal(await sw.get({}, 1e6), "paid");
  assert.equal(sw.src, "plan.json");
  body = { plan: "free" };
  assert.equal(await sw.get({}, 1e6 + 1000), "paid", "cached for PLAN_TTL_MS");
  assert.equal(await sw.get({}, 1e6 + PLAN_TTL_MS), "free");
  ok = false;
  assert.equal(await sw.get({}, 1e6 + 2 * PLAN_TTL_MS), "free", "unreachable: keeps the last plan");
  assert.equal(await sw.get({ PLAN: "Paid" }, 1e6 + 2 * PLAN_TTL_MS + 1), "paid", "variable override");
  assert.equal(sw.src, "variable");
  const calls = n;
  await sw.get({ PLAN: "free" }, 1e6 + 9 * PLAN_TTL_MS);
  assert.equal(n, calls, "no fetch while the variable decides");
  const bad = new PlanSwitch({ initial: "paid", fetchFn: async () => new Response(JSON.stringify({ plan: "gold" })) });
  assert.equal(await bad.get({}, 5), "paid", "a bad file value keeps the remembered plan");
  assert.equal(parsePlan(" FREE "), "free");
  assert.equal(parsePlan("x"), null);
});

test("free-tier errors trip a Worker to free at once (the PLAN variable still wins)", async () => {
  const sw = new PlanSwitch({ fetchFn: async () => new Response(JSON.stringify({ plan: "paid" })) });
  assert.equal(await sw.get({}, 1000), "paid");
  assert.equal(sw.check(new Error("Something else broke"), 2000), false);
  assert.equal(sw.check(new Error("D1_ERROR: Your account has exceeded D1's free tier daily row write limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue."), 2000), true);
  assert.equal(await sw.get({}, 3000), "free");
  assert.equal(sw.state(3000).plan, "free");
  assert.ok(sw.state(3000).tripped);
  assert.equal(await sw.get({ PLAN: "paid" }, 4000), "paid", "owner's explicit variable");
  assert.equal(await sw.get({}, 2000 + 25 * 3600e3), "paid", "the trip ends after a day; plan-watch makes it stick");
  assert.ok(sw.check({ detail: "Exceeded allowed volume of requests in Durable Objects free tier." }, 5000));
});

test("plan-watch: switches to free on evidence, back to paid only after its own switch", async () => {
  const { decide, subsVerdict, symptomsOf } = await import("../scripts/plan-watch.mjs");
  const paid = { plan: "paid", note: "n" };
  assert.equal(decide(paid, { subs: "paid", symptoms: ["x"] }), null, "paid subscription: errors are something else");
  assert.equal(decide(paid, { subs: "unknown", symptoms: [] }), null);
  const f1 = decide(paid, { subs: "free" }, "2026-11-01");
  assert.deepEqual([f1.plan, f1.auto, f1.since, f1.note], ["free", true, "2026-11-01", "n"]);
  const f2 = decide(paid, { subs: "unknown", symptoms: ["oracle /health: D1 free tier daily row write limit"] });
  assert.equal(f2.plan, "free");
  assert.equal(decide(f1, { subs: "unknown" }), null, "no evidence either way: stays free");
  assert.equal(decide(f1, { subs: "paid" }).plan, "paid", "card fixed: back to paid");
  assert.equal(decide({ plan: "free" }, { subs: "paid" }), null, "a manual free is never undone");
  assert.equal(subsVerdict(403, { success: false }), "unknown");
  assert.equal(subsVerdict(200, { success: true, result: [{ rate_plan: { id: "workers_paid", public_name: "Workers Paid" }, state: "Paid" }] }), "paid");
  assert.equal(subsVerdict(200, { success: true, result: [{ rate_plan: { id: "workers_paid" }, state: "Cancelled" }] }), "free");
  assert.equal(subsVerdict(200, { success: true, result: [] }), "free");
  const s = symptomsOf({ status: 200, body: { plan: { plan: "free", tripped: "2026-11-02T00:00:00Z" } } }, { status: 500, body: { detail: "D1 free tier daily row read limit" }, text: "" });
  assert.equal(s.length, 2);
  assert.deepEqual(symptomsOf({ status: 200, body: { plan: { tripped: null } } }, { status: 200, body: { last_cycle: { errors: ["map w10: timeout"] } } }), []);
});
