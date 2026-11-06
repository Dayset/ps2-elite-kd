#!/usr/bin/env node
/**
 * Duels for pairs who never met (owner 2026-11-06): a full Glicko-2 ladder over every PC kill
 * vs the static 🎲 fit (⚔️ iVi), measured on the stored 24/7 kills (KillMonitor `kc`, KILL_CLASSES=all,
 * 30 days). Runs only in Actions: player ids never leave the runner; the report is totals only.
 *
 * Ladder: every infantry kill (attacker not in a vehicle), oldest first, one rate1vs1 (ps2ranks:
 * tau 0.3, sigma 0.02, RD floor 30). Variants: flat start (1500, RD 100 / 350) and iVi start
 * (mu = 1500 + C·ln(iVi / median iVi), RD0 30 / 100 / 200, C = 0.5 / 1 × k_v1 / Q).
 * Test: the last TEST_SHARE of the time span. Scored = the FIRST kill between two players seen in
 * the whole pull (they never met before, as far as the data reaches), both with a ⚔️ iVi so all
 * models score the same kills. Each prediction is made before that kill updates the ladder.
 * The variant is picked on pairs with an even hash and reported on the odd ones.
 * Players on different servers never meet, so no data can score those pairs; same-server first
 * meetings are the closest measurable stand-in for "a random pair".
 *
 * env: CACHE_URL, CENSUS_PROXY_KEY, DAYS (≤ 31). Writes data/ladder-eval.json (totals only).
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { duelExpected, DUEL_FIT_V1 } from "../duels.mjs";
import { removedList } from "../opt-out.mjs";
import { glickoEnv, rating, rate1vs1, pairChance, Q } from "../glicko2.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));
const TEST_SHARE = 0.3;
const base = String(process.env.CACHE_URL || "https://ps2-elite-kd-cache.dayset.workers.dev").replace(/\/$/, "");
const key = process.env.CENSUS_PROXY_KEY || "";
const DAYS = Math.min(31, Number(process.env.DAYS) || 31);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(p) {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(base + p, { headers: { "X-Proxy-Key": key } });
      if (r.ok) return r.json();
      console.log(`status ${r.status}, retry`);
    } catch (e) { console.log(`fetch ${e.message}, retry`); }
    await sleep(5000 * (i + 1));
  }
  throw new Error("pull failed");
}
const unpack = (d) => {
  if (Array.isArray(d)) return d;
  if (typeof d !== "string") return [];
  try { return JSON.parse(d); } catch { /* maybe base64 gzip */ }
  try { return JSON.parse(zlib.gunzipSync(Buffer.from(d, "base64")).toString()); } catch { return []; }
};

/** Kills oldest first: [t, a, v] infantry only (attacker vehicle 0), valid ids, no suicides. */
async function pullKills() {
  const since0 = Math.floor(Date.now() / 1000) - DAYS * 86400;
  const seen = new Set(), kills = [];
  let since = since0, calls = 0;
  for (;;) {
    const j = await get(`/live/killclasses?since=${since}&limit=500`); calls++;
    const rows = j.rows || []; let added = 0;
    for (const r of rows) {
      const id = `${r.t0}|${r.t1}|${r.n}`; if (seen.has(id)) continue; seen.add(id); added++;
      for (const k of unpack(r.k)) {
        const [t, w, , a, v, , , , av] = k;
        if (!a || !v || a === "0" || v === "0" || a === v || +av) continue;
        kills.push([+t, String(a), String(v), +w]);
      }
    }
    if (rows.length < 500 || !added) break;
    since = rows[rows.length - 1].t1;
    await sleep(1200);
  }
  kills.sort((x, y) => x[0] - y[0]);
  console.log(`pulled ${kills.length} infantry kills in ${calls} calls`);
  return kills;
}

/* ---- iVi by character id (cid-names → ranks-lite) */
const lite = read("data/ranks-lite.json");
const c = lite.cols, ni = c.indexOf("name"), si = c.indexOf("slug"), ai = c.indexOf("adjs"), vi = c.indexOf("infVeh");
const byName = new Map();
for (const r of lite.rows) if (r[ai] > 0) for (const k of [String(r[ni]).toLowerCase(), String(r[si]).toLowerCase()]) byName.set(k, [r[ai], Number.isFinite(r[vi]) ? r[vi] / 100 : null]);
const cidName = read("data/cid-names.json");
const iviOf = new Map();
for (const [cid, v] of Object.entries(cidName)) { const x = byName.get(String(v[0]).toLowerCase()); if (x) iviOf.set(cid, x); }
const fit = read("data/duel-ivi-fit.json");
const ivs = [...iviOf.values()].map((x) => x[0]).sort((a, b) => a - b);
const MED = ivs[ivs.length >> 1] || 1000;
const C1 = DUEL_FIT_V1.k / Q; // rating points per ln(iVi ratio) that match the single-k 🎲 slope

/* ---- ladders */
const ENV = glickoEnv({ tau: 0.3, sigma: 0.02 });
const VARIANTS = [
  { id: "flat-rd100", seed: false, rd0: 100 }, { id: "flat-rd350", seed: false, rd0: 350 },
  ...[30, 100, 200].flatMap((rd0) => [0.5, 1].map((m) => ({ id: `ivi-rd${rd0}-c${m}`, seed: true, rd0, cm: m }))),
];
const start = (v, cid) => {
  const x = v.seed && iviOf.get(cid);
  return rating(x ? 1500 + v.cm * C1 * Math.log(x[0] / MED) : 1500, v.rd0, 0.02);
};
const floor = (r) => (r.phi < 30 ? rating(r.mu, 30, r.sigma) : r);

const clamp = (p) => Math.min(1 - 1e-6, Math.max(1e-6, p));
const acc = () => ({ ll: 0, br: 0, n: 0 });
const add = (s, p, y) => { const q = clamp(p); s.ll -= y ? Math.log(q) : Math.log(1 - q); s.br += (y - p) ** 2; s.n++; };
const fin = (s) => ({ ll: s.n ? +(s.ll / s.n).toFixed(5) : null, brier: s.n ? +(s.br / s.n).toFixed(5) : null, kills: s.n });
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

async function main() {
  if (!key) { console.log("::error::no proxy key"); process.exit(1); }
  const kills = await pullKills();
  if (kills.length < 1000) { console.log(`::warning::only ${kills.length} kills stored`); return; }
  const t0 = kills[0][0], t1 = kills[kills.length - 1][0];
  const tCut = t1 - (t1 - t0) * TEST_SHARE;
  const lad = VARIANTS.map(() => new Map());
  const games = new Map(), world = new Map(); // per cid: infantry kills + deaths, last world seen
  const met = new Set();
  const S = { tune: {}, test: {} };
  let firstAll = 0, firstIvi = 0, testKills = 0;
  for (const [t, a, v, w] of kills) {
    games.set(a, (games.get(a) || 0) + 1); games.set(v, (games.get(v) || 0) + 1);
    if (w) { world.set(a, w); world.set(v, w); }
    const lo = a < v ? a : v, hi = a < v ? v : a;
    const pk = lo + "|" + hi;
    const first = !met.has(pk);
    if (first) met.add(pk);
    const scoring = t >= tCut && first;
    if (t >= tCut) testKills++;
    let set = null, y = 0;
    if (scoring) {
      firstAll++;
      const il = iviOf.get(lo), ih = iviOf.get(hi);
      if (il && ih) {
        firstIvi++;
        set = hash(pk) % 2 ? S.test : S.tune;
        y = a === lo ? 1 : 0;
        add((set.dice ||= acc()), duelExpected(il[0], ih[0], fit, il[1], ih[1]), y);
      }
    }
    VARIANTS.forEach((vr, i) => {
      const m = lad[i];
      const ra = floor(m.get(a) || start(vr, a)), rv = floor(m.get(v) || start(vr, v));
      if (set) {
        const pa = pairChance(ra, rv); // chance the killer (a) gets this kill
        add((set[vr.id] ||= acc()), a === lo ? pa : 1 - pa, y);
      }
      const [na, nv] = rate1vs1(ENV, ra, rv);
      m.set(a, na); m.set(v, nv);
    });
  }
  const res = (s) => Object.fromEntries(Object.entries(s).map(([k, x]) => [k, fin(x)]));
  const tune = res(S.tune), test = res(S.test);
  const best = VARIANTS.map((v) => v.id).filter((id) => tune[id]).sort((x, y) => tune[x].ll - tune[y].ll)[0];
  const report = {
    at: new Date().toISOString(), days: +((t1 - t0) / 86400).toFixed(1), infantryKills: kills.length, testKills,
    players: lad[0].size, pairs: met.size, firstMeetings: firstAll, firstMeetingsBothIvi: firstIvi,
    iviPlayers: iviOf.size, medianIvi: MED, bestTuned: best, tune, test,
  };
  // 🌐 Published ladder (duels panel): the iVi-start variant, cached players with LADDER_MIN+ infantry
  // kills + deaths. Servers never meet, so each server's ratings drift on their own: every server is
  // shifted so its median (rating − iVi start) is 0, which puts all servers back on the iVi scale.
  const PUB = "ivi-rd100-c1", LADDER_MIN = 20;
  const pv = VARIANTS.find((v) => v.id === PUB), pm = lad[VARIANTS.indexOf(pv)];
  const removed = removedList((() => { try { return read("data/opt-out.json"); } catch { return {}; } })());
  const drift = new Map();
  for (const [cid, r] of pm) {
    const w = world.get(cid);
    if (!w || !iviOf.get(cid) || (games.get(cid) || 0) < LADDER_MIN) continue;
    if (!drift.has(w)) drift.set(w, []);
    drift.get(w).push(r.mu - start(pv, cid).mu);
  }
  const shift = new Map([...drift].map(([w, xs]) => { xs.sort((x, y) => x - y); return [w, xs[xs.length >> 1]]; }));
  const pub = {};
  for (const [cid, r] of pm) {
    const nm = cidName[cid] && String(cidName[cid][0]).toLowerCase();
    if (!nm || removed.match({ cid, name: nm }) || (games.get(cid) || 0) < LADDER_MIN || !Number.isFinite(r.mu)) continue;
    pub[nm] = [Math.round(r.mu - (shift.get(world.get(cid)) || 0)), Math.round(r.phi), games.get(cid), world.get(cid) || 0];
  }
  fs.writeFileSync(path.join(ROOT, "data/ladder.json"), JSON.stringify({
    v: 1, at: report.at, days: report.days, variant: PUB, tested: test[PUB] ? test[PUB].kills : 0,
    shift: Object.fromEntries([...shift].map(([w, x]) => [w, Math.round(x)])), cols: ["mu", "rd", "games", "world"], p: pub,
  }) + "\n");
  report.published = { variant: PUB, players: Object.keys(pub).length, shift: Object.fromEntries([...shift].map(([w, x]) => [w, Math.round(x)])) };
  fs.writeFileSync(path.join(ROOT, "data/ladder-eval.json"), JSON.stringify(report, null, 1) + "\n");
  const line = (m) => (test[m] ? `${m} ll ${test[m].ll} br ${test[m].brier}` : `${m} –`);
  console.log(`::notice::ladder eval: ${report.days} days, ${kills.length} infantry kills, ${met.size} pairs; first meetings in test ${firstAll} (both iVi ${firstIvi})`);
  console.log(`::notice::TEST first meetings: ${["dice", best, "flat-rd100", "flat-rd350"].map(line).join(" | ")}`);
  console.log(`::notice::TEST ivi sweep: ${VARIANTS.filter((v) => v.seed).map((v) => line(v.id)).join(" | ")}`);
}

main().catch((e) => { console.log(`::error::${e.stack || e}`); process.exit(1); });
