/**
 * PlayStation room 🤝 assists collector (#60). Honu never recorded PS XP and
 * Census REST has no assists, so the only source is Daybreak's live event
 * stream for the two PS worlds. Nobody else records it: this does, forward-only.
 *
 * Runs INSIDE the existing KillMonitor Durable Object (same instance as the
 * PC pilot): a second always-on object would double the free-plan Durable
 * Object duration (13,000 GB-s/day; one object all day = 10,800). Two extra
 * outbound sockets in the same object cost no extra duration.
 *
 * Per PS environment (ps2ps4us world 1000 = Genudine, ps2ps4eu world 2000 =
 * Ceres; never ps2): one socket, subscribed to all characters of that world,
 * only these events:
 *   GainExperience ids 2/3/371/372 (assists) + 1/278/279 (kill XP → the
 *   earner's score multiplier for the damage share), Death (kills/deaths),
 *   PlayerLogin / PlayerLogout (sessions).
 * Sessions per character: open on login (or first event), close on logout,
 * after IDLE_MS without events, or at MAX_SESSION_MS. A closed session with
 * kills, deaths or assists becomes ONE SQLite row in the PC pipeline's session
 * shape (refresh-cache.mjs mergeAssists): [assists, kills, seconds, startMs,
 * shareSum, shareN, mult, deaths]. Open sessions are checkpointed as one row
 * every CHECKPOINT_MS so an eviction loses at most a few minutes.
 * scripts/refresh-ps.mjs pulls the rows (POST /ps-assists/export, proxy key)
 * into data-ps/players/*.json → build-ranks fills 🤝 apk → 🪳 Zerg.
 *
 * Off switch: Worker variable PS_ASSISTS = "off".
 */

export const PS_STREAM_ENVS = { ps2ps4us: "1000", ps2ps4eu: "2000" };
export const ASSIST_EXP_IDS = [2, 3, 371, 372];
/** Same constants as scripts/refresh-cache.mjs (test/ps-assists.test.mjs keeps them equal). */
export const ASSIST_BASE_XP = { 2: 100, 371: 150, 372: 300 };
export const KILL_BASE_XP = { 1: 100, 278: 150, 279: 300 };
export const IDLE_MS = 30 * 60e3;
export const MAX_SESSION_MS = 12 * 3600e3;
const CHECKPOINT_MS = 5 * 60e3;
const RETAIN_MS = 45 * 86400e3;
const MAX_EVENTS = 600; // per kind per open session (oldest dropped)
const STALE_MS = 120e3; // no message (Census heartbeats every ~30 s) → reconnect

const STREAM = (ns, sid) => `https://push.planetside2.com/streaming?environment=${ns}&service-id=s:${sid}`;

export function subscribeMessage(ns) {
  const world = PS_STREAM_ENVS[ns];
  if (!world) throw new Error(`not a PlayStation environment: ${ns}`);
  const xp = [...ASSIST_EXP_IDS, ...Object.keys(KILL_BASE_XP).map(Number)].map((id) => `GainExperience_experience_id_${id}`);
  return { service: "event", action: "subscribe", characters: ["all"], worlds: [world], logicalAndCharactersWithWorlds: true, eventNames: [...xp, "Death", "PlayerLogin", "PlayerLogout"] };
}

/**
 * Close-time assist stats for one session: same recipe as assistStatsFromBlock
 * (refresh-cache.mjs) — multiplier = the earner's own kill XP / base at the
 * kill nearest in time (else median, else 1); share = amount / mult / base,
 * halved if > 1, capped at 1; SPAWN_ASSIST (3) counts but has no share.
 * refs: [[t, ratio]], asst: [[t, id, amount]].
 */
export function sessionAssistStats(refs, asst) {
  const sorted = refs.map((x) => x[1]).sort((p, q) => p - q);
  const median = sorted.length ? sorted[sorted.length >> 1] : 1;
  const multAt = (t) => {
    if (!refs.length) return median;
    let best = refs[0];
    for (const x of refs) if (Math.abs(x[0] - t) < Math.abs(best[0] - t)) best = x;
    return best[1];
  };
  let shareSum = 0, shareN = 0;
  for (const [t, id, amount] of asst) {
    const base = ASSIST_BASE_XP[id];
    if (!base || !(amount >= 0)) continue;
    let share = amount / Math.max(1, multAt(t)) / base;
    if (share > 1) share /= 2;
    shareSum += Math.min(1, share);
    shareN++;
  }
  return { shareSum: Math.round(shareSum * 1000) / 1000, shareN, mult: Math.round(Math.max(1, median) * 100) / 100 };
}

/** Pure session bookkeeping for one environment (tested without a socket). */
export class PsSessions {
  constructor(ns, open = {}) {
    this.ns = ns;
    this.open = open; // cid → { st, last, a, k, d, refs, asst }
  }
  get(cid, t) {
    let s = this.open[cid];
    if (!s) s = this.open[cid] = { st: t, last: t, a: 0, k: 0, d: 0, refs: [], asst: [] };
    return s;
  }
  /** One stream payload → [] or closed session rows. */
  onEvent(p, now = Date.now()) {
    const out = [];
    if (!p || typeof p !== "object") return out;
    const t = (+p.timestamp || Math.floor(now / 1000)) * 1000;
    const ev = p.event_name;
    const cid = String(p.character_id || "");
    if (!/^\d+$/.test(cid)) return out;
    // A session past MAX_SESSION_MS is cut before this event lands.
    const cut = (c) => { const s = this.open[c]; if (s && t - s.st > MAX_SESSION_MS) { const r = this.close(c, s.last); if (r) out.push(r); } };
    if (ev === "PlayerLogin") {
      const r = this.close(cid, this.open[cid] ? this.open[cid].last : t);
      if (r) out.push(r);
      this.get(cid, t);
    } else if (ev === "PlayerLogout") {
      const r = this.close(cid, t);
      if (r) out.push(r);
    } else if (ev === "GainExperience") {
      cut(cid);
      const id = +p.experience_id, amount = +p.amount;
      const s = this.get(cid, t);
      s.last = Math.max(s.last, t);
      if (KILL_BASE_XP[id]) { if (amount > 0) push(s.refs, [t, amount / KILL_BASE_XP[id]]); }
      else if (ASSIST_EXP_IDS.includes(id)) { s.a++; push(s.asst, [t, id, Number.isFinite(amount) ? amount : -1]); }
    } else if (ev === "Death") {
      const a = String(p.attacker_character_id || "");
      const tk = p.attacker_team_id != null && p.team_id != null && String(p.attacker_team_id) === String(p.team_id);
      cut(cid);
      const v = this.get(cid, t);
      v.last = Math.max(v.last, t);
      v.d++;
      if (/^\d+$/.test(a) && a !== "0" && a !== cid && !tk) {
        cut(a);
        const s = this.get(a, t);
        s.last = Math.max(s.last, t);
        s.k++;
      }
    }
    return out;
  }
  /** Sessions idle past IDLE_MS (or too long) are closed at their last event. */
  sweep(now = Date.now()) {
    const out = [];
    for (const cid of Object.keys(this.open)) {
      const s = this.open[cid];
      if (now - s.last > IDLE_MS || now - s.st > MAX_SESSION_MS) { const r = this.close(cid, s.last); if (r) out.push(r); }
    }
    return out;
  }
  close(cid, end) {
    const s = this.open[cid];
    if (!s) return null;
    delete this.open[cid];
    if (!s.a && !s.k && !s.d) return null;
    const st = sessionAssistStats(s.refs, s.asst);
    return { ns: this.ns, cid, st: s.st, sec: Math.max(0, Math.round((Math.max(end, s.last) - s.st) / 1000)), a: s.a, k: s.k, d: s.d, ss: st.shareSum, sn: st.shareN, mult: st.mult };
  }
}
function push(arr, x) { arr.push(x); if (arr.length > MAX_EVENTS) arr.splice(0, arr.length - MAX_EVENTS); }

/** The sockets + storage half, owned by KillMonitor. */
export class PsAssists {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.ws = {};
    this.lastMsg = {};
    this.lastCheckpoint = Date.now();
    const sql = ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS ps_sess (ns TEXT, cid TEXT, st INTEGER, sec INTEGER, a INTEGER, k INTEGER, d INTEGER, ss REAL, sn INTEGER, mult REAL, at INTEGER)`);
    sql.exec(`CREATE INDEX IF NOT EXISTS ps_sess_at ON ps_sess (at)`);
    sql.exec(`CREATE INDEX IF NOT EXISTS ps_sess_cid ON ps_sess (cid)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS ps_meta (k TEXT PRIMARY KEY, v TEXT)`);
    this.sessions = {};
    for (const ns of Object.keys(PS_STREAM_ENVS)) {
      let open = {};
      try { open = JSON.parse(this.meta("open:" + ns) || "{}") || {}; } catch {}
      this.sessions[ns] = new PsSessions(ns, open);
    }
  }
  enabled() { return String((this.env && this.env.PS_ASSISTS) || "").toLowerCase() !== "off"; }
  meta(k, v) {
    const sql = this.ctx.storage.sql;
    if (v === undefined) { const r = sql.exec("SELECT v FROM ps_meta WHERE k=?", k).toArray()[0]; return r ? r.v : null; }
    sql.exec("INSERT OR REPLACE INTO ps_meta (k, v) VALUES (?, ?)", k, String(v));
  }
  bump(k) { this.meta(k, (+this.meta(k) || 0) + 1); }
  store(rows) {
    const sql = this.ctx.storage.sql;
    const at = Date.now();
    for (const r of rows) {
      sql.exec("INSERT INTO ps_sess VALUES (?,?,?,?,?,?,?,?,?,?,?)", r.ns, r.cid, r.st, r.sec, r.a, r.k, r.d, r.ss, r.sn, r.mult, at);
    }
  }
  checkpoint() {
    for (const ns of Object.keys(this.sessions)) this.meta("open:" + ns, JSON.stringify(this.sessions[ns].open));
    this.lastCheckpoint = Date.now();
  }
  /** Called from KillMonitor.ensure() (alarm every 60 s + the 5-minute cron). */
  async ensure() {
    if (!this.enabled()) {
      for (const ns of Object.keys(this.ws)) { try { this.ws[ns] && this.ws[ns].close(); } catch {} }
      this.ws = {};
      return false;
    }
    const now = Date.now();
    for (const ns of Object.keys(PS_STREAM_ENVS)) {
      this.store(this.sessions[ns].sweep(now));
      if (this.ws[ns] && now - (this.lastMsg[ns] || 0) < STALE_MS) continue;
      try { this.ws[ns] && this.ws[ns].close(); } catch {}
      this.ws[ns] = null;
      await this.connect(ns);
    }
    if (now - this.lastCheckpoint >= CHECKPOINT_MS) this.checkpoint();
    const day = new Date(now).toISOString().slice(0, 10);
    if (this.meta("pruned") !== day) {
      this.ctx.storage.sql.exec("DELETE FROM ps_sess WHERE at < ?", now - RETAIN_MS);
      this.meta("pruned", day);
    }
    return true;
  }
  async connect(ns) {
    const sid = (this.env && this.env.CENSUS_SERVICE_ID) || "daysetps2legends";
    let res;
    try { res = await fetch(STREAM(ns, sid), { headers: { Upgrade: "websocket" } }); } catch (e) { this.meta("lastError:" + ns, `fetch ${String(e && e.message).slice(0, 80)} @${new Date().toISOString()}`); return; }
    const ws = res.webSocket;
    if (!ws) { this.meta("lastError:" + ns, `upgrade ${res.status} @${new Date().toISOString()}`); return; }
    ws.accept();
    this.ws[ns] = ws;
    this.lastMsg[ns] = Date.now();
    this.bump("connects:" + ns);
    ws.addEventListener("message", (m) => this.onMessage(ns, m.data));
    ws.addEventListener("close", () => { if (this.ws[ns] === ws) this.ws[ns] = null; });
    ws.addEventListener("error", () => { if (this.ws[ns] === ws) this.ws[ns] = null; });
    ws.send(JSON.stringify(subscribeMessage(ns)));
  }
  onMessage(ns, data) {
    this.lastMsg[ns] = Date.now();
    let j;
    try { j = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data)); } catch { return; }
    const p = j && j.type === "serviceMessage" && j.payload;
    if (!p) return;
    // Belt and braces: only this socket's PS world, never anything else.
    if (p.world_id != null && String(p.world_id) !== PS_STREAM_ENVS[ns]) return;
    const rows = this.sessions[ns].onEvent(p);
    if (rows.length) this.store(rows);
  }
  status() {
    const sql = this.ctx.storage.sql;
    const out = { enabled: this.enabled(), retainDays: RETAIN_MS / 86400e3, envs: {} };
    for (const ns of Object.keys(PS_STREAM_ENVS)) {
      const n = sql.exec("SELECT COUNT(*) AS n, COALESCE(SUM(a),0) AS a, COALESCE(SUM(k),0) AS k FROM ps_sess WHERE ns=?", ns).toArray()[0];
      out.envs[ns] = {
        connected: !!this.ws[ns], lastMsgAgoS: this.lastMsg[ns] ? Math.round((Date.now() - this.lastMsg[ns]) / 1000) : null,
        connects: +this.meta("connects:" + ns) || 0, lastError: this.meta("lastError:" + ns),
        open: Object.keys(this.sessions[ns].open).length, sessions: n.n, assists: n.a, kills: n.k,
      };
    }
    return out;
  }
  /**
   * Closed sessions for refresh-ps: rows stored after cursor `since` (row id), plus every
   * kept row of the `fresh` keys ("us-<cid>" / "eu-<cid>", ≤ 50 per call).
   */
  exportRows({ since = 0, fresh = [] } = {}, limit = 5000) {
    const sql = this.ctx.storage.sql;
    const cols = ["rid", "ns", "cid", "st", "sec", "a", "k", "d", "ss", "sn", "mult", "at"];
    const rows = sql.exec("SELECT rowid AS rid, * FROM ps_sess WHERE rowid > ? ORDER BY rowid LIMIT ?", +since || 0, limit).toArray().map((r) => cols.map((c) => r[c]));
    const byNs = {};
    for (const key of (Array.isArray(fresh) ? fresh : []).slice(0, 50)) {
      const m = /^(us|eu)-(\d+)$/.exec(String(key));
      if (m) (byNs[m[1] === "us" ? "ps2ps4us" : "ps2ps4eu"] ||= []).push(m[2]);
    }
    const freshRows = [];
    for (const [ns, cids] of Object.entries(byNs)) {
      const q = `SELECT rowid AS rid, * FROM ps_sess WHERE ns=? AND cid IN (${cids.map(() => "?").join(",")}) ORDER BY at`;
      for (const r of sql.exec(q, ns, ...cids).toArray()) freshRows.push(cols.map((c) => r[c]));
    }
    const maxRid = sql.exec("SELECT COALESCE(MAX(rowid),0) AS m FROM ps_sess").toArray()[0].m;
    return { cols, rows, fresh: freshRows, maxRid, more: rows.length >= limit, next: rows.length ? rows[rows.length - 1][0] : +since || 0 };
  }
}
