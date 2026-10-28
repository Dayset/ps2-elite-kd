/**
 * 🥊 PlayStation scrims: compact KILL / DEATH events and the Census URL that pages them.
 * The detector lives here too (added after the probe measurement). Pure module: browser + Node.
 */

/** Census characters_event page size (Census caps it at 1000). */
export const EVENT_PAGE = 1000;

/**
 * One Census URL for a page of a player's KILL + DEATH events, newest first.
 * base ends with "/get/<ns>:v2/". before / after are unix seconds (Census: timestamp < before, > after).
 */
export function eventsUrl(base, cid, { before = 0, after = 0, limit = EVENT_PAGE } = {}) {
  return `${base}characters_event/?character_id=${encodeURIComponent(cid)}&type=KILL,DEATH&c:limit=${limit}` +
    (before ? `&before=${Math.floor(before)}` : "") + (after ? `&after=${Math.floor(after)}` : "");
}

const n = (v) => Number(v) || 0;

/**
 * Census row → compact event [ts, kill(1|0), otherId, weaponId, headshot(1|0), zoneId, myLoadout, otherLoadout, vehicleId].
 * weaponId / vehicleId are the attacker's (mine on a kill, theirs on a death). Suicides keep otherId = own id.
 */
export function compactEvent(e, cid) {
  if (!e) return null;
  const me = String(cid);
  const kill = e.table_type === "kills" ? 1 : e.table_type === "deaths" ? 0 : String(e.attacker_character_id) === me ? 1 : 0;
  const other = String((kill ? e.character_id : e.attacker_character_id) || "0");
  return [
    n(e.timestamp), kill, other, n(e.attacker_weapon_id),
    e.is_headshot === "1" || e.is_headshot === 1 || e.is_headshot === true ? 1 : 0,
    n(e.zone_id),
    n(kill ? e.attacker_loadout_id : e.character_loadout_id),
    n(kill ? e.character_loadout_id : e.attacker_loadout_id),
    n(e.attacker_vehicle_id),
  ];
}

/** Dedupe key of a compact event (page edges overlap by one second). */
export const eventKey = (x) => `${x[0]}|${x[1]}|${x[2]}|${x[3]}|${x[6]}|${x[7]}`;

/**
 * What counts as a scrim (calibrated on the probe, see the doc comment of detectScrims):
 *  GAP        a run with one opponent breaks after this many seconds without an event with them;
 *             a silence this long in ALL events ends a session (the pipeline only cuts history there)
 *  MIN_EVENTS a 1v1 run needs at least this many kills + deaths with the one opponent
 *  MIN_FOCUS  share of all the player's kills + deaths inside the run's time that involve the opponent
 *  GROUP_*    small-group scrims: 2..GROUP_MAX opponents, each with GROUP_EACH+ events, GROUP_MIN in all,
 *             GROUP_FOCUS of everything meanwhile, and both sides scoring (the smaller of kills /
 *             deaths at least GROUP_BALANCE of the total): ordinary small fights on a quiet server
 *             often repeat the same few enemies, but rarely with nobody else around and both trading.
 * Probe 2026-10-28 (20 PS players, ~20k events each, scripts/ps-scrims.mjs --probe): looser group
 * rules (3+ events each, 60% focus) called most ordinary small fights scrims (176 of 209 for one
 * player); with these, the groups left are 1–2 hour sessions of 2–3 regulars with ≤ 10% others.
 */
export const SCRIM_RULE = Object.freeze({ GAP: 600, MIN_EVENTS: 10, MIN_FOCUS: 0.75, GROUP_EACH: 5, GROUP_MIN: 20, GROUP_MAX: 4, GROUP_FOCUS: 0.85, GROUP_BALANCE: 0.25 });

/**
 * Owner 2026-10-28: only infantry weapons + knives count as scrims. Categories are
 * Census item_category names (assets/weapons/catalog.json, built weekly by
 * scripts/build-weapon-catalog.mjs). Everything else is out: vehicle weapons and
 * gunner seats, MAX weapons, mines / C-4 / grenades ("Explosive", "Grenade"),
 * MANA turrets ("Infantry Weapons" is the turret category, not a firearm),
 * abilities, gear, and anything with no category. A weapon id the catalog does
 * not know is out of new detections (strict) but kept in stored rows (below).
 */
export const INFANTRY_WEAPON_CATEGORIES = Object.freeze(new Set([
  "Knife", "Pistol", "Carbine", "Assault Rifle", "SMG", "LMG", "Shotgun",
  "Sniper Rifle", "Scout Rifle", "Rocket Launcher", "Heavy Weapon",
  "Anti-Materiel Rifle", "Crossbow", "Heavy Crossbow",
  "Amphibious Rifle", "Amphibious Sidearm", "Hybrid Rifle",
]));

/** Category of a weapon id in a catalog items map ({ id: [name, category, ...] }). */
export const weaponCategory = (items, id) => { const e = items && items[String(id)]; return e ? e[1] : null; };

/** True when a category is an infantry weapon or knife. */
export const isScrimWeaponCategory = (cat) => INFANTRY_WEAPON_CATEGORIES.has(cat || "");

/**
 * True when a compact event may count toward a scrim: the attacker was on foot
 * (attacker_vehicle_id == 0, index 8) and, when a catalog lookup is given, the
 * attacker's weapon is an infantry weapon or knife. Without a lookup only the
 * vehicle check applies (callers that have the catalog must pass one).
 */
export function isScrimEvent(x, catOf = null) {
  if (!x || x[8]) return false;
  if (!catOf) return true;
  return isScrimWeaponCategory(catOf(x[3]));
}

/**
 * True when a stored scrim row's top weapons may stay: BOTH sides must have a
 * weapon — a 0 side renders as "-" (one-sided suicide/MAX leftover, not a
 * fight) and is dropped whatever the catalog state — and each side must be
 * infantry/knife or unknown (an id the catalog does not know is kept; history
 * is not nuked on missing catalog data — only known-bad rows are dropped).
 */
export function isScrimRowWeaponsOk(row, catOf = null) {
  if (!row || !Array.isArray(row.w)) return true;
  if (row.w[0] === 0 || row.w[1] === 0) return false;
  if (!catOf) return true;
  return row.w.every((w) => {
    if (!w) return true;
    const c = catOf(w);
    return c == null || isScrimWeaponCategory(c);
  });
}

const topOf = (counts) => {
  let best = 0, id = 0;
  for (const [k, v] of counts) if (v > best) { best = v; id = k; }
  return id;
};

/** Index of the first event with ts >= t in an ascending list. */
function lowerBound(asc, t) {
  let lo = 0, hi = asc.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (asc[m][0] < t) lo = m + 1; else hi = m; }
  return lo;
}

function summarize(evs, asc, me) {
  const t0 = evs[0][0], t1 = evs[evs.length - 1][0];
  const span = lowerBound(asc, t1 + 1) - lowerBound(asc, t0);
  const opp = new Map();
  const myW = new Map(), theirW = new Map(), zones = new Map();
  for (const x of evs) {
    const o = opp.get(x[2]) || { id: x[2], k: 0, d: 0 };
    if (x[1]) { o.k++; if (x[3]) myW.set(x[3], (myW.get(x[3]) || 0) + 1); }
    else { o.d++; if (x[3]) theirW.set(x[3], (theirW.get(x[3]) || 0) + 1); }
    opp.set(x[2], o);
    zones.set(x[5], (zones.get(x[5]) || 0) + 1);
  }
  const k = evs.reduce((s, x) => s + x[1], 0);
  return {
    t0, t1, k, d: evs.length - k, n: span - evs.length, focus: evs.length / Math.max(1, span),
    opp: [...opp.values()].sort((a, b) => b.k + b.d - (a.k + a.d)),
    z: topOf(zones), myW: topOf(myW), theirW: topOf(theirW), me: String(me),
  };
}

/**
 * Scrims in one player's KILL / DEATH events (compact, any order) → newest first:
 *   { kind: "1v1" | "group", t0, t1, k, d, n, focus, opp: [{ id, k, d }], z, myW, theirW }
 * k / d are the player's kills on / deaths to the opponent(s); n = kills + deaths with anyone
 * else inside the scrim's time; z = continent; myW / theirW = most used weapon on each side.
 *
 * Runs = events with one opponent, no GAP-long hole with them. Runs of 3+ events that overlap
 * in time are one fight. A fight where one opponent has 80%+ of the events is a 1v1 if that run
 * has 10+ events and that opponent is 75%+ of everything the player did meanwhile (focus).
 * Otherwise 2–4 opponents with 5+ events each, 20+ in all, 85% focus and both sides scoring are
 * a group scrim; failing that, the biggest run can still be a 1v1.
 * Suicides (no other player, or the player himself) are ignored.
 */
export function detectScrims(events, cid, rule = SCRIM_RULE, catOf = null) {
  const me = String(cid);
  const asc = (events || []).filter((x) => x && x[2] && x[2] !== "0" && x[2] !== me).slice().sort((a, b) => a[0] - b[0]);
  if (!asc.length) return [];
  // Runs are built from eligible events only (infantry/knife, on foot), but focus
  // still counts everything the player did meanwhile (asc): a run that is half
  // Claymore kills is not a scrim either, it just never reaches focus.
  const elig = asc.filter((x) => isScrimEvent(x, catOf));
  const open = new Map();
  const runs = [];
  for (const x of elig) {
    const r = open.get(x[2]);
    if (r && x[0] - r.last <= rule.GAP) { r.evs.push(x); r.last = x[0]; continue; }
    if (r) runs.push(r);
    open.set(x[2], { id: x[2], evs: [x], last: x[0] });
  }
  runs.push(...open.values());
  // Runs that overlap in time form one fight; a fight is a 1v1 when one opponent has 80%+ of it.
  const cands = runs.filter((r) => r.evs.length >= 3)
    .map((r) => ({ r, a: r.evs[0][0], b: r.evs[r.evs.length - 1][0] }))
    .sort((x, y) => x.a - y.a);
  const fights = [];
  for (const c of cands) {
    const f = fights[fights.length - 1];
    if (f && c.a <= f.b) { f.runs.push(c.r); f.b = Math.max(f.b, c.b); } else fights.push({ runs: [c.r], b: c.b });
  }
  const out = [];
  for (const f of fights) {
    const total = f.runs.reduce((s, r) => s + r.evs.length, 0);
    const top = f.runs.reduce((m, r) => (r.evs.length > m.evs.length ? r : m), f.runs[0]);
    const members = f.runs.filter((r) => r.evs.length >= rule.GROUP_EACH);
    const inGroup = members.reduce((s, r) => s + r.evs.length, 0);
    const groupOk = members.length >= 2 && members.length <= rule.GROUP_MAX && inGroup >= rule.GROUP_MIN && top.evs.length < 0.8 * total;
    if (groupOk) {
      const s = summarize(members.flatMap((r) => r.evs).sort((a, b) => a[0] - b[0]), asc, me);
      if (s.focus >= rule.GROUP_FOCUS && Math.min(s.k, s.d) >= rule.GROUP_BALANCE * (s.k + s.d)) { out.push({ kind: "group", ...s }); continue; }
    }
    if (top.evs.length < rule.MIN_EVENTS) continue;
    const s = summarize(top.evs, asc, me);
    if (s.focus >= rule.MIN_FOCUS) out.push({ kind: "1v1", ...s });
  }
  return out.sort((a, b) => b.t1 - a.t1);
}

/**
 * History is only ever cut at a silence longer than GAP (no kill or death with anyone), so no
 * scrim is split between two pipeline rounds. asc = events oldest first.
 * oldOpen: older history may continue (not the start of the account); newOpen: the player may
 * still be playing (newest event less than GAP ago). → { lo, hi }: asc[lo..hi) is final, or null
 * when nothing can be cut yet.
 */
export function finalWindow(asc, { oldOpen, newOpen, gap = SCRIM_RULE.GAP }) {
  const len = asc.length;
  if (!len) return null;
  let lo = 0, hi = len;
  if (oldOpen) {
    lo = -1;
    for (let i = 0; i + 1 < len; i++) if (asc[i + 1][0] - asc[i][0] > gap) { lo = i + 1; break; }
    if (lo < 0) return null;
  }
  if (newOpen) {
    hi = -1;
    for (let i = len - 2; i >= 0; i--) if (asc[i + 1][0] - asc[i][0] > gap) { hi = i + 1; break; }
    if (hi < 0) return null;
  }
  return lo <= hi ? { lo, hi } : null;
}

/** Stored scrim (one player's file): { t0, t1, o: [[key, name, k, d]…], k, d, n, z, w: [mine, theirs], m? } (m = 1: copied from the opponent's history). */
export function scrimRow(s, oppOf) {
  return {
    t0: s.t0, t1: s.t1,
    o: s.opp.map((x) => { const r = oppOf(x.id) || {}; return [r.key || "", r.name || "", x.k, x.d]; }),
    k: s.k, d: s.d, n: s.n, z: s.z, w: [s.myW || 0, s.theirW || 0],
  };
}

/** The same scrim from the other side (1v1 only): kills and deaths swap, weapons swap, n unknown. */
export function mirrorRow(row, me) {
  const [, , k, d] = row.o[0];
  return { t0: row.t0, t1: row.t1, o: [[me.key, me.name, d, k]], k: row.d, d: row.k, n: null, z: row.z, w: [row.w[1], row.w[0]], m: 1 };
}

const oppSet = (r) => r.o.map((x) => x[0] || x[1]).sort().join(",");

/**
 * Add rows to a player's list. A row of the same opponent(s) that overlaps in time (GAP slack)
 * is the same scrim: the one with more kills + deaths stays, the player's own copy on a tie.
 * Returns the number of rows that changed. Newest first.
 */
export function upsertScrims(list, rows, gap = SCRIM_RULE.GAP) {
  let changed = 0;
  for (const r of rows) {
    const set = oppSet(r);
    const i = list.findIndex((x) => oppSet(x) === set && x.t0 <= r.t1 + gap && r.t0 <= x.t1 + gap);
    if (i < 0) { list.push(r); changed++; continue; }
    const x = list[i];
    const better = r.k + r.d > x.k + x.d || (r.k + r.d === x.k + x.d && x.m && !r.m);
    if (better) { list[i] = r; changed++; }
  }
  list.sort((a, b) => b.t1 - a.t1);
  return changed;
}

/** "won" | "lost" | "draw" from the side of the player whose k / d these are. */
export const scrimResult = (s) => (s.k > s.d ? "won" : s.k < s.d ? "lost" : "draw");
/** Almost no kills back (2% or less of 20+): the PS scrim rule's "0 deaths in return" pattern. */
export const isOneSided = (s) => Math.max(s.k, s.d) >= 20 && Math.min(s.k, s.d) <= 0.02 * Math.max(s.k, s.d);
/** Length in whole minutes (at least 1). */
export const scrimMinutes = (s) => Math.max(1, Math.round((s.t1 - s.t0) / 60));

/** Merge compact event lists, drop duplicates, newest first. */
export function mergeEvents(...lists) {
  const seen = new Set();
  const out = [];
  for (const l of lists) for (const x of l || []) {
    if (!x) continue;
    const k = eventKey(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  out.sort((a, b) => b[0] - a[0]);
  return out;
}
