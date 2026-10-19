/**
 * ✨ Stats ⇄ 🏅 Positions: one spot under the names box, two modes (owner,
 * 2026-10-19). The two tables sit side by side in a track; the viewport shows
 * one. Switch with the tabs, a finger swipe (follows the finger, like the
 * charts' carousel: chart-slide.mjs dragCommits), a trackpad side-swipe, or
 * ←/→ on the tabs. The tables' own sideways scroll wins while it can still
 * move: a swipe only changes mode once the table is at that edge (or doesn't
 * scroll at all). Columns of both tables are kept the same width and their
 * sideways scroll is shared, so numbers stay in place when the mode changes.
 */
import { dragCommits, DRAG_START_PX, SETTLE_MS } from "./chart-slide.mjs?v=20261017-drag3";

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
  const place = (px, anim) => {
    track.style.transition = anim ? `transform ${SETTLE_MS}ms cubic-bezier(0.22, 0.8, 0.3, 1)` : "none";
    track.style.transform = `translateX(${px}px)`;
  };
  function fitHeight() {
    const h = slides[i].offsetHeight;
    if (h) viewport.style.height = h + "px";
  }
  function paint() {
    tabs.forEach((t) => {
      const on = +t.dataset.sc === i;
      t.classList.toggle("on", on);
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    });
    dots.forEach((d, k) => d.classList.toggle("on", k === i));
    // Only the shown table is reachable by keyboard / screen readers.
    slides.forEach((s, k) => { s.inert = k !== i; s.setAttribute("aria-hidden", String(k !== i)); });
    root.dataset.mode = String(i);
  }
  function go(n, { anim = true, quiet = false } = {}) {
    n = clampMode(n, slides.length);
    const changed = n !== i;
    i = n;
    place(-i * width(), anim);
    paint();
    fitHeight();
    try { localStorage.setItem(KEY, String(i)); } catch {}
    if (changed && !quiet && onChange) onChange(i);
  }

  /* ----- column widths: the same column is equally wide in both tables ----- */
  let syncQueued = false;
  function syncColumns() {
    syncQueued = false;
    const heads = slides.map((s) => [...s.querySelectorAll("table thead tr:first-child > th")]);
    if (heads.some((h) => !h.length)) { fitHeight(); return; }
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
    fitHeight();
  }
  const queueSync = () => { if (!syncQueued) { syncQueued = true; requestAnimationFrame(syncColumns); } };
  const mo = new MutationObserver((recs) => {
    // Our own minWidth writes are attribute changes on th: ignore those.
    if (recs.some((r) => r.type === "childList")) queueSync();
  });
  slides.forEach((s) => mo.observe(s, { childList: true, subtree: true }));
  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(() => { fitHeight(); place(-i * width(), false); });
    slides.forEach((s) => ro.observe(s));
    ro.observe(viewport);
  }
  // Hidden while empty (no names yet): measure again once it appears.
  window.addEventListener("resize", queueSync, { passive: true });

  /* ----- sideways scroll is shared: both tables show the same columns ----- */
  let mirroring = false;
  viewport.addEventListener("scroll", (e) => {
    const src = e.target;
    if (mirroring || !src.matches || !src.matches(SCROLLERS)) return;
    mirroring = true;
    slides.forEach((s) => { const o = s.querySelector(SCROLLERS); if (o && o !== src) o.scrollLeft = src.scrollLeft; });
    requestAnimationFrame(() => { mirroring = false; });
  }, true);

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

  /* ----- finger swipe (touch events: the first move decides, so the table's own scroll still works) ----- */
  let g = null; // { x, y, t, own, scroller, samples }
  viewport.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) { g = null; return; }
    const p = e.touches[0];
    g = { x: p.clientX, y: p.clientY, own: null, scroller: e.target.closest && e.target.closest(SCROLLERS), samples: [[performance.now(), p.clientX]] };
  }, { passive: true });
  viewport.addEventListener("touchmove", (e) => {
    if (!g) return;
    if (e.touches.length !== 1) { if (g.own) settle(0, 0); g = null; return; }
    const p = e.touches[0];
    const dx = p.clientX - g.x, dy = p.clientY - g.y;
    if (g.own === null) {
      if (Math.abs(dx) < DRAG_START_PX && Math.abs(dy) < DRAG_START_PX) return;
      // Vertical, or the table can still scroll that way: not ours.
      g.own = Math.abs(dx) > 1.2 * Math.abs(dy) && !canScrollToward(g.scroller, dx);
      if (!g.own) { g = null; return; }
    }
    if (e.cancelable) e.preventDefault();
    const edge = (dx > 0 && i === 0) || (dx < 0 && i === slides.length - 1);
    place(-i * width() + (edge ? dx * 0.3 : dx), false); // rubber band past the ends
    g.samples.push([performance.now(), p.clientX]);
    if (g.samples.length > 6) g.samples.shift();
  }, { passive: false });
  const settle = (dx, vx) => {
    const dir = dx < 0 ? 1 : -1;
    const next = i + dir;
    if (next >= 0 && next < slides.length && dragCommits({ dx, width: width(), vx })) go(next);
    else go(i, { quiet: true });
  };
  viewport.addEventListener("touchend", (e) => {
    if (!g || !g.own) { g = null; return; }
    const p = e.changedTouches[0];
    const s = g.samples, [t0, x0] = s[0], [t1, x1] = s[s.length - 1];
    const vx = t1 > t0 ? (x1 - x0) / (t1 - t0) : 0;
    settle(p.clientX - g.x, vx);
    g = null;
  });
  viewport.addEventListener("touchcancel", () => { if (g && g.own) go(i, { quiet: true }); g = null; });

  /* ----- trackpad side-swipe (wheel deltaX) once the table can't scroll further ----- */
  let acc = 0, lock = 0, accT = 0;
  viewport.addEventListener("wheel", (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || !e.deltaX) return;
    const scroller = e.target.closest && e.target.closest(SCROLLERS);
    if (canScrollToward(scroller, -e.deltaX)) return;
    e.preventDefault();
    const now = performance.now();
    if (now < lock) return;
    if (now - accT > 300) acc = 0;
    accT = now;
    acc += e.deltaX;
    if (Math.abs(acc) > 60) {
      const n = i + (acc > 0 ? 1 : -1);
      acc = 0;
      if (n >= 0 && n < slides.length) { go(n); lock = now + 700; }
    }
  }, { passive: false });

  go(i, { anim: false, quiet: true });
  queueSync();
  return { go, mode: () => i, sync: queueSync };
}
