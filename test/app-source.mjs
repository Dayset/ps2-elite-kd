// #66: app.js is being split into parts (app-util.mjs, theme.mjs, …: files whose header says "moved out of app.js").
// Tests that check app.js source text read all of it here, with the parts' "$." state prefix taken off, so a check
// written against the old single file still reads the same code. Not a test file itself.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** app.js and every local module it imports that was moved out of it. */
export function appParts() {
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const parts = ["app.js"];
  for (const m of app.matchAll(/from\s+"\.\/([A-Za-z0-9_-]+\.mjs)(?:\?[^"]*)?"/g)) {
    const f = m[1];
    const head = fs.existsSync(path.join(root, f)) ? fs.readFileSync(path.join(root, f), "utf8").slice(0, 600) : "";
    if (/moved\s+(?:\*\s+)?out of app\.js/.test(head) && !parts.includes(f)) parts.push(f);
  }
  return parts;
}

/** The one-line wrappers app.js keeps for moved functions ("function x(...a) { return xPart().x(...a); }") are left
 *  out, so a search for "function x(" finds the real one. */
export function appSource() {
  return appParts()
    .map((f) => fs.readFileSync(path.join(root, f), "utf8").replace(/\$\.(?=[A-Za-z_])/g, ""))
    .map((t) => t.replace(/^[ \t]*function [A-Za-z0-9_$]+\(\.\.\.a\) \{ return [A-Za-z0-9_$]+\(\)\.[A-Za-z0-9_$]+\(\.\.\.a\); \}\n/gm, ""))
    .join("\n");
}
