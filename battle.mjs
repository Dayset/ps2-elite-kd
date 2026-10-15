/**
 * Debug battle simulator (pure math, shared by the browser panel and Node tests).
 * Keep this free of DOM / fetch / localStorage.
 *
 * Model:
 * - Strength a = 2^(adjS / 600) × √act × cons.
 *   adjS is the adjusted score (negatives floored at 0), act is activity
 *   (K/D × own KPM), cons is consistency (capped to 0..1).
 * - Opponents fight together (concentrated) when their activity is similar,
 *   so their combined strength is E = (Σ√bᵢ)². The champion wins if a > E.
 * - Opponents with very different activity cannot coordinate, so the
 *   champion faces them one by one: each duel costs b²/a of his remaining
 *   strength (the "300 Spartans" case).
 */

export const SCORE_BASE = 600;
/** Slowest opponent's activity ÷ fastest opponent's activity needed to count as "similar". */
export const ACTIVITY_SIMILAR_MIN = 0.5;

const finite = (v) => typeof v === "number" && Number.isFinite(v);

function colIndex(cols, key) {
  return Array.isArray(cols) ? cols.indexOf(key) : -1;
}

/** Turn one ranks.json row into a fighter, or null when stats are missing. */
export function fighterFromRow(row, cols) {
  const get = (key) => {
    const i = colIndex(cols, key);
    return i < 0 ? NaN : row[i];
  };
  const name = String(get("name") ?? "");
  const query = String(get("query") ?? "");
  const adjs = get("adjs");
  const act = get("act");
  const cons = get("cons");
  if (!finite(adjs) || !finite(act) || !finite(cons)) return null;
  const score = Math.max(adjs, 0);
  const actC = Math.max(act, 0);
  const consC = Math.min(Math.max(cons, 0), 1);
  const strength = Math.pow(2, score / SCORE_BASE) * Math.sqrt(actC) * consC;
  return { name, query, adjs, act: actC, cons: consC, strength };
}

/**
 * Find a player by typed name: exact (case-insensitive) match on name or query
 * first, otherwise a single unambiguous substring match on the name.
 * Returns { fighter } or { error }.
 */
export function findFighter(rows, cols, typed) {
  const q = String(typed || "").trim().toLowerCase();
  if (!q) return { error: "Type a player name first." };
  const all = [];
  for (const row of rows || []) {
    const f = fighterFromRow(row, cols);
    if (f) all.push(f);
  }
  const exact = all.find((f) => f.name.toLowerCase() === q || f.query.toLowerCase() === q);
  if (exact) return { fighter: exact };
  const partial = all.filter((f) => f.name.toLowerCase().includes(q));
  if (partial.length === 1) return { fighter: partial[0] };
  if (partial.length > 1) return { error: `"${typed}" matches ${partial.length} players. Type the full tag.` };
  return { error: `No player named "${typed}" in the ranks data.` };
}

/**
 * Pick the n opponents whose adjusted scores are closest to the champion's,
 * excluding the champion. Deterministic: ties break by name.
 */
export function pickOpponents(rows, cols, champion, n) {
  const count = Math.max(0, Math.floor(+n) || 0);
  const pool = [];
  for (const row of rows || []) {
    const f = fighterFromRow(row, cols);
    if (!f || f.name === champion.name) continue;
    pool.push(f);
  }
  pool.sort((x, y) => {
    const dx = Math.abs(x.adjs - champion.adjs);
    const dy = Math.abs(y.adjs - champion.adjs);
    return dx - dy || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0);
  });
  return pool.slice(0, count);
}

/**
 * Run the fight. Returns the mode, whether the champion wins, the enemy
 * strength used, the champion's remaining strength as a fraction of his start,
 * and each opponent's 1v1 win chance against the champion.
 */
export function runBattle(champion, opponents) {
  const a = champion.strength;
  const list = (opponents || []).slice();
  if (!list.length) {
    return { mode: "none", win: true, a, enemy: 0, remaining: 1, similarity: null, duels: [] };
  }
  const acts = list.map((o) => o.act);
  const maxAct = Math.max(...acts);
  const minAct = Math.min(...acts);
  const similarity = maxAct > 0 ? minAct / maxAct : 1;
  const bs = list.map((o) => o.strength).sort((x, y) => x - y);
  const duels = list.map((o) => ({
    name: o.name,
    adjs: o.adjs,
    act: o.act,
    cons: o.cons,
    strength: o.strength,
    championWinChance: a + o.strength > 0 ? a / (a + o.strength) : 0.5,
  }));

  if (similarity >= ACTIVITY_SIMILAR_MIN) {
    const enemy = Math.pow(bs.reduce((s, b) => s + Math.sqrt(b), 0), 2);
    const win = a > enemy;
    return {
      mode: "concentrated",
      win,
      a,
      enemy,
      remaining: win && a > 0 ? (a - enemy) / a : 0,
      similarity,
      duels,
    };
  }

  let left = a;
  for (const b of bs) {
    if (left <= 0) break;
    left -= (b * b) / left;
  }
  const win = left > 0;
  return {
    mode: "sequential",
    win,
    a,
    enemy: bs.reduce((s, b) => s + b, 0),
    remaining: win && a > 0 ? left / a : 0,
    similarity,
    duels,
  };
}
