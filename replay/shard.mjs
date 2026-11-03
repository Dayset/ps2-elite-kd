// 🎬 Replay data shard for a player slug (scripts/build-replay.mjs writes data/replay/<shard>.json,
// replay/player.js reads it). FNV-1a, 64 shards, so one page view loads a small file.
export const SHARDS = 64;
export function shardOf(slug) {
  let h = 2166136261;
  for (const c of String(slug)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % SHARDS).toString(16).padStart(2, "0");
}
/** Same slug rule as the cache (lower case, letters and digits only). */
export const slugOf = (name) => String(name || "").replace(/^\[[^\]]*\]\s*/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
