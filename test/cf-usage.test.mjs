// 💸 scripts/cf-usage.mjs: month projection and verdicts (paid plan check, 2026-10-29).
import test from "node:test";
import assert from "node:assert/strict";
import { monthWindow, verdict, billingLines, INCLUDED, FREE_DAILY, WARN } from "../scripts/cf-usage.mjs";

test("month window projects month-to-date to the whole month", () => {
  const w = monthWindow(new Date("2026-10-11T00:00:00Z")); // 10 of 31 days
  assert.equal(w.startDate, "2026-10-01");
  assert.ok(Math.abs(w.factor - 3.1) < 1e-9);
});

test("verdicts: ok under 85 %, warn from 85 %, over from 100 %", () => {
  assert.equal(verdict(0.5e6, 1e6), "ok");
  assert.equal(verdict(WARN * 1e6, 1e6), "warn");
  assert.equal(verdict(1e6, 1e6), "over");
  assert.equal(verdict(NaN, 1e6), "ok");
});

test("billing lines: WebSocket messages count 1 per 20, DO active time → GB-s, D1 + DO rows add up", () => {
  const sums = {
    workersInvocationsAdaptive: { requests: 1e6, cpuTimeUs: 2e9 },
    durableObjectsInvocationsAdaptiveGroups: { requests: 100e3 },
    durableObjectsPeriodicGroups: { activeTime: 10 * 86400e6, inboundWebsocketMsgCount: 4e6, rowsWritten: 1e5 },
    d1AnalyticsAdaptiveGroups: { rowsRead: 1e8, rowsWritten: 9e5 },
  };
  const lines = Object.fromEntries(billingLines(sums, 3).map((l) => [l.key, l]));
  assert.equal(lines.workerRequests.projected, 3e6);
  assert.equal(lines.workerCpuMs.mtd, 2e6);
  assert.equal(lines.doRequests.mtd, 100e3 + 4e6 / 20);
  assert.ok(Math.abs(lines.doGbS.mtd - 10 * 86400 * 0.128) < 1e-6);
  assert.equal(lines.rowsWritten.mtd, 1e6);
  assert.equal(lines.rowsWritten.included, INCLUDED.rowsWritten);
  assert.equal(lines.doGbS.verdict, "ok");
  assert.equal(billingLines({}, 2).length, 0, "nothing readable → no lines, never a false alarm");
});

test("free plan: daily averages against the daily limits, no CPU line", () => {
  const sums = { workersInvocationsAdaptive: { requests: 900e3, cpuTimeUs: 1e9 }, durableObjectsInvocationsAdaptiveGroups: { requests: 300e3 }, durableObjectsPeriodicGroups: { activeTime: 10 * 86400e6, inboundWebsocketMsgCount: 0 } };
  const lines = Object.fromEntries(billingLines(sums, 3, "free", 10).map((l) => [l.key, l]));
  assert.equal(lines.workerRequests.projected, 90e3);
  assert.equal(lines.workerRequests.included, FREE_DAILY.workerRequests);
  assert.equal(lines.workerRequests.verdict, "warn");
  assert.equal(lines.workerCpuMs, undefined);
  assert.ok(Math.abs(lines.doGbS.projected - 86400 * 0.128) < 1e-6);
  assert.equal(lines.doGbS.verdict, "warn", "one always-on object is 85 % of the free day (11.1k of 13k GB-s), as before the paid plan");
  assert.match(lines.doRequests.label, /per day/);
});

test("DO duration: the dataset's own GB-s wins over active time", () => {
  const l = billingLines({ durableObjectsPeriodicGroups: { duration: 300e3, activeTime: 1 } }, 1).find((x) => x.key === "doGbS");
  assert.equal(l.mtd, 300e3);
  assert.equal(l.note, "");
});
