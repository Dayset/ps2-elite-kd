// Public vote log (owner 2026-11-13: "confirm the vote was made publicly and not rewritten after the alert").
//
// What is committed, and how a voter checks it:
//   - At placement: hash = sha256("votelog/1|placed|<salt>|<JSON of id, cid, key, outcome, amount, fee, net,
//     potential, pct, progress, placed_ts>"). The salt is random per vote and only the voter sees it (/vote/me).
//   - At settlement: the same with kind "settled" (id, status, reward, settled_ts) and the same salt.
//   - Each UTC day's commitment hashes form a Merkle tree (leaves sorted; node = sha256(left + right) in hex,
//     an odd node pairs with itself). The day's root is sent to OpenTimestamps calendars, and the proof is
//     stored as a .ots file (/votelog/<day>.ots). Bitcoin confirms it later; `ots upgrade` completes it.
//   - Public: only hashes, roots and proofs. No character id, no amount, no outcome.
//   - Voter: recompute the hash from their own vote and salt, follow the Merkle path (/votelog/proof?hash=),
//     and check the root against the anchored .ots file.
// Anyone who can read the database can alter a vote row, but not a root already anchored on Bitcoin, so
// the altered record no longer matches the public tree.

export const CALENDARS = ["https://alice.btc.calendar.opentimestamps.org", "https://bob.btc.calendar.opentimestamps.org"];
// OpenTimestamps .ots header: magic bytes, major version 1, digest tag 0x08 (sha256). Then the 32-byte digest and the calendar's response.
const OTS_MAGIC = Uint8Array.from([0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00, 0x00, 0x50, 0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94, 0x01, 0x08]);

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));
export const sha256hex = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const pairHash = (a, b) => sha256hex(a + b);
export const utcDay = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);
export const newSalt = () => hex(crypto.getRandomValues(new Uint8Array(16)));

export const placedValues = (v) => [v.id, v.cid, v.key, v.outcome, v.amount, v.fee, v.net, v.potential, v.pct, v.progress, v.placed_ts];
export const settledValues = (v) => [v.id, v.status, v.reward, v.settled_ts];
export const commitHash = (kind, values, salt) => sha256hex(`votelog/1|${kind}|${salt}|${JSON.stringify(values)}`);

/** Merkle levels, leaves sorted first. levels[last][0] is the root. */
export async function merkleLevels(leaves) {
  let level = [...leaves].sort();
  const levels = [level];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(await pairHash(level[i], level[i + 1] ?? level[i]));
    level = next;
    levels.push(level);
  }
  return levels;
}
export async function merkleRoot(leaves) {
  if (!leaves.length) return null;
  const levels = await merkleLevels(leaves);
  return levels[levels.length - 1][0];
}
/** Siblings from leaf to root: [{h, side: "left" | "right"}] where side is the sibling's side. */
export async function merklePath(leaves, leaf) {
  const sorted = [...leaves].sort();
  let idx = sorted.indexOf(leaf);
  if (idx < 0) return null;
  const levels = await merkleLevels(sorted);
  const path = [];
  for (let l = 0; l < levels.length - 1; l++) {
    const L = levels[l];
    const sib = idx ^ 1;
    if (sib < L.length) path.push({ h: L[sib], side: sib < idx ? "left" : "right" });
    else path.push({ h: L[idx], side: "right" }); // odd node pairs with itself
    idx >>= 1;
  }
  return path;
}
export async function verifyPath(leaf, path, root) {
  let acc = leaf;
  for (const s of path) acc = s.side === "left" ? await pairHash(s.h, acc) : await pairHash(acc, s.h);
  return acc === root;
}

/** The .ots file for a root: header + root digest + the calendar's response (pending until Bitcoin confirms). */
export function otsFile(rootHex, calendarBody) {
  const body = new Uint8Array(calendarBody);
  const out = new Uint8Array(OTS_MAGIC.length + 32 + body.length);
  out.set(OTS_MAGIC, 0);
  out.set(unhex(rootHex), OTS_MAGIC.length);
  out.set(body, OTS_MAGIC.length + 32);
  return out;
}

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS vote_commit (vote_id TEXT NOT NULL, kind TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, day TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (vote_id, kind))",
  "CREATE INDEX IF NOT EXISTS vote_commit_day ON vote_commit (day)",
  "CREATE INDEX IF NOT EXISTS vote_commit_hash ON vote_commit (hash)",
  "CREATE TABLE IF NOT EXISTS vote_root (day TEXT PRIMARY KEY, root TEXT NOT NULL, leaves INTEGER NOT NULL, ots TEXT, ots_status TEXT NOT NULL, created_ts INTEGER NOT NULL)",
];
const ready = new WeakSet();
export async function ensureVotelog(db) {
  if (ready.has(db)) return;
  for (const sql of SCHEMA) await db.prepare(sql).run();
  ready.add(db);
}

/** Placement commit, written with the vote (handleVote). */
export async function commitPlaced(db, v, now) {
  const salt = newSalt();
  const hash = await commitHash("placed", placedValues(v), salt);
  await db.prepare("INSERT OR IGNORE INTO vote_commit (vote_id, kind, salt, hash, day, ts) VALUES (?,?,?,?,?,?)")
    .bind(v.id, "placed", salt, hash, utcDay(now), now).run();
}

/** Backfill any missing placement commit, and settlement commits (same salt as the placement). */
export async function commitMissing(db, now) {
  await ensureVotelog(db);
  const placed = (await db.prepare(`SELECT v.* FROM vote v LEFT JOIN vote_commit c ON c.vote_id = v.id AND c.kind = 'placed'
    WHERE c.vote_id IS NULL LIMIT 500`).all()).results || [];
  for (const v of placed) await commitPlaced(db, { ...v, placed_ts: v.placed_ts }, now);
  const settled = (await db.prepare(`SELECT v.id, v.status, v.reward, v.settled_ts, p.salt FROM vote v
    JOIN vote_commit p ON p.vote_id = v.id AND p.kind = 'placed'
    LEFT JOIN vote_commit s ON s.vote_id = v.id AND s.kind = 'settled'
    WHERE v.settled_ts IS NOT NULL AND s.vote_id IS NULL LIMIT 500`).all()).results || [];
  for (const v of settled) {
    const hash = await commitHash("settled", settledValues(v), v.salt);
    await db.prepare("INSERT OR IGNORE INTO vote_commit (vote_id, kind, salt, hash, day, ts) VALUES (?,?,?,?,?,?)")
      .bind(v.id, "settled", v.salt, hash, utcDay(now), now).run();
  }
  return { placed: placed.length, settled: settled.length };
}

async function stamp(rootHex) {
  for (const cal of CALENDARS) {
    try {
      const r = await fetch(`${cal}/digest`, {
        method: "POST", body: unhex(rootHex),
        headers: { "Content-Type": "application/octet-stream", Accept: "application/vnd.opentimestamps.v1" },
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) return new Uint8Array(await r.arrayBuffer());
    } catch {}
  }
  return null;
}
const b64 = (u8) => { let s = ""; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };

/**
 * Root and stamp each finished UTC day (10 min after midnight, so late commits are in). A day that failed to
 * stamp stays "pending-submit" and is retried next cycle.
 */
export async function rootDays(db, now) {
  await ensureVotelog(db);
  const cutoff = utcDay(now - 600);
  const days = (await db.prepare("SELECT DISTINCT day FROM vote_commit WHERE day < ? AND day NOT IN (SELECT day FROM vote_root WHERE ots_status != 'pending-submit') ORDER BY day").bind(cutoff).all()).results || [];
  let stamped = 0;
  for (const { day } of days) {
    const leaves = (await db.prepare("SELECT hash FROM vote_commit WHERE day = ?").bind(day).all()).results.map((r) => r.hash);
    const root = await merkleRoot(leaves);
    const body = await stamp(root);
    const ots = body ? b64(otsFile(root, body)) : null;
    await db.prepare("INSERT OR REPLACE INTO vote_root (day, root, leaves, ots, ots_status, created_ts) VALUES (?,?,?,?,?,?)")
      .bind(day, root, leaves.length, ots, body ? "pending" : "pending-submit", now).run();
    if (body) stamped++;
  }
  return { rooted: days.length, stamped };
}

/** Commit, root and stamp for the cron (index.js). */
export async function votelogTick(db, now) {
  return { ...(await commitMissing(db, now)), ...(await rootDays(db, now)) };
}

/** Each vote's commits for /vote/me: salt (voter only), hash, day, root, and the Merkle path once the day is rooted. */
export async function commitsFor(db, voteIds) {
  if (!voteIds.length) return {};
  await ensureVotelog(db);
  const marks = voteIds.map(() => "?").join(",");
  const rows = (await db.prepare(`SELECT vote_id, kind, salt, hash, day FROM vote_commit WHERE vote_id IN (${marks})`).bind(...voteIds).all()).results || [];
  const days = [...new Set(rows.map((r) => r.day))];
  const roots = {};
  const leavesByDay = {};
  for (const d of days) {
    const root = await db.prepare("SELECT root, ots_status FROM vote_root WHERE day = ?").bind(d).first();
    if (!root) continue;
    roots[d] = root;
    leavesByDay[d] = (await db.prepare("SELECT hash FROM vote_commit WHERE day = ?").bind(d).all()).results.map((r) => r.hash);
  }
  const out = {};
  for (const r of rows) {
    const root = roots[r.day] || null;
    const path = root ? await merklePath(leavesByDay[r.day], r.hash) : null;
    (out[r.vote_id] ||= {})[r.kind] = { hash: r.hash, salt: r.salt, day: r.day, root: root && root.root, ots_status: root && root.ots_status, path };
  }
  return out;
}

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", ...headers } });

/** Public endpoints: /votelog (days), /votelog/proof?hash= (path for a published hash), /votelog/<day>.ots (anchor). */
export async function handleVotelog(request, env, url) {
  const db = env.DB;
  if (request.method !== "GET") return json({ error: "method" }, 405);
  await ensureVotelog(db);
  if (url.pathname === "/votelog") {
    const rows = (await db.prepare("SELECT day, root, leaves, ots_status, created_ts FROM vote_root ORDER BY day DESC LIMIT 400").all()).results || [];
    return json({ days: rows }, 200, { "Cache-Control": "public, max-age=60" });
  }
  if (url.pathname === "/votelog/proof") {
    const hash = String(url.searchParams.get("hash") || "");
    if (!/^[0-9a-f]{64}$/.test(hash)) return json({ error: "bad_hash" }, 400);
    const c = await db.prepare("SELECT day, kind FROM vote_commit WHERE hash = ?").bind(hash).first();
    if (!c) return json({ error: "not_found" }, 404);
    const root = await db.prepare("SELECT root, leaves, ots_status FROM vote_root WHERE day = ?").bind(c.day).first();
    if (!root) return json({ day: c.day, kind: c.kind, rooted: false }, 200);
    const leaves = (await db.prepare("SELECT hash FROM vote_commit WHERE day = ?").bind(c.day).all()).results.map((r) => r.hash);
    const path = await merklePath(leaves, hash);
    return json({ day: c.day, kind: c.kind, rooted: true, root: root.root, ots_status: root.ots_status, path, ots_url: `/votelog/${c.day}.ots` }, 200, { "Cache-Control": "public, max-age=300" });
  }
  const m = url.pathname.match(/^\/votelog\/(\d{4}-\d{2}-\d{2})\.ots$/);
  if (m) {
    const row = await db.prepare("SELECT ots FROM vote_root WHERE day = ?").bind(m[1]).first();
    if (!row || !row.ots) return json({ error: "not_found" }, 404);
    const bytes = Uint8Array.from(atob(row.ots), (ch) => ch.charCodeAt(0));
    return new Response(bytes, { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${m[1]}.ots"`, "Access-Control-Allow-Origin": "*" } });
  }
  return json({ error: "not_found" }, 404);
}
