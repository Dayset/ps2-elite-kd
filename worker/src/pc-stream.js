/**
 * 🖥️ PC live stream (Workers Paid plan, 2026-10-29). ONE outbound socket to the
 * Census event stream for the live PC worlds, inside the existing KillMonitor
 * Durable Object (a second always-on object would cost ~$3 a month more; this
 * one is already in memory all month for the PlayStation sockets).
 *
 * Day 1 = measure (owner rule, claude/duels.md): every message is counted by the
 * meter and fed to the in-memory live map (📍 locator, Oracle fight totals);
 * nothing is stored per kill.
 *
 * Budget governor (per UTC day, PC messages counted by the meter):
 *   - below SOFT: full subscription;
 *   - from SOFT: "lean" — the point-tick XP (557 / 556, the chattiest) is dropped;
 *   - from HARD: the socket closes until the next UTC day.
 * Worker variables: PC_STREAM = "off" turns it off; PC_STREAM_SOFT / PC_STREAM_HARD
 * override the caps. On the free plan (plan.js: plan.json or PLAN=free) it is always off. At HARD every day the month costs about $1.70 above the plan
 * (HARD × 30 / 20 billed requests), the worst it can get.
 */

export const PC_WORLDS = Object.freeze(["1", "10", "40"]);
export const PC_SOFT = 4_000_000;
export const PC_HARD = 8_000_000;
const CORE = ["Death", "VehicleDestroy", "PlayerFacilityCapture", "PlayerFacilityDefend", "PlayerLogin", "PlayerLogout", "GainExperience_experience_id_272"];
const CHATTY = ["GainExperience_experience_id_557", "GainExperience_experience_id_556"];
export const PC_EVENTS = Object.freeze({ full: Object.freeze([...CORE, ...CHATTY]), lean: Object.freeze([...CORE]) });
const STALE_MS = 120e3; // Census heartbeats every ~30 s
const STREAM = (sid) => `https://push.planetside2.com/streaming?environment=ps2&service-id=s:${sid}`;

export function pcSubscribe(level) {
  const names = PC_EVENTS[level];
  if (!names) throw new Error(`no subscription for level ${level}`);
  return { service: "event", action: "subscribe", characters: ["all"], worlds: [...PC_WORLDS], logicalAndCharactersWithWorlds: true, eventNames: [...names] };
}

/** full | lean | off for today's PC message count (and the plan: free → off). */
export function streamLevel(env, todayMsgs, plan = "paid") {
  const e = env || {};
  if (plan !== "paid") return "off";
  if (String(e.PC_STREAM || "").toLowerCase() === "off") return "off";
  const num = (k, d) => { const v = Number(e[k]); return Number.isFinite(v) && v > 0 ? v : d; };
  const soft = num("PC_STREAM_SOFT", PC_SOFT), hard = num("PC_STREAM_HARD", PC_HARD);
  if (todayMsgs >= hard) return "off";
  if (todayMsgs >= soft) return "lean";
  return "full";
}

/** Event name for the meter: the payload's event_name, else the message type. */
export function messageName(j) {
  if (!j || typeof j !== "object") return "other";
  if (j.type === "serviceMessage" && j.payload) {
    const p = j.payload;
    if (p.event_name === "GainExperience") return `GainExperience_${p.experience_id}`;
    return p.event_name || "serviceMessage";
  }
  return j.type || j.service || "other";
}

export class PcStream {
  constructor(ctx, env, { meter, onPayload } = {}) {
    this.ctx = ctx;
    this.env = env;
    this.meter = meter;
    this.onPayload = onPayload || (() => {});
    this.ws = null;
    this.lastMsg = 0;
    this.level = null; // subscription currently sent
    this.connects = 0;
    this.lastError = null;
    this.plan = "free";
  }
  wanted(now = Date.now(), plan = this.plan) { return streamLevel(this.env, this.meter ? this.meter.today("ps2", now) : 0, plan); }
  close() { try { this.ws && this.ws.close(); } catch {} this.ws = null; this.level = null; }
  /** Called from KillMonitor.ensure() (alarm every 60 s). */
  async ensure(now = Date.now(), plan = this.plan) {
    this.plan = plan;
    const want = this.wanted(now, plan);
    if (want === "off") { if (this.ws) this.close(); return false; }
    if (this.ws && now - this.lastMsg < STALE_MS) {
      if (this.level !== want) this.resubscribe(want);
      return true;
    }
    this.close();
    await this.connect(want);
    return !!this.ws;
  }
  resubscribe(level) {
    try {
      this.ws.send(JSON.stringify({ service: "event", action: "clearSubscribe", all: "true" }));
      this.ws.send(JSON.stringify(pcSubscribe(level)));
      this.level = level;
    } catch { this.close(); }
  }
  async connect(level) {
    const sid = (this.env && this.env.CENSUS_SERVICE_ID) || "daysetps2legends";
    let res;
    try { res = await fetch(STREAM(sid), { headers: { Upgrade: "websocket" } }); } catch (e) { this.lastError = `fetch ${String(e && e.message).slice(0, 80)} @${new Date().toISOString()}`; return; }
    const ws = res.webSocket;
    if (!ws) { this.lastError = `upgrade ${res.status} @${new Date().toISOString()}`; return; }
    ws.accept();
    this.ws = ws;
    this.lastMsg = Date.now();
    this.connects++;
    ws.addEventListener("message", (m) => this.onMessage(m.data));
    ws.addEventListener("close", () => { if (this.ws === ws) { this.ws = null; this.level = null; } });
    ws.addEventListener("error", () => { if (this.ws === ws) { this.ws = null; this.level = null; } });
    ws.send(JSON.stringify(pcSubscribe(level)));
    this.level = level;
  }
  onMessage(data) {
    const now = Date.now();
    this.lastMsg = now;
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    let j = null;
    try { j = JSON.parse(text); } catch {}
    if (this.meter) this.meter.msg("ps2", messageName(j), text.length, now);
    const p = j && j.type === "serviceMessage" && j.payload;
    if (!p) return;
    // Belt and braces: live PC worlds only.
    if (p.world_id != null && !PC_WORLDS.includes(String(p.world_id))) return;
    this.onPayload("ps2", p, now);
  }
  status(now = Date.now()) {
    return { on: !!this.ws, plan: this.plan, level: this.level, want: this.wanted(now), lastMsgAgoS: this.lastMsg ? Math.round((now - this.lastMsg) / 1000) : null, connects: this.connects, lastError: this.lastError };
  }
}
