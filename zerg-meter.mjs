// 🪳 Zerg meter (zerg-meter.html): one followed enemy's live 🪳 Zerg, on the
// clean LED bar. Standalone page — no nav, no links, no header/footer, no
// site CSS or background image, solid black page (the meter image is pure
// black, so it blends into the page).
//
// The value is the SAME live session 🪳 the live page shows (live.mjs
// renderSessVals, 🪳 cell): sessionZerg from the session Inflation and
// session apk, anchored on the lifetime 🪳 with W=100 from the first kill,
// else the plain session value once 10 kills are in. It is computed here
// from the same Census stream (Death + assist GainExperience) and the same
// shared pure functions — not re-derived — so the meter and the live page
// can never disagree. Session = since this page opened; a reload restarts
// it. Before the first kill the meter rests at the lifetime 🪳 (the anchor);
// a player with no lifetime 🪳 shows nothing until 10 session kills.
//
// ?names=Zewgie — the followed enemy (first name wins, like live.html).
// ?demo=1 — no network: a simulated Zerg (sine + jumps) to preview the
// motion and to verify the page headlessly.
import { classifyDeath, DPS_ASSIST_XP, cidNameEntry, slugKey } from "./live-model.mjs?v=20261108-neg2";
import { CENSUS_SERVICE_ID } from "./config.mjs?v=20261010-sav1";
import {
  sessionReady, sessionApk, sessionInflation, sessionZerg, anchorValue,
} from "./live-session.mjs?v=20261108-anch1";
import { traitPools, zergScore } from "./trait-scores.mjs?v=20261027-z79";
import { METER, valueToY, roachTop, createMotion } from "./zerg-meter-motion.mjs?v=20261113-zm1";

const CENSUS = `https://census.daybreakgames.com/s:${CENSUS_SERVICE_ID}/get/ps2:v2/`;
const STREAM = `wss://push.planetside2.com/streaming?environment=ps2&service-id=s:${CENSUS_SERVICE_ID}`;

const params = new URLSearchParams(location.search);
const target = (params.get("names") || "").split(",")[0].trim();
const demo = params.get("demo") === "1";

const roachEl = document.getElementById("zmRoach");
const laserEl = document.getElementById("zmLaser");
const motion = createMotion();

let me = null; // { cid, name, cached: { adjs, zerg } | null }
let ranks = null; // slug -> { name, adjs, zerg }
let sessTp = null; // traitPools for the session 🪳
let ranksP = null;
let cidNamesP = null;
let sessFights = []; // { cid, iv, won } — iv fills late when the opponent resolves
let sessAssists = 0;
let sKills = 0;
let currentValue = null; // the target the motion chases (null = no reading yet)
let displayName = target || "Zerg meter";

document.title = target ? `🪳 Zerg meter — ${target}` : "🪳 Zerg meter";

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function loadRanks() {
  if (ranksP) return ranksP;
  ranksP = (async () => {
    const j = await getJson("data/ranks.json");
    const ci = (c) => j.cols.indexOf(c);
    const iS = ci("slug"), iN = ci("name"), iA = ci("adjs");
    const iF = ci("inflation"), iAp = ci("apk"), iR = ci("rvp"), iC = ci("crp");
    const colOf = (id) => (ci(id) >= 0 ? j.rows.map((r) => r[ci(id)]) : []);
    const tp = traitPools({ adjs: colOf("adjs"), ivi: colOf("ivi"), inflation: colOf("inflation"), apk: colOf("apk") });
    sessTp = tp;
    ranks = new Map(j.rows.map((r) => {
      const o = { name: r[iN], adjs: r[iA] };
      const z = zergScore(tp, iF >= 0 ? r[iF] : null, iAp >= 0 ? r[iAp] : null, iR >= 0 ? r[iR] : null, iC >= 0 ? r[iC] : null);
      o.zerg = z ? z.score : null;
      return [r[iS], o];
    }));
  })();
  return ranksP;
}

function loadCidNames() {
  if (cidNamesP) return cidNamesP;
  cidNamesP = getJson("data/cid-names.json").then((j) => (j && typeof j === "object" ? j : {}), () => ({}));
  return cidNamesP;
}

// One lookup per enemy cid (live.mjs person() pattern, trimmed to what the
// 🪳 needs: the opponent's lifetime adjs for the session Inflation).
// A resolve fills every still-unknown fight against that cid, then the
// value is recomputed — the same late-fill live.mjs does via luckFill.
const peopleP = new Map();
function opponentIv(cid) {
  if (peopleP.has(cid)) return peopleP.get(cid);
  const pr = (async () => {
    let name = "";
    try {
      const hit = cidNameEntry(await loadCidNames(), cid);
      if (hit) name = hit.name;
    } catch { /* map miss: Census fallback */ }
    if (!name) {
      try {
        const j = await getJson(`${CENSUS}character?character_id=${cid}&c:show=character_id,name.first,faction_id`);
        const ch = (j.character_list || [])[0];
        if (ch && ch.name && ch.name.first) name = ch.name.first;
      } catch { /* name stays unknown */ }
    }
    if (!name) return null;
    await loadRanks();
    const c = ranks.get(slugKey(name));
    return c && Number.isFinite(c.adjs) ? c.adjs : null;
  })();
  peopleP.set(cid, pr);
  pr.catch(() => peopleP.delete(cid));
  return pr;
}

function recompute() {
  if (!sessTp) return;
  const myIvi = me && me.cached && me.cached.adjs;
  const lifeZerg = me && me.cached && Number.isFinite(me.cached.zerg) ? me.cached.zerg : null;
  const started = sKills >= 1;
  const zerg = sessionZerg(sessTp, sessionInflation(myIvi, sessFights), sessionApk(sessAssists, sKills));
  // The live page's exact 🪳 formula (renderSessVals): anchored from the
  // first kill when the lifetime anchor exists, else the plain session
  // value once 10 kills are in. Rest at the lifetime value before that.
  const aZerg = started && lifeZerg != null ? anchorValue(lifeZerg, zerg != null ? zerg * sKills : 0, sKills) : null;
  const value = aZerg != null ? aZerg : (sessionReady(sKills) ? zerg : null);
  currentValue = value != null ? value : lifeZerg;
}

function onDeath(ev) {
  const isKill = ev.kind === "kill";
  sessFights.push({ cid: ev.opp, iv: null, won: isKill });
  if (isKill) sKills++;
  opponentIv(ev.opp).then((iv) => {
    if (iv == null) return;
    let filled = false;
    for (const f of sessFights) if (f.cid === ev.opp && f.iv == null) { f.iv = iv; filled = true; }
    if (filled) recompute();
  });
  recompute();
}

let ws = null;
let backoff = 2000;
let connectTimer = null;
let openedAt = 0;
let connectStartedAt = 0;

function connect() {
  // Never open a second socket while one is live or connecting (live.mjs).
  if (ws && ws.readyState === WebSocket.CONNECTING && connectStartedAt && Date.now() - connectStartedAt > 30000) { try { ws.close(); } catch {} ws = null; }
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
  try { ws = new WebSocket(STREAM); } catch { retry(); return; }
  connectStartedAt = Date.now();
  ws.onopen = () => {
    backoff = 2000;
    openedAt = Date.now();
    ws.send(JSON.stringify({ service: "event", action: "subscribe", characters: [me.cid], eventNames: ["Death", "GainExperience_experience_id_1", "GainExperience_experience_id_278", "GainExperience_experience_id_279", "GainExperience_experience_id_2", "GainExperience_experience_id_3", "GainExperience_experience_id_371", "GainExperience_experience_id_372"] }));
  };
  ws.onmessage = (m) => {
    let j;
    try { j = JSON.parse(m.data); } catch { return; }
    if (j.type !== "serviceMessage") return;
    const p = j.payload || {};
    if (p.event_name === "GainExperience") {
      if (String(p.character_id) === me.cid && DPS_ASSIST_XP.has(Number(p.experience_id))) { sessAssists++; recompute(); }
      return;
    }
    const ev = classifyDeath(p, me.cid);
    if (ev) onDeath(ev);
  };
  ws.onclose = () => {
    const lived = openedAt && Date.now() - openedAt > 5000;
    openedAt = 0;
    if (lived) connect(); else retry();
  };
  ws.onerror = () => { try { ws.close(); } catch {} };
}

function retry() {
  if (connectTimer) clearTimeout(connectTimer);
  connectTimer = setTimeout(connect, backoff);
  backoff = Math.min(backoff * 2, 60000);
}

async function startLive() {
  if (!target) return;
  try {
    const bare = target.replace(/^\s*\[[^\]]*\]\s*/, "").trim().toLowerCase();
    const j = await getJson(`${CENSUS}character?name.first_lower=${encodeURIComponent(bare)}&c:show=character_id,name.first,faction_id`);
    const ch = (j.character_list || [])[0];
    if (!ch) return; // unknown name: the meter stays empty
    me = { cid: String(ch.character_id), name: ch.name.first, cached: null };
    displayName = me.name;
    document.title = `🪳 Zerg meter — ${me.name}`;
    await loadRanks();
    me.cached = ranks.get(slugKey(me.name)) || null;
    recompute(); // rest at the lifetime 🪳 until the first kill
    connect();
  } catch { /* Census / ranks unreachable: the meter stays empty */ }
}

// Demo (?demo=1): a slow sine with a step jump every 12 s, so the rise
// (slowed jump) and the fall (slide) are both visible with no network.
function demoTarget(nowMs) {
  const t = nowMs / 1000;
  const base = 55 + 22 * Math.sin(t / 4);
  return base + (Math.floor(t / 12) % 2 === 0 ? 0 : 14);
}

let lastShown = null;
let lastTitle = "";
function frame(nowMs) {
  const shown = motion.update(demo ? demoTarget(nowMs) : currentValue, nowMs);
  if (shown != null && (lastShown == null || Math.abs(shown - lastShown) > 0.005)) {
    lastShown = shown;
    roachEl.style.top = `${(roachTop(shown) * 100).toFixed(3)}%`;
    laserEl.style.top = `${(valueToY(shown) * 100).toFixed(3)}%`;
    roachEl.hidden = false;
    laserEl.hidden = false;
    const t = `🪳 ${displayName} Zerg ${shown.toFixed(1)}`;
    if (t !== lastTitle) { document.title = t; lastTitle = t; }
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
if (demo) displayName = target || "Demo";
else startLive();
