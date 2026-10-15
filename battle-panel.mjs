/**
 * Debug-only battle panel in the footer. Shown only while the
 * "show older debug stats" box is ticked. Pure math lives in battle.mjs.
 */
import { findFighter, pickOpponents, runBattle } from "./battle.mjs?v=20261015-battle1";

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const num = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "—");

let ranksLoad = null;
function loadRanks() {
  if (ranksLoad) return ranksLoad;
  ranksLoad = fetch("data/ranks.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .then((payload) => {
      if (!payload || !Array.isArray(payload.cols) || !Array.isArray(payload.rows)) {
        throw new Error("Ranks data is unavailable.");
      }
      return payload;
    })
    .catch((err) => {
      ranksLoad = null; // allow a retry next time
      throw err;
    });
  return ranksLoad;
}

function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = String(text);
  return node;
}

function renderError(out, message) {
  out.replaceChildren(el("p", message, "battle-error"));
}

function renderResult(out, champ, result) {
  const block = el("div", null, "battle-block");
  const verdict = result.win ? "Champion wins" : "Champion loses";
  block.append(el("h4", `${verdict}: ${champ.name}`, result.win ? "battle-win" : "battle-lose"));

  const modeText =
    result.mode === "concentrated"
      ? "Opponents fight together (similar activity): combined strength (Σ√b)²."
      : result.mode === "sequential"
        ? "Opponents fight one by one (dissimilar activity): each duel costs b²/a."
        : "No opponents found.";
  block.append(el("p", modeText, "battle-mode"));

  const summary = el("ul", null, "battle-summary");
  summary.append(
    el("li", `Champion strength: ${num(result.a, 2)}`),
    el("li", `Enemy strength used: ${num(result.enemy, 2)}`),
    el("li", `Activity similarity (min ÷ max): ${num(result.similarity, 3)}`),
    el("li", `Champion remaining strength: ${pct(result.remaining)}`)
  );
  block.append(summary);

  const table = el("table", null, "battle-table");
  const head = el("tr");
  for (const h of ["Opponent", "adjS", "Activity", "Consistency", "Strength", "1v1 win chance"]) {
    head.append(el("th", h));
  }
  const thead = el("thead");
  thead.append(head);
  table.append(thead);
  const body = el("tbody");
  for (const d of result.duels) {
    const tr = el("tr");
    tr.append(
      el("td", d.name),
      el("td", num(d.adjs, 0)),
      el("td", num(d.act, 2)),
      el("td", num(d.cons, 2)),
      el("td", num(d.strength, 2)),
      el("td", pct(d.championWinChance))
    );
    body.append(tr);
  }
  table.append(body);
  block.append(table);
  out.replaceChildren(block);
}

async function runFromInput(nameInput, countInput, out) {
  const typed = nameInput.value;
  const count = Math.max(1, Math.min(20, Math.floor(+countInput.value) || 0));
  out.replaceChildren(el("p", "Running battle…", "battle-status"));
  let payload;
  try {
    payload = await loadRanks();
  } catch (err) {
    renderError(out, err.message || "Could not load ranks data.");
    return;
  }
  const { cols, rows } = payload;
  const found = findFighter(rows, cols, typed);
  if (found.error) {
    renderError(out, found.error);
    return;
  }
  const champ = found.fighter;
  const opponents = pickOpponents(rows, cols, champ, count);
  if (!opponents.length) {
    renderError(out, "No opponents available in the ranks data.");
    return;
  }
  const result = runBattle(champ, opponents);
  renderResult(out, champ, result);
}

function mount() {
  const panel = document.getElementById("battlePanel");
  const debugToggle = document.getElementById("debugColsToggle");
  const form = document.getElementById("battleForm");
  const nameInput = document.getElementById("battleName");
  const countInput = document.getElementById("battleCount");
  const out = document.getElementById("battleResult");
  if (!panel || !debugToggle || !form || !nameInput || !countInput || !out) return;

  const sync = () => {
    panel.hidden = !debugToggle.checked;
  };
  sync();
  debugToggle.addEventListener("change", sync);

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    runFromInput(nameInput, countInput, out);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}
