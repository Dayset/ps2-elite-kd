/**
 * 👯 Play-pattern match (owner t707 / t709 / t710): one line for exactly two entered
 * names, "Play-pattern match N%, likely, never proof". Same 7-clue pair score as the
 * hidden build-log 👥 Likely alts card (scripts/build-alts.mjs → data/alts.json model):
 * prior odds × learned multipliers for time online together, hand-offs, hours of the
 * week, stat profile, weapons, name part and outfit. Public play-time data only.
 *
 * Data per click: data/alts.json (model), data/alt-sessions.json (saved Honu sessions),
 * data/ranks.json (stat profiles; shared with 📋 Rankings), the two saved player files
 * (weapons) and assets/weapons/catalog.json. A character without saved sessions costs
 * ONE Honu call (GET /api/character/{id}/sessions, CORS open); its Census id comes from
 * the saved player file, else one Census name lookup. Nothing is stored or sent anywhere.
 * PC room only (Honu covers PC). Hidden when either name is on the removal list (t710).
 */
import { t as tr } from "./i18n.mjs";
import { compactSessions, sessionClues, nameClue, profileVector, robustScale, profileDistance, jaccard, scorePair } from "./scripts/alts-lib.mjs?v=20261026-pm1";
import { removedKey } from "./opt-out.mjs?v=20261023-proof1";

/** Off switch (owner t715, 2026-10-27: "hide duplicate finder for now from UI"). false → the 👯 button never
 * shows on any page and app.js never starts this part (no removal-list, data or Honu fetches). true → back on. */
export const PAIR_MATCH_ENABLED = false;

const HONU = "https://wt.honu.pw/api/character/";
const DAY = 86400e3;
const KEEP_DAYS = 365; // same window as build-alts.mjs

/** Same faction rule as build-alts.mjs sharedWeapons(): common guns, plus faction guns when both mainly play that faction. */
export function sharedWeapons(wa, wb, facOf) {
  if (!wa || !wb) return null;
  const main = (ids) => {
    const n = {};
    for (const id of ids) { const f = facOf(id); if (f) n[f] = (n[f] || 0) + 1; }
    const best = Object.entries(n).sort((x, y) => y[1] - x[1])[0];
    return best ? +best[0] : 0;
  };
  const fa = main(wa), fb = main(wb);
  const keep = (id) => { const f = facOf(id); return f === 0 || (f != null && fa === fb && f === fa); };
  return jaccard(wa.filter(keep), wb.filter(keep));
}

/**
 * Pure score for one pair (same clues as build-alts.mjs clues(a, b)). Each side:
 * { name, tag, known (sessions looked up), sess: [[startMin, durMin], …] | null, outfits: [] | null, vec: number[] | null, weapons: string[] | null }.
 * @returns {{ p:number, why:object }} p in 0..1
 */
export function scoreSides(A, B, { model, prior, scale, facOf = () => null }) {
  const hasA = !!A.known, hasB = !!B.known; // Honu sessions looked up (saved or fetched), even if empty
  const oa = A.outfits || [], ob = B.outfits || [];
  const outfit = hasA && hasB && (oa.length || ob.length) ? oa.some((o) => ob.includes(o))
    : A.tag && B.tag ? A.tag === B.tag : null;
  const clues = {
    sess: hasA && hasB ? sessionClues(A.sess || [], B.sess || []) : null,
    profile: A.vec && B.vec && scale ? profileDistance(A.vec, B.vec, scale) : null,
    weapons: sharedWeapons(A.weapons, B.weapons, facOf),
    name: nameClue(A.name, B.name),
    outfit,
  };
  return scorePair(clues, model, prior);
}

/** "84" / "<1" / ">99" (whole percent, never a false 0 or 100). */
export function pctText(p) {
  const v = 100 * p;
  if (v < 0.5) return "<1";
  if (v > 99.5) return ">99";
  return String(Math.round(v));
}

/** Show the button? PC room, exactly two names, neither on the removal list. */
export function pairVisible(names, { enabled = PAIR_MATCH_ENABLED, isPs = false, removed = null, ready = false } = {}) {
  if (!enabled || isPs || !ready || !Array.isArray(names) || names.length !== 2) return false;
  if (removedKey(names[0]) === removedKey(names[1])) return false;
  if (removed && names.some((n) => removed.match({ slug: removedKey(n), name: n }))) return false;
  return true;
}

/**
 * Page part. $ = live getters: els, nameTokens, IS_PS, DATA, removedNow, removedReady(),
 * loadRanksPayload(), censusJson(url), CENSUS, tagName(name) → saved "[TAG] Name" or "".
 */
export function createPairMatch($) {
  let removedLoaded = false, removedAsked = false;
  let shared = null; // { model, prior, chars, scale, rows, I, cat }
  let runId = 0;
  const fetched = new Map(); // slug → Promise<{ sess, outfits } | null>: one Honu call per character per page visit
  const btn = () => $.els.pairMatchBtn;
  const note = () => $.els.pairMatchNote;
  const getJson = (url) => fetch(url, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  function setNote(text, busy = false) {
    const n = note();
    if (!n) return;
    n.textContent = text || "";
    n.hidden = !text;
    if (busy) n.setAttribute("aria-busy", "true"); else n.removeAttribute("aria-busy");
  }

  function sync() {
    const b = btn();
    const names = $.nameTokens.slice();
    const show = pairVisible(names, { enabled: $.enabled ?? PAIR_MATCH_ENABLED, isPs: $.IS_PS, removed: $.removedNow, ready: removedLoaded });
    if (b) b.hidden = !show;
    runId++; // names changed: an old result no longer applies
    setNote("");
    if (!($.enabled ?? PAIR_MATCH_ENABLED)) return; // switched off: no fetches at all
    if (!removedLoaded && !removedAsked && !$.IS_PS && names.length === 2) {
      removedAsked = true;
      // Fail closed: no removal list (network error) → the button stays hidden.
      Promise.resolve($.removedReady()).catch(() => null).then(() => { removedLoaded = !!$.removedNow; if (removedLoaded) sync(); });
    }
  }

  async function loadShared() {
    if (shared) return shared;
    const [alts, cache, ranks, cat] = await Promise.all([
      getJson(`${$.DATA}alts.json`), getJson(`${$.DATA}alt-sessions.json`),
      Promise.resolve($.loadRanksPayload()).catch(() => null), getJson("assets/weapons/catalog.json"),
    ]);
    if (!alts || !alts.model || !alts.prior) return null;
    let I = null, rowBySlug = new Map(), scale = null;
    if (ranks && Array.isArray(ranks.cols)) {
      I = Object.fromEntries(ranks.cols.map((c, i) => [c, i]));
      rowBySlug = new Map(ranks.rows.map((r) => [r[I.slug], r]));
      scale = robustScale(ranks.rows.map((r) => profileVector(r, I))); // same scale as build-alts.mjs (all ranked rows)
    }
    const items = (cat && cat.items) || {};
    shared = { model: alts.model, prior: alts.prior, chars: (cache && cache.chars) || {}, I, rowBySlug, scale, facOf: (id) => (items[id] ? +items[id][2] || 0 : null) };
    return shared;
  }

  async function cidOf(name, file) {
    const c = file && file.player && file.player.cid;
    if (/^\d+$/.test(String(c || ""))) return String(c);
    try {
      const bare = String(name).replace(/^\[[^\]]*\]\s*/, "").trim().toLowerCase();
      const j = await $.censusJson(`${$.CENSUS}character/?name.first_lower=${encodeURIComponent(bare)}&c:show=character_id`);
      const id = j && j.character_list && j.character_list[0] && j.character_list[0].character_id;
      return /^\d+$/.test(String(id || "")) ? String(id) : "";
    } catch { return ""; }
  }

  async function side(name, S) {
    const slug = removedKey(name);
    const row = S.rowBySlug.get(slug);
    const file = await getJson(`${$.DATA}players/${slug}.json`);
    const saved = S.chars[slug];
    let sess = null, outfits = null, known = false;
    if (saved && Array.isArray(saved.sess)) {
      known = true;
      sess = [];
      for (let i = 0; i < saved.sess.length; i += 2) sess.push([saved.sess[i], saved.sess[i + 1]]);
      outfits = saved.outfits || [];
    } else {
      if (!fetched.has(slug)) {
        fetched.set(slug, (async () => {
          const cid = await cidOf(name, file); // at most 1 Census call, only without a saved player file
          if (!cid) return null;
          const list = await getJson(`${HONU}${cid}/sessions`); // 1 Honu call
          if (!Array.isArray(list)) return null;
          const now = Date.now();
          return compactSessions(list, { sinceMs: now - KEEP_DAYS * DAY, nowMs: now });
        })());
      }
      const c = await fetched.get(slug);
      if (c) { sess = c.sess; outfits = c.outfits; known = true; }
      else fetched.delete(slug); // failed: a later click may try once more
    }
    const display = (file && file.player && file.player.display) || name;
    const tag = (String(($.tagName && $.tagName(name)) || name).match(/^\[([^\]]+)\]/) || [])[1] || ""; // [TAG] from data/index.json, like build-alts.mjs
    const w = file && file.player && file.player.weapons && Array.isArray(file.player.weapons.rows) ? file.player.weapons.rows.map((r) => String(r[0])) : null;
    return {
      name: row ? row[S.I.name] : String(display).replace(/^\[[^\]]*\]\s*/, ""),
      tag, known, sess, outfits, weapons: w,
      vec: row ? profileVector(row, S.I) : null,
    };
  }

  async function run() {
    const names = $.nameTokens.slice();
    if (!pairVisible(names, { enabled: $.enabled ?? PAIR_MATCH_ENABLED, isPs: $.IS_PS, removed: $.removedNow, ready: removedLoaded })) return;
    const my = ++runId;
    const b = btn();
    if (b) b.setAttribute("aria-busy", "true");
    setNote(tr("pair.busy", "👯 Comparing public play-time data…"), true);
    let text;
    try {
      const S = await loadShared();
      if (!S) throw new Error("no model");
      const [A, B] = await Promise.all(names.map((n) => side(n, S)));
      const { p } = scoreSides(A, B, S);
      text = "👯 " + tr("pair.result", "Play-pattern match {n}%, likely, never proof", { n: pctText(p) });
    } catch {
      text = "👯 " + tr("pair.fail", "Play-pattern match: public play-time data not available right now");
    } finally {
      if (b) b.removeAttribute("aria-busy");
    }
    if (my === runId) setNote(text);
  }

  if (typeof document !== "undefined") {
    document.addEventListener("ps2-names", () => queueMicrotask(sync));
    btn()?.addEventListener("click", run);
  }
  return { sync, run };
}
