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
 * directions inside the clipping container. Reduced motion → crossfade-free
 * instant swap (no movement).
 */

export const SLIDE_MS = 380;
const SVGNS = "http://www.w3.org/2000/svg";

function reducedMotion() {
  try {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch {
    return false;
  }
}

/**
 * @param {{ container: HTMLElement, svg: SVGSVGElement, dir: 1|-1, draw: () => void,
 *           background?: string, ms?: number }} o
 */
export function slideSwap({ container, svg, dir, draw, background = "", ms = SLIDE_MS }) {
  if (!container || !svg || !svg.childNodes.length || reducedMotion()) {
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
