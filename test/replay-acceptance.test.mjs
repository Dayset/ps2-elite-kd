// 🎬 Replay acceptance (#104): is pair mode true to the data across the normal band?
//
// Three parts, and what each one actually proves (read this before "fixing" a gate):
//  1. Pooled share/gap (the #95/#96 tolerances): 20 seeds × 6 data hours per pair.
//     A single 30-minute run CANNOT support ±3 points on share (n ≈ 16 decisive
//     engagements under the live model, σ ≈ 0.12) or ±10 % on the gap median
//     (lognormal σ ≈ 1.14, few within-fight gaps). The pooled run can, and does:
//     share within ±0.03 of pA, gap median within ±10 % of the model's.
//     pA here is the raw killboard share (aRow.kills / (aRow.kills + aRow.deaths)),
//     the #96 planner convention. The page itself shrinks small-n pairs toward
//     duelExpected (#93) — see the headless part, where the page pA is reported.
//  2. One 30-data-minute pure scene sim per pair (seed 12345, the ticket's run
//     length, without the page): shots/hits per kill, HS share, phase shares and
//     wall shares. Gates are sane bands, not exact mixes: there is no fixed
//     phase mix (approach absorbs the gap budget by design), so phases are
//     checked by presence + ordering (approach largest, trade longer than
//     commit), and HS is checked against collapse/absurdity, not an exact value
//     (its exact value depends on the trade/commit hit mix; #95's MC test owns
//     the calibration). Shots per kill counts engage() shots from ALL
//     engagements (breaks/thirds included) over resolved kills, as the scene does.
//  3. Headless page run: all 5 reference pairs load the real page, run exactly
//     30 data minutes via __fast, render a canvas, and produce no page errors.
//     MEASUREMENT RULE: use ONLY the __fast return value. After __fast returns,
//     the frame loop's jump cut advances simT and the tallies past the endpoint
//     (a calm approach stretch can be hundreds of data seconds), so reading
//     __params() afterwards measures a different moment. The scene tallies are
//     reported, not share-gated: with the live model (~83 s gaps) a 30-minute
//     scene holds only 7–20 decisive engagements, so its share is noise.
//  The live model is data/replay/pair-model.json when present (the page loads
//  the same file), else planDuel's DEFAULTS. No new i18n keys, no UI, no pin:
//  this file is not imported by any page. The file name contains "chromium"
//  via the browser list below, so CI's browser job runs (not skips) it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, createReadStream, statSync, mkdirSync, rmSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planDuel, DEFAULTS } from "../replay/duel-plan.mjs";
import { engage, mulberry, shooter, headChance } from "../replay/engagement.mjs";
import { toProfile, FALLBACK } from "../replay/weapons.mjs";
import { speedAt, bulletRate } from "../replay/director.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AR = toProfile(FALLBACK["Assault Rifle"]);
const profs = JSON.parse(readFileSync(path.join(root, "assets/weapons/profiles.json"), "utf8")).profiles || {};
const CLASSES = ["inf", "la", "med", "eng", "ha", "max"];
const side = (shard) => {
  const v = shard.v;
  const profile = toProfile(profs[String(shard.m?.[0])]) ?? AR;
  const c = Array.isArray(shard.c) ? shard.c.slice(1) : [];
  const shares = {};
  c.forEach((s, i) => { if (s > 0) shares[CLASSES[i]] = s; });
  return {
    sh: shooter(profile, { kd: v[0] ?? 1, spk: v[5] ?? 39.5, hpk: v[6] ?? 10.4, hsr: (v[4] ?? 18.26) / 100 }),
    info: { kpm: v[1] ?? 1, classShares: shares, revivedShare: v[13] ?? 0.3, resupplyPm: v[16] ?? 0 },
    profile,
  };
};
const fx = JSON.parse(readFileSync(path.join(root, "test/fixtures/replay-pairs.json"), "utf8"));
const modelPath = path.join(root, "data/replay/pair-model.json");
const model = existsSync(modelPath) ? JSON.parse(readFileSync(modelPath, "utf8")) : null;
const gapModel = model?.defaults?.gapMedianS ?? DEFAULTS.gapMedianS;
const pAOf = (pair) => pair.aRow.kills / (pair.aRow.kills + pair.aRow.deaths);
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Duel-plan phases mapped to the segment ids the director actually sees, mirroring
// replay/player.js (approach runs, spot idles, trade trades, commit fights,
// resolution dies for the victim, aftermath reloads when the winner reloads),
// including main's respawn-timer/beam segments between lives.
function mappedSegs(plan) {
  const segId = (phase, e) => phase === "approach" ? "running" : phase === "spot" ? "idle"
    : phase === "trade" ? "trading" : phase === "commit" ? "fight"
    : phase === "resolution" ? (e.victim === "a" ? "dying" : "idle")
    : e.segments.find((s) => s.phase === "aftermath")?.aIntent === "reload" ? "reloading" : "idle";
  const msegs = [];
  let prevT1 = 0, prevDeathAt = null;
  for (const e of plan.engagements) {
    if (e.respawnSide === "a" && prevDeathAt != null) {
      const lf = plan.lives.a.find((l) => l.start > prevDeathAt - 1e-9 && l.start <= e.t0 + 1e-9);
      const lifeStart = lf ? lf.start : prevDeathAt + e.respawnDur;
      const beamStart = lifeStart - 0.9;
      if (prevT1 < beamStart) msegs.push({ id: e.revived ? "beingRevived" : "respawnTimer", t0: prevT1, t1: beamStart });
      const b0 = Math.max(prevT1, beamStart);
      if (b0 < lifeStart) msegs.push({ id: "respawn", t0: b0, t1: lifeStart });
    }
    for (const s of e.segments) msegs.push({ id: segId(s.phase, e), t0: s.t0, t1: s.t1 });
    prevT1 = e.t1;
    if (e.victim) prevDeathAt = e.killAt ?? e.segments.find((s) => s.phase === "resolution").t0;
  }
  return msegs;
}

// Wall shares by stepping the director the way player.js advance() does:
// calm ×2 / ×1 by mapped segment, ×0.5 in the last 1.5 data s before a kill,
// and a 1.05 wall-s bullet envelope (bulletRate) at every decisive kill.
// Buckets are by what owns the wall time, so envelope ramps count as bullet time.
function wallShares(plan) {
  const segs = mappedSegs(plan);
  const fightEnds = segs.filter((s) => s.id === "fight").map((s) => s.t1).sort((a, b) => a - b);
  const wall = { fast2: 0, x1: 0, x05: 0, x02: 0 };
  const WDT = 0.05;
  let dataT = 0, wallT = 0, bulletUntil = -1, bi = 0;
  while (dataT < plan.duration) {
    while (bi < fightEnds.length && fightEnds[bi] <= dataT) { bulletUntil = wallT + 1.05; bi++; }
    let rate, bucket;
    if (wallT < bulletUntil) { rate = bulletRate(wallT - (bulletUntil - 1.05)); bucket = "x02"; }
    else {
      const cur = segs.find((s) => dataT >= s.t0 && dataT < s.t1) || segs[segs.length - 1];
      const nxt = fightEnds.find((f) => f > dataT);
      rate = speedAt(cur.id, nxt != null ? nxt - dataT : null, null);
      bucket = rate === 2 ? "fast2" : rate === 0.5 ? "x05" : "x1";
    }
    wall[bucket] += WDT; wallT += WDT; dataT += rate * WDT;
  }
  const tot = Object.values(wall).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(wall).map(([k, v]) => [k, +(v / tot).toFixed(3)]));
}

function simulate30(pair) {
  const A = side(pair.aShard), B = side(pair.bShard);
  const pA = pAOf(pair);
  const plan = planDuel(A.sh, B.sh, { seed: 12345, durationSec: 1800, pA, model, aInfo: A.info, bInfo: B.info });
  const rng = mulberry(67890);
  const tally = { aKills: 0, bKills: 0, shots: 0, hits: 0, hs: 0, kills: 0, phaseTime: {} };
  for (const e of plan.engagements) {
    if (e.outcome === "a") tally.aKills++;
    else if (e.outcome === "b") tally.bKills++;
    const opts = { wA: pA };
    if (["a", "b", "break", "third"].includes(e.outcome)) opts.outcome = e.outcome;
    const r = engage(A.sh, B.sh, rng, opts);
    tally.shots += r.shots.length;
    tally.hits += r.shots.filter((s) => s.hit).length;
    tally.hs += r.shots.filter((s) => s.hit && s.hs).length;
    if (e.outcome === "a" || e.outcome === "b") tally.kills++;
    for (const s of e.segments) tally.phaseTime[s.phase] = (tally.phaseTime[s.phase] || 0) + (s.t1 - s.t0);
  }
  const t = Object.values(tally.phaseTime).reduce((a, b) => a + b, 0);
  const phases = Object.fromEntries(Object.entries(tally.phaseTime).map(([k, v]) => [k, +(v / t).toFixed(3)]));
  const expHs = (headChance(A.sh.hsr, A.profile.hsMult ?? 2) + headChance(B.sh.hsr, B.profile.hsMult ?? 2)) / 2;
  return {
    plan, pA, tally,
    spk: tally.shots / tally.kills,
    hpr: tally.hits / tally.shots,
    hsShare: tally.hs / tally.hits,
    phases, wall: wallShares(plan), expHs,
  };
}

function pooled(pair) {
  const A = side(pair.aShard), B = side(pair.bShard);
  const pA = pAOf(pair);
  let decA = 0, decTot = 0;
  const gaps = [];
  for (let k = 0; k < 20; k++) {
    const plan = planDuel(A.sh, B.sh, { seed: 12345 + k, durationSec: 21600, pA, model, aInfo: A.info, bInfo: B.info });
    const dec = plan.engagements.filter((e) => e.outcome === "a" || e.outcome === "b");
    decTot += dec.length;
    decA += dec.filter((e) => e.outcome === "a").length;
    let lastKill = null, lastFight = -1;
    for (const e of dec) {
      if (lastKill != null && e.fightIdx === lastFight) gaps.push(e.killAt - lastKill);
      lastKill = e.killAt; lastFight = e.fightIdx;
    }
  }
  return { pA, share: decA / decTot, decTot, gapMed: med(gaps), gaps: gaps.length };
}

for (const pair of fx.pairs) {
  test(`acceptance: ${pair.id} over 30 data minutes`, () => {
    const { plan, pA, tally, spk, hpr, hsShare, phases, wall, expHs } = simulate30(pair);
    assert.ok(plan.engagements.length > 0, "no engagements produced");
    assert.ok(tally.kills > 0, "no resolved engagements");
    assert.ok(spk >= 10 && spk <= 200, `shots per kill ${spk.toFixed(1)} outside the engage() band`);
    assert.ok(tally.shots > 0 && tally.hits > 0, "no shots/hits fired");
    assert.ok(hpr > 0 && hpr <= 1, `hit rate ${hpr.toFixed(3)} impossible`);
    assert.ok(hsShare > 0.01 && hsShare < 0.6, `HS share ${hsShare.toFixed(3)} outside the sane band`);
    assert.ok(hsShare >= 0.4 * expHs, `HS share ${hsShare.toFixed(3)} collapsed vs expected ~${expHs.toFixed(3)}`);
    for (const ph of ["approach", "spot", "trade", "commit", "resolution", "aftermath"]) {
      assert.ok((tally.phaseTime[ph] || 0) > 0, `phase ${ph} missing`);
    }
    assert.ok(phases.approach > phases.trade, `approach ${phases.approach} not the largest phase share`);
    assert.ok(phases.trade > phases.commit, `trade ${phases.trade} not longer than commit ${phases.commit}`);
    for (const k of Object.keys(wall)) assert.ok(wall[k] > 0, `playback speed ${k} never used`);
    assert.ok(wall.fast2 >= 0.2, `×2 wall share ${wall.fast2} too small`);
    assert.ok(wall.x02 <= 0.1, `×0.2 bullet-time wall share ${wall.x02} too big`);
    const share = tally.aKills / (tally.aKills + tally.bKills);
    console.log(`PAIR ${pair.id}: pA=${pA.toFixed(3)} share30=${share.toFixed(3)} eng=${plan.engagements.length} spk=${spk.toFixed(1)} hitRate=${hpr.toFixed(3)} hs=${hsShare.toFixed(3)} (exp ~${expHs.toFixed(3)}) phases=${JSON.stringify(phases)} wall=${JSON.stringify(wall)}`);
  });

  test(`acceptance: ${pair.id} pooled share and gap (20 seeds × 6 h)`, () => {
    const { pA, share, decTot, gapMed, gaps } = pooled(pair);
    assert.ok(Math.abs(share - pA) <= 0.03, `pooled share ${share.toFixed(3)} vs pA ${pA.toFixed(3)} (n=${decTot})`);
    assert.ok(gapMed != null && Math.abs(gapMed - gapModel) / gapModel <= 0.10,
      `pooled gap median ${gapMed?.toFixed(1)} vs model ${gapModel.toFixed(1)} (n=${gaps})`);
    console.log(`POOLED ${pair.id}: pA=${pA.toFixed(3)} share=${share.toFixed(3)} (n=${decTot}) gapMed=${gapMed.toFixed(1)} vs model ${gapModel.toFixed(1)} (n=${gaps})`);
  });
}

// Headless page run (chromium via CDP over --remote-debugging-pipe, the repo's
// browser-test pattern): every reference pair loads the real page, runs exactly
// 30 data minutes via __fast, and produces no page errors. See the measurement
// rule in the header: only the __fast return value is read for tallies.
const chrome = ["google-chrome", "chromium", "chromium-browser", "google-chrome-stable"].find((b) => {
  try { execFileSync("which", [b], { stdio: "ignore" }); return true; } catch { return false; }
});
test("headless: all 5 reference pairs run 30 data minutes with __fast, no page errors", { skip: !chrome && "no Chrome", timeout: 300000 }, async () => {
  const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css" };
  const server = http.createServer((req, res) => {
    const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(root) || !existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
    createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const userDir = `${process.env.TMPDIR || "/tmp"}/replay-acceptance-${Date.now()}`;
  mkdirSync(userDir, { recursive: true });
  const proc = spawn(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-pipe", "--user-data-dir=" + userDir, "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  let id = 0, buf = "";
  const pending = new Map();
  let errors = [];
  proc.stdio[4].on("data", (d) => {
    buf += d.toString("utf8");
    let i;
    while ((i = buf.indexOf("\0")) >= 0) {
      const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
      if (msg.method === "Runtime.exceptionThrown") errors.push("exception: " + (msg.params.exceptionDetails?.text || "?"));
      if (msg.method === "Log.entryAdded" && msg.params.entry?.level === "error") errors.push("log: " + msg.params.entry.text);
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        errors.push("console: " + (msg.params.args || []).map((a) => a.value ?? a.description ?? "").join(" "));
      }
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const m = { id: ++id, method, params };
    if (sessionId) m.sessionId = sessionId;
    pending.set(m.id, (r) => (r.error ? reject(new Error(method + ": " + r.error.message)) : resolve(r.result)));
    proc.stdio[3].write(JSON.stringify(m) + "\0");
  });
  try {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Page.enable", {}, sessionId);
    await send("Runtime.enable", {}, sessionId);
    await send("Log.enable", {}, sessionId);
    const ev = async (expr) => {
      const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description || ""));
      return r.result.value;
    };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const pair of fx.pairs) {
      errors = [];
      const a = pair.aShard.n, b = pair.bShard.n;
      await send("Page.navigate", { url: `http://127.0.0.1:${port}/replay/index.html?name=${encodeURIComponent(a)}&vs=${encodeURIComponent(b)}` }, sessionId);
      let ready = false;
      for (let i = 0; i < 200 && !ready; i++) {
        await sleep(200);
        try { ready = await ev("window.__ready === true"); } catch { /* mid-navigation: retry */ }
      }
      assert.ok(ready, `${pair.id}: page never became ready`);
      const canvas = await ev("!!document.querySelector('canvas')");
      assert.ok(canvas, `${pair.id}: replay page did not render a canvas`);
      const params = await ev("window.__fast(1800, 1/30)");
      assert.ok(params.simT >= 1800 && params.simT < 1830, `${pair.id}: __fast ended at simT ${params.simT}, not 30 data minutes`);
      const st = params.stats;
      assert.ok(st.k > 0 && st.d > 0, `${pair.id}: scene produced no kills/deaths (k=${st.k} d=${st.d})`);
      assert.ok(st.shots > 0 && st.hits > 0 && st.hits <= st.shots, `${pair.id}: scene shots/hits impossible (shots=${st.shots} hits=${st.hits})`);
      assert.ok(st.hs <= st.k, `${pair.id}: HS kills ${st.hs} exceed kills ${st.k}`);
      assert.ok(errors.length === 0, `${pair.id}: page errors: ${errors.slice(0, 3).join(" | ")}`);
      const pagePA = await ev("window.__pair ? window.__pair().pA : null");
      console.log(`SCENE ${pair.id}: pagePA=${pagePA?.toFixed(3)} k=${st.k} d=${st.d} shots=${st.shots} hits=${st.hits} hsKills=${st.hs} simT=${params.simT.toFixed(1)}`);
    }
  } finally {
    proc.kill("SIGKILL");
    try { rmSync(userDir, { recursive: true, force: true }); } catch { /* ignore */ }
    server.close();
  }
});
