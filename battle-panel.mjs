/**
 * Debug-only battle panel in the footer. Shown only while the
 * "show older debug stats" box is ticked. Pure math lives in battle.mjs.
 *
 * The players come from the names box on the main page (no retyping). Each
 * name has an "Opposition" box: ticked = opposition, unticked = fighter.
 * All fighters form one side and all opposition players form the other;
 * they fight once, as two groups.
 */
import { findFighter, runGroupBattle } from "./battle.mjs?v=20261015-battle2";

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

/** Names from the main page, and whether each one is opposition (default: no, it fights). */
let names = [];
const fights = new Map();

function renderNameList(list) {
  if (!names.length) {
    list.replaceChildren(el("p", "Add players in the names box above first.", "battle-mode"));
    return;
  }
  const items = names.map((name) => {
    const box = el("input", null, "battle-fight");
    box.type = "checkbox";
    box.checked = fights.get(name) === true;
    box.title = "Ticked = opposition";
    box.dataset.name = name;
    box.addEventListener("change", () => {
      fights.set(name, box.checked);
      updateSideText(list);
    });
    const label = el("label", null, "battle-name");
    label.append(box, el("span", name));
    return label;
  });
  list.replaceChildren(...items);
  updateSideText(list);
}

function updateSideText(list) {
  const side = list.parentElement && list.parentElement.querySelector(".battle-sides");
  if (!side) return;
  const f = names.filter((n) => fights.get(n) !== true);
  const o = names.filter((n) => fights.get(n) === true);
  side.textContent = `Fighting (one group): ${f.length ? f.join(", ") : "none"} · Opposition (one group): ${o.length ? o.join(", ") : "none"}`;
}

function membersTable(players) {
  const table = el("table", null, "battle-table");
  const head = el("tr");
  for (const h of ["Player", "adjS", "Activity", "⚡ Const", "Mean strength"]) {
    head.append(el("th", h));
  }
  const thead = el("thead");
  thead.append(head);
  table.append(thead);
  const body = el("tbody");
  for (const p of players) {
    const tr = el("tr");
    tr.append(
      el("td", p.name),
      el("td", num(p.adjs, 0)),
      el("td", num(p.act, 2)),
      el("td", num(p.cons, 2)),
      el("td", num(p.mu, 2))
    );
    body.append(tr);
  }
  table.append(body);
  const wrap = el("div", null, "battle-table-wrap");
  wrap.append(table);
  return wrap;
}

function renderGroupResult(fighters, opposition, result) {
  const block = el("div", null, "battle-block");
  const fighterNames = fighters.map((f) => f.name).join(", ");
  const winner = result.win ? "Fighting side" : "Opposition";
  const chance = result.win ? result.winRate : 1 - result.winRate;
  block.append(el("h4", `Winner: ${winner} (${pct(chance)} chance)`, result.win ? "battle-win" : "battle-lose"));

  const modeText =
    result.mode === "concentrated"
      ? "Opposition fights together (similar activity): combined strength (Σ√b)²."
      : result.mode === "sequential"
        ? "Opposition fights one by one (dissimilar activity): each duel costs b²/a."
        : "No players on one side.";
  block.append(el("p", modeText, "battle-mode"));

  const summary = el("ul", null, "battle-summary");
  summary.append(
    el("li", `Fighting side combined strength (Σ√s)²: ${num(result.a, 2)}`),
    el("li", `Opposition strength used: ${num(result.enemy, 2)}`),
    el("li", `Activity similarity of opposition (min ÷ max): ${num(result.similarity, 3)}`),
    el("li", `Fighting side win rate: ${pct(result.winRate)} (${result.trials} simulated fights)`),
    el("li", `Fighting side remaining strength (avg, when it wins): ${pct(result.remaining)}`)
  );
  block.append(summary);

  block.append(el("p", `Fighting side: ${fighterNames}`, "battle-mode"));
  block.append(membersTable(fighters));
  block.append(el("p", "Opposition:", "battle-mode"));
  block.append(membersTable(opposition));
  return block;
}

async function runSelected(out) {
  const fighting = names.filter((n) => fights.get(n) !== true);
  const opposition = names.filter((n) => fights.get(n) === true);
  out.replaceChildren(el("p", "Running battle…", "battle-status"));
  if (!fighting.length || !opposition.length) {
    out.replaceChildren(el("p", "Leave at least one player unticked to fight, and tick at least one as opposition.", "battle-error"));
    return;
  }
  let payload;
  try {
    payload = await loadRanks();
  } catch (err) {
    out.replaceChildren(el("p", err.message || "Could not load ranks data.", "battle-error"));
    return;
  }
  const { cols, rows } = payload;
  const resolve = (name) => findFighter(rows, cols, name);

  const fighters = [];
  const oppFighters = [];
  const missing = [];
  for (const n of fighting) {
    const r = resolve(n);
    if (r.fighter) fighters.push(r.fighter);
    else missing.push(`${n} (${r.error})`);
  }
  for (const n of opposition) {
    const r = resolve(n);
    if (r.fighter) oppFighters.push(r.fighter);
    else missing.push(`${n} (${r.error})`);
  }
  if (!fighters.length || !oppFighters.length) {
    out.replaceChildren(el("p", "Both sides need at least one player in the Rankings data.", "battle-error"));
    return;
  }
  const nodes = [];
  if (missing.length) nodes.push(el("p", `Not in the Rankings data, skipped: ${missing.join("; ")}`, "battle-mode"));
  nodes.push(renderGroupResult(fighters, oppFighters, runGroupBattle(fighters, oppFighters)));
  out.replaceChildren(...nodes);
}

function mount() {
  const panel = document.getElementById("battlePanel");
  const debugToggle = document.getElementById("debugColsToggle");
  const form = document.getElementById("battleForm");
  const list = document.getElementById("battleNames");
  const out = document.getElementById("battleResult");
  if (!panel || !debugToggle || !form || !list || !out) return;

  const sync = () => {
    panel.hidden = !debugToggle.checked;
  };
  sync();
  debugToggle.addEventListener("change", sync);

  // The main page announces every change to the names box (renderNameTokens).
  document.addEventListener("ps2-names", (ev) => {
    names = Array.isArray(ev.detail) ? ev.detail.slice() : [];
    for (const k of [...fights.keys()]) if (!names.includes(k)) fights.delete(k);
    renderNameList(list);
  });
  renderNameList(list);

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    runSelected(out);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}
