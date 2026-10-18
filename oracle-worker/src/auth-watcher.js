/**
 * AuthWatcher: one SQLite-backed Durable Object that listens to the Census event
 * stream for PlayerLogout ONLY while at least one login challenge is open.
 *
 * /watch {id, cid, from, until}  add a character; connect + subscribe if needed
 * /status                         stream state (auth health)
 * alarm (every 10 s while watching): prune finished windows, mark them expired,
 *                                    disconnect when nothing is left to watch
 *
 * A logout passes a challenge when its timestamp is inside [from - 2 s, until + 5 s]
 * (small allowance for clock skew / stream delay). Logouts before ACCEPT are
 * outside the window and ignored. Free-plan friendly: no traffic and no memory
 * when nobody is verifying.
 */
const STREAM = (sid) => `https://push.planetside2.com/streaming?environment=ps2&service-id=s:${sid}`;
const ALARM_MS = 10_000;
const SKEW_BEFORE_S = 2, SKEW_AFTER_S = 5;

/** Pure: which watch (if any) a stream message passes. */
export function matchLogout(watches, msg) {
  const p = msg && msg.type === "serviceMessage" && msg.payload;
  if (!p || p.event_name !== "PlayerLogout") return null;
  const cid = String(p.character_id || "");
  const ts = +p.timestamp;
  const w = watches[cid];
  if (!w || !Number.isFinite(ts)) return null;
  return ts >= w.from - SKEW_BEFORE_S && ts <= w.until + SKEW_AFTER_S ? { ...w, cid, ts } : null;
}

export class AuthWatcher {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.ws = null;
    this.lastMsg = 0;
    this.connects = 0;
    this.lastError = null;
    this.subscribed = new Set();
  }

  async watches() { return (await this.ctx.storage.get("watches")) || {}; }
  async save(w) { await this.ctx.storage.put("watches", w); }

  async ensure() {
    const w = await this.watches();
    const cids = Object.keys(w);
    if (!cids.length) { this.close(); return; }
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + ALARM_MS);
    if (!this.ws || Date.now() - this.lastMsg > 90_000) {
      this.close();
      const sid = ((this.env && this.env.CENSUS_SERVICE_ID) || "daysetps2legends").replace(/^s:/, "");
      const res = await fetch(STREAM(sid), { headers: { Upgrade: "websocket" } });
      const ws = res.webSocket;
      if (!ws) { this.lastError = `upgrade ${res.status} @${new Date().toISOString()}`; return; }
      ws.accept();
      this.ws = ws;
      this.lastMsg = Date.now();
      this.connects++;
      this.subscribed = new Set();
      ws.addEventListener("message", (m) => this.onMessage(m.data));
      ws.addEventListener("close", () => { if (this.ws === ws) this.ws = null; });
      ws.addEventListener("error", () => { if (this.ws === ws) this.ws = null; });
    }
    const add = cids.filter((c) => !this.subscribed.has(c));
    if (add.length) {
      this.ws.send(JSON.stringify({ service: "event", action: "subscribe", characters: add, eventNames: ["PlayerLogout"] }));
      add.forEach((c) => this.subscribed.add(c));
    }
  }

  close() {
    try { this.ws && this.ws.close(); } catch {}
    this.ws = null;
    this.subscribed = new Set();
  }

  async onMessage(data) {
    this.lastMsg = Date.now();
    let msg;
    try { msg = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data)); } catch { return; }
    const w = await this.watches();
    const hit = matchLogout(w, msg);
    if (!hit) return;
    await this.env.DB.prepare("UPDATE challenge SET status='passed', passed_at=? WHERE id=? AND status='accepted'").bind(hit.ts, hit.id).run();
    delete w[hit.cid];
    await this.save(w);
    if (!Object.keys(w).length) this.close();
  }

  async alarm() {
    const now = Math.floor(Date.now() / 1000);
    const w = await this.watches();
    for (const [cid, x] of Object.entries(w)) {
      if (now > x.until + SKEW_AFTER_S + 5) {
        await this.env.DB.prepare("UPDATE challenge SET status='expired' WHERE id=? AND status='accepted'").bind(x.id).run();
        delete w[cid];
      }
    }
    await this.save(w);
    if (Object.keys(w).length) { await this.ensure(); await this.ctx.storage.setAlarm(Date.now() + ALARM_MS); }
    else this.close();
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/watch" && request.method === "POST") {
      const b = await request.json();
      const w = await this.watches();
      w[String(b.cid)] = { id: String(b.id), from: +b.from, until: +b.until };
      await this.save(w);
      await this.ensure();
      return Response.json({ ok: true, watching: Object.keys(w).length, connected: !!this.ws });
    }
    const w = await this.watches();
    return Response.json({
      stream: this.ws ? "connected" : Object.keys(w).length ? "reconnecting" : "idle (connects on demand)",
      watching: Object.keys(w).length,
      last_msg_ago_s: this.lastMsg ? Math.round((Date.now() - this.lastMsg) / 1000) : null,
      connects: this.connects, last_error: this.lastError,
    });
  }
}
