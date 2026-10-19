// Collapsible dashboard sections: every card's <h2> becomes a toggle button with a
// chevron; open/closed is remembered per section in localStorage. Default: open.
// Cards are re-rendered often (and vote.js renders its own), so enhance() is
// idempotent and re-run after every render and on #voteSlot mutations.
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

// Collapsed-card summaries: one-line top-priority info shown under the header
// while a card is collapsed — glanceable, and click-to-copy for sharing.
// Keyed by the same section id enhance() assigns (card.dataset.sec).
const txt = (el, sel) => el.querySelector(sel)?.textContent.trim() || "";
const SUMMARIZERS = {
  "win-chance": (card) => [...card.querySelectorAll(".odds .fac")]
    .map((f) => `${txt(f, ".l")} ${txt(f, ".n")}`.trim()).filter(Boolean).join(" · "),
  "live-timer": (card) => card.querySelector(".locktimer")?.textContent.replace(/\s+/g, " ").trim() || "",
  "vote-for-the-winner": (card) => {
    const mine = [...card.querySelectorAll(".myvote")]
      .map((v) => v.textContent.replace(/\s+/g, " ").trim()).filter(Boolean);
    if (mine.length) return mine.join(" · ");
    return [...card.querySelectorAll(".facpick")]
      .map((b) => `${txt(b, "b")} ${txt(b, "span")}`.trim()).filter(Boolean).join(" · ");
  },
  "ai-commander": (card) => {
    const scope = card.querySelector(".cf.on") || card;
    // Focus first: the one move the commander wants (focus.js).
    const fo = scope.querySelector(".focus:not(.quiet)");
    if (fo) return `${(fo.querySelector(".fhead") || fo).textContent.replace(/All forces:\s*/, "").replace(/\s+/g, " ").trim()} · ${(fo.querySelector(".fodds") || {}).textContent || ""}`.trim();
    let atk = "", def = "";
    scope.querySelectorAll(".note").forEach((n) => {
      const ol = n.nextElementSibling;
      if (!ol || ol.tagName !== "OL" || !ol.firstElementChild) return;
      const line = ol.firstElementChild.textContent.replace(/\s+/g, " ").trim();
      if (/Attack/.test(n.textContent)) atk = line;
      else if (/Defend/.test(n.textContent)) def = line;
    });
    return [def && `🛡️ ${def}`, atk && `⚔️ ${atk}`].filter(Boolean).join(" · ");
  },
};
function fillSummary(card, h2) {
  const fn = SUMMARIZERS[card.dataset.sec];
  let sum = h2.querySelector(":scope > .ch-sum");
  if (!fn) { sum?.remove(); return; }
  if (!sum) {
    sum = document.createElement("button");
    sum.type = "button"; sum.className = "ch-sum"; sum.title = "Click to copy";
    sum.addEventListener("click", (e) => { e.stopPropagation(); copySummary(sum); });
    h2.append(sum);
  }
  if (sum.dataset.flash === "1") return; // don't clobber the "Copied ✓" flash
  const line = fn(card);
  sum.dataset.full = line;
  sum.textContent = line;
  sum.style.display = line ? "" : "none";
}
function copySummary(sum) {
  const line = sum.dataset.full || sum.textContent;
  if (!line) return;
  const done = () => {
    sum.dataset.flash = "1";
    sum.textContent = "Copied ✓";
    setTimeout(() => { sum.dataset.flash = ""; sum.textContent = sum.dataset.full || ""; }, 900);
  };
  const fallback = () => {
    try {
      const ta = document.createElement("textarea");
      ta.value = line; ta.style.cssText = "position:fixed;opacity:0";
      document.body.append(ta); ta.select();
      const ok = document.execCommand("copy");
      ta.remove(); return ok;
    } catch { return false; }
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(line).then(done, () => { if (fallback()) done(); });
  else if (fallback()) done();
}
// Re-run a card's summarizer (e.g. the per-second live timer tick).
export function refreshSummary(card) {
  const h2 = card?.querySelector(":scope > h2");
  if (h2 && card.dataset.sec) fillSummary(card, h2);
}

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
    fillSummary(card, h2);
  });
}
function set(card, btn, isClosed, animate) {
  card.classList.toggle("collapsed", isClosed);
  btn.setAttribute("aria-expanded", String(!isClosed));
  btn.title = isClosed ? "Show this section" : "Hide this section";
  if (animate && !isClosed) { card.classList.remove("opening"); void card.offsetWidth; card.classList.add("opening"); }
}
