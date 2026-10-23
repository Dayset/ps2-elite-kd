/**
 * AuthWatcher: one SQLite-backed Durable Object that listens to the Census event
 * stream for PlayerLogout ONLY while at least one login challenge is open. One
 * socket per environment in use: ps2 (PC), ps2ps4us (Genudine), ps2ps4eu (Ceres), #61.
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
const STREAM = (sid, env = "ps2") => `https://push.planetside2.com/streaming?environment=${env}&service-id=s:${sid}`;
/** Watch key -> stream environment + bare cid (PC "5428…", PlayStation "us-5428…" / "eu-5428…", #61). */
export function watchEnv(key) {
  const m = /^(?:(us|eu)-)?(\d{5,25})$/.exec(String(key || ""));
  if (!m) return null;
  return { env: m[1] === "us" ? "ps2ps4us" : m[1] === "eu" ? "ps2ps4eu" : "ps2", cid: m[2] };
}
const PREFIX = { ps2: "", ps2ps4us: "us-", ps2ps4eu: "eu-" };
const ALARM_MS = 10_000;
const SKEW_BEFORE_S = 2, SKEW_AFTER_S = 5;

/** Pure: which watch (if any) a stream message from stream `env` passes. */
export function matchLogout(watches, msg, env = "ps2") {
  const p = msg && msg.type === "serviceMessage" && msg.payload;
  if (!p || p.event_name !== "PlayerLogout") return null;
  const cid = (PREFIX[env] || "") + String(p.character_id || "");
  const ts = +p.timestamp;
  const w = watches[cid];
  if (!w || !Number.isFinite(ts)) return null;
  return ts >= w.from - SKEW_BEFORE_S && ts <= w.until + SKEW_AFTER_S ? { ...w, cid, ts } : null;
}

export class AuthWatcher {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.socks = {}; // stream environment -> { ws, lastMsg, subscribed:Set }
    this.connects = 0;
    this.lastError = null;
  }

  get ws() { return Object.values(this.socks).some((x) => x && x.ws) || null; }
  get lastMsg() { return Math.max(0, ...Object.values(this.socks).map((x) => (x && x.lastMsg) || 0)); }

  async watches() { return (await this.ctx.storage.get("watches")) || {}; }
  async save(w) { await this.ctx.storage.put("watches", w); }

  async ensure() {
    const w = await this.watches();
    const byEnv = {};
    for (const key of Object.keys(w)) {
      const e = watchEnv(key);
      if (e) (byEnv[e.env] = byEnv[e.env] || []).push(e.cid);
    }
    for (const env of Object.keys(this.socks)) if (!byEnv[env]) this.close(env);
    if (!Object.keys(byEnv).length) return;
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + ALARM_MS);
    const sid = ((this.env && this.env.CENSUS_SERVICE_ID) || "daysetps2legends").replace(/^s:/, "");
    for (const [env, cids] of Object.entries(byEnv)) {
      let sk = this.socks[env];
      if (!sk || !sk.ws || Date.now() - sk.lastMsg > 90_000) {
        this.close(env);
        const res = await fetch(STREAM(sid, env), { headers: { Upgrade: "websocket" } });
        const ws = res.webSocket;
        if (!ws) { this.lastError = `${env} upgrade ${res.status} @${new Date().toISOString()}`; continue; }
        ws.accept();
        sk = this.socks[env] = { ws, lastMsg: Date.now(), subscribed: new Set() };
        this.connects++;
        ws.addEventListener("message", (m) => this.onMessage(m.data, env));
        ws.addEventListener("close", () => { if (this.socks[env] && this.socks[env].ws === ws) this.socks[env].ws = null; });
        ws.addEventListener("error", () => { if (this.socks[env] && this.socks[env].ws === ws) this.socks[env].ws = null; });
      }
      const add = cids.filter((c) => !sk.subscribed.has(c));
      if (add.length) {
        sk.ws.send(JSON.stringify({ service: "event", action: "subscribe", characters: add, eventNames: ["PlayerLogout"] }));
        add.forEach((c) => sk.subscribed.add(c));
      }
    }
  }

  close(env) {
    for (const e of env ? [env] : Object.keys(this.socks)) {
      try { this.socks[e] && this.socks[e].ws && this.socks[e].ws.close(); } catch {}
      delete this.socks[e];
    }
  }

  async onMessage(data, env = "ps2") {
    if (this.socks[env]) this.socks[env].lastMsg = Date.now();
    let msg;
    try { msg = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data)); } catch { return; }
    const w = await this.watches();
    const hit = matchLogout(w, msg, env);
    if (!hit) return;
    await this.env.DB.prepare("UPDATE challenge SET status='passed', passed_at=? WHERE id=? AND status='accepted'").bind(hit.ts, hit.id).run();
    delete w[hit.cid];
    await this.save(w);
    await this.ensure();
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
    await this.ensure();
    if (Object.keys(w).length) await this.ctx.storage.setAlarm(Date.now() + ALARM_MS);
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
      streams: Object.fromEntries(Object.entries(this.socks).map(([e, x]) => [e, x && x.ws ? "connected" : "reconnecting"])),
      watching: Object.keys(w).length,
      last_msg_ago_s: this.lastMsg ? Math.round((Date.now() - this.lastMsg) / 1000) : null,
      connects: this.connects, last_error: this.lastError,
    });
  }
}
