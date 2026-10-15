/**
 * Debug-only battle panel in the footer. Shown only while the
 * "show older debug stats" box is ticked. Pure math lives in battle.mjs.
 *
 * The players come from the names box on the main page (no retyping). Each
 * name has a "Fights" box: ticked = fights, unticked = opposition. Every ticked
 * player is run against the group of unticked players.
 */
import { findFighter, runBattle } from "./battle.mjs?v=20261015-battle1";

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

/** Names from the main page, and whether each one fights (default: yes). */
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
    box.checked = fights.get(name) !== false;
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
  const f = names.filter((n) => fights.get(n) !== false);
  const o = names.filter((n) => fights.get(n) === false);
  side.textContent = `Fighting: ${f.length ? f.join(", ") : "none"} · Opposition: ${o.length ? o.join(", ") : "none"}`;
}

function renderResult(champ, result) {
  const block = el("div", null, "battle-block");
  const verdict = result.win ? "Champion favored" : "Champion underdog";
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
    el("li", `Champion win rate: ${pct(result.winRate)}${result.trials ? ` (${result.trials} simulated fights)` : " (exact 1v1 odds)"}`),
    el("li", `Champion remaining strength (avg, when he wins): ${pct(result.remaining)}`)
  );
  block.append(summary);

  const table = el("table", null, "battle-table");
  const head = el("tr");
  for (const h of ["Opponent", "adjS", "Activity", "Consistency", "Mean strength", "1v1 win chance"]) {
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
  return block;
}

async function runSelected(out) {
  const fighting = names.filter((n) => fights.get(n) !== false);
  const opposition = names.filter((n) => fights.get(n) === false);
  out.replaceChildren(el("p", "Running battle…", "battle-status"));
  if (!fighting.length || !opposition.length) {
    out.replaceChildren(el("p", "Tick at least one player to fight and leave at least one unticked as opposition.", "battle-error"));
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

  const oppFighters = [];
  const missing = [];
  for (const n of opposition) {
    const r = resolve(n);
    if (r.fighter) oppFighters.push(r.fighter);
    else missing.push(`${n} (${r.error})`);
  }
  const blocks = [];
  if (!oppFighters.length) {
    out.replaceChildren(el("p", "None of the opposition players are in the Rankings data.", "battle-error"));
    return;
  }
  for (const n of fighting) {
    const r = resolve(n);
    if (!r.fighter) {
      missing.push(`${n} (${r.error})`);
      continue;
    }
    blocks.push(renderResult(r.fighter, runBattle(r.fighter, oppFighters)));
  }
  const nodes = [];
  if (missing.length) nodes.push(el("p", `Not in the Rankings data, skipped: ${missing.join("; ")}`, "battle-mode"));
  nodes.push(...blocks);
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
