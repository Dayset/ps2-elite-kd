/**
 * 🔎 Session forensics (user t325u, 2026-10-10): the manimami / Add1ti0nal
 * investigation as an automatic check. For a few suspicious players per run
 * the refresh pipeline fetches the kill events of their top session(s) from
 * Honu (GET /api/kills/session/{id}) and this module reads what the session
 * was about: how fast the kills came, with what, on whom.
 *
 * Two 🚩 rules (pattern "session-forensics", neutral wording: a lead, not proof):
 *   ⚡ impossible kill rate — ≥ IMPOSSIBLE.SECONDS separate seconds with
 *      ≥ IMPOSSIBLE.PER_SECOND kills each (one C-4 / orbital strike blast is a
 *      single second and doesn't count), OR ≥ IMPOSSIBLE.MIN_KILLS kills with
 *      ≥ IMPOSSIBLE.ZERO_GAP_SHARE of them 0 s after the previous kill.
 *      manimami 77603087: 260 kills in 16 min, 79% 0 s gaps, 19 kills in one second (MANA AV turret).
 *   🔥 burst — ≥ BURST.KILLS_5MIN kills inside one 5-minute window AND session
 *      K/D ≥ BURST.KD. Add1ti0nal 60367634: 56 kills in 5 min, 64 / 1, on his first day.
 * Top legit sessions (JustV6me, ShloDog, Zyr0sNCx, xCloneKano) peak at 3–7
 * kills in 10 s, ≤ 18 in 60 s, ≤ 42 in 5 min, ≤ 4 kills in one second.
 *
 * Oddities (📉 review, not 🚩): peak minute ≥ ODD.PEAK_60S kills; headshots
 * ≥ ODD.HS over ≥ ODD.HS_MIN_KILLS kills; a farm-like victim (≥ ODD.FARM_KILLS
 * kills on one victim, never killed back); a < 1-day-old account with
 * ≥ ODD.NEW_KILLS kills at K/D ≥ ODD.NEW_KD.
 * DOM-free, no network (browser + Node).
 */
export const FORENSICS_RULE = Object.freeze({
  IMPOSSIBLE: Object.freeze({ PER_SECOND: 5, SECONDS: 3, MIN_KILLS: 50, ZERO_GAP_SHARE: 0.5 }),
  BURST: Object.freeze({ KILLS_5MIN: 50, KD: 20 }),
  ODD: Object.freeze({ PEAK_60S: 25, HS: 0.75, HS_MIN_KILLS: 100, FARM_KILLS: 20, NEW_KILLS: 100, NEW_KD: 10 }),
});

/** Session picking: a session needs this many kills to be worth a look. */
export const FORENSICS_PICK = Object.freeze({ MIN_KILLS: 30, MIN_KPM_SECONDS: 300 });

const fin = (v) => typeof v === "number" && Number.isFinite(v);
const r3 = (v) => (fin(v) ? Math.round(v * 1000) / 1000 : null);
const tsec = (s) => {
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.floor(t / 1000) : NaN;
};

/** Most kills inside any window of `w` seconds (ts sorted ascending, seconds). */
export function maxInWindow(ts, w) {
  let best = 0;
  let j = 0;
  for (let i = 0; i < ts.length; i++) {
    while (ts[i] - ts[j] >= w) j++;
    best = Math.max(best, i - j + 1);
  }
  return best;
}

/**
 * Sessions to analyze from what we already store: { id: { kills, seconds, start? } }
 * (assists tuples / data/xp sessions / a Honu session list). → up to 2 ids:
 * most kills, and highest KPM (≥ 5 min), skipping ids in `done`.
 */
export function pickForensicSessions(sessions, done = {}, pick = FORENSICS_PICK) {
  const list = Object.entries(sessions || {})
    .map(([id, s]) => ({ id: String(id), kills: +(s && s.kills) || 0, seconds: +(s && s.seconds) || 0 }))
    .filter((s) => s.kills >= pick.MIN_KILLS);
  if (!list.length) return [];
  const out = [];
  const byKills = list.slice().sort((a, b) => b.kills - a.kills)[0];
  out.push(byKills);
  const kpm = (s) => s.kills / (s.seconds / 60);
  const byKpm = list.filter((s) => s.seconds >= pick.MIN_KPM_SECONDS).sort((a, b) => kpm(b) - kpm(a))[0];
  if (byKpm && byKpm.id !== byKills.id) out.push(byKpm);
  return out.filter((s) => !(done && done[s.id])).map((s) => s.id);
}

/** Merge stored session sources into { id: { kills, seconds } }. */
export function knownSessions({ assists = null, xp = null, honuList = null } = {}) {
  const out = {};
  const put = (id, kills, seconds) => {
    if (!id || !fin(kills)) return;
    const prev = out[id];
    if (!prev || kills > prev.kills) out[id] = { kills, seconds: fin(seconds) ? seconds : (prev && prev.seconds) || 0 };
  };
  for (const [id, t] of Object.entries((assists && assists.sessions) || {})) if (Array.isArray(t)) put(String(id), +t[1], +t[2]);
  for (const [id, s] of Object.entries((xp && xp.sessions) || {})) if (s) put(String(id), +s.k, +s.sec);
  for (const s of Array.isArray(honuList) ? honuList : []) {
    if (!s || !s.end || s.id == null) continue;
    put(String(s.id), +s.kills, (Date.parse(s.end) - Date.parse(s.start)) / 1000);
  }
  return out;
}

/**
 * Honu kill events of one session → compact JSON-safe report (no names of
 * every victim, just counts + a few top repeats).
 * events: [{ event: { attackerCharacterID, killedCharacterID, attackerTeamID, killedTeamID,
 *            attackerVehicleID, weaponID, isHeadshot, timestamp }, attacker, killed, item }]
 */
export function analyzeSessionKills(events, cid, { sessionId = "", session = null } = {}) {
  const me = String(cid);
  const kills = [];
  let deaths = 0;
  let teamKills = 0;
  let attacker = null;
  for (const x of Array.isArray(events) ? events : []) {
    const e = x && x.event;
    if (!e) continue;
    const a = String(e.attackerCharacterID);
    const k = String(e.killedCharacterID);
    if (k === me && a !== me) { deaths++; continue; }
    if (a !== me || k === me) continue;
    if (e.attackerTeamID != null && e.attackerTeamID === e.killedTeamID) { teamKills++; continue; }
    if (!attacker && x.attacker) attacker = x.attacker;
    kills.push(x);
  }
  const ts = kills.map((x) => tsec(x.event.timestamp)).filter(Number.isFinite).sort((a, b) => a - b);
  const n = ts.length;
  const gaps = [];
  for (let i = 1; i < n; i++) gaps.push(ts[i] - ts[i - 1]);
  const perSec = new Map();
  for (const t of ts) perSec.set(t, (perSec.get(t) || 0) + 1);
  const rule = FORENSICS_RULE;
  const secsAtLeast = (m) => [...perSec.values()].filter((v) => v >= m).length;
  const zero = gaps.filter((g) => g === 0).length;
  const hs = kills.filter((x) => x.event.isHeadshot).length;
  const activeMin = n > 1 ? (ts[n - 1] - ts[0]) / 60 : 0;
  // Per weapon.
  const weapons = new Map();
  for (const x of kills) {
    const id = String(x.event.weaponID ?? "0");
    const w = weapons.get(id) || { id, name: (x.item && x.item.name) || (id === "0" ? "unknown / environment" : "#" + id), vehicle: !!(x.item && x.item.isVehicleWeapon), kills: 0, hs: 0, ts: [] };
    w.kills++;
    if (x.event.isHeadshot) w.hs++;
    const t = tsec(x.event.timestamp);
    if (Number.isFinite(t)) w.ts.push(t);
    weapons.set(id, w);
  }
  const weaponRows = [...weapons.values()].sort((a, b) => b.kills - a.kills).slice(0, 5).map((w) => {
    w.ts.sort((a, b) => a - b);
    return { id: w.id, name: w.name, vehicle: w.vehicle, kills: w.kills, share: r3(n ? w.kills / n : 0), hs: r3(w.kills ? w.hs / w.kills : 0), max1s: maxInWindow(w.ts, 1), max60s: maxInWindow(w.ts, 60) };
  });
  // Victims.
  const vic = new Map();
  const backBy = new Map();
  for (const x of events || []) {
    const e = x && x.event;
    if (e && String(e.killedCharacterID) === me) backBy.set(String(e.attackerCharacterID), (backBy.get(String(e.attackerCharacterID)) || 0) + 1);
  }
  const brs = [];
  for (const x of kills) {
    const id = String(x.event.killedCharacterID);
    const v = vic.get(id) || { id, name: (x.killed && x.killed.name) || id, br: x.killed && fin(+x.killed.battleRank) ? +x.killed.battleRank : null, kills: 0 };
    v.kills++;
    vic.set(id, v);
    if (x.killed && fin(+x.killed.battleRank)) brs.push(+x.killed.battleRank);
  }
  brs.sort((a, b) => a - b);
  const victims = [...vic.values()].sort((a, b) => b.kills - a.kills);
  const farmLike = victims.filter((v) => v.kills >= rule.ODD.FARM_KILLS && !(backBy.get(v.id) > 0)).map((v) => ({ name: v.name, kills: v.kills, br: v.br }));
  const created = attacker && Date.parse(attacker.dateCreated);
  const ageDays = fin(created) && n ? r3((ts[0] * 1000 - created) / 86400000) : null;
  const kd = deaths ? n / deaths : n;
  const m = {
    sessionId: String(sessionId || ""),
    start: session && session.start ? session.start : n ? new Date(ts[0] * 1000).toISOString() : null,
    end: session && session.end ? session.end : n ? new Date(ts[n - 1] * 1000).toISOString() : null,
    durationMin: session && session.start && session.end ? r3((Date.parse(session.end) - Date.parse(session.start)) / 60000) : null,
    kills: n, deaths, teamKills, kd: r3(kd),
    activeMin: r3(activeMin), activeKpm: r3(activeMin > 0 ? n / Math.max(1, activeMin) : n),
    max1s: maxInWindow(ts, 1), max5s: maxInWindow(ts, 5), max10s: maxInWindow(ts, 10), peak60s: maxInWindow(ts, 60), max5min: maxInWindow(ts, 300),
    secs5plus: secsAtLeast(rule.IMPOSSIBLE.PER_SECOND), secs3plus: secsAtLeast(3),
    zeroGapShare: r3(gaps.length ? zero / gaps.length : 0),
    medianGap: gaps.length ? gaps.slice().sort((a, b) => a - b)[gaps.length >> 1] : null,
    hs: r3(n ? hs / n : 0),
    vehicleKillShare: r3(n ? kills.filter((x) => +x.event.attackerVehicleID > 0).length / n : 0),
    weapons: weaponRows,
    victims: { unique: victims.length, top: victims.slice(0, 3).map((v) => ({ name: v.name, kills: v.kills, br: v.br })), medianBr: brs.length ? brs[brs.length >> 1] : null, lowBrShare: r3(brs.length ? brs.filter((b) => b < 20).length / brs.length : 0), farmLike },
    account: attacker ? { br: fin(+attacker.battleRank) ? +attacker.battleRank : null, created: attacker.dateCreated || null, ageDaysAtSession: ageDays } : null,
  };
  return { ...m, ...forensicsVerdict(m) };
}

/** Rules on one analyzed session → { flagged, reasons: [...], oddities: [...] } (neutral wording). */
export function forensicsVerdict(m, rule = FORENSICS_RULE) {
  const reasons = [];
  const oddities = [];
  if (!m || !(m.kills > 0)) return { flagged: false, reasons, oddities };
  const I = rule.IMPOSSIBLE;
  if (m.secs5plus >= I.SECONDS) reasons.push(`⚡ impossible kill rate: ${m.secs5plus} separate seconds with ${I.PER_SECOND}+ kills (max ${m.max1s} in one second)`);
  if (m.kills >= I.MIN_KILLS && m.zeroGapShare >= I.ZERO_GAP_SHARE) reasons.push(`⚡ impossible kill rate: ${Math.round(m.zeroGapShare * 100)}% of ${m.kills} kills came 0 s after the previous kill`);
  if (m.max5min >= rule.BURST.KILLS_5MIN && m.kd >= rule.BURST.KD) reasons.push(`🔥 burst: ${m.max5min} kills inside 5 minutes, session K/D ${fmt1(m.kd)}`);
  const O = rule.ODD;
  if (m.peak60s >= O.PEAK_60S) oddities.push(`peak minute ${m.peak60s} kills`);
  if (m.kills >= O.HS_MIN_KILLS && m.hs >= O.HS) oddities.push(`${Math.round(m.hs * 100)}% headshots over ${m.kills} kills`);
  if (m.victims && m.victims.farmLike && m.victims.farmLike.length) oddities.push(`farm-like victim: ${m.victims.farmLike.map((v) => v.name + " ×" + v.kills).join(", ")} (never killed back)`);
  const age = m.account && m.account.ageDaysAtSession;
  if (fin(age) && age < 1 && m.kills >= O.NEW_KILLS && m.kd >= O.NEW_KD) oddities.push(`account under 1 day old: ${m.kills} kills at K/D ${fmt1(m.kd)}`);
  return { flagged: reasons.length > 0, reasons, oddities };
}

const fmt1 = (v) => (fin(v) ? (Math.round(v * 10) / 10).toString() : "—");

/** Per-player summary over its analyzed sessions (worst first). */
export function forensicsSummary(entry) {
  const sessions = Object.values((entry && entry.sessions) || {}).filter((s) => s && s.kills > 0);
  sessions.sort((a, b) => (b.flagged - a.flagged) || (b.oddities || []).length - (a.oddities || []).length || b.kills - a.kills);
  const flagged = sessions.some((s) => s.flagged);
  const odd = !flagged && sessions.some((s) => (s.oddities || []).length);
  return { flagged, odd, worst: sessions[0] || null, analyzed: sessions.length };
}

/** Human rule text (build-log). */
export function forensicsRuleText(rule = FORENSICS_RULE) {
  const I = rule.IMPOSSIBLE;
  return `🚩 [session-forensics] in a top session (most kills / highest KPM): ⚡ ${I.SECONDS}+ separate seconds with ${I.PER_SECOND}+ kills, ` +
    `or ${I.MIN_KILLS}+ kills with ${Math.round(I.ZERO_GAP_SHARE * 100)}%+ of them 0 s after the previous kill; ` +
    `or 🔥 ${rule.BURST.KILLS_5MIN}+ kills inside 5 minutes at session K/D ${rule.BURST.KD}+. ` +
    `📉 review: peak minute ${rule.ODD.PEAK_60S}+ kills, ${Math.round(rule.ODD.HS * 100)}%+ headshots over ${rule.ODD.HS_MIN_KILLS}+ kills, ` +
    `a victim killed ${rule.ODD.FARM_KILLS}+ times who never killed back, or an account under 1 day old with ${rule.ODD.NEW_KILLS}+ kills at K/D ${rule.ODD.NEW_KD}+. A lead for review, not proof.`;
}

/** Honu session page link. */
export const honuSessionUrl = (id) => `https://wt.honu.pw/s/${encodeURIComponent(String(id))}`;
