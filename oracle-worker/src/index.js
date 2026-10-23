/**
 * ps2-oracle: PS2MapOracle collector + odds engine + settlement, on Cloudflare.
 *
 * Every minute (cron):
 *  1. Census REST: map ownership for each tracked world (one call per world,
 *     all five continents), plus world_event METAGAME and FACILITY rows.
 *  2. Store in D1 (snap / flip: idempotent INSERT OR IGNORE; metagame: upsert of corrected scores).
 *  3. Rebuild every territory alert from the METAGAME rows: live alerts get a
 *     fresh state (push_live contract) + a win-history tick + benchmark slices;
 *     ended alerts settle from Census's own final scores at +0/+5/+10 min,
 *     with sudden death (events 236-240) deciding draws.
 *
 * No LLM, no paste step: the state the UI reads is the state the engine wrote.
 * Read API (CORS *): /health /live /alert?key= /history
 * Key API (X-Oracle-Key): /export, POST /commander, GET /privacy/list
 * Self-service removal (Bearer, #61): GET /privacy/me, POST /privacy/remove, POST /privacy/restore
 */
import {
  WORLDS, ZONES, WORLD_NAMES, ZONE_NAMES, TERRITORY_ALERTS, SUDDEN_DEATH, FACS, alertKind,
  buildState, forecast, liveZone, territory, sliceMinutes, brier, scoreWinner, popAdjusted,
} from "./engine.js";
import { binGetter, hasTree, regionMap, latticeFor, captureModel, resistanceModel } from "./models.js";
import { runCommander, ownership, applyElimination } from "./commander.js";
import { handleAuth, CHALLENGE_KEEP_S } from "./auth.js";
import { handleVote, settleStatements } from "./vote.js";
import { handlePrivacy } from "./privacy.js";
import { cutAwareSnap } from "./cut.js";
import { focusPlan } from "./focus.js";
import { alertFrames, archiveAlert, nextToArchive, putBundle, validBundle } from "./archive.js";
export { AuthWatcher } from "./auth-watcher.js";

const CENSUS = "https://census.daybreakgames.com";
const UA = "ps2-elite-kd-oracle/1.0 (+https://github.com/Dayset/ps2-elite-kd; contact: github.com/Dayset)";
const FINAL = ["settled", "canceled", "unresolved"];
const WINDOW_S = 8 * 3600; // how far back alerts are rebuilt from METAGAME rows

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Oracle-Key",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Cache-Control": "public, max-age=15",
      ...extra,
    },
  });

// ---------------------------------------------------------------- Census

async function census(sid, path) {
  const res = await fetch(`${CENSUS}/s:${sid}/get/ps2:v2/${path}`, {
    headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`census ${res.status} ${path.split("?")[0]}`);
  const j = await res.json();
  if (j.error || j.errorCode) throw new Error(`census error ${j.error || j.errorCode} ${path.split("?")[0]}`);
  return j;
}

export function parseMap(j) {
  const zones = {};
  for (const m of j.map_list || []) {
    const z = String(m.ZoneId);
    const rows = (m.Regions && m.Regions.Row) || [];
    const fz = {};
    for (const r of rows) if (r.RowData) fz[r.RowData.RegionId] = String(r.RowData.FactionId);
    if (rows.length) zones[z] = fz;
  }
  return zones;
}

const num = (x) => (x === undefined || x === null || x === "" ? null : +x);

export function parseMetagame(j) {
  return (j.world_event_list || [])
    .filter((e) => e.event_type === "MetagameEvent")
    .map((e) => ({
      world: +e.world_id, zone: +e.zone_id, instance_id: +e.instance_id, event_id: +e.metagame_event_id,
      state: e.metagame_event_state_name, ts: +e.timestamp,
      vs: num(e.faction_vs), nc: num(e.faction_nc), tr: num(e.faction_tr),
    }))
    .filter((e) => TERRITORY_ALERTS[e.event_id] || SUDDEN_DEATH[e.event_id]);
}

export function parseFlips(j) {
  return (j.world_event_list || [])
    .filter((e) => e.event_type === "FacilityControl" && e.faction_old !== e.faction_new)
    .map((e) => ({
      world: +e.world_id, zone: +e.zone_id, facility: +e.facility_id, ts: +e.timestamp,
      old: +e.faction_old, new: +e.faction_new, held: num(e.duration_held), outfit: e.outfit_id || null,
    }));
}

// ---------------------------------------------------------------- D1 helpers

async function latestSnap(db, world, atOrBefore) {
  const r = await db.prepare("SELECT ts, zones FROM snap WHERE world=? AND ts<=? ORDER BY ts DESC LIMIT 1").bind(world, atOrBefore).first();
  return r ? { ts: r.ts, zones: JSON.parse(r.zones) } : null;
}

/** One statement for any number of rows (D1 free plan: 50 queries per invocation). */
function bulkInsert(db, table, cols, rows, onConflict = null) {
  const sel = cols.map((c) => `json_extract(value,'$.${c}')`).join(", ");
  // onConflict: an upsert clause instead of OR IGNORE ("WHERE true" keeps SQLite's
  // INSERT … SELECT … ON CONFLICT parse unambiguous).
  const sql = onConflict
    ? `INSERT INTO ${table} (${cols.join(", ")}) SELECT ${sel} FROM json_each(?) WHERE true ${onConflict}`
    : `INSERT OR IGNORE INTO ${table} (${cols.join(", ")}) SELECT ${sel} FROM json_each(?)`;
  return db.prepare(sql)
    .bind(JSON.stringify(rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])))));
}

async function setMeta(db, k, v) {
  await db.prepare("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(k, JSON.stringify(v)).run();
}

async function getMeta(db, k) {
  const r = await db.prepare("SELECT v FROM meta WHERE k=?").bind(k).first();
  return r ? JSON.parse(r.v) : null;
}

// ---------------------------------------------------------------- cycle

/** Group METAGAME rows into alert instances keyed world-zone-instance. */
/**
 * Live-state input guard -> list of reasons (empty = clean).
 *   neutral_heavy:<owned%>  under 90 % of regions owned (Census map gone neutral);
 *                           not checked for Meltdowns, which lock most of the map by design
 *   map_frozen              zone map identical to 10+ min ago while 2+ captures happened
 *   map_stale               no fresh map for 5+ min
 */
export function dataSuspect(zNow, nowTs, s10, zone, flipsIn10, now, kind = "territory") {
  const out = [];
  const terr = territory(zNow);
  const owned = terr.VS + terr.NC + terr.TR;
  if (kind !== "meltdown" && owned < 90) out.push(`neutral_heavy:${owned.toFixed(1)}`);
  const z10 = s10 && s10.zones[String(zone)];
  if (z10 && now - s10.ts <= 900 && flipsIn10 >= 2 && JSON.stringify(z10) === JSON.stringify(zNow)) out.push("map_frozen");
  if (now - nowTs > 300) out.push("map_stale");
  return out;
}

const sliceOf = (w, t) => ({ VS: w.VS.pct / 100, NC: w.NC.pct / 100, TR: w.TR.pct / 100, t: Math.round(t * 10) / 10 });

export function groupAlerts(rows) {
  const by = new Map();
  for (const r of rows) {
    if (!TERRITORY_ALERTS[r.event_id]) continue;
    const key = `${r.world}-${r.zone}-${r.instance_id}`;
    const a = by.get(key) || { key, world: r.world, zone: r.zone, instance_id: r.instance_id, event_id: r.event_id };
    if (r.state === "started") a.start = r;
    else if (r.state === "ended" || r.state === "canceled") a.end = r;
    by.set(key, a);
  }
  return [...by.values()].filter((a) => a.start);
}

/** Sudden-death instance on the same world+zone that began at this alert's end. */
export function findSuddenDeath(rows, a, endTs) {
  const sd = rows.filter((r) => SUDDEN_DEATH[r.event_id] && r.zone === a.zone && r.world === a.world);
  const start = sd.find((r) => r.state === "started" && r.ts >= endTs - 120 && r.ts <= endTs + 600);
  if (!start) return null;
  const end = sd.find((r) => r.instance_id === start.instance_id && (r.state === "ended" || r.state === "canceled"));
  return { start, end: end || null };
}

/** Daily retention (PRIVACY.md, #61). Exported for tests. */
export function pruneStatements(db, now) {
  return [
    db.prepare("DELETE FROM snap WHERE ts < ?").bind(now - 30 * 86400),
    db.prepare("DELETE FROM flip WHERE ts < ?").bind(now - 90 * 86400),
    db.prepare("DELETE FROM tick WHERE ts < ?").bind(now - 90 * 86400),
    db.prepare("DELETE FROM pop WHERE ts < ?").bind(now - 30 * 86400),
    db.prepare("DELETE FROM challenge WHERE created < ?").bind(now - CHALLENGE_KEEP_S),
  ];
}

export async function runCycle(env, nowMs = Date.now()) {
  const db = env.DB;
  const sid = (env.CENSUS_SERVICE_ID || "daysetps2legends").replace(/^s:/, "");
  const now = Math.floor(nowMs / 1000);
  const t0 = Date.now();
  const report = { ts: now, worlds: {}, errors: [] };

  // 1) Census, all in parallel.
  const worldIds = WORLDS.join(",");
  const [maps, mg, fac] = await Promise.all([
    Promise.allSettled(WORLDS.map((w) => census(sid, `map/?world_id=${w}&zone_ids=${ZONES.join(",")}`))),
    census(sid, `world_event/?world_id=${worldIds}&type=METAGAME&c:limit=60`).catch((e) => e),
    census(sid, `world_event/?world_id=${worldIds}&type=FACILITY&c:limit=250`).catch((e) => e),
  ]);

  // 2) Store.
  const stmts = [];
  const fresh = {};
  const snapRows = [];
  maps.forEach((r, i) => {
    const w = WORLDS[i];
    if (r.status !== "fulfilled") { report.worlds[w] = "error"; report.errors.push(`map w${w}: ${r.reason && r.reason.message}`); return; }
    const zones = parseMap(r.value);
    const n = Object.keys(zones).length;
    report.worlds[w] = n ? `ok ${n} zones` : "dark";
    if (!n) return;
    fresh[w] = { ts: now, zones };
    snapRows.push({ world: w, ts: now, zones: JSON.stringify(zones) });
  });
  if (snapRows.length) {
    stmts.push(db.prepare(`INSERT OR IGNORE INTO snap (world, ts, zones)
      SELECT json_extract(value,'$.world'), json_extract(value,'$.ts'), json_extract(value,'$.zones') FROM json_each(?)`).bind(JSON.stringify(snapRows)));
  }
  let mgRows = [];
  if (mg instanceof Error) report.errors.push(`metagame: ${mg.message}`);
  else {
    mgRows = parseMetagame(mg);
    // #26: Census may correct an ended row later (scores filled in or changed): take the
    // new scores. Alerts already settled are skipped by the cycle, so they never change.
    if (mgRows.length) stmts.push(bulkInsert(db, "metagame", ["world", "zone", "instance_id", "event_id", "state", "ts", "vs", "nc", "tr"], mgRows,
      "ON CONFLICT(world, instance_id, state, event_id) DO UPDATE SET vs=excluded.vs, nc=excluded.nc, tr=excluded.tr WHERE excluded.vs IS NOT NULL"));
  }
  if (fac instanceof Error) report.errors.push(`facility: ${fac.message}`);
  else {
    const flips = parseFlips(fac);
    report.flips = flips.length;
    if (flips.length) stmts.push(bulkInsert(db, "flip", ["world", "zone", "facility", "ts", "old", "new", "held", "outfit"], flips));
  }
  if (stmts.length) await db.batch(stmts);

  // 3) Alerts from stored METAGAME rows (not just this poll's 60).
  const all = (await db.prepare("SELECT * FROM metagame WHERE ts > ? ORDER BY ts").bind(now - WINDOW_S).all()).results || [];
  const known = new Map(((await db.prepare("SELECT key, status, checks, flags FROM alert WHERE start_ts > ?").bind(now - WINDOW_S).all()).results || []).map((r) => [r.key, r]));
  // D1 row reads are the free plan's scarce budget (5M/day for the account): every per-minute
  // query here must use an index. Open benchmarks only matter for alerts this cycle rebuilds.
  const benchRows = new Map(((await db.prepare("SELECT b.key, b.slices FROM alert a JOIN bench b ON b.key = a.key WHERE a.start_ts > ? AND b.settled_ts IS NULL")
    .bind(now - 2 * WINDOW_S).all()).results || []).map((r) => [r.key, JSON.parse(r.slices)]));
  const out = [];
  const ticks = [], benchUp = [], benchSettle = [];
  const snap15 = {};
  // Population comes from Honu via the oracle-honu Actions job (/honu/ingest):
  // Honu's API is not reachable from Cloudflare's network. Use it while fresh.
  const popFor = (world, zone) => db.prepare("SELECT ts, vs, nc, tr, ns FROM pop WHERE world=? AND zone=? AND ts>? ORDER BY ts DESC LIMIT 1")
    .bind(world, zone, now - POP_MAX_AGE_S).first();
  let live = 0, settled = 0;
  // Input guard (corrupt Census map windows: many facilities neutral, or the map
  // frozen while capture events keep arriving). Flips per zone over 10 min, one query.
  // world/zone IN lists let the (world, zone, ts) index answer this; a filter on ts alone scanned every stored flip each minute.
  const flips10 = new Map((((await db.prepare(`SELECT world, zone, COUNT(*) AS n FROM flip WHERE world IN (${WORLDS.join(",")}) AND zone IN (${ZONES.join(",")}) AND ts > ? GROUP BY world, zone`)
    .bind(now - 600).all()).results) || [])
    .map((r) => [`${r.world}-${r.zone}`, r.n]));
  const snap10 = {};

  for (const a of groupAlerts(all)) {
    const prev = known.get(a.key);
    if (prev && FINAL.includes(prev.status)) continue;
    const dur = TERRITORY_ALERTS[a.event_id];
    const startTs = a.start.ts;
    const base = { key: a.key, world: a.world, zone: a.zone, instance_id: a.instance_id, event_id: a.event_id, start_ts: startTs, dur, kind: alertKind(a.event_id) };

    if (!a.end) {
      if (now > startTs + dur * 60 + 1800) { out.push({ ...base, status: "unresolved" }); continue; }
      if (now > startTs + dur * 60 + 300) { out.push({ ...base, status: "settling" }); continue; }
      // Live alert: compute the state.
      if (!hasTree(a.zone)) continue;
      const snapNow = fresh[a.world] || (await latestSnap(db, a.world, now));
      const zNow = snapNow && snapNow.zones[String(a.zone)];
      if (!zNow) { out.push({ ...base, status: "live" }); continue; }
      if (!(a.world in snap15)) snap15[a.world] = await latestSnap(db, a.world, now - 900);
      const s15 = snap15[a.world];
      const z15 = s15 && s15.zones[String(a.zone)];
      const state = buildState({
        getBin: binGetter(a.zone), world: a.world, zone: a.zone, eventId: a.event_id, instanceId: a.instance_id,
        startTs, dur, now, snapNow: zNow, snap15: z15 || null, regionMap: regionMap(a.zone),
        cutSnap: (sn) => cutAwareSnap(sn, a.zone).snap,
      });
      if (!(a.world in snap10)) snap10[a.world] = await latestSnap(db, a.world, now - 600);
      const suspect = dataSuspect(zNow, snapNow.ts, snap10[a.world], a.zone, flips10.get(`${a.world}-${a.zone}`) || 0, now, alertKind(a.event_id));
      if (suspect.length) { state.suspect = suspect; (report.suspect ||= {})[a.key] = suspect; }
      // Bases cut off from their warpgate (the game stops scoring them). Logged as the
      // "_cut" benchmark variant; the live odds switch only if the rescan backs it.
      const kindNow = alertKind(a.event_id);
      const cutNow = kindNow === "meltdown" ? null : cutAwareSnap(zNow, a.zone);
      if (cutNow && cutNow.cut.length) state.cut = cutNow.cut.map((c) => ({ fid: c.fid, name: c.name, fac: c.fac }));
      const p = await popFor(a.world, a.zone);
      if (p) {
        state.pop = { VS: p.vs, NC: p.nc, TR: p.tr };
        state.pop_ns = p.ns;
        state.pop_source = "honu";
        state.pop_age_s = now - p.ts;
        state.win_popadj = popAdjusted(state.win, state.pop, state.t);
      }
      out.push({ ...base, status: "live", state });
      live++;
      (report.live_keys ||= []).push(a.key);
      ticks.push({ key: a.key, ts: now, t: Math.round(((now - startTs) / 60) * 10) / 10, terr: JSON.stringify(state.territory),
        win: JSON.stringify(Object.fromEntries(FACS.map((f) => [f, state.win[f].pct]))) });
      // Benchmark slices: t0 only if first seen within 5 min of start (honest t0),
      // then each checkpoint once.
      const t = (now - startTs) / 60;
      const slices = benchRows.get(a.key) || {};
      let changed = false;
      for (const [label, m] of Object.entries(sliceMinutes(dur))) {
        if (slices[label] || t < m) continue;
        if (label === "t0") {
          if (t > 5) continue;
          const f0 = forecast({ getBin: binGetter(a.zone), kind: alertKind(a.event_id), snapNow: zNow, snap15: null, t: Math.max(t, 0), dur, zeroMomentum: true });
          slices.t0 = sliceOf(f0.win, t);
          if (f0.winRaw) { slices.t0_raw = sliceOf(f0.winRaw, t); slices.t0_v0 = sliceOf(f0.winV0, t); }
          const pa = state.pop_source ? popAdjusted(f0.win, state.pop, Math.max(t, 0)) : null;
          if (pa) slices.t0_pop = sliceOf(pa, t);
        } else if (t <= m + 5) {
          slices[label] = sliceOf(state.win, t);
          if (cutNow) {
            const c15 = z15 ? cutAwareSnap(z15, a.zone) : null;
            const fc = cutNow.cut.length || (c15 && c15.cut.length)
              ? forecast({ getBin: binGetter(a.zone), kind: kindNow, snapNow: cutNow.snap, snap15: c15 ? c15.snap : null, t, dur }).win : state.win;
            slices[label + "_cut"] = sliceOf(fc, t);
          }
          if (state.win_raw) { slices[label + "_raw"] = sliceOf(state.win_raw, t); slices[label + "_v0"] = sliceOf(state.win_v0, t); }
          const pa = state.win_popadj;
          if (pa) slices[label + "_pop"] = sliceOf(pa, t);
        } else continue;
        changed = true;
      }
      if (changed) benchUp.push({ key: a.key, dur, slices: JSON.stringify(slices) });
      continue;
    }

    // Ended or canceled.
    const endTs = a.end.ts;
    if (a.end.state === "canceled") { out.push({ ...base, status: "canceled", end_ts: endTs }); continue; }
    const final = { VS: a.end.vs, NC: a.end.nc, TR: a.end.tr };
    const finalOk = FACS.every((f) => final[f] !== null && final[f] !== undefined && Number.isFinite(+final[f]));
    const checks = Math.min(3, 1 + Math.floor(Math.max(0, now - endTs) / 300));
    const flags = prev && prev.flags ? JSON.parse(prev.flags) : [];
    // Cross-check: our own last pre-end snapshot (never a post-end one).
    if (!flags.includes("checked")) {
      const pre = await latestSnap(db, a.world, endTs);
      const z = pre && pre.zones[String(a.zone)];
      if (z) {
        const terr = territory(z);
        const owned = terr.VS + terr.NC + terr.TR;
        if (base.kind !== "meltdown" && owned < 90) flags.push(`neutral_heavy:${owned.toFixed(1)}`);
        const sw = scoreWinner(terr);
        if (finalOk && sw !== scoreWinner(final)) flags.push(`snapshot_winner_${sw}`);
        if (endTs - pre.ts > 600) flags.push("snapshot_stale");
        flags.push("checked");
      }
    }
    // A corrupt map window AND a disagreeing snapshot: keep Census's winner on the
    // record, but give every vote back (we can't be sure who really won).
    if (flags.some((f) => f.startsWith("neutral_heavy")) && flags.some((f) => f.startsWith("snapshot_winner_")) && !flags.includes("votes_void")) flags.push("votes_void");
    const rec = { ...base, end_ts: endTs, final: finalOk ? final : null, checks, flags };
    if (checks < 3) { out.push({ ...rec, status: "settling" }); continue; }
    // Census ended row without scores: fall back to our last pre-end snapshot when
    // it is clean (fresh, not neutral-heavy); otherwise unresolved (votes given back).
    const finalWinner = async () => {
      if (finalOk) return { winner: scoreWinner(final), basis: "census_final" };
      if (!flags.includes("final_missing")) flags.push("final_missing");
      const pre = await latestSnap(db, a.world, endTs);
      const z = pre && pre.zones[String(a.zone)];
      if (!z || endTs - pre.ts > 600) return null;
      const terr = territory(z);
      if (base.kind === "meltdown" ? liveZone(z).active < 3 : terr.VS + terr.NC + terr.TR < 90) return null;
      const w = scoreWinner(terr);
      return w === "draw" ? null : { winner: w, basis: "snapshot" };
    };
    const sd = findSuddenDeath(all, a, endTs);
    let winner = null, basis = null;
    if (sd) {
      if (sd.end && sd.end.state === "ended") { winner = scoreWinner({ VS: sd.end.vs, NC: sd.end.nc, TR: sd.end.tr }); basis = "sudden_death"; }
      else if (sd.end) {
        flags.push("sudden_death_canceled");
        const fw = await finalWinner();
        if (!fw) { out.push({ ...rec, status: "unresolved" }); continue; }
        ({ winner, basis } = fw);
      }
      else if (now > sd.start.ts + 45 * 60) { out.push({ ...rec, status: "unresolved" }); continue; }
      else { out.push({ ...rec, status: "sudden_death" }); continue; }
    } else {
      const fw = await finalWinner();
      if (!fw) { out.push({ ...rec, status: finalOk ? "settling" : "unresolved" }); continue; }
      ({ winner, basis } = fw);
      if (winner === "draw" && now < endTs + 1200) { out.push({ ...rec, status: "settling" }); continue; }
    }
    out.push({ ...rec, status: "settled", winner, basis });
    settled++;
    const slices = benchRows.get(a.key);
    if (slices) {
      const b = {};
      if (FACS.includes(winner)) for (const [k, p] of Object.entries(slices)) b[k] = Math.round(brier(p, winner) * 10000) / 10000;
      benchSettle.push(db.prepare("UPDATE bench SET winner=?, brier=?, settled_ts=? WHERE key=?").bind(winner, JSON.stringify(b), now, a.key));
    }
  }

  // 4) Write: alert upserts (only rows that changed), ticks, benchmark — one batch.
  const changedRows = out.filter((r) => {
    const p = known.get(r.key);
    return !p || r.status === "live" || p.status !== r.status || (r.checks || 0) !== p.checks;
  }).map((r) => ({
    key: r.key, world: r.world, zone: r.zone, instance_id: r.instance_id, event_id: r.event_id, start_ts: r.start_ts, dur: r.dur,
    status: r.status, end_ts: r.end_ts || null, checks: r.checks || 0, winner: r.winner || null, basis: r.basis || null,
    final: r.final ? JSON.stringify(r.final) : null, flags: r.flags ? JSON.stringify(r.flags) : null,
    state: r.state ? JSON.stringify(r.state) : null, updated: now,
  }));
  const writes = [];
  if (changedRows.length) {
    const cols = ["key", "world", "zone", "instance_id", "event_id", "start_ts", "dur", "status", "end_ts", "checks", "winner", "basis", "final", "flags", "state", "updated"];
    writes.push(db.prepare(`INSERT INTO alert (${cols.join(", ")})
      SELECT ${cols.map((c) => `json_extract(value,'$.${c}')`).join(", ")} FROM json_each(?) WHERE true
      ON CONFLICT(key) DO UPDATE SET status=excluded.status, end_ts=excluded.end_ts, checks=excluded.checks,
        winner=excluded.winner, basis=excluded.basis, final=excluded.final, flags=excluded.flags,
        state=COALESCE(excluded.state, alert.state), updated=excluded.updated`).bind(JSON.stringify(changedRows)));
  }
  if (ticks.length) writes.push(bulkInsert(db, "tick", ["key", "ts", "t", "terr", "win"], ticks));
  if (benchUp.length) {
    writes.push(db.prepare(`INSERT INTO bench (key, dur, slices)
      SELECT json_extract(value,'$.key'), json_extract(value,'$.dur'), json_extract(value,'$.slices') FROM json_each(?) WHERE true
      ON CONFLICT(key) DO UPDATE SET slices=excluded.slices`).bind(JSON.stringify(benchUp)));
  }
  writes.push(...benchSettle);
  if (writes.length) await db.batch(writes);
  report.written = changedRows.length;

  // 4c) Settle votes on alerts that reached a final status (BonusCheques only).
  const toSettle = ((await db.prepare(`SELECT DISTINCT a.key, a.status, a.winner, a.flags FROM vote v JOIN alert a ON a.key = v.key
    WHERE v.status = 'open' AND a.status IN ('settled','canceled','unresolved')`).all()).results) || [];
  if (toSettle.length) { await db.batch(settleStatements(db, toSettle, now)); report.votes_settled = toSettle.length; }

  // 5) Daily pruning at 04:07 UTC: raw snapshots 30 days, flips 90 days,
  //    sign-in challenges (character + keyed IP hash) 1 day (#61, PRIVACY.md).
  const d = new Date(nowMs);
  if (d.getUTCHours() === 4 && d.getUTCMinutes() === 7) {
    await db.batch(pruneStatements(db, now));
  }

  report.metagame = mgRows.length;
  report.live = live;
  report.settled = settled;
  report.ms = Date.now() - t0;
  await setMeta(db, "last_cycle", report);
  if (!report.errors.length) await setMeta(db, "last_ok", now);
  return report;
}

// ---------------------------------------------------------------- commander

const FAC_NAME = { 1: "VS", 2: "NC", 3: "TR" };

/**
 * AI Commander for one live alert (port of commander_live.py --json), stored in
 * alert.commander. Runs in its own invocation (see fanOutCommander) so its CPU
 * never counts against the odds/settlement cycle.
 */
export async function commanderFor(env, key, nowMs = Date.now()) {
  const db = env.DB;
  const now = Math.floor(nowMs / 1000);
  const a = await db.prepare("SELECT key, world, zone, event_id, start_ts, dur, status, json_extract(state, '$.suspect') AS suspect, json_extract(state, '$.win') AS win FROM alert WHERE key=?").bind(key).first();
  if (!a || a.status !== "live") return { key, skipped: "not live" };
  // Corrupt map window: keep the last good orders instead of computing from bad data.
  if (a.suspect && JSON.parse(a.suspect).length) return { key, skipped: "data suspect" };
  const lattice = latticeFor(a.zone);
  const r2f = regionMap(a.zone);
  if (!lattice || !r2f || !hasTree(a.zone)) return { key, skipped: "no lattice" };
  const [sNow, s15, fl] = await Promise.all([
    latestSnap(db, a.world, now), latestSnap(db, a.world, now - 900),
    db.prepare("SELECT ts, old, new, facility FROM flip WHERE world=? AND zone=? AND ts>=? ORDER BY ts").bind(a.world, a.zone, a.start_ts - 600).all(),
  ]);
  const meltdown = alertKind(a.event_id) === "meltdown";
  // Meltdowns: only the live zone exists for the commander (locked neutral regions dropped).
  const live = (z) => (z && meltdown ? liveZone(z).snap : z);
  const zNow = live(sNow && sNow.zones[String(a.zone)]);
  if (!zNow) return { key, skipped: "no snapshot" };
  const z15 = live(s15 && s15.zones[String(a.zone)]);
  const flips = ((fl && fl.results) || [])
    .map((r) => [r.ts, FAC_NAME[r.new], FAC_NAME[r.old], String(r.facility)])
    .filter((x) => x[1] && x[2] && x[1] !== x[2])
    .sort((x, y) => x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0) || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0) || (x[3] < y[3] ? -1 : x[3] > y[3] ? 1 : 0));
  const t0 = Date.now();
  const cmd = runCommander({
    world: a.world, zone: a.zone, startTs: a.start_ts, t: (now - a.start_ts) / 60, dur: a.dur,
    own: ownership(zNow, r2f), own15: z15 ? ownership(z15, r2f) : null, flips,
    lattice, pf: captureModel(a.zone), res: resistanceModel(a.zone), getBin: binGetter(a.zone),
  });
  if (!cmd) return { key, skipped: "empty ownership" };
  applyElimination(cmd);
  if (meltdown && a.win) {
    // Show the header's (cautious) Meltdown odds; the commander's own tree value stays in win_pct_raw.
    const w = JSON.parse(a.win);
    for (const f of FACS) if (cmd.factions[f] && w[f]) cmd.factions[f].win_pct = w[f].pct;
  }
  // Focus: one clear move per faction, up to two captures ahead, scored the way the game scores (cuts).
  try {
    const terrNow = territory(zNow), terr15 = z15 ? territory(z15) : terrNow;
    const pf = captureModel(a.zone);
    cmd.focus = focusPlan({
      own: ownership(zNow, r2f), lattice, getBin: binGetter(a.zone), t: Math.max(0, (now - a.start_ts) / 60), dur: a.dur,
      mom: Object.fromEntries(FACS.map((f) => [f, terrNow[f] - terr15[f]])),
      header: a.win ? JSON.parse(a.win) : null,
      pf: (fid) => (pf[`${fid}|P1:pressured`] || {}).p ?? 0.33,
      nFac: meltdown ? Object.keys(zNow).length : undefined, noCuts: meltdown,
    });
  } catch (e) { cmd.focus_error = String(e && e.message || e).slice(0, 200); }
  cmd.source = "worker";
  await db.prepare("UPDATE alert SET commander=?, commander_ts=? WHERE key=? AND status='live'").bind(JSON.stringify(cmd), now, key).run();
  return { key, ok: true, ms: Date.now() - t0, flips: flips.length };
}

/** One separate Worker invocation per key via the SELF service binding (inline without one). */
async function fanOut(env, path, fn, keys, nowMs) {
  if (!keys || !keys.length) return [];
  if (!env.SELF) return Promise.all(keys.map((k) => fn(env, k, nowMs).catch((e) => ({ key: k, error: String(e && e.message || e) }))));
  return Promise.all(keys.map(async (k) => {
    try {
      const r = await env.SELF.fetch(new Request(`https://ps2-oracle/internal/${path}`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Oracle-Key": env.ORACLE_KEY || "" }, body: JSON.stringify({ key: k }),
      }));
      return r.ok ? await r.json() : { key: k, error: `status ${r.status}` };
    } catch (e) { return { key: k, error: String(e && e.message || e) }; }
  }));
}
export const fanOutCommander = (env, keys, nowMs = Date.now()) => fanOut(env, "commander", commanderFor, keys, nowMs);
export const fanOutArchive = (env, keys, nowMs = Date.now()) => fanOut(env, "archive", archiveAlert, keys, nowMs);

// ---------------------------------------------------------------- Honu bridge

const POP_MAX_AGE_S = 15 * 60;       // population older than this is not used
const RADAR_RECHECK_S = 3 * 86400;   // PS2 Radar answers are reused for 3 days
const REPORT_RETRY_S = 240, REPORT_MAX_ATTEMPTS = 12, REPORT_WINDOW_S = 6 * 3600;

/** Work for the oracle-honu Actions job: live zones needing population, settled alerts needing reports. */
export async function honuQueue(db, now) {
  const live = ((await db.prepare("SELECT key, world, zone FROM alert WHERE status='live'").all()).results) || [];
  const reports = ((await db.prepare(
    `SELECT a.key, a.world, a.zone, a.instance_id FROM alert a LEFT JOIN report r ON r.key = a.key
     WHERE a.status = 'settled' AND a.end_ts > ? AND (r.key IS NULL OR (r.status != 'ok' AND r.attempts < ? AND r.ts < ?))
     ORDER BY a.end_ts DESC LIMIT 5`).bind(now - REPORT_WINDOW_S, REPORT_MAX_ATTEMPTS, now - REPORT_RETRY_S).all()).results) || [];
  return { pop: live, reports };
}

/**
 * Results from the oracle-honu job:
 *   pop:     [{world, zone, vs, nc, tr, ns}]                (Honu population/{world}/zones)
 *   reports: [{key, status: ok|pending|error, report?, err?}] (outliers.js output)
 *   radar:   [{cid, entry}]                                   (radar.mjs radarEntry)
 */
export async function honuIngest(db, body, now) {
  const writes = [];
  const pop = (Array.isArray(body.pop) ? body.pop : []).filter((p) => Number.isInteger(+p.world) && Number.isInteger(+p.zone))
    .map((p) => ({ world: +p.world, zone: +p.zone, ts: now, vs: +p.vs || 0, nc: +p.nc || 0, tr: +p.tr || 0, ns: +p.ns || 0 }));
  if (pop.length) writes.push(bulkInsert(db, "pop", ["world", "zone", "ts", "vs", "nc", "tr", "ns"], pop));
  let reports = 0;
  for (const r of (Array.isArray(body.reports) ? body.reports : []).slice(0, 20)) {
    if (!r || typeof r.key !== "string") continue;
    const rep = r.status === "ok" && r.report && typeof r.report === "object" ? r.report : null;
    const status = rep ? "ok" : r.status === "error" ? "error" : "pending";
    writes.push(db.prepare(
      `INSERT INTO report (key, status, attempts, ts, players, flagged, confirmed, faction, outliers, err) VALUES (?,?,1,?,?,?,?,?,?,?)
       ON CONFLICT(key) DO UPDATE SET status=excluded.status, attempts=report.attempts+1, ts=excluded.ts, players=excluded.players,
         flagged=excluded.flagged, confirmed=excluded.confirmed, faction=excluded.faction, outliers=excluded.outliers, err=excluded.err`)
      .bind(r.key, status, now, rep ? +rep.players || 0 : null, rep ? +rep.flagged || 0 : null, rep ? +rep.confirmed || 0 : null,
        rep ? JSON.stringify(rep.faction || null) : null, rep ? JSON.stringify((rep.outliers || []).slice(0, 20)) : null,
        rep ? null : String(r.err || "").slice(0, 300)));
    reports++;
  }
  let radar = 0;
  for (const x of (Array.isArray(body.radar) ? body.radar : []).slice(0, 50)) {
    if (!x || !/^\d{5,25}$/.test(String(x.cid)) || !x.entry) continue;
    writes.push(db.prepare("INSERT INTO radar (cid, ts, entry) VALUES (?,?,?) ON CONFLICT(cid) DO UPDATE SET ts=excluded.ts, entry=excluded.entry")
      .bind(String(x.cid), now, JSON.stringify(x.entry)));
    radar++;
  }
  if (writes.length) await db.batch(writes);
  await setMeta(db, "last_honu", { ts: now, pop: pop.length, reports, radar, errors: Array.isArray(body.errors) ? body.errors.slice(0, 10) : [] });
  return { ok: true, pop: pop.length, reports, radar };
}

// ---------------------------------------------------------------- API

const parseRow = (r) => ({
  key: r.key, world: r.world, world_name: WORLD_NAMES[r.world] || String(r.world),
  zone: r.zone, zone_name: ZONE_NAMES[r.zone] || String(r.zone),
  instance_id: r.instance_id, event_id: r.event_id, kind: alertKind(r.event_id), start_ts: r.start_ts, dur: r.dur,
  status: r.status, end_ts: r.end_ts, checks: r.checks, winner: r.winner, basis: r.basis,
  final: r.final ? JSON.parse(r.final) : null,
  flags: r.flags ? JSON.parse(r.flags).filter((f) => f !== "checked") : [],
  state: r.state ? JSON.parse(r.state) : null,
  commander: r.commander ? JSON.parse(r.commander) : null, commander_ts: r.commander_ts || null,
  report: r.r_status ? { status: r.r_status, players: r.r_players, flagged: r.r_flagged, confirmed: r.r_confirmed,
    faction: r.r_faction ? JSON.parse(r.r_faction) : null } : null,
});
const REPORT_COLS = "r.status AS r_status, r.players AS r_players, r.flagged AS r_flagged, r.confirmed AS r_confirmed, r.faction AS r_faction";

function authed(request, env) {
  const key = typeof env.ORACLE_KEY === "string" ? env.ORACLE_KEY : "";
  return !!key && request.headers.get("X-Oracle-Key") === key;
}

async function handle(request, env) {
  const url = new URL(request.url);
  const db = env.DB;
  const now = Math.floor(Date.now() / 1000);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Oracle-Key",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Max-Age": "86400" } });
  }
  if (url.pathname.startsWith("/auth/")) return handleAuth(request, env, url, json, now);
  if (url.pathname.startsWith("/vote/")) return handleVote(request, env, url, json, now);
  if (url.pathname.startsWith("/privacy/")) return handlePrivacy(request, env, url, json, now, authed);

  if (url.pathname === "/" || url.pathname === "/health") {
    const last = await getMeta(db, "last_cycle");
    const lastOk = await getMeta(db, "last_ok");
    const ageS = last ? now - last.ts : null;
    const lastCmd = await getMeta(db, "last_commander");
    const lastHonu = await getMeta(db, "last_honu");
    return json({ ok: ageS !== null && ageS < 180, service: "ps2-oracle", now, last_cycle_age_s: ageS, last_ok_age_s: lastOk ? now - lastOk : null, last_cycle: last, last_commander: lastCmd, last_honu: lastHonu }, 200, { "Cache-Control": "no-store" });
  }

  // Manual kick + diagnostics: runs one cycle now unless one ran in the last
  // 50 s (same pace as the cron, so it cannot add Census load).
  if (url.pathname === "/cycle") {
    const last = await getMeta(db, "last_cycle");
    if (last && now - last.ts < 50) return json({ skipped: "recent cycle", age_s: now - last.ts, last_cycle: last }, 429, { "Cache-Control": "no-store" });
    const t = Date.now();
    try {
      const report = await runCycle(env, Date.now());
      const commander = await fanOutCommander(env, report.live_keys);
      return json({ ran: true, wall_ms: Date.now() - t, report, commander }, 200, { "Cache-Control": "no-store" });
    } catch (e) {
      return json({ ran: false, error: String(e && e.stack || e) }, 500, { "Cache-Control": "no-store" });
    }
  }

  if (url.pathname === "/crash") {
    return json({ last_crash: await getMeta(db, "last_crash"), cron_seen: await getMeta(db, "cron_seen") }, 200, { "Cache-Control": "no-store" });
  }

  if (url.pathname === "/live") {
    const rows = (await db.prepare(`SELECT a.*, ${REPORT_COLS} FROM alert a LEFT JOIN report r ON r.key = a.key WHERE a.status IN ('live','settling','sudden_death') OR (a.end_ts IS NOT NULL AND a.end_ts > ?) ORDER BY a.start_ts DESC`).bind(now - 3 * 3600).all()).results || [];
    return json({ now, worlds: WORLD_NAMES, alerts: rows.map(parseRow) });
  }

  if (url.pathname === "/alert/frames") {
    // Map replay for the "Win chance over time" scrub: base owners minute by minute
    // (stored map snapshots, kept 30 days). First frame is complete, later frames
    // carry only the bases that changed ({fid: "VS"|"NC"|"TR"|null}).
    const key = url.searchParams.get("key") || "";
    const a = await db.prepare("SELECT world, zone, start_ts, dur, status, end_ts FROM alert WHERE key=?").bind(key).first();
    if (!a) return json({ error: "not_found" }, 404);
    const frames = await alertFrames(db, a);
    const final = a.status !== "live" && a.status !== "settling" && a.status !== "sudden_death";
    return json({ key, start_ts: a.start_ts, dur: a.dur, frames }, 200, { "Cache-Control": final ? "public, max-age=86400" : "no-store" });
  }

  if (url.pathname === "/alert") {
    const key = url.searchParams.get("key") || "";
    const r = await db.prepare(`SELECT a.*, ${REPORT_COLS} FROM alert a LEFT JOIN report r ON r.key = a.key WHERE a.key=?`).bind(key).first();
    if (!r) return json({ error: "not_found" }, 404);
    const rep = await db.prepare("SELECT outliers FROM report WHERE key=? AND status='ok'").bind(key).first();
    const ticks = ((await db.prepare("SELECT ts, t, terr, win FROM tick WHERE key=? ORDER BY ts").bind(key).all()).results || [])
      .map((x) => ({ ts: x.ts, t: x.t, terr: JSON.parse(x.terr), win: JSON.parse(x.win) }));
    const bench = await db.prepare("SELECT * FROM bench WHERE key=?").bind(key).first();
    return json({ alert: parseRow(r), ticks, bench: bench ? { slices: JSON.parse(bench.slices), brier: bench.brier ? JSON.parse(bench.brier) : null } : null,
      outliers: rep && rep.outliers ? JSON.parse(rep.outliers) : null });
  }

  if (url.pathname === "/history") {
    const days = Math.min(30, Math.max(1, +url.searchParams.get("days") || 7));
    const rows = (await db.prepare(`SELECT a.key, a.world, a.zone, a.instance_id, a.event_id, a.start_ts, a.dur, a.status, a.end_ts, a.checks, a.winner, a.basis, a.final, a.flags, NULL AS state, NULL AS commander, ${REPORT_COLS} FROM alert a LEFT JOIN report r ON r.key = a.key WHERE a.start_ts > ? AND a.status IN ('settled','canceled','unresolved') ORDER BY a.start_ts DESC`).bind(now - days * 86400).all()).results || [];
    const bench = (await db.prepare("SELECT key, dur, slices, winner, brier FROM bench WHERE settled_ts IS NOT NULL AND brier IS NOT NULL").all()).results || [];
    const agg = {};
    for (const b of bench) {
      const br = JSON.parse(b.brier);
      for (const [k, v] of Object.entries(br)) {
        const g = (agg[`${b.dur}`] ||= {});
        const s = (g[k] ||= { n: 0, sum: 0 });
        s.n++; s.sum += v;
      }
    }
    const summary = {};
    for (const [dur, g] of Object.entries(agg)) summary[dur] = Object.fromEntries(Object.entries(g).map(([k, s]) => [k, { n: s.n, brier: Math.round((s.sum / s.n) * 10000) / 10000 }]));
    return json({ now, alerts: rows.map(parseRow), benchmark: summary, uniform: 0.2222 });
  }

  if (url.pathname === "/export") {
    if (!authed(request, env)) return json({ error: "forbidden" }, 403);
    const world = +url.searchParams.get("world");
    const zone = +url.searchParams.get("zone");
    const since = +url.searchParams.get("since") || now - 3 * 3600;
    const snaps = ((await db.prepare("SELECT ts, zones FROM snap WHERE world=? AND ts>=? ORDER BY ts").bind(world, since - 1800).all()).results || [])
      .map((r) => ({ ts: r.ts, facilities: JSON.parse(r.zones)[String(zone)] || null })).filter((r) => r.facilities);
    const metagame = (await db.prepare("SELECT * FROM metagame WHERE world=? AND ts>=? ORDER BY ts").bind(world, since - 6 * 3600).all()).results || [];
    const flips = (await db.prepare("SELECT * FROM flip WHERE world=? AND zone=? AND ts>=? ORDER BY ts").bind(world, zone, since - 1800).all()).results || [];
    return json({ world, zone, snaps, metagame, flips }, 200, { "Cache-Control": "no-store" });
  }

  if (url.pathname === "/internal/archive" && request.method === "POST") {
    if (!authed(request, env)) return json({ error: "forbidden" }, 403);
    const body = await request.json().catch(() => null);
    if (!body || typeof body.key !== "string") return json({ error: "bad_request" }, 400);
    return json(await archiveAlert(env, body.key), 200, { "Cache-Control": "no-store" });
  }

  // ---- Archive (second D1 database): finished alerts kept for good ----
  if (url.pathname === "/archive" && env.ARCHIVE) {
    const r = await env.ARCHIVE.prepare("SELECT data FROM alert_archive WHERE key=?").bind(url.searchParams.get("key") || "").first();
    if (!r) return json({ error: "not_found" }, 404);
    return new Response(r.data, { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=86400" } });
  }
  if (url.pathname === "/archive/list" && env.ARCHIVE) {
    const before = +url.searchParams.get("before") || 4e9;
    const limit = Math.min(500, Math.max(1, +url.searchParams.get("limit") || 200));
    const src = url.searchParams.get("source");
    const rows = (await env.ARCHIVE.prepare(`SELECT key, source, world, zone, instance_id, event_id, start_ts, dur, winner, basis, bytes FROM alert_archive
      WHERE start_ts < ? ${src ? "AND source = ?" : ""} ORDER BY start_ts DESC LIMIT ?`).bind(...(src ? [before, src, limit] : [before, limit])).all()).results || [];
    // Totals read every row of the archive (D1 row reads are the free plan's scarce budget): first page only.
    const tot = url.searchParams.has("before") ? null
      : await env.ARCHIVE.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(bytes),0) AS bytes FROM alert_archive").first();
    return json({ total: tot ? tot.n : null, total_bytes: tot ? tot.bytes : null, alerts: rows }, 200, { "Cache-Control": "public, max-age=60" });
  }
  if (url.pathname === "/archive/ingest" && request.method === "POST" && env.ARCHIVE) {
    // Backfill (e.g. PS2Alerts history) from a GitHub Actions job; never overwrites the Worker's own bundles.
    if (!authed(request, env)) return json({ error: "forbidden" }, 403);
    const body = await request.json().catch(() => null);
    const list = Array.isArray(body && body.bundles) ? body.bundles.slice(0, 20) : [];
    const res = [];
    for (const b of list) {
      if (!validBundle(b)) { res.push({ key: b && b.key, error: "invalid" }); continue; }
      const own = await env.ARCHIVE.prepare("SELECT source FROM alert_archive WHERE key=?").bind(b.key).first();
      if (own && own.source === "worker") { res.push({ key: b.key, skipped: "worker bundle exists" }); continue; }
      res.push({ key: b.key, ok: true, bytes: await putBundle(env.ARCHIVE, b, now) });
    }
    return json({ results: res }, 200, { "Cache-Control": "no-store" });
  }

  if (url.pathname === "/internal/commander" && request.method === "POST") {
    if (!authed(request, env)) return json({ error: "forbidden" }, 403);
    const body = await request.json().catch(() => null);
    if (!body || typeof body.key !== "string") return json({ error: "bad_request" }, 400);
    return json(await commanderFor(env, body.key), 200, { "Cache-Control": "no-store" });
  }

  // ---- Honu bridge (Honu's API answers GitHub Actions, not Cloudflare's network) ----
  if (url.pathname === "/honu/pending") {
    const q = await honuQueue(db, now);
    return json({ pending: q.pop.length + q.reports.length > 0, pop: q.pop.length, reports: q.reports.length }, 200, { "Cache-Control": "no-store" });
  }
  if (url.pathname === "/honu/queue") {
    if (!authed(request, env)) return json({ error: "forbidden" }, 403);
    const q = await honuQueue(db, now);
    return json({ now, ...q }, 200, { "Cache-Control": "no-store" });
  }
  if (url.pathname === "/honu/radar") {
    if (!authed(request, env)) return json({ error: "forbidden" }, 403);
    const cids = (url.searchParams.get("cids") || "").split(",").filter((c) => /^\d{5,25}$/.test(c)).slice(0, 50);
    const out = {};
    for (const cid of cids) {
      const r = await db.prepare("SELECT ts, entry FROM radar WHERE cid=? AND ts>?").bind(cid, now - RADAR_RECHECK_S).first();
      if (r) out[cid] = JSON.parse(r.entry);
    }
    const dayStart = now - (now % 86400);
    const looked = await db.prepare("SELECT COUNT(*) AS n FROM radar WHERE ts>=?").bind(dayStart).first();
    return json({ radar: out, looked_today: (looked && looked.n) || 0 }, 200, { "Cache-Control": "no-store" });
  }
  if (url.pathname === "/honu/ingest" && request.method === "POST") {
    if (!authed(request, env)) return json({ error: "forbidden" }, 403);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return json({ error: "bad_request" }, 400);
    return json(await honuIngest(db, body, now), 200, { "Cache-Control": "no-store" });
  }

  if (url.pathname === "/commander" && request.method === "POST") {
    if (!authed(request, env)) return json({ error: "forbidden" }, 403);
    const body = await request.json().catch(() => null);
    if (!body || typeof body.key !== "string" || !body.commander || typeof body.commander !== "object") return json({ error: "bad_request" }, 400);
    const s = JSON.stringify(body.commander);
    if (s.length > 200000) return json({ error: "too_large" }, 413);
    const r = await db.prepare("UPDATE alert SET commander=?, commander_ts=? WHERE key=? AND status='live'").bind(s, now, body.key).run();
    return json({ ok: true, updated: r.meta.changes }, 200, { "Cache-Control": "no-store" });
  }

  return json({ error: "not_found" }, 404);
}

export default {
  async scheduled(event, env, ctx) {
    // Breadcrumb before any work: tells a cron that never fires apart from one that dies mid-run.
    try { await setMeta(env.DB, "cron_seen", { ts: Math.floor(Date.now() / 1000), cron: event.cron }); } catch {}
    ctx.waitUntil(runCycle(env, event.scheduledTime || Date.now()).then(async (rep) => {
      const res = await fanOutCommander(env, rep.live_keys);
      if (res.length) await setMeta(env.DB, "last_commander", { ts: Math.floor(Date.now() / 1000), results: res });
      // Archive one finished alert per minute (own invocation; catches up on its own).
      if (env.ARCHIVE) {
        // Recent alerts only (index range); once a day at 04:07 UTC, everything, to catch stragglers.
        const t = new Date(event.scheduledTime || Date.now());
        const all = t.getUTCHours() === 4 && t.getUTCMinutes() === 7;
        const k = await nextToArchive(env.DB, all ? 0 : Math.floor(t.getTime() / 1000) - 2 * 86400);
        if (k) await setMeta(env.DB, "last_archive", { ts: Math.floor(Date.now() / 1000), result: (await fanOutArchive(env, [k]))[0] });
      }
    }).catch(async (e) => {
      try { await setMeta(env.DB, "last_crash", { ts: Math.floor(Date.now() / 1000), error: String(e && e.stack || e) }); } catch {}
    }));
  },
  async fetch(request, env) {
    try { return await handle(request, env); }
    catch (e) { return json({ error: "internal", detail: String(e && e.message || e) }, 500); }
  },
};
