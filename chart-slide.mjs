/**
 * 👆 Swipe slide (t384u): the current chart slides out to one side while the
 * newly drawn chart slides in from the other, like a carousel. Used only for
 * swipes on the 📊 distribution chart and the skill graph; the auto-cycle and
 * button / emoji switches keep their crossfade.
 *
 * dir = +1 (next): new chart comes in from the RIGHT, current leaves LEFT.
 * dir = -1 (previous): new comes in from the LEFT, current leaves RIGHT.
 *
 * How: a snapshot of the current <svg> (cloned, with a solid background so
 * nothing shows through) is laid exactly over it; the real <svg> is redrawn
 * with the new content (draw()); then both are translated in opposite
 * directions inside the clipping container. Runs regardless of reduce-motion
 * (phones turn it on in battery saver; the owner wants the slide).
 */

export const SLIDE_MS = 380;
const SVGNS = "http://www.w3.org/2000/svg";


/**
 * @param {{ container: HTMLElement, svg: SVGSVGElement, dir: 1|-1, draw: () => void,
 *           background?: string, ms?: number }} o
 */
export function slideSwap({ container, svg, dir, draw, background = "", ms = SLIDE_MS }) {
  if (!container || !svg || !svg.childNodes.length) {
    draw();
    return;
  }
  // A swipe during a slide: finish the previous one at once.
  container.querySelectorAll("svg.slide-ghost").forEach((g) => g.remove());
  svg.style.transition = "none";
  svg.style.transform = "";

  const cs = getComputedStyle(container);
  if (cs.position === "static") container.style.position = "relative";
  // Clip only while sliding (the distribution tooltip lives in this box too).
  if (!container._slideToken) container._prevOverflow = container.style.overflow || "";
  const token = (container._slideToken || 0) + 1;
  container._slideToken = token;
  container.style.overflow = "hidden";

  // Snapshot of what's on screen now, placed exactly over the live svg.
  const ghost = svg.cloneNode(true);
  ghost.removeAttribute("id");
  ghost.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
  ghost.setAttribute("aria-hidden", "true");
  ghost.classList.add("slide-ghost");
  if (background) {
    const vb = (svg.getAttribute("viewBox") || "0 0 1000 600").split(/\s+/).map(Number);
    const bg = document.createElementNS(SVGNS, "rect");
    bg.setAttribute("x", String(vb[0] || 0));
    bg.setAttribute("y", String(vb[1] || 0));
    bg.setAttribute("width", String(vb[2] || 1000));
    bg.setAttribute("height", String(vb[3] || 600));
    bg.setAttribute("fill", background);
    ghost.insertBefore(bg, ghost.firstChild);
  }
  const r = svg.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  Object.assign(ghost.style, {
    position: "absolute",
    left: `${r.left - c.left + container.scrollLeft - (parseFloat(cs.borderLeftWidth) || 0)}px`,
    top: `${r.top - c.top + container.scrollTop - (parseFloat(cs.borderTopWidth) || 0)}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
    margin: "0",
    pointerEvents: "none",
    transition: "none",
    transform: "translateX(0)",
    willChange: "transform",
    zIndex: "1",
  });
  container.appendChild(ghost);

  draw(); // the live svg now holds the new chart
  const w = container.clientWidth || r.width;
  svg.style.willChange = "transform";
  svg.style.transform = `translateX(${dir * w}px)`;
  void svg.getBoundingClientRect(); // commit the start positions

  const ease = `transform ${ms}ms cubic-bezier(0.22, 0.8, 0.3, 1)`;
  requestAnimationFrame(() => {
    svg.style.transition = ease;
    ghost.style.transition = ease;
    svg.style.transform = "translateX(0)";
    ghost.style.transform = `translateX(${-dir * w}px)`;
  });
  setTimeout(() => {
    ghost.remove();
    if (container._slideToken !== token) return; // a newer slide owns the svg now
    svg.style.transition = "";
    svg.style.transform = "";
    svg.style.willChange = "";
    container.style.overflow = container._prevOverflow || "";
    container._slideToken = 0;
  }, ms + 80);
}


/* ---------- 👆 finger-following carousel (t386u) ----------
 * While a finger (or mouse) drags sideways on the chart, the current chart
 * moves with it and the neighbour chart comes in from the edge — both are on
 * screen mid-drag. Released past DRAG_COMMIT of the width (or flicked), it
 * glides the rest of the way and the neighbour takes over; otherwise it
 * springs back. Drag LEFT = next (from the right), RIGHT = previous.
 * Direct manipulation follows the finger regardless of reduce-motion. */
export const DRAG_START_PX = 8;
export const DRAG_COMMIT = 0.25; // share of the width
export const FLICK_PX_PER_MS = 0.45;
export const SETTLE_MS = 260;

/** Finish the swap (true) or spring back (false) on release. */
export function dragCommits({ dx, width, vx = 0 }) {
  const w = Math.max(1, +width || 1);
  if (Math.abs(dx) >= DRAG_COMMIT * w) return true;
  // A quick flick in the drag's direction also finishes it.
  return Math.abs(dx) >= 24 && Math.sign(vx) === Math.sign(dx) && Math.abs(vx) >= FLICK_PX_PER_MS;
}

/**
 * @param {{
 *   target: HTMLElement,          // where pointer events are listened for
 *   container: HTMLElement,       // clipping box the svg sits in
 *   svg: () => SVGSVGElement,     // the live chart svg
 *   background: () => string,     // solid fill behind the snapshot
 *   canStart?: () => boolean,     // e.g. a chart is drawn
 *   onStart?: () => void,         // hold auto-cycle, hide tooltips …
 *   show: (dir: 1|-1) => void,    // draw the neighbour (from the ORIGINAL state) into the live svg
 *   restore: () => void,          // draw the original back (spring-back)
 *   onCommit?: (dir: 1|-1) => void,
 * }} o
 * @returns {{ busy: () => boolean }}
 */
export function attachDragCarousel(o) {
  const { target, container } = o;
  let st = null; // { id, x, y, t, phase, dir, ghost, w, samples }
  let settling = null; // { finish: () => void }
  let swallowClick = false;

  const setX = (el, x, anim) => {
    el.style.transition = anim ? `transform ${SETTLE_MS}ms cubic-bezier(0.22, 0.8, 0.3, 1)` : "none";
    el.style.transform = `translateX(${x}px)`;
  };

  function cleanup(ghost) {
    const svg = o.svg();
    if (ghost) ghost.remove();
    svg.style.transition = "";
    svg.style.transform = "";
    svg.style.willChange = "";
    container.style.overflow = container._dragPrevOverflow || "";
    container._dragPrevOverflow = undefined;
  }

  function makeGhost(svg) {
    const ghost = svg.cloneNode(true);
    ghost.removeAttribute("id");
    ghost.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
    ghost.setAttribute("aria-hidden", "true");
    ghost.classList.add("slide-ghost");
    const vb = (svg.getAttribute("viewBox") || "0 0 1000 600").split(/\s+/).map(Number);
    const bg = document.createElementNS(SVGNS, "rect");
    bg.setAttribute("x", String(vb[0] || 0));
    bg.setAttribute("y", String(vb[1] || 0));
    bg.setAttribute("width", String(vb[2] || 1000));
    bg.setAttribute("height", String(vb[3] || 600));
    bg.setAttribute("fill", o.background() || "transparent");
    ghost.insertBefore(bg, ghost.firstChild);
    const r = svg.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    const cs = getComputedStyle(container);
    if (cs.position === "static") container.style.position = "relative";
    Object.assign(ghost.style, {
      position: "absolute",
      left: `${r.left - c.left + container.scrollLeft - (parseFloat(cs.borderLeftWidth) || 0)}px`,
      top: `${r.top - c.top + container.scrollTop - (parseFloat(cs.borderTopWidth) || 0)}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
      margin: "0",
      pointerEvents: "none",
      zIndex: "1",
      willChange: "transform",
    });
    container.appendChild(ghost);
    return ghost;
  }

  function beginDrag(dx) {
    const svg = o.svg();
    if (o.onStart) o.onStart();
    container._dragPrevOverflow = container.style.overflow || "";
    container.style.overflow = "hidden";
    st.w = container.clientWidth || svg.getBoundingClientRect().width;
    st.ghost = makeGhost(svg); // the CURRENT chart, now moved by the finger
    svg.style.willChange = "transform";
    st.phase = "drag";
    st.dir = 0;
    moveTo(dx);
  }

  function moveTo(dx) {
    const dir = dx < 0 ? 1 : -1; // finger left → next comes from the right
    if (dir !== st.dir && dx !== 0) {
      st.dir = dir;
      o.show(dir); // live svg now holds the neighbour on that side
    }
    const svg = o.svg();
    setX(st.ghost, dx, false);
    setX(svg, dx + st.dir * st.w, false);
  }

  function settle(commit) {
    const { ghost, dir, w } = st;
    const svg = o.svg();
    st = null;
    void svg.getBoundingClientRect();
    if (commit) {
      setX(ghost, -dir * w, true);
      setX(svg, 0, true);
    } else {
      setX(ghost, 0, true);
      setX(svg, dir * w, true);
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      settling = null;
      if (!commit) o.restore();
      cleanup(ghost);
      if (commit && o.onCommit) o.onCommit(dir);
    };
    settling = { finish };
    setTimeout(finish, SETTLE_MS + 40);
  }

  target.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (settling) settling.finish(); // a new drag during a glide: land it now
    if (o.canStart && !o.canStart()) return;
    st = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), phase: "pending", samples: [[performance.now(), e.clientX]] };
  }, { passive: true });

  target.addEventListener("pointermove", (e) => {
    if (!st || e.pointerId !== st.id) return;
    const dx = e.clientX - st.x;
    const dy = e.clientY - st.y;
    if (st.phase === "pending") {
      if (Math.abs(dx) < DRAG_START_PX && Math.abs(dy) < DRAG_START_PX) return;
      if (Math.abs(dx) <= 1.2 * Math.abs(dy)) { st = null; return; } // vertical: the page scrolls
      try { target.setPointerCapture(e.pointerId); } catch {}
      beginDrag(dx);
    } else {
      moveTo(dx);
    }
    st.samples.push([performance.now(), e.clientX]);
    if (st.samples.length > 6) st.samples.shift();
  });

  const end = (e, cancelled) => {
    if (!st || e.pointerId !== st.id) return;
    if (st.phase !== "drag") { st = null; return; } // a tap: let the click through
    const dx = e.clientX - st.x;
    const s = st.samples;
    const [t0, x0] = s[0];
    const [t1, x1] = s[s.length - 1];
    const vx = t1 > t0 ? (x1 - x0) / (t1 - t0) : 0;
    swallowClick = true;
    setTimeout(() => { swallowClick = false; }, 400);
    settle(!cancelled && dragCommits({ dx, width: st.w, vx }));
  };
  target.addEventListener("pointerup", (e) => end(e, false));
  target.addEventListener("pointercancel", (e) => end(e, true));
  // The click that ends a drag must not also open / jump a bar.
  target.addEventListener("click", (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);

  return { busy: () => !!st || !!settling };
}
