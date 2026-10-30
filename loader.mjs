/**
 * Loading one player: this browser's copy, the shared cache (data/), or live from Census (paced, retried), with the
 * removal list checked before and after (#61) (#66: moved out of app.js unchanged).
 */
import { checkAborted, slugKey, isAbortError, escapeHtml } from "./app-util.mjs?v=20261027-z79";
import { entryFetchedAt, pickNewest } from "./cache-pick.mjs?v=20261010-sav1";
import { censusQueryName, NameLoadError, classifyLoadError, isTransientKind } from "./analyze-run.mjs?v=20261030-cxl1";
import { parsePsKey, censusNsBase, PS_SERVERS, nsOfBase } from "./rooms.mjs?v=20261022-ps1";
import { CENSUS_SERVICE_ID } from "./config.mjs?v=20261010-sav1";
import { t as tr } from "./i18n.mjs";
import { censusRequest, OPPONENT_TOP_N, fetchPlayerCensus } from "./census-fetch.mjs?v=20261010-sav1";
import { kpmCurve } from "./math.mjs?v=20261027-z79";
import { accountTimes } from "./flairs.mjs?v=20261010-sav1";
import { infantryKillsUrl, summarizeInfantryKills } from "./infantry.mjs?v=20261023-short1";
import { removedList } from "./opt-out.mjs?v=20261023-proof1";

/**
 * $ = app.js state and functions this part uses, as live getters (and setters for state it changes), so app.js
 * stays the one owner: CENSUS, CENSUS_BASES, CENSUS_BOARD_TIMEOUT_MS, CENSUS_TIMEOUT_MS, DATA, HONU_SIDE_TIMEOUT_MS, IS_PS, cacheGet, censusBucket, censusLimit, els, findSharedEntry, normalizePlayer, removedNow, setStatus.
 */
export function createLoader($) {
  const HONU = "https://wt.honu.pw/api/character/";

  let removedP = null;

  /**
   * GET JSON. `timeoutMs` aborts a hung request with a TimeoutError (never an
   * AbortError, so it counts as a per-name failure, not a user cancel).
   */
  async function fetchJson(url, signal, { timeoutMs = 0 } = {}) {
    checkAborted(signal);
    let useSignal = signal || null;
    let timer = 0;
    let timedOut = false;
    let onOuterAbort = null;
    if (timeoutMs > 0 && typeof AbortController !== "undefined") {
      const ctl = new AbortController();
      onOuterAbort = () => ctl.abort();
      if (signal && typeof signal.addEventListener === "function") {
        signal.addEventListener("abort", onOuterAbort, { once: true });
      }
      timer = setTimeout(() => {
        timedOut = true;
        ctl.abort();
      }, timeoutMs);
      useSignal = ctl.signal;
    }
    try {
      const res = await fetch(
        url,
        useSignal ? { cache: "no-cache", signal: useSignal } : { cache: "no-cache" }
      );
      if (!res.ok) {
        const err = new Error(`${res.status} ${res.statusText} for ${url}`);
        err.status = res.status;
        throw err;
      }
      const data = await res.json();
      checkAborted(signal);
      return data;
    } catch (e) {
      checkAborted(signal); // user cancel always wins
      if (timedOut) {
        const t = new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s: ${url}`);
        t.name = "TimeoutError";
        throw t;
      }
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
      if (onOuterAbort && signal && typeof signal.removeEventListener === "function") {
        signal.removeEventListener("abort", onOuterAbort);
      }
    }
  }

  async function loadLocal(name, signal) {
    const key = slugKey(name);
    const shared = $.findSharedEntry(name);
    const candidates = [];
    if (shared && shared.file) {
      const rel = String(shared.file).replace(/^\.?\/?data(?:-ps)?\//, "");
      candidates.push(`${$.DATA}${rel}`);
    }
    // (The old data/<key>.json and data/<key>_top50.json layouts are gone: probing them
    // just added two 404s to every unknown name.) PS files are keyed by server + id:
    // never guessed from a name.
    if (!$.IS_PS) candidates.push(`data/players/${key}.json`);
    const seen = new Set();
    const unique = [];
    for (const p of candidates) {
      if (!p || seen.has(p)) continue;
      seen.add(p);
      unique.push(p);
    }

    let lastErr;
    for (const path of unique) {
      try {
        const data = await fetchJson(path, signal);
        data._source = `shared:${path}`;
        const np = $.normalizePlayer(data);
        np.fetchedAt = +data.savedAt || (shared && +shared.savedAt) || 0;
        return np;
      } catch (e) {
        if (isAbortError(e)) throw e;
        lastErr = e;
      }
    }
    throw lastErr || new Error(`No shared data for ${name}`);
  }

  function loadFromCache(name) {
    const entry = $.cacheGet(name);
    if (!entry) throw new Error(`No cache for ${name}`);
    const np = $.normalizePlayer({
      _source: "cache:localStorage",
      player: entry.player,
    });
    np.fetchedAt = entryFetchedAt(entry);
    return np;
  }

  async function resolveCensus(name, signal) {
    const raw = censusQueryName(name); // "[TAG] Name" → "Name"
    if (!raw) throw new NameLoadError(`Census: empty name ${JSON.stringify(name)}`, "not-found");
    if ($.IS_PS) return resolveCensusPs(raw, name, signal);
    let url;
    if (/^\d{16,}$/.test(raw)) {
      url = `${$.CENSUS}character?character_id=${encodeURIComponent(raw)}&c:resolve=outfit,stat_history`;
    } else {
      url = `${$.CENSUS}character?name.first_lower=${encodeURIComponent(raw.toLowerCase())}&c:resolve=outfit,stat_history`;
    }
    let data;
    try {
      data = await censusJson(url, signal);
    } catch (e) {
      if (isAbortError(e)) throw e;
      throw new NameLoadError(e.message, e && e.kind === "census-busy" ? "census-busy" : "network");
    }
    if (!data || typeof data !== "object") {
      throw new NameLoadError(`Census: bad response for ${raw}`, "bad-response");
    }
    if (!Array.isArray(data.character_list) && (data.error || data.errorCode)) {
      throw new NameLoadError(`Census unavailable: ${data.error || data.errorCode}`, "network");
    }
    const chars = data.character_list || [];
    if (!chars.length || !chars[0] || !chars[0].character_id) {
      throw new NameLoadError(`Census: no character ${raw}`, "not-found");
    }
    return chars[0];
  }

  /**
   * PlayStation room (#55): a saved player is looked up by its own server +
   * character id (never by name, so a namesake can't stand in); a key typed as
   * "us-<cid>" / "eu-<cid>" the same way; anything else by name on Genudine,
   * then Ceres. Only PS namespaces are ever asked. The answer carries _base
   * (its namespace), which every later call for this player uses.
   */
  async function resolveCensusPs(raw, name, signal) {
    const shared = $.findSharedEntry(name);
    const id = parsePsKey((shared && shared.key) || raw.toLowerCase());
    const show = "&c:resolve=outfit,stat_history";
    const tries = id
      ? [{ base: censusNsBase(id.ns, CENSUS_SERVICE_ID), q: `character_id=${encodeURIComponent(id.cid)}` }]
      : $.CENSUS_BASES.map((base) => ({
          base,
          q: /^\d{16,}$/.test(raw) ? `character_id=${encodeURIComponent(raw)}` : `name.first_lower=${encodeURIComponent(raw.toLowerCase())}`,
        }));
    for (const t of tries) {
      let data;
      try {
        data = await censusJson(`${t.base}character?${t.q}${show}`, signal);
      } catch (e) {
        if (isAbortError(e)) throw e;
        throw new NameLoadError(e.message, e && e.kind === "census-busy" ? "census-busy" : "network");
      }
      if (!data || typeof data !== "object") throw new NameLoadError(`Census: bad response for ${raw}`, "bad-response");
      if (!Array.isArray(data.character_list) && (data.error || data.errorCode)) {
        throw new NameLoadError(`Census unavailable: ${data.error || data.errorCode}`, "network");
      }
      const c = (data.character_list || [])[0];
      if (c && c.character_id && (!id || String(c.character_id) === id.cid)) {
        c._base = t.base;
        return c;
      }
    }
    throw new NameLoadError(`Census: no character ${raw} on Genudine or Ceres`, "not-found");
  }

  /** PS server name ("Genudine" / "Ceres") of a Census base, or "". */
  function serverOfBase(base) {
    const s = PS_SERVERS[nsOfBase(base)];
    return s ? s.name : "";
  }

  /** PS room: small server tag after a player's name ("Genudine" / "Ceres"); nothing on PC. */
  function serverTagHtml(p) {
    if (!$.IS_PS || !p || !p.server) return "";
    const s = escapeHtml(p.server);
    return `<span class="srv-tag" title="${escapeHtml(tr("room.serverTip", "PlayStation server: {s}", { s: p.server }))}">${s}</span>`;
  }

  /**
   * One paced Census GET (census-fetch.mjs censusRequest): per-request
   * timeout, exponential backoff + jitter on network errors / 5xx / 429 /
   * Census "busy" answers, at most 2 in flight. While retrying, the status
   * line says so; when Census stays down it throws CensusError
   * (kind "census-busy") and the caller falls back to cached data.
   */
  function censusJson(url, signal) {
    const big = url.includes("characters_event_grouped");
    // The retry line is cleared again when the retrying request ends (owner
    // 2026-10-22: "(2/4)" stayed up after the weapons had loaded), unless
    // something else has written to the status line since.
    let mine = null;
    const clearMine = () => {
      if (mine && $.els.status.innerHTML === mine) $.setStatus("");
    };
    return $.censusLimit(() =>
      censusRequest(url, {
        signal,
        bucket: $.censusBucket,
        retries: 4,
        timeoutMs: big ? $.CENSUS_BOARD_TIMEOUT_MS : $.CENSUS_TIMEOUT_MS,
        expectData: big || url.includes("character?name.first_lower="),
        baseMs: 1500,
        capMs: 20000,
        onRetry: ({ attempt, retries }) => {
          if (signal && signal.aborted) return;
          $.setStatus(
            `<span class="warn">${tr("msg.censusRetry", "⏳ Daybreak Census is busy, retrying… ({a}/{r})", { a: attempt, r: retries })}</span>`,
            "warn census-retry"
          );
          mine = $.els.status.innerHTML;
        },
      })
    ).finally(clearMine);
  }

  /** Honu fallback ONLY for lifetime history Census lacks (no stat_history). */
  async function honuHistoryFallback(c, signal) {
    try {
      const h = await fetchJson(`${HONU}${c.character_id}/history_stats`, signal, { timeoutMs: $.HONU_SIDE_TIMEOUT_MS });
      if (!Array.isArray(h) || !h.length) return;
      const pick = (t) => {
        const r = h.find((x) => x && x.type === t);
        return r ? String(r.allTime || 0) : "0";
      };
      c.stats = { ...(c.stats || {}), stat_history: ["kills", "deaths", "time"].map((t) => ({ stat_name: t, all_time: pick(t) })) };
    } catch (e) {
      if (isAbortError(e)) throw e;
    }
  }

  function hist(c, stat) {
    for (const row of ((c.stats || {}).stat_history) || []) {
      if (row.stat_name === stat) return +row.all_time || 0;
    }
    return 0;
  }

  /** Live load (Census); `run` carries the analyze run's abort signal. */
  async function loadLive(name, run) {
    const signal = run ? run.signal : undefined;
    checkAborted(signal);
    return loadLiveInner(name, signal);
  }

  async function loadLiveInner(name, signal) {
    const c = await resolveCensus(name, signal);
    const cid = c.character_id;
    // PC: ps2. PS room: the namespace the character was found in (#55).
    const base = c._base || $.CENSUS;
    if (!$.IS_PS && !["kills", "deaths", "time"].every((t) => (((c.stats || {}).stat_history) || []).some((x) => x && x.stat_name === t))) {
      await honuHistoryFallback(c, signal); // Honu is PC only
    }
    const outfit = c.outfit || {};
    const gk = hist(c, "kills"), gd = hist(c, "deaths"), gt = hist(c, "time");
    const gkd = gd ? gk / gd : gk;
    const gkpm = gt ? gk / (gt / 60) : 0;
    const tag = outfit.alias ? `[${outfit.alias}] ` : "";
    const display = `${tag}${(c.name && c.name.first) || censusQueryName(name)}`;

    let r;
    try {
      r = await fetchPlayerCensus(cid, {
        base,
        topN: OPPONENT_TOP_N,
        getJson: (u) => censusJson(u, signal),
      });
    } catch (e) {
      if (isAbortError(e)) throw e;
      if (e && e.name === "CensusError") throw new NameLoadError(e.message, "census-busy");
      throw e;
    }
    checkAborted(signal);
    if (!r.board.length) throw new NameLoadError(`Census: empty killboard for ${cid}`, "no-data");
    if (r.ownFailed && !r.rows.length) {
      throw new NameLoadError(`Census is busy or down (stats for ${display})`, "census-busy");
    }
    const own = r.own || { kpm: 0, acc: 0, hsr: 0, ivi: 0 };
    const rows = r.rows;
    // 🪖 / 🚜 lifetime kill split (one kills-only Census call), so a fresh copy keeps the
    // Infantry value and the vehicle / MAX cut; falls back to the shared copy's split.
    let infantry = null;
    try {
      const j = await censusJson(infantryKillsUrl(base, [cid]), signal);
      infantry = summarizeInfantryKills((j && j.characters_weapon_stat_by_faction_list) || []);
    } catch (e) {
      if (isAbortError(e)) throw e;
    }
    if (!infantry) {
      try { const sh = await loadLocal(name, signal); infantry = (sh && sh.infantry) || null; } catch (e) { if (isAbortError(e)) throw e; }
    }

    const np = $.normalizePlayer({
      _source: "live:census",
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
        top: OPPONENT_TOP_N,
        honu: $.IS_PS ? "" : `https://wt.honu.pw/c/${cid}/killboard`,
        ...($.IS_PS ? { room: "ps", server: serverOfBase(base) } : {}),
        // Already in the character answer (no extra call): flairs.mjs.
        times: accountTimes(c),
        ...(infantry ? { infantry } : {}),
      },
    });
    np.fetchedAt = Date.now();
    // Graceful partial result: opponents Census couldn't return are left out.
    if (r.skipped || r.ownFailed) np.partialSkipped = r.skipped + (r.ownFailed ? 1 : 0);
    return np;
  }

  /* 🚫 Removal list (opt-out.mjs, #61): characters whose players asked not to be shown here. */
  function removedReady() {
    if (!removedP) {
      removedP = fetchJson(`${$.DATA}opt-out.json?h=${Math.floor(Date.now() / 36e5)}`, undefined, { timeoutMs: 8000 })
        .then((j) => ($.removedNow = removedList(j)))
        .catch(() => $.removedNow);
    }
    return removedP;
  }

  function removedError(name) {
    return new NameLoadError(`${name}: removed at the player's request`, "removed");
  }

  /** Newest stored copy (shared file vs browser cache), or null. */
  async function loadStoredNewest(name, signal, errors) {
    let sharedP = null;
    let localP = null;
    try {
      sharedP = await loadLocal(name, signal);
    } catch (e) {
      if (isAbortError(e)) throw e;
      errors.push(`shared: ${e.message}`);
    }
    checkAborted(signal);
    try {
      localP = loadFromCache(name);
    } catch (e) {
      errors.push(`cache: ${e.message}`);
    }
    const pick = pickNewest([
      sharedP && { player: sharedP, fetchedAt: sharedP.fetchedAt, top: sharedP.top, kind: "shared" },
      localP && { player: localP, fetchedAt: localP.fetchedAt, top: localP.top, kind: "local" },
    ]);
    return pick ? pick.player : null;
  }

  /**
   * Default: the newest of shared data/ and browser localStorage (t300u:
   * a "Fetch fresh" result must survive F5 — an older shared file never
   * overrides it; cache-pick.mjs) → live when neither has the player.
   * Fresh: live only (cached copy only when Census is busy/down).
   */
  async function loadOne(name, opts = {}) {
    const removed = await removedReady();
    if (removed.match({ slug: slugKey(name), name })) throw removedError(name);
    const p = await loadOneInner(name, opts);
    if (p && removed.match({ cid: p.cid, server: p.server || "", name: p.display })) throw removedError(p.display || name);
    return p;
  }

  async function loadOneInner(name, { fresh = false, run = null } = {}) {
    const signal = run ? run.signal : undefined;
    checkAborted(signal);
    if (fresh) {
      try {
        return await loadLive(name, run);
      } catch (e) {
        if (isAbortError(e)) throw e;
        // Census busy/down: prefer the cached copy over failing the name.
        // t351u: any live failure keeps a saved copy (shared / browser) instead
        // of dropping a player that was already on the graph.
        const transient = isTransientKind(classifyLoadError(e));
        const cached = await loadStoredNewest(name, signal, []);
        if (cached) return { ...cached, cacheFallback: transient ? true : "kept" };
        throw new NameLoadError(
          `Live fetch failed for ${JSON.stringify(name)}: ${e.message}`,
          classifyLoadError(e)
        );
      }
    }
    const errors = [];
    const stored = await loadStoredNewest(name, signal, errors);
    if (stored) return stored;
    let liveErr = null;
    try {
      return await loadLive(name, run);
    } catch (e) {
      if (isAbortError(e)) throw e;
      liveErr = e;
      errors.push(`live: ${e.message}`);
    }
    // Shared/cache misses are expected; the live error says why the name failed.
    throw new NameLoadError(
      `Could not load ${JSON.stringify(name)}. ${errors.join(" · ")}`,
      classifyLoadError(liveErr)
    );
  }
  return { fetchJson, loadLocal, loadFromCache, resolveCensus, resolveCensusPs, serverOfBase, serverTagHtml, censusJson, honuHistoryFallback, hist, loadLive, loadLiveInner, removedReady, removedError, loadStoredNewest, loadOne, loadOneInner };
}
