// t779u (owner: "When the outfit fetch is canceled, I can see the distribution graph but not the skill graph.
// Should be visible already"): ✕ mid-run draws the skill graph + table for every player already loaded,
// like a normal finish; the names not loaded yet are listed as skipped ("fetch cancelled").
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAnalyze } from "../analyze.mjs";
import { cancelledSkips, summarizeFailures } from "../analyze-run.mjs";

function harness({ players = [], loadOne }) {
  const log = { draws: [], status: [], idle: 0, url: null };
  const state = {
    activeRun: null, analyzeSeq: 0, fetching: false, players, lastAnalyzedNames: [], lastLoadedNames: [], lastPlayerByKey: new Map(),
    failedNames: new Map(), els: {}, userMovedPage: true, LIVE_MODE: false, nameTokens: [],
    loadOne,
    drawChart: (ps) => log.draws.push(ps.map((p) => p.display)),
    setStatus: (html) => log.status.push(String(html || "")),
    showIdleChart: () => { log.idle++; },
    syncUrlNames: (n) => { log.url = n; },
    skippedWarningHtml: (summary) => summary.text,
    censusNotesHtml: () => "",
    getNameFailure: (n) => state.failedNames.get(n.toLowerCase()) || null,
    isNameFetched: () => false,
    findSharedEntry: () => null, cacheGet: () => null,
    clearNameFailures: () => false,
    isLiveMode: () => false,
  };
  state.currentNamesInField = () => state.nameTokens.slice();
  const $ = new Proxy(state, { get: (t, k) => (k in t ? t[k] : () => undefined), set: (t, k, v) => { t[k] = v; return true; } });
  return { $, log, part: createAnalyze($) };
}
const P = (n) => ({ display: n, source: "census" });

async function runAndCancelAt(names, stopAfter, players = []) {
  let h;
  let n = 0;
  h = harness({
    players,
    loadOne: (name, { run }) => new Promise((res, rej) => {
      if (n++ < stopAfter) return res(P(name));
      // the user presses ✕ while this name is loading
      run.controller.signal.addEventListener?.("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
      setTimeout(() => h.part.cancelAnalyze(), 5);
    }),
  });
  h.$.nameTokens = names.slice();
  globalThis.location = { hash: "" };
  await h.part.analyzeNames(names);
  return h;
}

test("✕ after 2 of 4 names (outfit or typed): the graph draws the 2, the other 2 are listed as skipped", async () => {
  const h = await runAndCancelAt(["softcoreTR", "Sarleyy", "Sche1m", "Other"], 2);
  assert.deepEqual(h.log.draws, [["softcoreTR", "Sarleyy"]], "skill graph drawn for the loaded players");
  assert.deepEqual(h.$.players.map((p) => p.display), ["softcoreTR", "Sarleyy"]);
  assert.deepEqual(h.log.url, ["softcoreTR", "Sarleyy"]);
  const last = h.log.status.at(-1);
  assert.match(last, /Sche1m \(not loaded, fetch cancelled\)/);
  assert.match(last, /Other \(not loaded, fetch cancelled\)/);
  assert.match(last, /press Analyze to load the rest/);
  assert.doesNotMatch(last, /misspelled/);
  assert.equal(h.$.failedNames.size, 0, "cancelled names are not marked failed (their chips stay pending)");
  assert.equal(h.$.fetching, false);
  assert.equal(h.$.activeRun, null);
});

test("✕ before anything loaded: nothing drawn, previous graph kept, 'Fetch cancelled.'", async () => {
  const prev = [P("Kept")];
  const h = await runAndCancelAt(["A", "B"], 0, prev);
  assert.deepEqual(h.log.draws, []);
  assert.equal(h.$.players, prev);
  assert.match(h.log.status.at(-1), /Fetch cancelled/);
});

test("cancelledSkips / summarizeFailures: cancelled names are not typos", () => {
  const skips = cancelledSkips(["A", "B", "C", "D"], [{ name: "A" }], [{ name: "B", kind: "not-found" }]);
  assert.deepEqual(skips.map((s) => [s.name, s.kind, s.idx]), [["C", "cancelled", 2], ["D", "cancelled", 3]]);
  const s = summarizeFailures(skips, 1);
  assert.equal(s.retryable, false);
  assert.match(s.text, /press Analyze to load the rest/);
  assert.doesNotMatch(s.text, /misspelled/);
});
