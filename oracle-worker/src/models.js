/** Lazy per-bin model access. Parsed bins stay cached for the isolate's life. */
import { TREE_BINS, XTRUNK_BINS, REGION_TO_FACILITY } from "./models.gen.js";

const cache = new Map();

export function binGetter(zone) {
  return (b) => {
    const k = `${zone}:${b}`;
    let v = cache.get(k);
    if (!v) {
      const t = TREE_BINS[String(zone)];
      v = { bin: t ? JSON.parse(t[b]) : {}, xbin: JSON.parse(XTRUNK_BINS[b]) };
      cache.set(k, v);
    }
    return v;
  };
}

export const hasTree = (zone) => !!TREE_BINS[String(zone)];
export const regionMap = (zone) => REGION_TO_FACILITY[String(zone)] || null;
