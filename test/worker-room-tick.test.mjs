// Cache Worker → PlayStation room (#55): dispatch refresh-ps.yml only when
// data-ps/schedule.json is due and no PS run is active; the Census proxy lets
// the three room namespaces through and nothing else.
import { test } from "node:test";
import assert from "node:assert/strict";
import { roomTick, PS_WORKFLOW } from "../worker/src/room-tick.js";
import { censusTarget, censusImageTarget, CENSUS_NAMESPACES } from "../worker/src/worker.js";

const c = { repo: "Dayset/ps2-elite-kd", ref: "main", timeoutMs: 1000 };
const T = Date.UTC(2026, 9, 22, 1, 0);

function world({ schedule = { nextDueAt: null }, runs = [], dispatchStatus = 204 } = {}) {
  const w = { calls: [], dispatched: [] };
  w.fetch = async (url, init = {}) => {
    const u = String(url);
    w.calls.push(u);
    const ok = (b, s = 200) => new Response(b == null ? null : JSON.stringify(b), { status: s });
    if (u.includes("data-ps/schedule.json")) return ok(schedule);
    if (u.includes(`/workflows/${PS_WORKFLOW}/runs`)) return ok({ workflow_runs: runs });
    if (u.endsWith(`/workflows/${PS_WORKFLOW}/dispatches`) && init.method === "POST") {
      w.dispatched.push(JSON.parse(init.body));
      return new Response(null, { status: dispatchStatus });
    }
    throw new Error(`unexpected ${u}`);
  };
  return w;
}

test("off without a token or when switched off", async () => {
  assert.equal((await roomTick({}, c, T)).decision, "off");
  assert.equal((await roomTick({ GH_TOKEN: "t", PS_ROOM_TICK: "off" }, c, T)).decision, "off");
});

test("idle schedule: one schedule read, no GitHub call", async () => {
  const w = world();
  const r = await roomTick({ GH_TOKEN: "t" }, c, T, w.fetch);
  assert.equal(r.decision, "idle");
  assert.equal(w.calls.length, 1);
  assert.ok(w.calls[0].startsWith("https://dayset.github.io/ps2-elite-kd/data-ps/schedule.json"));
});

test("not due yet: no GitHub call", async () => {
  const w = world({ schedule: { nextDueAt: new Date(T + 60_000).toISOString() } });
  assert.equal((await roomTick({ GH_TOKEN: "t" }, c, T, w.fetch)).reason, "not_due");
  assert.equal(w.dispatched.length, 0);
});

test("due and nothing running: dispatches refresh-ps.yml on main (never refresh-cache.yml)", async () => {
  const w = world({ schedule: { nextDueAt: new Date(T - 1000).toISOString(), reason: "growth" } });
  const r = await roomTick({ GH_TOKEN: "t" }, c, T, w.fetch);
  assert.deepEqual(r, { decision: "dispatched", reason: "growth" });
  assert.deepEqual(w.dispatched, [{ ref: "main" }]);
  assert.ok(w.calls.every((u) => !u.includes("refresh-cache.yml")));
});

test("due but a PS run is active or just ended: no dispatch", async () => {
  const due = { nextDueAt: new Date(T - 1000).toISOString() };
  const a = world({ schedule: due, runs: [{ status: "in_progress" }] });
  assert.equal((await roomTick({ GH_TOKEN: "t" }, c, T, a.fetch)).decision, "running");
  const b = world({ schedule: due, runs: [{ status: "completed", updated_at: new Date(T - 20_000).toISOString() }] });
  assert.equal((await roomTick({ GH_TOKEN: "t" }, c, T, b.fetch)).decision, "recent");
  assert.equal(a.dispatched.length + b.dispatched.length, 0);
});

test("failures come back as a decision, never thrown", async () => {
  const boom = async () => { throw new TypeError("x"); };
  assert.equal((await roomTick({ GH_TOKEN: "t" }, c, T, boom)).decision, "error");
  const w = world({ schedule: { nextDueAt: new Date(T - 1000).toISOString() }, dispatchStatus: 403 });
  assert.deepEqual(await roomTick({ GH_TOKEN: "t" }, c, T, w.fetch), { decision: "error", reason: "dispatch_http_403" });
});

test("Census proxy: ps2, ps2ps4us and ps2ps4eu pass; other namespaces and service ids don't", () => {
  const sid = "daysetps2legends";
  const t = (p) => censusTarget(new URL(`https://w.example/census${p}`), sid);
  assert.equal(t(`/s:${sid}/get/ps2:v2/character?name.first_lower=x`), `https://census.daybreakgames.com/s:${sid}/get/ps2:v2/character?name.first_lower=x`);
  assert.equal(t(`/s:${sid}/get/ps2ps4us:v2/characters_stat?character_id=1`), `https://census.daybreakgames.com/s:${sid}/get/ps2ps4us:v2/characters_stat?character_id=1`);
  assert.equal(t(`/s:${sid}/get/ps2ps4eu:v2/characters_event_grouped?character_id=1`), `https://census.daybreakgames.com/s:${sid}/get/ps2ps4eu:v2/characters_event_grouped?character_id=1`);
  assert.equal(t(`/s:${sid}/get/eq2:v2/character?x=1`), null);
  assert.equal(t(`/s:${sid}/get/ps2:v1/character?x=1`), null);
  assert.equal(t(`/s:other/get/ps2:v2/character?x=1`), null);
  assert.deepEqual(CENSUS_NAMESPACES, ["ps2", "ps2ps4us", "ps2ps4eu"]);
});

test("Census proxy: only static weapon image files pass the image route", () => {
  const t = (p) => censusImageTarget(new URL(`https://w.example${p}`));
  assert.equal(t("/census/files/ps2/images/static/2400.png"), "https://census.daybreakgames.com/files/ps2/images/static/2400.png");
  assert.equal(t("/census/files/ps2/images/static/2400.png?x=1"), null);
  assert.equal(t("/census/files/ps2/images/static/../x.png"), null);
  assert.equal(t("/census/files/ps2/images/item/2400.png"), null);
  assert.equal(t("/census/s:x/get/ps2:v2/item"), null);
});
