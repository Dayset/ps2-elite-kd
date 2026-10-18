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
 *      PS2 Radar GET /api/v1/players/{id} for flagged players (radar.mjs rules)
 *   3. POST {ORACLE_API}/honu/ingest  results
 *
 * Polite by construction: Honu calls ≥ 1 s apart, Radar ≥ 2.5 s apart, at most
 * 5 Radar lookups per run, cached answers (3 days) reused via /honu/radar.
 * Env: ORACLE_API, ORACLE_KEY. Exit code 0 unless the Worker itself is unreachable.
 */
import { outlierReport } from "./src/outliers.js";
import { radarEntry, radarApiUrl, RADAR_USER_AGENT } from "../radar.mjs";

export const HONU = "https://wt.honu.pw/api";
export const UA = "ps2-elite-kd-oracle/1.0 (+https://github.com/Dayset/ps2-elite-kd; contact: github.com/Dayset)";
const HONU_GAP_MS = 1000, RADAR_GAP_MS = 2500, RADAR_MAX = 5;
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
  for (const a of reports) {
    const r = await honu(`alerts/${a.world}/${a.instance_id}/participants?excludeOutfits=true`);
    if (r.status === 400 || r.status === 404) { out.reports.push({ key: a.key, status: "pending", err: `honu ${r.status}` }); continue; }
    if (r.status !== 200 || !r.isJson) { out.reports.push({ key: a.key, status: "pending", err: `honu ${r.status}${r.isJson ? "" : " non-JSON"}` }); continue; }
    const rep = outlierReport(r.body);
    if (!rep.players) { out.reports.push({ key: a.key, status: "pending", err: "no participants yet" }); continue; }
    out.reports.push({ key: a.key, status: "ok", report: rep });
    flagged.push(...rep.outliers);
  }

  // 3) PS2 Radar second opinion for flagged players (cached answers first).
  if (flagged.length) {
    const cids = [...new Set(flagged.map((o) => o.cid))].filter((c) => radarApiUrl({ cid: c }));
    const cached = cids.length ? await getJson(fetchImpl, `${api}/honu/radar?cids=${cids.join(",")}`, auth) : { body: { radar: {} } };
    const known = (cached.body && cached.body.radar) || {};
    let looked = 0;
    for (const cid of cids) {
      if (known[cid]) continue;
      if (looked >= RADAR_MAX) break;
      if (looked) await sleep(gapMs.radar);
      looked++;
      const r = await getJson(fetchImpl, radarApiUrl({ cid }), { "User-Agent": RADAR_USER_AGENT });
      if (r.status !== 200 && r.status !== 404) { out.errors.push(`radar ${r.status}`); break; }
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
