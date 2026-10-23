/**
 * 🚫 Removal list: characters whose players asked not to be shown here
 * (privacy.html, issue form .github/ISSUE_TEMPLATE/remove-character.yml, #61).
 * Owner-edited. One file per room: data/opt-out.json (PC), data-ps/opt-out.json (PS).
 *
 *   { "players": { "<id>": { "name": "[TAG] Name", "at": "YYYY-MM-DD", "proof": "oracle sign-in 2026-10-23" } } }
 *
 * "proof" is required: how the requester proved the character is theirs (PC:
 * oracle sign-in; PS: logout at a given time, checked on Census). Entries
 * without it are ignored everywhere and fail test/opt-out.test.mjs.
 *
 * <id> is the Census character id (PC), "us-<cid>" / "eu-<cid>" (PS: ids are
 * per server), or a plain name when the id is not known yet.
 *
 * Effects (scripts/purge-removed.mjs, refresh-cache.mjs, refresh-ps.mjs, app.js):
 * the bots never fetch or store the character, their cached file is deleted,
 * their name is blanked in other players' opponent lists, and the page shows
 * "removed at the player's request" instead of stats, also for a live lookup.
 * DOM-free; shared by the page, the bots and the tests.
 */

/** Opponent-list placeholder for a removed character's name. */
export const REMOVED_NAME = "—";

/** Same slug as hidden.mjs / app.js ("[TAG] Name" → "name"). */
export function removedKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/^\[.*?\]\s*/, "")
    .replace(/[^a-z0-9]+/g, "");
}

const PS_ID = /^(us|eu)-(\d{5,25})$/i;
const CID = /^\d{5,25}$/;
const SERVER = { us: "us", eu: "eu", genudine: "us", ceres: "eu", ps2ps4us: "us", ps2ps4eu: "eu" };

/** "us" / "eu" for any PS server spelling (key, namespace, name); "" otherwise. */
export function serverKey(server) {
  return SERVER[String(server || "").trim().toLowerCase()] || "";
}

/**
 * Parse an opt-out.json payload.
 * @returns {{ size:number, entries:object[],
 *   match:(q:{cid?:string, server?:string, slug?:string, name?:string})=>null|object,
 *   blankOpponents:(rows:any[], server?:string)=>number }}
 */
export function removedList(json) {
  const players = json && typeof json === "object" && json.players && typeof json.players === "object" ? json.players : {};
  const entries = [];
  const byId = new Map(); // "cid" (PC) or "us-cid" / "eu-cid" (PS)
  const bySlug = new Map(); // slug -> entries[]
  for (const [k, v] of Object.entries(players)) {
    const id = String(k).trim();
    if (!id || id.startsWith("_")) continue;
    // Foolproof (owner 2026-10-23): no recorded ownership proof, no removal.
    if (!v || !String(v.proof || "").trim()) continue;
    const ps = PS_ID.exec(id);
    const server = ps ? ps[1].toLowerCase() : null;
    const cid = ps ? ps[2] : CID.test(id) ? id : "";
    const name = String((v && v.name) || (cid ? "" : id));
    const e = { id, cid, server, name, slug: removedKey(name), at: String((v && v.at) || "") };
    entries.push(e);
    if (cid) byId.set(server ? `${server}-${cid}` : cid, e);
    if (e.slug) {
      if (!bySlug.has(e.slug)) bySlug.set(e.slug, []);
      bySlug.get(e.slug).push(e);
    }
  }
  const serverOk = (e, srv) => !e.server || srv === e.server;

  /**
   * Is this character on the list? With a character id, entries that carry an
   * id decide by id only (a later namesake is not caught by an old name).
   * PS entries match a name only when the server is known and equal.
   */
  function match({ cid = "", server = "", slug = "", name = "" } = {}) {
    if (!entries.length) return null;
    const c = String(cid || "");
    const srv = serverKey(server);
    if (c) {
      const hit = byId.get(srv ? `${srv}-${c}` : c) || (!srv && byId.get(c));
      if (hit) return hit;
    }
    for (const key of new Set([String(slug || ""), removedKey(slug), removedKey(name)])) {
      if (!key) continue;
      for (const e of bySlug.get(key) || []) {
        if (c && e.cid) continue;
        if (serverOk(e, srv)) return e;
      }
    }
    return null;
  }

  /** Blank removed names in an opponent list (same server only). Returns the count. */
  function blankOpponents(rows, server = "") {
    if (!Array.isArray(rows) || !bySlug.size) return 0;
    const srv = serverKey(server);
    let n = 0;
    for (const r of rows) {
      if (!r || typeof r.name !== "string" || r.name === REMOVED_NAME) continue;
      const hits = bySlug.get(removedKey(r.name));
      if (hits && hits.some((e) => serverOk(e, srv))) {
        r.name = REMOVED_NAME;
        n++;
      }
    }
    return n;
  }

  return { size: entries.length, entries, match, blankOpponents };
}
