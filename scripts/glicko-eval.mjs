#!/usr/bin/env node
/**
 * #112 measurement: does a pairwise Glicko-2 replay predict the next kills between two players
 * better than the static 🎲 fit, and which seed / vehicle rule / starting RD should the panel use?
 * PC only, read-only (Census KILL/DEATH history via the cache Worker proxy). Writes data/duel-glicko-eval.json.
 *
 * Pairs: the "pagers" (players whose history is read) are the cached players with the most
 * killboard partners at 40+ mutual kills (TolyaNo always in). Every opponent in the pages read with
 * MIN+ kills between them and a ⚔️ iVi becomes a pair (one pair per two cids).
 * Held-out: per pair, the kills after the 60 % time point are the tail. Every model predicts each
 * tail kill from what came before it (Glicko updates after each kill, the 🎲 fit stays fixed).
 * Score = log loss per kill (lower is better) and Brier. The starting RD of the iVi seed is chosen
 * on pairs with an even hash and reported on the odd ones (no peeking).
 *
 * Usage: node scripts/glicko-eval.mjs [--pagers 40] [--pages 15] [--names a,b]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { censusRequest, tokenBucket } from "../census-fetch.mjs";
import { CENSUS_HOST } from "../rooms.mjs";
import { readPairPages, pairEvents, duelExpected } from "../duels.mjs";
import { duelGlicko, DUEL_GLICKO } from "../glicko2.mjs";
import { viaCensusProxy } from "./refresh-cache.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const PAGERS = Number(arg("--pagers", 40));
const PAGES = Number(arg("--pages", 15));
const MIN = 40; // kills between them: 60 % head (≥ 24) + a tail worth scoring
const SID = (process.env.CENSUS_SERVICE_ID || "").trim() || "daysetps2legends";
const BASE = `${CENSUS_HOST}/s:${SID}/get/ps2:v2/`;
const PROXY = String(process.env.CENSUS_PROXY || "").trim().replace(/\/+$/, "");
const KEY = String(process.env.CENSUS_PROXY_KEY || "");
const BUDGET_MS = (Number(process.env.TIME_BUDGET_MIN) || 22) * 60_000;
const UA = "ps2-elite-kd-cache-bot/2.0 (+https://github.com/Dayset/ps2-elite-kd; glicko eval #112)";
const bucket = tokenBucket({ capacity: 3, perMinute: Number(process.env.CENSUS_RPM) > 0 ? Number(process.env.CENSUS_RPM) : 40 });
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));

async function get(url) {
  const p = viaCensusProxy(url, PROXY);
  const headers = { Accept: "application/json", "User-Agent": UA };
  if (p !== url && KEY) headers["X-Proxy-Key"] = KEY;
  return censusRequest(p, { bucket, retries: 4, timeoutMs: 60_000, headers, baseMs: 2000, capMs: 30000 });
}

const lite = read("data/ranks-lite.json");
const c = lite.cols, ni = c.indexOf("name"), si = c.indexOf("slug"), ai = c.indexOf("adjs"), vi = c.indexOf("infVeh");
const ivi = new Map(), veh = new Map();
for (const r of lite.rows) {
  if (!(r[ai] > 0)) continue;
  for (const k of [String(r[ni]).toLowerCase(), String(r[si]).toLowerCase()]) { ivi.set(k, r[ai]); if (Number.isFinite(r[vi])) veh.set(k, r[vi] / 100); }
}
const bare = (n) => String(n || "").replace(/^\[[^\]]*\]\s*/, "").trim().toLowerCase();
const cidName = read("data/cid-names.json");
const nameOf = (cid) => (cidName[cid] ? cidName[cid][0] : null);
const fit = read("data/duel-ivi-fit.json");

/* ---- pagers */
function pickPagers() {
  const want = String(arg("--names", "TolyaNo")).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const ix = read("data/index.json").players;
  const scored = [];
  for (const e of ix) {
    let p;
    try { p = JSON.parse(fs.readFileSync(path.join(ROOT, "data", e.file), "utf8")).player; } catch { continue; }
    if (!p || !p.cid || !ivi.has(bare(p.display))) continue;
    const n = (p.rows || []).filter((r) => r.kills + r.deaths >= MIN && ivi.has(bare(r.name))).length;
    scored.push({ cid: String(p.cid), name: bare(p.display), n, forced: want.includes(bare(p.display)) });
  }
  scored.sort((a, b) => (b.forced - a.forced) || (b.n - a.n));
  return scored.slice(0, PAGERS);
}

/* ---- scoring */
const clamp = (p) => Math.min(1 - 1e-6, Math.max(1e-6, p));
const acc = () => ({ ll: 0, br: 0, n: 0 });
const add = (s, p, y) => { const q = clamp(p); s.ll -= y ? Math.log(q) : Math.log(1 - q); s.br += (y - p) ** 2; s.n++; };
const fin = (s) => ({ ll: s.n ? +(s.ll / s.n).toFixed(5) : null, brier: s.n ? +(s.br / s.n).toFixed(5) : null, kills: s.n });
const hash = (s) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const RD0 = [30, 60, 100, 150, 250];

/** Each variant → per-event prediction (chance A gets that kill) for the events it replays; null for the others. */
function predictions(pe, e0) {
  const out = {};
  out.dice = pe.map(() => e0);
  const glk = (name, opts) => {
    const r = duelGlicko(pe, { ...opts, e0, min: 1 });
    // traj: one point per replayed kill, in order. A skipped (vehicle) kill gets the chance before it.
    const ps = [];
    let k = 0, last = null;
    for (const e of pe) {
      const kept = opts.veh === "all" || !(Number(e.veh) > 0);
      if (kept && r) { last = r.traj[k++].p; ps.push(last); } else ps.push(last == null ? (r ? r.traj[0].p : e0) : last);
    }
    out[name] = ps;
  };
  for (const veh of ["all", "inf"]) {
    glk(`flat-${veh}`, { seed: "flat", veh });
    for (const rd0 of RD0) glk(`ivi-${veh}-rd${rd0}`, { seed: "ivi", veh, o: { ...DUEL_GLICKO, rd0 } });
  }
  return out;
}

async function main() {
  const t0 = Date.now();
  const pagers = pickPagers();
  console.log(`pagers: ${pagers.length} (${pagers.slice(0, 5).map((p) => p.name).join(", ")} …)`);
  const pairs = new Map();
  for (const pg of pagers) {
    if (Date.now() - t0 > BUDGET_MS) { console.log("time budget reached"); break; }
    const st = { pid: pg.cid, qid: "0", all: [], cursor: 0 };
    try { await readPairPages(st, { base: BASE, get, pages: PAGES }); } catch (e) { console.log(`  ${pg.name}: ${e.message}`); }
    const by = new Map();
    for (const x of st.all) if (x[2] && x[2] !== "0" && x[2] !== pg.cid) by.set(x[2], (by.get(x[2]) || 0) + 1);
    let added = 0;
    for (const [oc, n] of by) {
      if (n < MIN) continue;
      const on = nameOf(oc);
      if (!on || !ivi.has(bare(on))) continue;
      const key = [pg.cid, oc].sort().join("-");
      const pe = pairEvents(st.all, oc, true);
      if (pairs.has(key) && pairs.get(key).pe.length >= pe.length) continue;
      pairs.set(key, { key, a: pg.name, b: bare(on), pe });
      added++;
    }
    console.log(`  ${pg.name}: ${st.all.length} events, ${st.pages || 0} pages, ${added} pairs`);
  }

  const sets = { tune: {}, test: {}, testInf: {} };
  const perPair = [];
  for (const P of pairs.values()) {
    const ia = ivi.get(P.a), ib = ivi.get(P.b);
    const e0 = duelExpected(ia, ib, fit, veh.get(P.a) ?? null, veh.get(P.b) ?? null);
    if (e0 == null) continue;
    const pe = P.pe;
    const tCut = pe[Math.floor(pe.length * 0.6)].t;
    const pr = predictions(pe, e0);
    const bucketName = hash(P.key) % 2 ? "test" : "tune";
    pe.forEach((e, i) => {
      if (e.t < tCut) return;
      for (const [m, ps] of Object.entries(pr)) {
        add((sets[bucketName][m] ||= acc()), ps[i], e.aKill ? 1 : 0);
        if (bucketName === "test" && !(Number(e.veh) > 0)) add((sets.testInf[m] ||= acc()), ps[i], e.aKill ? 1 : 0);
      }
    });
    const inf = duelGlicko(pe, { e0, seed: "ivi", veh: "inf" });
    const ka = pe.filter((e) => e.aKill).length;
    perPair.push({ a: P.a, b: P.b, n: pe.length, dice: +e0.toFixed(3), actual: +(ka / pe.length).toFixed(3), glicko: inf ? +inf.p.toFixed(3) : null, nInf: inf ? inf.n : 0 });
  }
  const res = (s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, fin(v)]));
  const tune = res(sets.tune), test = res(sets.test), testInf = res(sets.testInf);
  const best = (veh) => RD0.map((r) => `ivi-${veh}-rd${r}`).filter((m) => tune[m]).sort((x, y) => tune[x].ll - tune[y].ll)[0];
  const report = {
    at: new Date().toISOString(), pagers: pagers.length, pages: PAGES, pairs: perPair.length, minKills: MIN,
    bestTuned: { all: best("all"), inf: best("inf") }, tune, test, testInf,
    named: perPair.filter((p) => /tolyano|fantom220tr/.test(p.a + p.b)),
    sample: perPair.sort((x, y) => y.n - x.n).slice(0, 40),
  };
  fs.writeFileSync(path.join(ROOT, "data/duel-glicko-eval.json"), JSON.stringify(report, null, 1) + "\n");
  const line = (m, s = test) => (s[m] ? `${m} ll ${s[m].ll} br ${s[m].brier}` : `${m} –`);
  console.log(`::notice::glicko eval: ${perPair.length} pairs, test kills ${test.dice ? test.dice.kills : 0}; tuned best all=${report.bestTuned.all} inf=${report.bestTuned.inf}`);
  console.log(`::notice::TEST all kills: ${["dice", "flat-all", "flat-inf", report.bestTuned.all, report.bestTuned.inf].map((m) => line(m)).join(" | ")}`);
  console.log(`::notice::TEST infantry kills: ${["dice", "flat-inf", report.bestTuned.all, report.bestTuned.inf].map((m) => line(m, testInf)).join(" | ")}`);
  console.log(`::notice::TEST rd sweep (inf): ${RD0.map((r) => line(`ivi-inf-rd${r}`)).join(" | ")}`);
  for (const p of report.named.slice(0, 3)) console.log(`::notice::pair ${p.a} vs ${p.b}: n ${p.n} (inf ${p.nInf}) glicko ${p.glicko} dice ${p.dice} actual ${p.actual}`);
}

main().catch((e) => { console.log(`::error::${e.stack || e}`); process.exit(1); });
