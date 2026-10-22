#!/usr/bin/env node
/**
 * 🏆 Auraxium weapons: local weapon catalog + images (weapons.mjs reads them).
 *
 *   assets/weapons/catalog.json   { savedAt, items: { <item_id>: [name, category, faction_id, image_id] } }
 *   assets/weapons/<image_id>.webp  112 px wide (shown at 56 px), from the Census static image
 *
 * Census `item` with item_type_id=26 (weapons, infantry and vehicle). Items are
 * the same ids on PC and PlayStation; the page names anything missing with one
 * live Census call. Images that already exist are kept (only new ones are
 * downloaded), so a weekly run costs a few calls.
 *
 * Runs in .github/workflows/weapon-catalog.yml. Runners can't reach Census, so
 * JSON and images go through the cache Worker (CENSUS_PROXY + CENSUS_PROXY_KEY;
 * images via its /census/files/ps2/images/static/<id>.png route). Locally,
 * without CENSUS_PROXY, it calls Census directly.
 *
 * Needs `cwebp` (apt package "webp") for the images; without it only the catalog is written.
 */
import { mkdirSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const OUT = "assets/weapons";
const SID = process.env.CENSUS_SERVICE_ID || "daysetps2legends";
const HOST = "https://census.daybreakgames.com";
const PROXY = String(process.env.CENSUS_PROXY || "").replace(/\/+$/, "");
const KEY = process.env.CENSUS_PROXY_KEY || "";
const UA = "ps2-elite-kd weapon-catalog (+https://dayset.github.io/ps2-elite-kd/)";
const MAX_IMAGES = +process.env.MAX_IMAGES || 3000;
const PAGE = 1000;
// Stop downloading before the job limit so the commit step still runs; the next run continues.
const BUDGET_MS = (+process.env.TIME_BUDGET_SEC || 18 * 60) * 1000;
const T0 = Date.now();

const via = (u) => (PROXY && u.startsWith(HOST + "/") ? `${PROXY}/census${u.slice(HOST.length)}` : u);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { binary = false } = {}) {
  const headers = { "User-Agent": UA };
  if (PROXY && KEY) headers["X-Proxy-Key"] = KEY;
  for (let a = 1; a <= 5; a++) {
    try {
      const r = await fetch(via(url), { headers, signal: AbortSignal.timeout(30000) });
      if (r.status === 404) return null;
      if (r.ok) {
        if (binary) return Buffer.from(await r.arrayBuffer());
        const j = await r.json();
        if (!j.error && !j.errorCode) return j;
      }
    } catch {}
    await sleep(1500 * a);
  }
  throw new Error(`failed: ${url}`);
}

const base = `${HOST}/s:${SID}/get/ps2:v2/`;

const cats = {};
for (const c of (await get(`${base}item_category?c:limit=1000&c:show=item_category_id,name.en`)).item_category_list || []) {
  cats[c.item_category_id] = (c.name && c.name.en) || "";
}

const items = {};
for (let start = 0; ; start += PAGE) {
  const j = await get(`${base}item?item_type_id=26&c:start=${start}&c:limit=${PAGE}&c:show=item_id,item_category_id,faction_id,name.en,image_id`);
  const list = (j && j.item_list) || [];
  for (const it of list) {
    if (!it.item_id) continue;
    items[it.item_id] = [(it.name && it.name.en) || "", cats[it.item_category_id] || "", +it.faction_id || 0, it.image_id ? +it.image_id : 0];
  }
  if (list.length < PAGE) break;
  await sleep(300);
}
const n = Object.keys(items).length;
if (n < 500) throw new Error(`only ${n} weapon items from Census; keeping the old catalog`);
mkdirSync(OUT, { recursive: true });
const sorted = Object.fromEntries(Object.entries(items).sort((a, b) => +a[0] - +b[0]));
writeFileSync(join(OUT, "catalog.json"), JSON.stringify({ savedAt: new Date().toISOString(), items: sorted }) + "\n");
console.log(`catalog: ${n} weapons, ${Object.keys(cats).length} categories`);

let hasCwebp = true;
try { execFileSync("cwebp", ["-version"], { stdio: "ignore" }); } catch { hasCwebp = false; }
if (!hasCwebp) {
  console.log("::warning::cwebp missing: catalog written, images skipped");
  process.exit(0);
}

const imgs = [...new Set(Object.values(items).map((e) => e[3]).filter(Boolean))].filter((id) => !existsSync(join(OUT, `${id}.webp`)));
const tmp = join(tmpdir(), "wp-img.png");
let ok = 0, miss = 0, done = 0;
for (const id of imgs.slice(0, MAX_IMAGES)) {
  if (Date.now() - T0 > BUDGET_MS) break;
  done++;
  let buf = null;
  try { buf = await get(`${HOST}/files/ps2/images/static/${id}.png`, { binary: true }); } catch {}
  if (!buf || buf.length < 100) { miss++; continue; }
  writeFileSync(tmp, buf);
  try {
    execFileSync("cwebp", ["-quiet", "-q", "82", "-alpha_q", "90", "-resize", "112", "0", tmp, "-o", join(OUT, `${id}.webp`)]);
    ok++;
  } catch { miss++; }
  await sleep(120);
}
try { rmSync(tmp); } catch {}
console.log(`::notice::weapon catalog: ${n} weapons; images ${ok} new, ${miss} unavailable, ${imgs.length - done} left for next run`);
