/** Lazy per-bin model access. Parsed bins stay cached for the isolate's life. */
import { TREE_BINS, XTRUNK_BINS, REGION_TO_FACILITY, LATTICE, CAPTURE, RESISTANCE } from "./models.gen.js";
import { buildAdjacency } from "./commander.js";

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

const lat = new Map();
/** Commander lattice for a zone: {adj: Map fid -> [fid], names} (built once per isolate). */
export function latticeFor(zone) {
  const k = String(zone);
  if (!lat.has(k)) {
    const L = LATTICE[k];
    lat.set(k, L ? { adj: buildAdjacency(L.links.map(([a, b]) => ({ facility_id_a: a, facility_id_b: b }))), names: L.names } : null);
  }
  return lat.get(k);
}
export const captureModel = (zone) => CAPTURE[String(zone)] || {};
export const resistanceModel = (zone) => RESISTANCE[String(zone)] || {};
