/**
 * Per-name isolation for Analyze: one bad / misspelled name must not sink the run.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  NameLoadError,
  classifyLoadError,
  censusQueryName,
  loadEach,
  summarizeFailures,
} from "../analyze-run.mjs";

function abortError() {
  const e = new Error("Fetch cancelled");
  e.name = "AbortError";
  return e;
}

describe("loadEach (per-name isolation)", () => {
  it("skips a failing name and keeps loading the rest", async () => {
    const seen = [];
    const res = await loadEach(["ShloDog", "Xqzzqpl123", "JustV6me"], async (name) => {
      seen.push(name);
      if (name === "Xqzzqpl123") throw new NameLoadError("Census: no character xqzzqpl123", "not-found");
      return { display: name };
    });
    assert.deepEqual(seen, ["ShloDog", "Xqzzqpl123", "JustV6me"]);
    assert.equal(res.cancelled, false);
    assert.deepEqual(res.loaded.map((x) => x.name), ["ShloDog", "JustV6me"]);
    // Successful set keeps its relative order (colors/numbering stay stable)
    assert.deepEqual(res.loaded.map((x) => x.player.display), ["ShloDog", "JustV6me"]);
    assert.equal(res.failed.length, 1);
    assert.equal(res.failed[0].name, "Xqzzqpl123");
    assert.equal(res.failed[0].kind, "not-found");
    assert.equal(res.failed[0].reason, "not found");
  });

  it("isolates network errors, bad JSON, HTTP 404 and plain throws", async () => {
    const boom = {
      net: () => { throw new TypeError("Failed to fetch"); },
      json: () => { throw new SyntaxError("Unexpected token '<'"); },
      http: () => { const e = new Error("404 Not Found"); e.status = 404; throw e; },
      busy: () => { const e = new Error("503"); e.status = 503; throw e; },
      timeout: () => { const e = new Error("Timed out"); e.name = "TimeoutError"; throw e; },
      empty: () => null,
      weird: () => { throw "string thrown"; },
    };
    const res = await loadEach(["ok1", ...Object.keys(boom), "ok2"], async (n) =>
      boom[n] ? boom[n]() : { display: n }
    );
    assert.deepEqual(res.loaded.map((x) => x.name), ["ok1", "ok2"]);
    assert.deepEqual(
      Object.fromEntries(res.failed.map((f) => [f.name, f.kind])),
      {
        net: "network",
        json: "bad-response",
        http: "not-found",
        busy: "network",
        timeout: "timeout",
        empty: "no-data",
        weird: "error",
      }
    );
  });

  it("counts failed names as done so progress advances", async () => {
    const done = [];
    await loadEach(["a", "bad", "c"], async (n) => {
      if (n === "bad") throw new Error("nope");
      return {};
    }, { onDone: (name, idx, total, outcome) => done.push(`${idx + 1}/${total}:${outcome.ok}`) });
    assert.deepEqual(done, ["1/3:true", "2/3:false", "3/3:true"]);
  });

  it("AbortError cancels the whole run (not a per-name failure)", async () => {
    const seen = [];
    const res = await loadEach(["a", "b", "c"], async (n) => {
      seen.push(n);
      if (n === "b") throw abortError();
      return {};
    });
    assert.equal(res.cancelled, true);
    assert.deepEqual(seen, ["a", "b"]);
    assert.equal(res.failed.length, 0);
  });

  it("isCancelled() stops before the next name and drops a late result", async () => {
    let cancel = false;
    const seen = [];
    const res = await loadEach(["a", "b", "c"], async (n) => {
      seen.push(n);
      if (n === "b") cancel = true; // cancelled while b was in flight
      return {};
    }, { isCancelled: () => cancel });
    assert.equal(res.cancelled, true);
    assert.deepEqual(seen, ["a", "b"]);
    assert.deepEqual(res.loaded.map((x) => x.name), ["a"]);
  });

  it("all names failing returns no loaded players, not a throw", async () => {
    const res = await loadEach(["x1", "x2"], async () => {
      throw new NameLoadError("no character", "not-found");
    });
    assert.equal(res.loaded.length, 0);
    assert.equal(res.failed.length, 2);
    assert.equal(res.cancelled, false);
  });
});

describe("classifyLoadError", () => {
  it("prefers an explicit kind", () => {
    assert.equal(classifyLoadError(new NameLoadError("x", "no-data")), "no-data");
    assert.equal(classifyLoadError(new Error("Census: no character foo")), "not-found");
    assert.equal(classifyLoadError(null), "error");
  });
});

describe("censusQueryName", () => {
  it("strips a leading [TAG] for Census lookups", () => {
    assert.equal(censusQueryName("[RITE] ShloDog"), "ShloDog");
    assert.equal(censusQueryName("  [0O]   Saitama "), "Saitama");
    assert.equal(censusQueryName("ShloDog"), "ShloDog");
    assert.equal(censusQueryName("[]"), "");
  });
});

describe("summarizeFailures", () => {
  it("returns null when nothing failed", () => {
    assert.equal(summarizeFailures([], 2), null);
  });

  it("partial: names + reasons, misspelled hint, showing the rest", () => {
    const s = summarizeFailures([{ name: "Xqzzqpl123", kind: "not-found" }], 1);
    assert.equal(s.allFailed, false);
    assert.equal(
      s.text,
      "Couldn't fetch: Xqzzqpl123 (not found). Probably misspelled or not a real character. Showing the rest."
    );
  });

  it("mixed reasons mention temporary network errors", () => {
    const s = summarizeFailures(
      [{ name: "Foo", kind: "not-found" }, { name: "Bar", kind: "network" }],
      3
    );
    assert.equal(
      s.text,
      "Couldn't fetch: Foo (not found), Bar (network error). Probably misspelled or not real characters. " +
        "Network errors may be temporary — try again. Showing the rest."
    );
  });

  it("all failed: says none could be fetched, no 'showing the rest'", () => {
    const one = summarizeFailures([{ name: "Xqzzqpl123", kind: "not-found" }], 0);
    assert.equal(one.allFailed, true);
    assert.equal(one.text, "Couldn't fetch Xqzzqpl123 (not found). Probably misspelled or not a real character.");
    const two = summarizeFailures([{ name: "A", kind: "not-found" }, { name: "B", kind: "no-data" }], 0);
    assert.equal(
      two.text,
      "Couldn't fetch any of these names: A (not found), B (no killboard data). Probably misspelled or not real characters."
    );
    assert.doesNotMatch(two.text, /Showing the rest/);
  });
});

import { columnTop, pctFromTop, fmtPctFromTop } from "../analyze-run.mjs";

describe("stats tables: % from the column top", () => {
  it("top is the highest finite value; needs ≥2 values and a positive top", () => {
    assert.equal(columnTop([1491, 391, 2075, NaN, null]), 2075);
    assert.ok(Number.isNaN(columnTop([1491])));
    assert.ok(Number.isNaN(columnTop([-2, -5])));
    assert.ok(Number.isNaN(columnTop([0, 0])));
  });
  it("percent gap below the top, none for the top / missing values", () => {
    assert.equal(pctFromTop(1491, 2075), -28);
    assert.equal(pctFromTop(2075, 2075), null);
    assert.equal(pctFromTop(NaN, 2075), null);
    assert.equal(pctFromTop(10, NaN), null);
    assert.equal(pctFromTop(-1, 2), -150);
    assert.equal(pctFromTop(2074, 2075), 0);
  });
  it("formats as −N% with −<1% for tiny gaps", () => {
    assert.equal(fmtPctFromTop(-28), "−28%");
    assert.equal(fmtPctFromTop(0), "−<1%");
    assert.equal(fmtPctFromTop(null), "");
  });
});

import { columnRef, pctFromRef, fmtPctFromRef, pctTitle } from "../analyze-run.mjs";

describe("stats tables: per-column % direction", () => {
  it('"low" (🎈 Inflation): least inflated is the 0% reference, others +N%', () => {
    const vals = [1.21, 1.66, 2.94, NaN];
    const ref = columnRef(vals, "low");
    assert.equal(ref, 1.21);
    assert.equal(pctFromRef(1.21, ref, "low"), null);
    assert.equal(pctFromRef(1.63, ref, "low"), 35);
    assert.equal(fmtPctFromRef(35, "low"), "+35%");
    assert.equal(fmtPctFromRef(0, "low"), "+<1%");
    assert.equal(pctTitle(35, "1.21", "low"), "35% more inflated than the least inflated (1.21)");
  });
  it('"low" shows nothing when the lowest value is ≤ 0', () => {
    assert.ok(Number.isNaN(columnRef([0, 1.5, 2], "low")));
    assert.ok(Number.isNaN(columnRef([-0.2, 1.5], "low")));
    assert.equal(pctFromRef(1.5, NaN, "low"), null);
  });
  it('"high" stays the default (−N% below the top)', () => {
    assert.equal(columnRef([1491, 2075]), 2075);
    assert.equal(pctFromRef(1491, 2075), -28);
    assert.equal(fmtPctFromRef(-28), "−28%");
    assert.equal(pctTitle(-28, "2075"), "28% below the column top (2075)");
  });
});
