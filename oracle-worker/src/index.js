/**
 * ps2-oracle: PS2MapOracle collector + odds engine + settlement, on Cloudflare.
 *
 * Every minute (cron):
 *  1. Census REST: map ownership for each tracked world (one call per world,
 *     all five continents), plus world_event METAGAME and FACILITY rows.
 *  2. Store in D1 (snap / metagame / flip), idempotent INSERT OR IGNORE.
 *  3. Rebuild every territory alert from the METAGAME rows: live alerts get a
 *     fresh state (push_live contract) + a win-history tick + benchmark slices;
 *     ended alerts settle from Census's own final scores at +0/+5/+10 min,
 *     with sudden death (events 236-240) deciding draws.
 *
 * No LLM, no paste step: the state the UI reads is the state the engine wrote.
 * Read API (CORS *): /health /live /alert?key= /history
 * Key API (X-Oracle-Key): /export, POST /commander
 */
import {
  WORLDS, ZONES, WORLD_NAMES, ZONE_NAMES, TERRITORY_ALERTS, SUDDEN_DEATH, FACS,
  buildState, computeWin, territory, sliceMinutes, brier, scoreWinner,
} from "./engine.js";
import { binGetter, hasTree, regionMap } from "./models.js";

const CENSUS = "https://census.daybreakgames.com";
const UA = "ps2-oracle/1.0 (dayset.github.io/ps2-elite-kd/oracle)";
const FINAL = ["settled", "canceled", "unresolved"];
const WINDOW_S = 8 * 3600; // how far back alerts are rebuilt from METAGAME rows

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, X-Oracle-Key",
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
function bulkInsert(db, table, cols, rows) {
  const sel = cols.map((c) => `json_extract(value,'$.${c}')`).join(", ");
  return db.prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(", ")}) SELECT ${sel} FROM json_each(?)`)
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
  const sd = rows.filter((r) => SUDDEN_DEATH[r.event_id] === a.zone && r.world === a.world);
  const start = sd.find((r) => r.state === "started" && r.ts >= endTs - 120 && r.ts <= endTs + 600);
  if (!start) return null;
  const end = sd.find((r) => r.instance_id === start.instance_id && (r.state === "ended" || r.state === "canceled"));
  return { start, end: end || null };
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
    if (mgRows.length) stmts.push(bulkInsert(db, "metagame", ["world", "zone", "instance_id", "event_id", "state", "ts", "vs", "nc", "tr"], mgRows));
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
  const benchRows = new Map(((await db.prepare("SELECT key, slices FROM bench WHERE settled_ts IS NULL").all()).results || []).map((r) => [r.key, JSON.parse(r.slices)]));
  const out = [];
  const ticks = [], benchUp = [], benchSettle = [];
  const snap15 = {};
  let live = 0, settled = 0;

  for (const a of groupAlerts(all)) {
    const prev = known.get(a.key);
    if (prev && FINAL.includes(prev.status)) continue;
    const dur = TERRITORY_ALERTS[a.event_id];
    const startTs = a.start.ts;
    const base = { key: a.key, world: a.world, zone: a.zone, instance_id: a.instance_id, event_id: a.event_id, start_ts: startTs, dur };

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
      });
      out.push({ ...base, status: "live", state });
      live++;
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
          const terr = territory(zNow);
          const { win } = computeWin(binGetter(a.zone), terr, { VS: 0, NC: 0, TR: 0 }, Math.max(t, 0), dur);
          slices.t0 = { VS: win.VS.pct / 100, NC: win.NC.pct / 100, TR: win.TR.pct / 100, t: Math.round(t * 10) / 10 };
        } else if (t <= m + 5) {
          slices[label] = { VS: state.win.VS.pct / 100, NC: state.win.NC.pct / 100, TR: state.win.TR.pct / 100, t: Math.round(t * 10) / 10 };
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
    const checks = Math.min(3, 1 + Math.floor(Math.max(0, now - endTs) / 300));
    const flags = prev && prev.flags ? JSON.parse(prev.flags) : [];
    // Cross-check: our own last pre-end snapshot (never a post-end one).
    if (!flags.includes("checked")) {
      const pre = await latestSnap(db, a.world, endTs);
      const z = pre && pre.zones[String(a.zone)];
      if (z) {
        const terr = territory(z);
        const owned = terr.VS + terr.NC + terr.TR;
        if (owned < 90) flags.push(`neutral_heavy:${owned.toFixed(1)}`);
        const sw = scoreWinner(terr);
        if (sw !== scoreWinner(final)) flags.push(`snapshot_winner_${sw}`);
        if (endTs - pre.ts > 600) flags.push("snapshot_stale");
        flags.push("checked");
      }
    }
    const rec = { ...base, end_ts: endTs, final, checks, flags };
    if (checks < 3) { out.push({ ...rec, status: "settling" }); continue; }
    const sd = findSuddenDeath(all, a, endTs);
    let winner = null, basis = null;
    if (sd) {
      if (sd.end && sd.end.state === "ended") { winner = scoreWinner({ VS: sd.end.vs, NC: sd.end.nc, TR: sd.end.tr }); basis = "sudden_death"; }
      else if (sd.end) { winner = scoreWinner(final); basis = "census_final"; flags.push("sudden_death_canceled"); }
      else if (now > sd.start.ts + 45 * 60) { out.push({ ...rec, status: "unresolved" }); continue; }
      else { out.push({ ...rec, status: "sudden_death" }); continue; }
    } else {
      winner = scoreWinner(final);
      basis = "census_final";
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

  // 5) Daily pruning at 04:07 UTC: raw snapshots 30 days, flips 90 days.
  const d = new Date(nowMs);
  if (d.getUTCHours() === 4 && d.getUTCMinutes() === 7) {
    await db.batch([
      db.prepare("DELETE FROM snap WHERE ts < ?").bind(now - 30 * 86400),
      db.prepare("DELETE FROM flip WHERE ts < ?").bind(now - 90 * 86400),
    ]);
  }

  report.metagame = mgRows.length;
  report.live = live;
  report.settled = settled;
  report.ms = Date.now() - t0;
  await setMeta(db, "last_cycle", report);
  if (!report.errors.length) await setMeta(db, "last_ok", now);
  return report;
}

// ---------------------------------------------------------------- API

const parseRow = (r) => ({
  key: r.key, world: r.world, world_name: WORLD_NAMES[r.world] || String(r.world),
  zone: r.zone, zone_name: ZONE_NAMES[r.zone] || String(r.zone),
  instance_id: r.instance_id, event_id: r.event_id, start_ts: r.start_ts, dur: r.dur,
  status: r.status, end_ts: r.end_ts, checks: r.checks, winner: r.winner, basis: r.basis,
  final: r.final ? JSON.parse(r.final) : null,
  flags: r.flags ? JSON.parse(r.flags).filter((f) => f !== "checked") : [],
  state: r.state ? JSON.parse(r.state) : null,
  commander: r.commander ? JSON.parse(r.commander) : null, commander_ts: r.commander_ts || null,
});

function authed(request, env) {
  const key = typeof env.ORACLE_KEY === "string" ? env.ORACLE_KEY : "";
  return !!key && request.headers.get("X-Oracle-Key") === key;
}

async function handle(request, env) {
  const url = new URL(request.url);
  const db = env.DB;
  const now = Math.floor(Date.now() / 1000);
  if (request.method === "OPTIONS") return json(null, 204);

  if (url.pathname === "/" || url.pathname === "/health") {
    const last = await getMeta(db, "last_cycle");
    const lastOk = await getMeta(db, "last_ok");
    const ageS = last ? now - last.ts : null;
    return json({ ok: ageS !== null && ageS < 180, service: "ps2-oracle", now, last_cycle_age_s: ageS, last_ok_age_s: lastOk ? now - lastOk : null, last_cycle: last }, 200, { "Cache-Control": "no-store" });
  }

  // Manual kick + diagnostics: runs one cycle now unless one ran in the last
  // 50 s (same pace as the cron, so it cannot add Census load).
  if (url.pathname === "/cycle") {
    const last = await getMeta(db, "last_cycle");
    if (last && now - last.ts < 50) return json({ skipped: "recent cycle", age_s: now - last.ts, last_cycle: last }, 429, { "Cache-Control": "no-store" });
    const t = Date.now();
    try {
      const report = await runCycle(env, Date.now());
      return json({ ran: true, wall_ms: Date.now() - t, report }, 200, { "Cache-Control": "no-store" });
    } catch (e) {
      return json({ ran: false, error: String(e && e.stack || e) }, 500, { "Cache-Control": "no-store" });
    }
  }

  if (url.pathname === "/crash") {
    return json({ last_crash: await getMeta(db, "last_crash"), cron_seen: await getMeta(db, "cron_seen") }, 200, { "Cache-Control": "no-store" });
  }

  if (url.pathname === "/live") {
    const rows = (await db.prepare("SELECT * FROM alert WHERE status IN ('live','settling','sudden_death') OR (end_ts IS NOT NULL AND end_ts > ?) ORDER BY start_ts DESC").bind(now - 3 * 3600).all()).results || [];
    return json({ now, worlds: WORLD_NAMES, alerts: rows.map(parseRow) });
  }

  if (url.pathname === "/alert") {
    const key = url.searchParams.get("key") || "";
    const r = await db.prepare("SELECT * FROM alert WHERE key=?").bind(key).first();
    if (!r) return json({ error: "not_found" }, 404);
    const ticks = ((await db.prepare("SELECT ts, t, terr, win FROM tick WHERE key=? ORDER BY ts").bind(key).all()).results || [])
      .map((x) => ({ ts: x.ts, t: x.t, terr: JSON.parse(x.terr), win: JSON.parse(x.win) }));
    const bench = await db.prepare("SELECT * FROM bench WHERE key=?").bind(key).first();
    return json({ alert: parseRow(r), ticks, bench: bench ? { slices: JSON.parse(bench.slices), brier: bench.brier ? JSON.parse(bench.brier) : null } : null });
  }

  if (url.pathname === "/history") {
    const days = Math.min(30, Math.max(1, +url.searchParams.get("days") || 7));
    const rows = (await db.prepare("SELECT key, world, zone, instance_id, event_id, start_ts, dur, status, end_ts, checks, winner, basis, final, flags, NULL AS state, NULL AS commander FROM alert WHERE start_ts > ? AND status IN ('settled','canceled','unresolved') ORDER BY start_ts DESC").bind(now - days * 86400).all()).results || [];
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
    ctx.waitUntil(runCycle(env, event.scheduledTime || Date.now()).catch(async (e) => {
      try { await setMeta(env.DB, "last_crash", { ts: Math.floor(Date.now() / 1000), error: String(e && e.stack || e) }); } catch {}
    }));
  },
  async fetch(request, env) {
    try { return await handle(request, env); }
    catch (e) { return json({ error: "internal", detail: String(e && e.message || e) }, 500); }
  },
};
