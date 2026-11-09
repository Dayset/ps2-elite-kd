/**
 * weapon-adad.html: the Ideal ADAD calculator — Iridar's CoF stance rules as a
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
/** The four attachments that change the ADAD math, with the site's own
 *  weapon-model factors (weapon-sim.mjs): Laser Sight and Compensator scale
 *  the hip CoF minima, Heavy Barrel scales ADS bloom, Short Barrel scales
 *  hip bloom. No other attachment touches CoF or bloom, so no other
 *  attachment gets a toggle. */
export const ATT_KEYS = ["Laser Sight", "Compensator", "Heavy Barrel", "Short Barrel"];
export const ATT_EFFECTS = {
  "Laser Sight": { hipMinCof: 0.67 },
  "Compensator": { hipMinCof: 1.15 },
  "Heavy Barrel": { adsBloom: 0.8 },
  "Short Barrel": { hipBloom: 0.6 },
};
/** Census names weapon-sim.mjs treats as one of the four (its alias map):
 *  the Muzzle Brake sits beside the Compensator on the same weapons, so a
 *  gun that mounts one mounts a compensator-effect barrel part. */
export const ATT_ALIASES = { "Muzzle Brake": "Compensator" };

/** Which of the four CoF/bloom attachments the loaded gun can mount, from
 *  the bundled Census att data (recoil.json att[itemId] -> indices into
 *  atts, each [name, descIndex] — the same mechanism weapon-compare uses).
 *  Returned in ATT_KEYS order. [] when there is no att data (recoil not
 *  loaded, or a variant row with no Census item). */
export function attTogglesFor(itemId, recoil) {
  if (!recoil || !itemId || !recoil.att || !recoil.atts) return [];
  const names = new Set((recoil.att[String(itemId)] || []).map((i) => recoil.atts[i]?.[0]).filter(Boolean));
  return ATT_KEYS.filter((k) => names.has(k) || [...names].some((n) => ATT_ALIASES[n] === k));
}

/** Modified (still, move, bloom) for one stance under the active
 *  attachments. p = { still, move, bloom } (nulls pass through unchanged);
 *  active = a Set of attachment names. Laser/Compensator scale the hip
 *  minima, Heavy Barrel scales ADS bloom, Short Barrel scales hip bloom;
 *  factors multiply when two apply. Pure. */
export function applyAttachments(p, stance, active) {
  if (!p) return p;
  let { still, move, bloom } = p;
  const has = (name) => active && active.has(name);
  if (stance === "hip") {
    const minMul = (has("Laser Sight") ? ATT_EFFECTS["Laser Sight"].hipMinCof : 1)
      * (has("Compensator") ? ATT_EFFECTS["Compensator"].hipMinCof : 1);
    if (still !== null && still !== undefined) still *= minMul;
    if (move !== null && move !== undefined) move *= minMul;
    if (has("Short Barrel") && bloom !== null && bloom !== undefined) bloom *= ATT_EFFECTS["Short Barrel"].hipBloom;
  } else if (stance === "ads") {
    if (has("Heavy Barrel") && bloom !== null && bloom !== undefined) bloom *= ATT_EFFECTS["Heavy Barrel"].adsBloom;
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

export function costHtml(rows, t) {
  const miss = (v) => pctNum(1 - v) + "%";
  const hits = (v) => (v * SHOTS).toFixed(1);
  const cell = (label, v) => `<td>${label}</td><td>${miss(v)}</td><td>${hits(v)}</td>`;
  let html = `<h3>${t.h}</h3><p class="cost-intro">${t.intro}</p>`
    + `<table class="cost"><thead><tr><th>${t.colDist}</th><th>${t.colRhythm}</th><th>${t.colMiss}</th><th>${t.colHits}</th></tr></thead><tbody>`;
  for (const r of rows) {
    html += `<tr><td rowspan="3">${r.dist} m</td>${cell(t.ideal, r.ideal)}</tr>`
      + `<tr>${cell(t.moving, r.moving)}</tr>`
      + `<tr>${cell(t.still, r.still)}</tr>`;
  }
  html += "</tbody></table>";
  for (const line of t.losses) html += `<p class="cost-loss">${line}</p>`;
  html += `<p class="cost-caveat">${t.caveat}</p>`;
  return html;
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

/** The attachment toggles for the loaded gun: only the CoF/bloom
 *  attachments it can mount. Rebuilt whenever the gun or the version
 *  changes; a gun that mounts none of the four gets the one-line note
 *  instead of an empty box. */
function renderAttBox() {
  const list = attTogglesFor(loaded ? itemIds?.[loaded.n] : null, recoil);
  $("attRow").innerHTML = list.map((name) => `<label class="att"><input type="checkbox" data-att="${esc(name)}"${activeAtts.has(name) ? " checked" : ""}> ${esc(attLabel(name))}</label>`).join("");
  $("attNote").textContent = list.length
    ? tr("adad.att.note", "Only the attachments that change the cone or the bloom are listed — a grip, a suppressor, ammunition and optics leave these numbers alone.")
    : tr("adad.att.none", "No attachment changes this gun's numbers — nothing it can mount touches the cone or the bloom.");
}

/** The toggle label for one attachment, with its effect on the math. */
function attLabel(name) {
  switch (name) {
    case "Laser Sight": return tr("adad.att.laser", "Laser Sight — hip cone ×0.67");
    case "Compensator": return tr("adad.att.comp", "Compensator — hip cone ×1.15");
    case "Heavy Barrel": return tr("adad.att.heavy", "Heavy Barrel — ADS bloom ×0.8");
    case "Short Barrel": return tr("adad.att.short", "Short Barrel — hip bloom ×0.6");
    default: return name;
  }
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
    tbody.innerHTML = ""; $("finals").innerHTML = ""; $("costBox").innerHTML = ""; $("chart").innerHTML = ""; $("resetBox").innerHTML = "";
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

  // What it costs: the same burst counted in hits, at 35 m and 60 m.
  const costs = costSummary(still, move, bloom, n, SHOTS);
  $("costBox").innerHTML = costHtml(costs, {
    h: tr("adad.cost.h", "What it costs"),
    intro: tr("adad.cost.intro", "Same burst, counted in hits instead of cone size. “Miss” is the share of the 10 shots that miss a 0.5 m torso; damage is proportional to hits, so the loss is a DPS loss too."),
    colDist: tr("adad.cost.col.dist", "Distance"),
    colRhythm: tr("adad.cost.col.rhythm", "Rhythm"),
    colMiss: tr("adad.cost.col.miss", "Miss"),
    colHits: tr("adad.cost.col.hits", "Hits per burst"),
    ideal: tr("adad.final.ideal", "Ideal rhythm"),
    still: tr("adad.final.still", "Still throughout"),
    moving: tr("adad.final.moving", "Moving throughout"),
    losses: costs.map((r) => tr("adad.cost.loss", "At {dist} m, strafing the whole burst loses <b>{loss}%</b> of your damage vs the ideal rhythm. The ideal rhythm itself costs <b>{free}%</b> vs standing still — the movement is nearly free.", { dist: r.dist, loss: pctNum(r.lossMoving), free: pctNum(r.lossIdeal) })),
    caveat: tr("adad.cost.caveat", "A 10-round burst at the stance and posture above, against a 0.5 m circle — a rough torso. This counts cone spread only, not the gun climbing off target (recoil), so the real loss is bigger."),
  });

  // Cone growth: CoF after each shot, ideal rhythm vs moving the whole burst.
  const series = [
    { cls: "ideal", pts: [still, ...plan.map((r) => r.cof)] },
    { cls: "move", pts: [move, ...allMove] },
  ];
  const top = Math.max(...series.flatMap((s) => s.pts)) * 1.05 || 1;
  const W = 520, H = 190, PL = 34, PR = 8, PT = 8, PB = 22;
  const x = (i) => PL + (i / SHOTS) * (W - PL - PR);
  const y = (v) => PT + (1 - v / top) * (H - PT - PB);
  const line = (pts) => pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  $("chart").innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(tr("adad.chart.h", "Cone growth"))}">`
    + `<line x1="${PL}" y1="${PT}" x2="${PL}" y2="${H - PB}" class="ax"/><line x1="${PL}" y1="${H - PB}" x2="${W - PR}" y2="${H - PB}" class="ax"/>`
    + `<text x="4" y="${y(top / 1.05) + 4}" class="ax-t">${fmt(top / 1.05)}°</text>`
    + `<text x="4" y="${H - PB + 4}" class="ax-t">${fmt(0)}°</text>`
    + series.map((s) => `<path d="${line(s.pts)}" class="line-${s.cls}" fill="none"/>`).join("")
    + `<text x="${W - PR}" y="${H - 6}" class="ax-t" text-anchor="end">${SHOTS}</text></svg>`;

  const info = resetInfo({ still, endCof: fA, maxCof: maxC, refireMs: refire });
  $("resetBox").innerHTML = info
    ? tr("adad.reset.line", "Refire <b>{refire}</b>; recovery starts after one refire, then the cone shrinks at <b>20°/s</b> down to the still minimum. Full reset takes about <b>{total}</b>.", { refire: fmtT(info.refireMs), total: fmtT(info.totalMs) })
      + (info.clamped ? tr("adad.reset.clamp", " Standing still clamps the bloomed cone instantly to the still maximum (<b>{max}°</b>) first.", { max: fmt(maxC) }) : "")
    : "";
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
    + `<td data-l="${esc(tr("adad.col.category", "Category"))}">${esc(row.c)}</td>`
    + `<td data-l="${esc(tr("adad.col.rpm", "RPM"))}">${rec?.rpm ?? "—"}</td>`
    + `<td class="n" data-l="${esc(tr("adad.col.freeAds", "Free ADS"))}">${nCell(ads?.still, ads?.move, ads?.bloom)}</td>`
    + `<td class="n" data-l="${esc(tr("adad.col.freeHip", "Free hip"))}">${nCell(hip?.still, hip?.move, hip?.bloom)}</td>`
    + `<td class="n" data-l="${esc(tr("adad.col.loss35", "Loss @ 35 m"))}">${lossCell(losses, "m35", "i35")}</td>`
    + `<td class="n" data-l="${esc(tr("adad.col.loss60", "Loss @ 60 m"))}">${lossCell(losses, "m60", "i60")}</td>`
    + `<td class="cmpcell" data-l="${esc(tr("adad.col.compare", "Compare"))}">${href ? `<a href="${href}">${esc(tr("adad.compare", "Compare"))}</a>` : "—"}</td></tr>`;
  if (isOpen) html += `<tr class="detail" id="${detailId}"><td colspan="11">${detailHtml(rec, detailStrings())}</td></tr>`;
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

function renderTable() {
  if (!data2018) return;
  const q = ($("q").value || "").toLowerCase();
  const fac = $("fFac").value, cat = $("fCat").value;
  const rows = data2018.weapons.filter((w) =>
    (!q || w.n.toLowerCase().includes(q)) && (!fac || w.f === fac) && (!cat || w.c === cat));
  const entries = rows.map((w) => ({ row: w, rec: recordFor(w) }));
  const ordered = orderEntries(entries, sortKey, sortDir);
  const opts = { imgMap: images, idMap: itemIds, open: expanded };
  document.querySelector("#wtable tbody").innerHTML = ordered.map((e) => rowHtml(e, opts)).join("");
  $("rowCount").textContent = tr("adad.count", "{shown} of {total} weapons", { shown: nf(rows.length), total: nf(data2018.weapons.length) });
  paintSort();
}

async function loadJson(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

async function init() {
  $("btnAds").addEventListener("click", () => setStance("ads"));
  $("btnHip").addEventListener("click", () => setStance("hip"));
  $("btnStand").addEventListener("click", () => setPosture("stand"));
  $("btnCrouch").addEventListener("click", () => setPosture("crouch"));
  ["inStill", "inMove", "inBloom", "inRpm", "inMax"].forEach((id) => $(id).addEventListener("input", compute));
  $("attRow").addEventListener("change", (e) => {
    const cb = e.target.closest('input[type="checkbox"][data-att]');
    if (!cb) return;
    if (cb.checked) activeAtts.add(cb.dataset.att); else activeAtts.delete(cb.dataset.att);
    compute();
  });
  $("adadVerCur").addEventListener("click", () => setVersion("current"));
  $("adadVerHist").addEventListener("click", () => setVersion("hist"));
  for (const id of ["q", "fFac", "fCat"]) $(id).addEventListener("input", renderTable);
  document.querySelector("#wtable thead").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-sort]");
    if (btn) setSort(btn.dataset.sort);
  });
  document.querySelector("#wtable tbody").addEventListener("click", (e) => {
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
  const cats = [...new Set(data2018.weapons.map((w) => w.c))].sort();
  $("fCat").innerHTML = `<option value="">${esc(tr("adad.cat.all", "All categories"))}</option>` + cats.map((c) => `<option>${esc(c)}</option>`).join("");
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

if (typeof document !== "undefined") ready.then(init);
