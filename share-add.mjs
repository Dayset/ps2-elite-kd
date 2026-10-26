/**
 * Sending freshly loaded players to the shared cache (/add, /seen notes), the 🔗 share link, and which names the page
 * starts with (?names=, reload, last comparison) (#66: moved out of app.js unchanged).
 */
import { slugKey, escapeHtml, parseNames } from "./app-util.mjs?v=20261026-brv1";
import { t as tr } from "./i18n.mjs";
import { withRoom } from "./rooms.mjs?v=20261022-ps1";
import { sfx } from "./sfx.mjs?v=20261026-sfx1";
import { resolveStartupSelection } from "./analyze-run.mjs?v=20261023-priv1";

/**
 * $ = app.js state and functions this part uses, as live getters (and setters for state it changes), so app.js
 * stays the one owner: FRESH_PING_GAP_MS, IS_PS, LS_SCROLL_Y, SEEN_TTL_MS, currentNamesInField, els, findSharedEntry, getLastComparison, getNameFailure, getPendingNames, setStatus.
 */
export function createShareAdd($) {
  const DEFAULT_NAMES = [];

  /** Cloudflare Worker that queues names into the shared data/ cache. "" disables. */
  const WORKER_URL = "https://ps2-elite-kd-cache.dayset.workers.dev";

  /** Slugs already sent this page session (avoid re-posting on every Analyze). */
  const sharedAddSent = new Set();

  /**
   * Fire-and-forget: ask the Worker to add names that did NOT come from the
   * shared data/ cache. Never blocks the UI; failures are console-only.
   * @param {{name:string, player:object}[]} loaded  result.loaded from loadEach
   */
  function isLiveMode() {
    return typeof document !== "undefined" && !!document.body && document.body.classList.contains("live-mode");
  }

  function suggestSharedCache(loaded, { quiet = isLiveMode() } = {}) {
    if (!WORKER_URL || $.IS_PS || typeof fetch === "undefined") return; // PC cache Worker: never PS names (#55)
    const names = [];
    for (const { name, player } of loaded || []) {
      const src = String((player && player.source) || "");
      if (src === "local" || src.startsWith("shared:") || src.startsWith("local:")) continue; // already shared
      if ($.findSharedEntry(name)) continue; // e.g. "Fetch fresh" on a shared name
      const bare = String((player && player.display) || name)
        .trim()
        .replace(/^\[[^\]]*\]\s*/, ""); // Worker also strips [TAG]
      const key = slugKey(bare);
      if (!key || sharedAddSent.has(key)) continue;
      sharedAddSent.add(key);
      names.push(bare);
    }
    if (!names.length) return;

    const opts = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names: names.slice(0, 10) }),
    };
    if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
      opts.signal = AbortSignal.timeout(8000);
    }
    fetch(`${WORKER_URL}/add`, opts)
      .then((res) => res.json().catch(() => null))
      .then((data) => {
        if (!data) return;
        if (Array.isArray(data.queued) && data.queued.length) {
          // 🎥 live.html: no note over the feed (#33), console only.
          if (quiet) console.info("[ps2-elite-kd] queued for the shared cache:", data.queued.join(", "));
          else showSharedAddNote(data.queued, data.etaMinutes);
        }
        // Not queued for a transient reason → allow a retry on a later Analyze.
        for (const n of [...(data.unverified || []), ...(data.error ? names : [])]) {
          sharedAddSent.delete(slugKey(n));
        }
      })
      .catch((e) => {
        for (const n of names) sharedAddSent.delete(slugKey(n));
        if (typeof console !== "undefined") {
          console.info("[ps2-elite-kd] shared-cache add skipped:", e && e.message);
        }
      });
  }

  const seenSent = new Set();

  function markRequested(loaded) {
    if (!WORKER_URL || $.IS_PS || typeof fetch === "undefined") return; // PC cache Worker: never PS names (#55)
    const now = Date.now();
    const names = [];
    for (const { name, player } of loaded || []) {
      if (names.length >= 10) break; // Worker max per request
      if (!$.findSharedEntry(name)) continue; // uncached names go through /add
      const bare = String((player && player.display) || name).trim().replace(/^\[[^\]]*\]\s*/, "");
      const key = slugKey(bare);
      if (!key || seenSent.has(key)) continue;
      seenSent.add(key);
      try {
        const last = Number(localStorage.getItem(`ps2ekd:seen:${key}`) || 0);
        if (now - last < $.SEEN_TTL_MS) continue;
        localStorage.setItem(`ps2ekd:seen:${key}`, String(now));
      } catch {
        /* storage blocked: the in-memory set still dedupes this tab */
      }
      names.push(bare);
    }
    if (!names.length) return;
    const opts = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names: names.slice(0, 10) }),
      keepalive: true,
    };
    if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) opts.signal = AbortSignal.timeout(8000);
    fetch(`${WORKER_URL}/seen`, opts).catch(() => {});
  }

  function markFresh(loaded) {
    if (!WORKER_URL || $.IS_PS || typeof fetch === "undefined") return; // PC cache Worker: never PS names (#55)
    const now = Date.now();
    const names = [];
    for (const { name, player } of loaded || []) {
      if (names.length >= 10) break; // Worker max per request
      if (!String((player && player.source) || "").startsWith("live:")) continue; // cache fallback: nothing new
      if (!$.findSharedEntry(name)) continue; // uncached names go through /add
      const bare = String((player && player.display) || name).trim().replace(/^\[[^\]]*\]\s*/, "");
      const key = slugKey(bare);
      if (!key) continue;
      try {
        const last = Number(localStorage.getItem(`ps2ekd:fresh:${key}`) || 0);
        if (now - last < $.FRESH_PING_GAP_MS) continue;
        localStorage.setItem(`ps2ekd:fresh:${key}`, String(now));
      } catch {
        /* storage blocked: the Worker dedupes too */
      }
      names.push(bare);
    }
    if (!names.length) return;
    const opts = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names, fresh: true }),
      keepalive: true,
    };
    if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) opts.signal = AbortSignal.timeout(8000);
    fetch(`${WORKER_URL}/seen`, opts).catch(() => {});
  }

  /** Small, self-dismissing note under the status line. */
  function showSharedAddNote(queued, etaMinutes) {
    if (!$.els.status || !$.els.status.parentNode) return;
    let note = document.getElementById("shared-add-note");
    if (!note) {
      note = document.createElement("div");
      note.id = "shared-add-note";
      note.className = "shared-add-note";
      note.setAttribute("role", "status");
      $.els.status.parentNode.insertBefore(note, $.els.status.nextSibling);
    }
    const list = queued.map((n) => `<strong>${escapeHtml(n)}</strong>`).join(", ");
    const eta = etaMinutes ? tr("cache.addingEta", " (~{n} min)", { n: Math.round(etaMinutes) }) : "";
    note.innerHTML = tr("cache.addingNote", "📦 Adding {names} to the shared cache — ready for everyone in a few minutes{eta}.", { names: list, eta });
    note.hidden = false;
    clearTimeout(showSharedAddNote._t);
    showSharedAddNote._t = setTimeout(() => {
      note.hidden = true;
    }, 12000);
  }

  /** Amber status block for names that could not be fetched. */
  /** Friendly notes when Census was busy: cached copies served / opponents left out. */
  function censusNotesHtml(loaded) {
    const fb = loaded.filter((x) => x.player && x.player.cacheFallback === true).map((x) => x.player.display || x.name);
    const kept = loaded.filter((x) => x.player && x.player.cacheFallback === "kept").map((x) => x.player.display || x.name);
    const part = loaded.filter((x) => x.player && x.player.partialSkipped);
    const out = [];
    if (fb.length) {
      out.push(
        `<span class="warn">${tr("msg.cacheFallback", "⚠️ Daybreak Census is busy or down — showing cached data for {names}.", { names: fb.map((n) => `<strong>${escapeHtml(n)}</strong>`).join(", ") })}</span> ` +
        `<button type="button" class="census-retry-btn">${tr("msg.tryLive", "↻ Try live again")}</button>`
      );
    }
    if (kept.length) {
      out.push(
        `<span class="warn">${tr("msg.keptCopy", "⚠️ Couldn't refresh {names} — kept the saved copy.", { names: kept.map((n) => `<strong>${escapeHtml(n)}</strong>`).join(", ") })}</span>`
      );
    }
    for (const x of part) {
      out.push(
        `<span class="warn">${tr("msg.partial", "⚠️ {name}: {n} opponent(s) left out (Census busy).", { name: escapeHtml(x.player.display || x.name), n: x.player.partialSkipped })}</span>`
      );
    }
    return out.length ? `<div class="census-note" role="status">${out.join("<br>")}</div>` : "";
  }

  function skippedWarningHtml(summary, { extra = "", fresh = false } = {}) {
    if (!summary) return "";
    const items = summary.items
      .map(
        (i) =>
          `<strong class="skipped-name">${escapeHtml(i.name)}</strong>` +
          ` <span class="skipped-reason">(${escapeHtml(i.reason)})</span>`
      )
      .join(", ");
    const tail = [summary.tail, extra].filter(Boolean).join(" ");
    const freshNote =
      fresh && summary.allFailed
        ? ` <span class="src">${tr("msg.freshOnly", "Fetch fresh was on — live Census only.")}</span>`
        : "";
    const retryBtn = summary.retryable ? ` <button type="button" class="census-retry-btn">${tr("msg.tryAgain", "↻ Try again")}</button>` : "";
    return (
      `<div class="skipped-warning" role="status">` +
      `<span class="warn">⚠️ ${escapeHtml(summary.lead)} ${items}.</span> ` +
      `<span class="skipped-tail">${escapeHtml(tail)}</span>${freshNote}${retryBtn}` +
      `</div>`
    );
  }

  function buildShareUrl(names) {
    const list = (names && names.length ? names : $.currentNamesInField());
    const param = list.map((n) => String(n).trim()).filter(Boolean).join(",");
    const url = new URL(window.location.href);
    if (param) url.searchParams.set("names", param);
    else url.searchParams.delete("names");
    return $.IS_PS ? withRoom(url.toString(), "ps") : url.toString();
  }

  async function copyShareLink() {
    // Names that just failed to fetch never go into a share link.
    const inField = $.currentNamesInField();
    const names = inField.filter((n) => !$.getNameFailure(n));
    if (!names.length) {
      if (inField.length) {
        $.setStatus(
          `<span class="warn">${tr("msg.copyNone", "Nothing to copy — none of these names could be fetched.")}</span>`,
          "warn"
        );
        return;
      }
      $.setStatus(`<span class="err">${tr("msg.copyEmpty", "Nothing to copy — enter at least one name.")}</span>`, "err");
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
      // Quiet success: brief ✓ on the square 🔗 button (same size), no link text in the status line.
      flashCopied();
    } catch (e) {
      $.setStatus(
        `<span class="warn">${tr("msg.copyFail", "Could not copy automatically.")}</span> ` +
        `<span class="src">${escapeHtml(link)}</span>`,
        "warn"
      );
    }
  }

  let copiedFlashTimer = 0;

  function flashCopied() {
    sfx("sparkle"); // same dice-press sound: the copy landed
    const btn = $.els.copyLinkBtn;
    if (!btn) return;
    if (copiedFlashTimer) clearTimeout(copiedFlashTimer);
    btn.textContent = "✓";
    btn.classList.add("copied");
    btn.title = tr("msg.linkCopied", "Link copied");
    btn.setAttribute("aria-label", tr("msg.linkCopied", "Link copied"));
    copiedFlashTimer = setTimeout(() => {
      copiedFlashTimer = 0;
      btn.textContent = "🔗";
      btn.classList.remove("copied");
      btn.title = tr("msg.copyLink", "Copy link");
      btn.setAttribute("aria-label", tr("msg.copyLink", "Copy link"));
    }, 1200);
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
    // ?names= (auto-runs) → saved field (no auto-run) → last comparison → empty.
    return resolveStartupSelection({
      urlNames: namesFromQuery(),
      pending: $.getPendingNames(),
      last: $.getLastComparison(),
      defaults: DEFAULT_NAMES,
    });
  }

  /**
   * Shared link (?names=… in the URL): run Analyze once by itself so a friend
   * opening the link lands on the graph. Never for a localStorage-only restore,
   * never with "Fetch fresh", and never on top of a run the user already started
   * (analyzeNames' "graph is ready" check also stops a repeat of the same set).
   * More than 10 names → the first 10 run and the limit hint stays visible.
   */
  /** t379u: this load is a browser refresh / back-forward, not a newly opened link. */
  function isReloadNavigation() {
    try {
      const nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
      if (nav) return nav.type === "reload" || nav.type === "back_forward";
      return performance.navigation && (performance.navigation.type === 1 || performance.navigation.type === 2);
    } catch {
      return false;
    }
  }

  function restoreScrollAfterReload() {
    let want = 0;
    try { want = +sessionStorage.getItem($.LS_SCROLL_Y) || 0; sessionStorage.removeItem($.LS_SCROLL_Y); } catch {}
    if (want <= 0) return;
    let stop = false;
    const quit = () => { stop = true; };
    const evs = ["wheel", "touchstart", "keydown", "pointerdown"];
    evs.forEach((e) => window.addEventListener(e, quit, { once: true, passive: true }));
    const until = Date.now() + 6000;
    const step = () => {
      if (stop) return;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max >= want - 2) { window.scrollTo(0, want); evs.forEach((e) => window.removeEventListener(e, quit)); return; }
      if (Date.now() > until) { window.scrollTo(0, Math.max(0, max)); return; }
      requestAnimationFrame(step);
    };
    step();
  }
  return { isLiveMode, suggestSharedCache, markRequested, markFresh, showSharedAddNote, censusNotesHtml, skippedWarningHtml, buildShareUrl, copyShareLink, flashCopied, namesFromQuery, resolveStartupNames, isReloadNavigation, restoreScrollAfterReload };
}
