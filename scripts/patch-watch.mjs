#!/usr/bin/env node
// #114 patch watch (GitHub Actions, .github/workflows/patch-watch.yml).
// 1. Daybreak's Steam patch notes, read in full: a post that touches alerts, the lattice or
//    captures opens one GitHub issue (label patch-watch, deduped by the Steam post id).
// 2. Census metagame_event list vs the Oracle's tables (oracle-worker/src/engine.js): any id we
//    don't know opens one issue (deduped by the id list).
// The Oracle Worker shows the same patch flag on its page (maintenance.js patchScan); this job is
// the part that reaches the owner (GitHub emails new issues).
import { PATCH_NEWS_URL, patchFlags } from "../oracle-worker/src/maintenance.js";
import { knownEvent } from "../oracle-worker/src/engine.js";

const REPO = process.env.GITHUB_REPOSITORY || "Dayset/ps2-elite-kd";
const GH = process.env.GITHUB_TOKEN || "";
const PROXY = process.env.CENSUS_PROXY || "https://ps2-elite-kd-cache.dayset.workers.dev";
const KEY = process.env.CENSUS_PROXY_KEY || "";
const SID = process.env.CENSUS_SERVICE_ID || "daysetps2legends";
const UA = "ps2-elite-kd patch-watch (+https://dayset.github.io/ps2-elite-kd/)";
const now = Math.floor(Date.now() / 1000);
const DRY = process.argv.includes("--dry");

async function gh(path, opts = {}) {
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, { ...opts,
    headers: { Authorization: `Bearer ${GH}`, Accept: "application/vnd.github+json", "User-Agent": UA, ...(opts.body ? { "Content-Type": "application/json" } : {}) } });
  if (!r.ok) throw new Error(`GitHub ${path}: HTTP ${r.status}`);
  return r.json();
}

async function existingMarkers() {
  const out = new Set();
  for (let page = 1; page <= 5; page++) {
    const list = await gh(`/issues?labels=patch-watch&state=all&per_page=100&page=${page}`);
    for (const i of list) for (const m of String(i.body || "").matchAll(/<!-- patch-watch:([^ ]+) -->/g)) out.add(m[1]);
    if (list.length < 100) break;
  }
  return out;
}

async function openIssue(marker, title, body) {
  if (DRY) { console.log(`[dry] would open: ${title}\n${body}`); return; }
  const i = await gh("/issues", { method: "POST", body: JSON.stringify({ title, body: `${body}\n\n<!-- patch-watch:${marker} -->`, labels: ["patch-watch", "oracle"] }) });
  console.log(`::notice::opened #${i.number}: ${title}`);
}

const seen = DRY ? new Set() : await existingMarkers();
let problems = 0;

// 1) Steam patch notes.
try {
  const r = await fetch(PATCH_NEWS_URL, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const flags = patchFlags(await r.json(), now);
  console.log(`::notice::Steam: ${flags.length} flagged post(s) in the last 14 days`);
  for (const p of flags) {
    const marker = `steam-${p.gid}`;
    if (seen.has(marker)) continue;
    await openIssue(marker, `Oracle: game update "${p.title}" touches ${p.topics.join(", ")}`,
      [`Daybreak posted **${p.title}** (${p.date ? new Date(p.date * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "date unknown"}): ${p.url}`,
        "", "Lines that matched (alerts / lattice / captures):", ...p.lines.map((l) => `- ${l}`), "",
        "Check before trusting the Oracle again: new or changed metagame event ids (engine.js tables), lattice / base changes (regions + capture models), alert length or win rule, continent state at alert start (#114).",
        "The Oracle page shows a notice about this post for 3 days."].join("\n"));
  }
} catch (e) { problems++; console.log(`::warning::Steam patch notes: ${e.message}`); }

// 2) Census metagame_event ids we don't know.
try {
  const url = `${PROXY}/census/s:${SID}/get/ps2:v2/metagame_event?c:limit=1000&c:show=metagame_event_id,name.en,duration_minutes,type`;
  const r = await fetch(url, { headers: { "User-Agent": UA, ...(KEY ? { "X-Proxy-Key": KEY } : {}) }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const list = ((await r.json()).metagame_event_list || []);
  if (!list.length) throw new Error("empty list");
  const unknown = list.filter((e) => !knownEvent(+e.metagame_event_id)).sort((a, b) => a.metagame_event_id - b.metagame_event_id);
  console.log(`::notice::Census: ${list.length} metagame events, ${unknown.length} not in the Oracle's tables`);
  // Old event ids (pre-2020 alerts) are in Census forever: only report ids we haven't reported before.
  const marker = `census-${unknown.map((e) => e.metagame_event_id).join(",")}`;
  const prior = [...seen].filter((m) => m.startsWith("census-")).flatMap((m) => m.slice(7).split(","));
  const fresh = unknown.filter((e) => !prior.includes(String(e.metagame_event_id)));
  if (fresh.length && !seen.has(marker)) {
    await openIssue(marker, `Oracle: ${fresh.length} Census metagame event id(s) not in the Oracle's tables`,
      ["Census `metagame_event` lists ids that `oracle-worker/src/engine.js` doesn't know (TERRITORY_ALERTS, SUDDEN_DEATH, OTHER_ALERTS, IGNORED_EVENTS):", "",
        "| id | name | min | type |", "|---|---|---|---|",
        ...fresh.map((e) => `| ${e.metagame_event_id} | ${(e.name && e.name.en) || ""} | ${e.duration_minutes || ""} | ${e.type || ""} |`), "",
        "Decide per id: territory alert (trees apply), other alert (no odds, OTHER_ALERTS) or ignored (IGNORED_EVENTS). The live Worker also reports unknown ids it sees in `/health` → `last_cycle.unknown_events`."].join("\n"));
  }
} catch (e) { problems++; console.log(`::warning::Census metagame_event: ${e.message}`); }

process.exit(problems === 2 ? 1 : 0);
