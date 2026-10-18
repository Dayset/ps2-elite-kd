/**
 * ⌨️ Global ←/→ keys drive whichever graph is in the middle of the screen:
 * the Distribution chart steps to the next / previous metric, the skill
 * graph flips 💀 ⇄ 🎯. Pure geometry, so it's Node-tested
 * (test/graph-keys.test.mjs); app.js supplies the rects and acts on the pick.
 */

/**
 * @param {DOMRect|null} skill rect of the skill-graph wrap (null = absent)
 * @param {DOMRect|null} dist rect of the Distribution chart (null = absent)
 * @param {number} vh viewport height
 * @param {{ distOpen?: boolean, hasPlayers?: boolean }} opts
 * @returns {"skill" | "dist" | null} the graph that gets the key, or null
 *   when neither graph is in the middle of the screen (keys keep scrolling).
 */
export function pickGraphForKeys(skill, dist, vh, { distOpen = true, hasPlayers = true } = {}) {
  const cy = vh / 2;
  const cands = [];
  const contains = (r) => r && cy >= r.top && cy <= r.bottom;
  const centerDist = (r) => Math.abs((r.top + r.bottom) / 2 - cy);
  if (hasPlayers && contains(skill)) cands.push({ id: "skill", d: centerDist(skill) });
  if (distOpen && contains(dist)) cands.push({ id: "dist", d: centerDist(dist) });
  if (!cands.length) return null;
  cands.sort((a, b) => a.d - b.d);
  return cands[0].id;
}
