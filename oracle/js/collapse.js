// Collapsible dashboard sections: every card's <h2> becomes a toggle button with a
// chevron; open/closed is remembered per section in localStorage. Default: open.
// Cards are re-rendered often (and bet.js renders its own), so enhance() is
// idempotent and re-run after every render and on #betSlot mutations.
const KEY = "ps2oracle_collapsed";
let closed;
try { closed = new Set(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch { closed = new Set(); }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...closed])); } catch { /* private mode */ } };
// Section id from the heading's first text ("AI Commander", "Players", …), ignoring live counters.
const idOf = (h2) => {
  const t = [...h2.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
  return (t ? t.textContent : h2.textContent).split("·")[0].trim().toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
};
let onExpand = () => {};
export function onSectionExpand(fn) { onExpand = fn; }

export function enhance(root = document) {
  root.querySelectorAll(".card > h2").forEach((h2) => {
    const card = h2.parentElement;
    if (card.closest(".auth, .mini")) return;
    let btn = h2.querySelector(":scope > button.ch");
    const id = card.dataset.sec || idOf(h2);
    if (!id) return;
    card.dataset.sec = id;
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button"; btn.className = "ch";
      btn.append(...h2.childNodes);
      btn.insertAdjacentHTML("beforeend", '<span class="chev" aria-hidden="true"></span>');
      h2.append(btn);
      btn.addEventListener("click", () => {
        const c = btn.closest(".card"), sid = c.dataset.sec, nowClosed = !c.classList.contains("collapsed");
        if (nowClosed) closed.add(sid); else closed.delete(sid);
        save(); set(c, btn, nowClosed, true);
        if (!nowClosed) onExpand(sid, c);
      });
    }
    set(card, btn, closed.has(id), false);
  });
}
function set(card, btn, isClosed, animate) {
  card.classList.toggle("collapsed", isClosed);
  btn.setAttribute("aria-expanded", String(!isClosed));
  btn.title = isClosed ? "Show this section" : "Hide this section";
  if (animate && !isClosed) { card.classList.remove("opening"); void card.offsetWidth; card.classList.add("opening"); }
}
