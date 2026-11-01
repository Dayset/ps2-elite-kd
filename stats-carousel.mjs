/**
 * ✨ Stats ⇄ 🏅 Positions: one spot under the names box, two modes (owner,
 * 2026-10-19). The two tables sit side by side in a horizontal scroll-snap box;
 * the browser itself moves them (compositor, full refresh rate: the earlier
 * JS-driven drag ran on the main thread and felt ~30 fps on phones). Switch
 * with a finger / trackpad side-swipe only — no tab bar, no dots (owner
 * 2026-10-22: users find the left / right swipe on their own). A table
 * that can still scroll sideways keeps the swipe (the browser hands it on to
 * the slides at the table's edge). Columns of both tables are kept the same
 * width; the table switched to always starts at its first column (t460u); both
 * modes are always the same height (CSS align-items: stretch).
 */

import { hideHeadTip } from "./head-tip.mjs?v=20261025-loc1";
import { hideNamePeek } from "./name-peek.mjs?v=20261025-loc1";

const KEY = "ps2-elite-kd-stats-mode";
// t813u: the remembered slide is kept by its id, so a new order (🌍 Server moved
// before 🏅 Global) still reopens the table the user last looked at. KEY held the
// index in the old order (✨ Stats, 🏅 Global, 🌍 Server) and is read once to carry it over.
const SLIDE_KEY = "ps2-elite-kd-stats-slide";
export const LEGACY_ORDER = ["scSlideStats", "scSlidePos", "scSlideSrv"];

/** Index of the slide to open: saved id first, else the old saved index (old order), else 0. */
export function savedSlideIndex(ids, savedId, legacyIdx) {
  let k = savedId ? ids.indexOf(savedId) : -1;
  if (k < 0 && legacyIdx != null && legacyIdx !== "") k = ids.indexOf(LEGACY_ORDER[legacyIdx | 0]);
  return k < 0 ? 0 : k;
}
const SCROLLERS = ".stats-table-wrap, .rk-pos-wrap";

/** Can this scroller still move in the direction a finger moving by dx would push it? */
export function canScrollToward(el, dx) {
  if (!el) return false;
  const max = el.scrollWidth - el.clientWidth;
  if (max <= 1) return false;
  return dx < 0 ? el.scrollLeft < max - 1 : el.scrollLeft > 1;
}

/**
 * t540u: close every hint that is open in / over the slides once a switch
 * starts (owner 2026-10-23). An open fold note (e.g. "♿ What 🪳 🔀 mean" under
 * the stats table) made both slides taller (same height by design), so the
 * other side showed an empty gap; a tap bubble stayed floating over a table
 * that had left. Returns how many folds were closed.
 */
export function closeSlideHints(root) {
  let n = 0;
  if (root && root.querySelectorAll) for (const d of root.querySelectorAll(".sc-slide details.fold-note[open]")) { d.open = false; n++; }
  hideHeadTip();
  hideNamePeek();
  return n;
}

/** Clamp a mode index to the slides that exist. */
export const clampMode = (i, n) => Math.max(0, Math.min(n - 1, i | 0));

/**
 * @param {{ root: HTMLElement, onChange?: (i: number) => void }} o
 * root holds .sc-viewport > .sc-track > .sc-slide. No tab bar (owner 2026-10-22).
 */
export function mountStatsCarousel({ root, onChange }) {
  if (!root) return null;
  if (root.__sc) return root.__sc; // t471u: one mount per element — no doubled listeners / observers
  const viewport = root.querySelector(".sc-viewport");
  const track = root.querySelector(".sc-track");
  const slides = [...root.querySelectorAll(".sc-slide")];
  if (!viewport || !track || slides.length < 2) return null;
  let i = 0;
  const ids = slides.map((s) => s.id);
  try { i = clampMode(savedSlideIndex(ids, localStorage.getItem(SLIDE_KEY), localStorage.getItem(KEY)), slides.length); } catch {}

  const width = () => viewport.clientWidth || 1;
  const reduced = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
  const n = slides.length;
  let lastW = 0; // viewport width the slides were last placed at (keepPlace)

  /* ----- loop by rotation (#88, 2026-11-01) -----
   * The slides never wrap by a jump any more. The shown slide always sits in the
   * MIDDLE place of the scroll box, its previous slide on the left and its next
   * slide on the right (CSS order; the DOM order stays ✨ 🌍 🏅). So every swipe,
   * including 🏅 → ✨ and ✨ → 🏅, is the browser's own smooth snap glide to a
   * neighbour. Once the slides are at rest (no finger down, no scroll for a
   * moment, or scrollend), the places are re-dealt so the new slide is in the
   * middle again: same picture, nothing moves on screen.
   * Why: the old loop jumped instantly to the far end on touchend. On a real
   * phone the swipe's momentum (fling / snap glide) reaches the scroller just
   * after that jump and carried the slides one step on from the new end, so
   * every wrap after the first landed on 🌍 Server (2↔3, 2↔1 on a Pixel 9), and
   * 🏅 Global only ever appeared by a jump. Nothing here depends on scrollend
   * or on a timer firing at the right moment: a late re-deal only means the
   * next swipe starts one slide away from the middle, which still glides. */
  const LOOP = n >= 3; // two slides cannot have a neighbour on both sides: plain native ends
  const MID = LOOP ? 1 : 0;
  let slots = slides.map((_, k) => k); // slots[k] = visual place of slide k
  const slotOf = (k) => slots[clampMode(k, n)];
  const slideAt = (pos) => { const s = clampMode(pos, n); const k = slots.indexOf(s); return k < 0 ? 0 : k; };
  const posNow = () => Math.round(viewport.scrollLeft / width());
  const shownSlide = () => slideAt(posNow());

  function paint() {
    slides.forEach((s, k) => s.setAttribute("aria-hidden", String(k !== i)));
    root.dataset.mode = String(i);
  }
  function setMode(m, quiet) {
    m = clampMode(m, n);
    if (m === i) return;
    i = m;
    paint();
    try { localStorage.setItem(SLIDE_KEY, ids[i] || ""); localStorage.removeItem(KEY); } catch {}
    if (quiet) return;
    if (onChange) onChange(i);
  }
  /** Deal the places so slide i is in the middle and park the box there (instant, same picture). */
  function center() {
    if (LOOP) {
      slots = slides.map((_, k) => (k - i + MID + n) % n);
      slides.forEach((s, k) => { s.style.order = String(slots[k]); });
    }
    if (!viewport.clientWidth) return; // hidden: placed when it shows (keepPlace)
    const left = slotOf(i) * width();
    if (Math.abs(viewport.scrollLeft - left) >= 1) viewport.scrollTo({ left, behavior: "auto" });
  }

  // t448u: a programmatic switch already played its sound in go(); while that
  // smooth scroll runs, the scroll-follow below must not flip the mode back and
  // forth. The target mode stands until the scroll lands, the user takes over,
  // or 1.2 s pass (the timer means a missing scrollend can never leave it stuck).
  let programmatic = false, progTimer = 0, lastViewportScroll = -1e9;
  const endProgrammatic = () => { programmatic = false; clearTimeout(progTimer); };
  function go(m, { anim = true, quiet = false } = {}) {
    m = clampMode(m, n);
    const fromPos = posNow();
    setMode(m, quiet);
    const pos = slotOf(m);
    const left = pos * width();
    if (Math.abs(viewport.scrollLeft - left) < 1) { scheduleRest(); return; }
    // Not a neighbour of the place in view (only possible with 4+ slides): jump.
    if (Math.abs(pos - fromPos) > 1) { endProgrammatic(); center(); return; }
    programmatic = true;
    clearTimeout(progTimer);
    progTimer = setTimeout(() => { endProgrammatic(); scheduleRest(); }, 1200);
    // t461u: right after a swipe the browser's own snap glide is still running;
    // an instant jump (reduce-motion) would not stop it, so use a smooth scroll
    // while the slides are still moving.
    const moving = performance.now() - lastViewportScroll < 150;
    const smooth = anim && (!reduced() || moving);
    viewport.scrollTo({ left, behavior: smooth ? "smooth" : "auto" });
    scheduleRest();
  }

  /* ----- at rest: re-deal the places (see "loop by rotation" above) ----- */
  let touching = false, restTimer = 0;
  const REST_MS = 180;
  const atPlace = () => { const p = viewport.scrollLeft / width(); return Math.abs(p - Math.round(p)) * width() <= 2; };
  function rest(ended = false) {
    clearTimeout(restTimer);
    if (touching || !viewport.clientWidth) return;
    if (!ended && performance.now() - lastViewportScroll < REST_MS - 20) { scheduleRest(); return; }
    // Between two places: wait for the snap. If nothing has moved for 600 ms the
    // snap is not coming (or the phone stopped a hair off a place), so settle anyway.
    if (!atPlace() && performance.now() - lastViewportScroll < 600) { scheduleRest(); return; }
    endProgrammatic();
    setMode(shownSlide());
    if ((LOOP && slotOf(i) !== MID) || !atPlace()) center();
  }
  function scheduleRest() { clearTimeout(restTimer); restTimer = setTimeout(rest, REST_MS); }

  // The scroll position is the truth: the mode follows it as soon as the
  // middle is crossed (while the finger is still down).
  let readQueued = false;
  // t540u: once the slides start to move away from the shown one, close open hints (once per switch).
  let hintsClosed = false;
  viewport.addEventListener("scroll", (e) => {
    if (e.target !== viewport) return;
    lastViewportScroll = performance.now();
    scheduleRest();
    if (!hintsClosed && Math.abs(viewport.scrollLeft - slotOf(i) * width()) > 2) { hintsClosed = true; closeSlideHints(root); }
    if (readQueued) return;
    readQueued = true;
    requestAnimationFrame(() => {
      readQueued = false;
      // Only once the slides are placed at this width (hidden → shown fires a
      // scroll at 0, which is not a slide the user chose).
      if (!programmatic && lastW > 0 && lastW === viewport.clientWidth) setMode(shownSlide());
    });
  }, { passive: true });
  viewport.addEventListener("scrollend", (e) => {
    if (e.target !== viewport) return;
    // The browser says it is done: no need to wait out the quiet time — unless
    // the slides moved in the last 50 ms (a late scrollend from an earlier glide).
    if (performance.now() - lastViewportScroll > 50) rest(true); else scheduleRest();
  }, { passive: true });
  // A finger on the slides: no re-deal under it. Listen on window so a lift
  // anywhere (or a cancel when the system takes the gesture) always counts.
  const touchState = (e) => { touching = !!(e.touches && e.touches.length); if (!touching) scheduleRest(); };
  // A quick next swipe (before the quiet time is up) still finds a neighbour on
  // both sides: if the slides already stand still at a place, re-deal at the
  // touch, before the finger moves (same picture, nothing moves on screen).
  viewport.addEventListener("touchstart", () => {
    touching = false;
    if (LOOP && !programmatic && viewport.clientWidth && performance.now() - lastViewportScroll > 50 && atPlace()) {
      setMode(shownSlide());
      if (slotOf(i) !== MID) center();
    }
    touching = true; endProgrammatic(); clearTimeout(restTimer);
  }, { passive: true });
  for (const ev of ["touchend", "touchcancel"]) window.addEventListener(ev, touchState, { passive: true, capture: true });
  // A lost touchend (app switch, tab hidden) must never leave the finger "down".
  const liftAll = () => { if (touching) { touching = false; scheduleRest(); } };
  window.addEventListener("blur", liftAll);
  document.addEventListener("visibilitychange", liftAll);
  viewport.addEventListener("pointerdown", (e) => { if (e.pointerType !== "touch") endProgrammatic(); }, { passive: true });
  viewport.addEventListener("wheel", (e) => { if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) endProgrammatic(); }, { passive: true });

  /* ----- column widths: the same column is equally wide in both tables ----- */
  let syncQueued = false;
  function syncColumns() {
    syncQueued = false;
    const heads = slides.map((s) => [...s.querySelectorAll("table thead tr:first-child > th")]);
    if (heads.some((h) => !h.length)) return;
    // Measure natural widths (no stretching to the box), take the wider of the two per column;
    // both tables then stretch the same way to fill the box.
    const tables = heads.map((h) => h[0].closest("table"));
    heads.flat().forEach((th) => { th.style.minWidth = ""; });
    tables.forEach((t) => { t.style.minWidth = "0"; t.style.removeProperty("--sc-nm-max"); });
    const n = Math.min(...heads.map((h) => h.length));
    const w = [];
    for (let c = 0; c < n; c++) w[c] = Math.max(...heads.map((h) => h[c].getBoundingClientRect().width));
    // t490u: on PC a very long name (e.g. 31 × "HA…") could push the table past the
    // box. Then only the names give way: they ellipsize (full name in the title /
    // name-peek) by exactly the overflow, never below ~14ch. Phones keep side-scroll.
    const box = tables[0].parentElement ? tables[0].parentElement.clientWidth : 0;
    const total = w.reduce((a, b) => a + Math.ceil(b), 0); // minWidths below are ceil()ed
    if (box > 0 && total > box + 1 && !matchMedia("(max-width: 600px)").matches) {
      const nms = tables.flatMap((t) => [...t.querySelectorAll("tbody .nm")]);
      const widest = Math.max(0, ...nms.map((el) => el.getBoundingClientRect().width));
      const ch = parseFloat(getComputedStyle(tables[0]).fontSize) * 0.6 || 7;
      const cap = Math.max(14 * ch, widest - (total - box) - 2);
      if (widest > cap) {
        tables.forEach((t) => t.style.setProperty("--sc-nm-max", Math.floor(cap) + "px"));
        w[0] = Math.max(...heads.map((h) => h[0].getBoundingClientRect().width));
      }
    }
    tables.forEach((t) => { t.style.minWidth = ""; });
    heads.forEach((h) => { for (let c = 0; c < n; c++) h[c].style.minWidth = Math.ceil(w[c]) + "px"; });
  }
  const queueSync = () => { if (!syncQueued) { syncQueued = true; requestAnimationFrame(syncColumns); } };
  /* ----- t459u: every value cell gets the small grey tag slot -----
   * Cells without a −5% / p99 tag get an invisible copy of one (same class,
   * hidden, aria-hidden), so every cell has the same structure: on phones the
   * number sits on the same line as its tagged neighbours (the tag stacks
   * underneath), on PC nothing moves (the tag is out of the flow there).
   * Text = the widest real tag in that column, so the column never widens. */
  function fillTagSlots() {
    for (const t of root.querySelectorAll(".sc-slide table")) {
      const longest = [];
      const bodyRows = [...t.querySelectorAll("tbody tr")];
      for (const tr of bodyRows) [...tr.children].forEach((td, c) => {
        const p = td.querySelector(".pct:not(.pct-ph)");
        if (p && p.textContent.length > (longest[c] || "").length) longest[c] = p.textContent;
      });
      for (const tr of bodyRows) [...tr.children].forEach((td, c) => {
        if (td.tagName !== "TD" || td.matches(".stats-name, .rk-pos-name, .rk-pos-num, .stats-num") || td.querySelector(".pct")) return;
        const ph = document.createElement("span");
        ph.className = "pct pct-ph";
        ph.setAttribute("aria-hidden", "true");
        ph.textContent = longest[c] || "−0%";
        td.appendChild(ph);
      });
    }
  }
  const mo = new MutationObserver((recs) => {
    // Runs before the next paint: the new rows never show without their slots.
    if (recs.some((r) => r.type === "childList")) fillTagSlots();
    // Our own minWidth writes are attribute changes on th: ignore those.
    if (recs.some((r) => r.type === "childList")) queueSync();
  });
  slides.forEach((s) => mo.observe(s, { childList: true, subtree: true }));
  // Hidden while empty (no names yet) or resized: keep the shown mode in place.
  const keepPlace = () => {
    const w = viewport.clientWidth;
    if (!w) { lastW = 0; return; } // t471u: hidden (no names): re-place the slides when it shows again
    if (w === lastW) return;
    lastW = w;
    center();
    queueSync();
  };
  if (typeof ResizeObserver === "function") new ResizeObserver(keepPlace).observe(viewport);
  window.addEventListener("resize", keepPlace, { passive: true });

  /* ----- t460u: the table you switch to always starts at its first column -----
   * (owner: "when we switch, the table on the right should be instantly
   * scrolled to the beginning (iVi)", was: side scroll copied from the table we
   * came from). Every table that is not the one in view is kept at scrollLeft 0:
   * reset when a switch starts (the one coming in, before it shows) and once the
   * slide lands (the one that left, now out of view), so it never jumps on screen.
   * The table in view keeps whatever side scroll the user gives it. */
  function resetHidden() {
    const cur = shownSlide();
    slides.forEach((s, k) => {
      if (k === cur) return;
      const o = s.querySelector(SCROLLERS);
      if (o && o.scrollLeft !== 0) o.scrollLeft = 0;
    });
  }
  const landed = () => { resetHidden(); if (Math.abs(viewport.scrollLeft - slotOf(i) * width()) <= 2) hintsClosed = false; };
  viewport.addEventListener("scrollend", (e) => { if (e.target === viewport) landed(); }, { passive: true });
  for (const ev of ["touchstart", "pointerdown"]) viewport.addEventListener(ev, resetHidden, { passive: true });
  let landTimer = 0; // no scrollend (older Safari): reset once the slides stop moving
  viewport.addEventListener("scroll", (e) => {
    if (e.target !== viewport) return;
    clearTimeout(landTimer);
    landTimer = setTimeout(landed, 200);
  }, { passive: true });

  paint();
  fillTagSlots();
  center();
  keepPlace();
  queueSync();
  root.__sc = { go, mode: () => i, sync: queueSync };
  return root.__sc;
}
