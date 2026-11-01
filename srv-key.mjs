/**
 * 🌍 Server key of a ranks.json "srv" value (t812u: per-server positions).
 * PC rows carry "osprey" / "wainwright" (build-ranks addPcServerColumn, from the Census home world:
 * Connery + Emerald → Osprey, Miller + Cobalt → Wainwright); PS rows carry "us" (Genudine) / "eu" (Ceres).
 * Anything else (SolTech is closed, Jaeger, unknown world) → null: no server rank, same as the 🌐 Servers section.
 */
const PC = { osprey: "osprey", wainwright: "wainwright" };
const PS = { us: "genudine", eu: "ceres", genudine: "genudine", ceres: "ceres" };
export function srvKeyOf(srv, isPs = false) {
  const k = String(srv == null ? "" : srv).trim().toLowerCase();
  const m = isPs ? PS : PC;
  return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null;
}
