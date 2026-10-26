/**
 * This browser's own copy of loaded players (localStorage, pruned), the last comparison, the pending name chips, and
 * the 🗑️ wipe of everything this site stored (#66: moved out of app.js unchanged).
 */
import { readJsonLS, writeJsonLS, slugKey } from "./app-util.mjs?v=20261026-psb1";
import { writeWithEviction } from "./cache-pick.mjs?v=20261010-sav1";
import { namesListKey } from "./analyze-run.mjs?v=20261023-priv1";
import { t as tr } from "./i18n.mjs";

/**
 * $ = app.js state and functions this part uses, as live getters (and setters for state it changes), so app.js
 * stays the one owner: CACHE_TTL_MS, LIVE_MODE, LS_CACHE, LS_CACHE_OLD, LS_DEBUG_COLS, LS_FETCHING, LS_LAST, LS_PENDING, LS_RECENT, LS_THEME, applyBgImage, applyTheme, clearChartUi, els, failedNames, lastAnalyzedNames, lastLoadedNames, listSharedNames, nameLimit, nameTokens, namesFromQuery, persistNamesOn, players, renderCacheChips, renderNameTokens, setStatus, showDebugCols, syncUrlNames, trimForCache, updateFreshEta.
 */
export function createLocalCache($) {
  // Parsed once per stored value: the browser copy can be large and was
  // JSON.parsed again for every name check (cacheGet) on every chip change.
  let cacheStoreMemo = { raw: null, obj: null };

  function getCacheStore() {
    let raw = null;
    try { raw = localStorage.getItem($.LS_CACHE); } catch { raw = null; }
    if (raw !== null && raw === cacheStoreMemo.raw && cacheStoreMemo.obj) return cacheStoreMemo.obj;
    const parsed = readJsonLS($.LS_CACHE, {});
    const obj = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    cacheStoreMemo = { raw, obj };
    return obj;
  }

  function pruneCache(store) {
    const now = Date.now();
    let changed = false;
    for (const key of Object.keys(store)) {
      const entry = store[key];
      if (!entry || !entry.player || !entry.savedAt || now - entry.savedAt > $.CACHE_TTL_MS) {
        delete store[key];
        changed = true;
      }
    }
    return changed;
  }

  function getCache() {
    const store = getCacheStore();
    if (pruneCache(store)) writeJsonLS($.LS_CACHE, store);
    return store;
  }

  function cacheGet(name) {
    const key = slugKey(name);
    const store = getCache();
    const entry = store[key];
    if (!entry || !entry.player || !entry.savedAt) return null;
    if (Date.now() - entry.savedAt > $.CACHE_TTL_MS) return null;
    return entry;
  }

  function cachePut(name, player) {
    const key = slugKey(name);
    if (!key) return;
    const store = getCacheStore();
    const now = Date.now();
    const live = String(player.source || "").startsWith("live:");
    store[key] = {
      name: String(name).trim(),
      savedAt: now,
      // When the DATA was fetched (t300u: newest copy wins on reload). Unknown
      // for an undated shared file → 1, so it never beats a dated copy.
      fetchedAt: +player.fetchedAt > 0 ? +player.fetchedAt : live ? now : 1,
      player: $.trimForCache(player),
    };
    pruneCache(store);
    // Quota full (200-opponent copies are bigger): drop the oldest, keep this one.
    writeWithEviction(store, key, (st) => writeJsonLS($.LS_CACHE, st));
    cacheStoreMemo = { raw: null, obj: null }; // the object was edited in place: read it back fresh
    $.renderNameTokens();
    $.renderCacheChips();
  }

  function listCachedNames() {
    const byKey = new Map();
    for (const item of $.listSharedNames()) {
      byKey.set(item.key, item);
    }
    const store = getCache();
    for (const key of Object.keys(store)) {
      const entry = store[key];
      if (!entry || !entry.player) continue;
      if (byKey.has(key)) continue; // shared wins for chip identity
      byKey.set(key, {
        key,
        name: entry.name || entry.player.display || key,
        savedAt: entry.savedAt || 0,
        source: "browser",
      });
    }
    return [...byKey.values()].sort((a, b) => b.savedAt - a.savedAt);
  }

  /** Forget the restorable "last comparison" (used by × clear and 🗑️ wipe). */
  function forgetLastComparison() {
    try {
      localStorage.removeItem($.LS_LAST);
    } catch {
      /* ignore */
    }
  }

  function saveLastComparison(names) {
    if ($.LIVE_MODE) return;
    writeJsonLS($.LS_LAST, names.map((n) => String(n).trim()).filter(Boolean));
  }

  function getLastComparison() {
    const list = readJsonLS($.LS_LAST, null);
    if (!Array.isArray(list) || !list.length) return null;
    return list.filter((s) => typeof s === "string" && s.trim());
  }

  function persistPendingNames() {
    if (!$.persistNamesOn || $.LIVE_MODE) return;
    writeJsonLS($.LS_PENDING, { names: $.nameTokens.slice(0, $.nameLimit()), base: namesListKey($.namesFromQuery() || []) });
  }

  function getPendingNames() {
    const v = readJsonLS($.LS_PENDING, null);
    return v && typeof v === "object" && Array.isArray(v.names) ? v : null;
  }

  const LS_KEY_PREFIX = "ps2-elite-kd";

  /** Remove every localStorage / sessionStorage key for this app. */
  function wipeAppStorageKeys() {
    const stores = [];
    try {
      stores.push(localStorage);
    } catch {
      /* private mode */
    }
    try {
      stores.push(sessionStorage);
    } catch {
      /* private mode */
    }
    for (const store of stores) {
      const keys = [];
      try {
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i);
          if (k && k.startsWith(LS_KEY_PREFIX)) keys.push(k);
        }
      } catch {
        continue;
      }
      for (const k of keys) {
        try {
          store.removeItem(k);
        } catch {
          /* ignore */
        }
      }
    }
    // Explicit known keys (covers odd separators like ":")
    for (const k of [
      $.LS_CACHE,
      $.LS_CACHE_OLD,
      $.LS_RECENT,
      $.LS_LAST,
      $.LS_PENDING,
      $.LS_THEME,
      $.LS_FETCHING,
    ]) {
      try {
        localStorage.removeItem(k);
      } catch {
        /* ignore */
      }
      try {
        sessionStorage.removeItem(k);
      } catch {
        /* ignore */
      }
    }
  }

  /** Clear any ps2-elite-kd cookies on this path (usually none). */
  function wipeAppCookies() {
    try {
      const raw = document.cookie || "";
      if (!raw) return;
      const parts = raw.split(";");
      for (const part of parts) {
        const name = part.split("=")[0].trim();
        if (!name || !name.startsWith(LS_KEY_PREFIX)) continue;
        const expire = "Thu, 01 Jan 1970 00:00:00 GMT";
        document.cookie = `${name}=;expires=${expire};path=/`;
        document.cookie = `${name}=;expires=${expire};path=/ps2-elite-kd`;
        document.cookie = `${name}=;expires=${expire};path=/ps2-elite-kd/`;
      }
    } catch {
      /* ignore */
    }
  }

  /** Confirm, wipe all local app data, reset chips / results / theme. */
  function wipeAllLocalAppData() {
    const ok = window.confirm(tr("wipe.confirm", "Clear all local data for this app?\n\nThis removes browser cache, theme preference, fetch flags, and last comparison on this device. Shared server cache (data/) is not affected."));
    if (!ok) return;

    wipeAppStorageKeys();
    wipeAppCookies();
    // Keep the "show older debug stats" choice (not mentioned in the confirm text).
    if ($.showDebugCols) {
      try {
        localStorage.setItem($.LS_DEBUG_COLS, "1");
      } catch {
        /* ignore */
      }
    }
    // ?names= in the address bar would bring the names straight back on refresh.
    $.syncUrlNames([]);

    // In-memory UI reset
    $.nameTokens = [];
    if ($.els.namesInput) $.els.namesInput.value = "";
    if ($.els.fetchFresh) { $.els.fetchFresh.checked = false; $.updateFreshEta(); }
    $.players = [];
    $.lastAnalyzedNames = [];
    $.lastLoadedNames = [];
    $.failedNames.clear();
    $.clearChartUi(); // idle chart + drops the auto-scroll bottom padding
    $.renderNameTokens();
    $.renderCacheChips();
    // Default theme after wipe (persists fresh dark preference)
    $.applyTheme("dark", { redraw: false });
    // Background image back on after wipe (its stored "0" is cleared too)
    $.applyBgImage(true);
    $.setStatus(`<span class="ok">${tr("msg.wiped", "Local app data cleared.")}</span>`, "ok");
  }
  return { getCacheStore, pruneCache, getCache, cacheGet, cachePut, listCachedNames, forgetLastComparison, saveLastComparison, getLastComparison, persistPendingNames, getPendingNames, wipeAppStorageKeys, wipeAppCookies, wipeAllLocalAppData };
}
