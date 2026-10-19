/**
 * ✨ Stats ⇄ 🏅 Positions: one spot under the names box, two modes (owner,
 * 2026-10-19). The two tables sit side by side in a horizontal scroll-snap box;
 * the browser itself moves them (compositor, full refresh rate: the earlier
 * JS-driven drag ran on the main thread and felt ~30 fps on phones). Switch
 * with the tabs, a finger / trackpad side-swipe, or ←/→ on the tabs. A table
 * that can still scroll sideways keeps the swipe (the browser hands it on to
 * the slides at the table's edge). Columns of both tables are kept the same
 * width and their sideways scroll is shared, so numbers stay in place; both
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

/** Clamp a mode index to the slides that exist. */
export const clampMode = (i, n) => Math.max(0, Math.min(n - 1, i | 0));

/**
 * @param {{ root: HTMLElement, onChange?: (i: number) => void }} o
 * root holds .sc-tab buttons (data-sc), .sc-viewport > .sc-track > .sc-slide, .sc-dot.
 */
export function mountStatsCarousel({ root, onChange }) {
  if (!root) return null;
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
    if (!quiet && onChange) onChange(i);
  }
  function go(n, { anim = true, quiet = false } = {}) {
    n = clampMode(n, slides.length);
    setMode(n, quiet);
    const left = n * width();
    if (Math.abs(viewport.scrollLeft - left) < 1) return;
    viewport.scrollTo({ left, behavior: anim && !reduced() ? "smooth" : "auto" });
  }

  // The scroll position is the truth: the mode follows it as soon as the
  // middle is crossed (tabs / dots light up while the finger is still down).
  let readQueued = false;
  viewport.addEventListener("scroll", (e) => {
    if (e.target !== viewport || readQueued) return;
    readQueued = true;
    requestAnimationFrame(() => {
      readQueued = false;
      setMode(Math.round(viewport.scrollLeft / width()));
    });
  }, { passive: true });

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
  const mo = new MutationObserver((recs) => {
    // Our own minWidth writes are attribute changes on th: ignore those.
    if (recs.some((r) => r.type === "childList")) queueSync();
  });
  slides.forEach((s) => mo.observe(s, { childList: true, subtree: true }));
  // Hidden while empty (no names yet) or resized: keep the shown mode in place.
  let lastW = 0;
  const keepPlace = () => {
    const w = viewport.clientWidth;
    if (!w || w === lastW) return;
    lastW = w;
    viewport.scrollTo({ left: i * w, behavior: "auto" });
    queueSync();
  };
  if (typeof ResizeObserver === "function") new ResizeObserver(keepPlace).observe(viewport);
  window.addEventListener("resize", keepPlace, { passive: true });

  /* ----- sideways scroll is shared: both tables show the same columns ----- */
  let mirroring = false;
  viewport.addEventListener("scroll", (e) => {
    const src = e.target;
    if (mirroring || src === viewport || !src.matches || !src.matches(SCROLLERS)) return;
    mirroring = true;
    slides.forEach((s) => { const o = s.querySelector(SCROLLERS); if (o && o !== src) o.scrollLeft = src.scrollLeft; });
    requestAnimationFrame(() => { mirroring = false; });
  }, { capture: true, passive: true });

  /* ----- tabs + keys ----- */
  tabs.forEach((t) => {
    t.addEventListener("click", () => go(+t.dataset.sc));
    t.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      go(i + (e.key === "ArrowRight" ? 1 : -1));
      const on = tabs.find((x) => +x.dataset.sc === i);
      if (on) on.focus();
    });
  });

  paint();
  keepPlace();
  queueSync();
  return { go, mode: () => i, sync: queueSync };
}
