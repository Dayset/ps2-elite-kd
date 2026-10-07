/**
 * PlanetSide 2 elite K/D comparison chart (vanilla JS + SVG).
 * Mirrors absolute_target_split / kpm_curve / rf_if / adjusted_ivi from ps2_elite_kd.py
 */
(() => {
  "use strict";

  const COLORS = [
    "#9fd4ee", "#ff7a7a", "#ffd166", "#8ef0b0", "#e8b0ff",
    "#ffb07a", "#7ef0e6", "#ffa0c8", "#c6f06a", "#8cbcff",
  ];
  const EASY_MAX = 0.75;
  const HARD_MIN = 1.50;
  const X_MAX = 2.0;
  const HONU = "https://wt.honu.pw/api/character/";
  const CENSUS = "https://census.daybreakgames.com/s:example/get/ps2:v2/";
  const DOT_R = 3;

  const LS_CACHE = "ps2-elite-kd-cache-v2";
  const LS_CACHE_OLD = "ps2-elite-kd-cache-v1";
  const LS_RECENT = "ps2-elite-kd-recent";
  const LS_LAST = "ps2-elite-kd-last";
  const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  const DEFAULT_NAMES = ["JustV6me", "ChrisJTTR"];

  const DEMO_FILES = {
    justv6me: "data/justv6me.json",
    chrisjttr: "data/chrisjttr.json",
  };
  const ALIAS_TO_FILE = {
    justv6me: "justv6me",
    justv6: "justv6me",
    chrisjttr: "chrisjttr",
    chris: "chrisjttr",
    "[1tc] chrisjttr": "chrisjttr",
  };

  const VB = { w: 1000, h: 580 };
  const M = { t: 36, r: 56, b: 72, l: 48 };
  const PLOT = {
    x: M.l,
    y: M.t,
    w: VB.w - M.l - M.r,
    h: VB.h - M.t - M.b,
  };

  const els = {
    namesBox: document.getElementById("namesBox"),
    nameTokensEl: document.getElementById("nameTokens"),
    namesInput: document.getElementById("namesInput") || document.getElementById("names"),
    analyzeBtn: document.getElementById("analyzeBtn") || document.getElementById("loadBtn"),
    copyLinkBtn: document.getElementById("copyLinkBtn"),
    clearNamesBtn: document.getElementById("clearNamesBtn"),
    fetchFresh: document.getElementById("fetchFresh"),
    cacheChips: document.getElementById("cacheChips") || document.getElementById("recentChips"),
    lastLink: document.getElementById("lastLink"),
    status: document.getElementById("status"),
    progress: document.getElementById("progress"),
    progressText: document.getElementById("progressText"),
    chart: document.getElementById("chart"),
    chartPlaceholder: document.getElementById("chartPlaceholder"),
    stats: document.getElementById("statsPanel"),
    legend: document.getElementById("legend"),
  };

  let players = [];
  let lastAnalyzedNames = [];
  let fetching = false;
  /** Locked name chips in the token input (order preserved). */
  let nameTokens = [];

  function ns(tag) {
    return document.createElementNS("http://www.w3.org/2000/svg", tag);
  }

  function setStatus(html, cls) {
    els.status.innerHTML = html || "";
    els.status.className = cls || "";
  }

  function setProgress(show, text) {
    if (!els.progress) return;
    if (show) {
      els.progress.hidden = false;
      if (els.progressText) els.progressText.textContent = text || "Fetching…";
    } else {
      els.progress.hidden = true;
      if (els.progressText) els.progressText.textContent = "";
    }
  }

  function isFiniteNum(v) {
    return typeof v === "number" && Number.isFinite(v);
  }

  function fmtNum(v, digits) {
    if (!isFiniteNum(v)) return "—";
    return Number(v).toFixed(digits);
  }

  /* ---------- math (ported from Python) ---------- */

  function pooled(sl) {
    let tk = 0, td = 0;
    for (const r of sl) {
      tk += r.kills || 0;
      td += r.deaths || 0;
    }
    let kd = NaN;
    if (td) kd = tk / td;
    else if (tk) kd = tk;
    return { kills: tk, deaths: td, kd };
  }

  function kpmCurve(rows, start = 2.5, end = 0.0, step = 0.05) {
    const pts = [];
    for (let t = start; t >= end - 1e-9; t -= step) {
      const cut = Math.round(t * 100) / 100;
      const sl = rows.filter((r) => (r.kpm || 0) >= cut);
      const { kills, deaths, kd } = pooled(sl);
      pts.push({ kpm: cut, kd, kills, deaths, n: sl.length });
    }
    return pts;
  }

  /**
   * Resistance Factor (RF) and Activity/IF from high-pressure pair union.
   * Union of top-n by opp KPM and top-n by deaths against player.
   * RF = rkd * avg_opp_kpm; IF = rkd * own_kpm.
   */
  function rfIf(p, sliceN) {
    const rows = Array.isArray(p.rows) ? p.rows.slice() : [];
    if (!rows.length) return null;
    const n = sliceN == null ? rows.length : Math.max(1, Math.min(sliceN, rows.length));
    const byKpm = rows.slice().sort((a, b) => (b.kpm || 0) - (a.kpm || 0)).slice(0, n);
    const byDth = rows.slice().sort((a, b) => (b.deaths || 0) - (a.deaths || 0)).slice(0, n);
    const seen = new Set();
    const sl = [];
    for (const r of byKpm.concat(byDth)) {
      const key = r.name;
      if (seen.has(key)) continue;
      seen.add(key);
      sl.push(r);
    }
    const { kills, deaths, kd: rkd } = pooled(sl);
    const kpms = sl.map((r) => +r.kpm || 0);
    const avgOpp = kpms.length ? kpms.reduce((a, b) => a + b, 0) / kpms.length : 0;
    const own = +(p.own_kpm || p.global_kpm || 0);
    const rf = rkd * avgOpp;
    const ifactor = rkd * own;
    return {
      n: sl.length,
      kills,
      deaths,
      rkd,
      avg_opp: avgOpp,
      own,
      rf,
      ifactor,
    };
  }

  /** adjIvI = 600 * (1 + log2(RF / 0.6)); soft RF 0.6 ≈ public IvI 600. */
  function adjustedIvi(ivi, rf) {
    if (rf == null || !(rf > 0)) return NaN;
    return 600 * (1 + Math.log2(rf / 0.6));
  }

  // Typical worst 25–75 slope ≈ -2; fixed floor so a new name does not rewrite PVS.
  const SLOPE_FLOOR = -2.0;
  const SLOPE_EPS = 0.05;

  function sliceAt(rows, cut) {
    const sl = (rows || []).filter((r) => (r.kpm || 0) >= cut);
    const { kills, deaths, kd } = pooled(sl);
    return { kd, kills, deaths, n: sl.length };
  }

  /** COI = RF / 0.6; soft player ≈ 1. */
  function combatOutput(rf) {
    return rf && rf === rf ? rf / 0.6 : NaN;
  }

  /** Experimental: 0.30 × (1 + ln(1+RF)) as percent. */
  function projectedMech(rf) {
    if (rf == null || rf !== rf || rf < 0) return NaN;
    return 100.0 * 0.30 * (1.0 + Math.log(1.0 + rf));
  }

  /** How fast projected K/D falls between 25th and 75th opponent-KPM. */
  function slope2575(p) {
    const rows = (Array.isArray(p.rows) ? p.rows.slice() : []).filter((r) => (r.kpm || 0) > 0);
    if (rows.length < 4) return NaN;
    rows.sort((a, b) => (+a.kpm || 0) - (+b.kpm || 0));
    const n = rows.length;
    const i25 = Math.round(0.25 * (n - 1));
    const i75 = Math.round(0.75 * (n - 1));
    if (i75 <= i25) return NaN;
    const k25 = +rows[i25].kpm;
    const k75 = +rows[i75].kpm;
    if (Math.abs(k75 - k25) < 1e-6) return NaN;
    function valAt(cut) {
      const sl = rows.filter((r) => r.kpm >= cut);
      return pooled(sl).kd;
    }
    return (valAt(k75) - valAt(k25)) / (k75 - k25);
  }

  /** PVS = Activity × (shifted slope)^1.5 */
  function pressureVolume(activity, slope) {
    if (activity !== activity || slope !== slope) return NaN;
    const shifted = Math.max(slope - SLOPE_FLOOR + SLOPE_EPS, SLOPE_EPS);
    return activity * Math.pow(shifted, 1.5);
  }

  /** Prefer player.ivi; fall back to acc × hsr (IvI-style). */
  function resolveIvi(p) {
    if (p.ivi != null && isFiniteNum(+p.ivi)) return +p.ivi;
    const acc = p.acc != null ? +p.acc : NaN;
    const hsr = p.hsr != null ? +p.hsr : NaN;
    if (isFiniteNum(acc) && isFiniteNum(hsr)) return acc * hsr;
    return NaN;
  }

  /** Lightweight death_mix metrics at elite cutoff 1.5. */
  function deathMixLite(p) {
    const { kd: kd15, deaths: d15, n: n15 } = sliceAt(p.rows || [], 1.5);
    const gkd = +p.global_kd || 0;
    const inflation = isFiniteNum(kd15) && kd15 > 0.05 ? gkd / kd15 : NaN;
    return { kd15, d15, n15, inflation };
  }

  function normalizePlayer(raw) {
    const p = raw.player || raw;
    const rows = (p.rows || []).map((r) => ({
      name: r.name || "",
      kills: +r.kills || 0,
      deaths: +r.deaths || 0,
      kpm: +r.kpm || 0,
    }));
    let curve = p.curve;
    if (!curve || !curve.length) curve = kpmCurve(rows);
    curve = curve.map((pt) => ({
      kpm: +pt.kpm,
      kd: pt.kd == null || pt.kd !== pt.kd ? NaN : +pt.kd,
      kills: +pt.kills || 0,
      deaths: +pt.deaths || 0,
      n: +pt.n || 0,
    }));
    return {
      display: p.display || p.name || "?",
      cid: p.cid || "",
      global_kd: +p.global_kd || 0,
      global_kpm: +p.global_kpm || 0,
      own_kpm: +p.own_kpm || +p.global_kpm || 0,
      acc: p.acc != null ? +p.acc : null,
      hsr: p.hsr != null ? +p.hsr : null,
      ivi: p.ivi != null ? +p.ivi : null,
      rows,
      curve,
      honu: p.honu || (p.cid ? `https://wt.honu.pw/c/${p.cid}/killboard` : ""),
      source: raw._source || "local",
    };
  }

  function trimForCache(p) {
    return {
      display: p.display,
      cid: p.cid,
      global_kd: p.global_kd,
      global_kpm: p.global_kpm,
      own_kpm: p.own_kpm,
      acc: p.acc,
      hsr: p.hsr,
      ivi: p.ivi,
      rows: p.rows,
      curve: p.curve.map((pt) => ({
        kpm: pt.kpm,
        kd: isFiniteNum(pt.kd) ? pt.kd : null,
        kills: pt.kills,
        deaths: pt.deaths,
        n: pt.n,
      })),
      honu: p.honu,
    };
  }

  function slugKey(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .replace(/^\[.*?\]\s*/, "")
      .replace(/[^a-z0-9]+/g, "");
  }

  /** Spaces or commas (also ; / newlines). Preserves optional [TAG] prefix. */
  function parseNames(text) {
    const s = String(text || "").trim();
    if (!s) return [];
    const tokens = [];
    const re = /(?:\[[^\]]*\]\s*)?[^\s,;]+/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      const t = m[0].trim();
      if (t) tokens.push(t);
    }
    return tokens.slice(0, 10);
  }

  function namesEqualIgnoreCase(a, b) {
    return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  }

  /** Order-insensitive casefold key for skip-refetch compare. */
  function namesSetKey(names) {
    return names
      .map((n) => String(n).trim().toLowerCase())
      .filter(Boolean)
      .sort()
      .join("\0");
  }

  /* ---------- localStorage helpers ---------- */

  function readJsonLS(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writeJsonLS(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function getCacheStore() {
    const obj = readJsonLS(LS_CACHE, {});
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
  }

  function pruneCache(store) {
    const now = Date.now();
    let changed = false;
    for (const key of Object.keys(store)) {
      const entry = store[key];
      if (!entry || !entry.player || !entry.savedAt || now - entry.savedAt > CACHE_TTL_MS) {
        delete store[key];
        changed = true;
      }
    }
    return changed;
  }

  function getCache() {
    const store = getCacheStore();
    if (pruneCache(store)) writeJsonLS(LS_CACHE, store);
    return store;
  }

  function cacheGet(name) {
    const key = slugKey(name);
    const store = getCache();
    const entry = store[key];
    if (!entry || !entry.player || !entry.savedAt) return null;
    if (Date.now() - entry.savedAt > CACHE_TTL_MS) return null;
    return entry;
  }

  function cachePut(name, player) {
    const key = slugKey(name);
    if (!key) return;
    const store = getCacheStore();
    store[key] = {
      name: String(name).trim(),
      savedAt: Date.now(),
      player: trimForCache(player),
    };
    pruneCache(store);
    writeJsonLS(LS_CACHE, store);
    renderNameTokens();
    renderCacheChips();
  }

  function listCachedNames() {
    const store = getCache();
    const items = [];
    for (const key of Object.keys(store)) {
      const entry = store[key];
      if (!entry || !entry.player) continue;
      items.push({
        key,
        name: entry.name || entry.player.display || key,
        savedAt: entry.savedAt || 0,
      });
    }
    items.sort((a, b) => b.savedAt - a.savedAt);
    return items;
  }

  function saveLastComparison(names) {
    writeJsonLS(LS_LAST, names.map((n) => String(n).trim()).filter(Boolean));
    renderLastLink();
  }

  function getLastComparison() {
    const list = readJsonLS(LS_LAST, null);
    if (!Array.isArray(list) || !list.length) return null;
    return list.filter((s) => typeof s === "string" && s.trim());
  }

  /** Clear name chips + trailing input text only; leave localStorage cache intact. */
  function clearNamesFromInput() {
    nameTokens = [];
    if (els.namesInput) els.namesInput.value = "";
    renderNameTokens();
    renderCacheChips();
  }

  /* ---------- tokenized name input / chips / last link ---------- */

  function isNameFetched(name) {
    if (cacheGet(name)) return true;
    const slug = slugKey(name);
    if (players.some((p) => slugKey(p.display) === slug || namesEqualIgnoreCase(p.display, name))) {
      return true;
    }
    if (lastAnalyzedNames.some((n) => namesEqualIgnoreCase(n, name) || slugKey(n) === slug)) {
      return true;
    }
    return false;
  }

  function setNameTokens(names) {
    const seen = new Set();
    nameTokens = [];
    for (const raw of names || []) {
      const clean = String(raw).trim();
      if (!clean) continue;
      const key = clean.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      nameTokens.push(clean);
      if (nameTokens.length >= 10) break;
    }
    if (els.namesInput) els.namesInput.value = "";
    renderNameTokens();
    renderCacheChips();
  }

  function addNameToField(name) {
    const clean = String(name).trim();
    if (!clean) return;
    if (nameTokens.some((n) => namesEqualIgnoreCase(n, clean))) {
      renderNameTokens();
      renderCacheChips();
      return;
    }
    if (nameTokens.length >= 10) {
      setStatus('<span class="warn">Max 10 names</span>', "warn");
      return;
    }
    nameTokens.push(clean);
    renderNameTokens();
    renderCacheChips();
  }

  function removeNameToken(name) {
    nameTokens = nameTokens.filter((n) => !namesEqualIgnoreCase(n, name));
    renderNameTokens();
    renderCacheChips();
  }

  function renderNameTokens() {
    if (!els.nameTokensEl) return;
    els.nameTokensEl.innerHTML = "";
    nameTokens.forEach((name) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "name-token " + (isNameFetched(name) ? "fetched" : "unfetched");
      btn.textContent = name;
      btn.setAttribute("aria-label", `Remove ${name}`);
      btn.title = `Remove ${name}`;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        removeNameToken(name);
      });
      els.nameTokensEl.appendChild(btn);
    });
  }

  /** Commit trailing raw input into chips (separator flush or Analyze/Enter). */
  function commitFragment({ clearInput = true } = {}) {
    if (!els.namesInput) return [];
    const raw = els.namesInput.value;
    const tokens = parseNames(raw);
    for (const t of tokens) addNameToField(t);
    if (clearInput) els.namesInput.value = "";
    return tokens;
  }

  /**
   * Names for Analyze / share: locked chips + unfinished trailing text
   * if it parses as a complete name (no trailing separator required).
   */
  function currentNamesInField() {
    const out = nameTokens.slice();
    const frag = els.namesInput ? String(els.namesInput.value || "").trim() : "";
    if (frag) {
      for (const t of parseNames(frag)) {
        if (!out.some((n) => namesEqualIgnoreCase(n, t))) out.push(t);
      }
    }
    return out.slice(0, 10);
  }

  function renderCacheChips() {
    if (!els.cacheChips) return;
    const cached = listCachedNames();
    const inField = currentNamesInField();
    els.cacheChips.innerHTML = "";
    if (!cached.length) return;
    const label = document.createElement("span");
    label.className = "fresh-hint";
    label.style.marginRight = "0.35rem";
    label.textContent = "Cache:";
    els.cacheChips.appendChild(label);
    for (const item of cached) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      if (inField.some((n) => namesEqualIgnoreCase(n, item.name))) {
        btn.classList.add("active");
      }
      btn.textContent = item.name;
      btn.title = `Add ${item.name} to comparison`;
      btn.addEventListener("click", () => addNameToField(item.name));
      els.cacheChips.appendChild(btn);
    }
  }

  function renderLastLink() {
    if (!els.lastLink) return;
    const last = getLastComparison();
    if (!last || !last.length) {
      els.lastLink.innerHTML = "";
      return;
    }
    const namesStr = last.join(",");
    const url = buildShareUrl(last);
    els.lastLink.innerHTML =
      `Latest comparison: <a href="${escapeHtml(url)}">${escapeHtml(namesStr)}</a>`;
  }

  /* ---------- loaders ---------- */

  async function fetchJson(url) {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    return res.json();
  }

  async function loadLocal(name) {
    const key = slugKey(name);
    const alias = ALIAS_TO_FILE[name.trim().toLowerCase()] || ALIAS_TO_FILE[key];
    const fileKey = alias || key;
    const candidates = [
      DEMO_FILES[fileKey],
      `data/${fileKey}.json`,
      `data/${fileKey}_top50.json`,
      `data/${key}.json`,
    ].filter(Boolean);

    let lastErr;
    for (const path of candidates) {
      try {
        const data = await fetchJson(path);
        data._source = `local:${path}`;
        return normalizePlayer(data);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error(`No local data for ${name}`);
  }

  function loadFromCache(name) {
    const entry = cacheGet(name);
    if (!entry) throw new Error(`No cache for ${name}`);
    return normalizePlayer({
      _source: "cache:localStorage",
      player: entry.player,
    });
  }

  async function resolveCensus(name) {
    const raw = name.trim();
    let url;
    if (/^\d{16,}$/.test(raw)) {
      url = `${CENSUS}character?character_id=${encodeURIComponent(raw)}&c:resolve=outfit,stat_history`;
    } else {
      url = `${CENSUS}character?name.first_lower=${encodeURIComponent(raw.toLowerCase())}&c:resolve=outfit,stat_history`;
    }
    const data = await fetchJson(url);
    const chars = data.character_list || [];
    if (!chars.length) throw new Error(`Census: no character ${raw}`);
    return chars[0];
  }

  async function honuKillboard(cid) {
    return fetchJson(`${HONU}${cid}/killboard`);
  }

  async function honuMeta(cid) {
    try {
      return await fetchJson(`${HONU}${cid}`);
    } catch {
      return {};
    }
  }

  async function honuWeaponPace(cid) {
    try {
      const stats = await fetchJson(`${HONU}${cid}/stats`);
      let wk = 0, wd = 0, wt = 0;
      let fire = 0, hitc = 0, hs = 0;
      for (const row of stats) {
        const n = row.statName;
        const v = +row.valueForever || 0;
        if (n === "weapon_kills") wk = v;
        else if (n === "weapon_deaths") wd = v;
        else if (n === "weapon_play_time") wt = v;
        else if (n === "weapon_fire_count") fire = v;
        else if (n === "weapon_hit_count") hitc = v;
        else if (n === "weapon_headshots") hs = v;
      }
      const kpm = wt ? wk / (wt / 60) : 0;
      const acc = fire ? (100 * hitc) / fire : 0;
      const hsr = wk ? (100 * hs) / wk : 0;
      const ivi = acc * hsr;
      return { wk, wd, kpm, acc, hsr, ivi };
    } catch {
      return { wk: 0, wd: 0, kpm: 0, acc: 0, hsr: 0, ivi: 0 };
    }
  }

  function hist(c, stat) {
    for (const row of ((c.stats || {}).stat_history) || []) {
      if (row.stat_name === stat) return +row.all_time || 0;
    }
    return 0;
  }

  async function loadLive(name) {
    const c = await resolveCensus(name);
    const cid = c.character_id;
    const outfit = c.outfit || {};
    const gk = hist(c, "kills"), gd = hist(c, "deaths"), gt = hist(c, "time");
    const gkd = gd ? gk / gd : gk;
    const gkpm = gt ? gk / (gt / 60) : 0;
    const tag = outfit.alias ? `[${outfit.alias}] ` : "";
    const display = `${tag}${c.name.first}`;

    const own = await honuWeaponPace(cid);
    const board = await honuKillboard(cid);
    board.sort((a, b) => (b.kills + b.deaths) - (a.kills + a.deaths));
    const sample = board.slice(0, 50);

    const rows = [];
    const concurrency = 4;
    let i = 0;
    async function worker() {
      while (i < sample.length) {
        const idx = i++;
        const pair = sample[idx];
        const oid = String(pair.otherCharacterID);
        const [meta, pace] = await Promise.all([honuMeta(oid), honuWeaponPace(oid)]);
        const etag = meta.outfitTag ? `[${meta.outfitTag}] ` : "";
        rows[idx] = {
          name: etag + (meta.name || oid),
          kills: +pair.kills || 0,
          deaths: +pair.deaths || 0,
          kpm: pace.kpm || 0,
        };
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    return normalizePlayer({
      _source: "live:honu",
      player: {
        display,
        cid,
        global_kd: gkd,
        global_kpm: gkpm,
        own_kpm: own.kpm || gkpm,
        acc: own.acc,
        hsr: own.hsr,
        ivi: own.ivi,
        rows,
        curve: kpmCurve(rows),
        honu: `https://wt.honu.pw/c/${cid}/killboard`,
      },
    });
  }

  /**
   * Default: bundled → cache → live.
   * Fresh: live only (error if live fails).
   */
  async function loadOne(name, { fresh = false } = {}) {
    if (fresh) {
      try {
        return await loadLive(name);
      } catch (e) {
        throw new Error(`Live fetch failed for ${JSON.stringify(name)}: ${e.message}`);
      }
    }
    const errors = [];
    try {
      return await loadLocal(name);
    } catch (e) {
      errors.push(`local: ${e.message}`);
    }
    try {
      return loadFromCache(name);
    } catch (e) {
      errors.push(`cache: ${e.message}`);
    }
    try {
      return await loadLive(name);
    } catch (e) {
      errors.push(`live: ${e.message}`);
    }
    throw new Error(
      `Could not load ${JSON.stringify(name)}. ${errors.join(" · ")}`
    );
  }

  function reliability(pt) {
    const n = pt.n || 0;
    const d = pt.deaths || 0;
    if (d <= 0 || n <= 0) return 0;
    return Math.min(1, (n / 8) * 0.5 + (Math.min(d, 80) / 80) * 0.5);
  }

  function yScale(yvals) {
    const finite = yvals.filter(isFiniteNum);
    if (!finite.length) return { lo: 0, hi: 2, log: false };
    const lo = Math.min(...finite);
    const hi = Math.max(...finite);
    const ordered = finite.filter((v) => v > 0).sort((a, b) => a - b);
    const mid = ordered.length ? ordered[Math.floor(ordered.length / 2)] : 1;
    const p90 = ordered.length
      ? ordered[Math.floor(0.9 * (ordered.length - 1))]
      : hi;
    const striking = hi >= 15 && hi >= 8 * Math.max(mid, 0.25);
    if (striking) {
      const floor = ordered.length ? Math.max(0.15, ordered[0] * 0.9) : 0.15;
      return { lo: floor, hi: hi * 1.25, log: true };
    }
    const packHi = hi < 8 ? hi : Math.max(p90, 2);
    const span = Math.max(packHi - lo, 0.15);
    return {
      lo: Math.max(0, lo - 0.1 * span),
      hi: packHi + 0.12 * span,
      log: false,
    };
  }

  function xToPx(x) {
    return PLOT.x + (x / X_MAX) * PLOT.w;
  }

  function makeYMapper(scale) {
    if (scale.log) {
      const logLo = Math.log10(scale.lo);
      const logHi = Math.log10(scale.hi);
      return (y) => {
        const t = (Math.log10(Math.max(y, scale.lo)) - logLo) / (logHi - logLo);
        return PLOT.y + PLOT.h * (1 - t);
      };
    }
    return (y) => {
      const t = (y - scale.lo) / (scale.hi - scale.lo || 1);
      return PLOT.y + PLOT.h * (1 - t);
    };
  }

  function clearSvg(svg) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }

  function drawChart(list) {
    const svg = els.chart;
    clearSvg(svg);
    setPlaceholderVisible(false);
    svg.setAttribute("viewBox", `0 0 ${VB.w} ${VB.h}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Elite K/D vs enemy weapon KPM");

    const bg = ns("rect");
    bg.setAttribute("x", 0);
    bg.setAttribute("y", 0);
    bg.setAttribute("width", VB.w);
    bg.setAttribute("height", VB.h);
    bg.setAttribute("fill", "#14161a");
    svg.appendChild(bg);

    const bands = [
      { x0: 0, x1: EASY_MAX, fill: "#6a8f6a", opacity: 0.06 },
      { x0: EASY_MAX, x1: HARD_MIN, fill: "#8a8a6a", opacity: 0.045 },
      { x0: HARD_MIN, x1: X_MAX, fill: "#8a6a6a", opacity: 0.06 },
    ];
    for (const b of bands) {
      const r = ns("rect");
      r.setAttribute("x", xToPx(b.x0));
      r.setAttribute("y", PLOT.y);
      r.setAttribute("width", xToPx(b.x1) - xToPx(b.x0));
      r.setAttribute("height", PLOT.h);
      r.setAttribute("fill", b.fill);
      r.setAttribute("fill-opacity", b.opacity);
      svg.appendChild(r);
    }

    const yvals = [];
    for (const p of list) {
      for (const pt of p.curve || []) {
        if (pt.kpm <= X_MAX && isFiniteNum(pt.kd) && (pt.deaths > 0 || pt.kills > 0)) {
          yvals.push(pt.kd);
        }
      }
    }
    const scale = yScale(yvals);
    const yToPx = makeYMapper(scale);

    const gGrid = ns("g");
    gGrid.setAttribute("stroke", "#2a2e36");
    gGrid.setAttribute("stroke-width", "0.8");
    for (let x = 0; x <= X_MAX + 1e-9; x += 0.5) {
      const line = ns("line");
      line.setAttribute("x1", xToPx(x));
      line.setAttribute("x2", xToPx(x));
      line.setAttribute("y1", PLOT.y);
      line.setAttribute("y2", PLOT.y + PLOT.h);
      gGrid.appendChild(line);
    }
    const yTicks = scale.log
      ? niceLogTicks(scale.lo, scale.hi)
      : niceLinTicks(scale.lo, scale.hi, 6);
    for (const y of yTicks) {
      const line = ns("line");
      line.setAttribute("x1", PLOT.x);
      line.setAttribute("x2", PLOT.x + PLOT.w);
      line.setAttribute("y1", yToPx(y));
      line.setAttribute("y2", yToPx(y));
      gGrid.appendChild(line);
    }
    svg.appendChild(gGrid);

    for (const xv of [EASY_MAX, HARD_MIN]) {
      const line = ns("line");
      line.setAttribute("x1", xToPx(xv));
      line.setAttribute("x2", xToPx(xv));
      line.setAttribute("y1", PLOT.y);
      line.setAttribute("y2", PLOT.y + PLOT.h);
      line.setAttribute("stroke", "#e0ddd6");
      line.setAttribute("stroke-width", "1");
      line.setAttribute("stroke-dasharray", "5 4");
      line.setAttribute("stroke-opacity", "0.4");
      svg.appendChild(line);
    }

    const border = ns("rect");
    border.setAttribute("x", PLOT.x);
    border.setAttribute("y", PLOT.y);
    border.setAttribute("width", PLOT.w);
    border.setAttribute("height", PLOT.h);
    border.setAttribute("fill", "none");
    border.setAttribute("stroke", "#2a2e36");
    border.setAttribute("stroke-width", "1");
    svg.appendChild(border);

    const title = ns("text");
    title.setAttribute("x", PLOT.x);
    title.setAttribute("y", 22);
    title.setAttribute("fill", "#f2f0ea");
    title.setAttribute("font-size", "16");
    title.setAttribute("font-weight", "600");
    title.textContent = "🦁❤  Elite K/D vs enemy weapon KPM";
    svg.appendChild(title);

    const ylab = ns("text");
    ylab.setAttribute("x", PLOT.x + PLOT.w + 44);
    ylab.setAttribute("y", PLOT.y + PLOT.h / 2);
    ylab.setAttribute("fill", "#f2f0ea");
    ylab.setAttribute("font-size", "12");
    ylab.setAttribute("text-anchor", "middle");
    ylab.setAttribute("transform", `rotate(90 ${PLOT.x + PLOT.w + 44} ${PLOT.y + PLOT.h / 2})`);
    ylab.textContent = "projected K/D";
    svg.appendChild(ylab);

    for (const x of [0, 0.5, 1.0, 1.5, 2.0]) {
      const t = ns("text");
      t.setAttribute("x", xToPx(x));
      t.setAttribute("y", PLOT.y + PLOT.h + 18);
      t.setAttribute("fill", "#f2f0ea");
      t.setAttribute("font-size", "11");
      t.setAttribute("text-anchor", "middle");
      t.textContent = x.toFixed(1);
      svg.appendChild(t);
    }
    for (const y of yTicks) {
      const t = ns("text");
      t.setAttribute("x", PLOT.x + PLOT.w + 8);
      t.setAttribute("y", yToPx(y) + 4);
      t.setAttribute("fill", "#f2f0ea");
      t.setAttribute("font-size", "11");
      t.setAttribute("text-anchor", "start");
      t.textContent = formatTick(y, scale.log);
      svg.appendChild(t);
    }

    // Short axis labels only (no farm % clutter)
    const capY = PLOT.y + PLOT.h + 40;
    addText(svg, PLOT.x, capY, "easy", "#8a8882", 10, "start");
    addText(svg, PLOT.x + PLOT.w / 2, capY, "enemy weapon KPM", "#8a8882", 10, "middle");
    addText(svg, PLOT.x + PLOT.w, capY, "hard", "#8a8882", 10, "end");
    addText(svg, xToPx(EASY_MAX), capY + 14, "0.75", "#8a8882", 9, "middle");
    addText(svg, xToPx(HARD_MIN), capY + 14, "1.50", "#8a8882", 9, "middle");

    const labelAnchors = [];
    list.forEach((p, i) => {
      const col = COLORS[i % COLORS.length];
      const pts = (p.curve || [])
        .filter((pt) => pt.kpm <= X_MAX + 1e-9)
        .map((pt) => ({
          ...pt,
          rel: reliability(pt),
          valid: isFiniteNum(pt.kd) && (pt.deaths > 0 || pt.kills > 0),
        }));

      const faint = pts.filter((pt) => pt.valid);
      if (faint.length >= 2) {
        const path = ns("path");
        path.setAttribute(
          "d",
          faint
            .map((pt, j) => `${j ? "L" : "M"}${xToPx(pt.kpm).toFixed(2)},${yToPx(pt.kd).toFixed(2)}`)
            .join(" ")
        );
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", col);
        path.setAttribute("stroke-width", "0.7");
        path.setAttribute("stroke-opacity", "0.2");
        svg.appendChild(path);
      }

      for (let a = 0; a < pts.length - 1; a++) {
        const A = pts[a], B = pts[a + 1];
        if (!A.valid || !B.valid) continue;
        const r = Math.min(A.rel, B.rel);
        const seg = ns("line");
        seg.setAttribute("x1", xToPx(A.kpm));
        seg.setAttribute("y1", yToPx(A.kd));
        seg.setAttribute("x2", xToPx(B.kpm));
        seg.setAttribute("y2", yToPx(B.kd));
        seg.setAttribute("stroke", col);
        seg.setAttribute("stroke-width", (0.5 + 1.3 * r).toFixed(2));
        seg.setAttribute("stroke-opacity", (0.3 + 0.7 * r).toFixed(2));
        seg.setAttribute("stroke-linecap", "round");
        svg.appendChild(seg);
      }

      // Fixed small markers (no √deaths sizing)
      for (const pt of pts) {
        if (!pt.valid) continue;
        if (pt.rel < 0.35) {
          drawX(svg, xToPx(pt.kpm), yToPx(pt.kd), DOT_R, col);
        } else {
          const c = ns("circle");
          c.setAttribute("cx", xToPx(pt.kpm));
          c.setAttribute("cy", yToPx(pt.kd));
          c.setAttribute("r", String(DOT_R));
          c.setAttribute("fill", col);
          c.setAttribute("fill-opacity", "0.92");
          c.setAttribute("stroke", "#0b0c0e");
          c.setAttribute("stroke-width", "0.6");
          svg.appendChild(c);
        }
      }

      let anchor = null;
      const easyPts = pts.filter((pt) => pt.valid && pt.kpm <= 0.25);
      if (easyPts.length) {
        easyPts.sort((a, b) => a.kpm - b.kpm);
        anchor = easyPts[0];
      } else {
        const finite = pts.filter((pt) => pt.valid);
        if (finite.length) {
          finite.sort((a, b) => a.kpm - b.kpm);
          anchor = finite[0];
        }
      }
      if (anchor) {
        labelAnchors.push({
          i,
          col,
          x: anchor.kpm,
          y: anchor.kd,
          display: p.display,
        });
      }
    });

    labelAnchors.sort((a, b) => yToPx(a.y) - yToPx(b.y));
    const placed = [];
    for (const lab of labelAnchors) {
      let fy = yToPx(lab.y);
      for (const prev of placed) {
        if (Math.abs(fy - prev) < 16) fy = prev + 16;
      }
      fy = Math.min(PLOT.y + PLOT.h - 8, Math.max(PLOT.y + 10, fy));
      placed.push(fy);
      const num = ns("text");
      num.setAttribute("x", PLOT.x - 10);
      num.setAttribute("y", fy + 4);
      num.setAttribute("fill", lab.col);
      num.setAttribute("font-size", "13");
      num.setAttribute("font-weight", "700");
      num.setAttribute("text-anchor", "end");
      num.textContent = String(lab.i + 1);
      svg.appendChild(num);
      const link = ns("line");
      link.setAttribute("x1", PLOT.x - 6);
      link.setAttribute("y1", fy);
      link.setAttribute("x2", xToPx(lab.x));
      link.setAttribute("y2", yToPx(lab.y));
      link.setAttribute("stroke", lab.col);
      link.setAttribute("stroke-width", "0.7");
      link.setAttribute("stroke-opacity", "0.7");
      svg.appendChild(link);
    }

    renderStatsTable(list);
    renderLegend(list);
  }

  function drawX(svg, cx, cy, s, col) {
    const g = ns("g");
    g.setAttribute("stroke", col);
    g.setAttribute("stroke-width", "1.2");
    g.setAttribute("stroke-linecap", "round");
    const a = ns("line");
    a.setAttribute("x1", cx - s * 0.55);
    a.setAttribute("y1", cy - s * 0.55);
    a.setAttribute("x2", cx + s * 0.55);
    a.setAttribute("y2", cy + s * 0.55);
    const b = ns("line");
    b.setAttribute("x1", cx - s * 0.55);
    b.setAttribute("y1", cy + s * 0.55);
    b.setAttribute("x2", cx + s * 0.55);
    b.setAttribute("y2", cy - s * 0.55);
    g.appendChild(a);
    g.appendChild(b);
    svg.appendChild(g);
  }

  function addText(svg, x, y, text, fill, size, anchor) {
    const t = ns("text");
    t.setAttribute("x", x);
    t.setAttribute("y", y);
    t.setAttribute("fill", fill);
    t.setAttribute("font-size", String(size));
    t.setAttribute("text-anchor", anchor);
    t.textContent = text;
    svg.appendChild(t);
    return t;
  }

  function niceLinTicks(lo, hi, n) {
    const span = hi - lo || 1;
    const step = niceNum(span / (n - 1));
    const start = Math.ceil(lo / step) * step;
    const ticks = [];
    for (let v = start; v <= hi + step * 0.01; v += step) ticks.push(+v.toFixed(6));
    return ticks;
  }

  function niceNum(range) {
    const exp = Math.floor(Math.log10(range));
    const f = range / Math.pow(10, exp);
    let nf;
    if (f < 1.5) nf = 1;
    else if (f < 3) nf = 2;
    else if (f < 7) nf = 5;
    else nf = 10;
    return nf * Math.pow(10, exp);
  }

  function niceLogTicks(lo, hi) {
    const ticks = [];
    const start = Math.floor(Math.log10(lo));
    const end = Math.ceil(Math.log10(hi));
    for (let e = start; e <= end; e++) {
      const v = Math.pow(10, e);
      if (v >= lo * 0.99 && v <= hi * 1.01) ticks.push(v);
    }
    return ticks.length ? ticks : [lo, hi];
  }

  function formatTick(y, log) {
    if (log) {
      if (y >= 10) return y.toFixed(0);
      if (y >= 1) return y.toFixed(1);
      return y.toFixed(2);
    }
    if (Math.abs(y) >= 10) return y.toFixed(0);
    return y.toFixed(1);
  }

  function renderStatsTable(list) {
    if (!els.stats) return;
    if (!list.length) {
      els.stats.innerHTML = "";
      return;
    }

    const metrics = list.map((p) => {
      const m = rfIf(p);
      const ivi = resolveIvi(p);
      const rf = m && isFiniteNum(m.rf) ? m.rf : NaN;
      const act = m && isFiniteNum(m.ifactor) ? m.ifactor : NaN;
      const rkd = m && isFiniteNum(m.rkd) ? m.rkd : NaN;
      const ekpm = m && isFiniteNum(m.avg_opp) ? m.avg_opp : NaN;
      const own = m && isFiniteNum(m.own) ? m.own : (+p.own_kpm || +p.global_kpm || NaN);
      const slope = slope2575(p);
      const dm = deathMixLite(p);
      return {
        p,
        m,
        kd: p.global_kd,
        kpm: p.global_kpm,
        ownKpm: p.own_kpm || p.global_kpm,
        acc: p.acc,
        hsr: p.hsr,
        ivi,
        rkd,
        ekpm,
        own,
        rf,
        act,
        coi: combatOutput(rf),
        mech: projectedMech(rf),
        slope,
        pvs: pressureVolume(act, slope),
        adj: adjustedIvi(ivi, rf),
        kd15: dm.kd15,
        inflation: dm.inflation,
      };
    });

    const head = metrics
      .map((row, i) => {
        const col = COLORS[i % COLORS.length];
        return `<th style="color:${col}">${escapeHtml(row.p.display)}</th>`;
      })
      .join("");

    function cells(fn, digits) {
      return metrics
        .map((row) => `<td>${fmtNum(fn(row), digits)}</td>`)
        .join("");
    }

    const publicRows = `
      <tr><td>KD</td>${cells((r) => r.kd, 2)}</tr>
      <tr><td>KPM</td>${cells((r) => r.kpm, 2)}</tr>
      <tr><td>own KPM</td>${cells((r) => r.ownKpm, 2)}</tr>
      <tr><td>Acc %</td>${cells((r) => r.acc, 1)}</tr>
      <tr><td>HSR %</td>${cells((r) => r.hsr, 1)}</tr>
      <tr><td>IvI</td>${cells((r) => r.ivi, 0)}</tr>
    `;

    const adjRows = `
      <tr><td>rKD</td>${cells((r) => r.rkd, 3)}</tr>
      <tr><td>avg opp KPM</td>${cells((r) => r.ekpm, 2)}</tr>
      <tr><td>own KPM</td>${cells((r) => r.own, 2)}</tr>
      <tr><td>RF</td>${cells((r) => r.rf, 2)}</tr>
      <tr><td>Activity</td>${cells((r) => r.act, 2)}</tr>
      <tr><td>COI</td>${cells((r) => r.coi, 2)}</tr>
      <tr><td>mech%</td>${cells((r) => r.mech, 1)}</tr>
      <tr><td>slope</td>${cells((r) => r.slope, 2)}</tr>
      <tr><td>PVS</td>${cells((r) => r.pvs, 2)}</tr>
      <tr><td>adjIvI</td>${cells((r) => r.adj, 0)}</tr>
      <tr><td>KD@1.5</td>${cells((r) => r.kd15, 2)}</tr>
      <tr><td>inflation</td>${cells((r) => r.inflation, 2)}</tr>
    `;

    els.stats.innerHTML = `
      <details class="stats-section">
        <summary>Public (Census / Honu)</summary>
        <div class="stats-table-wrap">
          <table class="stats-table">
            <thead><tr><th>Metric</th>${head}</tr></thead>
            <tbody>${publicRows}</tbody>
          </table>
        </div>
      </details>
      <div class="stats-section">
        <div class="section-title">Adjusted (calculated)</div>
        <div class="stats-table-wrap">
          <table class="stats-table">
            <thead><tr><th>Metric</th>${head}</tr></thead>
            <tbody>${adjRows}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderLegend(list) {
    els.legend.innerHTML = "";
    list.forEach((p, i) => {
      const col = COLORS[i % COLORS.length];
      const item = document.createElement("div");
      item.className = "legend-item";
      const iviBit = p.ivi != null && isFiniteNum(+p.ivi)
        ? `, IvI ${(+p.ivi).toFixed(0)}`
        : "";
      item.innerHTML = `
        <span class="legend-swatch" style="background:${col}"></span>
        <span style="color:${col}"><strong>${i + 1}.</strong> ${escapeHtml(p.display)}
          <span style="color:#8a8882;font-size:0.8em">
            (KD ${p.global_kd.toFixed(2)}, own KPM ${p.own_kpm.toFixed(2)}${iviBit}, ${escapeHtml(p.source)})
          </span>
        </span>
      `;
      els.legend.appendChild(item);
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function sourceLabel(src) {
    if (!src) return "unknown";
    if (src.startsWith("local:")) return `bundled (${src.slice(6)})`;
    if (src === "cache:localStorage") return "browser cache";
    if (src.startsWith("live:")) return "live Honu/Census";
    return src;
  }

  function setFetching(on) {
    fetching = on;
    if (els.analyzeBtn) els.analyzeBtn.disabled = on;
    if (els.copyLinkBtn) els.copyLinkBtn.disabled = on;
    // Keep × always clickable so users can clear mid-fetch
    if (els.fetchFresh) els.fetchFresh.disabled = on;
  }

  function chartWrap() {
    return els.chart ? els.chart.closest(".chart-wrap") : null;
  }

  function setPlaceholderVisible(show) {
    const wrap = chartWrap();
    if (wrap) wrap.classList.toggle("empty", !!show);
    if (els.chartPlaceholder) {
      els.chartPlaceholder.setAttribute("aria-hidden", show ? "false" : "true");
    }
    if (els.chart) {
      if (show) els.chart.setAttribute("hidden", "");
      else els.chart.removeAttribute("hidden");
    }
    const cta = els.chartPlaceholder
      ? els.chartPlaceholder.querySelector(".chart-placeholder-cta")
      : null;
    if (cta && show) {
      cta.textContent = "Press Analyze";
    }
  }

  function showIdleChart(message) {
    clearSvg(els.chart);
    if (els.stats) els.stats.innerHTML = "";
    els.legend.innerHTML = "";
    players = [];
    lastAnalyzedNames = [];
    setPlaceholderVisible(true);
    const cta = els.chartPlaceholder
      ? els.chartPlaceholder.querySelector(".chart-placeholder-cta")
      : null;
    if (cta) cta.textContent = message || "Press Analyze";
  }

  function clearChartUi() {
    showIdleChart("Press Analyze");
  }

  function findLoadedPlayer(name) {
    const slug = slugKey(name);
    return players.find((p) => slugKey(p.display) === slug || namesEqualIgnoreCase(p.display, name));
  }

  async function analyzeNames(names, { forceFresh = false } = {}) {
    if (fetching) return;
    const clean = names.map((n) => String(n).trim()).filter(Boolean);
    if (!clean.length) {
      clearChartUi();
      setStatus('<span class="err">Enter at least one character name (spaces or commas).</span>', "err");
      return;
    }

    const fresh = forceFresh || !!(els.fetchFresh && els.fetchFresh.checked);
    const sameSet =
      players.length > 0 &&
      lastAnalyzedNames.length > 0 &&
      namesSetKey(clean) === namesSetKey(lastAnalyzedNames);

    // Unchanged names + fresh unchecked → re-render only (no refetch)
    if (sameSet && !fresh) {
      drawChart(players);
      setStatus(
        `<span class="ok">Showing ${players.map((p) => escapeHtml(p.display)).join(" vs ")}</span>` +
        ` <span class="src">[re-rendered — names unchanged, using current data]</span>`
      );
      return;
    }

    setFetching(true);
    setProgress(true, `Fetching 0/${clean.length}…`);
    setStatus(`Analyzing ${clean.length} player${clean.length > 1 ? "s" : ""}…`);

    const loaded = [];
    const errors = [];
    const successNames = [];

    for (let idx = 0; idx < clean.length; idx++) {
      const name = clean[idx];
      setProgress(true, `Fetching ${idx + 1}/${clean.length} ${name}…`);

      // Reuse in-memory player when names changed but this one is still present
      if (!fresh) {
        const existing = findLoadedPlayer(name);
        if (existing && lastAnalyzedNames.some((n) => namesEqualIgnoreCase(n, name))) {
          loaded.push(existing);
          successNames.push(name);
          continue;
        }
      }

      try {
        const p = await loadOne(name, { fresh });
        loaded.push(p);
        successNames.push(name);
        cachePut(name, p);
        setStatus(
          `Loaded <strong>${escapeHtml(p.display)}</strong> ` +
          `<span class="src">via ${escapeHtml(sourceLabel(p.source))}</span>…`
        );
      } catch (e) {
        errors.push(`${name}: ${e.message}`);
      }
    }

    setFetching(false);
    setProgress(false);

    if (!loaded.length) {
      clearChartUi();
      setStatus(
        `<span class="err">Nothing loaded.</span> ` +
        `<span class="err">${escapeHtml(errors.join(" | "))}</span>` +
        (fresh
          ? ` <span class="src">Fetch fresh was on — live Honu/Census only.</span>`
          : ` <span class="src">Tried bundled ./data/ → cache → live.</span>`),
        "err"
      );
      return;
    }

    players = loaded;
    lastAnalyzedNames = successNames.slice();
    drawChart(players);
    saveLastComparison(successNames);
    renderNameTokens();
    renderCacheChips();

    const srcBits = loaded
      .map((p) => `${escapeHtml(p.display)} ← ${escapeHtml(sourceLabel(p.source))}`)
      .join("; ");
    const notes = errors.length
      ? ` <span class="warn">Partial — skipped: ${escapeHtml(errors.join(" | "))}</span>`
      : "";
    setStatus(
      `<span class="ok">Showing ${players.map((p) => escapeHtml(p.display)).join(" vs ")}</span>` +
      ` <span class="src">[${srcBits}]</span>${notes}`
    );
  }

  function buildShareUrl(names) {
    const list = (names && names.length ? names : currentNamesInField());
    const param = list.map((n) => String(n).trim()).filter(Boolean).join(",");
    const url = new URL(window.location.href);
    if (param) url.searchParams.set("names", param);
    else url.searchParams.delete("names");
    return url.toString();
  }

  async function copyShareLink() {
    const names = currentNamesInField();
    if (!names.length) {
      setStatus('<span class="err">Nothing to copy — enter at least one name.</span>', "err");
      return;
    }
    const link = buildShareUrl(names);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const ta = document.createElement("textarea");
        ta.value = link;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setStatus(`<span class="ok">Copied link</span> <span class="src">${escapeHtml(link)}</span>`);
    } catch (e) {
      setStatus(
        `<span class="warn">Could not copy automatically.</span> ` +
        `<span class="src">${escapeHtml(link)}</span>`,
        "warn"
      );
    }
  }

  function namesFromQuery() {
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get("names");
      if (!raw) return null;
      const list = parseNames(raw);
      return list.length ? list : null;
    } catch {
      return null;
    }
  }

  function resolveStartupNames() {
    const fromQuery = namesFromQuery();
    if (fromQuery) return { names: fromQuery, reason: "url" };
    const last = getLastComparison();
    if (last && last.length) return { names: last, reason: "last" };
    return { names: DEFAULT_NAMES.slice(), reason: "default" };
  }

  /* ---------- events ---------- */

  if (els.analyzeBtn) {
    els.analyzeBtn.addEventListener("click", () => {
      commitFragment({ clearInput: true });
      const names = currentNamesInField();
      if (!names.length) {
        clearChartUi();
        setStatus('<span class="err">Enter at least one character name (spaces or commas).</span>', "err");
        return;
      }
      analyzeNames(names);
    });
  }

  if (els.namesInput) {
    els.namesInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitFragment({ clearInput: true });
        if (!fetching && els.analyzeBtn) els.analyzeBtn.click();
        return;
      }
      if (e.key === "Backspace" && !els.namesInput.value && nameTokens.length) {
        e.preventDefault();
        nameTokens.pop();
        renderNameTokens();
        renderCacheChips();
      }
    });

    els.namesInput.addEventListener("input", () => {
      const val = els.namesInput.value;
      // Completed token(s) when text ends with a separator
      if (/[\s,;]$/.test(val)) {
        const tokens = parseNames(val);
        for (const t of tokens) addNameToField(t);
        els.namesInput.value = "";
      }
      renderCacheChips();
    });

    els.namesInput.addEventListener("blur", () => {
      // Do not auto-commit on blur — only separator / Analyze / Enter
      renderCacheChips();
    });

    els.namesInput.addEventListener("paste", () => {
      // Bulk paste: lock every complete token parseNames finds (keeps [TAG] Name intact)
      requestAnimationFrame(() => {
        const val = els.namesInput.value;
        if (!/[,;\s]/.test(val)) {
          renderCacheChips();
          return;
        }
        const tokens = parseNames(val);
        for (const t of tokens) addNameToField(t);
        if (tokens.length) els.namesInput.value = "";
        renderCacheChips();
      });
    });
  }

  if (els.namesBox) {
    els.namesBox.addEventListener("click", (e) => {
      if (e.target.closest && e.target.closest("#clearNamesBtn, .clear-names")) return;
      const main = els.namesBox.querySelector(".names-box-main");
      if (
        e.target === els.namesBox ||
        e.target === els.nameTokensEl ||
        e.target === main ||
        (main && main.contains(e.target) && e.target.tagName !== "BUTTON")
      ) {
        if (els.namesInput) els.namesInput.focus();
      }
    });
  }

  if (els.copyLinkBtn) {
    els.copyLinkBtn.addEventListener("click", () => {
      commitFragment({ clearInput: true });
      copyShareLink();
    });
  }

  if (els.clearNamesBtn) {
    els.clearNamesBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearNamesFromInput();
      clearChartUi();
      setStatus("Ready — press Analyze");
      if (els.namesInput) els.namesInput.focus();
    });
  }

  // Expose tiny helpers for sanity checks in console / node --check stays syntax-only
  if (typeof window !== "undefined") {
    window.__ps2EliteKd = {
      parseNames,
      namesSetKey,
      CACHE_TTL_MS,
      rfIf,
      adjustedIvi,
      sliceAt,
      combatOutput,
      projectedMech,
      slope2575,
      pressureVolume,
      resolveIvi,
      deathMixLite,
      SLOPE_FLOOR,
      SLOPE_EPS,
      LS_CACHE,
      currentNamesInField,
      isNameFetched,
      getNameTokens: () => nameTokens.slice(),
    };
  }

  // Startup — fill chips only; wait for Analyze (Enter still works)
  const startup = resolveStartupNames();
  setNameTokens(startup.names);
  renderLastLink();
  showIdleChart("Press Analyze");
  const reasonNote =
    startup.reason === "url"
      ? "from URL"
      : startup.reason === "last"
        ? "restored last comparison"
        : "demo defaults";
  setStatus(`Ready — press Analyze <span class="src">${reasonNote}</span>`);
})();
