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

export const PINNED = ["NSX Naginata", "TRAC-5"];
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

// The three finals. The artifact hardcodes .win on the ideal-rhythm final —
// it marks the recommended rhythm, not the lowest end CoF (for the default
// Naginata the ideal 0.76° is highlighted even though still-throughout ends
// lower at 0.75°). Kept exactly as built.
export function finalsHtml(fA, fB, fC, t) {
  const final = (label, v, win) => `<div class="final${win ? " win" : ""}"><div class="t">${label}</div><div class="v">${fmt(v)}°</div></div>`;
  return final(t.ideal, fA, true) + final(t.still, fB, false) + final(t.moving, fC, false);
}

/* ---------- page state (DOM only) ---------- */
let data2018 = null;   // { sheetDate, weapons: [2018 rows] }
let itemIds = null;    // { name: Census item_id | null }
let recoil = null;     // recoil.json (null when it failed to load)
let version = "current"; // 'current' | 'hist'
let stance = "ads";      // 'ads' | 'hip'
let posture = "stand";   // 'stand' | 'crouch'
let loaded = null;       // the loaded 2018 row (version-independent identity)

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

function applyWeapon(row) {
  loaded = row;
  const rec = recordFor(row);
  const p = paramsFor(rec, stance, posture);
  $("gunName").textContent = row.n;
  $("gunMeta").textContent = `${row.f} · ${row.c} · ${rec?.rpm ? rec.rpm + " RPM" : "RPM —"} · ${stance === "ads" ? tr("adad.ads", "ADS") : tr("adad.hip", "Hipfire")}, ${posture === "stand" ? tr("adad.stand", "standing") : tr("adad.crouch", "crouching")}`;
  $("inStill").value = p?.still === null || p?.still === undefined ? "" : fmt(p.still);
  $("inMove").value = p?.move === null || p?.move === undefined ? "" : fmt(p.move);
  $("inBloom").value = p?.bloom === null || p?.bloom === undefined ? "" : fmt(p.bloom);
  $("inRpm").value = p?.rpm ?? "";
  $("inMax").value = p?.max === null || p?.max === undefined ? "" : fmt(p.max);
  compute();
}

function setStance(s) {
  stance = s;
  $("btnAds").setAttribute("aria-checked", String(s === "ads"));
  $("btnHip").setAttribute("aria-checked", String(s === "hip"));
  if (loaded) applyWeapon(loaded); else compute();
}

function setPosture(p) {
  posture = p;
  $("btnStand").setAttribute("aria-checked", String(p === "stand"));
  $("btnCrouch").setAttribute("aria-checked", String(p === "crouch"));
  if (loaded) applyWeapon(loaded); else compute();
}

function num(id) {
  const v = parseFloat($(id).value);
  return Number.isNaN(v) ? null : v;
}

function compute() {
  const still = num("inStill"), move = num("inMove"), bloom = num("inBloom"),
    rpm = num("inRpm"), maxC = num("inMax");
  const tbody = document.querySelector("#shotTable tbody");
  if (still === null || move === null || bloom === null) {
    $("nBig").textContent = "–";
    $("nWhat").textContent = tr("adad.verdict.empty", "Enter still minimum, moving minimum and bloom per shot to get the count.");
    $("nFormula").textContent = "";
    tbody.innerHTML = ""; $("finals").innerHTML = ""; $("chart").innerHTML = ""; $("resetBox").innerHTML = "";
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

function rowHtml(row) {
  const rec = recordFor(row);
  const ads = paramsFor(rec, "ads", "stand"), hip = paramsFor(rec, "hip", "stand");
  const pin = PINNED.includes(row.n);
  return `<tr data-name="${esc(row.n)}"${pin ? ' class="pin"' : ""}>`
    + `<td class="namecell" data-l="${esc(tr("adad.col.weapon", "Weapon"))}">${esc(row.n)}${pin ? ` <span class="tag">${esc(tr("adad.pin", "worked example"))}</span>` : ""}</td>`
    + `<td data-l="${esc(tr("adad.col.faction", "Faction"))}">${esc(row.f)}</td>`
    + `<td data-l="${esc(tr("adad.col.category", "Category"))}">${esc(row.c)}</td>`
    + `<td data-l="${esc(tr("adad.col.rpm", "RPM"))}">${rec?.rpm ?? "—"}</td>`
    + `<td class="raw" data-l="${esc(tr("adad.col.adsStill", "ADS still"))}">${fmt(ads?.still)}</td>`
    + `<td class="raw" data-l="${esc(tr("adad.col.adsMove", "ADS move"))}">${fmt(ads?.move)}</td>`
    + `<td class="raw" data-l="${esc(tr("adad.col.adsBloom", "ADS bloom"))}">${fmt(ads?.bloom)}</td>`
    + `<td class="n" data-l="${esc(tr("adad.col.freeAds", "Free ADS"))}">${nCell(ads?.still, ads?.move, ads?.bloom)}</td>`
    + `<td class="raw" data-l="${esc(tr("adad.col.hipStill", "Hip still"))}">${fmt(hip?.still)}</td>`
    + `<td class="raw" data-l="${esc(tr("adad.col.hipMove", "Hip move"))}">${fmt(hip?.move)}</td>`
    + `<td class="raw" data-l="${esc(tr("adad.col.hipBloom", "Hip bloom"))}">${fmt(hip?.bloom)}</td>`
    + `<td class="n" data-l="${esc(tr("adad.col.freeHip", "Free hip"))}">${nCell(hip?.still, hip?.move, hip?.bloom)}</td></tr>`;
}

function renderTable() {
  if (!data2018) return;
  const q = ($("q").value || "").toLowerCase();
  const fac = $("fFac").value, cat = $("fCat").value;
  const rows = data2018.weapons.filter((w) =>
    (!q || w.n.toLowerCase().includes(q)) && (!fac || w.f === fac) && (!cat || w.c === cat));
  const pinned = rows.filter((w) => PINNED.includes(w.n)).sort((a, b) => PINNED.indexOf(a.n) - PINNED.indexOf(b.n));
  const rest = rows.filter((w) => !PINNED.includes(w.n)).sort((a, b) => a.n.localeCompare(b.n));
  document.querySelector("#wtable tbody").innerHTML = [...pinned, ...rest].map(rowHtml).join("");
  $("rowCount").textContent = tr("adad.count", "{shown} of {total} weapons", { shown: nf(rows.length), total: nf(data2018.weapons.length) });
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
  $("adadVerCur").addEventListener("click", () => setVersion("current"));
  $("adadVerHist").addEventListener("click", () => setVersion("hist"));
  for (const id of ["q", "fFac", "fCat"]) $(id).addEventListener("input", renderTable);
  document.querySelector("#wtable tbody").addEventListener("click", (e) => {
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
