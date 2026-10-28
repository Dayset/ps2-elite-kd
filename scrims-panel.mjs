/**
 * 🥊 Scrims tab (PlayStation room only, one player on the page; owner 2026-10-28).
 * Every scrim we found for the player: date, opponent, result (who won, kills – deaths),
 * length, continent and the weapon each side used most.
 *
 * Data, on first open:
 *  - data-ps/scrims/<key>.json: written by the bot (scripts/ps-scrims.mjs), which reads each
 *    player's whole kill / death history from Census in the background, newest first;
 *  - plus ONE live Census call (the newest 1,000 kills & deaths) so today's scrims show before
 *    the bot gets there, and at most one name lookup for opponents we can't name from the
 *    room's own files.
 * The table uses the shared Rankings table look (zebra, pinned header, # pinned, sortable).
 */
import { t as tr, currentLang } from "./i18n.mjs";
import { detectScrims, eventsUrl, compactEvent, finalWindow, scrimRow, upsertScrims, scrimResult, scrimMinutes, isOneSided, isScrimRowWeaponsOk, weaponCategory, EVENT_PAGE, SCRIM_RULE } from "./scrims.mjs?v=20261028-scr2";

const scrimResultLabel = (res) => (res === "won" ? tr("scr.won", "Won") : res === "lost" ? tr("scr.lost", "Lost") : tr("scr.draw", "Draw"));

/** Continents by zone definition id (instanced zones carry the instance in the high bits). */
export const ZONES = Object.freeze({ 2: "Indar", 4: "Hossin", 6: "Amerish", 8: "Esamir", 14: "Koltyr", 344: "Oshur", 361: "Desolation" });
export function zoneName(z) {
  const id = (Number(z) || 0) & 0xffff;
  return ZONES[id] ? tr(`scr.z.${id}`, ZONES[id]) : "–";
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lang = () => { try { return currentLang() || undefined; } catch { return undefined; } };
const bare = (n) => String(n || "").replace(/^\[[^\]]*\]\s*/, "").trim();
const tagOf = (n) => { const m = /^\[([^\]]*)\]/.exec(String(n || "")); return m ? m[1] : ""; };
const dateOnly = (t) => new Date(t * 1000).toLocaleDateString(lang(), { day: "numeric", month: "short", year: "numeric" });

/** Totals for the summary line. */
export function scrimTotals(rows) {
  const t = { n: 0, won: 0, lost: 0, draw: 0 };
  for (const r of rows || []) { t.n++; t[scrimResult(r)]++; }
  return t;
}

/** Census name lookup for opponent ids (one call, ≤ 100 ids). */
export function namesUrl(base, ids) {
  return `${base}character/?character_id=${ids.slice(0, 100).join(",")}&c:show=character_id,name.first` +
    `&c:join=outfit_member_extended^on:character_id^to:character_id^inject_at:of^show:alias&c:limit=100`;
}

/**
 * Live part: the newest 1,000 events → stored-row shape (scrims.mjs scrimRow). A scrim cut by
 * the page edge is left out when older history follows (the bot's copy has it whole).
 */
/** Catalog items → weapon-category lookup, or null when the catalog is missing/empty (then only the vehicle check applies). */
export const mkCatOf = (cat) => (cat && cat.items && Object.keys(cat.items).length ? (id) => weaponCategory(cat.items, id) : null);

export function liveScrims(json, cid, srv, nameOf, catOf = null) {
  const list = (json && json.characters_event_list) || [];
  const asc = list.map((e) => compactEvent(e, cid)).filter(Boolean).sort((a, b) => a[0] - b[0]);
  if (!asc.length) return { rows: [], oldest: 0, ids: [] };
  const w = finalWindow(asc, { oldOpen: list.length >= EVENT_PAGE, newOpen: false, gap: SCRIM_RULE.GAP }) || { lo: 0, hi: asc.length };
  const found = detectScrims(asc.slice(w.lo, w.hi), cid, SCRIM_RULE, catOf);
  const ids = [...new Set(found.flatMap((s) => s.opp.map((o) => o.id)))];
  const rows = found.map((s) => scrimRow(s, (id) => ({ key: `${srv}-${id}`, name: nameOf(`${srv}-${id}`) || "" }))).filter((r) => isScrimRowWeaponsOk(r, catOf));
  return { rows, oldest: asc[0][0], ids };
}

const oneSidedHtml = (s) => (isOneSided(s) ? ` <span class="scr-group scr-one" title="${esc(tr("scr.oneSidedTip", "Almost no kills back (2% or less): not a fair fight."))}">${esc(tr("scr.oneSided", "One-sided"))}</span>` : "");

function columns() {
  return [
    { id: "size", label: tr("scr.size", "Kills"), hint: tr("scr.sizeTip", "Kills in the scrim, both sides together."), fn: (r) => r.k + r.d },
    { id: "date", label: tr("scr.date", "Date"), hint: tr("scr.dateTip", "When the scrim started (hover: how long ago it ended)."), fn: (r) => r.t0 },
    { id: "result", label: tr("scr.result", "Result"), hint: tr("scr.resultTip", "Who won: this player's kills – deaths against the opponent in the scrim."), fn: (r) => r.k - r.d, tie: (r) => r.k + r.d },
    { id: "len", label: tr("scr.length", "Length"), hint: tr("scr.lengthTip", "From the first to the last kill of the scrim."), fn: (r) => r.t1 - r.t0 },
    { id: "zone", label: tr("scr.zone", "Continent"), hint: tr("scr.zoneTip", "Where most of the scrim's kills happened."), fn: (r) => zoneName(r.z), text: true },
    { id: "weapons", label: tr("scr.weapons", "Weapons"), hint: tr("scr.weaponsTip", "Most used weapon: this player's · the opponent's."), fn: null },
  ];
}

/**
 * @param section <details id="scrimsSection">
 * @param o getJson(url) (Census), fetchJson(url) (site files, null on 404), baseOf(p), keyOf(p) → "us-<cid>",
 *   dataDir ("data-ps/"), addName(name, anchor), sortScroll, catalog() → Promise<catalog json>,
 *   knownNames() → Promise<Map key → "[TAG] Name">.
 */
export function mountScrims(section, o = {}) {
  if (!section) return { setPlayers() {} };
  const { getJson, fetchJson, baseOf, keyOf, dataDir = "data-ps/", addName, sortScroll, catalog = async () => null, knownNames = async () => new Map() } = o;
  const count = section.querySelector(".scr-count");
  const status = section.querySelector(".scr-status");
  const sum = section.querySelector(".scr-summary");
  const wrap = section.querySelector(".scr-scroll");
  const table = section.querySelector(".scr-table");
  const cache = new Map();
  let player = null, shown = null;
  let sortKey = "date", sortDir = "desc";
  /** 🥊 Top mode (no single player on the page): the room's biggest scrims, data-ps/scrims-top.json. */
  const TOP = { cid: "top", top: true };
  let wantTop = false;

  async function loadTop() {
    const [top, cat] = await Promise.all([
      Promise.resolve().then(() => fetchJson(`${dataDir}scrims-top.json`)),
      Promise.resolve().then(() => catalog()).catch(() => null),
    ]);
    if (!top || top.v !== 1 || !Array.isArray(top.rows)) throw new Error("no top list");
    return { top, rows: top.rows.map((r) => ({ ...r, o: r.o.map((x) => x.slice()) })).filter((r) => isScrimRowWeaponsOk(r, mkCatOf(cat))), cat: (cat && cat.items) || {} };
  }

  async function load(p) {
    const key = keyOf(p);
    const srv = String(key).split("-")[0];
    const [file, names, cat] = await Promise.all([
      Promise.resolve().then(() => fetchJson(`${dataDir}scrims/${key}.json`)).catch(() => null),
      Promise.resolve().then(() => knownNames()).catch(() => new Map()),
      Promise.resolve().then(() => catalog()).catch(() => null),
    ]);
    const catOf = mkCatOf(cat);
    const stored = file && file.v === 1 && Array.isArray(file.scrims) ? file.scrims.map((r) => ({ ...r, o: r.o.map((x) => x.slice()) })).filter((r) => isScrimRowWeaponsOk(r, catOf)) : [];
    for (const r of stored) for (const x of r.o) if (x[0] && x[1] && !names.has(x[0])) names.set(x[0], x[1]);
    let live = null, note = "";
    try {
      const j = await getJson(eventsUrl(baseOf(p), p.cid, { limit: EVENT_PAGE }));
      if (!j || !Array.isArray(j.characters_event_list)) throw new Error("bad census reply");
      live = liveScrims(j, p.cid, srv, (k) => names.get(k), catOf);
      const missing = live.ids.filter((id) => !names.has(`${srv}-${id}`));
      if (missing.length) {
        try {
          const nj = await getJson(namesUrl(baseOf(p), missing));
          for (const c of (nj && nj.character_list) || []) {
            const nm = c && c.name && c.name.first;
            if (nm) names.set(`${srv}-${c.character_id}`, c.of && c.of.alias ? `[${c.of.alias}] ${nm}` : nm);
          }
        } catch (_) { /* names are cosmetic */ }
        for (const r of live.rows) for (const x of r.o) if (!x[1]) x[1] = names.get(x[0]) || "";
      }
    } catch (e) {
      if (!file) throw e;
      note = tr("scr.staleNote", "Census is busy: showing the saved scrims only.");
    }
    const rows = stored.slice();
    if (live) upsertScrims(rows, live.rows);
    return { key, rows, file, live, note, cat: (cat && cat.items) || {} };
  }

  const wName = (cat, id) => { const e = id && cat[String(id)]; return e ? e[0] : id ? `#${id}` : "–"; };
  const oppText = (r) => r.o.map((x) => bare(x[1]) || "?").join(", ");
  const pText = (r) => bare(r.p && r.p[1]) || "?";

  function sorted(rows) {
    const dir = sortDir === "asc" ? 1 : -1;
    if (sortKey === "opp") return rows.slice().sort((a, b) => dir * oppText(a).localeCompare(oppText(b)) || b.t0 - a.t0);
    if (sortKey === "player") return rows.slice().sort((a, b) => dir * pText(a).localeCompare(pText(b)) || b.t0 - a.t0);
    if (sortKey === "weapons") return rows.slice().sort((a, b) => dir * wName(shown.cat, a.w[0]).localeCompare(wName(shown.cat, b.w[0])) || b.t0 - a.t0);
    const col = columns().find((c) => c.id === sortKey) || columns()[0];
    return rows.slice().sort((a, b) => {
      const x = col.fn(a), y = col.fn(b);
      if (col.text) return dir * String(x).localeCompare(String(y)) || b.t0 - a.t0;
      return dir * (x - y) || (col.tie ? dir * (col.tie(a) - col.tie(b)) : 0) || b.t0 - a.t0;
    });
  }

  function personHtml(full) {
    const nm = bare(full);
    if (!nm) return `<span class="kf-unknown">${esc(tr("kf.unknown", "Unknown player"))}</span>`;
    const tag = tagOf(full);
    return `${tag ? `<span class="kf-tag">[${esc(tag)}]</span> ` : ""}<button type="button" class="kf-name" data-name="${esc(nm)}" title="${esc(tr("kf.addTip", "Add {name} to the names", { name: nm }))}">${esc(nm)}</button>`;
  }

  /** One line, fixed width: first opponent + "+N" for a group (each one's kills – deaths on hover). */
  function oppCell(r) {
    if (r.o.length < 2) return personHtml(r.o[0] && r.o[0][1]);
    const all = r.o.map((x) => `${bare(x[1]) || "?"} ${x[2]}–${x[3]}`).join(", ");
    const tip = `${tr("scr.groupTip", "Small-group scrim: this player's kills – deaths against each of them, and in total under Result.")} ${all}`;
    return `<span class="scr-group" title="${esc(tip)}">+${r.o.length - 1}</span> ${personHtml(r.o[0][1])}`;
  }

  function render() {
    if (!shown) return;
    const cols = columns();
    const ind = (id) => `<span class="sort-ind${sortKey === id ? " active" : ""}">${sortKey === id ? (sortDir === "asc" ? "▲" : "▼") : "▼"}</span>`;
    const th = (id, label, hint, cls = "") => `<th class="${cls}sortable${sortKey === id ? " sorted" : ""}" data-sort="${id}" scope="col"${hint ? ` title="${esc(hint)}"` : ""}>${esc(label)}${ind(id)}</th>`;
    const top = !!shown.top;
    table.classList.toggle("scr-top", top);
    let cg = table.querySelector("colgroup");
    if (!cg) { cg = document.createElement("colgroup"); table.insertBefore(cg, table.firstChild); }
    cg.innerHTML = ["num", ...(top ? ["name", "name"] : ["name"]), "size", "date", "result", "len", "zone", "weapons"].map((c) => `<col class="scr-w-${c}" />`).join("");
    table.querySelector("thead").innerHTML = `<tr><th class="rk-num" scope="col">#</th>` +
      (top ? th("player", tr("scr.player", "Player"), tr("scr.playerTip", "The winner of a 1v1 (in a group scrim: the player whose history found it). Click a name to add it to the names."), "scr-name ") : "") +
      th("opp", tr("scr.opponent", "Opponent"), tr("scr.opponentTip", "Who the scrim was against. Click a name to add it to the names."), top ? "scr-opp " : "scr-name ") +
      cols.map((c) => th(c.id, c.label, c.hint, c.id === "weapons" ? "scr-weapons " : "")).join("") + `</tr>`;
    const now = Date.now();
    table.querySelector("tbody").innerHTML = sorted(shown.rows).map((r, i) => {
      const res = scrimResult(r);
      const start = new Date(r.t0 * 1000);
      const ago = (() => { try { return new Intl.RelativeTimeFormat(lang(), { numeric: "auto", style: "short" }).format(-Math.round((now - r.t1 * 1000) / 86400000), "day"); } catch { return ""; } })();
      return `<tr class="scr-${res}"><td class="rk-num">${i + 1}</td>` +
        (top ? `<td class="scr-name">${personHtml(r.p && r.p[1])}</td><td class="scr-opp">${oppCell(r)}</td>` : `<td class="scr-name">${oppCell(r)}</td>`) +
        `<td class="scr-size">${(r.k + r.d).toLocaleString(lang())}</td>` +
        `<td class="scr-date" title="${esc(ago)}">${esc(start.toLocaleString(lang(), { dateStyle: "medium", timeStyle: "short" }))}</td>` +
        `<td class="scr-result"><span class="scr-res scr-${res}">${esc(scrimResultLabel(res))}</span> ${r.k.toLocaleString(lang())}–${r.d.toLocaleString(lang())}${oneSidedHtml(r)}</td>` +
        `<td>${esc(tr("scr.min", "{n} min", { n: scrimMinutes(r).toLocaleString(lang()) }))}</td>` +
        `<td>${esc(zoneName(r.z))}</td>` +
        ((w) => `<td class="scr-weapons" title="${esc(w)}">${esc(w)}</td></tr>`)(`${wName(shown.cat, r.w[0])} · ${wName(shown.cat, r.w[1])}`);
    }).join("");
  }

  function setStatus(text) { status.textContent = text || ""; status.hidden = !text; }

  function coverage(r) {
    const f = r.file;
    if (f && f.done && f.from) return tr("scr.readAll", "Whole history read (back to {date}).", { date: dateOnly(f.from) });
    if (f && f.from) return tr("scr.readTo", "History read back to {date}; older history is still being read.", { date: dateOnly(f.from) });
    const since = r.live && r.live.oldest ? dateOnly(r.live.oldest) : "";
    return since
      ? tr("scr.readLive", "Newest 1,000 kills & deaths read (since {date}); older history is read in the background.", { date: since })
      : tr("scr.readNone", "Older history is read in the background.");
  }

  async function showTop() {
    if (!section.open || player !== TOP) return;
    if (shown && shown.top) return;
    let job = cache.get("top");
    if (!job) {
      job = loadTop();
      cache.set("top", job);
      job.catch(() => cache.delete("top"));
    }
    setStatus(tr("scr.loading", "Looking for scrims…"));
    try {
      const r = await job;
      if (player !== TOP) return;
      shown = { cid: "top", ...r };
      count.textContent = "";
      sum.textContent = tr("scr.topSummary", "All {n} PlayStation scrims found", { n: r.rows.length.toLocaleString(lang()) });
      sum.title = tr("scr.ruleTip", "Scrim: 10+ kills and deaths in a row with one opponent (no 10-minute break), and that opponent is 60%+ of all kills and deaths in that time. Small groups (2–6 players) count too.");
      sum.hidden = false;
      setStatus(tr("scr.topNote", "Biggest first; click a column to sort. History read for {players} players so far. Add one name to see that player's scrims.", { players: r.top.players.toLocaleString(lang()) }));
      wrap.hidden = !r.rows.length;
      render();
    } catch (e) {
      if (player !== TOP) return;
      setStatus(tr("scr.topNone", "No scrims found yet."));
    }
  }

  async function show() {
    const p = player;
    if (p === TOP) return showTop();
    if (!p || !p.cid || !section.open) return;
    if (shown && shown.cid === p.cid) return;
    let job = cache.get(p.cid);
    if (!job) {
      job = load(p);
      cache.set(p.cid, job);
      job.catch(() => cache.delete(p.cid));
    }
    setStatus(tr("scr.loading", "Looking for scrims…"));
    try {
      const r = await job;
      if (player !== p) return;
      shown = { cid: p.cid, ...r };
      const t = scrimTotals(r.rows);
      count.textContent = t.n ? `(${t.n.toLocaleString(lang())})` : "";
      sum.textContent = t.n
        ? tr("scr.summary", "{n} scrims · won {won} · lost {lost} · draw {draw}", { n: t.n.toLocaleString(lang()), won: t.won.toLocaleString(lang()), lost: t.lost.toLocaleString(lang()), draw: t.draw.toLocaleString(lang()) })
        : tr("scr.none", "No scrims found so far.");
      sum.title = tr("scr.ruleTip", "Scrim: 10+ kills and deaths in a row with one opponent (no 10-minute break), and that opponent is 60%+ of all kills and deaths in that time. Small groups (2–6 players) count too.");
      sum.hidden = false;
      setStatus([r.note, coverage(r)].filter(Boolean).join(" "));
      wrap.hidden = !t.n;
      render();
    } catch (e) {
      if (player !== p) return;
      setStatus(tr("scr.error", "Census is busy: close and open this tab to try again."));
    }
  }

  section.addEventListener("toggle", () => { if (section.open) show(); });
  table.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("button.kf-name[data-name]");
    if (b) { if (addName) addName(b.dataset.name, b); return; }
    const th = e.target.closest("th[data-sort]");
    if (!th || !shown) return;
    const k = th.dataset.sort;
    if (sortKey === k) sortDir = sortDir === "asc" ? "desc" : "asc";
    else { sortKey = k; sortDir = k === "opp" || k === "player" || k === "zone" || k === "weapons" ? "asc" : "desc"; }
    const prevLeft = wrap.scrollLeft;
    render();
    if (sortScroll) sortScroll(wrap, table.querySelector(`th[data-sort="${k}"]`), prevLeft);
  });

  // Same header pin as the Rankings and weapons tables.
  {
    let queued = false, last = -1;
    const pin = () => {
      queued = false;
      if (wrap.hidden || !section.open) return;
      const r = wrap.getBoundingClientRect();
      const headH = table.tHead ? table.tHead.getBoundingClientRect().height : 0;
      let off = 0;
      if (r.top < 0 && r.bottom > headH) off = Math.min(-r.top, Math.max(0, wrap.clientHeight - headH));
      off = Math.round(off);
      if (off !== last) { last = off; table.style.setProperty("--rk-head-top", off + "px"); }
    };
    const q = () => { if (!queued) { queued = true; requestAnimationFrame(pin); } };
    window.addEventListener("scroll", q, { passive: true });
    window.addEventListener("resize", q, { passive: true });
  }

  return {
    /**
     * Loaded PlayStation players on the page: exactly one → that player's scrims; none or
     * several → the room's top list (setPlayers(null) = not the PS room: hidden).
     */
    setPlayers(list) {
      if (list == null) { section.hidden = true; player = null; return; }
      const one = list.length === 1 && list[0] && list[0].cid ? list[0] : TOP;
      section.hidden = false;
      if (player && player.cid === one.cid) return;
      if (!player || (player === TOP) !== (one === TOP)) { sortKey = one === TOP ? "size" : "date"; sortDir = "desc"; }
      player = one;
      shown = null;
      count.textContent = "";
      sum.hidden = true; sum.textContent = "";
      wrap.hidden = true;
      table.querySelector("thead").innerHTML = "";
      table.querySelector("tbody").innerHTML = "";
      setStatus("");
      show();
    },
  };
}
