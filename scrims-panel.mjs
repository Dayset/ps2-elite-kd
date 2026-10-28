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
import { detectScrims, eventsUrl, compactEvent, finalWindow, scrimRow, upsertScrims, scrimResult, scrimMinutes, isOneSided, EVENT_PAGE, SCRIM_RULE } from "./scrims.mjs?v=20261028-scr1";

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
export function liveScrims(json, cid, srv, nameOf) {
  const list = (json && json.characters_event_list) || [];
  const asc = list.map((e) => compactEvent(e, cid)).filter(Boolean).sort((a, b) => a[0] - b[0]);
  if (!asc.length) return { rows: [], oldest: 0, ids: [] };
  const w = finalWindow(asc, { oldOpen: list.length >= EVENT_PAGE, newOpen: false, gap: SCRIM_RULE.GAP }) || { lo: 0, hi: asc.length };
  const found = detectScrims(asc.slice(w.lo, w.hi), cid);
  const ids = [...new Set(found.flatMap((s) => s.opp.map((o) => o.id)))];
  const rows = found.map((s) => scrimRow(s, (id) => ({ key: `${srv}-${id}`, name: nameOf(`${srv}-${id}`) || "" })));
  return { rows, oldest: asc[0][0], ids };
}

const oneSidedHtml = (s) => (isOneSided(s) ? ` <span class="scr-group scr-one" title="${esc(tr("scr.oneSidedTip", "Almost no kills back (2% or less): not a fair fight."))}">${esc(tr("scr.oneSided", "One-sided"))}</span>` : "");

function columns() {
  return [
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

  async function load(p) {
    const key = keyOf(p);
    const srv = String(key).split("-")[0];
    const [file, names, cat] = await Promise.all([
      Promise.resolve().then(() => fetchJson(`${dataDir}scrims/${key}.json`)).catch(() => null),
      Promise.resolve().then(() => knownNames()).catch(() => new Map()),
      Promise.resolve().then(() => catalog()).catch(() => null),
    ]);
    const stored = file && file.v === 1 && Array.isArray(file.scrims) ? file.scrims.map((r) => ({ ...r, o: r.o.map((x) => x.slice()) })) : [];
    for (const r of stored) for (const x of r.o) if (x[0] && x[1] && !names.has(x[0])) names.set(x[0], x[1]);
    let live = null, note = "";
    try {
      const j = await getJson(eventsUrl(baseOf(p), p.cid, { limit: EVENT_PAGE }));
      if (!j || !Array.isArray(j.characters_event_list)) throw new Error("bad census reply");
      live = liveScrims(j, p.cid, srv, (k) => names.get(k));
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

  function sorted(rows) {
    const dir = sortDir === "asc" ? 1 : -1;
    if (sortKey === "opp") return rows.slice().sort((a, b) => dir * oppText(a).localeCompare(oppText(b)) || b.t0 - a.t0);
    if (sortKey === "weapons") return rows.slice().sort((a, b) => dir * wName(shown.cat, a.w[0]).localeCompare(wName(shown.cat, b.w[0])) || b.t0 - a.t0);
    const col = columns().find((c) => c.id === sortKey) || columns()[0];
    return rows.slice().sort((a, b) => {
      const x = col.fn(a), y = col.fn(b);
      if (col.text) return dir * String(x).localeCompare(String(y)) || b.t0 - a.t0;
      return dir * (x - y) || (col.tie ? dir * (col.tie(a) - col.tie(b)) : 0) || b.t0 - a.t0;
    });
  }

  function oppCell(r) {
    const group = r.o.length > 1;
    const people = r.o.map((x) => {
      const nm = bare(x[1]);
      if (!nm) return `<span class="kf-unknown">${esc(tr("kf.unknown", "Unknown player"))}</span>`;
      const tag = tagOf(x[1]);
      return `${tag ? `<span class="kf-tag">[${esc(tag)}]</span> ` : ""}<button type="button" class="kf-name" data-name="${esc(nm)}" title="${esc(tr("kf.addTip", "Add {name} to the names", { name: nm }))}">${esc(nm)}</button>` +
        (group ? ` <span class="scr-sub">${x[2]}–${x[3]}</span>` : "");
    }).join(", ");
    return group ? `<span class="scr-group" title="${esc(tr("scr.groupTip", "Small-group scrim: this player's kills – deaths against each of them, and in total under Result."))}">${esc(tr("scr.group", "Group"))}</span> ${people}` : people;
  }

  function render() {
    if (!shown) return;
    const cols = columns();
    const ind = (id) => `<span class="sort-ind${sortKey === id ? " active" : ""}">${sortKey === id ? (sortDir === "asc" ? "▲" : "▼") : "▼"}</span>`;
    const th = (id, label, hint, cls = "") => `<th class="${cls}sortable${sortKey === id ? " sorted" : ""}" data-sort="${id}" scope="col"${hint ? ` title="${esc(hint)}"` : ""}>${esc(label)}${ind(id)}</th>`;
    table.querySelector("thead").innerHTML = `<tr><th class="rk-num" scope="col">#</th>` +
      th("opp", tr("scr.opponent", "Opponent"), tr("scr.opponentTip", "Who the scrim was against. Click a name to add it to the names."), "scr-name ") +
      cols.map((c) => th(c.id, c.label, c.hint)).join("") + `</tr>`;
    const now = Date.now();
    table.querySelector("tbody").innerHTML = sorted(shown.rows).map((r, i) => {
      const res = scrimResult(r);
      const start = new Date(r.t0 * 1000);
      const ago = (() => { try { return new Intl.RelativeTimeFormat(lang(), { numeric: "auto", style: "short" }).format(-Math.round((now - r.t1 * 1000) / 86400000), "day"); } catch { return ""; } })();
      return `<tr class="scr-${res}"><td class="rk-num">${i + 1}</td>` +
        `<td class="scr-name">${oppCell(r)}</td>` +
        `<td class="scr-date" title="${esc(ago)}">${esc(start.toLocaleString(lang(), { dateStyle: "medium", timeStyle: "short" }))}</td>` +
        `<td class="scr-result"><span class="scr-res scr-${res}">${esc(scrimResultLabel(res))}</span> ${r.k.toLocaleString(lang())}–${r.d.toLocaleString(lang())}${oneSidedHtml(r)}</td>` +
        `<td>${esc(tr("scr.min", "{n} min", { n: scrimMinutes(r).toLocaleString(lang()) }))}</td>` +
        `<td>${esc(zoneName(r.z))}</td>` +
        `<td class="scr-weapons">${esc(wName(shown.cat, r.w[0]))} · ${esc(wName(shown.cat, r.w[1]))}</td></tr>`;
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

  async function show() {
    const p = player;
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
    else { sortKey = k; sortDir = k === "opp" || k === "zone" || k === "weapons" ? "asc" : "desc"; }
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
    /** Loaded PlayStation players on the page; the tab shows for exactly one. */
    setPlayers(list) {
      const one = list && list.length === 1 && list[0] && list[0].cid ? list[0] : null;
      section.hidden = !one;
      if (!one) { player = null; return; }
      if (player && player.cid === one.cid) return;
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
