/**
 * weapon-guide.html: one guide for every weapon, computed from the same Census snapshot as the comparison
 * page (assets/weapons/*.json), so it never goes stale and nothing is written per weapon. Replaced the 189
 * hand-written weapon-sage-*.html pages and weapon-handling-advanced.html (owner 2026-11-22: "perfection is
 * reached when nothing more can be taken away"): four rules on top (moving, jumping, hip-fire, range), the
 * seven ways to fire ranked by how far they still hit the body, the weapon against its whole class over
 * range, and the class table (who wins which share of ranges). The maths is weapon-traits.mjs (cones) and
 * weapons-model.mjs (exact time to kill). ?w=<item id>, ?n=<old guide slug>, ?c=<weapon type>.
 */
import { t as tr, currentLang, ready } from "./i18n.mjs";
import { toProfile } from "./replay/weapons.mjs";
import { rangeAxis, ttkCurve, withCadence } from "./weapons-model.mjs?v=20261112-pellet1";
import { pelletConeRaw } from "./weapon-sim.mjs?v=20261112-pellet1";
import { verdict, classStanding, slugOf } from "./weapon-traits.mjs?v=20261122-guide1";

const FACTION = { 0: "NS", 1: "VS", 2: "NC", 3: "TR" };
const MODE_EN = { auto: "Automatic", semi: "Semi-auto", burst: "Burst", bolt: "Bolt action" };
const WAY_EN = { adsStill: "Aim, standing", adsCrouch: "Aim, crouched", adsMove: "Aim, moving", adsAir: "Aim, jumping", hipStill: "Hip, standing", hipMove: "Hip, moving", hipAir: "Hip, jumping" };
// old guide slugs that are not the weapon name's slug
const SLUG_ALIAS = { "gd22s": 7233, "equinox-ve2-burst": 7150, "moonshot": 1969 };
const OPT = { acc: 1, hsr: 0, hp: 1000 };      // the class race: every shot a body hit, 1,000 health
const NEAR = 0.1;                              // "within 10 % of the fastest"

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = (v, d = 0) => Number(v).toLocaleString(currentLang(), { maximumFractionDigits: d, minimumFractionDigits: d });
const fmtM = (v) => (v == null ? "–" : v > 999 ? "999+ m" : tr("wc.m", "{m} m", { m: nf(v) }));
const pct = (x) => nf(Math.round(x * 100));
const med = (xs) => { const s = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };

async function boot() {
  await ready;
  let catalog, profiles, cadence, recoil;
  try {
    const get = (f) => fetch(f).then((r) => { if (!r.ok) throw new Error(f); return r.json(); });
    const [c, p, cd, rc] = await Promise.all([get("assets/weapons/catalog.json"), get("assets/weapons/profiles.json"),
      get("assets/weapons/cadence.json").catch(() => null), get("assets/weapons/recoil.json")]);
    catalog = c.items; profiles = p.profiles; cadence = (cd && cd.cadence) || {}; recoil = rc;
  } catch {
    $("wgStatus").textContent = tr("wg.loadFail", "Weapon data could not be loaded."); $("wgStatus").classList.add("err");
    return;
  }

  // every weapon with a fire profile and cone data
  const weapons = new Map();
  for (const [id, tuple] of Object.entries(profiles)) {
    const item = catalog[id], r = recoil.weapons[id];
    const p = item && withCadence(toProfile(tuple), cadence[id], item[0]);
    if (!p || !r) continue;
    const hip = recoil.groups[r[1]] || [], ads = (r[4] && recoil.groups[r[4]]) || [];
    const spread = { hip: pelletConeRaw(recoil, id, true).spread, ads: ads.length ? pelletConeRaw(recoil, id, false).spread : 0 };
    const v = verdict(hip, ads, recoil.handling[id], spread);
    // cosmetic variants ("Apex", AE, G …) carry the same numbers: one key collapses them in the class table
    const twin = `${item[2]}|${JSON.stringify(tuple)}|${JSON.stringify(cadence[id] || null)}|${v.ways.map((x) => x.cone).join(",")}`;
    weapons.set(+id, { id: +id, name: item[0], cat: item[1], fac: item[2], img: item[3], p, v, twin });
  }
  const sorted = [...weapons.values()].sort((a, b) => a.name.localeCompare(b.name));
  const byCat = new Map();
  for (const w of sorted) (byCat.get(w.cat) || byCat.set(w.cat, []).get(w.cat)).push(w);
  const cats = [...byCat.keys()].sort();
  const bySlug = new Map(sorted.map((w) => [slugOf(w.name), w]));
  const label = (w) => `${w.name} · ${FACTION[w.fac] ?? ""} · ${w.cat}`;
  const byLabel = new Map(sorted.map((w) => [label(w).toLowerCase(), w]));

  // the class race over range, once per class
  const race = new Map();
  function raceOf(cat) {
    if (race.has(cat)) return race.get(cat);
    const ws = byCat.get(cat) || [];
    const max = ws.some((w) => w.p.rangeMinDmg > 100) ? 200 : 100;
    const xs = rangeAxis(max, max > 100 ? 4 : 2);
    const curves = ws.map((w) => ttkCurve(w.p, xs, { ...OPT, ...pelletConeRaw(recoil, w.id, !w.v.ads) }));
    const best = xs.map((_, k) => { let lo = null; for (const c of curves) if (c[k] != null && (lo == null || c[k] < lo)) lo = c[k]; return lo; });
    const stand = new Map(ws.map((w, i) => [w.id, classStanding(curves, i, NEAR)]));
    const out = { ws, xs, max, curves, best, stand };
    race.set(cat, out);
    return out;
  }
  const bandText = (r, s) => (!s.band ? "–" : s.band.from === s.band.to ? fmtM(r.xs[s.band.from]) : `${nf(r.xs[s.band.from])}–${fmtM(r.xs[s.band.to])}`);

  // ------------------------------------------------------------ state + picker --
  const q = new URLSearchParams(location.search);
  let cur = weapons.get(+q.get("w")) || bySlug.get(q.get("n") || "") || weapons.get(SLUG_ALIAS[q.get("n")]) || null;
  let cat = cur ? cur.cat : cats.includes(q.get("c")) ? q.get("c") : "";
  const catSel = $("wgCat");
  const fillCats = () => {
    catSel.innerHTML = `<option value="">${esc(tr("wc.allCats", "All types"))}</option>` + cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    catSel.value = cat;
  };
  const fillList = () => { $("wgList").innerHTML = sorted.filter((w) => !cat || w.cat === cat).map((w) => `<option value="${esc(label(w))}"></option>`).join(""); };
  const pushUrl = () => {
    const u = new URLSearchParams();
    if (cur) u.set("w", cur.id); else if (cat) u.set("c", cat);
    history.replaceState(null, "", location.pathname + (u.toString() ? "?" + u : ""));
  };
  function pick(w) { cur = w; cat = w ? w.cat : cat; catSel.value = cat; fillList(); pushUrl(); render(); window.scrollTo({ top: 0 }); }
  catSel.addEventListener("change", () => { cat = catSel.value; cur = null; $("wgSearch").value = ""; fillList(); pushUrl(); render(); });
  const fromInput = () => {
    const raw = $("wgSearch").value.trim().toLowerCase();
    if (!raw) return;
    const w = byLabel.get(raw) || sorted.find((x) => x.name.toLowerCase() === raw);
    if (w) { $("wgSearch").value = ""; $("wgStatus").textContent = ""; pick(w); }
  };
  $("wgSearch").addEventListener("change", fromInput);
  $("wgSearch").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    fromInput();
    if ($("wgSearch").value.trim()) $("wgStatus").textContent = tr("wg.notFound", "No weapon called “{name}”.", { name: $("wgSearch").value.trim() });
  });
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-w], tr[data-c]");
    if (!a || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    if (a.dataset.w) pick(weapons.get(+a.dataset.w));
    else { cat = a.dataset.c; cur = null; catSel.value = cat; fillList(); pushUrl(); render(); }
  });

  // ------------------------------------------------------------ one weapon --
  const wayName = (w) => tr("wg.way." + w, WAY_EN[w]);
  function rules(w) {
    const v = w.v, r = raceOf(w.cat), s = r.stand.get(w.id), out = [];
    const tile = (icon, head, big, line) => `<div class="wg-rule"><span class="wg-ri" aria-hidden="true">${icon}</span><div><span class="wg-rh">${esc(head)}</span><b class="wg-rb">${esc(big)}</b><p>${esc(line)}</p></div></div>`;
    // 1. moving: the one that matters most (SMGs and most pistols aim on the move for free)
    if (v.ads) {
      const free = v.strafeFree, extra = free ? 0 : (v.moveX - 1);
      out.push(tile("🏃", tr("wg.r.move", "Moving while aiming"), free ? tr("wg.free", "free") : "+" + pct(extra) + " %",
        free ? tr("wg.r.moveFree", "Aim and keep moving: strafing costs no accuracy.")
          : tr("wg.r.moveCost", "Stop or crouch to shoot: moving makes the aimed cone {pct}% wider.", { pct: pct(extra) })));
    } else {
      out.push(tile("🏃", tr("wg.r.move", "Moving while aiming"), "–", tr("wg.r.noAds", "No aim-down-sights mode: hip-fire only.")));
    }
    // 2. jumping, against the way you would fire on the ground while moving
    const ground = v.ways.find((x) => x.way === (v.ads ? "adsMove" : "hipMove"));
    if (v.airM != null && ground) {
      out.push(tile("🦘", tr("wg.r.air", "Jumping"), fmtM(v.airM),
        tr("wg.r.airLine", "In the air shots hit the body only inside {m} m: a cone {x}× wider than “{way}” ({m2}). Jump to dodge, land to shoot.",
          { m: nf(v.airM), x: nf(v.airX, v.airX < 10 ? 1 : 0), way: wayName(ground.way), m2: fmtM(ground.reach) })));
    }
    // 3. hip-fire
    if (v.ads && v.hipM != null) {
      const same = v.hipM >= v.adsMoveM * 0.95;
      out.push(tile("🔫", tr("wg.r.hip", "Hip-fire"), fmtM(v.hipM), same ? tr("wg.r.hipEqual", "Hip-fire on the move is as accurate as aiming: no need to aim.")
        : tr("wg.r.hipLine", "Hip-fire on the move holds the body to {m} m. Farther, aim: it takes {ms} ms.", { m: nf(v.hipM), ms: nf(v.adsMs ?? 150) })));
    }
    // 4. range: the share of the class race it wins
    out.push(tile("📏", tr("wg.r.range", "Range"), pct(s.best) + " %", s.band
      ? tr("wg.r.rangeLine", "Fastest in its class at {pct}% of 0–{max} m. Within 10% of the best from {band}.", { pct: pct(s.best), max: nf(r.max), band: bandText(r, s) })
      : tr("wg.r.rangeNone", "Never within 10% of the class best at 0–{max} m.", { max: nf(r.max) })));
    return out.join("");
  }

  function ways(w) {
    const top = Math.sqrt(Math.min(150, Math.max(...w.v.ways.map((x) => Math.min(150, x.reach)))));
    return `<ol class="wg-ways">` + w.v.ways.map((x, i) => {
      const f = Math.sqrt(Math.min(150, x.reach)) / top;
      const kind = /Air$/.test(x.way) ? "air" : x.ads ? "ads" : "hip";
      return `<li class="wg-way wg-${kind}${i === 0 ? " wg-top" : ""}"><span class="wg-wl">${esc(wayName(x.way))}</span>`
        + `<span class="wg-bar"><i style="width:${(f * 100).toFixed(1)}%"></i></span><b>${esc(fmtM(x.reach))}</b>`
        + `<span class="wg-cone">${esc(tr("wc.deg", "{v}°", { v: nf(x.cone, 2) }))}</span></li>`;
    }).join("") + `</ol>`;
  }

  function rangeChart(w) {
    const r = raceOf(w.cat), i = r.ws.indexOf(w), mine = r.curves[i], { xs, best, max } = r;
    const W = 560, H = 230, L = 50, R = 12, T = 10, B = 52;
    const vals = [...mine, ...best].filter((v) => v != null);
    const yTop = Math.ceil((Math.max(100, ...vals) * 1.1) / 100) * 100;
    const X = (x) => L + (x / max) * (W - L - R), Y = (v) => T + (1 - v / yTop) * (H - T - B);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(tr("wg.ariaRange", "Graph: time to kill by range against the class best"))}" xmlns="http://www.w3.org/2000/svg">`;
    s += `<rect class="plot" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/>`;
    for (let k = 0; k <= 4; k++) { const v = (yTop / 4) * k; s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${L - 5}" y="${Y(v) + 4}" text-anchor="end">${nf(v)}</text>`; }
    for (let k = 0; k <= 5; k++) { const x = (max / 5) * k; s += `<text class="ax" x="${X(x)}" y="${H - B + 14}" text-anchor="middle">${nf(x)}</text>`; }
    const path = (c) => c.map((v, k) => (v == null ? "" : `${k && c[k - 1] != null ? "L" : "M"}${X(xs[k]).toFixed(1)} ${Y(v).toFixed(1)}`)).join("");
    s += `<path d="${path(best)}" class="wg-best"/><path d="${path(mine)}" class="wg-mine"/>`;
    const cw = (W - L - R) / (xs.length - 1);
    mine.forEach((v, k) => {
      const lo = best[k], cls = v == null ? "wg-s0" : v <= lo * 1.005 ? "wg-s2" : v <= lo * (1 + NEAR) ? "wg-s1" : "wg-s0";
      const x = Math.max(L, X(xs[k]) - cw / 2), x2 = Math.min(W - R, X(xs[k]) + cw / 2);
      s += `<rect class="${cls}" x="${x.toFixed(1)}" y="${H - B + 22}" width="${(x2 - x).toFixed(1)}" height="9"/>`;
    });
    s += `<text class="ax" x="${W - R}" y="${H - 4}" text-anchor="end">${esc(tr("wc.xRange", "Range (m)"))}</text></svg>`;
    return s + `<div class="wc-legend"><span><span class="sw wg-sw-mine"></span>${esc(w.name)}</span><span><span class="sw wg-sw-best"></span>${esc(tr("wg.classBest", "Class best"))}</span></div>`;
  }

  function idCard(w) {
    const r = raceOf(w.cat);
    const rival = r.ws.filter((x) => x !== w).sort((a, b) => r.stand.get(b.id).best - r.stand.get(a.id).best)[0];
    const mode = tr("wc.mode." + w.p.mode, MODE_EN[w.p.mode] || w.p.mode) + (w.p.pellets > 1 ? " · " + tr("wc.pellets", "{n} pellets", { n: nf(w.p.pellets) }) : "");
    return `<img src="assets/weapons/${w.img}.webp" alt="" width="112" height="56" onerror="this.style.visibility='hidden'" />`
      + `<div class="wg-idtxt"><h2>${esc(w.name)}</h2><span class="wc-wmeta">${esc(FACTION[w.fac] ?? "")} · ${esc(w.cat)} · ${esc(mode)}</span></div>`
      + (rival ? `<a class="wc-guide" href="weapon-compare.html?w=${w.id},${rival.id}" title="${esc(tr("wg.compareTip", "Opens the comparison with the weapon that wins the most ranges in this class"))}">${esc(tr("wg.compare", "⚖️ Compare with {name}", { name: rival.name }))}</a>` : "");
  }

  // ------------------------------------------------------------ tables --
  const th = (k, en) => `<th scope="col">${esc(tr(k, en))}</th>`;
  function classTable(c) {
    const r = raceOf(c);
    // one row per set of identical twins, named by its shortest name (the chosen weapon names its own row)
    const sets = new Map();
    for (const w of r.ws) (sets.get(w.twin) || sets.set(w.twin, []).get(w.twin)).push(w);
    const rows = [...sets.values()].map((g) => ({ w: g.includes(cur) ? cur : [...g].sort((a, b) => a.name.length - b.name.length)[0], g }))
      .sort((a, b) => r.stand.get(b.w.id).best - r.stand.get(a.w.id).best || r.stand.get(b.w.id).near - r.stand.get(a.w.id).near);
    $("wgClassH").textContent = tr("wg.h.class", "{cat}: who wins which share of 0–{max} m", { cat: c, max: nf(r.max) });
    $("wgClass").innerHTML = `<thead><tr><th scope="col">#</th>${th("wg.col.weapon", "Weapon")}${th("wg.col.best", "Fastest")}${th("wg.col.near", "Within 10 %")}${th("wg.col.band", "Best range")}${th("wg.col.move", "Moving cost")}${th("wg.col.hip", "Hip moving")}${th("wg.col.air", "Jumping")}</tr></thead><tbody>`
      + rows.map(({ w, g }, i) => {
        const s = r.stand.get(w.id), v = w.v;
        const others = g.filter((x) => x !== w).map((x) => x.name);
        const more = others.length ? ` <span class="wg-more" title="${esc(tr("wg.sameAs", "Same numbers: {names}", { names: others.join(", ") }))}">+${nf(others.length)}</span>` : "";
        const move = !v.ads ? "–" : v.strafeFree ? tr("wg.free", "free") : "+" + pct(v.moveX - 1) + " %";
        return `<tr${g.includes(cur) ? ' class="wg-cur"' : ""}><td>${i + 1}</td><td class="wg-name"><a href="?w=${w.id}" data-w="${w.id}">${esc(w.name)}</a>${more} <span class="wc-wmeta">${esc(FACTION[w.fac] ?? "")}</span></td>`
          + `<td>${pct(s.best)} %</td><td>${pct(s.near)} %</td><td>${esc(bandText(r, s))}</td><td>${esc(move)}</td><td>${esc(fmtM(v.hipM))}</td><td>${esc(fmtM(v.airM))}</td></tr>`;
      }).join("") + `</tbody>`;
  }
  function typesTable() {
    $("wgClassH").textContent = tr("wg.h.classes", "Every weapon type: how it wants to be fired");
    $("wgClass").innerHTML = `<thead><tr>${th("wg.col.type", "Type")}${th("wg.col.n", "Weapons")}${th("wg.col.free", "Strafe-free aim")}${th("wg.col.adsMove", "Aim moving")}${th("wg.col.hip", "Hip moving")}${th("wg.col.air", "Jumping")}</tr></thead><tbody>`
      + cats.map((c) => {
        const ws = byCat.get(c), a = ws.filter((w) => w.v.ads);
        return `<tr data-c="${esc(c)}" class="wg-click"><td class="wg-name"><a href="?c=${encodeURIComponent(c)}">${esc(c)}</a></td><td>${nf(ws.length)}</td>`
          + `<td>${a.length ? pct(a.filter((w) => w.v.strafeFree).length / a.length) + " %" : "–"}</td><td>${esc(fmtM(med(a.map((w) => w.v.adsMoveM))))}</td>`
          + `<td>${esc(fmtM(med(ws.map((w) => w.v.hipM))))}</td><td>${esc(fmtM(med(ws.map((w) => w.v.airM))))}</td></tr>`;
      }).join("") + `</tbody>`;
  }

  function render() {
    $("wgWeapon").hidden = !cur;
    if (cur) {
      document.title = `📖 ${cur.name} · ${tr("wg.title", "📖 Weapon guide").replace(/^📖\s*/, "")}`;
      $("wgId").innerHTML = idCard(cur);
      $("wgRules").innerHTML = rules(cur);
      $("wgWays").innerHTML = ways(cur);
      $("wgRangeH").textContent = tr("wg.h.range", "Against every {cat}", { cat: cur.cat });
      $("wgRange").innerHTML = rangeChart(cur);
    }
    if (cat) classTable(cat); else typesTable();
  }

  fillCats(); fillList(); render();
  window.addEventListener("ps2-lang", () => { fillCats(); render(); });
}

boot();
