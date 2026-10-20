import { t as tr } from "./i18n.mjs";
/**
 * Name suggestions for the names box (like Honu's partial search, but from 4
 * characters). Two sources, merged:
 *   - cached players from data/ranks.json (instant, marked "cached");
 *   - Census starts-with search on character names, most recently active first.
 * Picking a suggestion replaces the fragment being typed and commits it as a
 * chip through the input's normal "ends with a space" path, so app.js keeps
 * owning the chips, limits and failures.
 *
 * The pure helpers at the top are Node-tested (test/name-suggest.test.mjs);
 * mountNameSuggest is the browser-only part.
 */

export const MIN_CHARS = 4;
export const MAX_SUGGESTIONS = 10;
export const DEBOUNCE_MS = 250;
const FACTIONS = { 1: "VS", 2: "NC", 3: "TR", 4: "NSO" };

/**
 * The fragment being typed: text after the last separator (space, comma,
 * semicolon). Null when it is shorter than MIN_CHARS or has characters a
 * PlanetSide 2 name can't have (names are letters and digits only).
 */
export function suggestFragment(value, min = MIN_CHARS) {
  const v = String(value || "");
  if (/[\s,;]$/.test(v)) return null;
  const parts = v.split(/[\s,;]+/);
  const frag = parts[parts.length - 1] || "";
  if (frag.length < min) return null;
  if (!/^[A-Za-z0-9]+$/.test(frag)) return null;
  return frag;
}

/** Census starts-with search, most recently logged-in characters first. */
export function censusSuggestUrl(base, fragment, limit = MAX_SUGGESTIONS) {
  const q = encodeURIComponent("^" + String(fragment).toLowerCase());
  return (
    `${base}character?name.first_lower=${q}&c:limit=${limit}` +
    "&c:sort=times.last_login:-1" +
    "&c:show=character_id,name.first,times.last_login,battle_rank.value,faction_id"
  );
}

/** Census character list → [{ name, faction, br, lastLogin }]. Bad input → []. */
export function parseCensusSuggestions(json) {
  const list = json && Array.isArray(json.character_list) ? json.character_list : [];
  const out = [];
  for (const c of list) {
    const name = c && c.name && typeof c.name.first === "string" ? c.name.first.trim() : "";
    if (!/^[A-Za-z0-9]+$/.test(name)) continue;
    out.push({
      name,
      faction: FACTIONS[+c.faction_id] || "",
      br: +(c.battle_rank && c.battle_rank.value) || null,
      lastLogin: +(c.times && c.times.last_login) || 0,
      source: "census",
    });
  }
  return out;
}

/** Bare character names from ranks.json ("query" column), for local matching. */
export function namesFromRanks(payload) {
  if (!payload || !Array.isArray(payload.cols) || !Array.isArray(payload.rows)) return [];
  const iq = payload.cols.indexOf("query");
  const iname = payload.cols.indexOf("name");
  if (iq < 0) return [];
  const out = [];
  for (const r of payload.rows) {
    const name = String(r[iq] || "").trim();
    if (!/^[A-Za-z0-9]+$/.test(name)) continue;
    out.push({ name, display: iname >= 0 ? String(r[iname] || name) : name });
  }
  return out;
}

/** Cached names that start with the fragment (case-insensitive), shortest first. */
export function localMatches(names, fragment, limit = MAX_SUGGESTIONS) {
  const f = String(fragment || "").toLowerCase();
  if (!f) return [];
  return (names || [])
    .filter((n) => n.name.toLowerCase().startsWith(f))
    .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((n) => ({ name: n.name, display: n.display, source: "cached" }));
}

/**
 * Merge cached and Census suggestions: cached first, then Census in its order,
 * no case-insensitive duplicates (a cached name also found on Census keeps its
 * Census faction / BR), names already in the box left out.
 */
export function mergeSuggestions(local, remote, exclude = [], limit = MAX_SUGGESTIONS) {
  const skip = new Set((exclude || []).map((n) => String(n).toLowerCase()));
  const byKey = new Map();
  for (const r of remote || []) byKey.set(r.name.toLowerCase(), r);
  const out = [];
  const seen = new Set();
  const push = (item) => {
    const k = item.name.toLowerCase();
    if (seen.has(k) || skip.has(k)) return;
    seen.add(k);
    out.push(item);
  };
  for (const l of local || []) {
    const r = byKey.get(l.name.toLowerCase());
    push(r ? { ...r, display: l.display, source: "cached" } : l);
  }
  for (const r of remote || []) push(r);
  return out.slice(0, limit);
}

/** Input value with the fragment being typed replaced by `name` and a trailing space. */
export function replaceFragment(value, name) {
  const v = String(value || "");
  const m = v.match(/^(.*[\s,;])?[^\s,;]*$/s);
  const head = m && m[1] ? m[1] : "";
  return `${head}${name} `;
}

/* ---------------- browser part ---------------- */

/**
 * Attach the suggestion list to the names input.
 * @param {{ input: HTMLInputElement, anchor: HTMLElement, censusBase: string,
 *           ranksUrl?: string, currentNames?: () => string[] }} opts
 */
export function mountNameSuggest({ input, anchor, censusBase, ranksUrl = "data/ranks.json", currentNames = () => [] }) {
  if (!input || !anchor || typeof document === "undefined") return null;

  const list = document.createElement("ul");
  list.id = "nameSuggest";
  list.className = "name-suggest";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", tr("names.matching", "Matching player names"));
  list.hidden = true;
  anchor.appendChild(list);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", list.id);
  input.setAttribute("aria-expanded", "false");

  let items = [];
  let active = -1;
  let timer = 0;
  let seq = 0;
  let ctrl = null;
  const cache = new Map(); // fragment (lower) → census suggestions
  let localNames = null;
  let localLoad = null;

  function loadLocal() {
    if (localLoad) return localLoad;
    localLoad = fetch(ranksUrl, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => { localNames = namesFromRanks(p); })
      .catch(() => { localNames = []; });
    return localLoad;
  }

  function close() {
    list.hidden = true;
    list.replaceChildren();
    items = [];
    active = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  function setActive(i) {
    active = items.length ? (i + items.length) % items.length : -1;
    [...list.children].forEach((li, j) => li.setAttribute("aria-selected", j === active ? "true" : "false"));
    if (active >= 0) {
      const li = list.children[active];
      input.setAttribute("aria-activedescendant", li.id);
      li.scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function pick(i) {
    const it = items[i];
    if (!it) return;
    input.value = replaceFragment(input.value, it.name);
    close();
    // app.js commits a token when the text ends with a separator.
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  }

  function render(fragment, sugg, pending) {
    if (!sugg.length && !pending) {
      close();
      return;
    }
    items = sugg;
    active = -1;
    const nodes = sugg.map((s, i) => {
      const li = document.createElement("li");
      li.id = `nameSuggest-${i}`;
      li.className = "name-suggest-item";
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", "false");
      const nm = document.createElement("span");
      nm.className = "ns-name";
      const n = s.name;
      const cut = Math.min(fragment.length, n.length);
      const b = document.createElement("b");
      b.textContent = n.slice(0, cut);
      nm.append(b, document.createTextNode(n.slice(cut)));
      li.appendChild(nm);
      const meta = document.createElement("span");
      meta.className = "ns-meta";
      const bits = [];
      if (s.faction) bits.push(s.faction);
      if (s.br) bits.push(`BR ${s.br}`);
      if (s.source === "cached") bits.push("cached");
      meta.textContent = bits.join(" · ");
      li.appendChild(meta);
      // mousedown keeps focus in the input (click would blur it first).
      li.addEventListener("mousedown", (e) => { e.preventDefault(); pick(i); });
      return li;
    });
    if (pending) {
      const li = document.createElement("li");
      li.className = "name-suggest-status";
      li.setAttribute("aria-disabled", "true");
      li.textContent = "Searching Census…";
      nodes.push(li);
    }
    list.replaceChildren(...nodes);
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  async function update() {
    const fragment = suggestFragment(input.value);
    if (!fragment) {
      if (ctrl) ctrl.abort();
      close();
      return;
    }
    const my = ++seq;
    const key = fragment.toLowerCase();
    const exclude = currentNames();
    if (!localNames) await loadLocal();
    if (my !== seq) return;
    const local = localMatches(localNames || [], fragment);

    if (cache.has(key)) {
      render(fragment, mergeSuggestions(local, cache.get(key), exclude), false);
      return;
    }
    render(fragment, mergeSuggestions(local, [], exclude), true);

    if (ctrl) ctrl.abort();
    ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    let remote = [];
    try {
      const res = await fetch(censusSuggestUrl(censusBase, fragment), ctrl ? { signal: ctrl.signal } : undefined);
      remote = parseCensusSuggestions(res.ok ? await res.json() : null);
      cache.set(key, remote);
    } catch (err) {
      if (err && err.name === "AbortError") return;
      remote = []; // Census down / throttled: cached names still show
    }
    if (my !== seq || suggestFragment(input.value) !== fragment) return;
    render(fragment, mergeSuggestions(local, remote, exclude), false);
  }

  input.addEventListener("input", () => {
    clearTimeout(timer);
    if (!suggestFragment(input.value)) {
      seq++;
      if (ctrl) ctrl.abort();
      close();
      return;
    }
    timer = setTimeout(update, DEBOUNCE_MS);
  });

  // Capture on the wrapper so this runs before app.js's Enter (commit + Analyze).
  anchor.addEventListener(
    "keydown",
    (e) => {
      if (e.target !== input || list.hidden || !items.length) {
        if (e.key === "Escape" && !list.hidden) close();
        return;
      }
      if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
      else if ((e.key === "Enter" || e.key === "Tab") && active >= 0) {
        e.preventDefault();
        e.stopPropagation();
        pick(active);
      }
    },
    true
  );

  input.addEventListener("blur", () => setTimeout(close, 150));
  return { close, update };
}
