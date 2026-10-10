// t329u: re-sorting a stats / ranks table re-renders it, which on phones threw
// the horizontal scroll back to the start. Restore where it was, then make sure
// the sorted column is visible (centred if it was off-screen). Only scrollLeft
// of the table's own wrapper changes — never the page's vertical position.

/**
 * Pure: the scrollLeft that keeps a column visible.
 * @param {{prevLeft:number, maxLeft:number, viewW:number, stickyW:number, colL:number, colW:number}} g
 *   colL = column's left edge in the wrapper's content coordinates (scrollLeft 0),
 *   stickyW = width covered by sticky left columns (e.g. the name column).
 */
export function sortScrollTarget({ prevLeft = 0, maxLeft = 0, viewW = 0, stickyW = 0, colL = 0, colW = 0 }) {
  const clamp = (v) => Math.max(0, Math.min(maxLeft, v));
  let left = clamp(prevLeft);
  const visL = left + stickyW;
  const visR = left + viewW;
  const free = Math.max(0, viewW - stickyW);
  if (colL >= visL - 1 && colL + colW <= visR + 1) return left; // already in view
  // Off-screen (or partly): centre it in the area not covered by sticky columns.
  return clamp(colL - stickyW - Math.max(0, (free - colW) / 2));
}

/** Width of sticky cells left of `th` in its row (their right edge, relative to wrap's view). */
function stickyWidth(wrap, th) {
  const wr = wrap.getBoundingClientRect();
  let w = 0;
  for (let c = th.parentElement && th.parentElement.firstElementChild; c && c !== th; c = c.nextElementSibling) {
    const cs = getComputedStyle(c);
    // Left-pinned only: header cells are often sticky to the top as well.
    if (cs.position === "sticky" && cs.left !== "auto") w = Math.max(w, c.getBoundingClientRect().right - wr.left - wrap.clientLeft);
  }
  return Math.max(0, w);
}

/** Apply after a re-render: wrap = horizontal scroller, th = sorted header cell. */
export function keepSortedColumnVisible(wrap, th, prevLeft = 0) {
  if (!wrap || !th) return;
  let set = fitOnce(wrap, th, prevLeft);
  // Progressive rows / the 📊 chart can still change widths shortly after:
  // re-fit for ~1.5 s while the table resizes, unless the user scrolls meanwhile.
  const refit = () => {
    if (!th.isConnected || Math.abs(wrap.scrollLeft - set) >= 2) return stop();
    set = fitOnce(wrap, th, wrap.scrollLeft);
  };
  let ro = null;
  const stop = () => { if (ro) ro.disconnect(); ro = null; };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(refit);
  const table = th.closest("table");
  if (table && typeof ResizeObserver === "function") {
    ro = new ResizeObserver(refit);
    ro.observe(table);
    setTimeout(stop, 1500);
  }
}

function fitOnce(wrap, th, prevLeft) {
  wrap.scrollLeft = prevLeft;
  const maxLeft = Math.max(0, wrap.scrollWidth - wrap.clientWidth);
  if (maxLeft <= 0) return wrap.scrollLeft;
  const wr = wrap.getBoundingClientRect();
  const tr = th.getBoundingClientRect();
  const colL = tr.left - wr.left - wrap.clientLeft + wrap.scrollLeft;
  wrap.scrollLeft = sortScrollTarget({
    prevLeft: wrap.scrollLeft, maxLeft, viewW: wrap.clientWidth,
    stickyW: stickyWidth(wrap, th), colL, colW: tr.width,
  });
  return wrap.scrollLeft;
}
