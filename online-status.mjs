/**
 * 🟢 / 🔴 online dot before a player's number in the stats table.
 * Census `characters_online_status` answers many ids in one call
 * (online_status "0" = offline, anything else = the world id they are on).
 * Unknown (not fetched yet / Census down) = no dot: never claim "Offline" without data.
 */
export const ONLINE_TTL_MS = 60_000;

const state = new Map(); // cid -> { online: boolean, at: ms }

/** Parse a Census reply into Map cid -> boolean. Exported for tests. */
export function parseOnline(json) {
  const out = new Map();
  const list = (json && json.characters_online_status_list) || [];
  for (const r of list) {
    if (!r || !r.character_id) continue;
    out.set(String(r.character_id), String(r.online_status ?? "0") !== "0");
  }
  return out;
}

/** Inner HTML for the dot ("" when unknown). Exported for tests. */
export function dotHtml(online) {
  if (online === true) return `<span class="online-dot" title="Online" aria-label="Online">🟢</span>`;
  if (online === false) return `<span class="online-dot" title="Offline" aria-label="Offline">🔴</span>`;
  return "";
}

/** Placeholder span rendered with the row; filled from cache now and after each fetch. */
export function dotSlot(cid) {
  if (!cid) return "";
  const s = state.get(String(cid));
  return `<span class="online-slot" data-cid="${String(cid).replace(/[^0-9]/g, "")}">${s ? dotHtml(s.online) : ""}</span>`;
}

/**
 * Hidden trigger slot for a 🪦 row (rankings.mjs): the same
 * `.online-slot[data-cid]` contract refreshOnline() collects, but display:none
 * so no 🟢/🔴 dot ever appears in the Rankings table — paint() only uses it
 * to hide the 🪦 span when Census says online.
 */
export function graveSlot(cid) {
  if (!cid) return "";
  return `<span class="online-slot" data-cid="${String(cid).replace(/[^0-9]/g, "")}" style="display:none"></span>`;
}

/**
 * Hide/show the 🪦 spans in a slot's cell for its online state. Exported for
 * tests (only closest / querySelectorAll / style are used, so fakes work).
 * Only online === true hides: offline AND unknown leave the mark visible —
 * fail-closed, a missing Census answer must never clear a mark.
 */
export function syncGraveMark(slotEl, online) {
  if (!slotEl || typeof slotEl.closest !== "function") return;
  const cell = slotEl.closest("th, td") || slotEl.closest("tr");
  if (!cell || typeof cell.querySelectorAll !== "function") return;
  for (const g of cell.querySelectorAll(".auto-mark-inactive")) {
    if (g && g.style) g.style.display = online === true ? "none" : "";
  }
}

function paint(root) {
  for (const el of root.querySelectorAll(".online-slot[data-cid]")) {
    const s = state.get(el.dataset.cid);
    el.innerHTML = s ? dotHtml(s.online) : "";
    // 🪦 suppression (live-online): a grave span in this slot's cell hides
    // while its player is online (stale Census `times` can mark a live
    // player 🪦 — SuperMangoPumpkinPieQueen, 2026-11-18).
    syncGraveMark(el, s ? s.online : undefined);
  }
}

let inflight = null;
/** Fetch stale ids (≤100 per call) and repaint every slot under roots. */
export async function refreshOnline(censusBase, roots, fetchImpl = fetch) {
  roots = roots.filter(Boolean);
  const ids = new Set();
  for (const r of roots) for (const el of r.querySelectorAll(".online-slot[data-cid]")) if (el.dataset.cid) ids.add(el.dataset.cid);
  roots.forEach(paint);
  const now = Date.now();
  const stale = [...ids].filter((id) => !state.has(id) || now - state.get(id).at > ONLINE_TTL_MS);
  if (!stale.length || inflight) return;
  inflight = (async () => {
    for (let i = 0; i < stale.length; i += 100) {
      const chunk = stale.slice(i, i + 100);
      try {
        const res = await fetchImpl(`${censusBase}characters_online_status?character_id=${chunk.join(",")}&c:limit=${chunk.length}`);
        if (!res.ok) continue;
        const got = parseOnline(await res.json());
        const at = Date.now();
        for (const id of chunk) if (got.has(id)) state.set(id, { online: got.get(id), at });
      } catch { /* Census down: leave unknown */ }
    }
  })();
  try { await inflight; } finally { inflight = null; }
  roots.forEach(paint);
}
