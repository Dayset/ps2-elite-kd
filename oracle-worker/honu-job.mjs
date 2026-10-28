#!/usr/bin/env node
/**
 * oracle-honu job (GitHub Actions, .github/workflows/oracle-honu.yml).
 *
 * Honu's JSON API answers GitHub Actions but challenges Cloudflare's network,
 * so the ps2-oracle Worker hands its Honu work to this job:
 *   1. GET  {ORACLE_API}/honu/queue   live zones needing population,
 *                                      settled alerts needing an outlier report
 *   2. Honu GET /api/population/{world}/zones          (one call per live world)
 *      Honu GET /api/alerts/{world}/{instance}/participants  (per report)
 *      Honu GET /api/character/{cid}/sessions for burst-tier outliers (#81: the build-log
 *        links the burst session itself, outlier.session = Honu session id)
 *      PS2 Radar GET /api/v1/players/{id} for flagged players (radar.mjs rules)
 *   3. POST {ORACLE_API}/honu/ingest  results
 *
 * Polite by construction: Honu calls ≥ 1 s apart, Radar ≥ 2.5 s apart, at most
 * 5 Radar lookups per run, cached answers (3 days) reused via /honu/radar.
 * Env: ORACLE_API, ORACLE_KEY. Exit code 0 unless the Worker itself is unreachable.
 */
import { outlierReport } from "./src/outliers.js";
import { radarEntry, radarApiUrl } from "../radar.mjs";

export const HONU = "https://wt.honu.pw/api";
export const UA = "ps2-elite-kd-oracle/1.0 (+https://github.com/Dayset/ps2-elite-kd; contact: github.com/Dayset)";
const HONU_GAP_MS = 1000, RADAR_GAP_MS = 2500, RADAR_MAX = 5;
// The oracle's own identity and budget at PS2 Radar, separate from the main
// site's build-log lookups (radar.mjs RADAR_USER_AGENT, 50/day).
export const RADAR_DAILY_CAP = 25;
export const ORACLE_RADAR_UA = "ps2-elite-kd-oracle/1.0 (+https://dayset.github.io/ps2-elite-kd/oracle/; github.com/dayset/ps2-elite-kd; second-opinion lookups for statistically flagged alert players, max 25/day)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Honu population/{world}/zones -> [{zone, vs, nc, tr, ns}] (zoneID & 0xFFFF strips instance bits). */
export function parseZones(list) {
  return (Array.isArray(list) ? list : []).map((z) => ({
    zone: Number(z.zoneID ?? z.zoneId) & 0xffff, vs: +z.vs || 0, nc: +z.nc || 0, tr: +z.tr || 0, ns: +z.ns || 0,
  })).filter((z) => z.zone);
}

async function getJson(fetchImpl, url, headers) {
  const r = await fetchImpl(url, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(30000) });
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* challenge page or error page */ }
  return { status: r.status, body, isJson: body !== null };
}

/**
 * Honu's alert id for one of our alerts: alerts/time/block around its start, matched on
 * instance, continent (zoneID & 0xFFFF) and start time (±15 min). null when the lookup
 * itself fails (the caller falls back to the {world}/{instance} route); {err} when Honu
 * answered but has no matching alert (pending, retried later).
 */
export async function honuAlertId(honu, a) {
  if (!a.start_ts) return null;
  const iso = (t) => new Date(t * 1000).toISOString();
  const r = await honu(`alerts/time/block?start=${encodeURIComponent(iso(a.start_ts - 3600))}&end=${encodeURIComponent(iso(a.start_ts + 3600))}&worldID=${a.world}`);
  if (r.status !== 200 || !r.isJson) return null;
  const list = Array.isArray(r.body) ? r.body : (r.body && r.body.alerts) || [];
  const hit = list.find((x) => +x.instanceID === +a.instance_id && ((+x.zoneID) & 0xFFFF) === +a.zone
    && Math.abs(Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(String(x.timestamp)) ? x.timestamp : `${x.timestamp}Z`) / 1000 - a.start_ts) <= 900);
  return hit ? hit.id : { err: `honu has no alert ${a.world}-${a.zone}-${a.instance_id}` };
}

const honuTs = (t) => (t ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(String(t)) ? t : `${t}Z`) / 1000 : NaN);
/** Burst outliers per run that get a sessions lookup (one Honu call each). */
export const SESSION_LOOKUPS_MAX = 10;

/**
 * The Honu session (character/{cid}/sessions) that holds the alert: overlapping the alert
 * window [from, to] (unix s, 2 min slack); several → most kills, then most overlap. null if none.
 */
export function pickSession(list, from, to, now = Date.now() / 1000) {
  let best = null;
  for (const x of Array.isArray(list) ? list : []) {
    const a = honuTs(x && x.start), b = x && x.end ? honuTs(x.end) : now;
    if (!(a <= to + 120) || !(b >= from - 120)) continue;
    const overlap = Math.min(b, to) - Math.max(a, from);
    const kills = +x.kills || 0;
    if (!best || kills > best.kills || (kills === best.kills && overlap > best.overlap)) best = { id: x.id, kills, overlap };
  }
  return best ? String(best.id) : null;
}

export async function runHonuJob({ api, key, fetchImpl = fetch, log = console.log, gapMs = { honu: HONU_GAP_MS, radar: RADAR_GAP_MS } } = {}) {
  const auth = { "X-Oracle-Key": key, "User-Agent": UA };
  const q = await getJson(fetchImpl, `${api}/honu/queue`, auth);
  if (q.status !== 200 || !q.isJson) throw new Error(`oracle queue ${q.status}`);
  const { pop = [], reports = [] } = q.body;
  log(`queue: ${pop.length} live zone(s), ${reports.length} report(s)`);
  const out = { pop: [], reports: [], radar: [], errors: [] };
  let lastHonu = 0;
  const honu = async (path) => {
    const wait = lastHonu + gapMs.honu - Date.now();
    if (wait > 0) await sleep(wait);
    lastHonu = Date.now();
    return getJson(fetchImpl, `${HONU}/${path}`, { "User-Agent": UA });
  };

  // 1) Population for each world with a live alert.
  const wanted = new Map();
  for (const a of pop) (wanted.get(a.world) || wanted.set(a.world, new Set()).get(a.world)).add(+a.zone);
  for (const [world, zones] of wanted) {
    const r = await honu(`population/${world}/zones`);
    if (r.status !== 200 || !r.isJson) { out.errors.push(`population w${world}: ${r.status}${r.isJson ? "" : " non-JSON"}`); continue; }
    for (const z of parseZones(r.body)) if (zones.has(z.zone)) out.pop.push({ world, ...z });
  }

  // 2) Outlier reports for settled alerts.
  const flagged = [];
  let sessionLookups = 0;
  for (const a of reports) {
    // Census instance ids repeat across continents on one world (Wainwright 46374 was both
    // an Indar and an Amerish alert on 2026-10-23), and Honu's {world}/{instance} route returns
    // the first match. So find Honu's own alert id by world + instance + continent + start time.
    const id = await honuAlertId(honu, a);
    if (id && id.err) { out.reports.push({ key: a.key, status: "pending", err: id.err }); continue; }
    const r = await honu(id ? `alerts/${id}/participants?excludeOutfits=true` : `alerts/${a.world}/${a.instance_id}/participants?excludeOutfits=true`);
    if (r.status === 400 || r.status === 404) { out.reports.push({ key: a.key, status: "pending", err: `honu ${r.status}` }); continue; }
    if (r.status !== 200 || !r.isJson) { out.reports.push({ key: a.key, status: "pending", err: `honu ${r.status}${r.isJson ? "" : " non-JSON"}` }); continue; }
    const rep = outlierReport(r.body);
    if (!rep.players) { out.reports.push({ key: a.key, status: "pending", err: "no participants yet" }); continue; }
    out.reports.push({ key: a.key, status: "ok", report: rep });
    flagged.push(...rep.outliers);
    // #81: the burst session itself, so a reviewer lands on it (not just the profile).
    const from = +a.start_ts, to = +a.end_ts || from + (+a.dur || 90) * 60;
    for (const o of rep.outliers) {
      if (o.severity !== "burst" || !from || sessionLookups >= SESSION_LOOKUPS_MAX) continue;
      sessionLookups++;
      const s = await honu(`character/${o.cid}/sessions`);
      if (s.status !== 200 || !s.isJson) { out.errors.push(`sessions ${o.cid}: ${s.status}`); continue; }
      const id = pickSession(s.body, from, to);
      if (id) o.session = id;
    }
  }

  // 3) PS2 Radar second opinion for flagged players (cached answers first).
  if (flagged.length) {
    const cids = [...new Set(flagged.map((o) => o.cid))].filter((c) => radarApiUrl({ cid: c }));
    const cached = cids.length ? await getJson(fetchImpl, `${api}/honu/radar?cids=${cids.join(",")}`, auth) : { body: { radar: {} } };
    const known = (cached.body && cached.body.radar) || {};
    const budget = Math.max(0, Math.min(RADAR_MAX, RADAR_DAILY_CAP - ((cached.body && +cached.body.looked_today) || 0)));
    let looked = 0;
    for (const cid of cids) {
      if (known[cid]) continue;
      if (looked >= budget) break;
      if (looked) await sleep(gapMs.radar);
      looked++;
      const r = await getJson(fetchImpl, radarApiUrl({ cid }), { "User-Agent": ORACLE_RADAR_UA });
      if (r.status !== 200 && r.status !== 404) { out.errors.push(`radar ${r.status}`); out.radar_refused = r.status; break; }
      const o = flagged.find((f) => f.cid === cid);
      known[cid] = radarEntry(r.status === 404 ? null : r.body, { status: r.status, name: (o && o.name) || "", cid });
      out.radar.push({ cid, entry: known[cid] });
    }
    for (const rep of out.reports) if (rep.report) for (const o of rep.report.outliers) if (known[o.cid]) o.radar = known[o.cid];
  }

  const res = await fetchImpl(`${api}/honu/ingest`, {
    method: "POST", headers: { "Content-Type": "application/json", ...auth }, body: JSON.stringify(out), signal: AbortSignal.timeout(30000),
  });
  const ack = await res.json().catch(() => ({}));
  log(`ingest ${res.status}: ${JSON.stringify(ack)}${out.errors.length ? " errors: " + out.errors.join("; ") : ""}`);
  return { out, ack };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const api = (process.env.ORACLE_API || "https://ps2-oracle.dayset.workers.dev").replace(/\/$/, "");
  const key = process.env.ORACLE_KEY || "";
  if (!key) { console.log("::warning::ORACLE_KEY not set; nothing to do"); process.exit(0); }
  runHonuJob({ api, key }).then(({ out }) => {
    for (const e of out.errors) console.log(`::warning::${e}`);
  }).catch((e) => { console.log(`::error::${e.message}`); process.exit(1); });
}
