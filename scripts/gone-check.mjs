/**
 * 🪦→🚫 Mirror rule (#61, owner 2026-10-23): when a character no longer exists
 * in the game (deleted by the player, or by Daybreak on an account deletion),
 * our copy goes too, automatically.
 *
 * Safe test: a lookup BY CHARACTER ID (never by name: a rename also makes a
 * name vanish) that Census answers normally with zero characters, seen twice
 * at least GONE_GAP_MS apart. Errors, timeouts and odd answers never count.
 *  - gone   → added to the room's opt-out.json with source "deleted-in-game"
 *             (purge-removed.mjs then deletes the file and every record);
 *  - renamed → the old copy is dropped from the index (its file is deleted)
 *             and the new name is returned so the caller can queue it.
 * Only players the refresh already marked "notfound" are checked, a few per run.
 */
export const GONE_GAP_MS = 20 * 3600 * 1000;
export const GONE_PER_RUN = 10;

/** Pure: read one Census answer. -> "gone" | { renamed: newName } | "exists" | null (no verdict). */
export function readIdAnswer(json, cid, oldName = "") {
  if (!json || typeof json !== "object" || json.error || json.errorCode || !Array.isArray(json.character_list)) return null;
  if (json.returned != null && +json.returned !== json.character_list.length) return null;
  const c = json.character_list.find((x) => x && String(x.character_id) === String(cid));
  if (!json.character_list.length) return "gone";
  if (!c) return null;
  const name = c.name && c.name.first;
  const bare = (s) => String(s || "").replace(/^\[[^\]]*\]\s*/, "").toLowerCase();
  return name && bare(name) !== bare(oldName) ? { renamed: name } : "exists";
}

/** Pure: next strike state. -> { strikes, confirmed } */
export function nextStrike(prev, now = Date.now(), gap = GONE_GAP_MS) {
  const list = (Array.isArray(prev) ? prev : []).filter((t) => Number.isFinite(+t)).map(Number);
  const strikes = [...list, now].slice(-3);
  const confirmed = strikes.length >= 2 && strikes[strikes.length - 1] - strikes[0] >= gap;
  return { strikes, confirmed };
}

/**
 * Check candidates. Each candidate: { key, cid, name, state } where state is the
 * refresh-state entry (mutated: goneStrikes / renamedTo). getJson(url) fetches.
 * -> { gone: [{key, cid, name, first, last}], renamed: [{key, cid, name, to}], checked }
 */
export async function goneCheck(candidates, { base, getJson, now = Date.now(), max = GONE_PER_RUN, log = () => {} } = {}) {
  const out = { gone: [], renamed: [], checked: 0 };
  for (const c of candidates.slice(0, max)) {
    if (!c || !c.cid || !c.state) continue;
    let ans = null;
    try {
      ans = readIdAnswer(await getJson(`${base}character?character_id=${encodeURIComponent(c.cid)}&c:show=character_id,name`), c.cid, c.name);
    } catch {
      ans = null;
    }
    out.checked++;
    if (ans === "gone") {
      const s = nextStrike(c.state.goneStrikes, now);
      c.state.goneStrikes = s.strikes;
      if (s.confirmed) out.gone.push({ key: c.key, cid: c.cid, name: c.name, first: s.strikes[0], last: s.strikes[s.strikes.length - 1] });
      else log(`  [gone?] ${c.name}: Census has no character ${c.cid} (strike ${s.strikes.length}, confirm after 20 h)`);
    } else if (ans && ans.renamed) {
      delete c.state.goneStrikes;
      c.state.renamedTo = ans.renamed;
      out.renamed.push({ key: c.key, cid: c.cid, name: c.name, to: ans.renamed });
    } else if (ans === "exists") {
      delete c.state.goneStrikes; // still there: a name-lookup hiccup, not a deletion
    }
  }
  return out;
}

/** Opt-out entry for a character deleted in the game. */
export function goneEntry(g) {
  const d = (ms) => new Date(ms).toISOString().slice(0, 10);
  return {
    name: g.name,
    at: d(g.last),
    proof: `deleted in game: Census has no character with this id (checked ${d(g.first)} and ${d(g.last)})`,
    source: "deleted-in-game",
  };
}
