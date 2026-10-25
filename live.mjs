import { t as tr, ready as i18nReady } from "./i18n.mjs";
await i18nReady;
/**
 * 🎥 Live feed (live.html). Follows the first name's kills and deaths from the
 * Census event stream (Death events, one character) and:
 *   - owner t575u layout (replaces the t557u–t572u two-player rows that flipped A/B): a narrow, fixed overlay
 *     centred on the tracked player — ONE line above for the latest player who killed them (each new killer
 *     replaces it), the tracked player on the centre line, and the last 6 players they killed below
 *     (newest on top; t587u: every kill is its own line, the same victim twice = two lines);
 *   - every line shows everything at once, in one shared column order: [⏱️][name][iVi][inf/zerg%] (owner 2026-10-25:
 *     the emoji meters are parked — the six 🏃🦁🛡️🪖☠️🪳 columns became one plain "infantry % over zerg score" cell;
 *     their machinery — pre-drawn sprite pictures (live-sprites.mjs), fills, glow tiers, halo button, 30 fps ticker —
 *     stays in place, dormant, for the owner's later emoji revisit) — no flip, no skill graph;
 *   - owner 2026-10-25: no weapon icon — the weapon's name sits under the player name (small, dim) and a headshot
 *     is a small custom mark after the name (a head with a bullet in and out); the upset shake on a line is kept
 *     (it is a signal, not decoration);
 *   - a missing stat is an empty (hollow, t589u) emoji, never "—" (t567u); uncached opponents show all-empty emojis
 *     (Census K/D · KPM only in the name's hover title), then get a full 200-opponent Census
 *     fetch in the background (one at a time, newest first, #32) and upgrade in place.
 * Pure helpers are exported for tests; the DOM part runs only in a browser.
 */
export * from "./live-model.mjs?v=20261025-bnt1"; // #66: the pure part (tests import it from here)
import { VICTIM_LINES, classifyDeath, fmtGap, censusStats, LIVE_COLS, tipText, FILL_DIM, HOLLOW_PX, HOLLOW_INK, goodPct, fillDriver, emojiFill, unknownFill, infUnit, OUTLINE_PX, unitGlow, LIVE_GLOWS, LIVE_FPS, liveFps, HALO_KEY, haloOn, easeFill, glowIn, BEAT, TIER_MOTION, haloAt, SHINE, shineFrame, beatSleep, weaponIcon, glowTier, eventAt, overlayPush, overlayRows, nextBgFetch, liveRowFromPlayer, ME_REFRESH_MS, mergeFresh, SHARE_MAX, shareDelay, cellText, slugKey, bountyNext } from "./live-model.mjs?v=20261025-bnt1";
import { CENSUS_SERVICE_ID } from "./config.mjs?v=20261010-sav1";
import { isPenalizedPadder, POOP_MARK, POOP_TIP } from "./padding.mjs?v=20261023-short1";
import { percentileOf } from "./dist.mjs?v=20261010-sav1";
import { traitPools, zergScore } from "./trait-scores.mjs?v=20261024-crowd1";
import { zergEstimate } from "./zerg-revive.mjs?v=20261024-crowd1";
import { infMedian, tractorCuts, TRACTOR_EMOJI } from "./tractor.mjs?v=20261024-trac1";
import { drawEmojiSprite, spriteCss } from "./live-sprites.mjs?v=20261024-beat1";
import { trendSeries, trendColors, drawTrends as paintTrends, drawTrendsSkeleton as paintSkeleton } from "./live-trends.mjs?v=20261025-grf1";

const CENSUS = `https://census.daybreakgames.com/s:${CENSUS_SERVICE_ID}/get/ps2:v2/`;
const STREAM = `wss://push.planetside2.com/streaming?environment=ps2&service-id=s:${CENSUS_SERVICE_ID}`;
const FACTION = { 1: "vs", 2: "nc", 3: "tr", 4: "nso" };

/* ---------------- browser part ---------------- */
if (typeof window !== "undefined" && typeof document !== "undefined") start();

function start() {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (id) => document.getElementById(id);
  const target = (new URLSearchParams(location.search).get("names") || "").split(",")[0].trim();
  const stateEl = $("liveState");
  const listEl = $("liveList");
  // Owner 2026-10-24 (CPU): the t579u outline, the t589u hollow and the t568u glows are drawn once per size into
  // images (live-sprites.mjs) instead of SVG filters re-run on every frame. One <style> holds them (class lv-x<i>
  // per emoji); a resize that changes the emoji size or the screen density redraws them.
  const spriteSheet = document.createElement("style");
  spriteSheet.id = "lvSprites";
  document.head.appendChild(spriteSheet);
  if (listEl) {
    listEl.style.setProperty("--lv-n", String(LIVE_COLS.length - 1)); // emoji units per line (owner t590u: 6)
    // Owner t584u: hover any emoji (or the iVi number) → its real value ("K/D 2.40", "Zerg 41", "Diff unknown").
    // One floating box, fixed position, no pointer events — the overlay layout never changes.
    const tipEl = document.createElement("div");
    tipEl.className = "lv-tip";
    tipEl.hidden = true;
    document.body.appendChild(tipEl);
    const place = (e) => { tipEl.style.left = `${e.clientX + 12}px`; tipEl.style.top = `${e.clientY + 14}px`; };
    listEl.addEventListener("mouseover", (e) => {
      const t = e.target.closest && e.target.closest("[data-tip]");
      if (!t || !listEl.contains(t)) { tipEl.hidden = true; return; }
      tipEl.textContent = t.dataset.tip;
      tipEl.hidden = false;
      place(e);
    });
    listEl.addEventListener("mousemove", (e) => { if (!tipEl.hidden) place(e); });
    listEl.addEventListener("mouseleave", () => { tipEl.hidden = true; });
  }
  const setState = (html, cls = "") => { if (stateEl) { stateEl.innerHTML = html; stateEl.className = "live-state " + cls; } };
  if (!target) { setState("Add a name on the main page, then press 🎥.", "err"); return; }

  const people = new Map(); // cid -> { name, faction, kd, cached: {adjs, kd} | null }
  let st = { killer: null, victims: [], lastEv: null, gone: null }; // owner t575u overlay state (overlayPush)
  let me = null; // { cid, name, faction }
  let ranks = null; // slug -> { adjs, kd }
  const pools = {}; // col id -> sorted finite values (percentiles, same as the Rankings table)
  let infM = null; // median infantry % over ranks.json (owner t590u: 🪖 fill starts here)
  let infC = null; // 🚜 infantry cut (owner t622u: ranks.json "tracCuts".cut, p25 of the data; 🚜 below it)

  const app = () => window.__ps2EliteKd || null;

  async function getJson(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  let ranksP = null;
  function loadRanks() { return ranksP || (ranksP = loadRanksOnce()); }
  async function loadRanksOnce() {
    try {
      const j = await getJson("data/ranks.json");
      const ci = (c) => j.cols.indexOf(c);
      const iS = ci("slug"), iN = ci("name");
      const idx = LIVE_COLS.map((c) => [c.id, ci(c.id)]).concat([["vcut", ci("vcut")], ["infVeh", ci("infVeh")], ["infMax", ci("infMax")]]);
      ranks = new Map(j.rows.map((r) => {
        const o = { name: r[iN] };
        for (const [id, i] of idx) o[id] = i >= 0 ? r[i] : null;
        return [r[iS], o];
      }));
      // 🪳 Zerg: same score as the Rankings table (rankings.mjs: traitPools over ranks.json, zergScore per row).
      const colOf = (id) => (ci(id) >= 0 ? j.rows.map((r) => r[ci(id)]) : []);
      const tp = traitPools({ adjs: colOf("adjs"), ivi: colOf("ivi"), inflation: colOf("inflation"), apk: colOf("apk") });
      const iF = ci("inflation"), iA = ci("apk"), iR = ci("rvp"), iC = ci("crp");
      const zergOf = (r) => { const z = zergScore(tp, iF >= 0 ? r[iF] : null, iA >= 0 ? r[iA] : null, iR >= 0 ? r[iR] : null, iC >= 0 ? r[iC] : null); return z ? z.score : null; };
      const fin = (v) => typeof v === "number" && Number.isFinite(v);
      const zergCol = j.rows.map(zergOf);
      j.rows.forEach((r, k) => { const o = ranks.get(r[iS]); if (o) o.zerg = zergCol[k]; });
      // 🪳 "~N" estimate (zerg-revive.mjs zergEstimate) where there is no Zerg: fill + hover only, never in the pool.
      j.rows.forEach((r, k) => { const o = ranks.get(r[iS]); if (o && zergCol[k] == null) o.zest = zergEstimate(iR >= 0 ? r[iR] : null, iC >= 0 ? r[iC] : null); });
      for (const c of LIVE_COLS) {
        const vals = c.id === "zerg" ? zergCol : colOf(c.id);
        pools[c.id] = vals.filter(fin).sort((a, b) => a - b);
      }
      infM = infMedian(pools.inf); // owner t590u: 🪖 fill start, from the data (85.1 on 2026-10-24)
      infC = j.tracCuts && Number.isFinite(j.tracCuts.cut) ? j.tracCuts.cut : tractorCuts(pools.inf, []).cut; // owner t622u: 🚜 below the build's cut
    } catch { ranks = new Map(); }
  }
  async function person(cid) {
    if (people.has(cid)) return people.get(cid);
    const p = { name: `#${cid}`, faction: "", kd: null, kpm: null, cached: null };
    people.set(cid, p);
    try {
      const j = await getJson(`${CENSUS}character?character_id=${cid}&c:show=character_id,name.first,faction_id&c:resolve=stat_history(stat_name,all_time)`);
      const ch = (j.character_list || [])[0];
      if (ch) {
        p.name = (ch.name && ch.name.first) || p.name;
        p.faction = FACTION[ch.faction_id] || "";
        Object.assign(p, censusStats(ch));
      }
    } catch { /* keep #id */ }
    if (!ranks) await loadRanks();
    const c = ranks.get(slugKey(p.name));
    if (c) p.cached = c;
    return p;
  }

  const fmt = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "—");
  const IVI = LIVE_COLS.filter((c) => c.mode === "ivi"); // the iVi number column
  const REST = LIVE_COLS.filter((c) => c.mode !== "ivi"); // the emoji columns, same order on every line (owner t575u)
  const shortLab = (c) => c.label.split(" ")[0];
  /** 💩 after a confirmed padder's name (padding.mjs): hover explains the −10% iVi penalty. */
  const poopFor = (name) => (isPenalizedPadder(name) ? `<span class="poop-mark" title="${esc(POOP_TIP)}" aria-label="${esc(POOP_TIP)}">${POOP_MARK}</span>` : "");
  const fillOf = (c, v) => emojiFill(c, v, percentileOf(pools[c.id] || [], v));
  /** Emoji unit (owner t564u): one-size emoji as a fill meter — the empty (hollow, outlined) picture with the solid
   *  picture on top, shown from the bottom up to the fill. The number is in the hover only.
   *  Owner t567u: no value (not cached, assist bug, no 🪖 data) = the same emoji at 0% (only the hollow part), never "—". */
  /** Owner t568u (replaces the t562u single p95 glow): three glow tiers by the fill driver (glowTier) — lv-g3 gold, lv-g2 blue, lv-g1 green. */
  const driverOf = (c, v) => fillDriver(c, v, percentileOf(pools[c.id] || [], v));
  const goodOf = (c, v) => { const pc = percentileOf(pools[c.id] || [], v); return pc == null ? null : goodPct(c, pc); };
  /**
   * Owner 2026-10-24 (CPU): each emoji is drawn once per size into images (live-sprites.mjs): lv-b = outline + hollow,
   * lv-s = the solid emoji inside the lv-sw window (moved by --f, so the fill shows the bottom f% of the ink — t564u),
   * lv-gl = the tier halo. Fills move these with transforms; nothing is re-filtered per frame.
   */
  const EMOJIS = [...new Set([...LIVE_COLS.map(shortLab), TRACTOR_EMOJI])]; // ⚔️ (an empty iVi), the meters and 🚜 (t590u)
  const emojiIdx = new Map(EMOJIS.map((e, i) => [e, i]));
  let spriteInfo = new Map(); // emoji → { w, h, it, ih, gp } in CSS px (ih drives the fill animation)
  let spriteKey = "";
  let spriteUrls = [];
  const lenPx = (v, rem, em) => { const m = /^\s*([\d.]+)(rem|px|em)\s*$/.exec(String(v || "")); return m ? +m[1] * (m[2] === "rem" ? rem : m[2] === "em" ? em : 1) : null; };
  async function drawSprites() {
    if (!listEl) return;
    try {
      const cs = getComputedStyle(listEl);
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const fe = lenPx(cs.getPropertyValue("--lv-fe"), rem, parseFloat(cs.fontSize) || rem) || 24;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const key = `${fe}|${dpr}`;
      if (key === spriteKey) return;
      spriteKey = key;
      const glows = LIVE_GLOWS.map((ls) => ls.map((l) => ({ ...l, blur: l.blur * rem })));
      const opts = { fontPx: fe, dpr, family: cs.fontFamily || "sans-serif", outlinePx: OUTLINE_PX, hollowPx: HOLLOW_PX, dim: FILL_DIM, hollowInk: HOLLOW_INK, glows, shineFrames: SHINE.frames };
      const list = [];
      for (const e of EMOJIS) list.push(await drawEmojiSprite(e, opts));
      const urls = list.flatMap((x) => (x ? [x.base, x.solid, x.shine, ...x.glow] : [])).filter((u) => u && u.startsWith("blob:"));
      if (key !== spriteKey) { urls.forEach((u) => URL.revokeObjectURL(u)); return; } // a newer size won meanwhile
      spriteSheet.textContent = spriteCss(list);
      spriteUrls.forEach((u) => URL.revokeObjectURL(u));
      spriteUrls = urls;
      spriteInfo = new Map(EMOJIS.map((e, i) => [e, list[i]]));
      listEl.classList.toggle("lv-nosprite", !list.some(Boolean));
      startFills(); // lines drawn before the pictures were ready start filling now
      wake();
    } catch {
      listEl.classList.add("lv-nosprite"); // no canvas: plain emojis (flat), the overlay still works
    }
  }
  let spriteTimer = 0;
  window.addEventListener("resize", () => { clearTimeout(spriteTimer); spriteTimer = setTimeout(drawSprites, 150); }); // size tiers, zoom
  drawSprites();
  const meter = (e) => `<span class="lv-em lv-x${emojiIdx.get(e)}" aria-hidden="true" data-e="${e}"><i class="lv-gl"></i><i class="lv-b"></i><i class="lv-sw"><i class="lv-s"><i class="lv-shn"></i></i></i></span>`;
  function unit(c, v, est = null) {
    const f = fillOf(c, v);
    // 🪳 estimate (owner t614u): no Zerg score, but a "~N" crowd estimate → the same fill a Zerg of N gets, gold, "~N" in the hover.
    if (f == null && c.id === "zerg" && typeof est === "number" && Number.isFinite(est)) {
      return `<span class="lv-u lv-fl lv-g${unitGlow(c, est)}" style="--f:${fillOf(c, est)}" data-tip="${esc(`${c.tip} ~${est} (estimate)`)}">${meter(shortLab(c))}</span>`;
    }
    if (f == null) { // no value: empty emoji, or (t569u) a full 🪳 — owner t577u: that full 🪳 gets the full top glow
      const u = unknownFill(c);
      const ug = unitGlow(c, null);
      return `<span class="lv-u lv-fl lv-nil${ug ? ` lv-g${ug}` : ""}" style="--f:${u}" data-tip="${esc(tipText(c, null))}">${meter(shortLab(c))}</span>`;
    }
    const iu = c.id === "inf" ? infUnit(v, infM, infC) : null; // owner t590u/t622u: 🚜 below the cut, empty 🪖 up to the median, 🪖 fill above
    if (iu) return `<span class="lv-u lv-fl${iu.glow ? ` lv-g${iu.glow}` : ""}${iu.tractor ? " lv-trac" : ""}" style="--f:${iu.fill}" data-tip="${esc(tipText(c, v))}">${meter(iu.emoji)}</span>`;
    const g = unitGlow(c, v, driverOf(c, v)); // t568u tiers from the fill's own driver; t577u: 🪳 > 35 = gold
    const top = g ? ` lv-g${g}` : "";
    return `<span class="lv-u lv-fl${top}" style="--f:${f}" data-tip="${esc(tipText(c, v))}">${meter(shortLab(c))}</span>`;
  }
  /** iVi number, no ⚔️ (owner t560u), no comma, 4 digits of room (t564u); no iVi (t567u) = an empty 25% ⚔️ in the same box. */
  function iviText(c, v) {
    if (fillOf(c, v) == null) return `<span class="lv-iv lv-nil" style="--f:0" data-tip="${esc(tipText(c, null))}">${meter(shortLab(c))}</span>`;
    return `<span class="lv-iv" data-tip="${esc(tipText(c, v))}">${cellText(c, v)}</span>`;
  }
  /** Name (faction colour) + 💩; a long name is cut with … at the end. Uncached: Census K/D · KPM in the hover. */
  function nameHtml(p, tip, hs = "") {
    return `<span class="lv-pn"><span class="lv-name fac-${p.faction || ""}" title="${esc(p.name + (tip || ""))}"><bdi>${esc(p.name)}</bdi></span>${poopFor(p.name)}${hs}</span>`;
  }
  /**
   * Owner t575u: one line = one player, everything at once (no flip), ONE shared column order for every line:
   *   [⏱️ time][name][iVi][🏃][🦁][🛡️][🪖|🚜][☠️][🪳] (t580u: 🪳 last; t590u order) — so the emojis line up down the whole overlay.
   * Owner t567u: not cached = all-empty emojis; the Census numbers stay in the name's hover.
   */
  /**
   * Owner 2026-10-25 (columns-only swap, per the owner's "for now"): the emoji
   * meters are parked — one plain cell, infantry % over zerg score, one % at
   * the end ("95/41%"). An unknown side is –, both unknown is an empty cell
   * (never a lone "—", t567u). Zerg falls back to the ~N estimate (t614) when
   * unscored. The emoji machinery (live-sprites, fills, glows, halo, ticker)
   * stays in place, dormant, for the owner's later emoji revisit.
   */
  function izHtml(vals) {
    const inf = vals.inf, scored = vals.zerg, est = scored == null ? vals.zest : null;
    const zg = scored ?? est;
    if (!Number.isFinite(inf) && !Number.isFinite(zg)) return `<td class="lv-iz"></td>`;
    const infS = Number.isFinite(inf) ? String(Math.round(inf)) : "–";
    const zgS = Number.isFinite(zg) ? (est != null ? `~${Math.round(zg)}` : String(Math.round(zg))) : "–";
    return `<td class="lv-iz" data-tip="Infantry ${infS}% · Zerg ${zgS}">${infS}/${zgS}%</td>`;
  }
  // Owner 2026-10-25: the tracked player's bounty, on their own (centre) line's
  // second row — one ❤️‍🔥 per kill of the current streak, capped at 7; at 7 the
  // streak becomes the bounty mark 💰, held for 3 deaths (bountyNext). The
  // centre line never carries a weapon, so its second line is free for this.
  let bountyStreak = 0, bountyLives = 0;
  function bountyHtml() {
    if (bountyLives > 0) return `<span class="lv-wn">💰</span>`;
    return `<span class="lv-wn">${"❤️‍🔥".repeat(bountyStreak)}</span>`; // repeat(0) = "" — an empty line, like before
  }
  function cells(p, isMe, r) {
    const vals = p.cached || {};
    const tip = p.cached || isMe ? "" : ` · not in cache · K/D ${fmt(p.kd, 2)} · KPM ${fmt(p.kpm, 2)}`;
    const w = r ? weaponIcon(catalog, r.weapon) : null; // owner 2026-10-25: the weapon's NAME under the player name (small, dim), not an icon
    const wn = isMe ? bountyHtml() : `<span class="lv-wn">${w ? esc(w.name) : ""}</span>`; // always rendered (empty when unknown), so the names stay lined up
    return `<td class="lv-nm"><span class="lv-nm2">${nameHtml(p, tip, hsHtml(r))}${wn}</span></td>${IVI.map((c) => `<td class="lv-ivc">${iviText(c, vals[c.id])}</td>`).join("")}${izHtml(vals)}`;
  }
  const blank = `<td class="lv-nm"></td><td class="lv-ivc"></td><td class="lv-iz"></td>`; // same box as a filled line, so the overlay never grows
  /**
   * Owner 2026-10-25: no weapon icon any more (its column is gone, the width went to the name column) — the weapon's
   * NAME sits under the player name (cells), and a headshot is a small custom mark after the name: a head with a
   * bullet in one side and out the other (inline SVG, no asset). On a victim line the weapon the tracked player
   * used, on the killer line the weapon that killed them. The headshot flag itself (classifyDeath is_headshot) is
   * untouched — only the free game-icons mark it used to draw is gone.
   */
  let catalog = null;
  fetch("assets/weapons/catalog.json", { cache: "force-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => { catalog = j; if (j && me && (st.killer || st.victims.length)) render(); })
    .catch(() => {});
  const HS_TIP = tr("live.hs", "Headshot");
  const HS_SVG = `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="0.5" y1="7" x2="15.5" y2="7" stroke="currentColor" stroke-width="1.2"/><circle cx="3.5" cy="7" r="1.4" fill="currentColor"/><path d="M12.5 4.5 15 2M12.5 9.5 15 12" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>`;
  function hsHtml(r) {
    return r && r.headshot ? `<span class="lv-hs2" role="img" aria-label="${esc(HS_TIP)}" data-tip="${esc(HS_TIP)}">${HS_SVG}</span>` : "";
  }
  /** Owner t562u juice: an upset = the winner's iVi percentile is ≥ UPSET_GAP points below the loser's → a short shake. */
  const UPSET_GAP = 50;
  const iviPct = (p) => { const c = IVI[0]; return p && p.cached ? goodOf(c, p.cached[c.id]) : null; };
  let shown = null; // the newest event that already played its entrance (a re-render must not replay it)
  let fresh = null;
  let goneShown = null; // the cleared killer whose fade-out already played
  /** Owner t578u: emoji fill grows 0 → level over FILL_MS when a line first shows (or its stats arrive later: the key
   *  changes from "u" to "c"). Re-renders pass the time already played as a negative delay, so nothing restarts. */
  const FILL_MS = 10000; // owner t588u: 10 s (was 5 s)
  const fillStart = new Map(); // line key → when its fill started
  const NO_FILL = { cls: "", sty: "" };
  function fillIn(key) {
    const now = Date.now();
    if (!fillStart.has(key)) {
      fillStart.set(key, now);
      if (fillStart.size > 300) fillStart.delete(fillStart.keys().next().value); // oldest first
    }
    const played = now - fillStart.get(key);
    return played >= FILL_MS ? NO_FILL : { cls: " lv-fillin", sty: ` data-fk="${esc(key)}"` };
  }
  /** ⏱️ the newest event runs (ticks every second), every older line shows its frozen gap (owner t576u). */
  const ageHtml = (r) => (r.gap == null ? `<span class="lv-timer" data-at="${r.at}">${fmtGap(Date.now() - r.at)}</span>` : fmtGap(r.gap));
  /** One opponent line: the killer above (lv-death) or a victim below (lv-kill). */
  function oppLine(r, where, extra = "") {
    const fi = extra ? NO_FILL : fillIn(`${r.opp}@${r.at}:${(people.get(r.opp) || {}).cached ? "c" : "u"}`);
    const p = people.get(r.opp) || { name: r.opp };
    const kill = r.last === "kill";
    const isNew = r === fresh;
    const wP = iviPct(kill ? me : p), lP = iviPct(kill ? p : me);
    const upset = isNew && wP != null && lP != null && lP - wP >= UPSET_GAP ? " lv-upset" : "";
    return `<tbody class="lv-ev lv-${where} lv-${r.last}${isNew ? " lv-new" : ""}${upset}${extra}${fi.cls}"${fi.sty}><tr><td class="lv-time">${ageHtml(r)}</td>${cells(p, false, r)}</tr></tbody>`;
  }
  const emptyLine = (where) => `<tbody class="lv-ev lv-${where} lv-empty"><tr><td class="lv-time"></td>${blank}</tr></tbody>`;
  function render() {
    if (!listEl) return;
    // Owner t575u: a fixed grid of 1 + 1 + VICTIM_LINES lines — killer above, the tracked player in the centre,
    // the players they killed below (newest on top). Empty slots keep their height, so the overlay never changes size.
    const cols = `<colgroup><col class="lv-c-time"><col class="lv-c-nm"><col class="lv-c-iv"><col class="lv-c-iz"></colgroup>`;
    const newest = st.lastEv || null;
    fresh = newest && newest !== shown ? newest : null;
    shown = newest;
    // owner t576u: a kill clears the killer line — the cleared killer fades out once, then the slot stays empty
    const fade = !st.killer && st.gone && st.gone !== goneShown;
    goneShown = st.gone;
    const atk = st.killer ? oppLine(st.killer, "atk") : fade ? oppLine(st.gone, "atk", " lv-out") : emptyLine("atk");
    const fm = fillIn(`me:${me.cached ? "c" : "u"}`);
    const mid = `<tbody class="lv-ev lv-me${fm.cls}"${fm.sty}><tr><td class="lv-time"></td>${cells(me, true)}</tr></tbody>`;
    const low = Array.from({ length: VICTIM_LINES }, (_, i) => (st.victims[i] ? oppLine(st.victims[i], "vic") : emptyLine("vic"))).join("");
    listEl.innerHTML = cols + atk + mid + low;
    collectMotion();
    startFills();
    wake();
  }
  const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  /**
   * Owner 2026-10-24: ONE ticker draws every moving part at FPS frames a second (LIVE_FPS 30; live.html?fps=60), and
   * sleeps when nothing moves. Per frame it only touches what changes: the solid picture's window while a line fills
   * (t578u/t588u, 10 s), the tier 2/3 halos' opacity/size (TIER_MOTION), and the gold shine's frame (SHINE).
   * Reduced motion: no ticker — final fills, steady halos, no shine.
   */
  const FPS = liveFps(new URLSearchParams(location.search).get("fps"));
  const FRAME_MS = 1000 / FPS;
  const fills = new Set(); // running fills: { u, sw, s, ih, from, to, t0, ms, glowLate }
  let halos = []; // tier ≥ 1 units on screen: { u, gl, tier, gw, op, sc }
  let shines = []; // gold units on screen: { el, off, last }
  let tickTimer = 0, tickAt = 0, frameDue = false, lastTick = 0;
  let maxOff = 0; // the last column's beat delay
  // ✨ halo switch (HALO_KEY / haloOn): a small button left of 🖥️ ⚙️ Settings; off hides halos + shine and stops the beat
  let halo = haloOn(new URLSearchParams(location.search).get("halo"), (() => { try { return localStorage.getItem(HALO_KEY); } catch { return null; } })());
  const haloBtn = document.createElement("button");
  haloBtn.type = "button";
  haloBtn.id = "lvHaloBtn";
  haloBtn.className = "lv-halo-btn";
  haloBtn.textContent = "✨";
  const syncHalo = () => {
    listEl.classList.toggle("lv-nohalo", !halo);
    haloBtn.setAttribute("aria-pressed", String(halo));
    const t = halo ? tr("live.haloOn", "✨ Halos on: rank glows and the gold shine. Click for no halos (lighter on slower PCs)") : tr("live.haloOff", "✨ Halos off (lighter on slower PCs). Click to show rank glows and the gold shine");
    haloBtn.title = t;
    haloBtn.setAttribute("aria-label", t);
  };
  haloBtn.addEventListener("click", () => {
    halo = !halo;
    try { localStorage.setItem(HALO_KEY, halo ? "1" : "0"); } catch { /* private mode: this page only */ }
    syncHalo();
    collectMotion();
    wake();
  });
  const roomBadgeEl = $("roomBadge"); // in the row with ⚙️ Settings, so the switch never adds a row
  if (roomBadgeEl && listEl) roomBadgeEl.insertAdjacentElement("beforebegin", haloBtn);
  if (listEl) syncHalo();
  function wake() {
    if (frameDue || !listEl || reduced()) return; // a frame is already on its way
    const now = performance.now();
    let wait = Math.max(0, lastTick + FRAME_MS - now - 2);
    if (!fills.size) {
      if (!halos.some((h) => h.tier >= 2)) return; // nothing moves: no frames at all
      wait = Math.max(wait, beatSleep(now, maxOff)); // between beats the overlay stands still
    }
    if (tickTimer) {
      if (now + wait >= tickAt - 1) return; // the sleep already ends soon enough
      clearTimeout(tickTimer); // a fill started while sleeping between beats: wake up sooner
    }
    tickAt = now + wait;
    tickTimer = setTimeout(() => { tickTimer = 0; frameDue = true; requestAnimationFrame(tick); }, wait);
  }
  /** After a render: which halos flare and which emojis shine (a wave along the line: each column a bit later).
   *  New halos get their current look at once, so a line drawn between beats already rests like the others. */
  function collectMotion() {
    halos = []; shines = []; maxOff = 0;
    for (const tb of listEl.querySelectorAll("tbody.lv-ev")) {
      [...tb.querySelectorAll(".lv-u")].forEach((u, ci) => {
        const tier = +((/ lv-g([123])\b/.exec(` ${u.className}`) || [])[1] || 0);
        if (!tier) return;
        const off = ci * BEAT.step; // the beat runs along the line, column by column
        maxOff = Math.max(maxOff, off);
        halos.push({ u, gl: u.querySelector(".lv-gl"), tier, off, gw: 1, op: "", sc: "" });
        if (tier === 3) shines.push({ el: u.querySelector(".lv-shn"), off, last: -1 });
      });
    }
    if (!halo) { halos = halos.filter((h) => h.tier < 2); shines = []; } // ✨ off: nothing to flare or shine
    if (reduced()) return;
    const now = performance.now();
    for (const h of halos) {
      if (!h.gl || h.tier < 2) continue;
      const { opacity, scale } = haloAt(h.tier, now, 1, h.off);
      h.op = opacity.toFixed(2); h.gl.style.opacity = h.op;
      h.sc = scale === 1 ? "" : `scale(${scale.toFixed(3)})`; h.gl.style.transform = h.sc;
    }
  }
  function tick() {
    const now = performance.now(); // not the frame's timestamp: some hosts hand out a stale one
    frameDue = false;
    lastTick = now;
    if (!listEl || reduced()) return;
    // 1) fills: the window moves down by (100 − f)% of the ink, the picture back up (no repaint)
    for (const a of fills) {
      if (!a.u.isConnected) { fills.delete(a); continue; }
      const k = Math.min(1, Math.max(0, (now - a.t0) / a.ms));
      const h = a.glowLate ? halos.find((x) => x.u === a.u) : null;
      if (k >= 1) {
        a.sw.style.transform = ""; a.s.style.transform = ""; // the static CSS position = the final fill
        if (h) h.gw = 1;
        fills.delete(a);
        continue;
      }
      // quarter-pixel steps: the slow end of the ease moves less than that per frame, so no new frame is drawn for it
      const y = Math.round((a.ih * (100 - (a.from + (a.to - a.from) * easeFill(k)))) / 25) / 4;
      if (y !== a.y) { a.y = y; a.sw.style.transform = `translateY(${y}px)`; a.s.style.transform = `translateY(${-y}px)`; }
      if (h) h.gw = glowIn(k);
    }
    // 2) halos: tier 1 steady, tier 2 flares on the beat, tier 3 flares harder + swells (writes only what changed)
    for (const h of halos) {
      if (!h.gl || !h.u.isConnected) continue;
      const { opacity, scale } = haloAt(h.tier, now, h.gw, h.off);
      const op = opacity.toFixed(2), sc = scale === 1 ? "" : `scale(${scale.toFixed(3)})`;
      if (op !== h.op) { h.op = op; h.gl.style.opacity = op === "1.00" ? "" : op; }
      if (sc !== h.sc) { h.sc = sc; h.gl.style.transform = sc; }
    }
    // 3) gold shine: a light band sweeps across the emoji on the beat, a wave along the line
    for (const sh of shines) {
      if (!sh.el) continue;
      const fr = shineFrame(now, sh.off);
      if (fr !== sh.last) { sh.last = fr; sh.el.style.setProperty("--sf", String(fr)); }
    }
    wake();
  }
  /** Move one unit's fill from level `from` to its own --f over `ms` (`played` ms already gone).
   *  glowLate (t578u/t588u): the tier halo stays off for the first 80% and fades in at the end. */
  function animateFill(u, from, ms, played = 0, glowLate = false) {
    const em = u.querySelector(".lv-em");
    const s = em && spriteInfo.get(em.dataset.e);
    if (!s) return;
    const to = +u.style.getPropertyValue("--f") || 0;
    const sw = em.querySelector(".lv-sw"), so = em.querySelector(".lv-s");
    for (const a of fills) if (a.u === u) fills.delete(a); // a newer fill replaces an older one
    const a = { u, sw, s: so, ih: s.ih, from, to, t0: performance.now() - played, ms, glowLate };
    fills.add(a);
    // first frame right away, so a new line never shows its final fill for a moment
    const k = Math.min(1, played / ms);
    const y = Math.round((s.ih * (100 - (from + (to - from) * easeFill(k)))) / 25) / 4;
    a.y = y;
    sw.style.transform = `translateY(${y}px)`;
    so.style.transform = `translateY(${-y}px)`;
    const h = glowLate ? halos.find((x) => x.u === u) : null;
    if (h) { h.gw = glowIn(k); h.gl.style.opacity = h.gw.toFixed(2); h.op = h.gw.toFixed(2); }
  }
  /** Owner t578u: lines that just appeared (tbody.lv-fillin, data-fk = their fill key) fill 0 → level over FILL_MS,
   *  continuing where they were (the time already played). Runs after every render and once the pictures are drawn. */
  function startFills() {
    if (!listEl || reduced()) return;
    const now = Date.now();
    for (const tb of listEl.querySelectorAll("tbody.lv-fillin")) {
      const played = now - (fillStart.get(tb.dataset.fk) || now);
      if (played >= FILL_MS) continue;
      for (const u of tb.querySelectorAll(".lv-u")) if (![...fills].some((a) => a.u === u)) animateFill(u, 0, FILL_MS, played, true);
    }
  }
  setInterval(() => {
    if (!listEl) return;
    for (const el of listEl.querySelectorAll(".lv-timer[data-at]")) el.textContent = `${fmtGap(Date.now() - +el.dataset.at)}`;
  }, 1000);

  // Owner t546u: no skill graph in Live any more (it stays on the main page).

  // Owner 2026-10-25: Honu-style session trends ABOVE the feed — one combined
  // chart (KPM + K/D, one colour per metric, trend dashed). The overlay keeps
  // only 6 victim lines, so the chart keeps its own history: every kill/death
  // timestamp since tracking started (the stream subscribe, kept across
  // reconnects). Redrawn on every event and every 30 s, so an idle stretch
  // falls to 0 on the interval line instead of freezing the chart.
  // Owner 2026-10-25: a session too young to draw (< 2 events) shows a
  // skeleton frame in the chart's place, not a gap — same size, so nothing
  // shifts when the first lines appear.
  const trendEl = $("liveTrends"), trendCanvas = $("liveTrendCanvas"), trendLegend = $("liveTrendLegend");
  let trendStart = 0;
  const trendKills = [], trendDeaths = [];
  if ($("liveTrendTitle")) $("liveTrendTitle").textContent = tr("live.trends", "Trends");
  if (trendLegend) {
    const item = (cls, key, fallback) => `<span class="lv-tl ${cls}"><i></i>${esc(tr(key, fallback))}</span>`;
    trendLegend.innerHTML =
      item("lv-tl-kpm", "live.trendKpmInt", "KPM interval") + item("lv-tl-kpm lv-tl-dash", "live.trendKpmTrend", "KPM trend") +
      item("lv-tl-dpm", "live.trendDpmInt", "DPM interval") + item("lv-tl-dpm lv-tl-dash", "live.trendDpmTrend", "DPM trend") +
      item("lv-tl-kd", "live.trendKdInt", "K/D interval") + item("lv-tl-kd lv-tl-dash", "live.trendKdTrend", "K/D trend");
  }
  function drawTrends() {
    if (!trendEl || !trendCanvas) return;
    trendEl.hidden = false;
    const colors = trendColors(document.documentElement.getAttribute("data-theme") === "light");
    for (const el of trendLegend.querySelectorAll(".lv-tl-kpm")) el.style.color = colors.kpm;
    for (const el of trendLegend.querySelectorAll(".lv-tl-dpm")) el.style.color = colors.dpm;
    for (const el of trendLegend.querySelectorAll(".lv-tl-kd")) el.style.color = colors.kd;
    const s = trendStart ? trendSeries(trendKills, trendDeaths, trendStart, Date.now()) : null;
    const any = s && (s.kpmInt.length || s.kpmTrend.length || s.kdInt.length || s.kdTrend.length || s.dpmInt.length || s.dpmTrend.length);
    trendEl.classList.toggle("live-trends-skel", !any);
    if (!any) { paintSkeleton(trendCanvas, colors, tr("live.trendsWait", "Waiting for kills…")); return; }
    paintTrends(trendCanvas, s, colors);
  }
  drawTrends(); // the skeleton shows from page load, before the stream connects
  setInterval(drawTrends, 30000);

  // #32: uncached opponents → full Census fetch in the background, one at a time.
  let bgQueue = []; // cids, newest first
  const bgTried = new Set();
  let bgBusy = false;
  async function bgPump() {
    const a = app();
    if (bgBusy || !a || !a.fetchPlayerBg) return;
    const shownRows = overlayRows(st);
    const cid = nextBgFetch(bgQueue, shownRows, bgTried);
    bgQueue = bgQueue.filter((c) => shownRows.some((r) => r.opp === c) && !bgTried.has(c));
    if (!cid) return;
    bgTried.add(cid);
    bgQueue = bgQueue.filter((c) => c !== cid);
    const p = people.get(cid);
    if (!p || p.cached || p.name.startsWith("#")) { bgPump(); return; }
    bgBusy = true;
    try {
      const player = await a.fetchPlayerBg(p.name);
      if (player) {
        p.cached = liveRowFromPlayer(player, p.name);
        render();
        if (typeof onBgFetched === "function") onBgFetched(p.name, player);
      }
    } catch { /* keep the K/D · KPM row; never retried this page load */ }
    bgBusy = false;
    bgPump();
  }
  // Owner t586u: refresh the centre player every ME_REFRESH_MS (paused while the tab is hidden). Only this browser:
  // no browser copy, nothing sent to the shared cache, nothing committed. The new iVi / fills ease in (no jump).
  let meNext = 0, meBusy = false;
  async function refreshMe() {
    const a = app();
    if (meBusy || !me || !a || !a.fetchPlayerFresh || document.hidden) return;
    meBusy = true;
    meNext = Date.now() + ME_REFRESH_MS;
    try {
      const player = await a.fetchPlayerFresh(me.name);
      if (player && me) {
        me.fresh = liveRowFromPlayer(player, me.name);
        const before = meSnapshot();
        me.cached = mergeFresh(me.cached, me.fresh);
        render();
        easeMe(before);
      }
    } catch { /* keep the shown numbers; try again next round */ }
    meBusy = false;
  }
  function meRefreshLoop() {
    meNext = Date.now() + ME_REFRESH_MS;
    setInterval(() => { if (!document.hidden && Date.now() >= meNext) refreshMe(); }, 5000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() >= meNext) refreshMe(); });
  }
  const meSnapshot = () => {
    const t = listEl && listEl.querySelector("tbody.lv-me");
    if (!t) return null;
    const iv = t.querySelector(".lv-iv:not(.lv-nil)");
    return { f: [...t.querySelectorAll(".lv-u")].map((u) => u.style.getPropertyValue("--f")), ivi: iv ? +iv.textContent : null };
  };
  function easeMe(before) {
    const t = listEl && listEl.querySelector("tbody.lv-me");
    if (!before || !t || reduced()) return;
    // the new fill eases in from the old one (owner t586u), 1.2 s, transforms only
    [...t.querySelectorAll(".lv-u")].forEach((u, i) => { if (before.f[i] !== "" && before.f[i] != null) animateFill(u, +before.f[i], 1200); });
    wake();
    const iv = t.querySelector(".lv-iv:not(.lv-nil)");
    const end = iv ? +iv.textContent : NaN;
    if (!iv || !Number.isFinite(end) || !Number.isFinite(before.ivi) || before.ivi === end) return;
    const t0 = performance.now(), from = before.ivi;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / 1200), e = 1 - (1 - k) ** 3;
      if (!iv.isConnected) return;
      iv.textContent = String(Math.round(from + (end - from) * e));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  // #33: background-fetched opponents → shared cache (/add), batched.
  let sharePending = [], shareFirstAt = 0, shareLast = null, shareTimer = null;
  function shareFlush() {
    shareTimer = null;
    const a = app();
    if (!a || !a.queueSharedCache || !sharePending.length) return;
    const batch = sharePending.splice(0, SHARE_MAX);
    shareLast = Date.now();
    shareFirstAt = shareLast;
    a.queueSharedCache(batch);
    shareSchedule();
  }
  function shareSchedule() {
    if (shareTimer) clearTimeout(shareTimer);
    const d = shareDelay(Date.now(), shareLast, shareFirstAt, sharePending.length);
    shareTimer = d == null ? null : setTimeout(shareFlush, d);
  }
  const onBgFetched = (name, player) => {
    if (!sharePending.length) shareFirstAt = Date.now();
    sharePending.push({ name, player });
    shareSchedule();
  };

  // owner t576u: events go through one queue (a slow name lookup can't reorder them) and keep their own time.
  let evChain = Promise.resolve();
  const onEvent = (ev) => { evChain = evChain.then(() => onEventNow(ev), () => onEventNow(ev)); };
  async function onEventNow(ev) {
    const p = await person(ev.opp);
    if (!trendStart) trendStart = ev.at || Date.now();
    if (ev.kind === "kill") trendKills.push(ev.at || Date.now()); else trendDeaths.push(ev.at || Date.now());
    const b = bountyNext({ streak: bountyStreak, lives: bountyLives }, ev.kind === "kill");
    bountyStreak = b.streak; bountyLives = b.lives;
    st = overlayPush(st, ev);
    render();
    drawTrends();
    if (!p.cached && !bgTried.has(ev.opp)) { bgQueue = [ev.opp, ...bgQueue.filter((c) => c !== ev.opp)]; bgPump(); }
  }

  let ws = null, backoff = 2000;
  function connect() {
    setState("Connecting to Census…");
    try { ws = new WebSocket(STREAM); } catch { retry(); return; }
    ws.onopen = () => {
      backoff = 2000;
      ws.send(JSON.stringify({ service: "event", action: "subscribe", characters: [me.cid], eventNames: ["Death"] }));
      if (!trendStart) trendStart = Date.now(); // the trends session starts when tracking starts, not on reconnect
      setState(`<span class="live-dot">●</span> waiting for kills and deaths…`, "on");
      render();
      drawTrends();
    };
    ws.onmessage = (m) => {
      let j; try { j = JSON.parse(m.data); } catch { return; }
      if (j.type !== "serviceMessage") return;
      const ev = classifyDeath(j.payload, me.cid);
      if (ev) ev.at = eventAt(j.payload); // owner t576u: the time of the kill/death, not of the (later) name lookup
      if (ev) {
        if (!st.lastEv) setState("", "on"); // owner t550u: no title above the table
        onEvent(ev);
      }
    };
    ws.onclose = () => retry();
    ws.onerror = () => { try { ws.close(); } catch {} };
  }
  function retry() {
    setState(`Census stream dropped — reconnecting in ${Math.round(backoff / 1000)} s…`, "err");
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 60000);
  }

  (async () => {
    try {
      const bare = target.replace(/^\s*\[[^\]]*\]\s*/, "").trim().toLowerCase();
      const j = await getJson(`${CENSUS}character?name.first_lower=${encodeURIComponent(bare)}&c:show=character_id,name.first,faction_id`);
      const ch = (j.character_list || [])[0];
      if (!ch) { setState(`No character named <strong>${esc(target)}</strong> on Census.`, "err"); return; }
      me = { cid: String(ch.character_id), name: ch.name.first, faction: FACTION[ch.faction_id] || "", cached: null };
      loadRanks().then(() => {
        me.cached = me.fresh ? mergeFresh(ranks.get(slugKey(me.name)), me.fresh) : ranks.get(slugKey(me.name)) || null;
        if (!me.cached) refreshMe(); // not in the cache: fetch the centre player once right away (t586u)
      });
      connect();
      meRefreshLoop();
    } catch {
      setState("Census is not answering — reload to retry.", "err");
    }
  })();
}
