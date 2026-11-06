// OBS clip trigger (live page): when the current run's Σ victim iVi
// reaches the hand-editable threshold, save the OBS replay buffer once.
// The page talks straight to OBS via obs-websocket v5 — no companion app:
// OBS 28+ runs the server (default ws://127.0.0.1:4455), the page opens a
// WebSocket, answers the SHA-256 challenge with the password, and sends
// one {"requestType": "SaveReplayBuffer"} request. That saves the FULL
// replay buffer (OBS has no length parameter for it).
// The evaluator here is pure (no DOM, no WebSocket) so it is unit-testable;
// the client below is the thin browser wrapper around it.

export const OBS_CLIP_DEFAULT_THRESHOLD = 3000;
export const OBS_CLIP_DEFAULT_URL = "ws://127.0.0.1:4455";
export const OBS_CLIP_COOLDOWN_MS = 30000;
export const OBS_CLIP_THRESHOLD_MIN = 100;
export const OBS_CLIP_THRESHOLD_MAX = 100000;

/** Σ of the run's victim iVi values; unknown iVi (null / non-finite) counts as nothing yet. */
export function runSum(ivs) {
  let sum = 0;
  for (const v of ivs || []) if (typeof v === "number" && Number.isFinite(v)) sum += v;
  return sum;
}

/** Parse a hand-typed threshold; garbage / out-of-range falls back (clamped) to the default. */
export function parseObsClipThreshold(raw, fallback = OBS_CLIP_DEFAULT_THRESHOLD) {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(OBS_CLIP_THRESHOLD_MAX, Math.max(OBS_CLIP_THRESHOLD_MIN, Math.floor(n)));
}

/**
 * Once-per-run trigger with a cooldown between saves.
 * evaluate(ivs, now) returns true exactly when the run sum first reaches
 * the threshold AND the cooldown since the last save has passed. A fired
 * run stays fired until resetRun() (the run banking) — later kills in the
 * same run never re-fire. undoFire() rolls a fire back (a save that failed
 * after the check), so the next kill can retry.
 */
export function createObsClipTrigger({ threshold = OBS_CLIP_DEFAULT_THRESHOLD, cooldownMs = OBS_CLIP_COOLDOWN_MS } = {}) {
  let thresholdValue = parseObsClipThreshold(threshold);
  let fired = false;
  let lastSaveAt = null;
  let prevLastSaveAt = null;
  return {
    get threshold() { return thresholdValue; },
    setThreshold(v) { thresholdValue = parseObsClipThreshold(v, thresholdValue); },
    get fired() { return fired; },
    get lastSaveAt() { return lastSaveAt; },
    resetRun() { fired = false; },
    undoFire() { fired = false; lastSaveAt = prevLastSaveAt; },
    evaluate(ivs, now = Date.now()) {
      if (fired) return false;
      if (runSum(ivs) < thresholdValue) return false;
      if (lastSaveAt !== null && now - lastSaveAt < cooldownMs) return false;
      prevLastSaveAt = lastSaveAt;
      fired = true;
      lastSaveAt = now;
      return true;
    },
  };
}

/** obs-websocket v5 challenge/response auth: base64(sha256(base64(sha256(password + salt)) + challenge)). */
export async function obsClipAuth(password, salt, challenge) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) throw new Error("WebCrypto unavailable");
  const enc = new TextEncoder();
  const sha256 = async (text) => new Uint8Array(await subtle.digest("SHA-256", enc.encode(text)));
  const b64 = (bytes) => {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    if (typeof btoa === "function") return btoa(s);
    return Buffer.from(s, "binary").toString("base64");
  };
  const secret = b64(await sha256(String(password) + String(salt)));
  return b64(await sha256(secret + String(challenge)));
}

// Thin obs-websocket v5 client. Constructor touches nothing networked;
// connect() opens the socket. onStatus gets one of
// "connecting" | "connected" | "disconnected" | "error".
export class ObsClipClient {
  constructor({ url = OBS_CLIP_DEFAULT_URL, password = "", onStatus = () => {} } = {}) {
    this.url = url;
    this.password = password;
    this.onStatus = onStatus;
    this.socket = null;
    this.connected = false;
    this._pending = new Map();
    this._nextId = 1;
    this._manualClose = false;
  }

  isConnected() {
    return this.connected && !!this.socket && this.socket.readyState === 1;
  }

  connect(url = this.url, password = this.password) {
    this.url = url;
    this.password = password;
    this.disconnect();
    this._manualClose = false;
    this.onStatus("connecting");
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err) => { if (!settled) { settled = true; err ? reject(err) : resolve(); } };
      let ws;
      try {
        ws = new WebSocket(this.url);
      } catch (e) {
        this.onStatus("error");
        done(e);
        return;
      }
      this.socket = ws;
      ws.onopen = () => {};
      ws.onerror = () => {
        if (!this.connected) { this.onStatus("error"); done(new Error("OBS WebSocket failed")); }
        else this.onStatus("error");
      };
      ws.onclose = () => {
        this.connected = false;
        this.socket = null;
        for (const { reject: rj } of this._pending.values()) rj(new Error("OBS WebSocket closed"));
        this._pending.clear();
        if (!this._manualClose) this.onStatus("disconnected");
      };
      ws.onmessage = async (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.op === 0) {
          // Hello: answer the auth challenge (if any), then Identify.
          const auth = msg.d && msg.d.authentication;
          const identify = { rpcVersion: 1, eventSubscriptions: 0 };
          try {
            if (auth) identify.authentication = await obsClipAuth(this.password, auth.salt, auth.challenge);
          } catch (e) {
            this.onStatus("error");
            done(e);
            try { ws.close(); } catch {}
            return;
          }
          ws.send(JSON.stringify({ op: 1, d: identify }));
        } else if (msg.op === 2) {
          this.connected = true;
          this.onStatus("connected");
          done();
        } else if (msg.op === 7) {
          const p = this._pending.get(msg.d && msg.d.requestId);
          if (!p) return;
          this._pending.delete(msg.d.requestId);
          if (msg.d.requestStatus && msg.d.requestStatus.result) p.resolve(msg.d.responseData || {});
          else p.reject(new Error((msg.d.requestStatus && msg.d.requestStatus.comment) || "OBS request failed"));
        }
      };
    });
  }

  disconnect() {
    this._manualClose = true;
    this.connected = false;
    if (this.socket) {
      try { this.socket.close(); } catch {}
      this.socket = null;
    }
  }

  saveReplayBuffer() {
    if (!this.isConnected()) return Promise.reject(new Error("OBS not connected"));
    const requestId = `obs-clip-${this._nextId++}`;
    return new Promise((resolve, reject) => {
      this._pending.set(requestId, { resolve, reject });
      try {
        this.socket.send(JSON.stringify({ op: 6, d: { requestType: "SaveReplayBuffer", requestId } }));
      } catch (e) {
        this._pending.delete(requestId);
        reject(e);
      }
    });
  }
}
