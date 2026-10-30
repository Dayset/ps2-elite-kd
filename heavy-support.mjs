/**
 * ⛑️ Heavy support (owner t757/t758/t760, hidden build-log card only).
 *
 * A play-style view: players who spend most of their time supporting (heals,
 * revives, resupply, repairs, squad spawns) and, for the top of that list, the
 * regular partner they support. Example: GingerBaby → Zyr0s (a pocket duo).
 *
 * 1. Heavy-support score (no network, data/xp): mean of three percentiles —
 *    support ticks per minute, support XP share of all earned XP, and "safe"
 *    (100 − percentile of deaths per minute). Top 10% are pair-checked.
 * 2. Pair check (Honu, scripts/heavy-support.mjs): the supporter's recent
 *    support sessions → who received the support (squad-type events on ≥ 2
 *    days = a repeat partner) → both players' session lists → how much of each
 *    player's time was spent online together.
 * 3. Labels (HS_RULE): 🎯 pocket duo / 👥 steady squad / ➕ general medic.
 *
 * DOM-free; used by build-log.html, scripts/heavy-support.mjs and tests.
 */

/** Support experience ids (heal, revive, resupply, repair, shield repair, squad versions). */
export const SUPPORT_EXP = Object.freeze([4, 6, 7, 34, 51, 53, 55, 142, 438, 439]);
/** Squad-only support ids (squad heal / revive / resupply / repair / squad spawn). */
export const SQUAD_EXP = Object.freeze([51, 53, 55, 142, 439]);

export const HS_RULE = Object.freeze({
  MIN_MINUTES: 120, // minutes of XP detail before a player is scored
  TOP_SHARE: 0.1, // top 10% of the score are pair-checked
  CHECK_MIN_KD: 1.5, // skip parked resupply / AFK-like profiles (K/D ~1, no deaths)
  CHECK_MIN_INF: 80, // and mostly-vehicle players (infantry % of kills)
  SINCE_DAYS: 90, // sessions in the last 90 days
  WINDOWS: 4, // ≤ 4 recent support days read per supporter (1 Honu call each)
  PICKS: 3, // ≤ 3 repeat partners compared (1 Honu call each)
  MIN_DAYS: 2, // repeat partner: squad support on ≥ 2 different days
  POCKET_PARTNER: 0.6, // pocket duo: partner spends ≥ 60% of their time with the supporter (Ginger→Zyr0s lowest: 71%)
  POCKET_SUPPORTER: 0.15, // …and the supporter ≥ 15% of theirs (Ginger→Zyr0s lowest: 15%)
  STRONG_PCT: 90, // …and the partner is strong: iVi in the top 10% of ranks (all 5 Zyr0s accounts are)
  STEADY: 0.5, // steady squad: one player spends ≥ 50% of their time with the other…
  STEADY_MIN: 0.25, // …and the other ≥ 25% (both sides; a big outfit's regular is not a pair)
  TOP_MUTUAL: 0.6, // ⛑️ on a steady squad when BOTH spend ≥ 60% of their time together
  RECHECK_DAYS: 30, // a checked supporter is re-checked after 30 days
  PER_RUN: 5, // ≤ 5 supporters per scheduled run (≤ 5 × 8 = 40 Honu calls)
  DAY_CAP: 300, // ≤ 300 ⛑️ Honu calls per UTC day
});

export const HS_LABELS = Object.freeze({
  pocket: { icon: "🎯", text: "pocket duo", tip: "Supports one strong regular partner who plays most of their time with them" },
  steady: { icon: "👥", text: "steady squad", tip: "Supports a regular partner (an average player) on several days" },
  general: { icon: "➕", text: "general medic", tip: "Supports whoever is around; no regular partner" },
  thin: { icon: "·", text: "too few days", tip: "Fewer than 2 recent support days to compare" },
});
const LABEL_ORDER = { pocket: 0, steady: 1, general: 2, thin: 3 };

export const WORLDS = Object.freeze({ 1: "Osprey", 10: "Wainwright", 17: "Emerald", 13: "Cobalt", 19: "Jaeger", 40: "SolTech" });
export const worldName = (w) => WORLDS[w] || (w == null ? "?" : "world " + w);

export const slugOf = (name) => String(name || "").trim().toLowerCase().replace(/^\[.*?\]\s*/, "").replace(/[^a-z0-9]+/g, "");

const SUP = new Set(SUPPORT_EXP);
const SQ = new Set(SQUAD_EXP);

/** Per-player support features from a data/xp/{slug}.json payload, or null when too little data. */
export function supportFeatures(xp, rule = HS_RULE) {
  if (!xp || !xp.totals || !xp.totals.g) return null;
  const mins = (Number(xp.seconds_counted) || 0) / 60;
  if (mins < rule.MIN_MINUTES) return null;
  let ticks = 0, sxp = 0, txp = 0, sq = 0;
  for (const [k, v] of Object.entries(xp.totals.g)) {
    const id = Number(k), n = Number(v && v[0]) || 0, x = Number(v && v[1]) || 0;
    txp += x;
    if (SUP.has(id)) { ticks += n; sxp += x; if (SQ.has(id)) sq += n; }
  }
  let d = 0, dsec = 0;
  for (const s of Object.values(xp.sessions || {})) if (s && s.d != null) { d += Number(s.d) || 0; dsec += Number(s.sec) || 0; }
  if (!dsec) return null;
  return { mins, spm: ticks / mins, sxs: txp ? sxp / txp : 0, sqs: ticks ? sq / ticks : 0, dpm: d / (dsec / 60) };
}

const pctFn = (vals) => {
  const xs = [...vals].sort((a, b) => a - b);
  return (v) => { let lo = 0, hi = xs.length; while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m] < v) lo = m + 1; else hi = m; } return (100 * lo) / xs.length; };
};

/**
 * Score feature rows ({slug, spm, sxs, dpm, …}) → sorted copies with hs + rank, and the cuts.
 * @returns {{ rows:object[], n:number, cut10:number|null, cut20:number|null }}
 */
export function scoreHeavySupport(feats) {
  const F = (feats || []).filter((f) => f && Number.isFinite(f.spm) && Number.isFinite(f.sxs) && Number.isFinite(f.dpm));
  const ps = pctFn(F.map((f) => f.spm)), px = pctFn(F.map((f) => f.sxs)), pd = pctFn(F.map((f) => f.dpm));
  const rows = F.map((f) => {
    const p_spm = ps(f.spm), p_sxs = px(f.sxs), p_safe = 100 - pd(f.dpm);
    return { ...f, p_spm, p_sxs, p_safe, hs: (p_spm + p_sxs + p_safe) / 3 };
  }).sort((a, b) => b.hs - a.hs);
  rows.forEach((r, i) => { r.rank = i + 1; });
  const n = rows.length;
  const cut = (q) => (n && Math.floor(n * q) >= 1 ? rows[Math.floor(n * q) - 1].hs : null);
  return { rows, n, cut10: cut(0.1), cut20: cut(0.2) };
}

/** p-th percentile (0–100) of numbers. */
export function percentile(vals, p) {
  const xs = (vals || []).filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  return xs[Math.min(xs.length - 1, Math.max(0, Math.ceil((p / 100) * xs.length) - 1))];
}

const ts = (s) => Date.parse(s);
const DAY = 86400000;

/** Recent support windows (≤ 24 h each, newest `cap`) from a Honu session list. */
export function supportWindows(sessions, { cap = HS_RULE.WINDOWS, sinceMs = 0 } = {}) {
  const l = (sessions || []).filter((s) => s && s.end && ts(s.start) >= sinceMs &&
    (Number(s.heals) || 0) + (Number(s.revives) || 0) + (Number(s.resupplies) || 0) + (Number(s.repairs) || 0) + (Number(s.shieldRepairs) || 0) + (Number(s.spawns) || 0) > 0);
  l.sort((a, b) => ts(b.start) - ts(a.start));
  const pick = l.slice(0, cap).sort((a, b) => ts(a.start) - ts(b.start));
  const merged = [];
  for (const s of pick) {
    const a = ts(s.start), b = ts(s.end), last = merged[merged.length - 1];
    if (last && b - last[0] <= DAY) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  const out = [];
  for (let [a, b] of merged) { while (b - a > DAY) { out.push([a, a + DAY]); a += DAY; } out.push([a, b]); }
  return out.slice(-cap).map(([a, b]) => ({ start: new Date(a).toISOString().replace(/\.\d{3}Z$/, "Z"), end: new Date(b).toISOString().replace(/\.\d{3}Z$/, "Z") }));
}

/**
 * Who received the supporter's support in the exp blocks ([{events, characters}], one per window).
 * @returns {{ world:number|null, ticks:number, uniq:number, recv:Map<string,{ticks,sq,days:Set,name,tag,world}>, picks:string[] }}
 */
export function supportRecipients(cid, blocks, rule = HS_RULE) {
  cid = String(cid);
  const recv = new Map();
  let ticks = 0, world = null;
  const chars = new Map();
  (blocks || []).forEach((b, i) => {
    for (const ch of (b && b.characters) || []) { chars.set(String(ch.id), ch); if (String(ch.id) === cid && ch.worldID != null) world = ch.worldID; }
    for (const e of (b && b.events) || []) {
      const o = String(e.otherID), x = Number(e.experienceID);
      if (String(e.sourceID) !== cid || o === cid || o === "0" || !SUP.has(x)) continue;
      ticks++;
      let r = recv.get(o);
      if (!r) recv.set(o, (r = { ticks: 0, sq: 0, days: new Set(), sqDays: new Set() }));
      r.ticks++; r.days.add(i);
      if (SQ.has(x)) { r.sq++; r.sqDays.add(i); }
    }
  });
  for (const [o, r] of recv) { const ch = chars.get(o) || {}; r.name = ch.name || null; r.tag = ch.outfitTag || null; r.world = ch.worldID ?? null; }
  const picks = [...recv.entries()].filter(([, r]) => r.sqDays.size >= rule.MIN_DAYS)
    .sort((a, b) => b[1].sqDays.size - a[1].sqDays.size || b[1].sq - a[1].sq).slice(0, rule.PICKS).map(([o]) => o);
  return { world, ticks, uniq: recv.size, recv, picks };
}

const intervals = (sess, sinceMs) => (sess || []).filter((s) => s && s.end && ts(s.start) >= sinceMs).map((s) => [ts(s.start), ts(s.end)]).filter(([a, b]) => b > a);
const total = (iv) => iv.reduce((t, [a, b]) => t + (b - a), 0);
function overlap(A, B) {
  let t = 0;
  for (const [a, b] of A) for (const [c, d] of B) { const x = Math.min(b, d) - Math.max(a, c); if (x > 0) t += x; }
  return t;
}

/** Time together: share of each player's online time spent online at the same time. */
export function timeTogether(mySessions, partnerSessions, sinceMs = 0) {
  const A = intervals(mySessions, sinceMs), B = intervals(partnerSessions, sinceMs);
  const a = total(A), b = total(B), t = overlap(A, B);
  return { myPct: a ? t / a : 0, pPct: b ? t / b : 0, myHours: a / 3600000, pHours: b / 3600000 };
}

/** One stored check from the raw Honu replies (pure). partnerSessions: {cid: sessions[]}. */
export function buildCheck({ cid, name, sessions, blocks, partnerSessions, sinceMs = 0, at, rule = HS_RULE }) {
  const R = supportRecipients(cid, blocks, rule);
  const mine = intervals(sessions, sinceMs);
  const parts = R.picks.map((o) => {
    const r = R.recv.get(o), tt = timeTogether(sessions, (partnerSessions || {})[o] || [], sinceMs);
    return { cid: o, name: r.name, slug: slugOf(r.name), tag: r.tag, ticks: r.ticks, sq: r.sq, share: R.ticks ? r.ticks / R.ticks : 0,
      days: r.sqDays.size, myPct: tt.myPct, pPct: tt.pPct, pHours: tt.pHours };
  });
  return { cid: String(cid), name, world: R.world, at: at || new Date().toISOString().slice(0, 10), windows: (blocks || []).length,
    ticks: R.ticks, uniq: R.uniq, myHours: total(mine) / 3600000, parts };
}

/** Label of one supporter → partner pair (p = stored part + ivi). */
export function pairLabel(p, strongIvi, rule = HS_RULE) {
  if (!p) return "general";
  const repeat = (p.days || 0) >= rule.MIN_DAYS && (p.sq || 0) > 0;
  if (!repeat) return "general";
  const strong = strongIvi != null && Number.isFinite(p.ivi) && p.ivi >= strongIvi;
  if (strong && p.pPct >= rule.POCKET_PARTNER && p.myPct >= rule.POCKET_SUPPORTER) return "pocket";
  if (Math.max(p.myPct, p.pPct) >= rule.STEADY && Math.min(p.myPct, p.pPct) >= rule.STEADY_MIN) return "steady";
  return "general";
}

/** ⛑️ top pair: every pocket duo, and a steady squad where both spend ≥ TOP_MUTUAL of their time together. */
export function isTopPair(label, p, rule = HS_RULE) {
  return label === "pocket" || (label === "steady" && Math.min(p.myPct, p.pPct) >= rule.TOP_MUTUAL);
}

/**
 * slug → family key from the alt data: alt-families.json families, alts.json 👥 pairs and 👪 groups,
 * and the ⛑️ store's own owner-confirmed families.
 */
export function familyIndex({ altFamilies, alts, extra } = {}) {
  const parent = new Map();
  const find = (x) => { while (parent.has(x) && parent.get(x) !== x) x = parent.get(x); return x; };
  const add = (x) => { if (!parent.has(x)) parent.set(x, x); };
  const union = (a, b) => { add(a); add(b); const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };
  const sets = [...Object.values((altFamilies && altFamilies.families) || {}), ...Object.values(extra || {})];
  for (const g of (alts && alts.groups && alts.groups.found) || []) if (g && g.members) sets.push(g.members);
  for (const p of (alts && alts.found) || []) if (p && p.a && p.b) sets.push([p.a, p.b]);
  for (const set of sets) for (let i = 1; i < (set || []).length; i++) union(set[0], set[i]);
  const out = {};
  for (const k of parent.keys()) out[k] = find(k);
  return out;
}

const agg = (xs) => { const v = xs.filter(Number.isFinite); return v.length ? [Math.min(...v), Math.max(...v)] : null; };

/**
 * Grouped pair rows for the ⛑️ card.
 * store: data/heavysupport.json. One row per supporter-family → partner-family.
 * @returns {object[]} rows sorted ⛑️ first, then label, then partner time.
 */
export function heavySupportRows(store, rule = HS_RULE) {
  const st = store || {};
  const fam = st.familyOf || {};
  const strong = st.stats && st.stats.strongIvi;
  const top = new Map((st.top || []).map((t) => [t.slug, t]));
  const groups = new Map();
  for (const [slug, c] of Object.entries(st.checks || {})) {
    if (!c) continue;
    const sup = { slug, name: c.name || (top.get(slug) || {}).name || slug, cid: c.cid, world: c.world, hs: (top.get(slug) || {}).hs, mark: c.mark || (top.get(slug) || {}).mark || null, myHours: c.myHours || 0 };
    let pairs = [];
    if ((c.windows || 0) < rule.MIN_DAYS) pairs = [{ label: "thin", part: null }];
    else {
      const lab = (c.parts || []).map((p) => ({ part: p, label: pairLabel(p, strong, rule) }));
      const keep = lab.filter((x) => x.label !== "general");
      pairs = keep.length ? keep : [{ label: "general", part: (c.parts || [])[0] || null }];
    }
    for (const { part, label } of pairs) {
      const sk = fam[slug] || slug, pk = part ? fam[part.slug] || part.slug : "";
      const key = sk + "→" + pk + (pk ? "" : "·" + label);
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { key, members: [] }));
      g.members.push({ sup, part, label, top: !!part && isTopPair(label, part, rule) });
    }
  }
  const rows = [];
  for (const g of groups.values()) {
    const ms = g.members;
    const label = ms.map((m) => m.label).sort((a, b) => LABEL_ORDER[a] - LABEL_ORDER[b])[0];
    let ov = 0, myH = 0, pH = 0, ticks = 0, tot = 0;
    for (const m of ms) {
      if (!m.part) continue;
      ov += m.part.myPct * m.sup.myHours; myH += m.sup.myHours; pH += m.part.pHours || 0;
      ticks += m.part.ticks || 0; tot += m.part.share ? m.part.ticks / m.part.share : 0;
    }
    const parts = ms.filter((m) => m.part).map((m) => m.part);
    rows.push({
      key: g.key, label, top: ms.some((m) => m.top),
      supporters: [...new Map(ms.map((m) => [m.sup.slug, m.sup])).values()],
      partners: [...new Map(parts.map((p) => [p.slug, p])).values()],
      worlds: [...new Set(ms.map((m) => m.sup.world).filter((w) => w != null))].sort((a, b) => a - b),
      supPct: myH ? ov / myH : null, pPct: parts.length && pH ? ov / pH : null,
      share: tot ? ticks / tot : null, ivi: agg(parts.map((p) => p.ivi)), kd: agg(parts.map((p) => p.kd)),
      days: parts.reduce((t, p) => t + (p.days || 0), 0), members: ms,
    });
  }
  return rows.sort((a, b) => (b.top - a.top) || LABEL_ORDER[a.label] - LABEL_ORDER[b.label] || (b.pPct || 0) - (a.pPct || 0));
}

/** Filter rows: label "all" | pocket | steady | general; world number or "all"; name search (any supporter or partner). */
export function filterHeavySupport(rows, { label = "all", world = "all", q = "" } = {}) {
  const s = slugOf(q);
  return (rows || []).filter((r) => (label === "all" || r.label === label) &&
    (world === "all" || r.worlds.includes(Number(world))) &&
    (!s || [...r.supporters, ...r.partners].some((p) => slugOf(p.name).includes(s) || String(p.slug || "").includes(s))));
}

/** Count of rows per label. */
export function heavySupportCounts(rows) {
  const c = { pocket: 0, steady: 0, general: 0, thin: 0, top: 0 };
  for (const r of rows || []) { c[r.label] = (c[r.label] || 0) + 1; if (r.top) c.top++; }
  return c;
}

/** Plain rule text for ⓘ How it works (thresholds + measured numbers). */
export function heavySupportRuleText(stats = {}, rule = HS_RULE) {
  const p = (x) => Math.round(x * 100) + "%";
  const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "—");
  return [
    `Heavy-support score: the average of three percentiles over ${stats.scored ?? "—"} players with ${rule.MIN_MINUTES}+ minutes of XP detail — support actions per minute, support share of all earned XP, and how rarely the player dies. Top 10% = score ≥ ${f1(stats.cut10)} (${stats.top10 ?? "—"} players); top 20% = ≥ ${f1(stats.cut20)}.`,
    `Pair check (top 10%, K/D ≥ ${rule.CHECK_MIN_KD}, infantry ≥ ${rule.CHECK_MIN_INF}%): the ${rule.WINDOWS} most recent support days in the last ${rule.SINCE_DAYS} days; a regular partner got squad support on ≥ ${rule.MIN_DAYS} of them (up to ${rule.PICKS} partners). Time together = share of each player's own play time spent online at the same time.`,
    `🎯 pocket duo: the partner spends ≥ ${p(rule.POCKET_PARTNER)} of their time with the supporter, the supporter ≥ ${p(rule.POCKET_SUPPORTER)}, and the partner is strong (iVi ≥ ${stats.strongIvi != null ? Math.round(stats.strongIvi) : "—"}, the top ${100 - rule.STRONG_PCT}% of ranks). Reference: GingerBaby → Zyr0s, partner 71–99%, supporter 15–46%, iVi 1383–1758.`,
    `👥 steady squad: a regular partner, one player spends ≥ ${p(rule.STEADY)} of their time with the other and the other ≥ ${p(rule.STEADY_MIN)} (an average partner). ➕ general medic: no regular partner. · too few days: under ${rule.MIN_DAYS} support days to compare.`,
    `⛑️ top pair: every pocket duo, and a steady squad where both spend ≥ ${p(rule.TOP_MUTUAL)} of their time together. Known alt accounts (👥 Likely alts data and confirmed families) are grouped into one row.`,
    `Refresh: ≤ ${rule.PER_RUN} supporters per scheduled run (≤ ${rule.PER_RUN * (1 + rule.WINDOWS + rule.PICKS)} Honu calls), unchecked first, re-checked after ${rule.RECHECK_DAYS} days, ≤ ${rule.DAY_CAP} calls a day.`,
  ];
}
