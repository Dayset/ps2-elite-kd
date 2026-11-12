/**
 * The Ideal ADAD calculator (a folded section of weapon-compare.html since 2026-11-09; weapon-adad.html only
 * forwards there) — Iridar's CoF stance rules as a
 * calculator: fire the first n shots standing still, then strafe, because once
 * the cone reaches the moving minimum, moving costs nothing.
 * Free still shots = floor((moving min - still min) / bloom).
 *
 * Two data versions, one formula:
 * - current (default): per-weapon CoF values from the Census snapshot in
 *   assets/weapons/recoil.json (its savedAt date is shown on the page), matched
 *   to the 194 Toolbox rows by assets/weapons/adad-item-ids.json.
 * - historical: Iridar's Toolbox v6h, Stats sheet dated 2018-08-19
 *   (assets/weapons/adad-2018.json), kept so the old stats and mechanics stay
 *   findable. The table, the worked burst and the preloaded examples follow
 *   the version switch; every parameter stays editable, so today's numbers can
 *   always be typed in by hand.
 * Pure maths is exported for tests; the DOM wiring runs at the bottom.
 */
import { t as tr, currentLang, ready } from "./i18n.mjs";
import { ATTACHMENTS, SLOTS, canon, slotOf } from "./weapon-sim.mjs?v=20261112-pellet1";

export const RECOVERY_RATE = 20; // deg/s: CoF recovery after one refire of delay
export const SHOTS = 10;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = (v, d = 0) => Number(v).toLocaleString(currentLang(), { maximumFractionDigits: d, minimumFractionDigits: d });

/** 3-decimal display, like the artifact's fmt; null/NaN -> an em dash. */
export function fmt(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return (Math.round(x * 1000) / 1000).toString();
}

/** Milliseconds -> "91 ms" / "1.21 s". */
export function fmtT(ms) {
  if (ms >= 1000) return (ms / 1000).toFixed(2).replace(/0$/, "") + " s";
  return Math.round(ms) + " ms";
}

/** Free still shots: floor((move-still)/bloom); null = not computable, Infinity = bloom 0 (no bloom). */
export function nStill(still, move, bloom) {
  if (still === null || move === null || bloom === null || still === undefined || move === undefined || bloom === undefined) return null;
  if (bloom === 0) return Infinity;
  const d = (move - still) / bloom;
  if (d <= 0) return 0;
  return Math.floor(d + 1e-9);
}

/** CoF after each shot of the ideal rhythm: still until the free shots run out, then moving. */
export function simulate(still, move, bloom, nFree, shots) {
  let cof = still;
  const out = [];
  let moving = false;
  for (let i = 1; i <= shots; i++) {
    if (!moving && nFree !== Infinity && i > nFree) { moving = true; if (cof < move) cof = move; }
    cof += bloom;
    out.push({ shot: i, moving, cof });
  }
  return out;
}

/** CoF after each shot when moving (or standing still) the whole burst. */
export function simulatePlain(start, bloom, shots) {
  let cof = start;
  const out = [];
  for (let i = 1; i <= shots; i++) { cof += bloom; out.push(cof); }
  return out;
}

/** Reset timing after the burst: recovery starts after one refire, then the cone
 *  shrinks at 20 deg/s down to the still minimum. A known still maximum clamps
 *  the bloomed cone instantly before recovery. Null when refire is unknown. */
export function resetInfo({ still, endCof, maxCof, refireMs }) {
  if (still === null || endCof === null || refireMs === null || refireMs === undefined || !(refireMs > 0)) return null;
  const clamped = maxCof !== null && maxCof !== undefined && endCof > maxCof;
  const from = clamped ? maxCof : endCof;
  const recoverMs = Math.max(0, (from - still) / RECOVERY_RATE) * 1000;
  return { refireMs, recoverMs, totalMs: refireMs + recoverMs, clamped, from };
}

/** One stance+posture pair from a normalized weapon record:
 *  { still, move, bloom, max, rpm, refireMs }. The 2018 rows carry [still, move]
 *  pairs and no max (the Toolbox stores no maximum CoF); current rows carry
 *  [still, move, max] and a Census refireMs. A 2018 row's stored rf is the
 *  Toolbox's rounded refire and is not used: like the artifact, refire is
 *  derived from RPM (60000 / RPM). */
export function paramsFor(row, stance, posture) {
  if (!row) return null;
  const pair = stance === "ads" ? (posture === "stand" ? row.as : row.ac) : (posture === "stand" ? row.hs : row.hc);
  const bloom = stance === "ads" ? row.ba : row.bh;
  if (!pair) return null;
  return {
    still: pair[0] ?? null, move: pair[1] ?? null, max: pair[2] ?? null,
    bloom: bloom ?? null, rpm: row.rpm ?? null,
    refireMs: row.refireMs ?? (row.rpm ? 60000 / row.rpm : null),
  };
}

/** Current-version record for one 2018 row, derived from the bundled Census
 *  snapshot (recoil.json). Returns the row in the 2018 shape — [still, move,
 *  max] pairs plus refireMs — or null when the item has no usable fire-mode
 *  data (the table then shows dashes, the artifact's own convention).
 *  Stances: still = Standing (0) / Crouching (1), moving = Running (2) /
 *  CrouchWalking (5); bloom = the fire mode's cof_recoil. Every fm2 entry in
 *  the snapshot carries cof_recoil (0 where the weapon does not bloom, e.g.
 *  the Jackhammer); the ?? 0 below only guards older snapshots. */
export function deriveCurrent(row2018, recoil, itemId) {
  if (!row2018 || !itemId || !recoil || !recoil.weapons) return null;
  const w = recoil.weapons[String(itemId)];
  if (!w) return null;
  const [hipFm, hipPsg, , adsFm, adsPsg] = w;
  const mode = (fm, psg) => {
    const f = recoil.fm2?.[String(fm)];
    const g = recoil.groups?.[String(psg)];
    if (!f || !Array.isArray(g)) return null;
    const byState = new Map(g.map((r) => [r.player_state_id, r]));
    const stand = byState.get(0), crouch = byState.get(1), run = byState.get(2), crouchWalk = byState.get(5);
    if (!stand || !run) return null;
    return {
      stand: [stand.cof_min ?? null, run.cof_min ?? null, stand.cof_max ?? null],
      crouch: [crouch?.cof_min ?? null, crouchWalk?.cof_min ?? null, crouch?.cof_max ?? null],
      bloom: f.cof_recoil ?? 0,
      refireMs: f.fire_refire_ms ?? null,
    };
  };
  const hip = mode(hipFm, hipPsg), ads = mode(adsFm, adsPsg);
  if (!hip && !ads) return null;
  const refireMs = ads?.refireMs ?? hip?.refireMs ?? null;
  return {
    n: row2018.n, f: row2018.f, c: row2018.c,
    rpm: refireMs ? Math.round(60000 / refireMs) : row2018.rpm, refireMs,
    hc: hip?.crouch ?? [null, null, null], hs: hip?.stand ?? [null, null, null], bh: hip?.bloom ?? null,
    ac: ads?.crouch ?? [null, null, null], as: ads?.stand ?? [null, null, null], ba: ads?.bloom ?? null,
  };
}

/** Free-shot cell for the table: a count, "no bloom" for bloom 0, a dash when not computable. */
export function nCell(still, move, bloom) {
  const n = nStill(still, move, bloom);
  if (n === null) return "—";
  if (n === Infinity) return tr("adad.free.nobloom", "no bloom");
  return String(n);
}

/* ---------- attachments that change the cone or the bloom ---------- */
/** Every attachment in the site's weapon model (weapon-sim.mjs ATTACHMENTS, the
 *  single source for the factors) that changes the cone or the bloom: Laser
 *  Sight, Hybrid Laser and Compensator (hip cone), Heavy Magazine (hip cone),
 *  Heavy Barrel (ADS bloom), Short Barrel (hip bloom), Stabilizing Rotor (both
 *  blooms) and Weighted Receiver (ADS cone 0). Census names that weapon-sim
 *  treats as the same part (Muzzle Brake = Compensator ...) count as it. */
const ADAD_FX = ["hipMinCof", "hipBloom", "adsBloom", "adsZeroCof"];
export const ATT_KEYS = ["Laser Sight", "Compensator", "Heavy Barrel", "Short Barrel", "Hybrid Laser", "Weighted Receiver", "Stabilizing Rotor", "Heavy Magazine"];
export const ATT_EFFECTS = Object.freeze(Object.fromEntries(ATT_KEYS.map((k) => [k, Object.fromEntries(ADAD_FX.filter((fx) => ATTACHMENTS[k]?.[fx] !== undefined).map((fx) => [fx, ATTACHMENTS[k][fx]]))])));
export const ATT_SLOTS = SLOTS; // barrel | rail | ammo: one part per slot
export const attSlot = (name) => slotOf(canon(name));

/** Which of those attachments the loaded gun can mount, from the bundled
 *  Census att data (recoil.json att[itemId] -> indices into atts, each
 *  [name, descIndex]). Returned in ATT_KEYS order. [] when there is no att
 *  data (recoil not loaded, or a variant row with no Census item). */
export function attTogglesFor(itemId, recoil) {
  if (!recoil || !itemId || !recoil.att || !recoil.atts) return [];
  const names = new Set((recoil.att[String(itemId)] || []).map((i) => recoil.atts[i]?.[0]).filter(Boolean).map(canon));
  return ATT_KEYS.filter((k) => names.has(k));
}

/** The loadout after choosing `name` in `slot` ("" = none): a slot holds one
 *  part (a Heavy Barrel and a Short Barrel are both barrel parts, so they
 *  cannot be fitted together; a barrel part and a rail part can). Pure: a new Set. */
export function chooseAtt(active, slot, name) {
  const next = new Set([...(active || [])].filter((n) => attSlot(n) !== slot));
  if (name) next.add(name);
  return next;
}

/** Modified (still, move, bloom) for one stance under the active
 *  attachments. p = { still, move, bloom } (nulls pass through unchanged);
 *  active = a Set of attachment names. Hip: the cone minima and the bloom
 *  scale; ADS: the bloom scales, and a Weighted Receiver sets both minima to 0;
 *  factors multiply when two parts apply. Pure. */
export function applyAttachments(p, stance, active) {
  if (!p) return p;
  let { still, move, bloom } = p;
  const fx = (key) => [...(active || [])].reduce((m, n) => m * (ATT_EFFECTS[n]?.[key] ?? 1), 1);
  const has = (key) => [...(active || [])].some((n) => ATT_EFFECTS[n]?.[key]);
  const mul = (v, f) => (v === null || v === undefined ? v : v * f);
  if (stance === "hip") {
    const minMul = fx("hipMinCof");
    still = mul(still, minMul); move = mul(move, minMul); bloom = mul(bloom, fx("hipBloom"));
  } else if (stance === "ads") {
    bloom = mul(bloom, fx("adsBloom"));
    if (has("adsZeroCof")) { still = mul(still, 0); move = mul(move, 0); }
  }
  return { ...p, still, move, bloom };
}

// The three finals. The artifact hardcodes .win on the ideal-rhythm final —
// it marks the recommended rhythm, not the lowest end CoF (for the default
// Naginata the ideal 0.76° is highlighted even though still-throughout ends
// lower at 0.75°). Kept exactly as built.
export function finalsHtml(fA, fB, fC, t) {
  const final = (label, v, win) => `<div class="final${win ? " win" : ""}"><div class="t">${label}</div><div class="v">${fmt(v)}°</div></div>`;
  return final(t.ideal, fA, true) + final(t.still, fB, false) + final(t.moving, fC, false);
}

/* ---------- "What it costs": the same burst counted in hits ---------- */
export const TARGET_D = 0.5; // m: the torso circle's diameter
export const COST_DISTANCES = [35, 60]; // m: the two distances the panel shows

/** Spread diameter in metres for a full cone angle CoF at distance d. */
export function spreadD(cofDeg, distM) {
  return 2 * distM * Math.tan((cofDeg * Math.PI) / 360);
}

/** Hit chance of one shot fired from cone C at distance d, against a 0.5 m
 *  torso circle: the share of the spread disk the target covers. */
export function hitChance(cofDeg, distM) {
  const d = spreadD(cofDeg, distM);
  if (!(d > 0)) return 1;
  return Math.min(1, (TARGET_D / d) ** 2);
}

/** Average hit chance of a burst. Rhythm: 'ideal' (the first nFree shots
 *  standing still, then the cone rises to the moving minimum), 'moving'
 *  (strafe from shot 1), 'still' (stand still throughout). Shot i fires
 *  from the cone after i-1 shots of bloom. */
export function burstHitAvg(still, move, bloom, nFree, shots, distM, rhythm) {
  let cof = rhythm === "moving" ? move : still;
  let sum = 0;
  for (let i = 1; i <= shots; i++) {
    if (rhythm === "ideal" && nFree !== Infinity && i > nFree && cof < move) cof = move;
    sum += hitChance(cof, distM);
    cof += bloom;
  }
  return sum / shots;
}

/** Miss and DPS-loss summary for both cost distances. lossMoving = 1 -
 *  (moving hits / ideal hits); lossIdeal = 1 - (ideal hits / still hits).
 *  Damage is proportional to hits at the same RPM, so the loss is a DPS
 *  loss too. Null when the denominator is 0 (a gun that hits nothing — no
 *  such gun, but the guard keeps the panel from printing NaN). */
export function costSummary(still, move, bloom, nFree, shots) {
  return COST_DISTANCES.map((dist) => {
    const ideal = burstHitAvg(still, move, bloom, nFree, shots, dist, "ideal");
    const moving = burstHitAvg(still, move, bloom, nFree, shots, dist, "moving");
    const stl = burstHitAvg(still, move, bloom, nFree, shots, dist, "still");
    return {
      dist, ideal, moving, still: stl,
      lossMoving: ideal > 0 ? 1 - moving / ideal : null,
      lossIdeal: stl > 0 ? 1 - ideal / stl : null,
    };
  });
}

/** One-decimal percent as a bare number ("3.8"), or an em dash when null. */
export function pctNum(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return (x * 100).toFixed(1);
}

/** The cost at every whole metre from 1 to COST_MAX_D: hits per burst for the
 *  three rhythms and the two losses (strafing the whole burst vs the ideal
 *  rhythm, the ideal rhythm vs standing still). Pure; feeds the graph. */
export const COST_MAX_D = 100;
export function costCurve(still, move, bloom, nFree, shots, maxD = COST_MAX_D) {
  const out = [];
  for (let dist = 1; dist <= maxD; dist++) {
    const ideal = burstHitAvg(still, move, bloom, nFree, shots, dist, "ideal");
    const moving = burstHitAvg(still, move, bloom, nFree, shots, dist, "moving");
    const stl = burstHitAvg(still, move, bloom, nFree, shots, dist, "still");
    out.push({
      dist, ideal, moving, still: stl,
      lossMoving: ideal > 0 ? 1 - moving / ideal : 0,
      lossIdeal: stl > 0 ? 1 - ideal / stl : 0,
    });
  }
  return out;
}

/** Strafing-loss pair for one version-specific record, from the page's own
 *  cost model: the 10-round ADS burst, standing, against the 0.5 m torso.
 *  { m35, i35, m60, i60 } are the lossMoving / lossIdeal fractions at 35 m
 *  and 60 m (see costSummary), or null when the gun has no usable ADS
 *  numbers in this version — the table then shows a dash, never an invented
 *  number. Base numbers only: the attachment toggles are calculator-only
 *  and do not reach this helper. */
export function lossPair(rec) {
  const ads = paramsFor(rec, "ads", "stand");
  if (!ads || ads.still === null || ads.move === null || ads.bloom === null) return null;
  const n = nStill(ads.still, ads.move, ads.bloom);
  const rows = costSummary(ads.still, ads.move, ads.bloom, n, SHOTS);
  return {
    m35: rows[0].lossMoving, i35: rows[0].lossIdeal,
    m60: rows[1].lossMoving, i60: rows[1].lossIdeal,
  };
}

/** One loss cell for the weapon table: the moving-vs-ideal loss % as the
 *  main value, the ideal-vs-standing-still cost as a smaller muted figure —
 *  the same two numbers the cost panel's loss lines print. A dash when the
 *  pair (or the main value) is not computable. */
export function lossCell(pair, mainKey, idealKey) {
  const main = pair?.[mainKey] ?? null;
  if (main === null || main === undefined) return "—";
  const ideal = pair?.[idealKey] ?? null;
  const sub = ideal === null || ideal === undefined ? "" : `<span class="loss-sub">${tr("adad.loss.ideal", "ideal −{pct}%", { pct: pctNum(ideal) })}</span>`;
  return `<span class="loss">${pctNum(main)}%${sub}</span>`;
}

/* ---------- the weapon table: images, sorting, compare links, detail rows ---------- */
export const SORT_KEYS = ["name", "faction", "category", "rpm", "adsStill", "adsMove", "adsBloom", "freeAds", "hipStill", "hipMove", "hipBloom", "freeHip", "loss35", "loss60"];

/** Local render for a weapon from the image map (name -> Census image id), or
 *  null when the gun has none — the four fire-mode variants have no Census
 *  item of their own, so no image is invented for them. */
export function imageSrcFor(name, imageMap) {
  const img = imageMap?.[name];
  return img === undefined || img === null ? null : `assets/weapons/${img}.webp`;
}

/** weapon-compare.html?w=<itemId> for a weapon, or null when it has no Census
 *  id — the four variant rows show a dash, never an invented id. */
export function compareHrefFor(name, idMap) {
  const id = idMap?.[name];
  return id === undefined || id === null ? null : `weapon-compare.html?w=${id}`;
}

/** URL-safe id for a row's detail element. */
export function slugName(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Comparable value of one table entry for a sort key. entry = { row, rec }
 *  where rec is the version-specific record from recordFor. null = not
 *  computable (always sorts last); Infinity = bloom 0, the most free shots. */
export function sortValue(entry, key) {
  const { row, rec } = entry;
  const ads = paramsFor(rec, "ads", "stand"), hip = paramsFor(rec, "hip", "stand");
  switch (key) {
    case "name": return row.n;
    case "faction": return row.f;
    case "category": return row.c;
    case "rpm": return rec?.rpm ?? null;
    case "adsStill": return ads?.still ?? null;
    case "adsMove": return ads?.move ?? null;
    case "adsBloom": return ads?.bloom ?? null;
    case "freeAds": return nStill(ads?.still, ads?.move, ads?.bloom);
    case "hipStill": return hip?.still ?? null;
    case "hipMove": return hip?.move ?? null;
    case "hipBloom": return hip?.bloom ?? null;
    case "freeHip": return nStill(hip?.still, hip?.move, hip?.bloom);
    case "loss35": return lossPair(rec)?.m35 ?? null;
    case "loss60": return lossPair(rec)?.m60 ?? null;
    default: return null;
  }
}

/** Compare two sort values: numbers numerically (Infinity counts as the most
 *  free shots), strings with localeCompare, nulls always last. */
export function compareValues(a, b) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

/** A sorted copy of the entries. Nulls stay last in both directions; only
 *  real values flip with the direction. */
export function sortEntries(entries, key, dir) {
  return [...entries].sort((x, y) => {
    const a = sortValue(x, key), b = sortValue(y, key);
    if (a === null || b === null) return compareValues(a, b);
    return compareValues(a, b) * dir;
  });
}

/** The table's order: a pure sort of every entry by the active column.
 *  No gun is pinned — the worked examples sort like everything else. Pure,
 *  so the table's order is testable without a DOM. */
export function orderEntries(entries, key, dir) {
  return sortEntries(entries, key, dir);
}

/** The expanded detail for one weapon: all four stance pairs (still and moving
 *  minima, bloom) plus the worked 10-round burst for ADS standing — the same
 *  burst the calculator shows when the gun is loaded with the default stance.
 *  Pure: strings come in t, so tests can pass English literals. */
export function detailHtml(rec, t) {
  const pairs = [
    [t.adsStand, paramsFor(rec, "ads", "stand")],
    [t.adsCrouch, paramsFor(rec, "ads", "crouch")],
    [t.hipStand, paramsFor(rec, "hip", "stand")],
    [t.hipCrouch, paramsFor(rec, "hip", "crouch")],
  ];
  let html = `<div class="detail-box"><h4>${t.h}</h4><table class="shots detail-stances"><thead><tr><th>${t.stance}</th><th>${t.still}</th><th>${t.move}</th><th>${t.bloom}</th></tr></thead><tbody>`
    + pairs.map(([label, p]) => `<tr><td>${label}</td><td>${fmt(p?.still)}</td><td>${fmt(p?.move)}</td><td>${fmt(p?.bloom)}</td></tr>`).join("")
    + "</tbody></table>";
  const ads = paramsFor(rec, "ads", "stand");
  if (ads && ads.still !== null && ads.move !== null && ads.bloom !== null) {
    const n = nStill(ads.still, ads.move, ads.bloom);
    const plan = simulate(ads.still, ads.move, ads.bloom, n, SHOTS);
    const allMove = simulatePlain(ads.move, ads.bloom, SHOTS);
    html += `<h4>${t.burstH}</h4><table class="shots"><thead><tr><th>${t.shot}</th><th>${t.stanceCol}</th><th>${t.cof}</th><th>${t.ifMoving}</th></tr></thead><tbody>`
      + plan.map((r, idx) => {
        const isSwitch = r.moving && (idx === 0 || !plan[idx - 1].moving);
        return `<tr${isSwitch ? ' class="switchrow"' : ""}><td>${r.shot}</td><td>${r.moving ? t.moving : t.stillWord}${isSwitch ? `<span class="tag">${t.switchWord}</span>` : ""}</td><td>${fmt(r.cof)}</td><td>${fmt(allMove[idx])}</td></tr>`;
      }).join("") + "</tbody></table>";
  } else {
    html += `<p class="detail-nodata">${t.noData}</p>`;
  }
  return html + "</div>";
}

/* ---------- page state (DOM only) ---------- */
let data2018 = null;   // { sheetDate, weapons: [2018 rows] }
let itemIds = null;    // { name: Census item_id | null }
let images = null;     // { name: Census image id } — adad-images.json (null when it failed to load)
let recoil = null;     // recoil.json (null when it failed to load)
let version = "current"; // 'current' | 'hist'
let stance = "ads";      // 'ads' | 'hip'
let posture = "stand";   // 'stand' | 'crouch'
let loaded = null;       // the loaded 2018 row (version-independent identity)
let sortKey = "name";    // current sort column (name first, as the table was ordered)
let sortDir = 1;         // 1 = ascending, -1 = descending
const expanded = new Set(); // weapon names whose detail row is open (keyed by name, so an open row follows its gun through sorts and filters)
let costDist = 35;        // the distance the cost graph's readout is read at (m)
let costMode = "loss";    // 'loss' | 'hits': what the cost graph plots
let lastCost = null;     // { still, move, bloom, n } of the last compute(), so the slider redraws without recomputing
let activeAtts = new Set(); // attachment toggles: session-only, off by default, reset on a new gun or a version switch

function recordFor(row) {
  if (!row) return null;
  if (version === "hist" || !recoil) return row;
  return deriveCurrent(row, recoil, itemIds?.[row.n]) || { ...row, as: [null, null], ac: [null, null], hs: [null, null], hc: [null, null], ba: null, bh: null, rpm: null, refireMs: null };
}

function censusDate() {
  if (!recoil?.savedAt) return "";
  const d = new Date(recoil.savedAt);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(currentLang(), { year: "numeric", month: "long", day: "numeric" });
}

function setVersion(v) {
  version = v;
  $("adadVerCur").setAttribute("aria-checked", String(v === "current"));
  $("adadVerHist").setAttribute("aria-checked", String(v === "hist"));
  $("adadVerCur").textContent = recoil
    ? tr("adad.ver.current", "Current (Census, {date})", { date: censusDate() })
    : tr("adad.ver.currentNodate", "Current (Census)");
  const date = censusDate();
  $("adadBanner").innerHTML = v === "current"
    ? tr("adad.banner.cur", "Current data — cone and bloom numbers from the Census snapshot of <b>{date}</b>. The method is the same as Iridar's; only the numbers are today's.", { date })
    : tr("adad.banner.hist", "<b>Stale data warning —</b> the weapon table below comes from Iridar's Toolbox v6h, whose Stats sheet is dated <b>19 August 2018</b> — before later rebalances and redesigns. Treat every preloaded number as history, not current stats. The method is timeless; the data is not. Every parameter in the calculator is editable, so type in today's numbers for any gun and the math still holds.");
  $("tblH").textContent = v === "current"
    ? tr("adad.table.hCur", "Every weapon — current Census data")
    : tr("adad.table.hHist", "Every weapon in the Toolbox (2018)");
  $("notesNs").innerHTML = v === "current"
    ? tr("adad.notes.ns11cCur", "<b>NS-11C, current numbers:</b> the Census snapshot gives the same sheet values (still 0.1, moving 0.25, bloom 0.05), which compute to <b>3</b> free ADS shots — the 2018 sheet and today's data agree, and both disagree with the 5 in Iridar's article text.")
    : tr("adad.notes.ns11cHist", "<b>NS-11C discrepancy, flagged honestly:</b> Iridar's article text credits the NS-11C with 5 free ADS shots, but the v6h sheet's own numbers for it (still 0.1, moving 0.25, bloom 0.05) compute to <b>3</b>. The table shows what the sheet computes; the article was likely written against older stats.");
  $("inMaxHint").textContent = v === "current"
    ? tr("adad.in.maxHintCur", "The reset clamp. Filled in from Census when the weapon is loaded.")
    : tr("adad.in.maxHintHist", "The reset clamp. Not stored in the Toolbox — leave blank if you don't know it.");
  renderTable();
  if (loaded) applyWeapon(loaded);
}

function applyWeapon(row, resetAtts = true) {
  loaded = row;
  if (resetAtts) activeAtts.clear();
  const rec = recordFor(row);
  const p = paramsFor(rec, stance, posture);
  $("gunName").textContent = row.n;
  $("gunMeta").textContent = `${row.f} · ${row.c} · ${rec?.rpm ? rec.rpm + " RPM" : "RPM —"} · ${stance === "ads" ? tr("adad.ads", "ADS") : tr("adad.hip", "Hipfire")}, ${posture === "stand" ? tr("adad.stand", "standing") : tr("adad.crouch", "crouching")}`;
  $("inStill").value = p?.still === null || p?.still === undefined ? "" : fmt(p.still);
  $("inMove").value = p?.move === null || p?.move === undefined ? "" : fmt(p.move);
  $("inBloom").value = p?.bloom === null || p?.bloom === undefined ? "" : fmt(p.bloom);
  $("inRpm").value = p?.rpm ?? "";
  $("inMax").value = p?.max === null || p?.max === undefined ? "" : fmt(p.max);
  renderAttBox();
  compute();
}

/** The attachment choices for the loaded gun: only the parts it can mount
 *  that change the cone or the bloom, one radio group per slot (a slot holds
 *  one part). Rebuilt whenever the gun or the version changes. */
const SLOT_EN = { barrel: "Barrel", rail: "Rail", ammo: "Ammo" };
function renderAttBox() {
  const list = attTogglesFor(loaded ? itemIds?.[loaded.n] : null, recoil);
  $("attRow").innerHTML = ATT_SLOTS.map((sl) => {
    const names = list.filter((n) => attSlot(n) === sl);
    if (!names.length) return "";
    const chosen = names.find((n) => activeAtts.has(n)) || "";
    const slotName = tr("adad.att.slot." + sl, SLOT_EN[sl]);
    const opt = (n) => `<label class="att"><input type="radio" name="att-${sl}" data-slot="${sl}" data-att="${esc(n)}"${chosen === n ? " checked" : ""}> <span>${n ? esc(attLabel(n)) : esc(tr("adad.att.off", "None"))}</span></label>`;
    return `<div class="att-slot" role="radiogroup" aria-label="${esc(slotName)}"><span class="att-slotname">${esc(slotName)}</span>${["", ...names].map(opt).join("")}</div>`;
  }).join("");
  $("attNote").textContent = list.length
    ? tr("adad.att.note", "Only the attachments that change the cone or the bloom are listed, one part per slot: a barrel part and a rail part can be fitted together, two barrel parts cannot.")
    : tr("adad.att.none", "No attachment changes this gun's numbers — nothing it can mount touches the cone or the bloom.");
}

/** The choice label for one attachment, with its effect on the math. */
function attLabel(name) {
  const fx = ATT_EFFECTS[name] || {};
  const parts = Object.entries(fx).map(([k, f]) => {
    switch (k) {
      case "hipMinCof": return tr("adad.att.fx.hipMinCof", "hip cone ×{f}", { f });
      case "hipBloom": return tr("adad.att.fx.hipBloom", "hip bloom ×{f}", { f });
      case "adsBloom": return tr("adad.att.fx.adsBloom", "ADS bloom ×{f}", { f });
      case "adsZeroCof": return tr("adad.att.fx.adsZeroCof", "ADS cone 0");
      default: return "";
    }
  }).filter(Boolean);
  return parts.length ? `${name} — ${parts.join(", ")}` : name;
}

function setStance(s) {
  stance = s;
  $("btnAds").setAttribute("aria-checked", String(s === "ads"));
  $("btnHip").setAttribute("aria-checked", String(s === "hip"));
  if (loaded) applyWeapon(loaded, false); else compute();
}

function setPosture(p) {
  posture = p;
  $("btnStand").setAttribute("aria-checked", String(p === "stand"));
  $("btnCrouch").setAttribute("aria-checked", String(p === "crouch"));
  if (loaded) applyWeapon(loaded, false); else compute();
}

function num(id) {
  const v = parseFloat($(id).value);
  return Number.isNaN(v) ? null : v;
}

function compute() {
  const rpm = num("inRpm"), maxC = num("inMax");
  // The inputs hold the gun's base numbers; the ticked attachments modify
  // them for this stance before anything is computed.
  const p = applyAttachments({ still: num("inStill"), move: num("inMove"), bloom: num("inBloom") }, stance, activeAtts);
  const still = p.still, move = p.move, bloom = p.bloom;
  const tbody = document.querySelector("#shotTable tbody");
  if (still === null || move === null || bloom === null) {
    $("nBig").textContent = "–";
    $("nWhat").textContent = tr("adad.verdict.empty", "Enter still minimum, moving minimum and bloom per shot to get the count.");
    $("nFormula").textContent = "";
    tbody.innerHTML = ""; $("finals").innerHTML = ""; lastCost = null; renderCost(); $("chart").innerHTML = ""; $("resetBox").innerHTML = "";
    return;
  }
  const n = nStill(still, move, bloom);
  const refire = rpm ? 60000 / rpm : null;

  if (n === Infinity) {
    $("nBig").textContent = "∞";
    $("nWhat").innerHTML = tr("adad.verdict.inf", "Bloom is <b>0</b> — the cone never grows while you fire, so <b>every</b> still shot is free. Moving just jumps the cone straight to the moving minimum whenever you choose to start.");
    $("nFormula").textContent = "";
  } else if (n === 0) {
    $("nBig").textContent = "0";
    $("nWhat").innerHTML = tr("adad.verdict.zero", "No free shots: the moving minimum is at or below the still minimum, so <b>strafe from the very first shot</b> — moving costs no accuracy at all.");
    $("nFormula").innerHTML = tr("adad.formula.zero", "floor(({move} − {still}) ÷ {bloom}) = <b>0</b>", { move: fmt(move), still: fmt(still), bloom: fmt(bloom) });
  } else {
    $("nBig").textContent = String(n);
    const rem = (move - still) - n * bloom;
    $("nWhat").innerHTML = tr("adad.verdict.n", "Fire the first <b>{n} shots standing still</b>, then start strafing. Your cone reaches the moving minimum exactly as you start to move, so the rest of the burst costs nothing.", { n })
      + (rem > 0.0005 ? tr("adad.verdict.leftover", " Switching lifts the cone by the leftover <b>{rem}°</b> — less than one bloom step — to reach the moving floor; the first {n} shots were still fired at full still accuracy.", { rem: fmt(rem), n }) : "")
      + (refire ? tr("adad.verdict.stillTime", " That's about <b>{time}</b> spent standing still.", { time: fmtT(n * refire) }) : "");
    $("nFormula").innerHTML = tr("adad.formula.n", "floor((moving min − still min) ÷ bloom) = floor(({move} − {still}) ÷ {bloom}) = floor({ratio}) = <b>{n}</b>", { move: fmt(move), still: fmt(still), bloom: fmt(bloom), ratio: fmt((move - still) / bloom), n });
  }

  const plan = simulate(still, move, bloom, n, SHOTS);
  const allMove = simulatePlain(move, bloom, SHOTS);
  const allStill = simulatePlain(still, bloom, SHOTS);
  let html = "";
  plan.forEach((r, idx) => {
    const isSwitch = r.moving && (idx === 0 || !plan[idx - 1].moving);
    html += `<tr${isSwitch ? ' class="switchrow"' : ""}><td>${r.shot}</td><td>${r.moving ? tr("adad.burst.moving", "Moving") : tr("adad.burst.still", "Still")}${isSwitch ? `<span class="tag">${tr("adad.burst.switch", "start strafing")}</span>` : ""}</td><td>${fmt(r.cof)}</td><td>${fmt(allMove[idx])}</td></tr>`;
  });
  tbody.innerHTML = html;

  const fA = plan[SHOTS - 1].cof, fB = allStill[SHOTS - 1], fC = allMove[SHOTS - 1];
  $("finals").innerHTML = finalsHtml(fA, fB, fC, {
    ideal: tr("adad.final.ideal", "Ideal rhythm"),
    still: tr("adad.final.still", "Still throughout"),
    moving: tr("adad.final.moving", "Moving throughout"),
  });

  // What it costs: the same burst counted in hits, graphed over distance.
  lastCost = { still, move, bloom, n };
  renderCost();

  // Cone growth: CoF after each shot, ideal rhythm vs moving the whole burst.
  const series = [
    { cls: "ideal", pts: [still, ...plan.map((r) => r.cof)] },
    { cls: "move", pts: [move, ...allMove] },
  ];
  const peak = Math.max(...series.flatMap((s) => s.pts)) || 1;
  const top = peak * 1.08;
  const W = 520, H = 170, PL = 42, PR = 12, PT = 10, PB = 26;
  const x = (i) => PL + (i / SHOTS) * (W - PL - PR);
  const y = (v) => PT + (1 - v / top) * (H - PT - PB);
  const line = (pts) => pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const grid = [0, 0.5, 1].map((f) => {
    const v = (peak * f);
    return `<line x1="${PL}" y1="${y(v).toFixed(1)}" x2="${W - PR}" y2="${y(v).toFixed(1)}" class="grid"/>`
      + `<text x="${PL - 6}" y="${(y(v) + 4).toFixed(1)}" class="ax-t" text-anchor="end">${fmt(v)}°</text>`;
  }).join("");
  const ticks = Array.from({ length: SHOTS + 1 }, (_, i) => i)
    .filter((i) => i === 0 || i % 2 === 0 || i === SHOTS)
    .map((i) => `<text x="${x(i).toFixed(1)}" y="${H - 8}" class="ax-t" text-anchor="middle">${i}</text>`).join("");
  // dashed floors: the still minimum and the moving minimum
  const floors = [[still, "floor-still"], [move, "floor-move"]]
    .filter(([v]) => v !== null && v !== undefined && !Number.isNaN(v) && v > 0 && v <= top)
    .map(([v, c]) => `<line x1="${PL}" y1="${y(v).toFixed(1)}" x2="${W - PR}" y2="${y(v).toFixed(1)}" class="${c}"/>`).join("");
  const marks = series.map((s) => s.pts.slice(1).map((v, i) => `<rect x="${(x(i + 1) - 2.5).toFixed(1)}" y="${(y(v) - 2.5).toFixed(1)}" width="5" height="5" class="dot-${s.cls}"/>`).join("")).join("");
  $("chart").innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(tr("adad.chart.h", "Cone growth"))}">`
    + grid + floors
    + `<line x1="${PL}" y1="${H - PB}" x2="${W - PR}" y2="${H - PB}" class="ax"/>`
    + series.map((s) => `<path d="${line(s.pts)}" class="line-${s.cls}" fill="none"/>`).join("")
    + marks + ticks + `</svg>`;

  const info = resetInfo({ still, endCof: fA, maxCof: maxC, refireMs: refire });
  $("resetBox").innerHTML = info
    ? tr("adad.reset.line", "Refire <b>{refire}</b>; recovery starts after one refire, then the cone shrinks at <b>20°/s</b> down to the still minimum. Full reset takes about <b>{total}</b>.", { refire: fmtT(info.refireMs), total: fmtT(info.totalMs) })
      + (info.clamped ? tr("adad.reset.clamp", " Standing still clamps the bloomed cone instantly to the still maximum (<b>{max}°</b>) first.", { max: fmt(maxC) }) : "")
    : "";
}

/** The cost graph's frame (viewBox units), shared with the click handler. */
const COST_VB = { W: 520, H: 190, PL: 44, PR: 12, PT: 10, PB: 26 };

function setCostMode(m) {
  costMode = m;
  $("costModeLoss").setAttribute("aria-checked", String(m === "loss"));
  $("costModeHits").setAttribute("aria-checked", String(m === "hits"));
  renderCost();
}

/** The "What it costs" graph: over distance (1–100 m), either the DPS loss
 *  (strafing the whole burst vs the ideal rhythm; the ideal rhythm vs standing
 *  still) or the hits per burst of the three rhythms, with a marker at the
 *  chosen distance and its numbers underneath. The slider and a click on the
 *  graph move the marker. */
function renderCost() {
  const chart = $("costChart"), legend = $("costLegend"), at = $("costAt"), loss = $("costLoss");
  $("costDistVal").textContent = `${costDist} m`;
  if (!lastCost) { chart.innerHTML = ""; legend.innerHTML = ""; at.innerHTML = ""; loss.innerHTML = ""; return; }
  const { still, move, bloom, n } = lastCost;
  const rows = costCurve(still, move, bloom, n, SHOTS);
  const { W, H, PL, PR, PT, PB } = COST_VB;
  const isLoss = costMode === "loss";
  const series = isLoss
    ? [{ cls: "move", v: (r) => r.lossMoving * 100 }, { cls: "ideal", v: (r) => r.lossIdeal * 100 }]
    : [{ cls: "ideal", v: (r) => r.ideal * SHOTS }, { cls: "move", v: (r) => r.moving * SHOTS }, { cls: "still", v: (r) => r.still * SHOTS }];
  const peak = isLoss ? Math.max(10, Math.ceil(Math.max(...rows.map((r) => Math.max(r.lossMoving, r.lossIdeal) * 100)) / 10) * 10) : SHOTS;
  const x = (d) => PL + (d / COST_MAX_D) * (W - PL - PR);
  const y = (v) => PT + (1 - v / peak) * (H - PT - PB);
  const path = (f) => rows.map((r, i) => `${i ? "L" : "M"}${x(r.dist).toFixed(1)},${y(f(r)).toFixed(1)}`).join(" ");
  const unit = isLoss ? "%" : "";
  const grid = [0, 0.5, 1].map((f) => `<line x1="${PL}" y1="${y(peak * f).toFixed(1)}" x2="${W - PR}" y2="${y(peak * f).toFixed(1)}" class="grid"/><text x="${PL - 6}" y="${(y(peak * f) + 4).toFixed(1)}" class="ax-t" text-anchor="end">${fmt(peak * f)}${unit}</text>`).join("");
  const ticks = [0, 20, 40, 60, 80, 100].map((d) => `<text x="${x(d).toFixed(1)}" y="${H - 8}" class="ax-t" text-anchor="${d === 100 ? "end" : "middle"}">${d}${d === 100 ? " m" : ""}</text>`).join("");
  const cur = rows[Math.min(rows.length, Math.max(1, costDist)) - 1];
  const marks = series.map((s) => `<rect x="${(x(costDist) - 3).toFixed(1)}" y="${(y(s.v(cur)) - 3).toFixed(1)}" width="6" height="6" class="dot-${s.cls}"/>`).join("");
  chart.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(tr("adad.cost.h", "What it costs"))}">`
    + grid + `<line x1="${PL}" y1="${H - PB}" x2="${W - PR}" y2="${H - PB}" class="ax"/>`
    + series.map((s) => `<path d="${path(s.v)}" class="line-${s.cls}" fill="none"/>`).join("")
    + `<line x1="${x(costDist).toFixed(1)}" y1="${PT}" x2="${x(costDist).toFixed(1)}" y2="${H - PB}" class="cursor"/>`
    + marks + ticks + `</svg>`;
  const sw = (c, label) => `<span><span class="sw" style="background:var(--${c})"></span>${label}</span>`;
  legend.innerHTML = isLoss
    ? sw("adad-move", tr("adad.cost.legend.moving", "Strafing the whole burst — loss vs the ideal rhythm")) + sw("accent", tr("adad.cost.legend.ideal", "Ideal rhythm — loss vs standing still"))
    : sw("accent", tr("adad.final.ideal", "Ideal rhythm")) + sw("adad-move", tr("adad.final.moving", "Moving throughout")) + sw("dim", tr("adad.final.still", "Still throughout"));
  const card = (label, v) => `<div class="final"><div class="t">${label}</div><div class="v">${(v * SHOTS).toFixed(1)}<small> / ${SHOTS}</small></div><div class="s">${esc(tr("adad.cost.col.miss", "Miss"))} ${pctNum(1 - v)}%</div></div>`;
  at.innerHTML = card(tr("adad.final.ideal", "Ideal rhythm"), cur.ideal) + card(tr("adad.final.moving", "Moving throughout"), cur.moving) + card(tr("adad.final.still", "Still throughout"), cur.still);
  loss.innerHTML = tr("adad.cost.loss", "At {dist} m, strafing the whole burst loses <b>{loss}%</b> of your damage vs the ideal rhythm. The ideal rhythm itself costs <b>{free}%</b> vs standing still — the movement is nearly free.", { dist: costDist, loss: pctNum(cur.lossMoving), free: pctNum(cur.lossIdeal) });
}

/** Strings for one row's detail, translated at render time. */
function detailStrings() {
  return {
    h: tr("adad.detail.h", "All stances"),
    stance: tr("adad.detail.stance", "Stance"),
    still: tr("adad.detail.still", "Still min"),
    move: tr("adad.detail.move", "Moving min"),
    bloom: tr("adad.detail.bloom", "Bloom"),
    adsStand: tr("adad.detail.adsStand", "ADS, standing"),
    adsCrouch: tr("adad.detail.adsCrouch", "ADS, crouching"),
    hipStand: tr("adad.detail.hipStand", "Hipfire, standing"),
    hipCrouch: tr("adad.detail.hipCrouch", "Hipfire, crouching"),
    burstH: tr("adad.detail.burst", "Worked burst — 10 rounds, ideal rhythm (ADS, standing)"),
    shot: tr("adad.burst.shot", "Shot"),
    stanceCol: tr("adad.burst.stance", "Stance"),
    cof: tr("adad.burst.cof", "CoF after shot"),
    ifMoving: tr("adad.burst.ifmoving", "If moving all along"),
    stillWord: tr("adad.burst.still", "Still"),
    moving: tr("adad.burst.moving", "Moving"),
    switchWord: tr("adad.burst.switch", "start strafing"),
    noData: tr("adad.detail.noData", "No usable numbers for this gun in this version."),
  };
}

/** One table row: the collapsed summary — toggle, image, name, faction,
 *  category, RPM, the two free-shot counts, Compare — plus, when open, the
 *  detail row right under it. The CoF and bloom values live only in the
 *  detail, so the summary stays scannable. opts carries the maps and the
 *  open set, so the row is testable without module state. */
export function rowHtml(entry, opts) {
  const { row, rec } = entry;
  const { imgMap, idMap, open } = opts;
  const ads = paramsFor(rec, "ads", "stand"), hip = paramsFor(rec, "hip", "stand");
  const img = imageSrcFor(row.n, imgMap);
  const href = compareHrefFor(row.n, idMap);
  const isOpen = open.has(row.n);
  const detailId = `detail-${slugName(row.n)}`;
  const losses = lossPair(rec);
  const toggleLabel = isOpen
    ? tr("adad.row.collapse", "Hide details for {name}", { name: row.n })
    : tr("adad.row.expand", "Show details for {name}", { name: row.n });
  let html = `<tr data-name="${esc(row.n)}">`
    + `<td class="rowtoggle" data-l="${esc(tr("adad.col.details", "Details"))}"><button type="button" class="row-toggle" data-toggle="${esc(row.n)}" aria-expanded="${isOpen}" aria-controls="${detailId}" aria-label="${esc(toggleLabel)}">${isOpen ? "▾" : "▸"}</button></td>`
    + `<td class="imgcell" data-l="${esc(tr("adad.col.image", "Image"))}">${img ? `<img src="${img}" alt="" width="56" height="28" loading="lazy" onerror="this.style.visibility='hidden'" />` : "—"}</td>`
    + `<td class="namecell" data-l="${esc(tr("adad.col.weapon", "Weapon"))}">${esc(row.n)}</td>`
    + `<td data-l="${esc(tr("adad.col.faction", "Faction"))}">${esc(row.f)}</td>`
    + `<td data-l="${esc(tr("adad.col.rpm", "RPM"))}">${rec?.rpm ?? "—"}</td>`
    + `<td class="n" data-l="${esc(tr("adad.col.freeAds", "Free ADS"))}">${nCell(ads?.still, ads?.move, ads?.bloom)}</td>`
    + `<td class="n" data-l="${esc(tr("adad.col.freeHip", "Free hip"))}">${nCell(hip?.still, hip?.move, hip?.bloom)}</td>`
    + `<td class="n" data-l="${esc(tr("adad.col.loss35", "Loss @ 35 m"))}">${lossCell(losses, "m35", "i35")}</td>`
    + `<td class="n" data-l="${esc(tr("adad.col.loss60", "Loss @ 60 m"))}">${lossCell(losses, "m60", "i60")}</td>`
    + `<td class="cmpcell" data-l="${esc(tr("adad.col.compare", "Compare"))}">${href ? `<a href="${href}">${esc(tr("adad.compare", "Compare"))}</a>` : "—"}</td></tr>`;
  if (isOpen) html += `<tr class="detail" id="${detailId}"><td colspan="10">${detailHtml(rec, detailStrings())}</td></tr>`;
  return html;
}

function paintSort() {
  for (const th of document.querySelectorAll("#wtable thead th[data-sort]")) {
    const key = th.dataset.sort;
    th.setAttribute("aria-sort", key === sortKey ? (sortDir > 0 ? "ascending" : "descending") : "none");
    const ind = th.querySelector(".sort-ind");
    if (ind) ind.textContent = key === sortKey ? (sortDir > 0 ? "▲" : "▼") : "";
  }
}

function setSort(key) {
  if (key === sortKey) sortDir = -sortDir;
  else { sortKey = key; sortDir = 1; }
  renderTable();
}

/** Display order of the weapon categories; anything else follows alphabetically. */
export const CAT_ORDER = ["Assault Rifle", "Carbine", "SMG", "LMG", "Battle Rifle", "Scout Rifle", "Sniper Rifle", "Shotgun", "Pistol", "Rocket Launcher", "Heavy Gun", "Crossbow", "Grenade", "Infantry Weapons"];

/** Entries grouped by category, in CAT_ORDER: [[category, entries[]], ...]. Pure. */
export function groupByCategory(entries) {
  const m = new Map();
  for (const e of entries) { const c = e.row.c || "—"; if (!m.has(c)) m.set(c, []); m.get(c).push(e); }
  const rank = (c) => { const i = CAT_ORDER.indexOf(c); return i < 0 ? CAT_ORDER.length : i; };
  return [...m.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
}

const collapsedCats = new Set(); // categories folded shut
let facFilter = "";              // "" = every faction

function renderTable() {
  if (!data2018) return;
  const q = ($("q").value || "").toLowerCase();
  const rows = data2018.weapons.filter((w) => (!q || w.n.toLowerCase().includes(q)) && (!facFilter || w.f === facFilter));
  const groups = groupByCategory(rows.map((w) => ({ row: w, rec: recordFor(w) })));
  const opts = { imgMap: images, idMap: itemIds, open: expanded };
  const tbody = document.querySelector("#wtable tbody");
  tbody.innerHTML = groups.map(([cat, list]) => {
    const shut = collapsedCats.has(cat);
    const head = `<tr class="cat-head" data-cat="${esc(cat)}"><th colspan="10" scope="colgroup"><button type="button" class="cat-toggle" data-cat="${esc(cat)}" aria-expanded="${!shut}"><span class="cat-arrow" aria-hidden="true">${shut ? "▸" : "▾"}</span> <span class="cat-name">${esc(cat)}</span> <span class="cat-n">${nf(list.length)}</span></button></th></tr>`;
    return head + (shut ? "" : orderEntries(list, sortKey, sortDir).map((e) => rowHtml(e, opts)).join(""));
  }).join("");
  let i = 0; // zebra restarts in every category
  for (const rowEl of tbody.children) {
    if (rowEl.classList.contains("cat-head")) i = 0;
    else if (rowEl.dataset.name) rowEl.classList.toggle("alt", i++ % 2 === 1);
  }
  $("catChips").innerHTML = groups.map(([cat, list]) => `<button type="button" class="catchip" data-cat="${esc(cat)}">${esc(cat)} <span class="cat-n">${nf(list.length)}</span></button>`).join("");
  const allShut = groups.length > 0 && groups.every(([cat]) => collapsedCats.has(cat));
  $("catToggleAll").textContent = allShut ? tr("adad.cat.expand", "Expand all") : tr("adad.cat.collapse", "Collapse all");
  $("catToggleAll").dataset.shut = allShut ? "1" : "";
  $("rowCount").textContent = tr("adad.count", "{shown} of {total} weapons", { shown: nf(rows.length), total: nf(data2018.weapons.length) });
  paintSort();
}

async function loadJson(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

let started = null;
/** Start the calculator once (it lives inside weapon-compare.html's folded ADAD section, so the page only starts it
 *  when the section is first opened or a weapon's 🎯 badge is clicked). Resolves when its data is loaded. */
export function startAdad() {
  if (!started) started = ready.then(init);
  return started;
}

/** Load one weapon of the comparison page into the calculator. A weapon the 2018 Toolbox never had (newer guns) is
 *  a stub row: its numbers come from the Census snapshot by item id, so the page switches to the current data. */
export async function selectWeapon(w) {
  await startAdad();
  if (!data2018) return;
  let row = data2018.weapons.find((x) => x.n === w.name);
  if (!row) row = { n: w.name, f: w.fac, c: w.cat };
  if (!itemIds[w.name]) itemIds[w.name] = w.id;
  if (version !== "current" && recoil) setVersion("current");
  applyWeapon(row);
}

async function init() {
  $("btnAds").addEventListener("click", () => setStance("ads"));
  $("btnHip").addEventListener("click", () => setStance("hip"));
  $("btnStand").addEventListener("click", () => setPosture("stand"));
  $("btnCrouch").addEventListener("click", () => setPosture("crouch"));
  ["inStill", "inMove", "inBloom", "inRpm", "inMax"].forEach((id) => $(id).addEventListener("input", compute));
  $("attRow").addEventListener("change", (e) => {
    const r = e.target.closest('input[type="radio"][data-slot]');
    if (!r) return;
    activeAtts = chooseAtt(activeAtts, r.dataset.slot, r.dataset.att);
    compute();
  });
  $("costDist").addEventListener("input", () => { costDist = Number($("costDist").value); renderCost(); });
  $("costModeLoss").addEventListener("click", () => setCostMode("loss"));
  $("costModeHits").addEventListener("click", () => setCostMode("hits"));
  $("costChart").addEventListener("click", (e) => {
    const svg = e.target.closest("svg"); if (!svg) return;
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * COST_VB.W; // pointer in viewBox units
    const d = Math.round(((px - COST_VB.PL) / (COST_VB.W - COST_VB.PL - COST_VB.PR)) * COST_MAX_D);
    costDist = Math.max(1, Math.min(COST_MAX_D, d));
    $("costDist").value = String(costDist);
    renderCost();
  });
  $("adadVerCur").addEventListener("click", () => setVersion("current"));
  $("adadVerHist").addEventListener("click", () => setVersion("hist"));
  $("q").addEventListener("input", renderTable);
  $("fFac").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-fac]"); if (!b) return;
    facFilter = b.dataset.fac;
    for (const x of $("fFac").querySelectorAll("button[data-fac]")) x.setAttribute("aria-checked", String(x === b));
    renderTable();
  });
  $("catChips").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-cat]"); if (!b) return;
    const cat = b.dataset.cat;
    if (collapsedCats.delete(cat)) renderTable();
    document.querySelector(`#wtable tr.cat-head[data-cat="${CSS.escape(cat)}"]`)?.scrollIntoView({ block: "start" });
  });
  $("catToggleAll").addEventListener("click", () => {
    const cats = [...document.querySelectorAll("#wtable tr.cat-head")].map((r) => r.dataset.cat);
    if ($("catToggleAll").dataset.shut) collapsedCats.clear(); else for (const c of cats) collapsedCats.add(c);
    renderTable();
  });
  document.querySelector("#wtable thead").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-sort]");
    if (btn) setSort(btn.dataset.sort);
  });
  document.querySelector("#wtable tbody").addEventListener("click", (e) => {
    const catBtn = e.target.closest("button.cat-toggle");
    if (catBtn) {
      const c = catBtn.dataset.cat;
      if (collapsedCats.has(c)) collapsedCats.delete(c); else collapsedCats.add(c);
      renderTable();
      document.querySelector(`button.cat-toggle[data-cat="${CSS.escape(c)}"]`)?.focus();
      return;
    }
    const toggle = e.target.closest("button.row-toggle");
    if (toggle) {
      const name = toggle.dataset.toggle;
      if (expanded.has(name)) expanded.delete(name); else expanded.add(name);
      renderTable();
      // keep the keyboard focus on the toggle that was just used
      document.querySelector(`button.row-toggle[data-toggle="${CSS.escape(name)}"]`)?.focus();
      return;
    }
    if (e.target.closest("a")) return; // the Compare link navigates on its own
    const trEl = e.target.closest("tr[data-name]");
    if (!trEl) return;
    const row = data2018.weapons.find((w) => w.n === trEl.dataset.name);
    if (row) { applyWeapon(row); document.querySelector("#calcH").scrollIntoView({ behavior: "smooth" }); }
  });

  $("adadMsg").textContent = tr("adad.loading", "Loading weapon data…");
  try {
    [data2018, itemIds] = await Promise.all([loadJson("assets/weapons/adad-2018.json"), loadJson("assets/weapons/adad-item-ids.json")]);
  } catch (e) {
    $("adadMsg").textContent = tr("adad.loadFail", "Could not load the weapon data. Reload the page to try again.");
    return;
  }
  try {
    recoil = await loadJson("assets/weapons/recoil.json");
  } catch {
    recoil = null;
  }
  try {
    images = await loadJson("assets/weapons/adad-images.json");
  } catch {
    images = null; // rows render with a dash where the image would be
  }
  if (!recoil) {
    version = "hist";
    $("adadMsg").textContent = tr("adad.recoilFail", "Could not load the current Census data — showing the historical 2018 version instead.");
  } else {
    $("adadMsg").textContent = "";
  }
  setVersion(version);
  const naginata = data2018.weapons.find((w) => w.n === "NSX Naginata");
  if (naginata) applyWeapon(naginata);
}

// No auto-start: weapon-compare.mjs calls startAdad() / selectWeapon() (weapon-adad.html now just forwards to the compare page).
