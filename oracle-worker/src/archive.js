/**
 * Alert archive: one self-contained JSON bundle per finished alert, kept for good
 * in a second D1 database (binding ARCHIVE, `ps2-oracle-archive`; table in
 * archive-schema.sql). The main database keeps raw map snapshots for 30 days only;
 * the archive keeps the per-minute map frames, win-chance ticks, captures,
 * benchmark slices and the result, so old alerts can be re-scored later
 * (cut-aware odds, new models) and replayed on the dashboard.
 *
 * Bundle v1:
 *   { v, key, source: "worker" | "ps2alerts", world, zone, instance_id, event_id,
 *     start_ts, end_ts, dur, status, winner, basis, final, flags,
 *     frames: [{ t, set: {fid: "VS"|"NC"|"TR"|null} }],   // first frame complete, then changes
 *     ticks:  [{ t, terr, win }],                           // minute-by-minute engine output
 *     flips:  [[ts, fid, old, new]],                        // FacilityControl captures
 *     bench:  { slices, brier } | null,
 *     fights?: [{ t, pop: [vs,nc,tr,nso] | null, b: [[fid, vs, nc, tr, kills, convFac, convAgo, spawns?, ivi?]] }] }  // fights.js fightRow, paid plan
 * ~10-25 KB per alert; a 500 MB D1 database holds tens of thousands.
 */
import { regionMap } from "./models.js";

const FAC_NAME = { 1: "VS", 2: "NC", 3: "TR" };
const FINAL = ["settled", "canceled", "unresolved"];

/** Per-minute base owners for an alert from stored snapshots (first frame full, then changes). */
export async function alertFrames(db, a) {
  const r2f = regionMap(a.zone);
  const until = (a.end_ts || a.start_ts + a.dur * 60) + 60;
  const rows = (await db.prepare("SELECT ts, json_extract(zones, '$.' || ?) AS z FROM snap WHERE world=? AND ts BETWEEN ? AND ? ORDER BY ts")
    .bind(String(a.zone), a.world, a.start_ts - 60, until).all()).results || [];
  const frames = [];
  let prev = {};
  for (const row of rows) {
    if (!row.z) continue;
    const cur = {};
    for (const [region, fac] of Object.entries(JSON.parse(row.z))) {
      const fid = r2f ? r2f[String(region)] : region;
      if (fid) cur[fid] = FAC_NAME[fac] || null;
    }
    const set = {};
    for (const [fid, o] of Object.entries(cur)) if (prev[fid] !== o || !frames.length) set[fid] = o;
    for (const fid of Object.keys(prev)) if (!(fid in cur)) set[fid] = null;
    if (!frames.length || Object.keys(set).length) frames.push({ t: Math.round(((row.ts - a.start_ts) / 60) * 10) / 10, set });
    prev = cur;
  }
  return frames;
}

/** Bundle for one alert from the main database, or null if it is not finished. */
export async function buildBundle(db, key) {
  const a = await db.prepare("SELECT * FROM alert WHERE key=?").bind(key).first();
  if (!a || !FINAL.includes(a.status)) return null;
  const end = a.end_ts || a.start_ts + a.dur * 60;
  const [frames, ticks, flips, bench, fights] = await Promise.all([
    alertFrames(db, a),
    db.prepare("SELECT t, terr, win FROM tick WHERE key=? ORDER BY ts").bind(key).all(),
    db.prepare("SELECT ts, facility, old, new FROM flip WHERE world=? AND zone=? AND ts BETWEEN ? AND ? ORDER BY ts").bind(a.world, a.zone, a.start_ts - 600, end + 60).all(),
    db.prepare("SELECT slices, brier FROM bench WHERE key=?").bind(key).first(),
    // ⚔️ fights.js (#78): absent before the paid plan, and the table may not exist yet.
    (async () => db.prepare("SELECT t, data FROM fight WHERE key=? ORDER BY ts").bind(key).all())().catch(() => null),
  ]);
  const j = (s) => (s ? JSON.parse(s) : null);
  return {
    v: 1, key, source: "worker", world: a.world, zone: a.zone, instance_id: a.instance_id, event_id: a.event_id,
    start_ts: a.start_ts, end_ts: a.end_ts, dur: a.dur, status: a.status, winner: a.winner, basis: a.basis,
    final: j(a.final), flags: j(a.flags), frames,
    ticks: ((ticks && ticks.results) || []).map((x) => ({ t: x.t, terr: j(x.terr), win: j(x.win) })),
    flips: ((flips && flips.results) || []).map((x) => [x.ts, x.facility, x.old, x.new]),
    bench: bench ? { slices: j(bench.slices), brier: j(bench.brier) } : null,
    ...(fights && fights.results && fights.results.length ? { fights: fights.results.map((x) => ({ t: x.t, ...j(x.data) })) } : {}),
  };
}

/** Insert or replace one bundle in the archive database. */
export async function putBundle(archive, b, now) {
  const data = JSON.stringify(b);
  await archive.prepare(`INSERT INTO alert_archive (key, source, world, zone, instance_id, event_id, start_ts, dur, winner, basis, archived_ts, bytes, data)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET source=excluded.source, event_id=excluded.event_id, dur=excluded.dur,
    winner=excluded.winner, basis=excluded.basis, archived_ts=excluded.archived_ts, bytes=excluded.bytes, data=excluded.data`)
    .bind(b.key, b.source, b.world, b.zone, b.instance_id, b.event_id ?? null, b.start_ts, b.dur ?? null, b.winner ?? null, b.basis ?? null, now, data.length, data).run();
  return data.length;
}

/** Archive one finished alert from the main database (runs in its own invocation). */
export async function archiveAlert(env, key, nowMs = Date.now()) {
  if (!env.ARCHIVE) return { key, skipped: "no archive binding" };
  const now = Math.floor(nowMs / 1000);
  const b = await buildBundle(env.DB, key);
  if (!b) return { key, skipped: "not finished" };
  const bytes = await putBundle(env.ARCHIVE, b, now);
  await env.DB.prepare("UPDATE alert SET archived_ts=? WHERE key=?").bind(now, key).run();
  return { key, ok: true, bytes, frames: b.frames.length, ticks: b.ticks.length };
}

/**
 * Oldest finished alert not archived yet that started after `since` (one per cron
 * minute catches up quickly). `+status` keeps SQLite on the start_ts index: the
 * status index would read every finished alert ever, each minute (D1 row reads).
 */
export async function nextToArchive(db, since = 0) {
  const r = await db.prepare("SELECT key FROM alert WHERE start_ts > ? AND +status IN ('settled','canceled','unresolved') AND archived_ts IS NULL ORDER BY start_ts LIMIT 1").bind(since).first();
  return r ? r.key : null;
}

/** Minimal validation for bundles posted by the PS2Alerts backfill job. */
export function validBundle(b) {
  return b && b.v === 1 && typeof b.key === "string" && /^\d+-\d+-\d+$/.test(b.key) && typeof b.source === "string" && b.source !== "worker"
    && Number.isInteger(b.world) && Number.isInteger(b.zone) && Number.isInteger(b.instance_id) && Number.isInteger(b.start_ts)
    && Array.isArray(b.frames) && (b.winner == null || ["VS", "NC", "TR", "draw"].includes(b.winner));
}
