/**
 * ✨ Stats ⇄ 🏅 Positions: one spot under the names box, two modes (owner,
 * 2026-10-19). The two tables sit side by side in a horizontal scroll-snap box;
 * the browser itself moves them (compositor, full refresh rate: the earlier
 * JS-driven drag ran on the main thread and felt ~30 fps on phones). Switch
 * with the tabs, a finger / trackpad side-swipe, or ←/→ on the tabs. A table
 * that can still scroll sideways keeps the swipe (the browser hands it on to
 * the slides at the table's edge). Columns of both tables are kept the same
 * width; the table switched to always starts at its first column (t460u); both
 * modes are always the same height (CSS align-items: stretch).
 */

const KEY = "ps2-elite-kd-stats-mode";
const SCROLLERS = ".stats-table-wrap, .rk-pos-wrap";

/** Can this scroller still move in the direction a finger moving by dx would push it? */
export function canScrollToward(el, dx) {
  if (!el) return false;
  const max = el.scrollWidth - el.clientWidth;
  if (max <= 1) return false;
  return dx < 0 ? el.scrollLeft < max - 1 : el.scrollLeft > 1;
}

/* t470u: phones, flip the tables back and forth 3 times (within FLIP_WINDOW_MS)
 * → 💨 poof, the tab / dots line gives way to a rocking 👍 for 1 s, the sfx
 * plays as the 👍 disappears, then the line folds away and only swiping
 * switches. Page session only (a refresh brings it back); a future
 * "hide forever" setting can call collapseScBar(root, { animate: false })
 * at startup. (Counts/timing per owner 2026-10-20: 3 flips, 1 s thumb.) */
export const FLIPS_TO_POOF = 3;
export const FLIP_WINDOW_MS = 10000;
export const THUMB_MS = 1000;
const COLLAPSE_MS = 280;
/** True when the last FLIPS_TO_POOF switch times all fall within FLIP_WINDOW_MS. */
export function flipBurst(times, n = FLIPS_TO_POOF, windowMs = FLIP_WINDOW_MS) {
  return times.length >= n && times[times.length - 1] - times[times.length - n] <= windowMs;
}
/* t471u: the poof is per page session, not per mount — a re-mount (or a
 * re-render of the tables) keeps the line folded and never poofs again. */
let sessionPoofed = false;
const phoneUi = () => { try { return matchMedia("(max-width: 600px) and (pointer: coarse)").matches; } catch { return false; } };

/** Fold the tab / dots line away. animate: 👍 for THUMB_MS, then the line
 * collapses. onThumbPoof fires 0.5 s BEFORE the thumb disappears (owner
 * 2026-10-20 — the app plays the 💨 sfx there); onThumbGone fires as it
 * disappears. */
export function collapseScBar(root, { animate = true, onThumbGone = null, onThumbPoof = null } = {}) {
  const bar = root && root.querySelector(".sc-bar");
  if (!bar || root.classList.contains("sc-bar-gone") || root.classList.contains("sc-bar-poofed")) return;
  sessionPoofed = true;
  const fold = () => {
    // t471u: never leave focus on a tab that is about to be inert / display:none.
    if (bar.contains(document.activeElement)) { try { document.activeElement.blur(); } catch {} }
    root.classList.add("sc-bar-gone"); // final state (CSS, phones only): no line, no gap
    bar.setAttribute("inert", "");
    bar.setAttribute("aria-hidden", "true");
  };
  if (!animate) { fold(); return; }
  root.classList.add("sc-bar-poofed"); // tabs + dots hidden at once, the line keeps its height
  const thumb = document.createElement("span");
  thumb.className = "sc-thumb";
  thumb.setAttribute("aria-hidden", "true");
  thumb.textContent = "👍";
  bar.appendChild(thumb);
  // Web Animations, not a CSS @media-dependent rule: plays with reduced motion too (owner, battery saver).
  try {
    thumb.animate([{ transform: "rotate(-15deg)" }, { transform: "rotate(15deg)" }],
      { duration: 250, iterations: THUMB_MS / 250, direction: "alternate", easing: "ease-in-out" });
  } catch {}
  if (onThumbPoof) setTimeout(() => { try { onThumbPoof(); } catch {} }, Math.max(0, THUMB_MS - 500));
  setTimeout(() => {
    thumb.remove();
    if (!root.isConnected) { fold(); root.classList.remove("sc-bar-poofed"); return; } // t471u: replaced meanwhile
    if (onThumbGone) { try { onThumbGone(); } catch {} }
    const h = bar.getBoundingClientRect().height;
    const mb = parseFloat(getComputedStyle(bar).marginBottom) || 0;
    let anim = null;
    try {
      anim = bar.animate([{ height: `${h}px`, marginBottom: `${mb}px` }, { height: "0px", marginBottom: "0px" }],
        { duration: COLLAPSE_MS, easing: "ease-in-out", fill: "forwards" });
    } catch {}
    let fallback = 0, folded = false;
    const done = () => {
      if (folded) return; // t471u: once (onfinish and the fallback both call it)
      folded = true; clearTimeout(fallback);
      fold(); root.classList.remove("sc-bar-poofed"); if (anim) { anim.onfinish = null; anim.cancel(); }
    };
    if (anim) anim.onfinish = done; else done();
    if (!folded) fallback = setTimeout(done, COLLAPSE_MS + 200); // fallback if onfinish never comes
  }, THUMB_MS);
}

/** Clamp a mode index to the slides that exist. */
export const clampMode = (i, n) => Math.max(0, Math.min(n - 1, i | 0));

/**
 * @param {{ root: HTMLElement, onChange?: (i: number) => void }} o
 * root holds .sc-tab buttons (data-sc), .sc-viewport > .sc-track > .sc-slide, .sc-dot.
 */
export function mountStatsCarousel({ root, onChange, onThumbGone = null, onThumbPoof = null }) {
  if (!root) return null;
  if (root.__sc) return root.__sc; // t471u: one mount per element — no doubled listeners / observers
  const viewport = root.querySelector(".sc-viewport");
  const track = root.querySelector(".sc-track");
  const slides = [...root.querySelectorAll(".sc-slide")];
  const tabs = [...root.querySelectorAll(".sc-tab")];
  const dots = [...root.querySelectorAll(".sc-dot")];
  if (!viewport || !track || slides.length < 2) return null;
  let i = 0;
  try { i = clampMode(+localStorage.getItem(KEY) || 0, slides.length); } catch {}

  const width = () => viewport.clientWidth || 1;
  const reduced = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
  function paint() {
    tabs.forEach((t) => {
      const on = +t.dataset.sc === i;
      t.classList.toggle("on", on);
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    });
    dots.forEach((d, k) => d.classList.toggle("on", k === i));
    slides.forEach((s, k) => s.setAttribute("aria-hidden", String(k !== i)));
    root.dataset.mode = String(i);
  }
  function setMode(n, quiet) {
    n = clampMode(n, slides.length);
    if (n === i) return;
    i = n;
    paint();
    try { localStorage.setItem(KEY, String(i)); } catch {}
    if (quiet) return;
    // t470u: count switches (tap or swipe); the 3rd quick one on a phone poofs the line away.
    flips.push(performance.now());
    if (flips.length > FLIPS_TO_POOF) flips.shift();
    const poof = !sessionPoofed && phoneUi() && flipBurst(flips);
    if (poof) { collapseScBar(root, { onThumbGone, onThumbPoof }); }
    if (onChange) onChange(i, { poof }); // poof: no switch sound now — the 💨 sfx plays 0.5 s before the 👍 disappears
  }
  const flips = [];
  // t448u: a tab / key switch already played its sound in go(); while that
  // smooth scroll runs, the scroll-follow below briefly read the old mode
  // (first frames) and then crossed the middle again, which played the switch
  // sound 3 times per click (and flipped the tabs back and forth). The tab's
  // mode now stands until the scroll lands (or the user takes over).
  // Finger / trackpad swipes are unchanged.
  let programmatic = false, progTimer = 0, progTarget = 0, lastViewportScroll = -1e9;
  const endProgrammatic = () => { programmatic = false; clearTimeout(progTimer); };
  function go(n, { anim = true, quiet = false } = {}) {
    n = clampMode(n, slides.length);
    setMode(n, quiet);
    const left = n * width();
    if (Math.abs(viewport.scrollLeft - left) < 1) return;
    programmatic = true;
    progTarget = n;
    clearTimeout(progTimer);
    progTimer = setTimeout(endProgrammatic, 1200); // no scrollend (older Safari)
    // t461u: right after a swipe the browser's own snap glide is still running;
    // an instant jump (reduce-motion, e.g. phone battery saver) did not stop it,
    // so the glide carried the slides back and the tap was undone. A smooth
    // scroll replaces that glide, so use it while the slides are still moving.
    const moving = performance.now() - lastViewportScroll < 150;
    viewport.scrollTo({ left, behavior: anim && (!reduced() || moving) ? "smooth" : "auto" });
  }

  // The scroll position is the truth: the mode follows it as soon as the
  // middle is crossed (tabs / dots light up while the finger is still down).
  let readQueued = false;
  viewport.addEventListener("scroll", (e) => {
    if (e.target !== viewport) return;
    lastViewportScroll = performance.now();
    if (readQueued) return;
    readQueued = true;
    requestAnimationFrame(() => {
      readQueued = false;
      if (!programmatic) setMode(Math.round(viewport.scrollLeft / width()));
    });
  }, { passive: true });
  viewport.addEventListener("scrollend", (e) => {
    if (e.target !== viewport || !programmatic) return;
    // Landed somewhere else (an older glide won): go to the tab's slide after all.
    if (Math.abs(viewport.scrollLeft - progTarget * width()) >= 1) viewport.scrollTo({ left: progTarget * width(), behavior: "auto" });
    else endProgrammatic();
  }, { passive: true });
  for (const ev of ["touchstart", "pointerdown"]) viewport.addEventListener(ev, endProgrammatic, { passive: true });
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
    tables.forEach((t) => { t.style.minWidth = "0"; });
    const n = Math.min(...heads.map((h) => h.length));
    const w = [];
    for (let c = 0; c < n; c++) w[c] = Math.max(...heads.map((h) => h[c].getBoundingClientRect().width));
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
        if (td.tagName !== "TD" || td.matches(".stats-name, .rk-pos-name") || td.querySelector(".pct")) return;
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
  let lastW = 0;
  const keepPlace = () => {
    const w = viewport.clientWidth;
    if (!w) { lastW = 0; return; } // t471u: hidden (no names): re-place the slides when it shows again
    if (w === lastW) return;
    lastW = w;
    viewport.scrollTo({ left: i * w, behavior: "auto" });
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
    const cur = clampMode(Math.round(viewport.scrollLeft / width()), slides.length);
    slides.forEach((s, k) => {
      if (k === cur) return;
      const o = s.querySelector(SCROLLERS);
      if (o && o.scrollLeft !== 0) o.scrollLeft = 0;
    });
  }
  viewport.addEventListener("scrollend", (e) => { if (e.target === viewport) resetHidden(); }, { passive: true });
  for (const ev of ["touchstart", "pointerdown"]) viewport.addEventListener(ev, resetHidden, { passive: true });
  let landTimer = 0; // no scrollend (older Safari): reset once the slides stop moving
  viewport.addEventListener("scroll", (e) => {
    if (e.target !== viewport) return;
    clearTimeout(landTimer);
    landTimer = setTimeout(resetHidden, 200);
  }, { passive: true });

  /* ----- tabs + keys ----- */
  tabs.forEach((t) => {
    t.addEventListener("click", () => { resetHidden(); go(+t.dataset.sc); });
    t.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      resetHidden();
      go(i + (e.key === "ArrowRight" ? 1 : -1));
      const on = tabs.find((x) => +x.dataset.sc === i);
      if (on) on.focus();
    });
  });

  paint();
  fillTagSlots();
  keepPlace();
  queueSync();
  if (sessionPoofed) collapseScBar(root, { animate: false }); // t471u: folded for the rest of the session
  root.__sc = { go, mode: () => i, sync: queueSync };
  return root.__sc;
}
