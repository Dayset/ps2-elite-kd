// Terrain overlay (owner 2026-10-27): wiki terrain image per continent + two opacity sliders.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const map = read("oracle/js/map.js");
const LANGS = ["en", "de", "es", "fr", "it", "ja", "ru", "uk", "zh"];

const MAPIMG = Function(`return ${map.match(/export const MAPIMG = (\{.*?\});/)[1]}`)();
const SHIFT = Function(`return ${map.match(/export const HEX_SHIFT_R = (\{.*?\});/)[1]}`)();
const HEXFILE = Function(`return ${read("oracle/js/state.js").match(/export const HEXFILE = (\{.*?\});/)[1]}`)();

test("every continent has a small terrain image that covers its hexes", () => {
  for (const [zone, file] of Object.entries(HEXFILE)) {
    const m = MAPIMG[zone];
    assert.ok(m, `zone ${zone} has a terrain image`);
    const size = statSync(new URL(`../oracle/maps/${m[0]}.webp`, import.meta.url)).size;
    assert.ok(size < 1.6e6, `${m[0]}.webp is ${size} bytes`);
    const [x, y, w, h] = m[1];
    const hexes = JSON.parse(read("oracle/backend/" + file)).hexes;
    const r = (zone === "344" ? 100 : 200) / Math.sqrt(3) - 1, sy = (SHIFT[zone] || 0) * (r + 1);
    // the drawn map reaches one hex radius past the outer hex centres: the image must cover that too
    for (const [hx, h0] of hexes) {
      const hy = h0 + sy;
      assert.ok(hx - r > x && hx + r < x + w && hy - r > y && hy + r < y + h, `${m[0]} hex ${hx},${hy} inside image`);
    }
  }
});

test("terrain sits over the colours, under borders and names, and never takes clicks", () => {
  const fills = map.indexOf('class="fills"'), img = map.indexOf('class="terrain"'), borders = map.indexOf('class="borders"');
  assert.ok(fills > 0 && fills < img && img < borders);
  assert.match(map.slice(img, img + 400), /pointer-events="none"/);
  assert.match(map, /export const MAP_IMG_DEFAULT = 0\.4;/);
  assert.match(map, /export const MAP_COLOR_DEFAULT = 1;/);
  assert.match(map, /data-opa="img"/);
  assert.match(map, /data-opa="col"/);
});

test("slider labels and credit in all languages", () => {
  for (const l of LANGS) {
    const j = JSON.parse(read(`i18n/${l}.json`));
    for (const k of ["or.m.imgOpa", "or.m.colOpa", "or.m.credit"]) assert.ok(j[k], `${l} ${k}`);
    assert.match(j["or.m.credit"], /PlanetSide 2 Wiki/);
  }
});

test("hexes from Census tiles are moved one radius north to match the game world (owner 2026-10-28)", () => {
  assert.deepEqual(SHIFT, { 2: -1, 6: -1, 8: -1, 344: -1 });
  assert.match(map, /const hx = shiftY \? hx0\.map/);
});
