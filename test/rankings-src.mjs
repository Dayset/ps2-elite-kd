// t356u: the Rankings moved from ranks.html into the main page. Static
// "wiring" tests read the pieces it is now made of: the module, the page
// markup and the shared stylesheet.
import fs from "node:fs";
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
export function rankingsSource() {
  return [read("rankings.mjs"), read("index.html"), read("styles.css")].join("\n/* ---- */\n");
}
