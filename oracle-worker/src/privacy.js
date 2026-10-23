/**
 * Self-service removal (#61). A player proves the character is theirs with the
 * logout-only sign-in (PC, Genudine or Ceres; auth.js), then removes it from
 * PS2 Elite or shows it again. The refresh bots read GET /privacy/list (keyed)
 * and sync data/opt-out.json + data-ps/opt-out.json (scripts/sync-removals.mjs),
 * which deletes the cached copy and blanks the name in opponent lists.
 *
 *   GET  /privacy/me       Bearer -> { character, status: "removed" | "shown" }
 *   POST /privacy/remove   Bearer -> removes the signed-in character
 *   POST /privacy/restore  Bearer -> shows it again
 *   GET  /privacy/list     X-Oracle-Key -> every row (bots)
 *
 * Proof is the sign-in itself: only someone who can log the character out in
 * game gets a token. Rows keep the character id and name only.
 */
import { accountFromRequest, parseIdent } from "./auth.js";

export const REMOVAL_TABLE = `CREATE TABLE IF NOT EXISTS removal (
  ident TEXT PRIMARY KEY,   -- PC cid, or us-/eu-<cid> on PlayStation
  name TEXT NOT NULL,
  status TEXT NOT NULL,     -- removed | shown
  at INTEGER NOT NULL,      -- last change (unix s)
  proof TEXT NOT NULL       -- how ownership was proven
)`;

let tableReady = false;
async function ensureTable(db) {
  if (tableReady) return;
  await db.prepare(REMOVAL_TABLE).run();
  tableReady = true;
}

const day = (s) => new Date(s * 1000).toISOString().slice(0, 10);

export async function handlePrivacy(request, env, url, json, now = Math.floor(Date.now() / 1000), authed = () => false) {
  const db = env.DB;
  const ns = { "Cache-Control": "no-store" };
  await ensureTable(db);
  const p = url.pathname;

  if (p === "/privacy/list") {
    if (!authed(request, env)) return json({ error: "unauthorized" }, 401, ns);
    const rows = (await db.prepare("SELECT ident, name, status, at, proof FROM removal ORDER BY at").all()).results || [];
    return json({ removals: rows }, 200, ns);
  }

  const acct = await accountFromRequest(request, db);
  if (!acct) return json({ error: "not_signed_in" }, 401, ns);
  const id = parseIdent(acct.cid);
  if (!id) return json({ error: "bad_identity" }, 400, ns);
  const character = { name: acct.name, platform: id.platform, world: acct.world, faction: acct.faction };
  const row = async () => db.prepare("SELECT status, at FROM removal WHERE ident=?").bind(acct.cid).first();

  if (p === "/privacy/me") {
    const r = await row();
    return json({ character, status: r && r.status === "removed" ? "removed" : "shown", at: r ? r.at : null }, 200, ns);
  }
  if ((p === "/privacy/remove" || p === "/privacy/restore") && request.method === "POST") {
    const status = p === "/privacy/remove" ? "removed" : "shown";
    const proof = `sign-in by in-game logout (${id.platform === "pc" ? "PC" : id.platform === "us" ? "Genudine" : "Ceres"}), ${day(now)}`;
    await db.prepare(`INSERT INTO removal (ident, name, status, at, proof) VALUES (?,?,?,?,?)
      ON CONFLICT(ident) DO UPDATE SET name=excluded.name, status=excluded.status, at=excluded.at, proof=excluded.proof`)
      .bind(acct.cid, acct.name, status, now, proof).run();
    return json({ character, status, at: now }, 200, ns);
  }
  return json({ error: "not_found" }, 404, ns);
}
