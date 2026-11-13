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
import { valueToY, roachTop, createMotion, meterValue, parseLastEventRow, createFightQueue, fightTitle, shouldFadeDown, hasArrived } from "./zerg-meter-motion.mjs?v=20261113-zm5";

const CENSUS = `https://census.daybreakgames.com/s:${CENSUS_SERVICE_ID}/get/ps2:v2/`;
const STREAM = `wss://push.planetside2.com/streaming?environment=ps2&service-id=s:${CENSUS_SERVICE_ID}`;

const params = new URLSearchParams(location.search);
const target = (params.get("names") || "").split(",")[0].trim();
const demo = params.get("demo") === "1";

const meterEl = document.getElementById("zergMeter");
const roachEl = document.getElementById("zmRoach");
const laserEl = document.getElementById("zmLaser");
const motion = createMotion();

// A mark lands 1 s after its trigger (owner 2026-11-13): 1 s after the
// roach arrives at the level, 1 s after it departs, 1 s after an unknown
// fight shows. The mark then stays 4 s from placement (placeMark).
const MARK_DELAY_MS = 1000;
function scheduleMark(zerg, unknown) {
  if (zerg == null) return;
  setTimeout(() => placeMark(zerg, unknown), MARK_DELAY_MS);
}

// Mirror (owner 2026-11-13): an unknown opponent — a killer or victim
// with no lifetime 🪳 — is an indicator of unknown value, so the roach
// mirrors horizontally back and forth a few times (3 cycles) while that
// queue event shows. JS timers, not a CSS animation: the user's phone
// runs with animations disabled, and a CSS animation might not run there.
// A new sequence restarts cleanly (a known fight stops it outright).
let mirrorTimer = null;
let mirrorStep = 0;
function startMirroring() {
  stopMirroring();
  mirrorStep = 0;
  const step = () => {
    mirrorStep++;
    roachEl.classList.toggle("zm-mirror", mirrorStep % 2 === 1); // mirrored on odd steps
    if (mirrorStep < 6) mirrorTimer = setTimeout(step, 300); // 3 back-and-forth cycles
    else { roachEl.classList.remove("zm-mirror"); mirrorTimer = null; }
  };
  step();
}
function stopMirroring() {
  if (mirrorTimer != null) { clearTimeout(mirrorTimer); mirrorTimer = null; }
  roachEl.classList.remove("zm-mirror");
}
const MARK_MS = 4000;
const marks = [];
function placeMark(zerg, unknown) {
  const y = valueToY(zerg);
  if (y == null) return;
  const el = document.createElement("div");
  el.className = "zm-mark" + (unknown ? " zm-mark-unknown" : "");
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
// null (name genuinely unresolvable). zerg is null for an unknown opponent
// — a killer or victim with no lifetime 🪳 — who still joins the queue as
// a mirror event (their name is known, their value isn't). A TRANSIENT
// lookup failure (Census slow or down) REJECTS instead of resolving null,
// so the cached entry is dropped and the next poll retries it — a slow
// Census delays the kill, it must never lose it (2026-11-13: Census
// answered a characters_event query in 3.9 s, and kills were going
// undetected while the poll cursor had already moved past them).
const peopleP = new Map();
function opponentZerg(cid) {
  if (peopleP.has(cid)) return peopleP.get(cid);
  const pr = (async () => {
    let name = "";
    let failed = false; // a fetch threw: transient, retry next time
    try {
      const hit = cidNameEntry(await loadCidNames(), cid);
      if (hit) name = hit.name;
    } catch { failed = true; }
    if (!name) {
      try {
        const j = await getJson(`${CENSUS}character?character_id=${cid}&c:show=character_id,name.first,faction_id`);
        const ch = (j.character_list || [])[0];
        if (ch && ch.name && ch.name.first) name = ch.name.first;
      } catch { failed = true; }
    }
    if (!name) {
      if (failed) throw new Error("opponent name lookup failed (transient)");
      return null; // genuinely unknown name: cache the null
    }
    await loadRanks();
    const c = ranks.get(slugKey(name));
    return { name, zerg: c && Number.isFinite(c.zerg) ? c.zerg : null };
  })();
  peopleP.set(cid, pr);
  pr.catch(() => peopleP.delete(cid));
  return pr;
}

// Every kill and death joins the fight queue (owner 2026-11-13): the
// meter plays them in fight order, one per dwell, so no fight is skipped
// when several land at once and deaths show exactly like kills. The queue
// dedups (the stream and the 1 s poll deliver the same fight twice); an
// unknown opponent joins as a mirror event, not a number. Returns a
// promise of "queued" | "unknown" (name genuinely unresolvable), and
// REJECTS on a transient lookup failure so the caller can retry.
const fightQueue = createFightQueue({ dwellMs: 2000, max: 20 });
function offerFight(oppCid, ts, kind) {
  return opponentZerg(oppCid).then((o) => {
    if (!o) return "unknown";
    fightQueue.offer({ opp: oppCid, ts, kind, zerg: o.zerg, name: o.name });
    return "queued"; // offered (or already queued — the queue dedups)
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
      // The cursor advances only once the fight's lookup RESOLVED (queued
      // or genuinely unknown) — never when the row is merely seen. A slow
      // Census delays the offer, it doesn't lose the kill: the next polls
      // re-fetch and re-offer the same rows (cheap — the lookup promise
      // is cached, the queue dedups), and the cursor moves only when the
      // lookup lands. A transient lookup failure rejects, the cursor
      // stays, and the next second retries.
      offerFight(e.opp, e.ts, e.kind).then(() => {
        if (pollHighTs == null || e.ts > pollHighTs) pollHighTs = e.ts;
      }).catch(() => { /* transient: cursor stays, next second retries */ });
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
let pendingMark = null; // the fight on display whose mark isn't placed yet
let displayUnknown = false; // the fight on display has no lifetime 🪳 to show
function frame(nowMs) {
  // The queue's turn: one fight per dwell, in fight order. The title is
  // rebuilt for every new fight even when the value is unchanged (two
  // opponents can share a Zerg), so it gets its own check below.
  const next = demo ? null : fightQueue.tick(nowMs);
  if (next) {
    // The roach leaves the previous fight's mark as it departs (it got as
    // close as the dwell allowed); the new fight's mark waits for arrival.
    if (pendingMark) scheduleMark(pendingMark.zerg);
    pendingMark = null;
    if (next.zerg == null) {
      // Unknown opponent (no lifetime 🪳): the roach stays where it is
      // and mirrors back and forth (an indicator of unknown value); the
      // mark goes at the level it's standing on, 1 s after the fight
      // shows. The title reads "Zerg ?" — never a number that isn't the
      // opponent's.
      displayName = next.name;
      displayKind = next.kind;
      displayUnknown = true;
      faded = false;
      startMirroring();
      scheduleMark(motion.displayed, true); // unknown mark: left side, not the laser
    } else {
      stopMirroring();
      currentValue = meterValue(lifeZerg, next.zerg);
      displayName = next.name;
      displayKind = next.kind;
      displayUnknown = false;
      faded = false;
      pendingMark = next;
    }
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
    if (pendingMark) scheduleMark(pendingMark.zerg); // leave the last mark behind
    pendingMark = null;
    stopMirroring();
    currentValue = lifeZerg;
    displayName = me.name;
    displayKind = null;
    displayUnknown = false;
  }
  const shown = motion.update(demo ? demoTarget(nowMs) : currentValue, nowMs);
  // The mark goes down 1 s after the roach arrives at the level — never
  // before it moved. (A big fall can outlast the dwell; the departure
  // above covers that case.)
  if (pendingMark && hasArrived(shown, pendingMark.zerg)) {
    scheduleMark(pendingMark.zerg);
    pendingMark = null;
  }
  if (shown != null && (lastShown == null || Math.abs(shown - lastShown) > 0.005)) {
    lastShown = shown;
    roachEl.style.top = `${(roachTop(shown) * 100).toFixed(3)}%`;
    laserEl.style.top = `${(valueToY(shown) * 100).toFixed(3)}%`;
    roachEl.hidden = false;
    laserEl.hidden = false;
  }
  if (shown != null) {
    const t = fightTitle(displayKind, displayName, displayUnknown ? null : shown);
    if (t !== lastTitle) { document.title = t; lastTitle = t; }
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
if (demo) displayName = target || "Demo";
else startLive();
