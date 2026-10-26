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
export * from "./live-model.mjs?v=20261026-timer1"; // #66: the pure part (tests import it from here)
import { VICTIM_LINES, classifyDeath, fmtGap, censusStats, LIVE_COLS, tipText, FILL_DIM, HOLLOW_PX, HOLLOW_INK, goodPct, fillDriver, emojiFill, unknownFill, infUnit, OUTLINE_PX, unitGlow, LIVE_GLOWS, LIVE_FPS, liveFps, HALO_KEY, haloOn, easeFill, glowIn, BEAT, TIER_MOTION, haloAt, SHINE, shineFrame, beatSleep, weaponIcon, glowTier, eventAt, overlayPush, overlayRows, nextBgFetch, liveRowFromPlayer, ME_REFRESH_MS, median, mergeFresh, SHARE_MAX, shareDelay, cellText, slugKey, bountyNext, dpsNow, DPS_HP, DPS_ASSIST, DPS_ASSIST_XP, cashTotals, cashFormula, combatHoldMs, holdGaps, combatRuns, spawnRunHoldMs, timeToCombatMs, timerBarPct, easeInQuad } from "./live-model.mjs?v=20261026-timer1";
import { CENSUS_SERVICE_ID } from "./config.mjs?v=20261010-sav1";
import { isPenalizedPadder, POOP_MARK, POOP_TIP } from "./padding.mjs?v=20261023-short1";
import { percentileOf } from "./dist.mjs?v=20261010-sav1";
import { traitPools, zergScore } from "./trait-scores.mjs?v=20261024-crowd1";
import { zergEstimate } from "./zerg-revive.mjs?v=20261024-crowd1";
import { infMedian, tractorCuts, TRACTOR_EMOJI } from "./tractor.mjs?v=20261024-trac1";
import { drawEmojiSprite, spriteCss } from "./live-sprites.mjs?v=20261024-beat1";

const CENSUS = `https://census.daybreakgames.com/s:${CENSUS_SERVICE_ID}/get/ps2:v2/`;
const STREAM = `wss://push.planetside2.com/streaming?environment=ps2&service-id=s:${CENSUS_SERVICE_ID}`;
const FACTION = { 1: "vs", 2: "nc", 3: "tr", 4: "nso" };

/* ---------------- browser part ---------------- */
if (typeof window !== "undefined" && typeof document !== "undefined") start();

function start() {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (id) => document.getElementById(id);
  const target = (new URLSearchParams(location.search).get("names") || "").split(",")[0].trim();
  // Owner 2026-10-26 (stream overlay): ?stream=1 strips the page to the
  // meters + session card for OBS Browser Source over the game.
  const streamMode = new URLSearchParams(location.search).get("stream") === "1";
  if (streamMode) document.body.classList.add("live-stream");
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
  if (!target) { setState("Add a name on the main page, then press 🎥.", "err"); const sh = $("liveShare"); if (sh) sh.style.display = "none"; return; }

  const people = new Map(); // cid -> { name, faction, kd, cached: {adjs, kd} | null }
  let st = { killer: null, victims: [], lastEv: null, gone: null }; // owner t575u overlay state (overlayPush)
  let me = null; // { cid, name, faction }
  let ranks = null; // slug -> { adjs, kd }
  const pools = {}; // col id -> sorted finite values (percentiles, same as the Rankings table)
  let infM = null; // median infantry % over ranks.json (owner t590u: 🪖 fill starts here)
  let infC = null; // 🚜 infantry cut (owner t622u: ranks.json "tracCuts".cut, p25 of the data; 🚜 below it)
  let zergMed = null; // median 🪳 Zerg over ranks.json (owner 2026-10-26: above it = roach)

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
      zergMed = median(zergCol.filter((v) => typeof v === "number" && Number.isFinite(v)));
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
  // #76: one lookup per cid in flight. Two fast kills on the same victim share the fetch (the second must not
  // resolve early against the pending placeholder with an unknown faction); a rejected lookup is forgotten so the
  // next call retries. `pending` = still looking up: the name shows "…" (never a raw #id).
  const peopleP = new Map();
  async function person(cid) {
    if (people.has(cid) && !people.get(cid).pending) return people.get(cid);
    if (peopleP.has(cid)) return peopleP.get(cid);
    const p = { name: `#${cid}`, faction: "", kd: null, kpm: null, cached: null, pending: true };
    people.set(cid, p);
    const pr = (async () => {
      try {
        const j = await getJson(`${CENSUS}character?character_id=${cid}&c:show=character_id,name.first,faction_id&c:resolve=stat_history(stat_name,all_time)`);
        const ch = (j.character_list || [])[0];
        if (ch) {
          p.name = (ch.name && ch.name.first) || p.name;
          p.faction = FACTION[ch.faction_id] || "";
          Object.assign(p, censusStats(ch));
        }
      } catch { /* keep #id */ }
      try {
        if (!ranks) await loadRanks();
        const c = ranks.get(slugKey(p.name));
        if (c) p.cached = c;
      } finally { p.pending = false; }
      return p;
    })();
    peopleP.set(cid, pr);
    pr.catch(() => peopleP.delete(cid));
    return pr;
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
    if (p.pending) return `<span class="lv-pn"><span class="lv-name lv-pend"><bdi>…</bdi></span>${hs}</span>`; // #76: lookup in flight
    return `<span class="lv-pn"><span class="lv-name fac-${p.faction || ""}" title="${esc(p.name + (tip || ""))}"><bdi>${esc(p.name)}</bdi></span>${poopFor(p.name)}${hs}</span>`;
  }
  /**
   * Owner t575u: one line = one player, everything at once (no flip), ONE shared column order for every line:
   *   [⏱️ time][name][iVi][🏃][🦁][🛡️][🪖|🚜][☠️][🪳] (t580u: 🪳 last; t590u order) — so the emojis line up down the whole overlay.
   * Owner t567u: not cached = all-empty emojis; the Census numbers stay in the name's hover.
   */
  /**
   * Owner 2026-10-26 (roach rule): the extra cell shows ONLY the Zerg value
   * — no infantry, no other icons. A 🪳 marks a roach: unknown (no value at
   * all) or above the ranked median. Zerg falls back to the ~N estimate
   * (t614) when unscored.
   */
  function izHtml(vals) {
    const scored = vals.zerg, est = scored == null ? vals.zest : null;
    const zg = scored ?? est;
    if (!Number.isFinite(zg)) return `<td class="lv-iz" data-tip="Zerg ?">🪳</td>`;
    const zgS = est != null ? `~${Math.round(zg)}` : String(Math.round(zg));
    const roach = zergMed != null && zg > zergMed;
    return `<td class="lv-iz" data-tip="Zerg ${zgS}">${roach ? "🪳" : ""}${zgS}</td>`;
  }
  // Owner 2026-10-26 (one icon + count): the tracked player's bounty, on
  // their own (centre) line's second row — a streak shows as one coffin
  // plus its count (⚰️×3), and at 7 it flips to one money bag plus its
  // lives (💰×3), spent one per death (3 → 2 → 1 → gone). The centre line
  // also carries the latest kill's weapon above this.
  let bountyStreak = 0, bountyLives = 0;
  let meWeaponId = null; // latest kill's weapon id, shown under the centre name
  // Owner 2026-10-25: while the observed player is dead, the killed list
  // and their own name sit at 50% — a new kill brings them back to full.
  // Render-time flag, so it survives every re-render (bgPump included).
  let namesDim = false;
  function bountyHtml() {
    if (bountyLives > 0) return `<span class="lv-wn">💰×${bountyLives}</span>`;
    if (bountyStreak > 0) return `<span class="lv-wn">⚰️×${bountyStreak}</span>`;
    return "";
  }
  function cells(p, isMe, r, hideWeapon = false) {
    const vals = p.cached || {};
    const tip = p.cached || isMe ? "" : ` · not in cache · K/D ${fmt(p.kd, 2)} · KPM ${fmt(p.kpm, 2)}`;
    const w = r ? weaponIcon(catalog, r.weapon) : null;
    // Owner 2026-10-26: weapons live under the tracked (centre) name only —
    // victim rows carry no weapon line. The centre line stacks its latest
    // kill's weapon (small, dim) above the bounty count.
    let wn;
    if (isMe) {
      const mw = meWeaponId != null ? weaponIcon(catalog, meWeaponId) : null;
      wn = `<span class="lv-wn lv-wn-weapon">${mw ? esc(mw.name) : ""}</span>${bountyHtml()}`;
    } else if (hideWeapon) {
      wn = "";
    } else {
      wn = `<span class="lv-wn">${w ? esc(w.name) : ""}</span>`;
    }
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
    return `<tbody class="lv-ev lv-${where} lv-${r.last}${isNew ? " lv-new" : ""}${upset}${extra}${fi.cls}"${fi.sty}><tr><td class="lv-time">${ageHtml(r)}</td>${cells(p, false, r, where === "vic")}</tr></tbody>`;
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
    listEl.classList.toggle("lv-dim-names", namesDim);
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

  // Owner 2026-10-25: trends REMOVED (sluggish 30 s buckets, no numbers) —
  // the live numbers (DPM, cash-out) carry the session now. The online
  // pill survives the removal, moved into the DPM row.
  // Owner 2026-10-25: online pill in the DPM row — green while the tracked
  // player is online, red while offline, grey until the first signal. Two
  // sources: the stream itself (any Death/GainExperience for them, or a
  // PlayerLogin/PlayerLogout event) and a 60 s poll of Census
  // characters_online_status — the stream alone only reports transitions,
  // so a player already online at page load would otherwise never turn
  // green. A failed poll leaves the state alone: red means offline, not
  // "fetch failed".
  const onlineEl = $("liveOnline"), onlineTextEl = $("liveOnlineText");
  let onlineState = "unknown";
  function setOnline(s) {
    if (s === onlineState || !onlineEl) return;
    onlineState = s;
    onlineEl.dataset.state = s;
    if (onlineTextEl) onlineTextEl.textContent = s === "online" ? tr("live.online", "Online") : s === "offline" ? tr("live.offline", "Offline") : "…";
  }
  async function pollOnline() {
    if (!me) return;
    try {
      const j = await getJson(`${CENSUS}characters_online_status/?character_id=${me.cid}`);
      const list = j && j.characters_online_status_list;
      const st = list && list[0] && list[0].online_status;
      if (st === "1") setOnline("online"); else if (st === "0") setOnline("offline");
    } catch { /* keep the last state */ }
  }
  setInterval(pollOnline, 60000);

  // Owner 2026-10-25: imaginary DPM under the feed — kills (+1000) and
  // assists (+500, via GainExperience) jump the value, exponential drain
  // pulls it back down. The engine is damage per second (dpsNow); the counter
  // shows damage per minute (× 60, one decimal), so a steady 1-kill-per-
  // minute pace averages 1000.0. The cash-out rides the same tick: the
  // ⚔️ iVi of every victim, summed, with the average per victim — the killer
  // (the top line) is not counted, for now. Every value is written only when
  // its text changed; the tick runs every 100 ms so the drain reads as a
  // drain, not steps, and a late-arriving victim iVi lands within 100 ms.
  const dpsEl = $("liveDpsVal");
  const dpsLabelEl = $("liveDpsLabel");
  const dpsCombatLineEl = $("liveDpsCombatLine");
  const dpsBarEl = $("liveDpsBar"), dpsHoldBarEl = $("liveDpsHoldBar"), dpsCombatBarEl = $("liveDpsCombatBar");
  const dbgEl = $("liveDbg");
  if ($("liveDpsLabel")) $("liveDpsLabel").textContent = tr("live.dps", "DPM");
  const cashSumEl = $("liveCashSumVal"), cashAvgEl = $("liveCashAvgVal");
  if ($("liveCashSumLabel")) $("liveCashSumLabel").textContent = tr("live.cashSum", "Σ iVi");
  if ($("liveCashAvgLabel")) $("liveCashAvgLabel").textContent = tr("live.cashAvg", "avg");
  const dpsEvents = [];
  // Owner 2026-10-25 (elite combat damage meter): the two holds. deathTimes
  // holds every death's event time; timeDebtMs is the total frozen time
  // excised from the decay clock; freezeStart/freezeFor is the active
  // post-death freeze (freezeStart 0 = none). A spike (kill or assist)
  // lifts the freeze, excising only the frozen time up to the average
  // spawn run — a spike after the average expired excises exactly the
  // average, never more, so the clock continues where it froze.
  let deathTimes = [], timeDebtMs = 0, freezeStart = 0, freezeFor = 0;
  const spikeTimes = () => dpsEvents.map((e) => e.t);
  const liftFreeze = (at) => { if (freezeStart) { timeDebtMs += Math.min(Math.max(0, at - freezeStart), freezeFor); freezeStart = 0; freezeFor = 0; } };
  const cashKills = []; // one per kill: { cid, iv } — iv null until the victim's iVi is known
  // Owner 2026-10-26 (session trace-back line): everything needed to read
  // adj iVi back, in one pastable line — duration from the first event
  // this page saw, session kills and deaths across all runs, session Σ
  // and avg. Session-only like the pot and history: a reload restarts
  // it, and the line hides until the first event, so a reload is visible
  // as the duration resetting to zero.
  let sessionStartMs = 0, sessionDeaths = 0, lastSession = "", lastStream = "";
  const sessionEl = $("liveSession");
  const streamKdEl = $("liveStreamKd"), streamSesEl = $("liveStreamSession");
  const sessionDur = (ms) => { const s = Math.floor(ms / 1000); if (s < 60) return `${s}s`; const m = Math.floor(s / 60); if (m < 60) return `${m}m`; return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`; };
  // Owner 2026-10-25: adjustable DPM decay τ (seconds) — the owner tries
  // values live. A setting, so it persists across reloads (session data
  // does not); the events never change, only their weighting. Note the
  // scale moves with τ: a kill spikes to 6000 at 10 s but 1000 at 60 s —
  // the steady pace average (1 KPM → 1000) does not, so compare shapes,
  // not heights, across τ.
  let dpmTauMs = 10000;
  try { const saved = Number(localStorage.getItem("ps2-live-dpm-tau")); if (Number.isFinite(saved) && saved >= 1 && saved <= 3600) dpmTauMs = saved * 1000; } catch {}
  const tauInput = $("liveDpmTauVal");
  if (tauInput) {
    tauInput.value = String(Math.round(dpmTauMs / 1000));
    const applyTau = () => {
      let s = Math.round(Number(tauInput.value));
      if (!Number.isFinite(s)) s = 10;
      s = Math.min(3600, Math.max(1, s));
      tauInput.value = String(s);
      dpmTauMs = s * 1000;
      try { localStorage.setItem("ps2-live-dpm-tau", String(s)); } catch {}
      dpsTick();
    };
    tauInput.addEventListener("change", applyTau);
    const tauDown = $("liveDpmTauDown"), tauUp = $("liveDpmTauUp");
    if (tauDown) tauDown.addEventListener("click", () => { tauInput.value = String(Math.max(1, Math.round(Number(tauInput.value) || 10) - 10)); applyTau(); });
    if (tauUp) tauUp.addEventListener("click", () => { tauInput.value = String(Math.min(3600, Math.round(Number(tauInput.value) || 10) + 10)); applyTau(); });
  }
  // Owner 2026-10-26 (share): one tap copies a Messenger-ready block — the
  // watch link (the target's name in the URL, so the recipient follows the
  // same session) plus the current numbers, cash-out first, then DPM.
  const shareEl = $("liveShare");
  if (shareEl) {
    shareEl.textContent = tr("live.share", "Share");
    shareEl.addEventListener("click", async () => {
      const dpm = dpsEvents.length < 3 ? "–" : (dpsEl ? dpsEl.textContent : "–");
      const text = `${target} live: ${location.origin}${location.pathname}?names=${encodeURIComponent(target)}\nΣ ${cashSumEl ? cashSumEl.textContent : "0"} · avg ${cashAvgEl ? cashAvgEl.textContent : "–"} · DPM ${dpm}`;
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch {}
      if (!ok) {
        try {
          const ta = document.createElement("textarea");
          ta.value = text; ta.readOnly = true; ta.style.position = "fixed"; ta.style.opacity = "0";
          document.body.appendChild(ta); ta.select();
          ok = document.execCommand("copy");
          ta.remove();
        } catch { ok = false; }
      }
      if (ok) { shareEl.textContent = "✓"; setTimeout(() => { shareEl.textContent = tr("live.share", "Share"); }, 2000); }
    });
  }
  // Owner 2026-10-25: a sub-0 victim pays 0, never a negative — the pot
  // is a currency, and a kill cannot subtract from it. The feed's iVi
  // cell still shows the victim's real (negative) adjs; only the payout
  // is floored. Unknown (null) stays unknown, never counted as 0.
  // Owner 2026-10-25: the +34% boost trial — every payout is ×1.34, rounded, at this one choke point (live pot,
  // average, and banked history all scale together; the feed's iVi column still shows the unboosted value, and
  // the formula's +34% suffix says the parts are boosted). A floored 0 stays 0 (0 × 1.34 = 0).
  const CASH_BOOST_PCT = 34;
  const cashIv = (p) => (p && p.cached && Number.isFinite(p.cached.adjs) ? Math.round(Math.max(0, p.cached.adjs) * (1 + CASH_BOOST_PCT / 100)) : null);
  let lastDps = "", lastDpsLabel = "", lastCash = "", lastDbg = "", lastSpikeEff = null;
  // Owner 2026-10-26 (DPM row bars): each meter line carries a bar under
  // its text — DPM glows and grows with the shown value (full = two
  // kill-spikes at the current τ), hold/combat bars are value-proportional
  // (full = 60 s) and shrink as their seconds fall. Writes go through
  // this guard so a steady value writes once.
  const barState = { dpm: "", hold: "", combat: "" };
  const setBar = (el, key, pct) => { if (el && barState[key] !== pct) { el.style.width = pct; barState[key] = pct; } };
  const dpmBarPct = (v) => `${Math.min(100, Math.max(0, (v / (120000 / (dpmTauMs / 1000))) * 100)).toFixed(1)}%`;
  // Owner 2026-10-25 (gas-counter scroll): each kill/assist after the
  // meter starts queues one scroll — its own DPM jump at the τ of the
  // moment — and scrolls play one by one, 700 ms each, ease-in (slow
  // start, speeding up). While a scroll plays, the tick leaves the
  // number alone; when the queue is empty the tick eases the shown
  // value toward the true one instead of snapping, so decay and
  // post-scroll reconcile read as a gentle roll, never a jump. Deaths
  // never enqueue: the engine freezes at once, but the frozen number
  // only shows once the spinners ahead have played — the hold waits
  // its turn without any extra machinery, and simultaneous deaths just
  // re-freeze the same clock (settle + restart, banking guarded), so
  // nothing stacks.
  const SCROLL_MS = 700;
  let scrollQ = [], scrollJob = null, shownDps = null;
  function startScroll() {
    if (scrollJob || !scrollQ.length || shownDps === null) return;
    const delta = scrollQ.shift();
    scrollJob = { from: shownDps, to: shownDps + delta, start: performance.now() };
    const step = (now) => {
      if (!scrollJob) return;
      const p = Math.min(1, (now - scrollJob.start) / SCROLL_MS);
      const v = scrollJob.from + (scrollJob.to - scrollJob.from) * easeInQuad(p);
      shownDps = v;
      if (dpsEl) dpsEl.textContent = v.toFixed(1);
      setBar(dpsBarEl, "dpm", dpmBarPct(v));
      if (p < 1) requestAnimationFrame(step);
      else scrollJob = null;
    };
    requestAnimationFrame(step);
  }
  function dpsTick() {
    // Owner 2026-10-25 (elite combat damage meter): the decay clock.
    // A freeze lifts by itself once the average spawn run elapses (the
    // average is excised, the rest counts normally); while frozen, effNow
    // stands still, so the meter holds its death value. On any lift the
    // clock continues exactly where it froze — no jump either way — and
    // the inter-spike hold flattens each spike through the player's own
    // average gap before τ drains it.
    if (freezeStart && Date.now() >= freezeStart + freezeFor) { timeDebtMs += freezeFor; freezeStart = 0; freezeFor = 0; }
    const effNow = freezeStart ? freezeStart - timeDebtMs : Date.now() - timeDebtMs;
    // Owner 2026-10-25: the current hold, shown next to the meter — the
    // same median gap the decay uses, in whole seconds, so the player can
    // see exactly how much flat time each spike gets.
    const holdMs = combatHoldMs(spikeTimes(), deathTimes);
    if (dpsEl) {
      // Owner 2026-10-25: the meter waits for its 3rd data chunk — the
      // first two kills/assists only bump the count (1/3, 2/3) under the
      // note that the meter starts at 3, so no unheld spike is ever shown
      // as a rate. The spikes still accumulate from the first one, so the
      // meter starts with a real held value, not from zero.
      let label;
      if (dpsEvents.length < 3) {
        const v = `${dpsEvents.length}/3`;
        label = tr("live.dpmWarm", "DPM starts at 3");
        if (v !== lastDps) { dpsEl.textContent = v; lastDps = v; }
        setBar(dpsBarEl, "dpm", "0.0%");
      } else {
        label = tr("live.dps", "DPM");
        const trueDpm = dpsNow(dpsEvents, effNow, dpmTauMs, holdMs) * 60;
        if (shownDps === null) { shownDps = trueDpm; dpsEl.textContent = shownDps.toFixed(1); setBar(dpsBarEl, "dpm", dpmBarPct(shownDps)); }
        else if (!scrollJob) {
          if (scrollQ.length) startScroll();
          else {
            if (Math.abs(trueDpm - shownDps) < 0.05) shownDps = trueDpm;
            else shownDps += (trueDpm - shownDps) * 0.35;
            dpsEl.textContent = shownDps.toFixed(1);
            setBar(dpsBarEl, "dpm", dpmBarPct(shownDps));
          }
        }
        // a scroll in flight owns the number — the tick leaves it alone
      }
      if (dpsLabelEl && label !== lastDpsLabel) { dpsLabelEl.textContent = label; lastDpsLabel = label; }
      // Owner 2026-10-26 (timers): the thin bars are countdowns now, so
      // everyone watching sees time running out — the hold bar drains
      // from the latest spike over the median hold, the combat bar
      // drains from the latest death over the median combat time (wall
      // time, spawn included). The hold clock is the decay clock at the
      // spike (lastSpikeEff, set at commit after any freeze lifts), so
      // a mid-streak kill drains at once instead of waiting out every
      // past freeze, and a kill after a death still pauses while the
      // new freeze holds. The medians themselves live in the debug box
      // below. A bar with no running timer sits empty. setBar guards
      // its own writes, so the tick calls it flat out.
      const spikes = spikeTimes(), deaths = deathTimes;
      if (dpsHoldBarEl) setBar(dpsHoldBarEl, "hold", timerBarPct(lastSpikeEff != null ? holdMs - (effNow - lastSpikeEff) : 0, holdMs));
      // hidden until the first death→combat run completes — with no
      // median yet there is nothing to drain over
      const combat = timeToCombatMs(deaths, spikes);
      const lastDeath = deaths.length ? deaths[deaths.length - 1] : null;
      const combatDone = lastDeath != null && spikes.some((t) => t > lastDeath);
      if (dpsCombatBarEl) setBar(dpsCombatBarEl, "combat", timerBarPct(lastDeath != null && !combatDone ? combat.ms - (Date.now() - lastDeath) : 0, combat.ms));
      if (dpsCombatLineEl) dpsCombatLineEl.style.display = combat.n ? "" : "none";
      // Owner 2026-10-26 (debug box): the medians plus the exact inputs
      // to decompile combat efficiency back — hold gaps (trailing 10),
      // all combat runs, current τ. Plain text, copyable at stream end.
      // Write-on-change, like the session line.
      if (dbgEl) {
        const gaps = holdGaps(spikes, deaths);
        const runs = combatRuns(deaths, spikes);
        const sec1 = (ms) => (ms / 1000).toFixed(1);
        const key = `${holdMs}|${gaps.join(",")}|${combat.ms}|${combat.n}|${runs.join(",")}|${dpmTauMs}`;
        if (key !== lastDbg) {
          dbgEl.textContent = [
            `${tr("live.dpmHold", "hold {s}s", { s: sec1(holdMs) })}${gaps.length ? `: ${gaps.map(sec1).join(", ")}` : ""}`,
            `${tr("live.dpmCombat", "combat {s}s (n={n})", { s: sec1(combat.ms), n: combat.n })}${runs.length ? `: ${runs.map(sec1).join(", ")}` : ""}`,
            `τ ${(dpmTauMs / 1000).toFixed(0)}s`,
          ].join("\n");
          lastDbg = key;
        }
      }
    }
    // Owner 2026-10-26: the main pot shows only the total and the average
    // — the parts formula moved off this line (banked runs in the history
    // below still carry theirs).
    if (cashSumEl && cashAvgEl) {
      const t = cashTotals(cashKills.map((e) => e.iv));
      const key = `${t.sum}|${t.avg}`;
      if (key !== lastCash) {
        cashSumEl.textContent = String(t.sum);
        cashAvgEl.textContent = t.avg == null ? "–" : t.avg.toFixed(1);
        lastCash = key;
      }
    }
    // Owner 2026-10-26 (session trace-back line): duration from the first
    // event this page saw, kills and deaths across all runs (current pot
    // plus banked runs), session Σ and avg over known-iVi kills. Hidden
    // until the first event — no session yet, no line.
    if (sessionEl) {
      const sDur = sessionStartMs ? sessionDur(Date.now() - sessionStartMs) : "";
      const sKills = cashKills.length + cashHist.reduce((a, h) => a + (h.kills || 0), 0);
      const sKnown = cashKills.filter((e) => Number.isFinite(e.iv)).length + cashHist.reduce((a, h) => a + (h.known || 0), 0);
      const sSum = cashHist.reduce((a, h) => a + h.sum, 0) + cashTotals(cashKills.map((e) => e.iv)).sum;
      const sAvg = sKnown ? sSum / sKnown : null;
      const sKey = `${sDur}|${sKills}|${sessionDeaths}|${sSum}|${sAvg}`;
      if (sKey !== lastSession) {
        sessionEl.textContent = sessionStartMs ? tr("live.sessionLine", "session {dur} · {kills} kills · {deaths} deaths · Σ {sum} · avg {avg}", { dur: sDur, kills: sKills, deaths: sessionDeaths, sum: sSum, avg: sAvg == null ? "–" : sAvg.toFixed(1) }) : "";
        lastSession = sKey;
      }
      sessionEl.style.display = sessionStartMs ? "" : "none";
      // Owner 2026-10-26 (stream overlay): the same session numbers plus
      // K/D, in a card that lives from load (zeros before the first event) —
      // the normal session line stays hidden until the first event.
      if (streamKdEl && streamSesEl) {
        const stDur = sessionStartMs ? sDur : "0s";
        const stKd = sessionDeaths ? (sKills / sessionDeaths).toFixed(2) : "–";
        const stKey = `${stDur}|${sKills}|${sessionDeaths}|${sSum}|${sAvg}`;
        if (stKey !== lastStream) {
          streamKdEl.textContent = stKd;
          streamSesEl.textContent = tr("live.sessionLine", "session {dur} · {kills} kills · {deaths} deaths · Σ {sum} · avg {avg}", { dur: stDur, kills: sKills, deaths: sessionDeaths, sum: sSum, avg: sAvg == null ? "–" : sAvg.toFixed(1) });
          lastStream = stKey;
        }
      }
    }
  }
  setInterval(dpsTick, 100);

  // Owner 2026-10-25: cashed-out runs live as a small history on the page
  // only — in memory, newest first, capped at 5, written nowhere (no
  // database, no storage) until a hook formula worth persisting exists.
  // A run is banked when the death that ends it lands; a late iVi
  // arriving after that death no longer reaches the banked total.
  const cashHistEl = $("liveCashHist");
  const cashHist = [];
  function renderCashHist() {
    if (!cashHistEl) return;
    cashHistEl.innerHTML = cashHist.length
      ? `<div>${esc(tr("live.cashHist", "Past runs"))}</div>` + cashHist.map((h) => `<div>Σ ${h.formula} · ${tr("live.cashAvg", "avg")} ${h.avg == null ? "–" : h.avg.toFixed(1)}</div>`).join("")
      : "";
  }

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
        // a victim whose iVi was unknown at kill time pays out now
        for (const e of cashKills) if (e.cid === cid && !Number.isFinite(e.iv)) e.iv = cashIv(p);
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

  // #76 (snappy feed): the row lands the moment the event arrives — before any name lookup — with the event's own
  // time. Lookups run in parallel; the ACCOUNTING (bounty, DPM, cash, run-clear, teamkill) still commits strictly
  // in arrival order through evChain (owner t576u: a slow lookup can't reorder events).
  // Pending rows are tracked by `seq`, stamped on the row at arrival: overlayPush/feedPush copy rows ({ ...r })
  // when they stop the top row's timer on the next arrival, so identity breaks under rapid fire (the first kill's
  // row was dropped by the run-clear); the spread keeps `seq`. The model never reads it.
  let evChain = Promise.resolve();
  let evSeq = 0;
  const pendingSeq = new Set();
  const onEvent = (ev) => {
    if (!sessionStartMs) sessionStartMs = Date.now();
    setOnline("online"); // any Death involving them means they are playing right now
    const fetchP = person(ev.opp); // starts now, in parallel — never awaited here
    fetchP.then(render, render); // the name replaces "…" as soon as ITS lookup lands, even while an older commit waits
    st = overlayPush(st, ev);
    const row = st.lastEv;
    row.seq = ++evSeq;
    pendingSeq.add(row.seq);
    render();
    evChain = evChain.then(() => commitEvent(ev, fetchP, row.seq), () => commitEvent(ev, fetchP, row.seq));
  };
  async function commitEvent(ev, fetchP, seq) {
    let p;
    try { p = await fetchP; } catch { p = people.get(ev.opp); if (p) p.pending = false; } // failed lookup = unknown, never a stranded "…"
    p = p || { name: `#${ev.opp}`, faction: "", kd: null, kpm: null, cached: null };
    // Owner 2026-10-25: a kill on your own faction is a teamkill, not a kill — it farms nothing: no DPM, no hearts,
    // no cash, no feed row (the NC infinite-DPM bug: teamkills counted as kills). Unknown faction (failed lookup)
    // still counts as a kill — only a PROVEN same faction is skipped. A death TO your own faction still counts as
    // a death — you died, whoever shot you — so bounties spend and the run banks as usual.
    // #76: its row is already on screen (arrival push) and no accounting ran for it: retract just that row.
    if (ev.kind === "kill" && p.faction && me && me.faction && p.faction === me.faction) {
      st = { ...st, victims: st.victims.filter((r) => r.seq !== seq) };
      pendingSeq.delete(seq);
      render();
      return;
    }
    const wasStreak = bountyStreak;
    const b = bountyNext({ streak: bountyStreak, lives: bountyLives }, ev.kind === "kill");
    bountyStreak = b.streak; bountyLives = b.lives;
    if (ev.kind === "kill") {
      // Owner 2026-10-25: a kill that starts a new streak — the previous
      // run was cashed out by the death — clears the old run's victim
      // lines first, so the new name lands alone below as the first line
      // of the new run. Mid-run kills (streak already > 0) and kills
      // under a held bounty (streak 7, lives left) keep the lines.
      // Any kill also re-lights the names the death had dimmed.
      namesDim = false;
      if (ev.weapon != null) meWeaponId = ev.weapon; // latest kill's weapon, under the centre name
      // #76: rows still pending are strictly later arrivals (commits run in arrival order), so keeping them is
      // exactly the old clear plus the new run's early lines.
      if (wasStreak === 0) st = { ...st, victims: st.victims.filter((r) => r.seq === seq || pendingSeq.has(r.seq)) };
      // DPM at the event's own time: a commit deferred behind a slow lookup doesn't shift the decay
      dpsEvents.push({ t: Number.isFinite(ev.at) ? ev.at : Date.now(), dmg: DPS_HP }); if (shownDps !== null) scrollQ.push(dpsNow([{ t: 0, dmg: DPS_HP }], 0, dpmTauMs) * 60); liftFreeze(Number.isFinite(ev.at) ? ev.at : Date.now()); lastSpikeEff = dpsEvents[dpsEvents.length - 1].t - timeDebtMs; cashKills.push({ cid: ev.opp, iv: cashIv(p) }); dpsTick();
    }
    // Owner 2026-10-25: ANY death dims the killed list and the observed
    // player's own name to 50% — you are dead, the feed shows it — until
    // the next kill re-lights them. (Banking below is stricter: only the
    // death that ends a run banks it.)
    if (ev.kind === "death") namesDim = true;
    // Owner 2026-10-25: decay freezes ON the death event — you can't do
    // anything about the run from spawn, so it must not drain the meter.
    // A previous freeze (died, respawned, died again with no spike) is
    // settled first, then the new freeze runs for the average spawn run
    // measured so far (0 = no average yet = no freeze, meter as before).
    if (ev.kind === "death") { sessionDeaths++; liftFreeze(ev.at); deathTimes.push(ev.at); freezeStart = ev.at; freezeFor = spawnRunHoldMs(deathTimes, spikeTimes()); }
    if (ev.kind === "death" && wasStreak > 0 && bountyStreak === 0) {
      // Owner 2026-10-25: the death that ends a run banks it and resets
      // the pot for the new run — the pot shows 0 until the next kill.
      // Deaths under a held bounty (lives left, streak kept) do not end
      // the run, so they bank nothing.
      const t = cashTotals(cashKills.map((e) => e.iv));
      if (cashKills.length) cashHist.unshift({ sum: t.sum, avg: t.avg, formula: cashFormula(cashKills.map((e) => e.iv), CASH_BOOST_PCT), kills: cashKills.length, known: t.count });
      if (cashHist.length > 5) cashHist.length = 5;
      cashKills.length = 0;
      renderCashHist();
      dpsTick();
    }
    pendingSeq.delete(seq); // the row was pushed at arrival (onEvent): no second overlayPush
    render();
    if (!p.cached && !bgTried.has(ev.opp)) { bgQueue = [ev.opp, ...bgQueue.filter((c) => c !== ev.opp)]; bgPump(); }
  }

  let ws = null, backoff = 2000, openedAt = 0, connectTimer = null, connectStartedAt = 0;
  function connect() {
    // never open a second socket while one is live or connecting — a stale
    // retry timer firing after an immediate reconnect must not duplicate events
    if (ws && ws.readyState === WebSocket.CONNECTING && connectStartedAt && Date.now() - connectStartedAt > 30000) { try { ws.close(); } catch {} ws = null; }
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
    setState("Connecting to Census…");
    try { ws = new WebSocket(STREAM); } catch { retry(); return; }
    connectStartedAt = Date.now();
    ws.onopen = () => {
      backoff = 2000;
      openedAt = Date.now();
      ws.send(JSON.stringify({ service: "event", action: "subscribe", characters: [me.cid], eventNames: ["Death", "GainExperience_experience_id_2", "GainExperience_experience_id_3", "GainExperience_experience_id_371", "GainExperience_experience_id_372", "PlayerLogin", "PlayerLogout"] })); // filtered server-side (the worker's pattern) — never the whole XP firehose
      pollOnline(); // the stream reports transitions only; the poll says what is true right now
      setState(`<span class="live-dot">●</span> waiting for kills and deaths…`, "on");
      render();
    };
    ws.onmessage = (m) => {
      let j; try { j = JSON.parse(m.data); } catch { return; }
      if (j.type !== "serviceMessage") return;
      // Owner 2026-10-25: assists live in GainExperience, not Death — an
      // assist XP tick for the tracked player adds +500 to the DPM counter.
      if (j.payload?.event_name === "GainExperience") {
        const p = j.payload;
        if (String(p.character_id) === me.cid && DPS_ASSIST_XP.has(Number(p.experience_id))) { if (!sessionStartMs) sessionStartMs = Date.now(); setOnline("online"); dpsEvents.push({ t: Date.now(), dmg: DPS_ASSIST }); if (shownDps !== null) scrollQ.push(dpsNow([{ t: 0, dmg: DPS_ASSIST }], 0, dpmTauMs) * 60); liftFreeze(Date.now()); lastSpikeEff = dpsEvents[dpsEvents.length - 1].t - timeDebtMs; dpsTick(); }
        return;
      }
      // Owner 2026-10-25: login/logout for the tracked player drives the online pill.
      if (j.payload?.event_name === "PlayerLogin" || j.payload?.event_name === "PlayerLogout") {
        if (String(j.payload.character_id) === me.cid) setOnline(j.payload.event_name === "PlayerLogin" ? "online" : "offline");
        return;
      }
      const ev = classifyDeath(j.payload, me.cid);
      if (ev) ev.at = eventAt(j.payload); // owner t576u: the time of the kill/death, not of the (later) name lookup
      if (ev) {
        if (!st.lastEv) setState("", "on"); // owner t550u: no title above the table
        onEvent(ev);
      }
    };
    ws.onclose = () => {
      // one immediate retry per healthy drop — the close event fires at once,
      // but a background tab's setTimeout would sleep up to a minute; a flap
      // (lived under 5 s) or a failed connect falls through to backoff instead
      const lived = openedAt && Date.now() - openedAt > 5000;
      openedAt = 0;
      if (lived) connect(); else retry();
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }
  function retry() {
    setState(`Census stream dropped — reconnecting in ${Math.round(backoff / 1000)} s…`, "err");
    if (connectTimer) clearTimeout(connectTimer);
    connectTimer = setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 60000);
  }

  // Owner 2026-10-25: coming back to the tab recovers at once instead of
  // waiting out a timer the background tab throttled — connect() itself
  // refuses a second socket while one is live or connecting
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && (!ws || ws.readyState === WebSocket.CLOSED)) connect();
  });

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
