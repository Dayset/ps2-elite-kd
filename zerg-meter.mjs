// 🪳 Zerg meter (zerg-meter.html): one followed enemy's live 🪳 Zerg, on the
// clean LED bar. Standalone page — no nav, no links, no header/footer, no
// site CSS or background image, solid black page (the meter image is pure
// black, so it blends into the page).
//
// The value is the LAST OPPONENT's lifetime 🪳 (owner 2026-11-13): on a
// kill the meter jumps to the victim's Zerg, on a death to the killer's
// Zerg — the most recent Death event decides. It is the opponent's lifetime
// score from the rankings; a live session value doesn't exist for the
// opponent (only the followed player is tracked). Before the first fight
// the meter rests at the followed player's own lifetime 🪳. An opponent
// with no lifetime 🪳 leaves the meter where it was. Assists can't move it
// (GainExperience carries no victim), so the stream subscribes to Death
// only. Session = since this page opened; a reload restarts it.
//
// ?names=Zewgie — the followed enemy (first name wins, like live.html).
// ?demo=1 — no network: a simulated Zerg (sine + jumps) to preview the
// motion and to verify the page headlessly.
import { classifyDeath, cidNameEntry, slugKey } from "./live-model.mjs?v=20261108-neg2";
import { CENSUS_SERVICE_ID } from "./config.mjs?v=20261010-sav1";
import { traitPools, zergScore } from "./trait-scores.mjs?v=20261027-z79";
import { valueToY, roachTop, createMotion, meterValue, parseLastEventRow, createFightQueue, fightTitle, shouldFadeDown } from "./zerg-meter-motion.mjs?v=20261113-zm3";

const CENSUS = `https://census.daybreakgames.com/s:${CENSUS_SERVICE_ID}/get/ps2:v2/`;
const STREAM = `wss://push.planetside2.com/streaming?environment=ps2&service-id=s:${CENSUS_SERVICE_ID}`;

const params = new URLSearchParams(location.search);
const target = (params.get("names") || "").split(",")[0].trim();
const demo = params.get("demo") === "1";

const meterEl = document.getElementById("zergMeter");
const roachEl = document.getElementById("zmRoach");
const laserEl = document.getElementById("zmLaser");
const motion = createMotion();

// Laser marks: on a kill or death the roach leaves a laser mark at that
// level (owner 2026-11-13). A mark stays 4 s from when its fight came
// from the queue, then disappears outright. At most two are alive at
// once (4 s life / 2 s dwell); the cap is insurance only.
const MARK_MS = 4000;
const marks = [];
function placeMark(zerg) {
  const y = valueToY(zerg);
  if (y == null) return;
  const el = document.createElement("div");
  el.className = "zm-mark";
  el.style.top = `${(y * 100).toFixed(3)}%`;
  meterEl.appendChild(el);
  marks.push(el);
  if (marks.length > 8) marks.shift().remove();
  setTimeout(() => {
    const i = marks.indexOf(el);
    if (i >= 0) marks.splice(i, 1);
    el.remove();
  }, MARK_MS);
}

let me = null; // { cid, name, cached: { adjs, zerg } | null }
let ranks = null; // slug -> { name, adjs, zerg }
let ranksP = null;
let cidNamesP = null;
let lifeZerg = null; // the followed player's lifetime 🪳 (the resting value)
let currentValue = null; // the target the motion chases (null = no reading yet)
let displayName = target || "Zerg meter";
let displayKind = null; // "kill" | "death" | null (resting: own lifetime)

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

// One lookup per opponent cid (live.mjs person() pattern, trimmed to what
// the meter needs: the opponent's lifetime 🪳). Returns { name, zerg } or
// null (unknown name, or no lifetime 🪳 in the rankings).
const peopleP = new Map();
function opponentZerg(cid) {
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
    return c && Number.isFinite(c.zerg) ? { name, zerg: c.zerg } : null;
  })();
  peopleP.set(cid, pr);
  pr.catch(() => peopleP.delete(cid));
  return pr;
}

// Every kill and death joins the fight queue (owner 2026-11-13): the
// meter plays them in fight order, one per dwell, so no fight is skipped
// when several land at once and deaths show exactly like kills. The queue
// dedups (the stream and the 1 s poll deliver the same fight twice); an
// unranked opponent has no Zerg to show and never joins it.
const fightQueue = createFightQueue({ dwellMs: 2000, max: 20 });
function offerFight(oppCid, ts, kind) {
  opponentZerg(oppCid).then((o) => {
    if (!o) return;
    fightQueue.offer({ opp: oppCid, ts, kind, zerg: o.zerg, name: o.name });
  });
}

function onDeath(ev, ts) {
  offerFight(ev.opp, ts, ev.kind);
}

// 1-second refresh of "last" (owner 2026-11-13): the recent KILLs and
// DEATHs from Census characters_event, oldest first, so the queue plays
// them in fight order. This is what keeps the meter a live stream: it
// catches up on load and it self-heals when the stream stalls or drops —
// the stream is kept for instant updates, the poll is the backstop. A
// failed tick just skips; the next second retries. Hidden tabs don't poll
// (nobody is watching; resumes instantly on return).
const RECENT_WINDOW_S = 120; // on load, only fights from the last 2 min queue up; older is history
let pollHighTs = null; // the newest fight timestamp the poll has ever offered
let pollPrimed = false;
function pollLast() {
  if (!me || document.hidden) return;
  const base = `${CENSUS}characters_event/?character_id=${me.cid}`;
  Promise.all([
    getJson(`${base}&type=KILL&c:limit=10&c:sort=timestamp:-1`),
    getJson(`${base}&type=DEATH&c:limit=10&c:sort=timestamp:-1`),
  ]).then(([k, d]) => {
    const rows = [
      ...(k.characters_event_list || []).map((r) => parseLastEventRow(r, "kill")),
      ...(d.characters_event_list || []).map((r) => parseLastEventRow(r, "death")),
    ].filter(Boolean).sort((a, b) => a.ts - b.ts); // oldest first
    if (!rows.length) { pollPrimed = true; return; }
    let batch;
    if (!pollPrimed) {
      // Catch-up on load: the recent fights queue up in order; if none
      // are recent, only the newest one shows (the resting "last").
      const nowSec = Math.floor(Date.now() / 1000);
      batch = rows.filter((r) => r.ts >= nowSec - RECENT_WINDOW_S);
      if (!batch.length) batch = [rows[rows.length - 1]];
      pollPrimed = true;
    } else {
      batch = rows.filter((r) => pollHighTs == null || r.ts > pollHighTs);
    }
    for (const e of batch) {
      if (pollHighTs == null || e.ts > pollHighTs) pollHighTs = e.ts;
      offerFight(e.opp, e.ts, e.kind);
    }
  }).catch(() => { /* next second retries */ });
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
    ws.send(JSON.stringify({ service: "event", action: "subscribe", characters: [me.cid], eventNames: ["Death"] }));
  };
  ws.onmessage = (m) => {
    let j;
    try { j = JSON.parse(m.data); } catch { return; }
    if (j.type !== "serviceMessage") return;
    const ev = classifyDeath(j.payload, me.cid);
    if (ev) onDeath(ev, Number(j.payload.timestamp) || null);
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
    lifeZerg = me.cached && Number.isFinite(me.cached.zerg) ? me.cached.zerg : null;
    currentValue = meterValue(lifeZerg, null); // rest at own lifetime 🪳 until the first fight
    connect();
    pollLast(); // catch up on load: the last fight shows at once, no waiting
    setInterval(pollLast, 1000); // refresh "last" every second
    document.addEventListener("visibilitychange", () => { if (!document.hidden) pollLast(); });
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
let faded = false; // the meter has faded down to rest after the idle window
function frame(nowMs) {
  // The queue's turn: one fight per dwell, in fight order. The title is
  // rebuilt for every new fight even when the value is unchanged (two
  // opponents can share a Zerg), so it gets its own check below.
  const next = demo ? null : fightQueue.tick(nowMs);
  if (next) {
    currentValue = meterValue(lifeZerg, next.zerg);
    displayName = next.name;
    displayKind = next.kind;
    faded = false;
    placeMark(next.zerg); // the roach leaves a laser mark at that level
  }
  // Decay (owner 2026-11-13): no kills or deaths shown for 10 s and the
  // queue empty — the meter fades down to rest (own lifetime 🪳). The
  // fall motion glides it down; a new fight resets the clock. Unranked
  // followed players have no rest position, so they stay on the last fight.
  if (!demo && lifeZerg != null && shouldFadeDown({
    queueEmpty: fightQueue.size === 0,
    hasCurrent: fightQueue.current != null,
    currentSinceMs: fightQueue.currentSince,
    nowMs,
    faded,
  })) {
    faded = true;
    currentValue = lifeZerg;
    displayName = me.name;
    displayKind = null;
  }
  const shown = motion.update(demo ? demoTarget(nowMs) : currentValue, nowMs);
  if (shown != null && (lastShown == null || Math.abs(shown - lastShown) > 0.005)) {
    lastShown = shown;
    roachEl.style.top = `${(roachTop(shown) * 100).toFixed(3)}%`;
    laserEl.style.top = `${(valueToY(shown) * 100).toFixed(3)}%`;
    roachEl.hidden = false;
    laserEl.hidden = false;
  }
  if (shown != null) {
    const t = fightTitle(displayKind, displayName, shown);
    if (t !== lastTitle) { document.title = t; lastTitle = t; }
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
if (demo) displayName = target || "Demo";
else startLive();
