// 📍 Locate one character (owner 2026-11-12, hidden in the Oracle page's ⓘ About):
// the answer line for one /locate response — base name, continent, how it was placed,
// and honest "no position" states. Pure formatter; the Worker side is test/oracle-locate.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.location ??= { search: "", pathname: "/oracle/", href: "https://example.test/oracle/" };
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const { formatLocate } = await import("../oracle/js/locate.js");

const exact = { v: 1, name: "ENZAK", cid: "5428713425544958353", platform: "pc", faction: "VS", world: 10, online: true, stream: true,
  loc: { w: 10, z: 4, zn: "Hossin", ago: 20, on: true, fac: "VS", f: 261000, fn: "Sharpe's Run", fago: 45, how: "exact" } };

test("formatLocate: exact hit names the base, continent, faction and age", () => {
  const h = formatLocate(exact);
  assert.match(h, /ENZAK/);
  assert.match(h, /VS/);
  assert.match(h, /Wainwright/);
  assert.match(h, /Sharpe&#39;s Run/);
  assert.match(h, /Hossin/);
  assert.match(h, /exact/);
  assert.match(h, /placed 45 s ago/);
  assert.match(h, /data-base="Sharpe&#39;s Run"/, "the base highlights the map like a ⚔️ Live fights row");
  assert.doesNotMatch(h, /no position/);
});

test("formatLocate: near hit, zone-only, logged out and idle read honestly", () => {
  const near = formatLocate({ ...exact, loc: { ...exact.loc, f: 201, fn: "The Crown", zn: "Indar", z: 2, fago: 130, how: "near" } });
  assert.match(near, /The Crown/);
  assert.match(near, /Indar/);
  assert.match(near, /near — placed from a nearby fight/);
  assert.doesNotMatch(near, /exact —/);

  const zoneOnly = formatLocate({ ...exact, loc: { w: 1, z: 2, zn: "Indar", ago: 300, on: true, fac: "VS" } });
  assert.match(zoneOnly, /on Indar — no base fixed yet/);
  assert.match(zoneOnly, /last event 5 min ago/);

  const out = formatLocate({ ...exact, loc: { w: 10, z: 4, zn: "Hossin", ago: 900, on: false, fac: "VS" } });
  assert.match(out, /logged out 15 min ago/);
  assert.match(out, /was on Hossin/);

  const idle = formatLocate({ ...exact, loc: null });
  assert.match(idle, /no position: nothing seen in the last hour/);
  const off = formatLocate({ ...exact, online: false, loc: null });
  assert.match(off, /offline — nothing to place/);
});

test("formatLocate: unavailable stream and error states", () => {
  assert.match(formatLocate({ ...exact, stream: null, loc: null }), /Live positions are unavailable right now/);
  assert.match(formatLocate({ ...exact, stream: false, loc: null }), /live stream is down/);
  assert.match(formatLocate({ error: "invalid_name" }), /doesn&#39;t look like a character name/);
  assert.match(formatLocate({ error: "unknown_name" }), /No character with that name/);
  assert.match(formatLocate({ error: "census_error" }), /Census didn&#39;t answer/);
  assert.match(formatLocate({ error: "rate_limited" }), /Too many lookups/);
  assert.match(formatLocate(null), /Couldn&#39;t look that up/);
});

test("formatLocate: names are escaped", () => {
  const h = formatLocate({ ...exact, name: "<img src=x onerror=alert(1)>" });
  assert.doesNotMatch(h, /<img src=x/);
  assert.match(h, /&lt;img/);
});
