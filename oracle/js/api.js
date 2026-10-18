// PS2MapOracle dashboard — split from index.html (#15). No behaviour change.
import { S, SLUG } from "./state.js?v=20261018-scrub";
export const API = new URLSearchParams(location.search).get("api") || "https://ps2-oracle.dayset.workers.dev";

export async function get(path) {
  const r = await fetch(API + path, { cache: "no-store" });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}
export async function asset(file) {
  if (!(file in S.mapCache)) S.mapCache[file] = fetch("backend/" + file).then((r) => r.ok ? r.json() : null).catch(() => null);
  return S.mapCache[file];
}
export async function names(zone) {
  if (!(zone in S.namesCache)) S.namesCache[zone] = asset(SLUG[zone] + "_regions.json").then((rs) => {
    const m = {}; (rs || []).forEach((r) => { m[r.facility_id] = { name: r.facility_name, type: r.facility_type_id }; }); return m;
  });
  return S.namesCache[zone];
}

export const TOKEN_KEY = "ps2oracle_token", PENDING_KEY = "ps2oracle_pending";
export const store = {
  get: (s, k) => { try { return window[s].getItem(k); } catch { return null; } },
  set: (s, k, v) => { try { v == null ? window[s].removeItem(k) : window[s].setItem(k, v); } catch {} },
};
export async function authCall(path, method = "GET", body) {
  const t = store.get("localStorage", TOKEN_KEY);
  const r = await fetch(API + path, { method, cache: "no-store", headers: { "Content-Type": "application/json", ...(t ? { Authorization: "Bearer " + t } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
